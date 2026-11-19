# Optimizer 1.7.1 — istasyon uç toleransı ve hava çağrı bütçesi (2026-11-19)

## Hava çağrı bütçesi

Belirti: İstanbul(Kadıköy)→Kelkit aynı girdiyle bazen `computation_limit` (`WEATHER_QUERY_BUDGET`, `STATION_WEATHER_UNAVAILABLE`), bazen plan. Aynı gün iki kez görüldü.

Kök neden: plan başına dış hava çağrısı `WEATHER_POLICY.maxExternalCalls`=128 (MET kotası için). Yeni ICON koşusundan sonra yerel Open-Meteo belgeleri PG önbelleğinde tazeliğini yitirince planın 128'den fazla konumu yeniden çekmesi gerekiyor; kalan tahminler `budget_exhausted` (bir koşuda 768, sabah 3.863) dönüyor, istasyonlar şarj edemiyor.

Ölçüm (plan başına farklı hava belgesi URL'si; soğuk önbellekte = HTTP çağrısı): Kadıköy→Kelkit 739, Fatih→Kelkit 756, batı→Kelkit 879, Ankara 75, İzmir 78. Bir sıcak/yarı sıcak koşuda batı→Kelkit 184 HTTP çağrısı yaptı (eski sınırın üstünde).

Değişiklik: `weatherProviderLimits(provider).maxExternalCalls`; MET 128 (değişmedi), `open-meteo-local` 1.024. Tamamen soğuk önbellekte de en büyük referans (879) sınırın altında. Not: bu kadar çok farklı konum, istasyon bacaklarının örnek noktalarının bacak başlangıcına göre konumlanmasından geliyor olabilir; ayrıca incelenmedi.

## İstasyon uç toleransı (B6)

İstasyon 3ffb3120 için Valhalla eşleme mesafesi 100,0 m (katalog koordinatı servis alanı içinde). `> 100` kontrolü yüzünden bu istasyona giden/gelen her bacak `ROAD_SOURCE_OR_ENDPOINT_INVALID` ile reddediliyordu. `ROAD_ENDPOINT_POLICY`: istasyon düğümü 250 m, başlangıç/varış 100 m. Aradaki mesafe `station_road_endpoint_gap` olarak raporlanır, enerji modelinde sürülmez (≤250 m).

Referans rotalarda (5) 100 m kontrolüne takılan bacak gözlenmedi; plan değişmesi beklenmez.

## Eşdeğerlik ve testler

- 5 referans plan (kalkış 2026-11-20T07:00Z) 1.7.0 özetleriyle birebir eşit (km, süre, varış, duraklar, segment SOC/enerji hash'i, uyarılar).
- Yeni: `station-endpoint-tolerance.spec.ts` (5), `weather.spec.ts` sağlayıcı bütçesi; önce FAIL sonra PASS. `open-meteo.spec.ts` MET limit beklentisine aynı değerdeki `maxExternalCalls` eklendi.
- `pnpm --filter @chargeroad/api typecheck` PASS; `test`: 88 suite / 1.165 test PASS, 14 suite / 154 test SKIPPED (DB, `test:db` NOT_RUN).
- Süreç-içi süre (yük yok, önbellek sıcak): Kelkit 4,5–6,0 s, Ankara 2,8 s, İzmir 2,3 s. Soğuk önbellek düzeltmesi gerçek soğuk koşulda yeniden üretilmedi (yeni model koşusu beklenmeli); kanıt sayım ve sınır karşılaştırmasıdır.
- Durum gölgesi: `station-endpoint-shadow-source-2026-11-19.json` (arama kaynağı hash'i 1.7.0 ile aynı).
