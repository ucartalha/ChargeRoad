# W4 — Hava noktalarını global ızgaraya oturtma: Aşama 0 ve 1

2026-11-17 · HEAD `92cc1ec`. **Yalnız ölçüm; kod değişmedi.** Aşama 0'da MET'e istek yok (yalnız yerel Valhalla). Aşama 1'de kendi `WeatherCacheStore` katmanımız üzerinden (PG cache, pacing, kota, kimlikli User-Agent) 18 MET isteği. Rotalar ve seriler yalnız geçici scratchpad'de tutuldu; uç noktalar kamuya açık yerlerdir.

## Aşama 0 — Kaç farklı MET URL'si gerekiyor?

Araç: Ioniq 6 pilot profili; katalog menzili bulunamadığı için `capacity_consumption_estimate`, yakın bölüm ~149 km. Her rota için mevcut `buildPlanningWeather` + `sampleRouteWeather` ile üretilen sorgular, beş yöntemle URL'ye çevrildi:

- **legacy:** bugünkü davranış (rota başından 15/25 km'de bir anchor, segment en yakın anchor'u kullanır).
- **grid0.1:** aynı anchor'lar 0,1° hücre merkezine taşınır.
- **cellG:** anchor yok; her segment kendi orta noktasının içinde olduğu G° hücrenin merkezini kullanır (`cell0.15/0.25`: yakın bölüm 0,15°, uzak bölüm 0,25°).

İstanbul→Ankara'da 10 farklı uç nokta, sırayla planlanıyor; önceki rotaların URL'leri cache'te varsayılır:

| Yöntem | İlk rota | Sonraki 9 rotanın yeni istekleri | 10 rota benzersiz | Ters yön (yeni/toplam) | Kadıköy→Bolu (yeni/toplam) | İstanbul→Kelkit (1147 km) | Segment→örnek azami mesafe |
|---|---:|---|---:|---|---|---:|---:|
| legacy | 24 | 23,23,23,23,24,22,23,21,22 | 228 | 22/24 | 7/16 | **817** | yakın ≤7,5 km, uzak ≤12,5 km |
| grid0.1 | 24 | 12,7,6,3,5,1,1,1,2 | 62 | 16/23 | 0/15 | 113 | — |
| cell0.1 | 59 | 0,0,1,0,3,0,2,2,1 | 68 | 0/58 | 0/35 | 237 | 6,9 km |
| cell0.15/0.25 | 32 | 0,2,0,0,0,0,1,4,0 | 39 | 20/32 | 0/21 | 99 | 17,4 km |
| cell0.2 | 31 | 0,0,0,0,1,0,0,0,0 | 32 | 0/31 | 0/19 | 115 | 13,9 km |

Bulgular:

1. Bugünkü yöntemde farklı başlangıç noktası neredeyse sıfır paylaşım sağlıyor (her yeni kullanıcı ~23 yeni istek).
2. Anchor'ları ızgaraya taşımak (grid0.1) paylaşımı artırıyor ama ters yönde zayıf kalıyor; anchor konumları hâlâ rotanın başlangıcına bağlı.
3. Segmentin kendi hücresini kullanması (cellG) yönden ve başlangıçtan bağımsız; tek boyutlu ızgara ters yönde ve kısmi rotalarda tam paylaşım veriyor. Yakın/uzak bölüme farklı boyut vermek (0,15/0,25) ters yönde paylaşımı bozuyor, çünkü bölüm sınırı başlangıca bağlı.
4. **Ayrı hata adayı:** İstanbul→Kelkit'te ikinci alternatif rota ana koridordan uzaklaşınca her segment kendi noktasına düşüyor; 817 farklı URL, plan başına 128 edinim bütçesinin çok üstünde. Bu, uzun rotalarda `WEATHER_QUERY_BUDGET`/`budget_exhausted` raporlarını açıklayabilir; doğrulanmadı.

## Aşama 1 — MET serileri mesafeyle ne kadar değişiyor?

Üç bölgede bir taban noktası ve 1, 2, 5, 10 km doğu ile 5 km kuzey noktaları; 73 saatlik seri karşılaştırması (taban noktaya göre mutlak fark):

| Bölge | Nokta | Yükseklik farkı | Sıcaklık ort / p95 (°C) | Rüzgâr ort / p95 (km/s) | Seri aynı mı |
|---|---|---:|---|---|---|
| Ankara batısı (plato) | 1 km D | −5 m | 0,82 / 1,90 | 4,28 / 7,20 | hayır (hücre sınırı) |
| | 2 km D / 5 km K | +14 / −14 m | 0,82 / 1,90 | 4,28 / 7,20 | 1 km ile aynı hücre |
| | 5 km D / 10 km D | −9 / +6 m | 0,38–0,92 / 1,2–1,8 | 3,73 / 6,84 | birbirleriyle aynı hücre |
| Bolu dağı | 1 km D / 2 km D | +27 / +52 m | 0,20 / 0,20 · 0,30 / 0,30 | 0 / 0 | rüzgâr aynı, sıcaklık yalnız yükseklik düzeltmesi |
| | 5 km D | 0 m | 0 / 0 | 0 / 0 | **birebir aynı** |
| | 10 km D | −88 m | 1,03 / 1,70 | 1,10 / 3,60 | farklı hücre |
| | 5 km K | +280 m | 2,07 / 2,90 | 1,95 / 5,04 | farklı hücre + yükseklik |
| İzmit kıyısı | 1 km D / 2 km D | 0 / +4 m | 0 / 0 | 0 / 0 | **birebir aynı** |
| | 5 km D / 10 km D | +5 / +20 m | 0,52–0,67 / 1,3–1,9 | 1,48 / 3,60 | farklı hücre |
| | 5 km K | +204 m | 0,70 / 0,70 | 0 / 0 | rüzgâr aynı, yalnız yükseklik düzeltmesi |

Yorum:

- MET, Türkiye'de model hücresinin (ECMWF, ~9 km) değerini döndürüyor; aynı hücre içinde rüzgâr ve basınç birebir aynı, sıcaklık yalnız istenen noktanın yüksekliğine göre ~0,7 °C/100 m düzeltiliyor.
- Hücre sınırı geçildiğinde 1–10 km'de bile sıcaklıkta ortalama ~0,4–1 °C, p95 ~1,2–2 °C; rüzgârda ortalama ~1,5–4 km/s fark görülüyor. Bugünkü yöntem segmenti 7,5 km (uzak bölümde 12,5 km) ötedeki anchor'a bağladığı için bu büyüklükte fark **bugün de** mevcuttur.
- Model ızgarası 0,1°'nin katlarına hizalı görünmüyor (Ankara'da 39,95/32,60 ile 1 km doğusu farklı hücrede); kendi ızgaramızı model hücrelerine hizalamak bu ölçümle mümkün değil.
- Yükseklik farkı sıcaklığa doğrudan yansıyor; ±100 m koruması sıcaklık kaymasını ~0,7 °C ile sınırlar.

## Karar için seçenekler

| Seçenek | Soğuk ilk plan | Sonraki kullanıcılar | Segment→örnek mesafe | Tahmine etkisi |
|---|---|---|---|---|
| **cell0.1** | 59 istek (24'ün ~2,4 katı; yeni pacing ile ~6 sn) | ~0–3 yeni, ters yön 0 | ≤6,9 km (bugünkünden **daha yakın**) | Örnekleme sıklaşır; çözünürlük bugünden kötü değil |
| **cell0.2** | 31 istek | ~0 yeni, ters yön 0 | ≤13,9 km (yakın bölümde bugünkü 7,5 km'den uzak) | Yakın bölüm seyrekleşir; doğruluk kapısı şart |
| grid0.1 | 24 istek | 1–12 yeni, ters yön zayıf | ~bugünkü | En az değişiklik, en az kazanç |

İki seçenekte de segment başına geçiş saati, 72 saat penceresi, tazelik, kalite etiketleri ve enerji/şarj/optimizer kodu aynı kalır; değişen yalnız hangi konumun serisinin okunduğudur. Bu yüzden enerji sonuçları sayısal olarak değişebilir ve Aşama 2 doğruluk kapısı gerekir.

Açık noktalar: hücre merkezi–yol yükseklik farkı reddi (dağlarda ek istek) simüle edilmedi; MET'in hücre yüksekliği yalnız istekten sonra bilinir. Kelkit tipi alternatif rota patlaması ayrı bir düzeltme gerektirir.

## Ek — İlk uygulama ve canlı deneme (aynı gün)

W5 (8 saatlik sunum penceresi) ve W4 (hücre ızgarası, `WEATHER_GRID_ENABLED`, varsayılan kapalı) kodlandı; testler PASS. Yerel API'de flag yalnız deneme için açıldı. İstanbul→Ankara, Bursa→Ankara, Ankara→İstanbul planlarının **her biri 128 MET isteği** yaptı (plan bütçesi tavanı); paylaşım görülmedi. Deneme durduruldu, flag yerelde tekrar kapatıldı. Günlük MET kullanımı 636/1000.

Kök neden (yalnız cache okuyan teşhis, MET isteği yok):

- Planlama rotaları yükseklik verisi olmayan Valhalla runtime'ından geliyor (`url http://127.0.0.1:8002`, `dem=unknown`). İstanbul→Ankara'nın 587 segmentinden yalnız 25'inde `elevationProfile` var ve bu değerlerin hepsi **-499,9 m** (Valhalla "veri yok" değeri) — üstelik `elevationQuality: modelled` etiketiyle.
- Izgara yalnız yüksekliği olan segmentlere uygulandığı için segmentlerin %96'sı eski anchor'larda kaldı; ızgaraya giren 25 segmentin tamamı yükseklik korumasında reddedildi (fark medyanı 688 m) ve her biri yolun kendi noktasına düştü.
- Reddedilen her segment ayrı bir URL ürettiği için istasyon bacaklarıyla birlikte plan başına 128 tavanı doldu.

Sonuç: W4 bu haliyle doğru yükseklik verisi olmadan çalışmaz. Ayrıca -499,9 değerinin `modelled` olarak kabul edilmesi yol normalizasyonunda ayrı bir veri kalitesi hatasıdır (enerji motoru bu segmentlerde bu değeri görür; etkisi ölçülmedi).

## Ek 2 — Düzeltme ve yükseklik verili rota (8004) denemesi

Değişiklikler: reddedilen hücre artık yolun kendi noktasına değil rota-göreli eski örneğe düşer (`sampleFallbackLocation`); −430 m altı yükseklikler bilinmiyor sayılır; ızgara varsayılan açık (kullanıcı kararı). Testler: ızgara 10/10, shared 41/41, API 1087 PASS / 4 FAIL (önceden var olan `latency-polling`), typecheck PASS.

API süreç ortamında `ROAD_ROUTING_BASE_URL=http://127.0.0.1:8004` ile (yerel Docker, yükseklik verili; `.env` değiştirilmedi) MET isteği olmadan kapsam ölçüldü:

| Rota | Segment | Yükseklikli | Izgara segmenti | Gerekli MET noktası | Önceki rotalara göre yeni |
|---|---:|---:|---:|---:|---:|
| İstanbul→Ankara | 5041 | 5041 | 5041 | 59 | 59 |
| Bursa→Ankara | 3140 | 3140 | 3140 | 55 | 52 |
| Ankara→İstanbul | 5057 | 5057 | 5057 | 58 | **0** |

Canlı İstanbul→Ankara planı (8004 + ızgara): **15 MET isteği** (hücrelerin çoğu cache'te) ama sonuç `computation_limit / NO_VALID_PLAN_WITHIN_DATA_BUDGET`. Neden hava değil, segment sayısı: yükseklik verisiyle yol normalizasyonu %3 eğim değişiminde böldüğü için segmentler ~8,6 kat arttı (587 → 5041). Enerji değerlendirmesi ~8 ms → ~51 ms (184 değerlendirme 9,5 sn), hava sorgu öğesi 30 bin → 158 bin; 30 sn sunucu bütçesinde geçerli plan bulunamadı. API tekrar 8002'ye alındı; 8002'de yükseklik olmadığı için ızgara kendiliğinden devre dışıdır, W5 etkindir. Günlük MET kullanımı 651/1000.

Sonraki karar: yükseklik verili rotaya geçiş, segmentasyon (eğim eşiği / azami uzunluk) veya enerji bütçesi ayarı gerektirir; bu enerji tahminini değiştirir ve ayrı onay/sürüm konusudur.
