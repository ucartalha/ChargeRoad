# CR-LAT-002 — Weather acquisition Aşama A ve regresyon kapısı

2026-11-16 · **Aşama A teşhis teslimi; üretim optimizasyonu NO-GO. Aşama B NOT_RUN.** Üç timeout kapısı kapanmadı; instrumentation order kapısı da FAIL. Active savings **0**. CR-PERF-007/008 başlamadı.

## Başlangıç ve koruma

HEAD bf41840856a6e3c275665f8571483e9080cd7a3d. Yerel dirty içerik esas alındı; [start manifesti](cr-lat-002-2026-11-16/start.json) **627 tracked/untracked nonignored dosya** için raw SHA-256, git status ve dirty diff hash içerir. LAT-001'in 609 dosyalık önceki manifesti ve 001–006/kümülatif/LAT-001 raporları okundu. Başlangıç kaynak/JSON/golden/raporlarının **hiçbiri değiştirilmedi**; [closure](cr-lat-002-2026-11-16/closure.json) bunu doğrular.

Yeni dosyalar yalnız tanılama/özetleme CJS scriptleri, opt-in Jest setup probe, bu rapor ve tarihli kanıtlardır. Production weather/service/cache/PG key/SQL/policy, DTO, solver, replay, energy/charging, navigation, polling, auth, migration, package/lock ve env dosyaları aynı. Yeni schema/table/migration/reset/truncate/drop/cache temizliği veya kullanıcı servisi restart yok. Read-only PG transaction rollback veri değişikliği değildir. Yerel native/probe çocuk süreçleri biter; kullanıcı süreçlerine müdahale edilmedi. Otomatik commit/push yok.

## 1. Öncelikli üç timeout: durum ve neden ayrıştırma

LAT-001'in 1179/1182 PASS +3 timeout sonucu **tarihsel** olarak korunur, güncel PASS sayılmaz. State-shadow test dosyası, validateStateCase helper'ı, fixture ve solver kaynakları CR-PERF-005 B koruma manifestiyle karşılaştırıldı: hedef altı dosya **aynı**. Yeni LAT-001 testlerini çalıştırmadan taze Jest --runInBand yalnız equal_alternatives üç objective: yine **3 FAIL /159 filtre dışı skipped**, orijinal 5000 ms sınırı. Bu, yeni testlerin önceden aynı süreçte çalışmasının failure için zorunlu olmadığını gösterir; dış makine yükünü veya geçmiş runtime farkını dışlamaz.

Kaynak test/expected/assertion/solver değiştirilmedi ve timeout artırılmadı. Aynı exported validateStateCase fonksiyonu aynı sabit 2026-11-15T09:00Z ile dokuz bağımsız native Node process'te çalıştırıldı. Tüm plan/input/replay/trace/budget/003 counter karşılaştırmaları fonksiyonun kendisinde kaldı. Native loader ts-node transpile-only; bootstrap hariç tam invariant fonksiyonunun wall süresi ölçüldü. Dokuz functional karşılaştırma PASS; orijinal 5000 ms timing gate **8/9 PASS**, bir ölçüm **5031,839 ms**. Dolayısıyla deterministik PASS yoktur, B kapısı kırmızı kalır.

| Rep / objective | Tam invariant wall ms | CPU user/system ms | Event-loop max ms | GC event | Functional invariant | 5000ms gate |
|---|---:|---:|---:|---:|---|---|
| 1 / minimum_charging_stops | 2856.786 | 3547.000 / 234.000 | 71.631 | 40 | PASS | PASS |
| 1 / minimum_energy | 4242.382 | 5078.000 / 282.000 | 141.689 | 40 | PASS | PASS |
| 1 / minimum_total_duration | 4291.035 | 4985.000 / 156.000 | 140.509 | 38 | PASS | PASS |
| 2 / minimum_charging_stops | 3269.713 | 3938.000 / 78.000 | 127.992 | 40 | PASS | PASS |
| 2 / minimum_energy | 4609.954 | 5704.000 / 172.000 | 121.569 | 40 | PASS | PASS |
| 2 / minimum_total_duration | 3327.771 | 4000.000 / 125.000 | 94.503 | 40 | PASS | PASS |
| 3 / minimum_charging_stops | 3709.997 | 4453.000 / 234.000 | 94.306 | 40 | PASS | PASS |
| 3 / minimum_energy | 5031.839 | 6062.000 / 140.000 | 164.495 | 40 | PASS | FAIL |
| 3 / minimum_total_duration | 2461.622 | 2937.000 / 125.000 | 57.704 | 40 | PASS | PASS |

### Timeout sonrası pending promise çakışması ölçüldü

Ayrı opt-in setup eski fonksiyonu spy ile gözler, **aynı orijinal Promise'ı** döndürür. 500ms aralıkla pending sayısı/CPU/event-loop/resources; GC observer; 5s civarı snapshot alınır. Bu ek probe overhead taşır, kabul timing'i değildir. Orijinal testler yine değiştirilmeden çalışır:

| Objective | Orijinal promise gerçek bitiş ms | Pending peak | Event-loop max ms | Geç sonuç |
|---|---:|---:|---:|---|
| minimum_total_duration | 13908.195 | 3 | 384.041 | resolved / none |
| minimum_charging_stops | 14641.759 | 3 | 384.041 | rejected / STATE_SHADOW_BEHAVIOR_CHANGED/equal_alternatives/minimum_charging_stops |
| minimum_energy | 11752.748 | 3 | 346.554 | rejected / STATE_SHADOW_BEHAVIOR_CHANGED/equal_alternatives/minimum_energy |

Suite bittiğinde 2 validation promise hâlâ pending idi; peak **3**. Jest timeout await'i başarısız sayıyor ama iç doğrulama AbortController'ını iptal etmiyor. --runInBand testleri seri başlatsa da bitmemiş async işlerin üst üste binmesini engellemiyor. Probe sonunda iki geç doğrulama STATE_SHADOW_BEHAVIOR_CHANGED ile reddedildi; teardown/clock/fetch spy ömrüyle çakışma mümkündür, hangi alanın değiştiği bu probe'da ayrıştırılmadı. Bu geç rejection'lar production rota farklılığı kabulü veya normal koşuda functional PASS yerine kullanılamaz.

Taze native child izolasyonu çakışmayı önler fakat 8/9 timing sonucu sorunu deterministik kapatmadı. Sadece timeout'u artırmak, GC'yi bütçeden çıkarmak veya geç failure'ı yok saymak denenmedi. Yerel ayrı runner **deneyi** vardır; varsayılan test yolu değiştirilmedi. [Promise suite-end](cr-lat-002-2026-11-16/promise-at-suite-end.json), [completion1](cr-lat-002-2026-11-16/promise-completion-1.json), [completion2](cr-lat-002-2026-11-16/promise-completion-2.json), [completion3](cr-lat-002-2026-11-16/promise-completion-3.json).

CPU/GC profili tüm izole Jest prosesini kapsar (startup/compiler dahil): 21292 örnek, 149 Scavenge ve 9 major GC log kaydı. En sıcak fonksiyonlar arasında normalized JSON kopyası/hash proof yolu, openThroughout ve energy evaluate var; bunların tüm maliyeti weather veya production request'e atanmadı. Ayrıntı [CPU özeti](cr-lat-002-2026-11-16/jest-cpu-summary.json); ham .cpuprofile ve original-jest.log aynı dizinde korunur. Fixture bu yolda DB veya gerçek provider kullanmıyor: DB pool wait NOT_APPLICABLE, actual worker thread yok, dış fetch **0**. Async promise pending, Node resource tipleri ve GC ölçüldü; tüm VM overhead'inin tek nedeni kanıtlandı denmiyor. Kullanıcıya ait diğer süreçlerin CPU etkisi tam izole edilemedi ve süreçler durdurulmadı.

## 2. Gerçek kaynak çağrı grafiği

Referanslar mevcut dosya/line'lara dayanır; bu belge eski GitHub ağacı varsaymaz:

- [PlanningSession.drive](../../apps/api/src/planning/planning-session.ts:97): route → [sampleRouteWeather](../../apps/api/src/weather/weather-sampler.ts:9) → [weather](../../apps/api/src/planning/planning-session.ts:68) → [WeatherService.forecast](../../apps/api/src/weather/weather.service.ts:28) → cache/adapter → [energy evaluate](../../apps/api/src/planning/planning-session.ts:105). Sampler query üretimi cache hit'ten önce gerçekleşir.
- Session.weather [checksum/hit](../../apps/api/src/planning/planning-session.ts:75), [sample/segment budget](../../apps/api/src/planning/planning-session.ts:81), provider çağrısı ve [replay](../../apps/api/src/planning/planning-session.ts:94). Anahtar queries'in validAt/sampleLocation/metadata içeriğini kapsar; ETA değişince aynı final forecast güvenle varsayılamaz.
- [charge](../../apps/api/src/planning/planning-session.ts:117) → station query, [station weather edinimi](../../apps/api/src/planning/planning-session.ts:129), arrival/opening-hours/thermal seçenekleri ve charging evaluate. Tek weather edinimi birden çok connector/target integration'a hizmet edebilir; charging call sayısı weather HTTP değildir.
- [forecast groups](../../apps/api/src/weather/weather.service.ts:37) actual weatherSampleLocation→adapter URL; [seriesByUrl](../../apps/api/src/weather/weather.service.ts:46) forecast batch içinde dedup; [cache.get](../../apps/api/src/weather/weather.service.ts:50); [terrain fallback](../../apps/api/src/weather/weather.service.ts:68) ve [normalize](../../apps/api/src/weather/weather.service.ts:70). Bu local map her forecast çağrısında yeniden kurulur, global final-forecast cache değildir.
- [HMAC key/pending](../../apps/api/src/weather/weather-cache.ts:18): provider+version+URL. [acquire/read](../../apps/api/src/weather/weather-cache.ts:34): fresh/retry → [claim](../../apps/api/src/weather/weather-cache.ts:55) (connection, transaction, provider row FOR UPDATE, freshness/lease recheck, per-job/day budget, concurrency, token/generation, pacing reservation) → 100ms retry veya fetch. Native claim/lease/pacing/key semantiği değiştirilmedi.
- [fetch/conditional 304/fenced save](../../apps/api/src/weather/weather-cache.ts:90): old Last-Modified, bağımsız 5s transport, validate, token+generation+lease_until kontrolü; failure release/backoff yalnız current owner. 304 body ve fetchedAt korunur, validatedAt yenilenir. [SQL PK/indexler](../../apps/api/migrations/010_weather_provider_cache.sql:1) request_key PK, retention/active-lease indexleri ve provider state tablosudur; yeni index/şema yok.
- [weather-http](../../apps/api/src/weather/weather-http.ts:9): physical fetch, 200/203/304/429/5xx ve Retry-After, 1MiB body limiti/JSON decode/expiry headers. [MET URL/parse](../../apps/api/src/weather/met-norway.adapter.ts:18) mevcut dört basamak truncation ve unit/schema kontrolü; yeni rounding yapılmadı.
- [normalizeWeather](../../apps/api/src/weather/weather-normalize.ts:13): query validAt için coverage/gap, vektörel wind ve temperature interpolation; source age/core/partial/stale; [sampledLocation/provenance](../../apps/api/src/weather/weather-normalize.ts:36). Forecast time provider-series cache key'i değildir, doğru zaman seçimi her query'de sürer.

## 3. 34k/45k query-item ve 2351 miss neyi gösteriyor?

Geçmiş iki job: query items **34745/45220**, cache hits **1108/1275**, miss **33/2351**, weather HTTP **33/128**, sample evaluations **1141/12410**. Bunlar farklı seviyelerdir. Port forecast çağrısı 72/77; corridor count=1, optimizer run count=1. Üç koridorun hep tekrarlandığı iddiası yok. Route/charge/state ETA geçişleri queries'i yeniden üretir; aynı URL altında birçok segment/time query olabilir. Sampler queries cache lookup'tan önce üretilir, Session.weather hit'leri provider'ı atlayabilir. Bu toplamlar tek başına exact state→item dağılımını veya unique key sayısını vermez; eski ham kullanıcı rota packet'i okunmadı.

**Kaynakla kanıtlanan miss anlamı:** cache.acquire ilk SELECT fresh değilse sadece attempt===0'da miss sayar. Retry loop SELECT sayısı değildir, global distinct-key sayısı da değildir. Aynı key'in yeni acquire'ı tekrar miss sayabilir. Native Cache.get/claim ile negatif budget fixture: **5 get, 1 series key, 5 miss, 0 HTTP**. Per-job budget tükendiğinde claim, yeni fetch başlamadan reddedilir; pending kaldırılınca sonraki forecast batch aynı key'e tekrar acquire yapabilir. Bu yol 2351 miss'in olası nedenidir; tüm tarihi miss'lerin bu nedenden geldiği kanıtlanmadı. [Budget tree](cr-lat-002-2026-11-16/budget-tree.json).

Gerçek sampler/range-policy/adapter ile deterministik sentetik tree:

| Profil/mod | Segment | Query item | Requested loc | Sample loc | Location-time pair | Provider series key | Unknown timing segment |
|---|---:|---:|---:|---:|---:|---:|---:|
| short/base | 60 | 60 | 60 | 3 | 60 | 3 | 0 |
| short/eta-shift | 60 | 60 | 60 | 3 | 60 | 3 | 0 |
| short/unknown-stop | 60 | 30 | 30 | 2 | 30 | 2 | 30 |
| medium/base | 600 | 600 | 600 | 21 | 600 | 21 | 0 |
| medium/eta-shift | 600 | 600 | 600 | 21 | 600 | 21 | 0 |
| medium/unknown-stop | 600 | 300 | 300 | 11 | 300 | 11 | 300 |
| long/base | 2400 | 2400 | 2400 | 49 | 2400 | 49 | 0 |
| long/eta-shift | 2400 | 2400 | 2400 | 49 | 2400 | 49 | 0 |
| long/unknown-stop | 2400 | 1200 | 1200 | 32 | 1200 | 32 | 1200 |

Örneğin 2400 segment→2400 ETA query ama 49 series key. ETA +15dk query hash'i değiştirirken aynı spatial key sayısı kalır; aynı series'den farklı validAt seçimi yapılır. Unknown-stop sonrası sorgular kesilir, zaman uydurulmaz. 34k item'ı 34k PG SELECT saymak bu katman ayrımını ihlal eder. Task'taki 15/25km ve %85 range politikası [buildPlanningWeather](../../apps/api/src/weather/planning-weather-policy.ts:29) üzerinden aynen kullanıldı; fixture 400km katalog menzili saha verisi değildir.

## 4. Aşama A instrumentation: ölçülenler ve FAIL kapısı

Yeni gözlemci yalnız native tanılama scriptinde aktif; production import'u veya PLANNING_METRICS default değişikliği yok. Gerçek WeatherService/WeatherCacheStore/MetNorwayAdapter çalışır; sadece bağımlılık sınırındaki SQL ve transport **in-memory fixture**. HTTP yanıt kodları modelde injected transport sonuçlarıdır, wire HTTP değildir. SQL statement sayıları fixture SQL invocation'dır, gerçek PG query latency diye sunulmaz. 1/2/3 concurrent forecast işi yalnız aynı test süreci/modelde; real worker veya 5000-user kapasite testi değildir. Üç objective etiketleri aynı weather port'un objective-independent alt akışını kapsar; tam optimizer E2E deneyi değildir.

Source-bound dependency substitution yalnız cache delay ve normalize observer'ı için bellekte yapılır; solver kopyası yok. Off native class; on aynı weather kaynağının observer bağımlılıklarıyla derlenmiş şekli. Gerçek policy minInterval500/concurrency2/budget/deadline korunur. Parent'tan üç child'a **aynı fixture epoch** taşınır. trace-v2 nihai veridir; önceki smoke/başarısız/yarıda kesilen hazırlıklar korunur, kabul verisi değildir.

Üç bağımsız process, ABBA/BAAB, warmup bir/arm, 18 grup; **n=6/arm/grup**, 216 forecast cohort koşusu +3×8 semantic çift. Cold/warm yalnız model başlangıç halidir. İlk script/setup/compiler süresi timer dışında; bu bir production timer overhead kabulü değildir. Metric açık/kapalı bütün weather payload hash'leri, status/quality/source ve cache counter/transport-call sayıları aynı kaldı; fakat **31 strict transport-order karşılaştırması FAIL**. Altı grupta baseline'ın kendi tekrarı da birden fazla sıra üretiyor. Bunun yalnız observer nedeniyle olduğu kanıtlanmadı; yine de sıralama invariance kapanmadı. Order sorted edilmedi, assertion/golden değiştirilmedi. **Instrumentation production rollout NO-GO.**

| Profil/objective/cache | Off awaited batch p50/p95/p99 ms | Observed p50/p95/p99 ms | Fixture SQL call p50/p95/p99 off→on | Fixture transport off→on | Sıra varyantı off/on |
|---|---:|---:|---:|---:|---:|
| short/minimum_total_duration/cold | 1324.523 / 1483.860 / 1483.860 | 1349.687 / 1563.486 / 1563.486 | 108.000 / 126.000 / 126.000 → 108.000 / 117.000 / 117.000 | 3 → 3 | 2 / 2 |
| short/minimum_total_duration/warm | 27.897 / 62.306 / 62.306 | 34.302 / 61.935 / 61.935 | 3.000 / 3.000 / 3.000 → 3.000 / 3.000 / 3.000 | 0 → 0 | 1 / 1 |
| short/minimum_charging_stops/cold | 167.850 / 221.331 / 221.331 | 125.151 / 230.428 / 230.428 | 12.000 / 12.000 / 12.000 → 12.000 / 12.000 / 12.000 | 1 → 1 | 1 / 1 |
| short/minimum_charging_stops/warm | 17.439 / 30.806 / 30.806 | 14.352 / 28.073 / 28.073 | 1.000 / 1.000 / 1.000 → 1.000 / 1.000 / 1.000 | 0 → 0 | 1 / 1 |
| short/minimum_energy/cold | 1391.561 / 1580.627 / 1580.627 | 1426.274 / 1591.570 / 1591.570 | 99.000 / 135.000 / 135.000 → 108.000 / 117.000 / 117.000 | 3 → 3 | 2 / 2 |
| short/minimum_energy/warm | 25.379 / 45.541 / 45.541 | 34.849 / 51.276 / 51.276 | 3.000 / 3.000 / 3.000 → 3.000 / 3.000 / 3.000 | 0 → 0 | 1 / 1 |
| medium/minimum_total_duration/cold | 1409.446 / 1529.331 / 1529.331 | 1459.572 / 1587.889 / 1587.889 | 108.000 / 117.000 / 117.000 → 117.000 / 126.000 / 126.000 | 3 → 3 | 2 / 2 |
| medium/minimum_total_duration/warm | 18.670 / 30.086 / 30.086 | 22.168 / 27.129 / 27.129 | 3.000 / 3.000 / 3.000 → 3.000 / 3.000 / 3.000 | 0 → 0 | 1 / 1 |
| medium/minimum_charging_stops/cold | 131.692 / 251.989 / 251.989 | 158.395 / 258.145 / 258.145 | 12.000 / 12.000 / 12.000 → 12.000 / 12.000 / 12.000 | 1 → 1 | 1 / 1 |
| medium/minimum_charging_stops/warm | 14.833 / 32.986 / 32.986 | 14.687 / 25.344 / 25.344 | 1.000 / 1.000 / 1.000 → 1.000 / 1.000 / 1.000 | 0 → 0 | 1 / 1 |
| medium/minimum_energy/cold | 1284.421 / 1498.925 / 1498.925 | 1363.806 / 1512.486 / 1512.486 | 108.000 / 117.000 / 117.000 → 99.000 / 108.000 / 108.000 | 3 → 3 | 2 / 2 |
| medium/minimum_energy/warm | 28.780 / 43.473 / 43.473 | 28.685 / 34.886 / 34.886 | 3.000 / 3.000 / 3.000 → 3.000 / 3.000 / 3.000 | 0 → 0 | 1 / 1 |
| long/minimum_total_duration/cold | 1480.449 / 1685.628 / 1685.628 | 1512.765 / 1626.749 / 1626.749 | 99.000 / 117.000 / 117.000 → 99.000 / 126.000 / 126.000 | 3 → 3 | 2 / 2 |
| long/minimum_total_duration/warm | 146.000 / 188.247 / 188.247 | 143.028 / 179.036 / 179.036 | 3.000 / 3.000 / 3.000 → 3.000 / 3.000 / 3.000 | 0 → 0 | 1 / 1 |
| long/minimum_charging_stops/cold | 287.581 / 307.497 / 307.497 | 314.166 / 388.864 / 388.864 | 12.000 / 12.000 / 12.000 → 12.000 / 12.000 / 12.000 | 1 → 1 | 1 / 1 |
| long/minimum_charging_stops/warm | 80.014 / 143.019 / 143.019 | 91.151 / 119.982 / 119.982 | 1.000 / 1.000 / 1.000 → 1.000 / 1.000 / 1.000 | 0 → 0 | 1 / 1 |
| long/minimum_energy/cold | 1463.045 / 1695.483 / 1695.483 | 1528.748 / 1594.321 / 1594.321 | 90.000 / 108.000 / 108.000 → 90.000 / 108.000 / 108.000 | 3 → 3 | 2 / 2 |
| long/minimum_energy/warm | 121.511 / 142.467 / 142.467 | 113.139 / 157.786 / 157.786 | 3.000 / 3.000 / 3.000 → 3.000 / 3.000 / 3.000 | 0 → 0 | 1 / 1 |

| Profil/objective/cache | Toplam process CPU user/system off→on ms | Heap delta p50/p95/p99 byte off→on |
|---|---:|---:|
| short/minimum_total_duration/cold | 187.000 / 62.000 → 375.000 / 31.000 | 1002856.000 / 1336944.000 / 1336944.000 → 1472168.000 / 1725376.000 / 1725376.000 |
| short/minimum_total_duration/warm | 62.000 / 15.000 → 77.000 / 0.000 | 470200.000 / 506552.000 / 506552.000 → 518424.000 / 597560.000 / 597560.000 |
| short/minimum_charging_stops/cold | 16.000 / 0.000 → 155.000 / 32.000 | 466888.000 / 474032.000 / 474032.000 → -19754456.000 / 564072.000 / 564072.000 |
| short/minimum_charging_stops/warm | 31.000 / 0.000 → 31.000 / 0.000 | 390432.000 / 402536.000 / 402536.000 → 402576.000 / 452496.000 / 452496.000 |
| short/minimum_energy/cold | 156.000 / 0.000 → 391.000 / 47.000 | 887160.000 / 989296.000 / 989296.000 → 1374240.000 / 1528784.000 / 1528784.000 |
| short/minimum_energy/warm | 46.000 / 15.000 → 47.000 / 31.000 | 424528.000 / 478984.000 / 478984.000 → 444136.000 / 493416.000 / 493416.000 |
| medium/minimum_total_duration/cold | 438.000 / 0.000 → 593.000 / 47.000 | 4970096.000 / 5679640.000 / 5679640.000 → -14920712.000 / 6744416.000 / 6744416.000 |
| medium/minimum_total_duration/warm | 139.000 / 0.000 → 110.000 / 0.000 | 4306344.000 / 4337960.000 / 4337960.000 → 4409688.000 / 4469792.000 / 4469792.000 |
| medium/minimum_charging_stops/cold | 31.000 / 16.000 → 76.000 / 0.000 | 4167408.000 / 4188784.000 / 4188784.000 → -19182656.000 / 4301760.000 / 4301760.000 |
| medium/minimum_charging_stops/warm | 47.000 / 0.000 → 203.000 / 16.000 | 4082584.000 / 4107176.000 / 4107176.000 → -18869336.000 / 4278472.000 / 4278472.000 |
| medium/minimum_energy/cold | 219.000 / 15.000 → 233.000 / 31.000 | 4446048.000 / 4525520.000 / 4525520.000 → 4907928.000 / 5186264.000 / 5186264.000 |
| medium/minimum_energy/warm | 109.000 / 0.000 → 172.000 / 0.000 | 4027760.000 / 4048408.000 / 4048408.000 → -16186800.000 / 4176240.000 / 4176240.000 |
| long/minimum_total_duration/cold | 1249.000 / 47.000 → 1437.000 / 140.000 | 3345432.000 / 27057248.000 / 27057248.000 → -2663184.000 / 34827696.000 / 34827696.000 |
| long/minimum_total_duration/warm | 985.000 / 47.000 → 827.000 / 93.000 | -8001408.000 / 23888696.000 / 23888696.000 → -372016.000 / 23776864.000 / 23776864.000 |
| long/minimum_charging_stops/cold | 562.000 / 47.000 → 845.000 / 16.000 | -11248168.000 / 21405760.000 / 21405760.000 → 25933328.000 / 26082496.000 / 26082496.000 |
| long/minimum_charging_stops/warm | 468.000 / 48.000 → 717.000 / 15.000 | -4388088.000 / 21304864.000 / 21304864.000 → -3791864.000 / 25752960.000 / 25752960.000 |
| long/minimum_energy/cold | 765.000 / 77.000 → 797.000 / 63.000 | 2078088.000 / 3412856.000 / 3412856.000 → -3427408.000 / 24022792.000 / 24022792.000 |
| long/minimum_energy/warm | 672.000 / 32.000 → 657.000 / 30.000 | -8125248.000 / 21263112.000 / 21263112.000 → -4341616.000 / 23014496.000 / 23014496.000 |

Bu tablolar instrumentation etkisi/teşhis örnekleridir, optimizasyon kazancı değildir. n6 p95/p99 sample maximum. CPU/heap gerçek Node ölçümü olsa da iş yükü sentetiktir; GC/setup/compiler ve diğer kullanıcı süreçlerinin etkisi tam izole değil. Warm cache gerçek provider fresh TTL anlamına gelmez. Yeni fiziksel dış hava fetch **0**. 304, stale, unknown/partial, outside horizon, injected429/503, cancel/deadline paired error/result kontrolleri 24/24 PASS; wire HTTP status→WeatherUnavailable dönüşümü bu fixture'da taklit sınırında, gerçek network JSON decode/headers burada ölçülmedi. Gerçek PG fencing/owner-race A/B **NOT_RUN**, JS mutex modeli PG kanıtı değildir.

### Süreleri çifte saymama

Her get için tamamlanan child span'leri get foreground penceresine clip edip örtüşmeyen coverage partition üretildi; floating aritmetik toplam farkı en fazla yaklaşık 1e-11 ms. Bu yalnız timer-accounting hassasiyetidir; forecast/SOC toleransı değildir. Ayrı [batch coverage](cr-lat-002-2026-11-16/acquisition-coverage.json) aynı event union'ını kullanır; eşzamanlı kategoriler overlap_unattributable olur, kalan süre unattributed. 108 observed known-flow coverage sonucu wall'ı 1e-8ms clock-accounting toleransında aşmaz. Overlap bir bileşene zorla atanmaz.

**Per-job causal critical-path ayrışımı NOT_MEASURED**: birden çok key/iş örtüşür; cancellation sonrası detached owner işi vardır. Coverage occupancy; PG/network/lease için exclusive neden payı değildir. Fixture pool connect/SQL/transport/parse-validation/selection/retry span'leri gerçek üretim PG/network süreleri yerine konulamaz. İptal sonrası tail raw trace'de ayrı kalır, foreground wall'a eklenmez. 18,6/72,1 saniyelik eski işlerin PG pool wait/SQL decode/lease/pacing/coalescing/selection exclusive bileşenleri halen NOT_MEASURED. Cache acquisition 35,5/143,1s inclusive toplamları wall'ı aşabilir; acquisition−HTTP =PG wait hesabı yapılmadı.

## 5. Gerçek PostgreSQL: yalnız izinli read-only kontrol

Explicit TEST_DATABASE_URL **false**. Bu görev yeni schema/migration/reset/drop yasağını korudu; gerçek weather PG mutation fixture veya B A/B kurulmadı. Mevcut DB'de BEGIN READ ONLY /SELECT1 /dokuz sentetik nonmatching-key native cache SELECT /EXPLAIN ANALYZE+BUFFERS /aggregate /ROLLBACK yapıldı. Konum, document body, provider query veya customer key kanıta alınmadı.

Read-only connection acquisition **225.141 ms** (ilk bağlantı/handshake dahil; contention ölçümü değil). Miss SELECT roundtrip p50/p95/p99 **1.781 / 133.502 / 133.502 ms**, n9; query EXPLAIN execution **0.955 ms**, PK index scan görüldü. Ana tablo snapshot'ı 435 row, 435 representation, 0 fresh ve 0 active lease; bu geçmiş job anındaki cache hali değildir. Tek missing-key okuması document decode, yoğun pool, provider lock/lease veya backoff beklemesini kanıtlamaz. Gerçek koşulda fresh-hit parse/decode ve claim concurrency ayrımı **NOT_MEASURED**. Açık lisans/provider koşulları, user-agent ve limitler gevşetilmedi; MET Norway'ye test trafiği yok.

## 6. Altı sorunun açık cevabı ve B kararı

1. **18,6/72,1s'nin hangi alt bileşeni baskın?** Tarihi kanıt yalnız weather port acquisition'ın baskınlığını gösterir; HTTP inclusive toplam 4,330/17,443 s. Gerçek PG/lease/pacing exclusive payı belirlenmedi. 33/128×500ms bir hipotez olarak kalır; ölçülmüş 63,5s pacing beklemesi yazılmadı.
2. **34k/45k item ve miss neden büyük?** Segment başına ETA query +state/leg/charge yeniden değerlendirmesi; batch spatial/URL dedup, session cache ve farklı bütçe birimleri nedeniyle item≠key≠get≠SQL≠HTTP. Miss ilk acquire denemesidir, tekrar aynı key veya exhausted per-job budget ile HTTP'siz artabilir. Exact geçmiş unique-key/retry/fallback dağılımı raw trace olmadan NOT_MEASURED; 3 koridor varsayılmadı.
3. **ETA ve series freshness?** Full queries checksum ETA/sample metadata'yı kapsar; series cache provider/version/canonical URL'e bağlı, normalize her yeni validAt'i coverage/gap/vector wind/source-age ile seçer. 304 fetchedAt/body korunur, validatedAt değişir. TTL fresh olmak kaynak forecast yaşının taze olduğunun garantisi değildir. Terrain risk/actual sampledLocation/lisans korunur; final forecast veya ETA yuvarlatılarak reuse yapılmadı.
4. **Gerçek HTTP/PG sayısı azaldı mı?** **Hayır; aktif tasarruf 0.** Yeni network çağrısı 0; read-only miss ölçümü tek başına sayısal optimizasyon kazancı değildir. Model counter'ı gerçek kapasite sayılmadı.
5. **En düşük riskli optimizasyon kanıtı?** Henüz yok. İlk güvenli adım regresyonun deterministic kapanışı ve order-safe passive gözlemci; ardından açıkça izinli, ayrı PG fixture'da fresh read/deserialize ve claim reason timer'ları. Bounded read batching ancak gerçek SQL/wait baskınlığı ve key/expiry/lease/fence/attribution eşdeğerliğiyle aday olabilir. Yeni cache katmanı, pacing gevşetme veya final forecast/energy/charging atlama önerisi aktive edilmedi.
6. **Üç timeout?** Orijinal Jest hedefli tekrar FAIL; fresh native izolasyon functional9/9 fakat timing8/9, current test paketi aşağıda. Pending promise overlap ölçüldü; sorunun 'önemsiz eski test' olduğu söylenmedi. Gate kırmızı.

**B NOT_RUN / NO-GO.** Önceden kullanıcı belgesindeki örnek eşikler B için geçerli aday kapısı olarak kaydedilir: >=%10 gerçek awaited weather kazanımı, tekrarlanabilir total-plan wall iyileşmesi, tam outcome/replay/order/quality/ownership eşdeğerliği, tutarlı >%5 p95 regresyonu olmaması ve full regresyon PASS. Şu anda giriş şartları karşılanmıyor; optimum aday veya >=5000-user QPS güvenliği iddia edilmez. Gerçek Android paint ve gerçek hava networkü NOT_RUN. Sonraki karar kullanıcıdadır, 007/008'e geçilmedi.

## 7. Güncel testler, değişiklikler ve rollback

| Komut | Durum | Güncel sonuç |
|---|---|---|
| `pnpm.cmd --filter @chargeroad/shared test` | PASS | ℹ tests 41; ℹ pass 41; ℹ fail 0; ℹ skipped 0 |
| `pnpm.cmd --filter @chargeroad/mobile test` | PASS | ℹ tests 80; ℹ pass 80; ℹ fail 0; ℹ skipped 0 |
| `pnpm.cmd --filter @chargeroad/api test` | FAIL | Test Suites: 1 failed, 14 skipped, 58 passed, 59 of 73 total; Tests:       3 failed, 154 skipped, 1025 passed, 1182 total |
| `pnpm.cmd -r typecheck` | PASS |  |
| `pnpm.cmd --filter @chargeroad/api build` | PASS |  |
| `pnpm.cmd --filter @chargeroad/mobile build` | PASS |  |
| `git diff --check` | PASS |  |
| `pnpm --filter @chargeroad/api test:db` | NOT_RUN | No explicit separate TEST_DATABASE_URL; task forbids new migration/reset/drop. No DATABASE_URL mutation fallback used. API non-DB regression run instead. |

Bu çalışmada ayrı explicit TEST_DATABASE_URL yok ve yeni migration/reset/drop yasak; test:db **NOT_RUN**. DATABASE_URL ile yazan fallback yapılmadı. API non-DB mevcut test komutu çalıştı; DB senaryoları skipped olarak ayrı sayıldı, PASS sayılmadı. LAT-001'in 1179 PASS'i tarihsel referanstır. Yeni çalışmanın regression FAIL'i varsa aynen korunur. Mobil/shared ve typecheck/API build/Expo export sonuçları günceldir; export cihaz kabulü değildir. Opt-in promise probe build sonrası yeni CJS dosyasıdır, uygulamaya import edilmez.

Tüm başlangıç dosyaları korundu; yeni dependency/feature-flag runtime değişikliği yok. Production rollback gerekmiyor. Deneyler varsayılan uygulama yoluna bağlanmadı; kaldırma ihtiyacı varsa sadece bu yeni tanılama dosyaları ayrı review ile ele alınır, reset/clean kullanılmaz. Başarısız hazırlık/strict order kayıtları ve full failure stack silinmedi/normalize edilmedi. JSON'lar yalnız source/fixture hash, sentetik kimliksiz aggregate, sayaç, süre ve kaynak stack içerir; raw GPS/SOC/route/provider packet/HTTP query/credential/IP yoktur.

Kanıt: [başlangıç](cr-lat-002-2026-11-16/start.json), [regresyon kaynağı karşılaştırması](cr-lat-002-2026-11-16/baseline-comparison.json), [Jest](cr-lat-002-2026-11-16/original-jest.json), [CPU](cr-lat-002-2026-11-16/jest-cpu-summary.json), [sampling](cr-lat-002-2026-11-16/sampling-tree.json), [acquisition özeti](cr-lat-002-2026-11-16/acquisition-analysis.json), [coverage](cr-lat-002-2026-11-16/acquisition-coverage.json), [PG read-only](cr-lat-002-2026-11-16/pg-readonly.json), [checks](cr-lat-002-2026-11-16/checks.json), [koruma/kapanış](cr-lat-002-2026-11-16/closure.json). trace-v2 raw üç süreç JSON'u ve native-* dokuz tekrar aynı dated dizindedir.
