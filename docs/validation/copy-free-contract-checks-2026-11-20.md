# Kopyasız sözleşme denetimleri (2026-11-20)

Durum: **Uygulandı, commit bekliyor.** Optimizer `1.9.0` kaldı; plan çıktısı değişmedi.

## Sorun
Bellek profili (5 uzun rota): plan başına ~4,7 GB geçici bellek ayrılıyordu. Bunun 6,5 GB'ı (toplamın %28'i) Zod'dan geliyordu. Zod her doğrulamada veriyi baştan kopyalıyor. En büyük üç kalem, **sistemin kendi ürettiği ve kaynakta zaten doğrulanmış verinin** yeniden doğrulanmasıydı:

| Yer | Zod ayırması (5 plan) | Plan başına çağrı |
|---|---|---|
| `normalizeWeather` (hava tahmini) | 1,6 GB | ~39.000 |
| Enerji motoru `finish` (enerji sonucu) | 1,45 GB | ~190 |
| `normalizeRoadTrip` (yol rotası) | 1,1 GB | ~48 |

Sağlayıcı sınırındaki doğrulamalara (Valhalla ve Open-Meteo adaptörleri, istasyon sorgusu) ve son plan sözleşmesine (`planningEvaluationSchema`) dokunulmadı.

## Yaklaşım
Her biri için kopya üretmeyen bir denetleyici yazıldı (`weatherForecastFastCheck`, `energyResultFastCheck`, `roadRouteFastCheck`):
- **Elle denetlenenler:** sayı (sonlu, aralık), metin uzunluğu, enum, katı alan kümesi.
- **Şemanın kendi fonksiyonlarıyla denetlenen kurallar:** `checkEnergySegment`, `checkRoadSegment`, `checkRoadRoute`. `checkRoadSegment` bunun için `@chargeroad/shared`'den dışa açıldı; değişiklik salt eklemeli, kural aynı. Enerji sonucunun `superRefine` kuralları ifade ifade aynıdır.
- **Şemanın kendi alan şemalarıyla denetlenenler** (sonuç hatırlanır): zaman damgası, URL, UUID, kaynak referansı, kapasite görüntüsü, sıcaklık gözlemi, segmentasyon politikası, örnekleme çözünürlüğü.
- **Değeri `undefined` olan alanlar** hızlı yoldan kabul edilmez, çünkü Zod çıktısı bu alanları içermez.

Denetleyici bir değeri onaylayamazsa eski tam Zod doğrulaması çalışır ve aynı hatayı fırlatır. Yani geçersiz veri hiçbir zaman geçmez; yalnız geçerli veride kopya üretilmez. Hava ve yol nesneleri şema anahtar sırasıyla kurulduğu için JSON çıktısı birebir aynıdır.

Enerji sonucu, girdideki kapasite görüntüsünü kendi içine koyuyordu. Zod onu kopyalıyordu; hızlı yolda da kopyalanır, böylece sonuç ve girdi aynı nesneyi paylaşmaz. Hava tahmini, sorgunun konum nesnesini paylaşır; bunu değiştiren bir kod bulunmadı.

## Kanıt
- **Testler:** `weather-fast-check.spec`, `energy-result-check.spec`, `road-route-check.spec`.
  - Gerçek çıktılarda hızlı yol kabul ediyor ve JSON, Zod çıktısıyla aynı.
  - Zod'un reddettiği bozulmuş örneklerin (alan, aralık, kural, fazladan alan, eksik alan) hiçbirini hızlı yol kabul etmiyor.
  - Mevcut `trusted-input.spec` (enerji, `toStrictEqual`) geçiyor.
- **Hızlı yolun kapsamı** (5 rota, ısınma dahil 10 istek):
  - hava 391.500 → 0 tam doğrulama
  - enerji 1.890 → 0
  - yol 478 → 10 (plan derlerken plan başına 1)
- **Plan parmak izleri:** 5 uzun rotada değişmedi.

## Ölçüm
Koşullar: tek süreç, 5 uzun rota × 2 tur (ikinci tur), üretim modu, metrikler kapalı. Önce ve sonra aynı koşullarda arka arkaya koşuldu.

| | Önce | Sonra |
|---|---|---|
| 5 plan, varsayılan heap | 16,3 sn | **15,0 sn (−%8)** |
| 5 plan, `--max-old-space-size=384` | 20,7 sn | **17,8 sn (−%14)** |
| Tepe RSS, varsayılan / 384 MB | 744 / 521 MB | 704 / 537 MB |

Hava denetleyicisi tek başına: 384 MB'ta 23,4 → 21,0 sn. Hava + enerji: 23,8 → 20,2 sn. Ölçümler aynı makinedeki API, Expo ve Docker yüzünden gürültülüdür (aynı "önce" koşusu 20,7–23,8 sn arasında değişti).

**Bellek:** Tepe bellek, geçici ayırmanın miktarından çok çöp toplamanın zamanlamasına bağlı; denetleyiciler RSS'i belirgin düşürmedi. Bellek için etkili olan, işçi başına heap sınırıdır (`--max-old-space-size=384`: ~744 → ~525 MB). Denetleyiciler bu sınırın hız bedelini küçültür (sınırlı: 17,8 sn, sınırsız eski: 16,3 sn).

## Testler
- API: 1.215 test geçti; 154 DB testi atlandı (NOT_RUN).
- `@chargeroad/shared`: 43 test geçti.
- Mobil typecheck temiz.
