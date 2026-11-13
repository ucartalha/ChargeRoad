# Valhalla/DEM hardening — yerel teknik teslim

Tarih: 2026-11-12, Europe/Istanbul. Durum: **teknik dilim test edildi; görev IN_PROGRESS**, kaynak/lisans, sıfırdan graf build'i, saha ve üretim kabulü açık. [Başlangıç audit'i](valhalla-dem-hardening-audit-2026-11-12.md), [kullanıcının görev kapsamı](../tasks/valhalla-dem-integration-hardening.md), [ADR](../adr/009-in-app-navigation-and-self-hosted-routing.md).

## 1. Başlangıç ve korunan çalışma

Mevcut çalışma ağacı önceki görevlerden çok sayıda değişiklik içeriyordu. HEAD'e dönülmedi; stash/clean/reset yapılmadı. Yerel `road-policy.ts` içinde non-production loopback 1000/gün override'ı zaten vardı. `infra/valhalla/compose.yaml`, `custom_files`, DEM'li `elevation-pilot` önceden mevcuttu; Compose değiştirilmedi. İstenen ADR/görev hedefleri eksikti; kullanıcı dosyaları yeni adlarıyla eklendi. Mevcut enerji ADR-009 silinmedi.

Başlangıç ve son kontrolde API 3000/3001 ready 200; Valhalla 8002/8003, PostgreSQL ve OrderLane ayaktaydı. Hiçbir mevcut süreç/konteyner yeniden başlatılmadı veya silinmedi; kök `.env` değiştirilmedi. Yeni kod, mevcut API'leri yeniden başlatmadan **geçici ayrı API** üzerinden doğrulandı. Çalışan 3000/3001 süreçleri bu yüzden otomatik olarak yeni binary'ye geçmiş sayılmaz. Mevcut root Compose/DB volume'leri değiştirilmedi. Bu teslim commit/push içermez.

## 2. Dosya bazında değişiklikler

| Dosya | Neden / son davranış |
| --- | --- |
| `apps/api/src/roads/valhalla-adapter.ts` | 30 m istek korunur. Yalnız Valhalla'ya özgü `-500`/`-32768` → null; no-data/sampling/sürüm uyarıları; kaynak sürümü. |
| `apps/api/src/roads/normalize-road.ts` | Kalite modelled/unknown; genel negatif rakım cutoff'u kaldırıldı. Bilinen örnek yanında no-data varsa sınır ayrılır; bilinen tam aralık korunur. Gain/loss, geometri, zaman ve ham düğümler korunur. Normalizer 1.2.0. |
| `apps/api/src/roads/elevation-qa.ts` | Saf, değişmez girdili 30/150/300 m pencere QA; tekrar/çelişki/eksik örnek, coverage, zıplama/eğim ve bilanço. Enerjiye uygulanmaz. |
| `apps/api/src/roads/road-policy.ts` | Self-hosted/external ayrımı; eski loopback override açık iç safety ceiling olarak korunur. Dış limit 100 ve production kamu demo/Overpass engeli korunur. |
| `apps/api/src/roads/road-source-policy.ts` | Endpoint bazlı iç budget namespace; graf/DEM/engine/build cache revizyonu; unknown provenance. |
| `apps/api/src/roads/road-client.ts` | Aynı PG tablolarıyla ayrı iç kapasite ve dış günlük kota; null günlük sınır desteği; HMAC/lease/fencing/backoff devam eder. Dış sağlayıcı kayıtları sıfırlanmaz. Sürüm ayarı olmayan dış sağlayıcıların eski cache kimliği korunur. |
| `apps/api/src/roads/provider-ports.ts`, `road-service.ts` | İç trip sourceVersion isteğe bağlı; mevcut public SourceReference.version hem rota hem preview'da taşınır. |
| `packages/shared/src/contracts/road-weather.ts` | Profil null ise gain/loss null ve kalite unknown/eksik olmalı. Optional kalite ve eski unknown-confidence numeric profiller kabul edilir; unverified enerji politikası değişmez. |
| `apps/api/src/energy/energy-engine.ts` | Engineering modunda modelled yükseklik için mevcut assumption yanında warning. Fiziksel denklemler/grade/regen değiştirilmedi. |
| `apps/api/src/energy/__tests__/energy-engine.spec.ts` | Eski eksik-DEM fixture'ı profili kaldırırken verified etiketini bırakıyordu; unknown olarak düzeltildi. |
| `apps/api/src/roads/__tests__/elevation-hardening.spec.ts`, `elevation-test-fixture.ts` | Sentineller, negatif kot, partial/no-data, Zod/legacy, gerçek enerji politikasına geçiş ve QA invariants. Tamamen sentetik küçük profil. |
| `apps/api/src/roads/__tests__/road-source-policy.spec.ts`, `road-cache.integration.spec.ts` | Aynı/farklı endpoint, Overpass ayrımı, eski override, graph/DEM cache değişimi, dış kotanın korunması. Gerçek izole PG şeması. |
| `apps/api/src/roads/__tests__/valhalla-artifacts.spec.ts`, `.gitignore` | PBF/HGT/GPH/tar ve yerel pilot klasörleri Git dışında; altyapı kaynakları dahil edilebilir. Kalıcı git-ignore regresyonu. |
| `apps/api/scripts/smoke-valhalla-dem.ts` | Yalnız loopback status/height/raw 30/300 + geçici API → 8003 source/kalite/bilanço doğrulaması; public endpoint veya aktif 3000/3001'e değişiklik yok. |
| `infra/valhalla/compose.dem.yaml` | Ayrı proje/8004, image 3.9.1, salt okunur hazır dataset, doğrudan serve, ayrı isteğe bağlı build profili, healthcheck ve 2 CPU sınırı. |
| `infra/valhalla/smoke.ps1`, `README.md`, `.env.example`, `manifest.example.json` | PowerShell 5.1 tek satırlık komutlar; port/mount/build/start/rollback ve veri provenance taslağı. Gerçek lisans/hash yerine unknown/null. |
| Kök `.env.example` | Yeni kurulum için pasif self-hosted 8004 örneği ve sürüm/safety alanları; çalışan `.env`'e uygulanmadı. Geoapify anahtarı örnekte boş/opsiyonel kalır. |
| ADR/görev, ROAD_PROVIDERS, TASKS, V1_RELEASE_BACKLOG, mimari/belge indeksi | Yeni yön/tarihsel ADR ayrımı, teslim ve açık kabul kapıları. |
| `data/validation/valhalla-dem-manual-observation.json`, `valhalla-dem-live-smoke.json` | Manuel gözlem ile bu teslimin canlı smoke kanıtı ayrılır; lisansı incelenmemiş ham DEM verisi commit edilmez. |

Başlangıç kopyaları ignored `artifacts/valhalla-hardening/baseline` altında. Bu kopyalardan mevcut kaynaklara fark `artifacts/valhalla-hardening/task-source.diff` dosyasında saklanır. HEAD diff'inin önceki görev değişikliklerini de içerdiği unutulmamalı; bu tablo bu görevin kapsamıdır.

## 3. Teknik kararlar / public uyumluluk

- **No-data:** Valhalla 3.9.1 [graphconstants.h](https://github.com/valhalla/valhalla/blob/3.9.1/valhalla/baldr/graphconstants.h) `kNoElevationData=-500`; [Skadi sample.cc](https://github.com/valhalla/valhalla/blob/3.9.1/src/skadi/sample.cc) `NO_DATA_VALUE=-32768`. Kesin sağlayıcı değerleri adaptörde elenir; genel `<=-499` veya `<=-32000` eşiği yoktur. Diğer sağlayıcıdaki -500 ve geçerli negatif rakımlar korunur. Araya giren null üzerinden enterpolasyon yapılmaz. Kaynakta no-data'nın sayısal enterpolasyonla gizlenmiş olması yine QA/saha riski; tüm hataların çözüldüğü iddia edilmez.
- **Kalite:** Normalizer tam kullanılabilir DEM parçasını `modelled`, eksik parçayı `unknown/null` çıkarır; hiçbir durumda kendi kendine `verified` üretmez. Sabit verified-değil uyarısı yalnız modelled veri olduğunda eklenir; tamamen eksikte missing/no-data uyarıları vardır. verified-only gerçek enerji motorunda `ELEVATION_NOT_VERIFIED`, izin verilmeyen eksik profil `ELEVATION_MISSING` olur. Açık engineering politikasında assumption/warning kalır; mevcut açık flat-fallback politikası gevşetilmez.
- **30 m ve 300 m:** Ham 30 m ve gerçek ara yükseklikler enerji girdisi olarak korunur. QA her benzersiz örnek mesafesi s için `100*(h(s+w)-h(s))/w` hesaplar; w=30/150/300. Uçlar lineer enterpole edilir, tam s+w pencereleri kullanılır; son kısım için kısmi pencere üretilmez. Eksik/çelişkili düğümden geçen pencere hesaplanmaz. Aynı mesafe+aynı kot tekilleştirilir; farklı kot null/conflicting olur. %20 üzeri kısa aralık yalnız suspect diagnostiktir; fiziksel hata kanıtı veya hard cap değildir.
- **Kota:** Self-hosted namespace `self-hosted:<provider>:<endpoint hash>`; 3000/3001 aynı endpoint için aynı pacing/backoff'u paylaşır. Farklı 8002/8003 iç kapasitesi ve dış providerId kotası ayrılır. İç serviste varsayılan günlük kredi sınırı yok; mevcut 1,1 sn pacing, admission, iş/HTTP sınırları devam eder. İstenirse iç günlük safety ceiling; legacy non-production loopback override buna uyarlanır. Overpass kamu günlük 100 limiti aynı kalır. Bu kapasite/throughput kabulü değildir.
- **Cache/provenance:** Graf, DEM, engine ve build/cache revision HMAC namespace'inde yer alır. Kaynak version engine/graph/dem ve build etiketinin kısa hash'ini taşır; bu hash veri checksum'u değildir. Bilinmeyen graph/DEM `unknown`; veri yenilemede operator namespace değiştirmelidir, otomatik disk değişim algılaması yoktur. Bilinmeyen sürümle aynı endpoint kullanılırsa en fazla mevcut 1 saat TTL boyunca stale riski açık kalır. Fencing ve ayrı policy'den bağımsız aktif lease korunur.
- **Public API:** RoutingProvider ve HTTP field yapısı değişmedi, yeni zorunlu alan yok, DB migration gerekmedi. Mevcut optional `elevationQuality` ve nullable SourceReference.version kullanılıyor. Önceden doğrulanmış sayılıp profili null olan çelişkili payload artık Zod'da reddedilir; legacy kalite alanı olmayan ve unknown-confidence numeric profiller kabul edilir. Bu güvenlik invariant'ı sözleşme testleriyle gerekçelendirildi. Yeni fastest/shortest/preference alanı eklenmedi.

## 4. Kanıt düzeyleri ve metrikler

**manual_observed:** Kullanıcının terminal gözlemleri [ayrı küçük kayıtta](../../data/validation/valhalla-dem-manual-observation.json). Bağımsız saha gerçeği veya sabit golden rota değildir.

**deterministic_fixture:** Sentetik 60 m Valhalla cevabı ve test içi mesafe/kot profilleri; sentinel, negatif rakım, null geçişi ve 30/150/300 QA. 909→1001,3→891,4 gibi sayılar yalnız 92,3−109,9=−17,6 aritmetiğini sınar; gerçek yolun sentetik şekli ölçülmüş diye sunulmaz. Graf değiştiğinde canlı rotanın bu sayılara zorlanması gerekmez.

**live_smoke:** [Son yeni-kod API raporu](valhalla-dem-live-smoke.json). A=(39,9;32,8), B=(39,91;32,8). Engine 3.9.1, graph/DEM sürümü ve DEM lisansı unknown. Yeni kod geçici API **53087** üzerinden gerçek `source.url=http://127.0.0.1:8003` döndürdü; çalışan 3001'in eski kodu bu kanıt yerine kullanılmadı.

| Metrik | Ölçülen |
| --- | --- |
| Mesafe / normalize kesim | 4.407 m / 72 |
| 30 m ham / karşılaştırma 300 m ham | 148 / 16 örnek |
| Normalize profil girişleri / tekilleşmiş QA | 229 / 158; 71 aynı sınır tekrarı |
| Min / max rakım | 868,1 / 911,2 m |
| Tırmanış / iniş / net | 92,3 / 109,9 / −17,6 m |
| Bilanço hatası | 0 m; yalnız iç tutarlılık |
| 30 / 150 / 300 m maksimum mutlak QA eğimi | %31,333 / %15,533 / %7,033 |
| Orijinal noktalarda /height | 905 / 890 m |
| No-data / kalite | 0 / modelled |
| Ham süre / normalize süre | 463,297 / 467,238 sn; mevcut hız sınırına göre süre uzlaştırma uyarısı korunur |

Orijinal noktalar ile snap edilmiş yol profilinin uç rakımları aynı şey değildir. Aynı SRTM ailesinden iki servisin eşleşmesi bağımsız yol kotu doğrulaması değildir. %31,3 kısa eğim otomatik düzeltilmedi. Mevcut standart route costing, alternatif sayısı/arama, use_distance, şarj/EV optimizasyonu değiştirilmedi.

Yeni Compose ayrıca boş 8004 portunda `chargeroad-dem-hardening-check` projesiyle başlatıldı: health **healthy**, mount **RW=false**, gerçek height/route smoke PASS, 4,407 km ve 148 örnek. Bu testten sonra **yalnız bu yeni container durduruldu**, silinmedi. Eski 8002/8003/DB/OrderLane çalışmayı sürdürdü. Hazır grafla serve tekrar üretildi; sıfırdan ülke build'i bu kanıt değildir.

[Son runtime kontrolü](valhalla-dem-runtime-preserved.json): 3000/3001 ready 200, mevcut dört konteyner running; yalnız görevin yeni doğrulama container'ı exited.

## 5. Çalıştırılan doğrulamalar

| Komut | Nihai sonuç |
| --- | --- |
| `pnpm --filter @chargeroad/api typecheck` | PASS |
| `pnpm --filter @chargeroad/api test` | PASS: 484; SKIP: 146 DB testi (TEST_DATABASE_URL bu komutta tanımlı değil), 40 grup geçti / 13 atlandı |
| `pnpm --filter @chargeroad/api test:db` | PASS: **630/630**, 53 grup; SKIP yok; gerçek izole PG şemaları |
| `pnpm --filter @chargeroad/api build` | PASS; mevcut API'lere restart uygulanmadı |
| `pnpm --filter @chargeroad/shared test` | PASS: 41 |
| `pnpm -r typecheck` | PASS: shared/API/mobile |
| `docker compose -p chargeroad-dem-hardening -f infra/valhalla/compose.dem.yaml config --quiet` | PASS; statik doğrulama |
| `powershell.exe -NoProfile -File infra/valhalla/smoke.ps1 -BaseUrl http://127.0.0.1:8003` | PASS |
| Aynı PowerShell smoke, yeni izole 8004 | PASS; serve/read-only gerçek testi |
| `pnpm --filter @chargeroad/api exec ts-node scripts/smoke-valhalla-dem.ts` | PASS; yeni API kodu → 8003; rapor JSON |
| Sıfırdan PBF→Türkiye graf/DEM build | SKIP: ağır kaynak/ağ işi; mevcut veriyi yeniden üretmek veya lisansı belirsiz dosyaları indirmek otomatik yapılmadı |

İlk denemelerde bir TypeScript flatMap çıkarım hatası ve partial DEM aralığının kaybı yakalanıp düzeltildi. İlk tam testte **1 FAIL**: eski fixture profili null yaparken `verified` bırakıyordu; `unknown` düzeltmesi sonrası tam testler geçti. İlk dar test komutunun pnpm flag ayrıştırması reddedildi; `run test --testPathPattern=...` ile düzeltildi. Bekleyen test hatası gizlenmedi; yukarıdaki sonuçlar son kod içindir. Testlerde görülen fail-closed rate-limit log'u kontrollü regresyon senaryosudur, çalışan API arızası kanıtı değildir.

## 6. Açık kabul kapıları / sonraki bağımsız iş

V1-ROAD-003/004/005 **IN_PROGRESS**: DEM gerçek ürün/kaynak/sürüm/lisans/datum manifesti, tam veri hash'leri, bağımsız yol/saha kotu doğrulaması, sıfırdan ülke build RAM/disk/süre ölçümü, geniş rota/yön örneklemi ve üretim kapasite/yenileme/rollback provası açık. Runtime image version sabit; bit düzeyinde tekrar üretim için imaj digest'i ve dataset manifesti tamamlanmalı. Canlı trafik, MapLibre/native cihaz kabulü, GPS/TTS, gerçek SOC/şarj hatası ve üretim SLA'sı bu teslimde doğrulanmadı. Kamu servisine yük testi ve ücretli bulut kaynağı açımı yapılmadı.

**Sonraki görev başlığı:** Alternatif yol adayları ve EV rota optimizasyonu. **Bağımlılıklar:** bu kalite/cache temeli; sürümlü graf/DEM manifesti; rota kıyas fixture'ları ve ayrı onaylı amaç/kabul ölçütleri. Bu teslimde kodlanmadı.
