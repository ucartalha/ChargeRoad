# CR-LAT-002R — Objective düzeltmesi, doğrulama yaşam döngüsü ve weather bekleme adayı

2026-11-16 · **Üretim rollout kararı NO-GO.** Validator objective kusuru düzeltildi; ağır proof çocuk süreçte izole edildi. Yeni per-key weather sözleşmesi PASS. Aday yalnız scripts/validation altında; production weather varsayılanı değiştirilmedi. Aktif tasarruf **0**. CR-ROUTE-001 / CR-PERF-007 başlatılmadı.

## 0. Kaynak ve koruma

Yerel HEAD bf41840856a6e3c275665f8571483e9080cd7a3d; başlangıç manifesti bu turda **670** nonignored tracked/untracked dosya içerir. Önceki 627/609 sayıları bugünün sayısı varsayılmadı. Yerel dirty kaynaklar esas alındı. 001–006, kümülatif, LAT-001/002 kararları ve önceki manifestler incelendi. Eski rapor/JSON/golden/source checkpoint ve FAIL kayıtları değişmedi. [start.json](cr-lat-002r-2026-11-16/start.json) ve closure.json raw SHA-256 ile karşılaştırır.

Başlangıç dosyalarından yalnız şu iki doğrulama dosyası değişti:

- apps/api/src/planning/__tests__/state-shadow-equivalence.spec.ts
- apps/api/src/planning/validation/state-dominance-validation.ts

Yeni dosyalar: state-objective-validation.spec.ts, state-shadow-isolation.spec.ts; validate-state-isolation.cjs; state-isolated-runner/worker.cjs ve iki lifecycle fixture/testi; weather-wait-candidate.cjs, weather-sql-model.cjs; prove-weather-wait.cjs, prove-weather-owner.cjs, summarize-weather-wait.cjs; bu rapor ve tarihli kanıtlar. Bunlar uygulama runtime yoluna bağlanmaz. Ayrıntılı yeni dosya envanteri kapanış manifestindedir.

Optimizer, energy/charging, SOC rezerv, DTO, migration, auth/capability, session replay, job fencing ve provider defaultları aynı. Weather policy 500ms pacing / concurrency 2 / daily 1000; key/freshness, per-plan limit, 304/conditional Last-Modified, lease generation/token ve independent fetch timeout aynı. Env/lockfile, servisler, volume/cache değişmedi; gerçek provider çağrısı, DB yazısı, otomatik commit/push yok.

## 1. Objective: etiket değil gerçek istek

Yerel kusur GitHub tarifini doğruladı: run(kind, objective) world(kind) oluşturduktan sonra objective değerini request policy içine koymuyordu. Plan portunu yakalayan yeni test önce iki objective için FAIL, süre objective için PASS verdi. Kanıt: [objective-before-test.log](cr-lat-002r-2026-11-16/objective-before-test.log). CLI hazırlığındaki argüman hatası da objective-before.log içinde korunur; test sonucu yerine kullanılmaz.

Düzeltme yalnız fixture sahibi run() içinde w.request.policy.objective=objective. Üretim isteğine müdahale yok. Yeni baseline sürümü **state-objective-real/v2**. before/after/off gerçek objective ve üç inputHash kaydedilir. Sonuç search metadata objective değeri de gerçek parametreyle assert edilir. Eski üç etiketli ölçümler geriye dönük geçerli üç objective baseline sayılmaz; tarihi kanıtlar olduğu gibi kalır.

Yeni dokuz koşuda 3 ayrı inputHash; her objective için before/after/off inputHash aynı. Replay/validation input/SOC/source/metadata ve sıralı provider trace karşılaştırması tam normalized outcome içinde sürer. Normalization fonksiyonu ve optimizer source seam/checkpoint hash kuralı değiştirilmedi; yalnız doğal elapsedMilliseconds hariçtir. Gereksiz kopya azaltmak için yeni normalization/hash algoritması devreye alınmadı.

Yeni test ayrıca kontrollü outcome değişikliğinde ilk JSON pointer olarak /outcome/result/reasons/0/code bekler; değerleri loglamaz. Gerçek yeni dokuz koşuda ilk fark yoktur. [objective-after-final.log](cr-lat-002r-2026-11-16/objective-after-final.log) 4/4 PASS.

## 2. Üç eski timeout ve yeni yaşam döngüsü

Eski üç etiketin hepsi aynı süre objective işini yapıyordu. LAT-002 probe pending peak 3, suite sonunda 2 pending ve iki geç rejection ölçmüştü. Jest timeout iç promise/optimizer işini iptal etmediği için testler runInBand olsa da teardown/fetch spy/global clock ömrüyle çakışıyordu. CPU profili normalize/hash/clone ve GC yükünü gösteriyordu; tek kök neden olarak DB/network gösterilmedi. Eski iki geç rejection hangi JSON alanında oluştu: **NOT_MEASURED**; geçmiş raw outcome bulunmadan yeni pointer uydurulmadı.

Üç objective için ayrı durum:

| Objective | Eski kusur / timeout | Yeni işlevsel durum | Yeni 5000ms kriteri |
|---|---|---|---|
| minimum_total_duration | Gerçekte süre objective; timeout, pending overlap | 3/3 PASS, süreç kapandı | 2/3 PASS |
| minimum_charging_stops | Gerçekte süre objective; timeout, pending overlap | 3/3 PASS, süreç kapandı | 1/3 PASS |
| minimum_energy | Gerçekte süre objective; timeout, pending overlap | 3/3 PASS, süreç kapandı | 0/3 PASS |

equal_alternatives aynı invariant fonksiyonunu çağıran ayrı native Node workerına taşındı. Worker kendi sabit saatini, fetch yasağını, metrics scope ve fixture AbortControllerını sahiplenir; ebeveyn Jest global fetch/clock restore işlemlerine bağımlı değildir. Normal sonuçta worker işi gerçekten bitirir; ebeveyn exit ve stdout/stderr kapanışından sonra close olayında çözülür. Nonzero exit/bozuk çıktı başarısızdır. 30s OS watchdog SIGKILL uygular ve close bekler; timeout sonrası child içindeki promise yaşayamaz. Bu bir kooperatif AbortSignal başarı iddiası değildir: ebeveyn watchdog süreç sonlandırmasıdır, içeride caller cancel fixture semantiği değişmez.

Yeni Jest sınıfının 35s üst sınırı **functional integration watchdog** (30s kill + cleanup payı), eski 5000ms performans kriterinin yeni adı değildir. Eski FAIL silinmedi. 5000ms ayrıca her native invariant wall süresinde, bootstrap hariç, ölçülür. [lifecycle.log](cr-lat-002r-2026-11-16/lifecycle.log) 2/2 PASS: watchdog kill/close ve exitCode 7 failure propagation. Failure mesajları yalnız güvenli kod/pointer ve phase sürelerini iletir.

| Tekrar / objective | before ms | after ms | off ms | Tam invariant wall ms | 5000ms |
|---|---:|---:|---:|---:|---|
| 1 / minimum_total_duration | 1959.681 | 1416.625 | 1256.152 | 4646.226 | PASS |
| 1 / minimum_charging_stops | 1899.999 | 1606.067 | 1792.916 | 5315.498 | FAIL |
| 1 / minimum_energy | 2647.072 | 1733.845 | 1349.828 | 5742.433 | FAIL |
| 2 / minimum_total_duration | 1696.851 | 1454.188 | 1224.137 | 4386.725 | PASS |
| 2 / minimum_charging_stops | 2302.722 | 1770.465 | 1546.944 | 5638.367 | FAIL |
| 2 / minimum_energy | 2103.592 | 1660.245 | 1587.872 | 5363.816 | FAIL |
| 3 / minimum_total_duration | 2676.309 | 1462.612 | 1195.521 | 5347.379 | FAIL |
| 3 / minimum_charging_stops | 1918.251 | 1333.703 | 1320.932 | 4585.608 | PASS |
| 3 / minimum_energy | 2826.787 | 1914.869 | 1260.392 | 6013.546 | FAIL |

İşlevsel gate **PASS**, 9 bağımsız process; tarihsel 5000ms gate **FAIL** (3/9). Her koşu after/off/before outcome, trace sırası, counts, input, eski counters, no-pruning kontrolünü korur. Kaynak hashli son tur [state-isolation-nine-final.json](cr-lat-002r-2026-11-16/state-isolation-nine-final.json); ilk dokuz tur da state-isolation-nine.json içinde korunur. Ölçümlerde eşzamanlı doğrulama yükü bulundu; sonuçlardan yeni SLA çıkarılmaz.

## 3. Weather order sözleşmesi

Önceki 31 strict global transport-order FAIL raporu ve raw order değişmedi. İki worker ve bağımsız key acquisition için global başlama sırası native baseline tekrarlarında da değişiyor. Yeni sınıflandırma **GLOBAL_ORDER_NONDETERMINISTIC**; eski FAIL yeniden PASS yapılmadı.

Bu turun ilk model turunda 5 JSON-string hash uyuşmazlığı da korundu. Field-level deep karşılaştırma 0 gerçek per-key fark gösterdi: perKey dictionary insertion sırası farklıydı. Yeni contract-v2 turu dictionary anahtar temsilini canonicalize eder, **rawOrder dizisini veya her key içindeki event dizisini sıralamaz**. Raw başlangıç sıraları her koşuda ayrıca saklanır.

Yeni zorunlu invariantlar: aynı çağırıcı sıralı forecast sonuçları/ETA/provenance/temperature/vector-wind, physical fetch sayısı, key başına claim→fetch→status→commit/release sırası, saved document hash, hit/miss/coalescing, owner exclusive bound, pending cleanup. Bağımsız iki keyin kendi aralarındaki başlama sırası sözleşme değildir. Observer OFF/ON için 1/2/3 job × 1/2/3 key, üç process ölçüldü. Yeni sözleşme PASS; paired semantic/observer cases 66/66 PASS.

429/503 burada exception seam injectiondır; gerçek HTTP status/header dönüşümü/yük testi değildir. 304, stale/unknown/outside, budget/quota, already canceled/deadline ve owner-cancel paired sonuçları korunur. Extra owner modeli PASS: ilk caller cancel diğerini kesmez; cross-instance budget=0 bekleyen fresh representationı alır; fresh cache budget/quota doluyken kullanılabilir; superseded token/generation save/backoff sahibi olamaz. [weather-owner.json](cr-lat-002r-2026-11-16/weather-owner.json). Gerçek PostgreSQL fencing yarışı **NOT_RUN**; JS mutex kanıtı PG kabulü değildir.

## 4. Tek dar weather adayı — aktif değil

Aday A, güncel weather-cache.ts kaynağını guarded string seams ile yalnız bellekte derler. Sabit 100ms fresh/backoff SELECT kontrolü devam eder; son authoritative provider pacing veya key lease gözlemi hâlâ geçerliyken aynı global FOR UPDATE claim transactionı tekrar alınmaz. Pacing için en fazla 500ms, lease için en fazla 250ms claim ertelemesi; deadline/abort ve 210 retry bound korunur. Fresh bulunduğunda bütçeye bakmadan dönen ilk SELECT aynı. Concurrent ownerın fresh kaydını keşfetme kontrolü atlanmaz. Request key, SQL lease write/fenced commit, fetch timeout, source validation ve provider limitleri değişmez. Candidate B/batching/series reuse/Redis/örnekleme aralığı eklenmedi.

Bu aday **production WeatherCacheStore dosyasına uygulanmadı**; yalnız scripts/validation/weather-wait-candidate.cjs içindedir. Farklı keyde provider backoff değişirken gözlem süresi, gerçek PG lock/lease/pool race ve yoğun cache-hit parse maliyeti için saha/PG kanıtı yoktur. Global lock giderildi denmez; bazı tekrarlar modelde azaltıldı.

### Üç süreçli dengeli A/B — yalnız MOCK

Kaynak/epoch/fixture/limits aynı; süreçler sırayla, warmup sonrası ABBA/BAAB, her grupta her arm için n6. 1/10/100 forecast cohort, her cohort 1 veya 3 distinct key içerir; bunlar 100 benzersiz external key / gerçek kullanıcı değildir. Gerçek WeatherService, adapter ve normalize çalışır; SQL in-memory mutex, transport sentetik. Eşzamanlı full Jest ve bazı tanılama işleri ölçümün bir bölümünde CPU/GC yükü oluşturdu; **izole hız kabulü değildir**. Windows process CPU API birimi mikrosecond olsa da scheduler muhasebesi kaba çözünürlüklüdür. P95 küçük örneklem maksimumudur; p99 SLA/5000 kullanıcı kapasitesi iddiası yok.

| Forecast jobs / keys | Before p50 / p95 ms | Candidate p50 / p95 ms | p95 farkı | Ortalama SQL before→candidate | Ortalama claim before→candidate | Physical fetch |
|---|---:|---:|---:|---:|---:|---:|
| 1 / 1 | 132.631 / 148.809 | 138.182 / 139.617 | -6.18% | 12.00 → 12.00 | 1.00 → 1.00 | 1 |
| 1 / 3 | 1390.131 / 1425.938 | 1399.558 / 1558.240 | 9.28% | 112.50 → 73.17 | 11.50 → 6.00 | 3 |
| 10 / 1 | 131.826 / 147.216 | 135.426 / 154.837 | 5.18% | 12.00 → 12.00 | 1.00 → 1.00 | 1 |
| 10 / 3 | 1368.445 / 1586.242 | 1390.072 / 1568.466 | -1.12% | 114.00 → 73.00 | 11.67 → 6.00 | 3 |
| 100 / 1 | 139.649 / 157.262 | 145.795 / 172.042 | 9.40% | 12.00 → 12.00 | 1.00 → 1.00 | 1 |
| 100 / 3 | 1353.224 / 1437.301 | 1378.158 / 1495.698 | 4.06% | 109.50 → 72.33 | 11.17 → 6.00 | 3 |

Üç-key gruplarında SQL sayısı yaklaşık %34–36 azalır; bir-key gruplarında zaten koordinasyon tekrarı yoktur. P95 1/3 grubunda yaklaşık %9.28, 100/1 grubunda %9.40 geriler. %10 tekrarlanabilir awaited-wall kazanımı ve p95 emniyet kapısı sağlanmadı. Daha az SQL, daha hızlı planın kanıtı değildir: 500ms pacing alt sınırı aynı, retry/claim zamanlaması ve CPU/JIT/GC etkileri baskın olabilir. Bunları ölçülmüş exclusive neden payları olarak sunmuyoruz.

Her process için p50/p95/min/max, CPU user+system/heap ve SQL/select/claim dağılımları [weather-analysis.json](cr-lat-002r-2026-11-16/weather-analysis.json) içindedir. Raw process JSONlarında CPU user/system, heap, poolConnect/sql/transport inclusive timer, reason observation ve raw order saklanır. Inclusive timerlar üst üste binebilir, toplanmaz. Exact per-key critical path, pacing/lease sleep exclusive dağılımı ve normalization exclusive süresi **NOT_MEASURED**. Gerçek PG connect/statement/network süreleri **NOT_RUN**. Ayrı TEST_DATABASE_URL yok; production DB üzerinde yazma/fixture/cleanup yapılmadı.

LAT-001 18.624/72.148s acquisition, 33/128 HTTP, 34745/45220 query item, 33/2351 PG miss geçmişi **NOT_COMPARABLE** kalır. Bu tur bunların exclusive nedenini geriye dönük ispatlamaz; 33/128×500ms ölçülmüş bekleme sayılmaz. Query item ≠ key ≠ cache lookup ≠ HTTP. Yeni 5-miss/tek-key/0-fetch kanıtı aynı tarihli eski raporda korunur.

## 5. Güncel regresyon ve karar

| Kontrol | Durum | Açıklama |
|---|---|---|
| pnpm.cmd --filter @chargeroad/shared test | PASS | Güncel çalıştırma |
| pnpm.cmd --filter @chargeroad/mobile test | PASS | Güncel çalıştırma |
| pnpm.cmd --filter @chargeroad/api test | FAIL | Test Suites: 1 failed, 14 skipped, 60 passed, 61 of 75 total; Tests:       2 failed, 154 skipped, 1030 passed, 1186 total |
| pnpm.cmd -r typecheck | PASS | Güncel çalıştırma |
| pnpm.cmd --filter @chargeroad/api build | PASS | Güncel çalıştırma |
| pnpm.cmd --filter @chargeroad/mobile build | PASS | Güncel çalıştırma |
| git diff --check | PASS | Güncel çalıştırma |
| pnpm --filter @chargeroad/api test:db | NOT_RUN | No explicit separate TEST_DATABASE_URL; task forbids new migration/reset/drop. No DATABASE_URL mutation fallback used. API non-DB regression run instead. |
| Optimizer bağımsız tekrar | PASS | Test Suites: 1 passed, 1 total; Tests:       21 passed, 21 total; Time:        9.547 s, estimated 11 s |
| API seri tekrar (ölçüm/derleme çakışması yok) | PASS | Test Suites: 14 skipped, 61 passed, 61 of 75 total; Tests:       154 skipped, 1032 passed, 1186 total; Time:        243.932 s, estimated 588 s |

İlk tam API koşusu 1030 PASS /2 FAIL /154 skipped: optimizer.spec.ts içindeki 5003-segment testinde 5000ms timeout ve temperature testinde planned yerine computation_limit. Dosya/production solver değiştirilmedi. Bağımsız optimizer tekrar 21/21 PASS; timeout sonrası kalan iş / makine yükü olasılığı var, iki failureın tüm nedenselliği bu sonuçla kanıtlanmaz. İlk full FAIL logu korunur. Seri tekrar sonucu ayrı kanıttır, önceki failureı silmez.

İzole TEST_DATABASE_URL bulunmadığı için test:db NOT_RUN; DATABASE_URL fallback ile migration/fixtures yapılmadı. Shared 41, mobile 80 testleri; typecheck/API build/mobile Expo export güncel çalıştırmalardır. Expo export gerçek cihaz kabulü değildir. User location/GPS/SOC, IP, credential, raw route veya provider packet yok; yalnız sentetik veri hash/sayaç/süre ve source stackleri kaydedildi.

Son karar: **NO-GO production rollout**. Objective/lifecycle düzeltmesi test/validation katmanında teslimdir. Yeni per-key sözleşme PASS; historical timing FAIL, gerçek PG/provider NOT_RUN ve model performans kapısı başarısız. Weather adayı CANDIDATE_ONLY konumundadır, >=%10 gerçek kazanım kanıtlanmadı, aktif savings=0. Önceki NO-GO cache/index/polling/heap optimizasyonları açılmadı.

Rollback: runtime weather değişikliği olmadığından üretim rollback gerekmez. Doğrulama düzeltmesini geri almak gerekirse yalnız bu turda değişen iki test/validation dosyası ve yeni runner/testler ayrı diff review ile ele alınır; eski dirty dosyalar/kanıtlar ve incoming değişiklikler korunur. Otomatik reset/clean yok. Sonraki görev başlatılmaz.

Kanıtlar: [start.json](cr-lat-002r-2026-11-16/start.json), [state-isolation-nine-final.json](cr-lat-002r-2026-11-16/state-isolation-nine-final.json), [weather-analysis.json](cr-lat-002r-2026-11-16/weather-analysis.json), [weather-owner.json](cr-lat-002r-2026-11-16/weather-owner.json), [checks.json](cr-lat-002r-2026-11-16/checks.json), [optimizer-isolated-recheck.json](cr-lat-002r-2026-11-16/optimizer-isolated-recheck.json), [api-serial-recheck.json](cr-lat-002r-2026-11-16/api-serial-recheck.json).
