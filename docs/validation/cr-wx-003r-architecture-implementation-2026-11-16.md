# CR-WX-003R — Üretim mimarisi uygulaması ve kabul kararı

2026-11-16 · Branch: **experiment/performance-optimization** · **Karar: NO-GO.** Kod gerçek üretim yürütüm yoluna bağlandı; varsayılan **legacy**. Atlas düşük eşzamanlılıkta aynı sonucu daha az seri parse/lookup ile üretse de 100 işte kritik sonuç eşdeğerliği geçmedi. Adaptive soğuk 600 km hedefini geçmedi. Otomatik deploy/rollout, commit/push veya main merge yapılmadı. Aktif üretim tasarrufu **0**.

## Başlangıç, kapsam ve koruma

Yerel HEAD 6a297e7b87edce36d4b4d29a29c07a059b7fb431; başlangıç temiz, yerel main/origin-main aynı commit idi. Başlangıçta **706** nonignored dosyanın raw SHA-256, branch/status ve dirty diff hash’i artifacts/cr-wx-003r-2026-11-16/start.json içine yazıldı. Önceki 670/627 sayıları tekrar kullanılmadı. Eski 001–006/LAT-001/002/002R raporları, FAIL, golden ve replay dosyaları değişmedi. Kapanış manifesti closure.json içindedir.

Mevcut dosyalarda değişenler:

Çalışma sırasında dışarıdan eklenen CLAUDE.md ve _claude_setup/ bu göreve ait değildir; içeriklerine müdahale edilmedi. Kapanış envanterinde görünmeleri sahiplenildikleri anlamına gelmez. Güncel kapanış hash manifesti artifacts/cr-wx-003r-2026-11-16/closure-v2.json; ilk closure.json belgenin bu sahiplik notundan önceki halini korur.

- apps/api/src/energy/energy-engine.ts
- apps/api/src/planning/ev-planning.service.ts
- apps/api/src/planning/planning-replay.ts
- apps/api/src/planning/planning-session.ts
- apps/api/src/providers/weather-provider.ts
- apps/api/src/weather/weather.service.ts
- packages/shared/src/contracts/road-weather.ts

Yeni üretim dosyaları weather/weather-atlas.ts ve weather/adaptive-weather-sampler.ts. Yeni testler weather-atlas, weather-atlas-service, adaptive-weather, adaptive-energy-safety, weather-mode-replay.spec.ts. Synthetic fixture weather/validation/weather-experiment-fixture.ts; benchmark/probe/summarize-weather-atlas scriptleri gerçek servisleri kullanır. Başka optimizer/road/charging uygulaması kopyalanmadı. Yardımcı SQL modeli açıkça MODEL’dir, gerçek PostgreSQL’in yerine kanıt sayılmaz.

WeatherCacheStore, SQL/HMAC key, transaction, kota/lease/token-generation fence, HTTP parser ve retry/backoff kodları **değişmedi**. Redis/queue/microservice/migration yok. DB’ye yazma, cache flush, volume silme, servis restartı, env/lockfile değişikliği yapılmadı. Önceki NO-GO enerji cache/geometri index/heap/2s polling açılmadı. CR-ROUTE-001 ve CR-PERF-007 başlatılmadı.

## Önce / sonra yürütüm akışı

Legacy: EvPlanningService → PlanningSession → her farklı tam query/ETA checksum’u → WeatherService → batch içi seriesByUrl → WeatherCacheStore → PostgreSQL read/claim → HTTP → parse → her segmentte normalize → energy/charging. Bu yol varsayılan olarak korunur.

Atlas: aynı session bir WeatherAtlas sahiplenir; WeatherForecastContext içindeki opsiyonel seriesScope WeatherService’e iletilir. Anahtar JSON [adapter.id, adapter.version, adapter.url(weatherSampleLocation)]’dur. Mevcut MET product sürümü adapter.version içinde, endpoint/product query de canonical URL içindedir. Query ID, segment ID, validAt, araç veya SOC key’e eklenmez. Yeni URL yine aynı CacheStore/PG otoritesine gider; diğer instance’lar için yeni bir L1/lock otoritesi oluşturulmaz.

L1 yalnız doğrulanmış ForecastSeries saklar. Source parse validation callback’inin sonucu, aynı fetch için tekrar parse edilmeden kullanılır; PG hit’inde bir parse yapılır. Series kopyalanıp deep-freeze edilir; her yeni query kendi normalizeWeather çağrısını alır. Temp/vector wind/pressure, gerçek ETA, coverage/gap, source age, provenance ve attribution hesapları aynen sürer. normalizeWeather ve energy-physics dosyaları değişmedi.

Sınırlar: en fazla 128 entry/pending key, LRU fulfilled-entry eviction, 8 MiB **serialized series ağırlığı**. Bu toplam JS heap limiti değildir; retained raw data sayısı/ağırlığı sınırıdır. Pending entry gerekirse budget_exhausted ile reddedilir. Source-age veya document expiry geçersizse L1 yeniden kullanmaz; rejected promise silinir. In-flight join ilk caller’ın iptaliyle diğerini kesmez. Owner signal job deadline ve 30s üst sınırına bağlıdır; CacheStore’daki bağımsız 5s fetch/save ve fencing aynı kalır. Plan sonunda finally dispose tüm L1 referanslarını temizler. Yeni nesne constructor’da eager fetch yapmaz; ancak optimizer’ın mevcut tam-leg forecast talebi hâlâ tüm leg’i isteyebilir.

Aynı plan ortasında mod değiştirilmez: EvPlanningService bir kez mode seçer, PlanningSession bunu saklar. WEATHER_EXECUTION_MODE yalnız atlas / atlas_adaptive değerlerini kabul eder; missing/invalid değer legacy’dir. Public request DTO’suna mod parametresi eklenmedi. Test/batch süreçleri kendi environment’larında kontrollü olarak değişir; uygulamanın .env dosyası değişmez.

Replay: yeni v2 sampling kaydı varsa replayOptimizer bunu kaydedilmiş query metadata’sından çıkarır. Güncel server env flag’iyle eski planı yeniden yorumlamaz. Eski v1/atlas kayıtları legacy reconstruction yolunu korur. Replay sonunda scope dispose edilir. Paket/golden overwrite edilmedi; yeni mode/replay testleri ve probe round-trip karşılaştırmaları eklendi.

## Adaptive v2 — uygulandı, kabul edilmedi

Yalnız atlas_adaptive: 1 km road/energy segmentleri, hız, grade, bearing, passage ETA değişmez. Bilinen motorway/primary + modelled/verified DEM + düşük lokal relief/grade + komşu heading farkı <=15° ise yakın bölümde 35 km hedeflenir. Future hedef 25 km. Kanıtı eksik normal bölüm 15 km’ye düşer; bu, hedefteki 25 km’den daha konservatiftir. İlk/son 10 km ve charging-access yakınları 10 km; düşük SOC (reserve+15) veya refinement 5 km. Kapasite/katalog tüketiminden range referansı ve (SOC−reserve) yalnız detay harcanacak reserve-risk bölgesini seçer; erişilebilirlik tasdik edilmez. Legacy detailed horizon/range scaffold korunur.

Shared schema’da range-adaptive/2.0.0 açık bir union dalıdır; v1 near=15000 zorunluluğu değişmedi. v2 interval yalnız 5/10/15/25/35 km; max geodesic offset interval/2 ve her durumda <=17.5 km. 35 km yalnız homogeneous/near-term olabilir; future <=25 km, critical <=15 km. Provider truncation için önceki 30 m payı korunur, sınırsız tolerans yok. Route-anchor along-road uzaklığı da kontrol edilir: karşı kıyı/dönüş kolunda geodesically yakın ama yol boyunca uzak nokta exact midpoint’e düşer.

Unknown DEM ve uzak/uygunsuz örneklerde exact fallback; v2 source elevation ile terrainSharingIsSafe tekrar kontrol edilir. Energy engine bağımsız olarak sample distance/provenance/coverage yanında >30m paylaşımda DEM/elevation farkı <=100m, homogeneous road quality/grade/access koşullarını denetler. Matematik/charging eğrisi değiştirilmedi. Yeni coğrafi interpolasyon eklenmedi; nearest-sample hata sınırı saha verisiyle kanıtlanmış değildir.

İlk hava+enerji değerlendirmesi ön sonuçtur. Core quality yetersizse, komşu vektör rüzgâr farkı >10 km/h veya sıcaklık farkı >3°C ise ya da estimated leg rezerv+5pp altına yaklaşıyorsa bir kez 5km refine ve tam energy reevaluate yapılır. Sonuç bu aşama bitmeden optimizer’a verilmez. Sonsuz refinement veya ikinci optimizer yok. E2 planlarında adaptive_weather_accuracy_unverified, gerektiğinde adaptive_weather_refined_once kayıtları kalır. Bağımsız high-resolution weather-grid/gözlem olmadan **ACCURACY_UNVERIFIED / FIELD_ACCURACY_NOT_RUN**.

## Deney tasarımı ve veri düzeltmeleri

Gerçek EvPlanningService + PlanningSession + optimizer + energy + charging + WeatherService + WeatherCacheStore + weatherTransport kullanıldı. Soğuk testlerde gerçek HTTP GET/JSON/header yolu yalnız sahip olunan 127.0.0.1 stub server’a gitti; api.met.no veya ücretli provider’a benchmark trafiği yok. DB pool SQL sınırı immutable önceki JS SQL modeliyle çalıştı: gerçek PG query/lock/lease kapasitesi değildir. 500ms pacing, concurrency=2, daily=1000, per-plan 128 acquisition ve bütün owner/fence SQL kuralları değiştirilmedi.

Graph fixture v4: synthetic 80kWh araç, 20kWh/100km @100km/h kaynak referansı, 120/600/850 km 1km segmentler, üç sentetik istasyon; dağ, headwind→tailwind ve reserve vakaları. Kaynak alanları/generated weather açıkça sentetiktir; gerçek Hyundai veya kişisel rota testi değildir. maxStates=2 aynı bounded iş yükünü korur; bazı uzun/riskli legacy vakaları da plan üretmez. maxComputation=120s yalnız fixture isteğidir; production default değiştirilmedi. 850 km/diğer baseline failure’dan gerçek yolun fiziken imkânsız olduğu çıkarılamaz.

ABCCBA (legacy–atlas–adaptive–adaptive–atlas–legacy), cold ve warm ayrı, her mode/cohort n=2. Sonrasında warm 10/25/100 job cohort’ları n=1. P50/p95 nearest-rank; n=2’de p50 alt gözlem, p95 maksimumdur. Bu örneklem SLA veya istatistiksel production GO için yeterli değildir; deterministik kabul kusurlarını/red kararını gösterir. Windows process CPU accounting kaba scheduler çözünürlüğündedir; heapDelta GC’den etkilenir, peak heap değildir. Arka plan kullanıcı servisleri durdurulmadı.

İlk çalışma host suspension sırasında saatler düzeyinde sıçradı: interruption.json ve ilk measurements.jsonl korunur; **NOT_COMPARABLE**. final/ turunda >150s ölçüm environment interruption olarak reddedilir; bu turda böyle bir kayıt yoktur. İlk smoke v1–v3’te fixture condition-matched speed/rain eksikleri bulundu; engine gevşetilmedi, dry ve speed-matched sentetik input ayrı sürümlendi. Eski smoke FAIL’leri silinmedi.

İkinci veri denetiminde preseeded warm document’ın fetchedAt/validatedAt/Last-Modified alanlarının eski fixture tarihini taşıdığı görüldü. final/ altındaki ilk warm kohortlar kabul tablosundan çıkarıldı; yeni warm-audit/ turu aynı source epoch ile tekrar çalıştı. Sadece bu fixture metadata’sı düzeltildi. Soğuk HTTP yolu document.body ve kendi explicit header’larını kullanır: 18 body parity örneği PASS; üretim core kaynak hash’leri iki turda aynı (PASS). Eski warm veriler overwrite edilmedi. warm-source-correction.json hem eski/yeni fixture hash’ini hem ayrımı kaydeder.

## E0 / E1 / E2 sonuçları

Aşağıdaki süreler gerçek planner service metriğidir; batch wall ayrıca fixture kurma ve proof hash maliyetini içerir. Başarısız planda süre, kullanılabilir plan süresi değildir. First usable planner result yalnız planned vakalarda ölçülür; HTTP job teslimi/telefon paint **NOT_RUN**.

| Case / cache | Mode | Planner p50 / p95 s | Physical GET | Cache.get p50 | Parse p50 | Planned / örnek |
|---|---|---:|---:|---:|---:|---:|
| short / cold | legacy | 5.947 / 5.994 | 9 | 70 | 79 | 2/2 |
| short / cold | atlas | 5.537 / 5.581 | 9 | 9 | 9 | 2/2 |
| short / cold | atlas_adaptive | 13.669 / 13.848 | 22 | 22 | 22 | 2/2 |
| short / warm | legacy | 0.900 / 1.041 | 0 | 70 | 70 | 2/2 |
| short / warm | atlas | 0.256 / 0.258 | 0 | 9 | 9 | 2/2 |
| short / warm | atlas_adaptive | 0.362 / 0.440 | 0 | 22 | 22 | 2/2 |
| motorway600 / cold | legacy | 22.982 / 23.755 | 35 | 179 | 214 | 2/2 |
| motorway600 / cold | atlas | 21.900 / 22.122 | 35 | 35 | 35 | 2/2 |
| motorway600 / cold | atlas_adaptive | 91.930 / 92.411 | 128 | 362 | 128 | 0/2 |
| motorway600 / warm | legacy | 2.197 / 2.234 | 0 | 179 | 179 | 2/2 |
| motorway600 / warm | atlas | 0.806 / 0.807 | 0 | 35 | 35 | 2/2 |
| motorway600 / warm | atlas_adaptive | 2.522 / 2.524 | 0 | 264 | 264 | 2/2 |
| long850 / cold | legacy | 27.376 / 29.738 | 45 | 175 | 220 | 0/2 |
| long850 / cold | atlas | 28.198 / 29.409 | 45 | 45 | 45 | 0/2 |
| long850 / cold | atlas_adaptive | 104.102 / 109.440 | 128 | 520 | 128 | 0/2 |
| long850 / warm | legacy | 1.835 / 1.911 | 0 | 175 | 175 | 0/2 |
| long850 / warm | atlas | 0.651 / 0.684 | 0 | 45 | 45 | 0/2 |
| long850 / warm | atlas_adaptive | 1.993 / 2.113 | 0 | 235 | 235 | 0/2 |
| mountain / cold | legacy | 24.317 / 24.826 | 35 | 179 | 214 | 2/2 |
| mountain / cold | atlas | 22.911 / 22.935 | 35 | 35 | 35 | 2/2 |
| mountain / cold | atlas_adaptive | 97.599 / 104.082 | 128 | 467 | 128 | 0/2 |
| mountain / warm | legacy | 2.236 / 2.516 | 0 | 179 | 179 | 2/2 |
| mountain / warm | atlas | 0.818 / 0.903 | 0 | 35 | 35 | 2/2 |
| mountain / warm | atlas_adaptive | 1.309 / 1.456 | 0 | 167 | 167 | 0/2 |
| wind_shift / cold | legacy | 23.873 / 24.178 | 35 | 118 | 153 | 0/2 |
| wind_shift / cold | atlas | 23.072 / 23.199 | 35 | 35 | 35 | 0/2 |
| wind_shift / cold | atlas_adaptive | 102.324 / 102.332 | 128 | 383 | 128 | 0/2 |
| wind_shift / warm | legacy | 1.424 / 1.518 | 0 | 118 | 118 | 0/2 |
| wind_shift / warm | atlas | 0.766 / 0.787 | 0 | 35 | 35 | 0/2 |
| wind_shift / warm | atlas_adaptive | 4.333 / 4.840 | 0 | 449 | 449 | 0/2 |
| reserve / cold | legacy | 20.674 / 22.420 | 35 | 115 | 150 | 0/2 |
| reserve / cold | atlas | 20.376 / 21.144 | 35 | 35 | 35 | 0/2 |
| reserve / cold | atlas_adaptive | 64.767 / 65.061 | 108 | 108 | 108 | 0/2 |
| reserve / warm | legacy | 1.256 / 1.421 | 0 | 115 | 115 | 0/2 |
| reserve / warm | atlas | 0.730 / 0.929 | 0 | 35 | 35 | 0/2 |
| reserve / warm | atlas_adaptive | 1.354 / 1.476 | 0 | 108 | 108 | 0/2 |

600 km için ek maliyetler (SQL yalnız MODEL):

| Cache / mode | SQL p50 | Weather foreground union p50 s | CPU user/system p50 ms | Heap delta p50 byte | Usable planner p50 s |
|---|---:|---:|---:|---:|---:|
| cold / legacy | 1896 | 22.390 | 1312.000 / 78.000 | -20218160 | 22.982 |
| cold / atlas | 1788 | 20.838 | 1219.000 / 62.000 | 8174760 | 21.900 |
| cold / atlas_adaptive | 8511 | 91.595 | 1094.000 / 94.000 | -46082360 | N/A |
| warm / legacy | 179 | 1.584 | 797.000 / 31.000 | 40135848 | 2.197 |
| warm / atlas | 35 | 0.290 | 734.000 / 0.000 | -2400352 | 0.806 |
| warm / atlas_adaptive | 264 | 1.792 | 1531.000 / 47.000 | -59029824 | 2.522 |

600 km cold: legacy/atlas **35/35 GET**, aynı tam outcome/weather hash; E2 **128 GET**, iki koşuda computation_limit. GET azaltma hedefi >=%25 sağlanmadı; kullanılabilir plan olmadığı için >=%20 median plan iyileşmesi de sağlanmadı. 600 km warm: atlas lookup/parse 179→35, planner p50 yaklaşık 2.197→0.806s; bu MODEL düşük-eşzamanlılık gözlemidir, global production hızlanması değildir. Adaptive warm p50 yaklaşık 2.522s ve p95 yaklaşık 2.524s; legacy p95 2.234s. Kaynak edinimini seyrekleştirmek mevcut implementation’da iş genelinde daha az URL ihtiyacına dönüşmedi.

Ayrı untimed warm cardinality probe: 600 km legacy/atlas/adaptive attempted canonical URL **35/35/260**. Her leg’in yeniden kurulan anchor/fallback noktaları ve tek 5km refine farklı URL setlerini büyütüyor. L1 aynı URL tekrarını önler; farklı yeni URL’leri birleştirmez. Cold 128 sayısını tek başına maxSamples’ın nedensel kanıtı saymıyoruz: per-plan acquisition/batch guard reject nedeni cold trace’de ayrı toplanmadı (**NOT_MEASURED**). Per-plan 128 default korunur; mümkün olan birçok hot-cache get’in HTTP bütçesi tüketmemesi sıcak/soğuk farkını açıklar.

## Eşzamanlılık ve eşdeğerlik kapısı

| Jobs / mode | Batch wall s | Planned / jobs | Failure codes | GET | SQL MODEL |
|---|---:|---:|---|---:|---:|
| 10 / legacy | 4.901 | 10/10 | none | 0 | 70 |
| 10 / atlas | 4.733 | 10/10 | none | 0 | 9 |
| 10 / atlas_adaptive | 5.180 | 10/10 | none | 0 | 22 |
| 25 / legacy | 12.119 | 25/25 | none | 0 | 70 |
| 25 / atlas | 11.807 | 25/25 | none | 0 | 9 |
| 25 / atlas_adaptive | 13.718 | 25/25 | none | 0 | 22 |
| 100 / legacy | 8.726 | 8/100 | NO_VALID_PLAN_WITHIN_DATA_BUDGET | 0 | 70 |
| 100 / atlas | 7.804 | 6/100 | NO_VALID_PLAN_WITHIN_DATA_BUDGET | 0 | 9 |
| 100 / atlas_adaptive | 8.220 | 5/100 | NO_VALID_PLAN_WITHIN_DATA_BUDGET | 0 | 22 |

Atlas ile düşük eşzamanlılıkta tam outcome + weather/replay hash’leri eşleşti. Ancak 100 job cohort’unda **33 kritik hash uyuşmazlığı** var. Legacy 8/100, atlas 6/100, adaptive 5/100 plan üretir. İlk job’da /result/status farkı da gözlenir; bunlar doğal elapsed alanı değildir, FAIL. Farklar normalize edilmedi/silinmedi. comparison.json hangi job indekslerinde olduğunu saklar.

100-cohort energy reason kayıtları legacy’de 91 ENERGY_INTEGRATION_BUDGET +1 ENERGY_COMPUTATION_DEADLINE, atlas’ta 75+19, adaptive’de 89+6 gösterir (her job için unique reason sayımları). Energy policy maxComputeMs=1500, maxSteps=200000 aynıdır. energy-engine.ts’de integration-budget kodu step-limit veya wall deadline için ortaktır; yük altında yield/CPU beklemesinin deadline’a yansımasıyla tutarlıdır, exclusive scheduler/queue payı ölçülmedi. Daha hızlı batch sonucu, daha doğru veya aynı plan sonucu anlamına gelmez. Bütçe artırılmadı, solver/energy scheduling değiştirilerek FAIL gizlenmedi. Legacy’nin de bu yükte başarısız olması yeni modu kabul ettirmez.

Native cache pendingAfter bütün ölçümlerde 0. Pending peak ve total process peak heap NOT_MEASURED. Model average QPS comparison.json içindedir; gerçek PostgreSQL p95/max QPS, pool/lock/lease bekleme ve iki API instance aynı key yarışı **NOT_RUN**. Açık, ayrı TEST_DATABASE_URL yok; DATABASE_URL mutating fallback veya migration yapılmadı. PG shared-cache/fence kodunun aynı olması gerçek multi-instance testin yerine PASS sayılmaz.

## Fiziksel/safety ve replay kanıtı

| Case / mode | Attempted URL | Fallback exact projections | Max offset m | Min synthetic SOC | Own-model reserve violations | Replay |
|---|---:|---:|---:|---:|---:|---|
| short / legacy | 9 | 0 | 7510.909 | 59.597 | 0 | PASS |
| short / atlas | 9 | 0 | 7510.909 | 59.597 | 0 | PASS |
| short / atlas_adaptive | 22 | 0 | 17503.558 | 59.597 | 0 | PASS |
| motorway600 / legacy | 35 | 0 | 12510.160 | 13.993 | 0 | PASS |
| motorway600 / atlas | 35 | 0 | 12510.160 | 13.993 | 0 | PASS |
| motorway600 / atlas_adaptive | 260 | 0 | 17509.736 | 13.993 | 0 | PASS |
| long850 / legacy | 45 | 2 | 12503.264 | N/A | N/A | NOT_APPLICABLE_NO_PLAN |
| long850 / atlas | 45 | 2 | 12503.264 | N/A | N/A | NOT_APPLICABLE_NO_PLAN |
| long850 / atlas_adaptive | 234 | 0 | 17488.770 | N/A | N/A | NOT_APPLICABLE_NO_PLAN |
| mountain / legacy | 35 | 0 | 12510.160 | 10.779 | 0 | PASS |
| mountain / atlas | 35 | 0 | 12510.160 | 10.779 | 0 | PASS |
| mountain / atlas_adaptive | 167 | 99 | 17509.736 | N/A | N/A | NOT_APPLICABLE_NO_PLAN |
| wind_shift / legacy | 35 | 0 | 12510.160 | N/A | N/A | NOT_APPLICABLE_NO_PLAN |
| wind_shift / atlas | 35 | 0 | 12510.160 | N/A | N/A | NOT_APPLICABLE_NO_PLAN |
| wind_shift / atlas_adaptive | 306 | 0 | 17509.736 | N/A | N/A | NOT_APPLICABLE_NO_PLAN |
| reserve / legacy | 35 | 0 | 12510.160 | N/A | N/A | NOT_APPLICABLE_NO_PLAN |
| reserve / atlas | 35 | 0 | 12510.160 | N/A | N/A | NOT_APPLICABLE_NO_PLAN |
| reserve / atlas_adaptive | 108 | 0 | 17509.736 | N/A | N/A | NOT_APPLICABLE_NO_PLAN |

Fallback projection sayısı HTTP sayısı değildir. Probe full native planner/service/engine yolunu kullanır; yalnız cache rows warm MODEL’dir. Plan bulunan 8 probe vakasında replay tam result hash eşleşti; plan olmayanlar N/A. Source temperature/wind direction/pressure min/max, elevation offset, source version/age/quality/license, energy kWh, final/minimum SOC ve stop order/station arrival sentetik SOC listeleri cardinality-final.json içindedir; ilk cardinality.json da korunur. Her successful planın kendi engine segmentleri rezerv altına düşmez; bu, bağımsız gerçek hava grid’ine karşı “0 false safe” veya <=1pp saha hatası kanıtı değildir. Bağımsız grid/ölçüm olmadığından false-safe ve 1pp doğruluk kabulü **NOT_RUN**.

Weather foreground union yalnız en az bir weather çağrısının aktif olduğu pencerelerin örtüşmesiz toplamıdır, causal critical path veya PG/network exclusive payı değildir. Nested toplamlar toplanmadı/HTTP acquisition’dan çıkarılmadı. PG pool/SQL decode, lease/pacing exclusive, normalize exclusive süreleri NOT_MEASURED. Eski 18.6/72.1s ve 33/128 HTTP geçmişi NOT_COMPARABLE kalır; bunlardan yeni işin pacing payı hesaplanmadı.

## Güncel kontroller

| Kontrol | Durum | Sonuç |
|---|---|---|
| pnpm.cmd --filter @chargeroad/api exec node -r ts-node/register/transpile-only scripts/probe-weather-atlas.cjs | PASS | Güncel çalıştırma |
| pnpm.cmd --filter @chargeroad/shared test | PASS | ℹ tests 41; ℹ pass 41; ℹ fail 0; ℹ skipped 0 |
| pnpm.cmd --filter @chargeroad/api exec jest --runInBand --runTestsByPath src/weather/__tests__/weather-atlas.spec.ts src/weather/__tests__/weather-atlas-service.spec.ts src/weather/__tests__/adaptive-weather.spec.ts src/weather/__tests__/adaptive-energy-safety.spec.ts | PASS | Test Suites: 4 passed, 4 total; Tests:       20 passed, 20 total; Time:        4.685 s, estimated 6 s |
| pnpm.cmd --filter @chargeroad/api test | PASS | 1055 PASS / 154 skipped / 0 FAIL |
| pnpm.cmd --filter @chargeroad/mobile test | PASS | ℹ tests 80; ℹ pass 80; ℹ fail 0; ℹ skipped 0 |
| pnpm.cmd -r typecheck | PASS | Tekrar PASS; ilk never[] test-helper hatası korundu |
| pnpm.cmd --filter @chargeroad/api build | PASS | Güncel çalıştırma |
| pnpm.cmd --filter @chargeroad/mobile build | PASS | Güncel çalıştırma |
| git diff --check | PASS | Güncel çalıştırma |
| db | NOT_RUN | No explicit verified separate TEST_DATABASE_URL. No production DATABASE_URL mutation fallback. |
| targeted-final | PASS | 5 suite / 24 PASS |

İlk typecheck’te async test helper results=[] çıkarımı never[] oldu; yalnız Awaited<ReturnType<WeatherService[forecast]>>[] annotation eklendi. typecheck.log FAIL ve tekrar typecheck-final.log PASS ayrı korunur; runtime kodu bunun için değişmedi. Son target 24 test, full API’den sonra eklenen 304 testini de içerir. Full API 1055, shared 41, mobile 80 test PASS; API/mobile build PASS. Build/typecheck logları ve checks-final.json ignored artifact dizinindedir. Expo export cihaz paint/nav testi değildir. Eski state-shadow 5s benchmark FAIL ve 9/9 isolated functional /1032 eski API referansları tarihsel kalır; bugünkü 1055 sonucu onlarla karıştırılmadı. 5s proof süresi production rota SLA değildir.

## Kapalı uçlu karar ve geri dönüş

- E1 veri/sonuç eşdeğerliği: düşük eşzamanlılık PASS, 100-job **FAIL**. E1 rollout **NO-GO**.
- E1 tekrar lookup/parse azalması: gerçek production kod yolunda MODEL/loopback gözlem PASS; gerçek PG net kazanım NOT_RUN. N=2 p95 SLA kabulü yok.
- E2 cold600 GET >=%25 azalması ve >=%20 median usable plan iyileşmesi: **FAIL**; 35 yerine 128 GET, kullanılabilir plan yok.
- E2 warm p95 material regression ve riskli vakalar: **FAIL / NOT_RUN**; bağımsız weather accuracy doğrulanmadı.
- İki instance PostgreSQL/fencing, independent grid/field/real-device: **NOT_RUN**.
- Güncel normal regression/typecheck/build: **PASS**. Bu, performans/safety gate’lerini yeşile çevirmez.

**Sonuç NO-GO; GO_FOR_CONTROLLED_PILOT verilmedi.** Kod flag-gated ve legacy default’ta bırakıldı. WEATHER_EXECUTION_MODE=legacy veya değişkenin olmaması eski yolu seçer; invalid da legacy olur. Bu görevde çalışan servis yeniden başlatılmadı/env dosyası değiştirilmedi. Daha kapsamlı kod rollback’i gerekirse yalnız bu branch’in diff’i ayrı review ile ele alınır; otomatik reset/stash/checkout/main merge yapılmaz. Main commit’i korunur. Yeni belirsiz görev açılmadı; uygulanmış aday, ölçülmüş başarısızlık ve eksik kabul kapıları bu raporla kapalı şekilde teslimdir.

Tüm ham JSON/log/source hash kanıtları ignored **artifacts/cr-wx-003r-2026-11-16/** dizinindedir: start/closure, interruption, final/run-metadata ve benchmark, warm-audit/run-metadata ve benchmark, warm-source-correction, comparison, cardinality/cardinality-final, checks/checks-final, targeted-final/typecheck-final logları. Tam forecast/plan payload’ı veya gerçek GPS/SOC/token/IP/kullanıcı kimliği loglanmadı; sayılar sentetik vaka istatistikleridir.
