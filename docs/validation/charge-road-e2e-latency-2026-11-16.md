# CR-LAT-001 — Uçtan uca planlama gecikmesi teşhisi

2026-11-16 · **Teşhis ve yeni latency semantic testleri PASS; tam API regresyonu FAIL (3 timeout); polling prototipi NO-GO; üretim davranışı değişmedi.** CR-PERF-007 başlamadı. İlk ve tek A/B hipotezi sonrası yeni optimizasyon denenmedi.

## Koruma manifesti, ardından değişen dosyalar

HEAD bf41840856a6e3c275665f8571483e9080cd7a3d. Başlangıç dirty içerik esas alındı: **609 kaynak/kanıt dosyası** için raw SHA-256, status ve dirty diff hash [start.json](latency-2026-11-16/start.json). Manifest tracked/untracked nonignored dosyaları kapsar; env/çalışan runtime logları, dist/node_modules bu kaynak listesi değildir. Önceki 001–006 raporları/golden/benchmark'lar korunur. Reset/clean/stash/checkout/commit/push, lockfile/env dosyası değiştirme, kullanıcı Docker/Valhalla/Expo süreci kapatma veya cache/volume silme yok.

Mevcut değişiklikler: API planning-jobs.integration.spec.ts'ye native mobil→HTTP→PG→worker→solver semantic/ölçüm testi; docs/TASKS'e CR-LAT-001 kapanışı. Yeni dosyalar: scripts/benchmark-polling-latency.cjs, validation/latency-poll-pilot.ts, latency-polling.spec.ts ve rapor/JSON kanıtları. **Production mobile planning.ts, controller/store/worker, core optimizer, roads/weather/energy/charging, auth/rate-limit, DTO/Zod, DB schema ve env aynı kaldı.** 002 sort+shift; 003/004 shadow; 005/006 aktif cache/index yok.

## Temel bulgu: yavaş iki geçmiş işte weather acquisition baskın

Salt okunur BEGIN READ ONLY / SELECT 1 ve aggregate job sorgusu PASS. O anda tutulan son-24-saat job geçmişi ve geçerli queued/running satırı yoktu; bu queue kapasitesinin iyi olduğu kanıtı değildir. Servis başlatılmadı, retained/private job verisi seçilmedi. Mevcut runtime dosyasında **8 planning_completed ve 13 planning_metrics** kaydı bulundu; requestId'ler yalnız bu teşhis kapsamındaki hash ile eşleştirildi. İki planned örneğin job_execute süreleri **28,687 s /85,086 s**; server planning_completed logları **28,554 s /84,832 s** (logger ve root scope sınırı farklı).

**Bu iki gözlemde en büyük ölçülen awaited edinim weather_acquisition: 18,624 s /72,148 s.** Queue wait 473 /229 ms, energy yaklaşık 2,76 /2,74 s, charging 292 /166 ms. Polling en fazla bir sonraki GET'e kadar ek teslim beklemesi yaratır; 28–85 saniyelik sunucu işini tek başına açıklamaz. Bu iki rota/araç/cache koşulu eşlenmiş değil; birbirine göre hızlanma yüzdesi çıkarılmadı. Arşiv kaynak/runtime hash'i kayıtlıdır fakat geçmiş deploy'un tam kaynak/env/graph revizyonu kanıtlanmadığı için güncel provider A/B kabulü **NOT_COMPARABLE**.

| Server stage (inclusive ms) | Daha kısa planned iş | Daha uzun planned iş |
|---|---:|---:|
| job_wait | 473.000 | 229.000 |
| job_execute | 28687.455 | 85086.110 |
| http_plan | 28616.654 | 84944.046 |
| vehicle_profile | 7.279 | 20.468 |
| base_road | 271.835 | 511.872 |
| station_corridor | 371.866 | 508.611 |
| optimizer_search | 27805.280 | 83623.183 |
| weather_acquisition | 18624.247 | 72148.215 |
| weather_cache_acquisition | 35536.849 | 143144.630 |
| weather_http | 4330.376 | 17442.658 |
| road_leg_acquisition | 5023.219 | 7037.598 |
| road_http | 1836.674 | 2290.903 |
| energy_evaluation | 2764.637 | 2743.589 |
| charge_integration | 292.132 | 166.301 |
| plan_compile | 220.371 | 347.166 |

**Bu bir toplama tablosu değildir.** optimizer_search altındaki weather/road/engine aşamaları nested; weather cache edinimleri paralel olabilir. Özellikle uzun işte weather_cache_acquisition toplamı 143 s iken wall 85 s: bunları toplamak veya weather_acquisition−weather_http farkını doğrudan PG wait saymak hatalı olur. weather_http toplamı daha kısa/uzun işte 4,33 /17,44 s; edinim aşaması cache/PG lease/pacing/budget/pending/bekleme/parsing de kapsayabilir. Bu nedenle bütün süre MET Norway ağına atfedilmedi. SQL pool wait/lease/pacing ayrı zamanlayıcıları mevcut arşivde yok: **NOT_MEASURED**.

| Gerçek sayaç ayrımı | Daha kısa iş | Daha uzun iş |
|---|---:|---:|
| road_http_acquisitions | 76 | 88 |
| weather_http_acquisitions | 33 | 128 |
| road_pg_cache_hits | 0 | 0 |
| road_pg_cache_misses | 76 | 88 |
| weather_pg_cache_hits | 1108 | 1275 |
| weather_pg_cache_misses | 33 | 2351 |
| weather_cache_coalesced | 0 | 0 |
| road_session_cache_hits | 74 | 50 |
| weather_session_cache_hits | 57 | 57 |
| weather_forecast_query_items | 34745 | 45220 |
| weather_sample_evaluations | 1141 | 12410 |
| energy_evaluations | 110 | 103 |
| charge_integrations | 372 | 207 |
| expanded_states | 5 | 35 |
| transitions | 130 | 117 |
| frontier_peak | 17 | 3 |
| actual_pruned_states | 0 | 0 |

Port çağrısı, cache read ve physical HTTP farklıdır. PG miss her zaman yeni HTTP üretmez. Bu gerçek HTTP sayıları **geçmiş loglardan**; bu teşhiste dış sağlayıcıya yeni rota/hava isteği gönderilmedi. İki job'da station_corridor count=1 ve optimizer_search count=1: 2/5/10 km'nin her seferinde üç kez çalıştığı hipotezi bu örneklerde doğrulanmadı. Candidate scan=500, seçilmiş=16; corridor stage 372 /509 ms. Stage bir provider çağrısıdır, tek bir SQL statement süresi sayılmaz. Route/trace_attributes HTTP süreleri ayrı etiketlenmemiş; yalnız road_http aggregate ölçüldü. summary.time compute latency olarak kullanılmadı.

Statik, koşullu açıklama: mevcut WEATHER_POLICY minIntervalMs=500, maxConcurrency=2, deadlineMs=30000; weather cache claim provider-state pacing uygular. Aynı provider'da yeni 33 /128 rezervasyon için başlangıçlar arasındaki teorik alt sınır 16 /63,5 s olur. Bu **ölçülmüş pacing süresi değildir**; yalnız sayaç ve koddan çıkan hipotezdir, diğer işler/cache/endpoint koşullarına bağlıdır. 30,024 s maksimum weather_acquisition çağrısı 30 s deadline ile uyumludur; tek başına hangi bekleme nedeninin tetiklendiğini kanıtlamaz. Pacing/limit değiştirilmedi.

## İki kullanıcı KPI'sı ve gerçek headless call-chain

Time-to-first-meaningful-preview-painted **NOT_RUN**. Time-to-validated-final-plan-actually-rendered **NOT_RUN**. Mounted Android/iOS profiler yok; HTTP complete, promise resolve, setState veya Expo export paint diye sunulmadı. UI user-action→POST gap, mobile body parse/Zod ayrı cihaz süreleri, MapCanvas commit/frame/battery ve app-background davranışı **NOT_RUN**. Mobile source ve generation/abort callbacks değişmedi.

Ek baseline semantic testte gerçek mobil planAsync, ephemeral loopback Nest controller, gerçek PG owner/lease/result, worker, PlanningHttpService ve gerçek solver kullanıldı. DB benzersiz test schema/search_path; road/weather/vehicle/station portları synthetic in-memory. Preview transport bilerek 503 ile kesildi; Valhalla veya dış weather çağrılmadı. Tek kullanıcı, **n=1 baseline**, periodic worker yerine POST sonrası manual tick; cold/warm veya gerçek Türkiye yol pilotu değildir.

Aynı Node performance.now saatiyle, module compile zamanı dışlanarak POST start→client response accepted **5082.641 ms**. Finish commit→client response accepted **4350.619 ms**. İstemci/server wall saatleri çıkarılmadı. status_seen doğrudan UI hook'u değil; status parse sonrası /result request başlangıcı güvenli observed proxy'sidir.

| Aynı monotonic timeline, birbirini dışlayan interval | ms |
|---|---:|
| ack_start → ack_body_parse_end | 27.957 |
| ack_body_parse_end → finish_commit | 704.064 |
| finish_commit → status_start | 4311.411 |
| status_start → result_start | 18.850 |
| result_start → client_response_accepted | 20.358 |

Bu beş interval toplamı POST start→accepted süresidir. Worker job_wait yaklaşık 19.000 ms ve job_execute yaklaşık 697.791 ms ikinci intervalin içinde/yanında gözlenir; tabloya yeniden eklenmez. Optimizer 667.458 ms; energy 340.119 ms; charging 203.866 ms; bunlar da inclusive alt-stage'lerdir. Bu synthetic işin süreleri gerçek 28/85 saniyelik rotaların yerine konulmadı.

Gerçek loopback HTTP: **POST ack +1 status GET +1 result GET =3**. Preview API çağrısı transport seviyesinde intercept edildi, fiziksel provider HTTP **0**. Header zamanları network+middleware/SQL/server işlem toplamıdır, saf RTT değildir. Body parse başlangıç/bitişleri JSON'da var; result body sonu→accepted küçük aralık Zod/promise teslimini kapsar ama Zod-only timer değildir. GET/result SQL/read ve encoding/gzip için bu testte ayrı SQL timer yok; response/schema testleri ve correlation guard geçer. Bu n=1 için p95/p99 üretmedik.

## İlk ve tek A/B: server hint'e uyan 2s/5s prototipi

Üretim view pollAfterMilliseconds **5000** olarak kaldı. Offline helper default off; production mode her zaman 5000. Yalnız explicit development+enabled ve queued/running yaş<10000 ms iken 2000 döner. Sunucu hint'i değiştirilir; client'ın server aralığını zorla aşması yok. Helper production tarafından import edilmez; gerçek flag/env/deploy aktive edilmedi.

Üç bağımsız process, iki warmup/arm, üç dengeli ABBA/BAAB blok, concurrency=1; 11 readiness cohort ×18 örnek/arm =396 koşu. Tüm client/Zod/poll/wait/abort kodu gerçek mobil source; store view/status/result gerçek source. Create ack/worker-ready zamanı, network 10ms+body 10ms ve SQL transport sınırı **virtual modeled**. Bu bir DB/provider CPU veya real-user hız benchmark'ı değildir. Normal protocol cohort'un teslim edilen domain sonucu bilinçli synthetic **insufficient_data**; planned CPU cohort gibi sunulmadı. Full envelope hash/requestId/source/error/retry invariants iki armda eşleşir.

| Virtual job-ready ms | Native ready→observed p50/p95/p99 ms | Prototype ready→observed p50/p95/p99 ms | Status GET /iş önce → sonra |
|---:|---:|---:|---:|
| 100 | 4930 / 4930 / 4930 | 1930 / 1930 / 1930 | 1 → 1 |
| 500 | 4530 / 4530 / 4530 | 1530 / 1530 / 1530 | 1 → 1 |
| 1900 | 3130 / 3130 / 3130 | 130 / 130 / 130 | 1 → 1 |
| 2100 | 2930 / 2930 / 2930 | 1950 / 1950 / 1950 | 1 → 2 |
| 4500 | 530 / 530 / 530 | 1570 / 1570 / 1570 | 1 → 3 |
| 6500 | 3550 / 3550 / 3550 | 1590 / 1590 / 1590 | 2 → 4 |
| 9500 | 550 / 550 / 550 | 610 / 610 / 610 | 2 → 5 |
| 10500 | 4570 / 4570 / 4570 | 4630 / 4630 / 4630 | 3 → 6 |
| 14000 | 1070 / 1070 / 1070 | 1130 / 1130 / 1130 | 3 → 6 |
| 30000 | 130 / 130 / 130 | 190 / 190 / 190 | 6 → 9 |
| 60000 | 250 / 250 / 250 | 310 / 310 / 310 | 12 → 15 |

**NO-GO:** 500 ms hazır işte 3 s daha erken teslim görülür; ancak 4500 ms hazır işte prototip yaklaşık **1040 ms daha geç** gözler (5s yerine 6s civarı phase). 9500 ms sonrası cohort'larda ek GET/RTT fazı nedeniyle küçük regresyonlar; 60s işte 12→15 status GET. Readiness dağılımı bilinmediğinden gruplar gerçek kullanıcı p95'i gibi birleştirilmedi. Virtual clock süreç varyansı sıfırdır; bu gerçek ağ/GC/JIT belirsizliğinin sıfır olduğu anlamına gelmez. n=18 cohort'ta nearest-rank p95/p99 örnek maksimumudur, SLA değil.

GET başına mevcut status SELECT niyeti 1'dir; prototype uzun işte en çok 3 ek SELECT niyeti + general rate-limit DB işlemleri doğurabilir. Gerçek SQL/QPS kapasite testi yapılmadı. Varsayılan general limit 60/dk; bir kullanıcının tipik max ilk-10s prototip akışı 5 status GET, native2; diğer istekler/aynı IP kullanıcıları da bu bütçeyi tüketebilir. Limit/strike/Retry-After gevşetilmedi. Owner/capability, expired404, quota429+60s, unavailable503, network, failed/cancelled, invalid status, mismatched result ve abort before delivery iki armda aynı; completed-after-cancel race ayrıca gerçek PG testinde korunur. DELETE/idempotency/lease fencing ve TTL kaynakları değiştirilmedi.

## Gate'ler, açıklar ve karar

| Kapsam | Sonuç |
|---|---|
| Arşiv korelasyonu/stage teşhisi | PASS; n=2 planned, error grupları ayrı, sınırlı gözlem |
| Baseline headless native HTTP/PG/worker/client | PASS; n=1, actual paint değil |
| Tek polling A/B semantic | PASS; 3-process; 30 ek error/abort paired kontrol |
| Tam API/DB regresyonu | **FAIL**; 1179/1182 PASS, eski state-shadow equal_alternatives üç objective 5000ms test timeout. Aynı orijinal sınırla hedefli tekrar da FAIL; limit/golden/source değiştirilmedi |
| Polling performans / varsayılan değişimi | **NO-GO**; phase regresyonu ve ek GET, uzun gerçek işlerin ana maliyetini çözmüyor |
| Gerçek API+Valhalla/DEM kısa/İstanbul–Ankara/uzun rota, cold/warm | **NOT_RUN**; kabul edilmiş runtime/DEM manifest ve ayrı provider test namespace'i doğrulanmadı; servis/cache silinmedi veya başlatılmadı |
| Yeni 2–3 concurrent job kapasite pilotu | **NOT_RUN**; dedicated runtime/load environment yok. Mevcut izole regression load testi kapasite kabulü sayılmadı |
| Worker instance/backlog | Kaynakta instance başına busy=1, 500ms tick; read-only anda queue boş. Deployment worker sayısı/kapasitesi kanıtlanmadı; concurrency artırılmadı |
| Preview ON/OFF provider yarış/coalescing A/B | **NOT_RUN**; mevcut preview korunur. Full planla POST ack sonrası paralel başladığı kaynakta doğrulandı; boyama/rekabet etkisi ölçülmedi |
| ABRP | **NOT_COMPARABLE/NOT_RUN**; kullanıcı eşlenmiş gözlemi yok, iç mimari hakkında iddia/scraping yok |
| Mounted UI/first paint/background | **NOT_RUN**; export/HTTP kabulü render değildir |

En yüksek öncelikli sonraki dar çalışma **weather acquisition**: PG hit read/deserialize, pool wait, lease claim/retry/pacing ve HTTP/decode'ı ayrı ölç; fresh series tekrarlarını count et. Aynı immutable belge ve tazelik/provenance kurallarıyla bounded/batched PG okuma veya edinim sıralaması hipotezi daha sonra test edilebilir. Potansiyel alan 18,6/72,1 s edinim aşaması; bunun tamamı kazanılabilir süre değildir. MinInterval/daily limit, terrain fallback, unknown/stale kaliteyi veya cache key'i gevşetmek için bu kanıt izin vermez. İlk A/B'den sonra weather/optimizer/preview değişikliğine geçilmedi. SSE/long-poll ileride yalnız alternatif tasarım; Redis/yeni servis yok.

## Güncel kontroller ve başarısız çalışma kaydı

| Komut | Durum | Özet |
|---|---|---|
| `SELECT 1 (credential quiet)` | PASS |  |
| `pnpm.cmd --filter @chargeroad/shared test` | PASS | ℹ tests 41; ℹ pass 41; ℹ fail 0; ℹ skipped 0 |
| `pnpm.cmd --filter @chargeroad/mobile test` | PASS | ℹ tests 80; ℹ pass 80; ℹ fail 0; ℹ skipped 0 |
| `pnpm.cmd --filter @chargeroad/api test:db` | FAIL | Test Suites: 1 failed, 72 passed, 73 total; Tests:       3 failed, 1179 passed, 1182 total |
| `pnpm.cmd -r typecheck` | PASS |  |
| `pnpm.cmd --filter @chargeroad/api build` | PASS |  |
| `pnpm.cmd --filter @chargeroad/mobile build` | PASS |  |
| `git diff --check` | PASS |  |

İlk tam kontrol tamamlanmadı ve yalnız ajanın test süreci iptal edildi; [checks-interrupted.json](latency-2026-11-16/checks-interrupted.json) NOT_COMPLETED olarak korunur, PASS sayılmaz. Tedbir olarak virtual scheduler/dynamic compiler Jest VM dışına izole edildi; semantic unit kontrolleri artık 10s timeout'lu native child içinde çalışır ve 13/13 PASS. İlk uzamanın kesin nedeni CPU profiliyle kanıtlanmadı; bu izole etme production düzeltmesi diye sunulmaz. Son tam koşu 73 suite/1182 test: 72 suite ve 1179 test PASS, 3 eski state-shadow equal_alternatives vakası 5000ms timeout ile FAIL. Eski dosya başlangıç SHA'sıyla aynı; yine de yeni tam koşu yeşil sayılmaz. Sadece bu üç vakayı aynı sınırla tekrar çalıştırma sonucu **FAIL** (Test Suites: 1 failed, 1 total; Tests:       3 failed, 159 skipped, 162 total); 159 filtre dışı test bu hedefli koşuda skipped, geçmiş/başka koşu PASS'i yerine kullanılmadı. Assertion/outcome farklılığı bildirilmedi fakat timeout nedeniyle bu üç eşdeğerlik kapanışı tamamlanmış değildir. Bu görevde başka optimizer/test-timeout çalışmasına geçilmedi. Sonuç ve başarısız log hash'leri korunur. Son kontroller ayrı check-final dizinindedir; önceki kayıtlar overwrite edilmedi. Isolated test DB/schema doğrulandı; testler yalnız kendi schema'larını migrate/clean/drop eder, kullanıcı veri/cache/volume reset edilmedi. Geçmiş test PASS sayıları yeni çalıştırma yerine kullanılmadı.

Kanıtların çalışma kopyası artifacts/latency-2026-11-16, kalıcı JSON kopyaları docs/validation/latency-2026-11-16. [Arşiv stages](latency-2026-11-16/runtime-stages.json), [native chain](latency-2026-11-16/native-isolated-chain.json), [A/B özeti](latency-2026-11-16/polling-ab.json), [process1](latency-2026-11-16/process-1.json), [process2](latency-2026-11-16/process-2.json), [process3](latency-2026-11-16/process-3.json), [kontroller](latency-2026-11-16/checks-final.json), [timeout tekrarı](latency-2026-11-16/state-timeout-recheck.json), [kapanış/koruma](latency-2026-11-16/closure.json).

Gerçek GPS/koordinat/polyline/SOC/token/IP/raw provider/result kaydı yok; sentetik fixture'lar bellekte üretilir, output hash +aggregate saklanır. Production rollback gerekmiyor; server hint ve client source aynıdır. Bu görev teşhis ve NO-GO deneyiyle kapanır; ne polling pilotu aktive edildi ne CR-PERF-007 başlatıldı.
