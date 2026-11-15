# CR-PERF-001 — Performans ölçüm temeli

Tarih: 2026-11-13. Kapsam: yalnız CR-PERF-001. **Sonraki görev için GO; üretim/saha kabulü değildir.**

## Başlangıç ve davranış

Başlangıç HEAD: `c24cab249dc3cbebb29f11104fee95c04ca8d7fd`; çalışma ağacı temiz ve `origin/main` ile aynıydı. Kullanıcının üç belgesi tamamen incelendi; 14 görev bağımlılık sırasıyla ayrıldı. [Ana plan](../tasks/performance/00-ANA-PLAN.md) ve [toplu kaynak](../tasks/performance/99-TUM-GOREVLER.md) özgün planın kopyalarıdır; güncel teslim durumu bireysel görev dosyalarında izlenir.

Üretim koduna dokunmadan önce API/DB: **53 suite, 630 test PASS, 0 skip**. Ardından ağsız before ölçümü alındı. Mevcut golden/reference fixture'lar değiştirilmedi.

Yeni altyapı `AsyncLocalStorage` ile istek kapsamına bağlı süre ve sayaç toplar. Yeni bağımlılık, migration, endpoint veya telemetry servisi yok. Public DTO, plan politikaları, frontier sırası, fiziksel kontroller, veri kalite anlamları, lisans/kota/Retry-After, PostgreSQL lease/fencing ve iş sahipliği korunur. Algoritmik hızlandırma yapılmadı; CR-PERF-002–014 başlamadı.

Ölçüm açık/kapalı karşılaştırması üç amaç modu için tam sonuç, replay ve plan doğrulamasını karşılaştırır. Yalnız zaten değişken olan `elapsedMilliseconds` karşılaştırmadan çıkarılır. JSON/gzip testi aynı girdide byte eşitliğini doğrular. HTTP ve iş sonucu testleri metriklerin public cevaba eklenmediğini doğrular.

## Metrik sözleşmesi

`PLANNING_METRICS_ENABLED=false` varsayılandır. Açılınca Nest Logger'a `planning_metrics`, `planning-metrics/1.0.0` sürümlü bir aggregate kayıt yazılır. Request ID UUID olarak doğrulanır; alan/evre/sayaç adları sabittir. Ham hata/sonuç/parametre, kullanıcı kimliği, SOC, koordinat, polyline, IP, URL, token veya secret kayda aktarılmaz. Algoritma sürümleri mevcut sabitlerden alınır. Kapalı kök çağrı aynı operation Promise'ını döndürür; bağlam/timer/kayıt oluşturmaz. Sink hatası iş sonucunu değiştirmez.

| Ölçüm | Anlamı |
|---|---|
| `vehicle_profile`, `base_road`, `station_corridor` | Mevcut hazırlık port çağrılarının süreleri; iki aşamalı profil okuması ayrı tamamlanma sayılır. |
| `road_leg_acquisition`, `road_leg_acquisitions` | Session cache miss sonrasında gerçekten çağrılan yol portu; HTTP sayısı değildir. |
| `road_session_cache_hits`, `weather_session_cache_hits` | Plan içindeki mevcut cache dönüşleri. |
| `weather_sampling`, `weather_sample_queries` | Gerçekte örneklenen hava sorguları; cache hit öncesindeki tekrar örneklemeler dahil. |
| `weather_acquisition`, `weather_forecast_query_items` | Hava portunda geçirilen süre ve gönderilen query sayısı. |
| `energy_evaluation`, `charge_integration` | Gerçek motor çağrılarının süre/sayısı; elenen arama dalları da dahildir. Son plandaki durak sayısı değildir. |
| `optimizer_search`, `frontier_peak` | Mevcut çözümleme süresi ve gözlenen en büyük frontier; veri yapısı değiştirilmedi. |
| `expanded_states`, `transitions`, `*_queries_budgeted` | Mevcut `OptimizerSearch` sonucundan kopyalanır; ikinci bir bütçe veya tahmini HTTP sayacı oluşturulmaz. |
| `road_http_acquisitions`, `weather_http_acquisitions`, `*_http` | Gerçek `fetch` denemesi; başarısız cevaplar da dahil. Süre body okuma/parse'ı kapsar; HTTP öncesi PG/lease/pacing beklemesi bu evrede değildir. |
| `*_pg_cache_hits/misses`, `*_cache_coalesced*` | Mevcut cache/lease noktalarından istek kapsamına yansıtılır; global sayaçlardan fark alınmaz. Road miss ilk okumadır; lease bekleyerek bulunan cevap ayrıca coalesced hit'tir. Weather miss ve sonraki PG hit aynı edinimde birlikte görülebilir. |
| `weather_cache_acquisition` | Yeni pending ediniminin PG/lease/pacing/HTTP dahil ömrü. Aynı işi paylaşan isteklerde edinim/HTTP ilk sahibine, paylaşım sayacı katılan isteğe aittir. |
| `plan_compile` | Mevcut derleme/doğrulama süresi; aramanın içinde birden çok adayda çalışabilir. |
| `response_preflight_serialize`, `json_serialize`, `gzip` | Mevcut boyut kontrolü serialization'ı ile encoder serialization/compression ayrı ölçülür. Yeni serialization eklenmedi. Küçük response gzip eşiğini geçmezse gzip evresi yoktur. |
| `response_decoded_bytes`, `response_wire_bytes` | Encoder'ın hazırladığı UTF-8 JSON ve gönderilecek body boyutu; HTTP header/TLS ve istemciye teslim süresi dahil değildir. |
| `http_plan` | HTTP service içindeki planlama; dış `durationMs` controller'daki encoding ve send çağrısını da kapsar. Socket/istemci son bayt süresi değildir; admission/guard süresi bu kapsamdan öncedir. |
| `job_wait`, `job_execute` | DB `created_at` → claim sırasında DB `clock_timestamp()` farkı ve claim sonrası execution/finish süresi. Reclaim'de job_wait önceki denemelerin yaşını da içerir; yalnız son queue beklemesi olarak yorumlanmaz. |
| `cancelled`, `timeout`, `outcome` | İptal/deadline gözlemleri; iş sonucu değiştirilmez. Alanlar plan/HTTP/job kapsamı ile birlikte okunur. |

Evreler **inclusive** sürelerdir. `totalMs`, aynı evrenin tamamlanmış çağrılarının toplamı; `maxMs` en uzun tamamlanmış çağrı; `count` tamamlanma sayısı; `active` kapanmamış çağrı sayısıdır. Üst/alt ve eşzamanlı evreler toplanıp wall time hesaplanamaz. Örneğin search enerji/şarj/compile'ı kapsar. `job_wait` dışarıdan gözlenen yaştır ve execution wall time'ın parçası değildir.

Kök çağrı bittiğinde kayıt kapanır. Caller iptalinden sonra ortak hava cache işi sürebilir; kapanışta aktif evre varsa `incomplete:true` olur. Daha sonraki yazılar reddedilir; böyle bir kaydın HTTP sayısı/tam süreleri bütün detached işlerin toplamı sayılmaz. Nested çağrılar tek kayda katılır. Async job execution ve sonucun GET ile kodlanması aynı requestId altında **ayrı scope/kayıtlardır**; körlemesine toplanmamalıdır.

## Tekrarlanabilir ağsız baseline

Makine: Windows `10.0.26200`, x64, Intel i7-12700H, 20 logical CPU, 16.87 GB fiziksel RAM; Node `v26.13.0`. Tüm ölçümlerde aynı HEAD; after/instrumented çalışma ağacı bu görevin değişikliklerini içerir. Dosya bazında source checksum'ları JSON artefaktlarda mevcuttur.

Her senaryo 100 ölçüm + 5 JIT warmup, concurrency 1. Gerçek optimizer/enerji/şarj motorları ve encoder kullanılır; sağlayıcılar mevcut `optimizerWorld(false)` in-memory fixture portlarıdır. Her iterasyonda yeni session kurulur; PostgreSQL/HTTP yoktur. Synthetic Date `2026-11-13T09:00Z` değerine sabit, monotonic timer ve process CPU gerçektir. Fixture kurulum/checksum maliyeti plan latency aralığının dışında; plan + runtime envelope validation + encoder içeridedir. Bu bir gerçek yolculuk veya tam HTTP uçtan uca gecikmesi değildir.

| Senaryo | Sürüm | p50 ms | p95 ms | p99 ms |
|---|---|---:|---:|---:|
| Şarjsız sonuç | Before | 27.589 | 33.941 | 43.632 |
| Şarjsız sonuç | After, metrik kapalı | 28.781 | 37.036 | 41.281 |
| Şarjsız sonuç | After, metrik açık | 31.706 | 40.608 | 60.763 |
| İki kısmi şarj | Before | 33.142 | 37.604 | 42.496 |
| İki kısmi şarj | After, metrik kapalı | 34.342 | 37.845 | 43.854 |
| İki kısmi şarj | After, metrik açık | 35.912 | 39.409 | 44.347 |

Gözlenen artışlar gizlenmedi. Bunlar birer process koşusudur; JIT/GC ve paylaşılan makine etkilerinden bağımsız bir overhead yüzdesi veya hızlanma iddiası çıkarılmaz. Açık ölçüm in-memory sink kullanır; gerçek logger/collector I/O maliyeti **ölçülmedi**. Varsayılan kapalı kalır. Sonraki optimizasyonlar bu baseline'ı aynı koşullarda karşılaştırmalıdır.

| Senaryo | Fixture SHA-256 | Sonuç SHA-256 |
|---|---|---|
| Şarjsız | `156383abf6d55765603ec0e6e32041651ce88664194baafd597fac350664a784` | `6a93e46fd9010b87d5088fbbcb3186fe44406f48a29c2bc9ac09dd3379c22d44` |
| İki kısmi şarj | `b323ad1a38a2ba3a984f4a222b965eb79f706bc1d268cb1782238216d7c508a9` | `bab6af3e25ac2806edf48023e5cf6afba8248c32f11fab070307424b8a6a8197` |

Her üç koşuda fixture, normalize sonuç ve normalize public envelope checksum'ları aynıdır. Fixture checksum request/vehicle/candidates/preparation/options/tüm yönlü fixture yollarının JSON hash'idir. Sonuç hash'inde yalnız `elapsedMilliseconds` hariçtir. Kaynak dosya checksum'ları UTF-8 içeriğin `JSON.stringify` gösteriminin SHA-256'sıdır; raw-file SHA değildir. Factory checksum: `73d7769661fedc1de9b29c03f27af4c8de38370476798d73c44ab9ca3385453c`. Percentile mevcut `validation/metrics.ts` nearest-rank yardımcısıyla hesaplanır; başlangıç harness'ının aynı matematiği sonrasında bu yardımcıya bağlandı.

Yanıtlar gzip eşiğinin altında: şarjsız 11,751 byte; iki durak 16,284 before / 16,283 after byte. Tek byte farkı normalize edilmeyen süre alanının JSON yazımıdır; normalize response hash'leri aynıdır. Büyük cevap için gzip ayrıca unit testte doğrulanır.

CPU ve RSS ayrıntıları artefaktlarda bulunur. CPU tüm grup + fixture kurulum/checksum + warmup kapsamındadır; saf motor CPU'su değildir. RSS process'in örneklenen değeridir; işletim sistemi gerçek peak ölçümü değildir. Before gruplarında CPU user/system 3937/187 ve 4141/156 ms; after kapalı 4187/313 ve 4125/109 ms; açık 4844/250 ve 4563/125 ms. Örneklenen peak RSS sırasıyla 663.9/800.2, 663.6/801.3, 670.4/808.9 MB; iki senaryo aynı process'te ardışık çalışır, dolayısıyla ikinci senaryo temiz bellek başlangıcı değildir.

### Evre dağılımı örneği

Açık ölçümde her planın aynı evreye ait `totalMs` değeri üzerinden 100 örnekli p95 (ms):

| Evre | Şarjsız | İki kısmi şarj |
|---|---:|---:|
| optimizer_search | 39.155 | 38.437 |
| energy_evaluation | 18.422 | 19.936 |
| charge_integration | 12.206 | 11.212 |
| plan_compile | 2.361 | 1.711 |
| weather_acquisition | 1.319 | 0.992 |
| road_leg_acquisition | 0.346 | 0.201 |
| json_serialize | 0.105 | 0.126 |

Diğer evrelerin p50/p95/p99 dağılımları instrumented JSON'da. 100/100 kayıt tamamlanmış, `incomplete:0`. Bu sentetik işte search/motor maliyetleri baskındır; gerçek sağlayıcıda aynı dağılım varsayılamaz. Şarjsız **sonuç** araması da alternatif şarjları değerlendirir: 39 charge integration, 68 energy evaluation, 15 expanded state, 107 transition, frontier peak 11. İki durakta 56/88/10/154 ve peak 8. HTTP ve PG sayaçları iki senaryoda da sıfırdır; bu ölçülmüş fixture davranışıdır, gerçek servis cache hit iddiası değildir.

Artefaktlar: [before](perf-baseline-2026-11-13-before.json), [after kapalı](perf-baseline-2026-11-13-after.json), [after açık](perf-baseline-2026-11-13-instrumented.json).

## PostgreSQL ve sağlayıcı ölçümlerinin ayrımı

İzole PG + gerçek loopback HTTP fixture entegrasyonları hem road hem weather için cold miss → 1 fetch, warm hit → 0 fetch doğruladı. Var olan global sayaçlarla tutarlılık da test edildi. Bu servisler sentetik HTTP yanıtı verir; gerçek harita/hava kapsamını kanıtlamaz.

Ayrıca açık opt-in ile mevcut yerel `8003` Valhalla servisine iki kısa, ardışık Ankara diagnostic sorgusu yapıldı. Yeni cache revision namespace kullanıldı; ortak cache/bütçe tabloları temizlenmedi, pacing/quota/lease korumaları çalıştı. Overpass kapalıydı. Kaynak indirilmedi, Docker servisleri değiştirilmedi. [Gerçek yerel örnek artefaktı](perf-baseline-2026-11-13-local-provider.json):

| Durum | n | Wall ms | PG hit/miss | Gerçek HTTP |
|---|---:|---:|---|---:|
| PG cache cold | 1 | 1522.160 | 0 / 2 | 2 |
| PG cache warm | 1 | 6.433 | 2 / 0 | 0 |

Cold HTTP evre toplamı 319.697 ms; wall time'ın kalanı PG, pacing ve normalizasyon dahil farklı işlerdir. İki sonucun checksum'ı eşit: `3ef28fda49b519aa42386ad072b560a9b2fb8873ba6b89bb44304984a2e595fb`. n=1 olduğu için p50/p95/p99 **raporlanmadı**. Cold yalnız PG namespace'ini tanımlar; Valhalla/OS disk cache'i unknown. Bu tam EV/şarj planı değildir. Kaynak sürümündeki engine/graph/DEM unknown ve modelled kalite etiketleri korunur; manifest, DEM lisans kabulü ve saha doğrulaması açık kalır. Public/yönetilen sağlayıcı yük testi **NOT_RUN**; gerçek hava sağlayıcısına yeni çağrı yapılmadı.

## Tekrar çalıştırma

Repo kökünden (yerel Node/pnpm PATH üzerinde):

```powershell
pnpm --filter @chargeroad/api exec ts-node scripts/benchmark-planning-perf.ts --phase=after --samples=100
pnpm --filter @chargeroad/api exec ts-node scripts/benchmark-planning-perf.ts --phase=instrumented --samples=100
# İsteğe bağlı: hazır yerel PG + Valhalla; 2 kısa sorgu, public provider değil.
pnpm --filter @chargeroad/api exec ts-node scripts/benchmark-provider-cache-perf.ts --allow-local-provider-smoke --endpoint=http://127.0.0.1:8003
```

Bu komutlar aynı isimli artefaktı yazar; saklanacak eski sonucu önce ayrı dosyada koruyun. Tarihsel `before` artefaktını güncel kodla yeniden üretip eski ölçüm diye etiketlemeyin. Tarihsel before production kaynak checksum'ları eski HEAD'e, after checksum'ları bu değişikliklere aittir. Fixture ID/epoch ve 100 örnek aynı tutulmalıdır. Benchmark alternatif logger maliyetini ölçmez. Yerel provider scripti sadece loopback HTTP'ye izin verir; `.env` anahtarlarını yazdırmaz.

## Değişen alanlar

- `apps/api/src/observability/`: bounded istek bağlamı, izolasyon/gizlilik/hata testleri, tam plan eşdeğerliği ve PG/loopback cache kanıtı.
- `planning/{ev-planning.service,planning-session,charge-stop-optimizer,plan-compiler}.ts`: mevcut çağrılara timer/counter dokunuşları; mevcut solve/motor algoritmaları aynı.
- `planning/http/{planning-http.service,planning.controller,planning-response,planning-jobs.worker,planning-jobs.store}.ts`: HTTP/codec/queue ölçümleri; claim dönüşüne iki zaman alanı, ek sorgu/şema yok.
- `roads/road-client.ts`, `weather/{weather-http,weather-cache}.ts`: gerçek fetch/cache noktalarında gözlem.
- Mevcut `planning-{http,jobs}.integration.spec.ts`, `planning-response.spec.ts`: flag açık sözleşme/gzip/sahiplik kontrolleri.
- `apps/api/scripts/benchmark-{planning-perf,provider-cache-perf}.ts`: ağsız baseline ve ayrı opt-in yerel smoke.
- `.env.example`, görev kopyaları, belge indeksleri ve bu rapor/JSON kanıtları.

Mobil/shared üretim kodu, dependency/lockfile ve SQL migration dosyaları değişmedi.

## Test kapısı

| Komut / kontrol | Sonuç |
|---|---|
| Başlangıç `pnpm --filter @chargeroad/api test:db` | PASS: 53 suite / 630 test, skip 0 |
| Son `pnpm --filter @chargeroad/api test:db` | PASS: 56 suite / 646 test, skip 0, 67.58 s; unit ve gerçek izole PG entegrasyonları birlikte |
| `pnpm -r typecheck` | PASS: shared, API, mobile |
| `pnpm --filter @chargeroad/shared test` | PASS: 41, skip 0 |
| `pnpm --filter @chargeroad/mobile test` | PASS: 21, skip 0 |
| `pnpm --filter @chargeroad/api build` | PASS |
| Sentetik before / after kapalı / açık | PASS: her koşuda 2 × 100 örnek, input/result/envelope checksum eşit |
| Gerçek yerel Valhalla cold/warm | PASS: 1+1 örnek; kapsam yukarıda |
| Mobil export/cihaz/GPS saha kabulü | NOT_RUN: mobil kod değişmedi; bu görev ölçüm altyapısıdır |
| Public/yönetilen provider yük testi | NOT_RUN: bu görevin kapsamı ve kota politikası gereği |

## Açıklar, geri dönüş ve karar

Tam İstanbul–Ankara planının gerçek sağlayıcılı p95/p99'u, gerçek logger overhead'i, mobil cihaz FPS/batarya ölçümü ve saha doğruluğu bu teslimde kanıtlanmadı. Yerel n=1 örnek bu eksikleri kapatmaz. Önceki [Valhalla/DEM kabul açıkları](valhalla-dem-hardening-2026-11-12.md) korunur. Bu görev bir rota bugfix veya üretime hazır olma iddiası değildir.

İşletim geri dönüşü: `PLANNING_METRICS_ENABLED=false` ile sonraki normal süreç başlatımında ölçümü kapatın. Mevcut çalışan API/Expo/Docker süreçleri bu görevde yeniden başlatılmadı; gerçek `.env` değiştirilmedi. Kalıcı şema/veri dönüşü yoktur. Gerekirse yalnız bu görevin kod/doc değişikliklerini küçük bir revert ile geri alın; ortak DB/cache/bütçeleri silmeyin, diğer çalışma dosyalarını resetlemeyin.

CR-PERF-002 için **GO**: karşılaştırılabilir ölçüm, mevcut sözleşmeleri koruyan eşdeğerlik testleri ve gizlilik sınırları hazır. Bu onay yalnız sonraki görevin önkoşuludur; görev 2 koduna geçilmedi.
