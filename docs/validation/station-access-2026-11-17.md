# Erişim sapması kontrollü istasyon seçimi — 2026-11-17

Başlangıç HEAD `b03d1e3` (optimizer 1.4.0). Kullanıcıyla kararlaştırılan iş sırasının 2. adımı. Eşik kullanıcı kararıdır: **3 km / 3 dk**. Ölçümler süreç içi, yerel Valhalla 8004, sabit kalkış saati, hava 8 saatlik cache penceresinden (MET isteği 0–1). Optimizer ve enerji/şarj motorlarının kodu ve sürümleri bu adımda değişmedi; değişen, katalog senaryosunda aday istasyon seçimidir (`catalogue-scenario/1.1.0 → 1.2.0`, yeni `station-access/1.0.0`).

## Teşhis

Seçilen istasyonların hepsi ana rotaya ≤130 m ve durak çevresinde otoyoldan çıkılan yol yalnız ~1–2 km idi; fazla mesafe büyük ölçüde otoyolun üstündeydi (karşı yöndeki tesise kavşaktan dönüş):

| Rota | Bacak | Fazla mesafe |
|---|---|---:|
| İstanbul→Ankara | → `7bbd3465` (480 kW) | +35,7 km |
| İstanbul→İzmir | `11e8ecce` → İzmir | +82 km |

Aday seçimi rotayı 16 dilime bölüp her dilimden kuş uçuşu yakınlık ve güce göre bir istasyon alıyordu; yol üzerinden erişim maliyetine bakılmıyordu. Projede bu maliyeti ölçen `RoadService.stationAccess` vardı ama planlayıcı kullanmıyordu.

## Değişiklik

- `selectAccessibleCandidates`: her dilimde adayların erişim sapması gidiş yönünde ölçülür (istasyonun 1 km öncesi → istasyon → 1 km sonrası; iki bacak, yerel yol sağlayıcısı). Mevcut sıralamaya göre ilk ≤3 km ve ≤3 dk ek sapmalı aday seçilir; ilk 3'te yoksa 6'ya kadar bakılır; hiçbiri uygun değilse en az sapmalı aday tutulur (plan mümkün kalsın). Ölçüm en fazla 4 eşzamanlı, plan başına istasyon başına bir kez.
- Planlanan durağın `detourDistanceMeters` / `detourDrivingSeconds` alanları ölçümle doldurulur (önce hep `null`).
- Ölçüm başarısızsa aday elenmez, `STATION_ACCESS_UNMEASURED` sorunu eklenir.

## Sonuç (referans rotalar, 1.4.0'a karşı)

| Rota | 1.4.0 km / dk / durak | Erişim kontrollü | Fark | Sunucu süresi |
|---|---|---|---|---|
| İstanbul→Ankara | 502,6 / 402 / 3 | 458,4 / 355,4 / 3 | −44 km, −47 dk | 8,5 → 9,9 sn |
| Ankara→İstanbul | 456,4 / 363,6 / 2 | 456,4 / 355 / 2 | −9 dk | 8,1 → 11,9 sn |
| Bursa→Ankara | 388,8 / 320,4 / 2 | 386,5 / 314,4 / 2 | −2 km, −6 dk | 7,5 → 8,4 sn |
| İstanbul→İzmir | 588,1 / 477 / 4 | 571 / 436,1 / 4 | −17 km, −41 dk | 8,0 → 10,6 sn |
| Ankara→Antalya | 526,7 / 440,3 / 2 | aynı | — | 7,3 → 8,7 sn |
| Kadıköy→Sarıyer | 27,6 / 55,1 / 0 | aynı | — | 1,8 → 3,1 sn |

Hiçbir rota kötüleşmedi. İstanbul→Ankara artık ana rota uzunluğunda (458,4 km).

## Açık kalan

İstanbul→İzmir hâlâ ana rotadan ~90 km uzun. Son bölümde ölçülen tek erişilebilir aday `11e8ecce` (erişim sapması 90,5 km / 58 dk) ve dilim aramasında kabul edilebilir bir alternatif yok; 289. km'deki duraktan sonra menzil içinde otoyol üstü sapmasız DC istasyonu katalogda görünmüyor. Bu seçim mantığıyla çözülemez; istasyon verisi kapsamı (`V1-STATION-001`) konusudur. Ayrıca 179. km'deki istasyonun erişimi mesafede küçük (14 m) ama sürede 6,5 dk; dilimde daha iyisi yoktu.

## Testler

| Komut | Sonuç |
|---|---|
| `station-access-selection.spec.ts` (önce kırmızı) | PASS 9/9 |
| `pnpm --filter @chargeroad/api test` | 1113 PASS, 0 FAIL, 154 SKIPPED (DB yok) |
| `pnpm --filter @chargeroad/api typecheck` | PASS |
| `test:db` | NOT_RUN — izole `TEST_DATABASE_URL` yok |
