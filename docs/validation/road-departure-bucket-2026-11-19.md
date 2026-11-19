# Yol önbelleği — kalkış saati kovası (2026-11-19)

Sürüm: `road-departure-bucket/1.0.0` (`apps/api/src/roads/valhalla-adapter.ts`). Optimizer/enerji/şarj sürümü değişmedi: plan çıktısı eşdeğer (aşağıda).

## Sorun (telefondan iki İstanbul→Kelkit isteği, sunucu metrikleri)

| | 1. istek | 2. istek (~1,5 dk sonra) |
|---|---|---|
| İş süresi | 10,0 s | 8,4 s |
| Yol PG önbelleği isabet / kaçırma | 141 / 192 | 167 / 166 |
| İstasyon bacakları yol sorgusu | 4,4 s | 3,3 s |

Valhalla isteğindeki `date_time` dakika hassasiyetindeydi; önbellek anahtarı isteğin tamamından üretildiği için her dakika yeni anahtar oluşuyordu.

## Valhalla saat bağımlılığı yoklaması

8002 (`chargeroad-valhalla`) ve 8004 runtime'ları; 5 rota çifti (22,7 / 42,1 / 458,5 / 479,8 / 1.128,7 km, alternatifler dahil) × 6 yerel saat (00:30, 07:45, 12:00, 17:30, Pazar 03:00, Pazartesi 08:15). Şekil, özet, rakım ve manevra (süre/indeks/tip) hash'i her çiftte 6 saat için aynı. Kullanılan koordinatlar şehir merkezleridir, kullanıcı isteği değildir.

## Eşdeğerlik (süreç-içi, yerel Valhalla + Open-Meteo)

Eski davranışı (dakika) geri getiren geçici yama ile A/B; kalkış 2026-11-20T07:00Z. Plan özeti (km, toplam süre, varış, durak listesi, segment sayısı, segment SOC/enerji hash'i, uyarılar) 5 referans rotada **birebir eşit** (İstanbul→Kelkit ×3, Ankara, İzmir).

## Hız ("şimdi+10 dk" kalkışı, İstanbul(Kadıköy)→Kelkit, 75 s arayla iki koşu)

| Kol | Koşu | Yol önbelleği kaçırma | Optimizer | Plan |
|---|---|---|---|---|
| Dakika (eski) | 1 | 95 | 5,4 s | 6,6 s |
| Dakika (eski) | 2 | 161 | 6,4 s | 8,0 s |
| Saat kovası | 1 | 3 | 3,8 s | 4,8 s |
| Saat kovası | 2 | 6 | 4,2 s | 5,4 s |

Her koşu yeni süreçtir (hava L1 önbelleği soğuk); çalışan API'de hava önbelleği sıcak olduğundan süre daha düşük olabilir, ölçülmedi. Ölçüm sırasında başka bir yerel süreç ~2 çekirdek kullanıyordu; süreler gürültülüdür, hızlanma yüzdesi iddia edilmez. Saat değişiminden sonraki ilk plan yine soğuk başlar.

## Sınır

Bir saat içinde değişen saat koşullu erişim kuralları (ör. access:conditional) saat başındaki duruma göre çözülür. Trafik verisi eklenirse (`traffic` ≠ 'none') bu kova yeniden değerlendirilmelidir.

## Testler

`roads.spec.ts` yeni test (aynı saat içindeki iki istek aynı gövde, saat değişince farklı): önce FAIL, sonra PASS. `src/roads`: 55 PASS, 13 SKIPPED (DB).

## Telefon kabulü (çalışan API, `job_execute` metrikleri, aynı İstanbul→Kelkit isteği)

| İstek | Durum | İş süresi | Optimizer | Yol önbelleği isabet / kaçırma | Hava PG okuması |
|---|---|---|---|---|---|
| 10:53 | API yeni başlatıldı, bu başlangıç/saat için yol önbelleği boş | 7,4 s | 5,8 s | 175 / 156 | 720 |
| 10:54 | sıcak | **4,5 s** (kuyruk 0,35 s dahil) | 3,5 s | 326 / 5 | 0 |

İki istekte arama aynı yolu izledi (43 durum, 168 geçiş). Telefondaki indirme/parse süresi ölçülmedi (yanıt 5,8 MB JSON, 844 KB gzip).
