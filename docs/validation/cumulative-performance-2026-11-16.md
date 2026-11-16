# CR-PERF-001–005 sonrası kümülatif ölçüm kapısı

2026-11-16 (Europe/Istanbul). **Güncel offline profil ve gözlenen eşdeğerlik: PASS. Kümülatif hızlanma kabulü: NO-GO; tarihsel baseline: NOT_COMPARABLE. Yerel/gerçek provider pilotu: NOT_RUN.** Üretim/saha/SLA kabulü verilmedi, CR-PERF-006 başlamadı.

## Başlangıç ve gerçek üretim durumu

HEAD **bf41840856a6e3c275665f8571483e9080cd7a3d**. Çalışma ağacı önceki CR-PERF-005 B dosyaları ve iki task durum güncellemesiyle dirty idi. Başlangıçtaki **565 dosyanın tamamı** korundu; mevcut dosya değişikliği **0**. Başlangıç status, HEAD, dirty diff SHA-256 ve dosya bazlı raw hash'ler [koruma manifestinde](cumulative-performance-2026-11-16/run1/preservation.json). Eski JSON/MD, golden/reference ve başarısız B deneyleri yeniden yazılmadı. Reset/clean/stash/checkout/commit/push yok.

| Görev | Güncel üretim yolu | Bu teslimde algoritmik tasarruf |
|---|---|---:|
| 001 | Varsayılan kapalı ölçüm altyapısı; açık/kapalı ayrı ölçüldü | 0 |
| 002 | Array.sort(compareStates)+shift; heap yalnız tarihsel helper/kanıt | 0 |
| 003 | Aday uygunluğu/call shadow yalnız metrics context açıkken | 0; aktif aday eleme yok |
| 004 | Bounded state shadow yalnız metrics context açıkken | 0; aktif pruning/dedup yok |
| 005 | Tekrar analizi ve başarısız offline proof; production cache yok | **0** |

Optimizer chargeroad-optimizer/1.2.0, energy chargeroad-energy/1.3.3, charging dc-curve-integration/1.2.0. Önceki B sonucu aynen korunur: 207 normal A/B +69 native anchor PASS, adversarial B1 FAIL, wall %23,62 yavaş / CPU %24,49 fazla /14/15 p95 regresyonu, B3 NOT_RUN. Yeni benchmark bu proof'u **import etmez veya monte etmez**. Yeni production optimizasyonu, flag/policy, bağımlılık, API/DTO, cache, veri yapısı veya migration yoktur.

## Deney, eşdeğerlik ve zaman kapsamı

Doğrudan mevcut EvPlanningService, PlanningSession, native ChargeStopOptimizer, gerçek EnergyConsumptionEngine/ChargingCurveEngine ve production response encoder kullanıldı. Provider'lar mevcut optimizerWorld(false) in-memory fixture'ıdır; fetch offline süreçte yasak. Aynı eski iki fixture türü, sabit 2026-11-13T09:00Z, aynı kaynak/quality profili; üç objective ve eksik profil/provider kota/AbortError/TimeoutError kontrolleri eklendi. Fixture factory eskiyle aynı mı: **true**. Her A/B aynı girdi/model/policy/saat; yeni session/cache. RNG/seed üretimi yok.

Üç bağımsız process; concurrency=1, her arm/grup **5 warmup**, **10 ABBA/BAAB blok**, **20 örnek/arm/process**, pooled **60 örnek/arm/grup**. 18 senaryo/objective grubu ×120 = **2160 ölçüm**. Ek **54 trace-enabled açık/kapalı çift** (18/process) headline timer'dan ayrı doğrulandı. Headline'da trace hash maliyeti yok; yalnız ortak lightweight fiziksel çağrı sayaç wrapper'ları vardır. Optimizere ait subclass trace kapalıyken doğrudan super.solve çağırır; algoritma kaynağı derlenmedi/kopyalanmadı/değiştirilmedi.

Her koşuda full outcome+envelope (elapsedMilliseconds dışında) deepStrictEqual; fixture ve output SHA-256, fiziksel port/engine çağrı sayıları kontrol edildi. Ayrı diagnostic çiftlerde state içeren drive/charge transition giriş sırası ve provider/energy/charging giriş sırası hash'leri eşleşti. Replay, validationInput, source/quality/unknown, budgets, skippedData, stop/reason metadata tam outcome kapsamındadır; raw veri artefaktlara yazılmadı. Metrik açık energy_evaluations/charge_integrations değerleri bağımsız gerçek engine wrapper sayılarıyla da eşleşti. İptal/timeout kontrolleri önceden abort edilmiş signal ile exception kimliğini doğrular; tüm canlı deadline/mid-flight zamanlama sınırlarının kanıtı değildir. Mevcut deadline/iptal testleri ayrıca test:db kapısında çalıştı.

**planWallMs** yalnız gerçek service.plan çağrısıdır. **wallMs** daha geniş harness kapsamıdır: service.plan + runtime envelope Zod doğrulaması + production encoding + decode/representation kontrolü. İkinci kapsam HTTP/socket gecikmesi değildir ve ek decode kontrolünü içerir; iki süre ayrı raporlanır. CPU user/system bu daha geniş timer aralığındadır. Fixture yapımı, checksum/normalize/hash ve diagnostic trace dışarıdadır. Actual wire boyutu gzip varsa gzip, yoksa sıkıştırılmamış body boyutudur. Doğal elapsed alanı byte uzunluğunu değiştirebilir; ham gzip byte eşitliği iddia edilmez, decode edilmiş normalize içerik eşleşir.

## Güncel planlama wall profili

Her hücre p50 / p95 / p99 **ms**; arm başına n=60. Error kontrollerinin küçük süreleri tam hata HTTP response süresi değildir.

| Senaryo / objective | Sonuç | Metrics OFF service.plan | Metrics ON service.plan |
|---|---|---:|---:|
| no_charge / minimum_total_duration | planned | 42.545 / 57.436 / 73.950 | 43.089 / 55.231 / 68.856 |
| no_charge / minimum_charging_stops | planned | 33.158 / 46.684 / 50.011 | 34.184 / 49.175 / 55.446 |
| no_charge / minimum_energy | planned | 84.219 / 110.394 / 145.915 | 86.065 / 103.313 / 136.907 |
| two_partial_charges / minimum_total_duration | planned | 62.864 / 86.698 / 106.534 | 64.870 / 80.588 / 104.785 |
| two_partial_charges / minimum_charging_stops | planned | 63.415 / 79.370 / 96.200 | 63.908 / 80.190 / 90.556 |
| two_partial_charges / minimum_energy | planned | 65.410 / 98.695 / 158.421 | 66.462 / 91.664 / 107.694 |
| missing_profile / minimum_total_duration | insufficient_data | 0.369 / 1.295 / 1.789 | 0.412 / 1.123 / 1.745 |
| missing_profile / minimum_charging_stops | insufficient_data | 0.337 / 0.972 / 1.379 | 0.357 / 0.993 / 1.481 |
| missing_profile / minimum_energy | insufficient_data | 0.339 / 1.008 / 1.272 | 0.355 / 1.085 / 1.350 |
| provider_quota / minimum_total_duration | provider_error | 0.409 / 1.244 / 2.258 | 0.465 / 1.224 / 1.398 |
| provider_quota / minimum_charging_stops | provider_error | 0.438 / 1.230 / 2.042 | 0.431 / 1.184 / 1.339 |
| provider_quota / minimum_energy | provider_error | 0.440 / 1.327 / 1.827 | 0.440 / 1.608 / 2.325 |
| abort / minimum_total_duration | AbortError | 0.028 / 0.104 / 0.240 | 0.025 / 0.113 / 0.159 |
| abort / minimum_charging_stops | AbortError | 0.031 / 0.078 / 0.118 | 0.029 / 0.081 / 0.106 |
| abort / minimum_energy | AbortError | 0.034 / 0.083 / 0.163 | 0.028 / 0.088 / 0.224 |
| timeout / minimum_total_duration | TimeoutError | 0.031 / 0.114 / 0.181 | 0.030 / 0.093 / 0.128 |
| timeout / minimum_charging_stops | TimeoutError | 0.028 / 0.078 / 0.118 | 0.026 / 0.080 / 0.092 |
| timeout / minimum_energy | TimeoutError | 0.027 / 0.070 / 0.104 | 0.025 / 0.079 / 0.089 |

| Başarılı senaryo / objective | OFF geniş harness wall p50/p95/p99 ms | ON geniş harness wall p50/p95/p99 ms | ON p50 overhead % | Toplam CPU user/system OFF → ON ms (60 run/arm) |
|---|---:|---:|---:|---:|
| no_charge / minimum_total_duration | 43.089 / 58.129 / 74.671 | 43.761 / 55.927 / 69.757 | 1.558 | 4999.000 / 96.000 → 4673.000 / 63.000 |
| no_charge / minimum_charging_stops | 33.695 / 47.515 / 50.620 | 34.741 / 49.863 / 56.173 | 3.104 | 4060.000 / 77.000 → 4327.000 / 30.000 |
| no_charge / minimum_energy | 84.769 / 111.171 / 146.586 | 86.681 / 104.070 / 137.594 | 2.255 | 7453.000 / 62.000 → 7564.000 / 252.000 |
| two_partial_charges / minimum_total_duration | 63.620 / 87.662 / 107.608 | 65.623 / 81.461 / 105.746 | 3.150 | 6262.000 / 156.000 → 6108.000 / 78.000 |
| two_partial_charges / minimum_charging_stops | 64.050 / 80.146 / 96.931 | 64.604 / 81.129 / 91.560 | 0.865 | 6082.000 / 47.000 → 5994.000 / 93.000 |
| two_partial_charges / minimum_energy | 66.158 / 99.501 / 159.720 | 67.254 / 92.803 / 110.052 | 1.656 | 6138.000 / 140.000 → 6345.000 / 93.000 |

Başarılı gruplarda gözlenen p50 instrumentation overhead **%0.865–%3.150**. p95 farkları her grupta aynı yönde değildir; yalnız pozitif/negatif tek quantile'dan neden veya hızlanma sonucu çıkarılmaz. On koşulu 001 ölçümüne ek olarak 003/004 gözlemcilerini de etkinleştirir; bunların bağımsız flag'i yoktur. Bu yüzden toplam on/off farkı yalnız observer maliyeti diye sunulamaz; aşağıda mevcut stage süreleri ayrı gösterilir. Logger gerçek sink I/O maliyeti NOT_RUN (in-memory sink).

| Senaryo / objective | OFF process 1/2/3 p95 geniş wall ms | ON process 1/2/3 p95 geniş wall ms |
|---|---:|---:|
| no_charge / minimum_total_duration | 53.049 / 58.129 / 58.999 | 56.650 / 55.391 / 55.920 |
| no_charge / minimum_charging_stops | 45.647 / 46.323 / 47.515 | 47.938 / 54.294 / 47.559 |
| no_charge / minimum_energy | 111.171 / 119.395 / 100.800 | 104.070 / 103.764 / 103.600 |
| two_partial_charges / minimum_total_duration | 87.274 / 84.597 / 98.815 | 79.817 / 78.894 / 87.893 |
| two_partial_charges / minimum_charging_stops | 76.755 / 80.583 / 77.426 | 79.153 / 81.705 / 75.253 |
| two_partial_charges / minimum_energy | 111.932 / 99.501 / 84.166 | 80.780 / 93.486 / 92.803 |

Nearest-rank kullanıldı; n=60'ta p99 **örnek maksimumu**dur. Her process n=20 p95/p99 değişkenliği ham JSON'da var; population tail veya servis SLA'sı değildir. win32 10.0.26200, 12th Gen Intel(R) Core(TM) i7-12700H, 20 logical CPU, Node v26.13.0; RAM 16869548032 byte. Diğer backend/Expo/kullanıcı süreçleri durdurulmadı; yük/GC/JIT/frekans/termal durum tam izole değildir. process.cpuUsage mikrosecond formatı Windows'ta gerçek çözünürlük garantisi değildir; kısa/sıfır/kuantize ölçüm yerine biriken user/system ve süreç farkları raporlandı.

## Ölçülen bileşenler ve arama

Aşağıdaki değerler **metrics-on plan başına stage total p50 ms**. Çağrıların iç içe süreleri inclusive'dir; sütunlar veya p50'ler toplanıp wall time oluşturulmaz. energy/charging async stage süreleri saf CPU attribution değildir. JSON tüm stage count/total/max örneklerini ve counters içerir.

| Senaryo / objective | energy evaluate | charging evaluate | sampleRouteWeather | plan compile | candidate eligibility | candidate call shadow | state shadow |
|---|---:|---:|---:|---:|---:|---:|---:|
| no_charge / minimum_total_duration | 21.306 | 11.627 | 0.760 | 1.929 | 0.011 | 0.194 | 0.155 |
| no_charge / minimum_charging_stops | 16.932 | 7.972 | 0.608 | 1.845 | 0.009 | 0.115 | 0.149 |
| no_charge / minimum_energy | 44.004 | 24.572 | 1.646 | 1.875 | 0.009 | 0.307 | 0.146 |
| two_partial_charges / minimum_total_duration | 31.534 | 17.616 | 1.123 | 2.429 | 0.010 | 0.271 | 0.108 |
| two_partial_charges / minimum_charging_stops | 30.598 | 17.813 | 1.128 | 2.771 | 0.010 | 0.250 | 0.105 |
| two_partial_charges / minimum_energy | 32.507 | 18.740 | 1.160 | 2.214 | 0.009 | 0.274 | 0.103 |

| Senaryo / objective | Gerçek energy / charging call (plan başına) | Sampler call/plan | Session road hit / toplam leg lookup | Session weather hit / toplam lookup | Frontier peak | Expanded / transitions | Stopped reason |
|---|---:|---:|---:|---:|---:|---:|---|
| no_charge / minimum_total_duration | 69 / 39 | 69 | 63 / 70 | 57 / 108 | 11 | 15 / 108 | frontier_exhausted |
| no_charge / minimum_charging_stops | 54 / 28 | 54 | 48 / 55 | 40 / 82 | 11 | 15 / 82 | frontier_exhausted |
| no_charge / minimum_energy | 145 / 99 | 145 | 139 / 146 | 162 / 244 | 11 | 15 / 244 | frontier_exhausted |
| two_partial_charges / minimum_total_duration | 109 / 74 | 109 | 104 / 110 | 126 / 193 | 8 | 12 / 193 | frontier_exhausted |
| two_partial_charges / minimum_charging_stops | 107 / 71 | 107 | 102 / 108 | 118 / 188 | 8 | 11 / 188 | frontier_exhausted |
| two_partial_charges / minimum_energy | 115 / 78 | 115 | 110 / 116 | 131 / 203 | 8 | 12 / 203 | frontier_exhausted |

Road hit oranı session leg lookup içindir; preparation base-road port çağrısını içermez. Weather hit oranı cache hit + gerçek forecast port çağrısı üzerinden; query-item sayısı veya gerçek HTTP sayısı değildir. Weather_sample_queries örnek query sayısıdır; sampler fonksiyon çağrısı weather_sampling.count ile ayrı raporlandı. Bu oranlar PG hit oranı değildir.

Frontier peak yalnız **8–11**; büyük frontier veya gerçek uzun rota performansı hakkında kabul verilmez. Frontier push/pop için mevcut native hook yok: **NOT_MEASURED**. Seed/incumbent update sayısı/ayrı süre hook'u yok: **NOT_MEASURED**; final incumbent presence ve tam transition/replay eşdeğerliği kaydedildi. ExpandedStates seed işini de içerdiğinden pop sayısı gibi kullanılmadı. Bunları ölçmek için production kodu değiştirilmedi ve benchmark algoritması yamalanmadı.

## HTTP, Valhalla ve PostgreSQL ayrımı

| Gösterge | Durum / yorum |
|---|---|
| Synthetic gerçek provider HTTP | **0 fiziksel istek**; road/weather port girişleri HTTP diye sayılmadı |
| Route / trace_attributes compute latency | **NOT_RUN**; summary.time sürüş süresidir ve latency tablosuna alınmadı |
| HTTP response/body parse | **NOT_RUN**; synthetic fetch yok, 0 ms iddiası yok |
| PG road/weather hit/miss/coalesced/wait/lease/kota | **NOT_RUN** (offline süreçlerde PG erişimi 0); metriklerdeki sıfırlar cache başarısı değildir |
| Local cold/warm pilot | **NOT_RUN**; [ADR-009](../adr/009-in-app-navigation-and-self-hosted-routing.md) DEM kaynak/lisans/sürüm manifestini ve kalıcı kabulü açık tutuyor. Bu görevde doğrulanmış bağımsız pilot namespace/runtime kabulü yok; cache/lease/kota kaydı veya servis temizlenmedi/değiştirilmedi |
| Geoapify/MET Norway/diğer dış provider | **NOT_RUN**; yük/kota/ücret tüketen çağrı yok |

Yerel pilotu eski rapordan kopyalamadık. Valhalla/OS cold state bu çalışmada bilinmiyor; PG cold olmak Valhalla cold demek değildir. Canlı network/PG darboğazının büyüklüğü bu sentetik ölçümden çıkarılamaz.

| Senaryo / objective | ON gerçek JSON byte min–max | ON gönderilecek body byte min–max | Gzip işlemi |
|---|---:|---:|---|
| no_charge / minimum_total_duration | 11897–11908 | 11897–11908 | NOT_RUN (<32 KiB) |
| no_charge / minimum_charging_stops | 11905–11907 | 11905–11907 | NOT_RUN (<32 KiB) |
| no_charge / minimum_energy | 11899–11901 | 11899–11901 | NOT_RUN (<32 KiB) |
| two_partial_charges / minimum_total_duration | 16438–16440 | 16438–16440 | NOT_RUN (<32 KiB) |
| two_partial_charges / minimum_charging_stops | 14413–14415 | 14413–14415 | NOT_RUN (<32 KiB) |
| two_partial_charges / minimum_energy | 16429–16432 | 16429–16432 | NOT_RUN (<32 KiB) |

Mevcut cevaplar 32 KiB compression eşiği altında; gzip reklam edilse de production encoder sıkıştırmıyor. Dolayısıyla body boyutu JSON boyutu; gzip latency/ratio **NOT_RUN**. Payload yapay olarak büyütülmedi. JSON serialization'ın ölçülen küçük stage süreleri summary/process JSON'larında var. Guard/admission/geocoding/job queue/socket/cihaz latency'si bu timer kapsamında değil.

## CPU, heap ve GC

| Process | Tüm workload CPU user / system ms | Heap başlangıç → explicit GC sonrası byte | Gözlenen GC event | Event süreleri toplam ms |
|---|---:|---:|---:|---:|
| 1 | 101265.000 / 1265.000 | 441662392 → 392396240 | 906 | 16698.926 |
| 2 | 102922.000 / 1485.000 | 441829288 → 392210552 | 907 | 16988.656 |
| 3 | 99406.000 / 1500.000 | 441831440 → 392913672 | 907 | 16453.587 |

Bu tüm-process CPU/GC; setup, warmup, hashing, diagnostics ve VM etkilerini de kapsar; yalnız engine CPU'su veya on/off tasarrufu değildir. Process JSON'larında event start/duration/kind, her run monotonic window/heapBefore/heapAfter ve summary'de on/off heap delta/GC overlap bulunur. GC observer delivery asenkron, 10.000 event limiti var; overlap yaklaşık gözlemdir, kesin attribution değildir. Explicit GC yalnız bloklar arasında, timed window dışında çağrıldı. Heap farkı veya GC sonrası daha düşük heap tek başına leak/tasarruf kanıtı değildir; instance başına retained cache yoktur.

## Tarihsel karşılaştırma ve kabul

**NOT_COMPARABLE:** eski HEAD c24cab249dc3cbebb29f11104fee95c04ca8d7fd; şimdiki HEAD farklı ve önceki dirty dosyalar korunuyor. Tarihsel checksum'ın JSON-string UTF-8 hash biçimi gözetildi; raw-file SHA ile yanlış karşılaştırılmadı. Eski sekiz kaynaktan değişenler: src/planning/ev-planning.service.ts, src/planning/planning-session.ts, src/planning/charge-stop-optimizer.ts, src/roads/road-client.ts. Fixture factory/saat/warmup örtüşmesi bu sürüm farkını kapatmaz. Eski çalışma 100 örnekli tek-process sıralıydı; yeni çalışma üç-process dengeli ve ek encoder kontrolü içerir. Envelope metadata'da gerçek algorithm sürümleri kullanıldı (eski harness fixture-energy/fixture-charging etiketliyordu). Eski production source ağacı güvenle yeniden kurulup izole A/B yapılmadı; eski kod devreye monte edilmedi.

Bu yüzden tarihsel before/after sayılarına göre yüzde hızlanma **hesaplanmadı**. 003/004 shadow ve 005 fail proof kazanç sayılmaz. İlk beş görev kapsamında kabul edilmiş aktif hesap/edinim tasarrufu **0**; yalnız üretimin şu anki profili ve ölçüm overhead'i raporlanıyor. Algoritmik kazanç olmadığından tüm farkları yalnız gürültüye veya yalnız instrumentation'a atfetmek de kanıtsız olur.

## Ölçüme dayalı sonraki inceleme öncelikleri

1. **Enerji hesaplarının alt maliyet profili:** ölçülen plan-başına median energy stage yaklaşık 16,9–44,0 ms ile en büyük ölçülen engine bileşeni. Schema parse/model/reference selection/physics ayrımı sonraki ölçüm adayıdır. Bu aralığın tamamı kazanılabilir CPU değildir; kalite/termal/regen/deadline korunmalı, başarısız 005 cache'i tekrar açılmamalı.
2. **Şarj hesaplarının alt maliyeti:** yaklaşık 8,0–24,6 ms median stage ve çok sayıda gerçek evaluate. Hedef/curve/integration/termal maliyeti ayrıştırılabilir; taper, uyumluluk ve state-time/provenance davranışının bozulması riski yüksek. Hiçbir pruning/değişiklik bu görevde yapılmadı.
3. **Canlı yol/cache profili:** local-only, kabul edilmiş DEM/runtime ve ayrı ölçüm namespace'i doğrulanınca bounded route/trace_attributes + PG pilotu; network wait/body/lease/kota ayrımını ancak bu ölçebilir. Potansiyel network kazancı şu an **bilinmiyor**, sayısal vaat yok.
4. **Sampler/shadow/serialization:** ölçülen küçük stage'ler; energy/charging kadar büyük gözlenen iş değil. Naive tam-key cache veya gzip zorlamak için kanıt yok. Queue yalnız küçük frontier'da görüldü, heap veya pruning için GO yok.

Bu maddeler implementasyon izni değildir. CR-PERF-006 dahil yeni task başlatılmadı.

## Tekrar çalıştırma, testler ve dosyalar

API dizininde node --expose-gc -r ts-node/register scripts/benchmark-cumulative-performance.ts --benchmark --tag=yeni-run2. Yeni tag kullanılır; exclusive-write eski kanıta dokunmaz. node/ts-node ve pnpm repo mevcut bağımlılıklarıdır; ek dependency yok.

| Kontrol | Durum | Güncel sonuç |
|---|---|---|
| `SELECT 1 (credential-quiet)` | PASS |  |
| `pnpm.cmd --filter @chargeroad/shared test` | PASS | 41/41 PASS |
| `pnpm.cmd --filter @chargeroad/mobile test` | PASS | 21/21 PASS |
| `pnpm.cmd --filter @chargeroad/api test:db` | PASS | Test Suites: 72 passed, 72 total; Tests:       1168 passed, 1168 total |
| `pnpm.cmd -r typecheck` | PASS |  |
| `pnpm.cmd --filter @chargeroad/api build` | PASS |  |
| `git diff --check` | PASS |  |

Credential yazdırmadan SELECT 1 ve mevcut test:db bootstrap incelendi. Entegrasyon testleri benzersiz schema/search_path kullanıp yalnız kendi schema'larını kapatır; kullanıcı kaynak şemasına genel reset/migrate/drop/seed/truncate uygulanmadı. Önceki 1168 sayısı yeni çalıştırmada yeniden doğrulandı; eski PASS kopyalanmadı. Konum/GPS/SOC/raw rota/token/IP veya raw provider/result payload loglanmadı.

- [JSON özet ve metrik kapsam açıkları](cumulative-performance-2026-11-16/run1/summary.json).
- [Process 1](cumulative-performance-2026-11-16/run1/process-1.json), [Process 2](cumulative-performance-2026-11-16/run1/process-2.json), [Process 3](cumulative-performance-2026-11-16/run1/process-3.json).
- [Yeni test kapıları](cumulative-performance-2026-11-16/run1/checks.json), [başlangıç/koruma manifesti](cumulative-performance-2026-11-16/run1/preservation.json), [nihai kapsam kararı](cumulative-performance-2026-11-16/run1/acceptance.json).

**Kapanış:** güncel offline ölçüm/eşdeğerlik PASS; kümülatif hızlanma kabulü NO-GO; eski baseline NOT_COMPARABLE; local/dış provider ve belirtilen native-hook metrikleri NOT_RUN/NOT_MEASURED. Üretim kodu değişmedi, kullanıcı dosyaları korundu, hiçbir servis yeniden başlatılmadı ve CR-PERF-006'ya geçilmedi.
