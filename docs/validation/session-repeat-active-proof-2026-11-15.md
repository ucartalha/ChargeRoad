# CR-PERF-005 Aşama B — aktif tekrar kullanım kanıt kapısı

**Karar: NO-GO.** Offline B1/B2 deneyi tamamlandı; aktif enerji cache'i üretime alınmadı. B1 adversarial prototype kontrolü FAIL; ölçülen net performans kapısı da geçmedi. Tüm deadline/zamanlama sınırlarında operasyonel eşdeğerlik ayrıca kanıtlanmış değil. B3 NOT_RUN; sampler/charging kapsamı genişletilmedi, CR-PERF-006 başlamadı.

İstenen dosya adı 2026-11-15'tir; gerçek yürütme tarihi Europe/Istanbul 2026-11-16. HEAD: bf41840856a6e3c275665f8571483e9080cd7a3d. Başlangıç main çalışma ağacı temizdi. Aşama A'nın eski HEAD/sayaçları ve 1121 test sonucu güncel baseline gibi kullanılmadı. Bu rapor yalnız aynı mevcut kaynak üzerinde native/bypass/proof karşılaştırmasıdır; 001–005 kümülatif hızlanma iddiası içermez.

## Deney ve korunan üretim yolu

Gerçek EnergyConsumptionEngine.evaluate, gerçek PlanningSession, coordinator, optimizer ve charging engine kullanıldı. Coordinator'ın değiştirilmemiş kaynağı bellekte derlenip yalnız session dependency'si proof subclass ile değiştirildi; algoritma kopyası veya ayrı solver yoktur. Native kontrol 69 baseline/amaç birleşiminde bu seam'e ankrajdır. Modül cache'i/prototipler global olarak yamalanmadı. Engine/provider/API/DTO/Zod/migration/sürümler ve mevcut road/weather cache semantiği değişmedi; sort+shift ve 003/004 shadow kaldı. Yeni validation dosyaları production build dışında, production import'u yoktur.

Namespace kaynak SHA-256 manifestine ve energy sürümüne bağlıdır. Lookup key'i hash değil; plain JSON input'un tamamını içeren, tip ayıran, yuvarlamasız canonical string'dir. Diagnostic SHA-256 maliyeti lookup maliyeti olarak sayılmadı. undefined/null/-0, dizilerin sırası, SOC hassasiyeti, zaman, model/araç sürümleri, kapasite/SOH, termal provenance, rota/geometri, hava/tazelik, policy ve hedef değişiklikleri key'e dahildir. Accessor/proxy/cycle/non-finite/sparse ve birçok special prototype grafik reddedilir; prototype guard tam değildir, aşağıdaki adversarial FAIL bunu kanıtlar.

Miss'te orijinal engine promise'i döner; sonuç write observer ile ayrı sahipliğe kopyalanır ve dondurulur. Her hit yeni mutable kopya alır. Düz native realm prototipleri, undefined/-0 ve çıktıdaki alias topolojisi korunur; özel sınıf/frozen domain semantiği sessizce dönüştürülmez. Caller'ın önceki sonucu veya hit kopyasını mutate etmesi başka okumaya sızmaz. In-flight paylaşım/single-flight ve joblar arası saklama yoktur.

Yalnız estimated, eksiksiz, issues/partial içermeyen, kapasitesi ve bitiş sıcaklığı bilinen çıktılar uygundur. Native engine her 64 adımda yield/abort kontrolü yapar: 64 veya daha fazla adımlı sonuçlar cache dışıdır. Custom clock cache dışıdır. Hit öncesi signal ve mutlak session deadline kontrol edilir; 5 ms headroom yalnız konservatif bypass'tır, tüm deadline/microtask sınırları için üretim emniyet kanıtı değildir. Bu açık tek başına B3'ü engeller.

## Eşdeğerlik ve fiziksel muhasebe

23 mevcut tür × baseline/soh90/thermal_provenance = 69 ayrı girdi × üç objective = **207 A/B PASS**; orijinal 69 baseline/amaç için ek native ankraj PASS. Matrix fiziksel çağrılar **13631 → 9613**, gerçek hit **4018**. Native/bypass/proof logical energy intents, diğer çağrılar ve mevcut counters eşleşir; fiziksel azalma bağımsız olarak ölçülür ve eski sayaca gizlenmez. Dış HTTP çağrısı/tasarrufu **0/0**; tüm provider'lar deterministic in-memory fixture, global fetch yasaktır.

Tam normalize outcome deepStrictEqual ile, fixture/output/ordered provider + energy-intent + charging trace hash'leriyle, bütün mevcut counter snapshot'larıyla karşılaştırıldı. Plan/replay/validation/source/quality/uncertainty/search metadata outcome kapsamındadır. Yalnız elapsedMilliseconds çıkarıldı; wall/deadline davranışı bununla geçerli sayılmaz. Trace ayrı bir optimizer iç-transition hook'u değildir; mevcut transition/frontier sayaçları, engine intent sırası ve outcome birlikte kontrol edildi. Seed/incumbent dahil bütün iç adımların formal eşdeğerlik kanıtı sunulmuyor.

Matrix sonuç kapsamı: planned 90, insufficient_data 69, computation_limit 21, cancelled 9, provider_error 18. Exact repeat/partial key, alias mutasyonu, bounded eviction/dispose/pending close, invalid/unknown/stale/error, warm abort kimliği, expired deadline hit bypass, bağımsız abort sahipleri ve native yields için birim adversarial testler var. Dolu/soğuk/bilinmeyen termal durumlarda downhill regen karşılaştırmaları da gerçek engine ile çalışır. Bu testler bütün mümkün deadline/abort interleaving'lerini kapatmaz.

**Ek adversarial kapı FAIL:** null-parent custom prototype üzerine native Object constructor ve inherited input alanları eklenince mevcut realm/prototype guard bu nesneyi ordinary kabul edebiliyor. Canonical key own alanları okurken gerçek Zod/engine inherited alanları da okuyabiliyor. İki farklı girdi aynı key'i üretti; ikinci hesapta gerçek native sonuç ile cache sonucu eşleşmedi (**keyCollision=true, equivalent=false, physical=1, hit=1**). SHA-256 çarpışması değildir; input sözleşmesi/prototype doğrulama açığıdır. Bu nesne normal JSON HTTP girdisi değildir; 207 plain-fixture eşdeğerliğini geçersiz saymaz ama genel B1 kabulünü kesin olarak engeller. Ayrı validate-energy-reuse-boundaries.ts komutu bilerek exit 1 / FAIL üretir; Jest'in PASS sayısına dahil edilmedi. Ölçülmüş proof kaynağı bu bulgu sonrası değiştirilmedi, pozitif sonucu taklit etmek için daraltılmadı; deney ve başarısız kanıt korunarak NO-GO ile kapatıldı.

## Dengeli tam plan performansı

Önceden sabitlenen ayarlar: üç bağımsız process, concurrency=1, her profile/objective/arm için 2 warmup, 4 ABBA/BAAB blok, **8 ölçüm/arm/process**, pooled **24/arm/profile/objective**. Beş profil ve üç objective, toplam 720 metrik-kapalı plan ölçümü. Metrik-açık ek çalışma 180 ölçümdür ve headline'a karıştırılmadı; sonuçları metrik-kapalı kontrolle eşleşti. Namespace/source hashes tüm süreçlerde aynı. Fixture clock 2026-11-16T09:00:00Z; seed/random yoktur. Fixture/model/engine profiller arasında farklı ama her A/B çifti ve süreçte sabittir.

Kabul eşiği ölçümden önce: toplam wall ve CPU'da en az %5 kazanç; bir profil/amaçta üç sürecin en az ikisinde %5'ten fazla p95 regresyonu olmaması. Eşikler GO için yeterli değil; sahiplik/emniyet kapıları da zorunludur.

Toplam wall **59888.335 → 74033.620 ms**, CPU user+system **71126.000 → 88543.000 ms**. Kazanç işaretiyle wall **%-23.619**, CPU **%-24.488**. Karar NO_GO; tekrarlanan p95 regresyonu **14/15** grupta. Metrik-kapalı fiziksel çağrılar **39000 → 32304**, hit **6696**.

| Profil / objective | p50 önce → proof ms | p95 önce → proof ms | p99 önce → proof ms | Toplam CPU önce → proof ms | Hit / logical proof | >%5 p95 gerileyen süreç |
|---|---:|---:|---:|---:|---:|---:|
| small / minimum_total_duration | 32.909 → 41.697 | 92.282 → 109.432 | 108.799 → 128.603 | 1874.000 → 2487.000 | 120/504 | 3/3 |
| small / minimum_charging_stops | 24.866 → 28.632 | 72.621 → 91.754 | 83.607 → 131.943 | 1441.000 → 1686.000 | 48/384 | 2/3 |
| small / minimum_energy | 33.438 → 35.146 | 94.305 → 102.046 | 115.220 → 105.442 | 1718.000 → 1878.000 | 120/504 | 2/3 |
| medium / minimum_total_duration | 112.448 → 130.681 | 341.993 → 414.783 | 438.206 → 465.151 | 5115.000 → 6031.000 | 648/2616 | 2/3 |
| medium / minimum_charging_stops | 105.758 → 128.711 | 326.190 → 382.884 | 398.065 → 395.422 | 4420.000 → 5721.000 | 504/2568 | 1/3 |
| medium / minimum_energy | 92.408 → 119.477 | 336.344 → 396.758 | 362.629 → 485.211 | 4968.000 → 5782.000 | 648/2760 | 3/3 |
| large / minimum_total_duration | 149.558 → 175.817 | 569.384 → 712.244 | 643.430 → 779.247 | 7141.000 → 8797.000 | 24/2064 | 3/3 |
| large / minimum_charging_stops | 153.554 → 189.771 | 469.087 → 644.349 | 519.273 → 743.317 | 6982.000 → 8671.000 | 24/2112 | 3/3 |
| large / minimum_energy | 144.014 → 190.395 | 460.613 → 584.989 | 581.618 → 705.077 | 6675.000 → 8610.000 | 24/2064 | 3/3 |
| repeat_dense / minimum_total_duration | 145.118 → 194.525 | 471.505 → 607.699 | 519.386 → 624.865 | 6767.000 → 8579.000 | 1104/5808 | 3/3 |
| repeat_dense / minimum_charging_stops | 155.857 → 194.472 | 529.104 → 610.915 | 547.709 → 711.193 | 7111.000 → 8831.000 | 1296/5952 | 3/3 |
| repeat_dense / minimum_energy | 138.516 → 179.866 | 466.236 → 596.595 | 470.032 → 654.620 | 6639.000 → 8644.000 | 1104/5808 | 3/3 |
| repeat_sparse / minimum_total_duration | 65.993 → 81.665 | 180.261 → 258.770 | 214.980 → 267.470 | 3109.000 → 4092.000 | 216/1656 | 3/3 |
| repeat_sparse / minimum_charging_stops | 51.876 → 68.857 | 144.333 → 182.499 | 174.112 → 206.519 | 2371.000 → 2594.000 | 216/1296 | 3/3 |
| repeat_sparse / minimum_energy | 95.964 → 123.671 | 421.125 → 485.060 | 457.108 → 571.366 | 4795.000 → 6140.000 | 600/2904 | 3/3 |

| Bağımsız process | Toplam ölçüm wall önce → proof ms | Ölçüm CPU önce → proof ms | Tüm process CPU user / system ms | Gözlenen GC event |
|---|---:|---:|---:|---:|
| 1 | 11354.065 → 14072.488 | 15283.000 → 18387.000 | 82469.000 / 2172.000 | 1554 |
| 2 | 13993.589 → 17243.796 | 17267.000 → 21975.000 | 96579.000 / 2296.000 | 1553 |
| 3 | 34540.681 → 42717.337 | 38576.000 → 48181.000 | 215188.000 / 5390.000 | 1553 |

| Profil / objective | Üç süreçte before p95 min–max ms | Proof p95 min–max ms |
|---|---:|---:|
| small / minimum_total_duration | 39.004–108.799 | 51.152–128.603 |
| small / minimum_charging_stops | 26.974–83.607 | 34.026–131.943 |
| small / minimum_energy | 36.440–115.220 | 41.391–105.442 |
| medium / minimum_total_duration | 133.781–438.206 | 131.002–465.151 |
| medium / minimum_charging_stops | 122.814–398.065 | 138.600–395.422 |
| medium / minimum_energy | 93.433–362.629 | 117.075–485.211 |
| large / minimum_total_duration | 155.270–643.430 | 185.401–779.247 |
| large / minimum_charging_stops | 158.291–519.273 | 203.056–743.317 |
| large / minimum_energy | 144.422–581.618 | 192.697–705.077 |
| repeat_dense / minimum_total_duration | 154.528–519.386 | 209.396–624.865 |
| repeat_dense / minimum_charging_stops | 158.664–547.709 | 191.204–711.193 |
| repeat_dense / minimum_energy | 143.363–470.032 | 189.244–654.620 |
| repeat_sparse / minimum_total_duration | 70.110–214.980 | 85.003–267.470 |
| repeat_sparse / minimum_charging_stops | 72.374–174.112 | 81.838–206.519 |
| repeat_sparse / minimum_energy | 100.620–457.108 | 122.196–571.366 |

Small/medium/large yalnız sentetik iş yükü adlarıdır; large mevcut 20 km sentetik long_route fixture'ıdır, gerçek 1000 km saha kanıtı değildir. Repeat-dense adayı doğal exact tekrar üretir; hit sağlamak için fazladan evaluate çağrılmadı. Repeat-sparse, az tekrar hipoteziyle seçilen direct fixture'ın adıdır; gerçek hit oranı dense'den düşük çıkmamıştır, dolayısıyla başarılı bir sparse ayrımı olduğu iddia edilmez. Large grubunun gerçek hit oranı yaklaşık %1,2 ile fiilen düşük tekrarlıdır. Bu temsil kısıtı da genel GO'yu desteklemez. Küçük veya tek favorable gruptaki fark tüm rotalara genellenmez; gerçek büyük rota ve başka makineler bu deneyden çıkarılamaz.

## Ayrı metrik-açık maliyet ve bellek gözlemleri

| Profil / objective | Before metrics-on p50 / p95 ms | Proof metrics-on p50 / p95 ms |
|---|---:|---:|
| small / minimum_total_duration | 26.822 / 82.916 | 31.194 / 95.844 |
| small / minimum_charging_stops | 21.457 / 69.097 | 26.775 / 78.785 |
| small / minimum_energy | 26.138 / 80.017 | 30.880 / 89.388 |
| medium / minimum_total_duration | 90.910 / 296.379 | 100.068 / 349.198 |
| medium / minimum_charging_stops | 81.282 / 286.029 | 99.517 / 353.647 |
| medium / minimum_energy | 106.328 / 317.646 | 111.905 / 358.661 |
| large / minimum_total_duration | 119.152 / 566.353 | 153.228 / 483.896 |
| large / minimum_charging_stops | 120.749 / 536.600 | 152.001 / 605.277 |
| large / minimum_energy | 119.866 / 385.324 | 149.906 / 638.598 |
| repeat_dense / minimum_total_duration | 126.657 / 515.282 | 165.576 / 589.149 |
| repeat_dense / minimum_charging_stops | 122.200 / 529.706 | 158.170 / 566.235 |
| repeat_dense / minimum_energy | 121.996 / 448.665 | 157.120 / 640.003 |
| repeat_sparse / minimum_total_duration | 55.876 / 182.626 | 70.179 / 278.186 |
| repeat_sparse / minimum_charging_stops | 42.065 / 149.706 | 52.286 / 188.010 |
| repeat_sparse / minimum_energy | 91.300 / 380.977 | 108.802 / 447.233 |

| Proof ayrı bileşen (metrics-on) | Toplam ms |
|---|---:|
| keyMs | 2839.419 |
| lookupMs | 75.121 |
| cloneReadMs | 100.909 |
| cloneWriteMs | 496.887 |
| entryMs | 19.380 |
| evictionMs | 6.952 |
| engineMs | 6212.936 |

Key canonicalization/alan okuması, lookup, clone-read, clone-write+ownership validation+freeze, entry bookkeeping, eviction ve gerçek engine promise süresi ayrı kaydedildi. entryMs evictionMs'yi kapsar; bu sütunlar toplanıp yeni wall süresi üretilmez. Engine zamanı async beklemeyi kapsayabilir; saf CPU diye sunulmaz. Bypass'ta yeni component timer yoktur; mevcut metrics stage süreleri JSON'dadır. Metrik-açık overhead'in kendisi ayrı tablodadır ve pooled timing kazancı değildir.

Cache 16 entry ve 2 MiB retained-unit proxy ile sınırlı; maksimum gözlenen **482344 unit / 1923 output node**. Key ve serialized-output UTF-16 uzunluğu proxy'dir, V8 heap byte garantisi değildir. Transient canonicalization/clone tahsisleri bu retained sınırından ayrıdır. Her solve sonrası retainedUnits=0; geç tamamlanan iş kapalı cache'i canlandırmaz. Doğal eviction sayısı 9408; kapasite-1 adversarial test ayrıca FIFO tahliyesini sınar.

Proof run heap fark aralığı **-27739496…31982248 byte**; negatif fark GC olabilir, leak/saved heap kanıtı değildir. Process JSON'ları GC event başlangıç/süre/kind, heap-start/end-after-explicit-GC, her ölçüm window'u ve summary GC overlap'lerini içerir. GC observer event teslimi asenkron ve gözlem sınırlı olduğu için overlap kesin attribution değildir. Fixture kurulumu, coordinator'ın bellek derlemesi ve diagnostic hash'ler plan timer dışında; bunların GC/JIT etkisi sonraki window'a taşabilir. Tam process CPU'su bunları içerir, yalnız engine tasarrufu diye sunulmaz.

Windows 10.0.26200, 12th Gen Intel(R) Core(TM) i7-12700H, Node v26.13.0; 20 logical CPU, concurrency=1. process.cpuUsage mikrosecond formatı gerçek CPU ölçüm çözünürlüğü garantisi değildir; kısa ölçümler sıfır/kuantize olabilir. Bu nedenle bir tek kısa run'dan CPU kabulü yapılmadı, user/system ham değerler ve biriken toplamlar tutuldu. Runtime/backend durdurulmadı; makine yükü/GC/JIT/termal durum tam izole değil. p95/p99 nearest-rank'tir; 24 örnekte p99 sample maximum'dur, nüfus kuyruğu veya servis SLA'sı değildir.

Ölçüm temelli açıklama: exact hit'ler fiziksel hesabı azaltıyor; fakat tam input canonicalization, miss yazma/validasyon/freeze ve hit çıktı kopyalama her solve'a ek maliyet getiriyor. Yield yapan daha pahalı hesaplar emniyet gereği cache dışıdır. Net tam plan wall/CPU ölçümü bu maliyetler dahil kabul eşiğini geçmiyor; bağımsız component ölçümü maliyetin yerini gösterir, tek başına nedensel CPU attribution değildir. Bu yüzden daha az call sayısını hızlanma olarak kabul etmiyoruz.

## Regresyon kapıları

| Komut | Durum | Özet |
|---|---|---|
| `SELECT 1 (credential-quiet)` | PASS |  |
| `pnpm.cmd --filter @chargeroad/shared test` | PASS | 41/41 PASS |
| `pnpm.cmd --filter @chargeroad/mobile test` | PASS | 21/21 PASS |
| `pnpm.cmd --filter @chargeroad/api test:db` | PASS | Test Suites: 72 passed, 72 total; Tests:       1168 passed, 1168 total |
| `pnpm.cmd -r typecheck` | PASS |  |
| `pnpm.cmd --filter @chargeroad/api build` | PASS |  |
| `git diff --check` | PASS |  |

| Ek adversarial komut | Durum | Özet |
|---|---|---|
| node -r ts-node/register scripts/validate-energy-reuse-boundaries.ts | **FAIL (exit 1)** | Crafted inherited-field canonical collision; sonuç eşdeğer değil, aktif kullanım bloke. |

DB yalnız SELECT 1 ile kontrol edildi; test:db var olan harness'in testlere özel schema/search_path modelinde çalıştı. Kullanıcı şemasında migration/reset/drop/seed/truncate yapılmadı. DB credential, konum, raw GPS/rota, SOC veya token kanıtlara yazılmadı. Hashler ve aggregate sayaçlar saklandı.

## Kanıtlar, açıklar ve geri dönüş

- [207 karşılaştırma ve native ankraj](session-repeat-active-proof-2026-11-15/run1/matrix.json), [3-process performans özeti](session-repeat-active-proof-2026-11-15/run1/summary.json).
- [Süreç 1](session-repeat-active-proof-2026-11-15/run1/process-1.json), [Süreç 2](session-repeat-active-proof-2026-11-15/run1/process-2.json), [Süreç 3](session-repeat-active-proof-2026-11-15/run1/process-3.json): ham aggregate örnekler, GC, kaynak hashleri.
- [Komut kapıları](session-repeat-active-proof-2026-11-15/run1/checks.json), [B1 adversarial FAIL](session-repeat-active-proof-2026-11-15/run1/boundaries.json), [başlangıç dosyalarının korunması](session-repeat-active-proof-2026-11-15/run1/preservation.json). smoke1 yalnız hazırlık kontrolüdür; kaynakları final run1'den farklıdır, kabul verisi değildir.

Yeniden çalıştırma: API dizininde node --expose-gc -r ts-node/register scripts/benchmark-energy-reuse-proof.ts --matrix --tag=yeni-run2 ve ardından --benchmark --tag=yeni-run2; tag küçük harf/rakam/tire olmalıdır. Dosyalar exclusive-write ile açılır; eski kanıtı overwrite etmez.

**B1:** normal sahiplik/key/negatif/yield/regen testleri PASS fakat ek crafted-prototype eşdeğerlik kontrolü **FAIL**; deadline emniyet kanıtı da eksik. **B2:** 207 normal A/B ve 69 native ankraj PASS; genel eşdeğerlik B1 bulgusu nedeniyle kabul edilmedi, net performans **FAIL/NO-GO**. **B3:** NOT_RUN, üretimde aktif reuse=0 ve bu teslimin kullanıcı trafiğindeki gerçek tasarrufu=0. Aktif feature flag veya rollback gerektiren üretim değişikliği yoktur. Tekrar değerlendirme ancak yeni maliyet/emniyet hipotezi ve yeni kanıtla yapılabilir; başka engine'e geçilmedi ve CR-PERF-006 için bu rapor başlama izni değildir.
