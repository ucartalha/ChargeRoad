# CR-PERF-004 — Konservatif state analizi ve sınırlı shadow

2026-11-15. **Aşama A DONE; aktif dedup/dominance budaması NO-GO.** Gerçekleşen budama ve provider/motor tasarrufu **0**. CR-PERF-005 koduna geçilmedi; kapsamlı performans kabul ölçümü yapılmadı. DB entegrasyon kabulü açık kalır.

## Başlangıç, DB önkoşulu ve koruma

HEAD: `c24cab249dc3cbebb29f11104fee95c04ca8d7fd`. Git status'ta 001/002/003 ve ek performans kapısının commit edilmemiş tracked/untracked değişiklikleri vardı. Başlangıçtaki **503 dosyanın hash'i** alındı. Yerel dirty içerik esas alındı; GitHub HEAD'e restore/reset/clean/stash/checkout veya otomatik commit/push yapılmadı.

README, Compose ve `apps/api/scripts/test-db.cjs` incelendi. Bootstrap TEST_DATABASE_URL, yoksa DATABASE_URL kullanıyor; mevcut entegrasyonlar kendi benzersiz schema/search_path alanlarında çalışıyor. Buna rağmen kullanıcı DB'sine genel migration/seed/temizlik uygulanmadı. Önce salt okunur SELECT 1 denendi: **ECONNREFUSED**. Başlangıç `api test`: **707 PASS / 150 SKIPPED**. Başlangıç `test:db`: **150 bağlantı hatası / 707 PASS**, DB senaryoları çalıştırılamadı. Bu önkoşulla yalnız izin verilen shadow/analiz kapsamına geçildi.

Manuel ortam hazırlığı: Docker Desktop hazır olduğunda repo kökünde `pnpm db:up` mevcut. Bu raporda komut çalıştırılmadı. Sonrasında TEST_DATABASE_URL'in amaçlanan test sunucusuna gittiği ve test izolasyonu doğrulanıp SELECT 1 başarılı olmalı; ardından `pnpm --filter @chargeroad/api test:db` tekrar çalıştırılmalı. Genel `db:migrate`, reset/seed/truncate/drop veya volume temizliği önerilmez/uygulanmadı.

Frontier **stabil Array.sort(compareStates)+shift** olarak kaldı. Heap yardımcıları, eski benchmarklar, 003 eligibility helper/observation kodu ve baseline/golden/reference dosyaları korundu. [Koruma manifesti](state-dominance-preservation-2026-11-15.json) başlangıçla karşılaştırılan mevcut dosyaları/artefaktları listeler.

## State ve future-equivalence envanteri

| Alan / bağlam | Neden önemlidir? | Bu görevdeki sınırlı gözlem |
|---|---|---|
| nodeId | Geçerli outgoing hedeflerini/yol girişini belirler | Tam string; yalnız ucuz pair lookup, dedup anahtarı değil |
| visited sırası ve içeriği | Tekrar ziyareti, comparator tie-break, rota/plan geçmişini etkiler | Set'e çevrilmeden aynı sıra; en çok 32 öğe kopyalanır |
| soc | Rezerv/hedef, taper, sonraki erişim ve regen headroom | Sayısal değer tam; SOC bucket/epsilon yok |
| at | Yol/hava passage time, opening-hours, şarj sonrası zaman | Tam string; dakika/saat bucket'ı yok |
| temperature + provenance | Termal enerji, kapasite, eğri koşulları, estimated/measured/user_input ayrımı | Değer, origin, observed/source/estimated/validAt/model alanlarının küçük kopyası |
| capacity snapshot | Effective kWh, SOH/sıcaklık uygulaması ve kaynak sürümü | Yalnız aynı root object identity token'ı; deep içerik doğrulanmaz |
| legs | Geometri, alternatif yol, tüketim, weather, kaynak ve zaman geçmişi; compile/replay | Root array identity token'ı; büyük graf açılmaz/kopyalanmaz |
| stops | Şarj hedef/geçmişi, sıra, saat, hardware/availability kaynakları | Root array identity token'ı; iç veri açılmaz |
| netKwh | Minimum-energy amacı; regen neti ve enerji dengesi | Tam sayı değeri; compareStates'in 1e-8 yuvarlaması kullanılmaz |
| seconds | Süre amacı, incumbent karşılaştırması, scenario duration | Tam sayı değeri |
| distance | Tie-break, route-distance ve durak konumu | Tam sayı değeri |
| Objective | Süre/az durak/enerji farklı sıralanır | Observer her solve için yeni scope; scope'lar arası karşılaştırma unproven |
| Request/policy/vehicle/candidates/options | Rezerv, hedef, kalite, üyelik, unknown politikası, model/katalog sürümleri ve bütçeler | Mevcut solve bağlamı aynı kalır; farklı solve/corridor için kayıt paylaşılmaz |

Bu kapsam bir tam immutable state sertifikası değildir. Aynı history token'ı aynı JS referansı demektir; içindeki source.version/weather gibi alanların geçmiş gözlemden sonra değişmediğini kanıtlamaz. Farklı referansların içerikleri deep-equal olsa bile bu hafif gözlem onları eşdeğer saymaz. Root/provenance belirsizliği korunur.

### State dışı gözlenebilir etkiler

- Session road/weather cache'leri ve climate sample seçimi önceki çağrılara bağlıdır. Aynı state'in ikinci işlenmesi cache hit/miss ve port çağrılarını değiştirebilir.
- `issues`, hardwareEvaluations, road/weather bütçeleri ve replay kayıtları geçiş sırasında değişir. Seed/main search ve incumbent derleme denemeleri de bunları etkiler.
- expandedStates/evaluatedTransitions, yield sıklığı, frontier/state/data budget, stoppedReason/searchComplete ve deadline gözlenebilirdir. State atlamak bunları otomatik korumaz.
- CompilePlan, bütün legs/stops/weather/source snapshot'larından route composition, validation input, uyarı ve checksum üretir. Aynı node/SOC'den gelmek aynı final snapshot demek değildir.
- Unknown queue/availability, conditional ETA ve optimality:not_proven anlamları korunmalıdır. Bu görev bunları yeniden tanımlamaz.

**Sonuç:** Tam bir deep state eşitliği bile tek başına aktif dedup için yeterli değildir; session ve arama yan etkileri sözleşmesinin ayrıca kanıtlanması gerekir. Bu nedenle hiçbir gözlem seviyesi budama izni vermez.

## Shadow algoritması ve sınırları

Saf `compareStateObservations` dört sonuç verir: `exact_duplicate_candidate`, `potential_dominance_only`, `not_equivalent`, `unproven`. **Her sonuç mayPrune=false ve proof=shallow_observation_only** taşır.

- Exact candidate: gözlenen küçük alanlar tam aynı ve history root token'ları aynı. Bu **tam state/future equivalence PASS değildir**.
- Potential dominance: aynı kaba bağlamda SOC ve maliyetler sayısal bir Pareto ipucu veriyor. Regen/taper/termal/sözleşme kanıtı yok; eleme yetkisi değildir.
- Not equivalent: gözlenen sıra/zaman/provenance/scalar alanları ayrışıyor.
- Unproven: scope veya history root'ları farklı; deep inceleme yapılmadan karar verilmiyor.

Production entegrasyonu yalnız initial frontier state ve gerçek başarılı frontier push sonrası void observation çağrılarıdır. Seed'in rekürsif ara state'leri ve incumbent destination state'leri bu indekse eklenmez. Frontier array'i, sort/shift, karşılaştırıcı, push guard, state üretimi, incumbent ve budget/yield kodu değiştirilmedi. Observer hiçbir değeri solver'a geri beslemez; state/replay/context'e alan eklemez.

Mevcut PLANNING_METRICS_ENABLED bağlamı kapalıyken factory ortak noop döndürür. Map/snapshot oluşturulmaz; state getter'ı, deep serialize/hash veya history dolaşımı yoktur. Bu, toplam fonksiyon çağrı maliyetinin sıfır olduğu iddiası değildir. Açıkken yalnız sınırlı küçük alan kopyaları ve WeakMap identity token'ları kullanılır; JSON.stringify/hash/structuredClone production shadow yolunda kullanılmaz. WeakMap anahtarları history grafını güçlü referansla hayatta tutmaz.

| Bütçe | Üst sınır / anlam |
|---|---|
| İşlenen gözlem | solve başına 256; sonra states_seen/skipped sayılıp state okunmadan dönülür |
| Saklanan küçük kayıt | solve başına 64; ilk kayıtların sınırlı örneklemi |
| Pair karşılaştırması | gözlem başına en fazla 4, toplam en fazla 1024 |
| Lookup taraması | en fazla 64 kayıt/gözlem; node yalnız pair bulmak için |
| visited | en fazla 32 string; daha uzunu capture failure/unproven kapsamı |
| String uzunluğu | en fazla 256 karakter; aşan/ek state alanı gözlemde kabul edilmez |
| History kimlikleri | başarılı gözlem başına en fazla 3, toplam en fazla 768 weak key |
| Güçlü history grafı kopyası | 0; yalnız küçük scalar/string/token kayıtları |

Saklanan visited referansı en çok 2048'dir. String uzunluğu/alan sayısı da sınırlı olduğundan tutulan küçük verinin büyümesi sınırlıdır; JS WeakMap/object/GC overhead'i için ölçülmüş byte-level heap üst sınırı iddia edilmez. Geçici kayıtlar ve VM overhead'i ayrıca vardır. 64/256/4 sınırları arama bütçesi değildir; aşılması search metadata'sını veya işi durdurmaz. Gözlem eksik örneklemdir: tüm duplicate'ları bulduğu iddia edilmez.

Beklenmedik state getter/capture hatası yalnız düşük kardinaliteli failure sayacına gider; planı bozmaz. Yeni enum alanları ve sayaçlar log tarafındadır; public DTO, algoritma/policy sürümü ve engine sözleşmeleri değişmedi. 003 shadow aktif eleme moduna çevrilmedi.

## Karşı örnekler ve test kanıtı

Saf/observer testleri şunları kapsar:

- Aynı primitive değerler ve aynı root token'ları: yalnız candidate, hiçbir zaman prune izni yok.
- Farklı node, visited sırası/kümesi, zamanın 1 ms değişmesi, sıcaklık değeri/origin/source/model, capacity/legs/stops veya scope: exact candidate olamaz.
- 1e-10 SOC/enerji/süre/mesafe farkı yuvarlanmaz. Rezerv/hedef sınırının iki yanındaki SOC aynı fizibilite değildir.
- Basitleştirilmiş regen örneğinde yüksek SOC daha az regen kabul eder: yüksek SOC sayısal ipucu, güvenli dominance kanıtı değildir.
- Aynı görünümlü ayrı history root'ları unproven kalır. **Aynı root içindeki source/weather version mutasyonu da hafif anahtarın doğruluk kanıtı olmadığını gösterir:** candidate sayılabilir, actual_pruned yine 0'dır. Bu sınırlılık gizlenmez ve aktif budama yasağının nedenidir.
- Kapalı ölçümde getter/ownKeys trap hiç okunmaz; büyük history Proxy'si açıkken de açılmaz.
- 256/64/4 sınırları, limitten sonra getter okumama, beklenmedik field/uzun visited ve hatanın izolasyonu doğrulanır.

**54 vaka × 3 objective = 162 karşılaştırmalı senaryo**, her birinde üç koşul: eski production optimizer / yeni shadow açık / yeni ölçüm kapalı. Toplam 486 plan girişimi. Tarih/fixture aynı, dış fetch yasak.

Baseline ayrı yazılmış algoritma değildir: gerçek güncel optimizer kaynağından yalnız üç yeni shadow parçası bellekte çıkarılır. Elde edilen kaynak başlangıçtaki dirty optimizer ile **byte hash düzeyinde aynı** olmalıdır: `07566ed5ebcd4c1df250f8db46be0da750295c50052afc9444a21b1ab06b9b61`. [Baseline hash kaydı](state-dominance-baseline-2026-11-15.json) korunur; değişirse doğrulama fail eder.

Tam plan/validation input/replay/search metadata/warnings/skippedData, provider ve motor çağrılarının sırası/sayısı, bütün eski 001 sayaçları ve **003 candidate sayaçları** deep eşittir. Yalnız doğal `elapsedMilliseconds` hariçtir. Her koşul için input/outcome/trace hash'leri artefakta yazılır; raw state/rota/konum/SOC yazılmaz. Önceki 003'ün 129 senaryosu ayrıca eski testiyle tekrar geçti.

Kapsam: normal/çok duraklı, direct incumbent, reserve sınırındaki tek istasyon, katalog seed/claims/üyelik, farklı yol alternatifleri/equal-priority, opening hours, unknown/stale/occupied durumlar, shared pool, termal/provenance/SOH farklılıkları, regen ve 2/5/10 km koridorları. State/transition/frontier/road/weather bütçeleri, validated incumbent'in sınırlı geri dönüşü, deterministik deadline, abort ve provider timeout/quota da karşılaştırıldı.

İki ek küçük yönlü graph fixture'ında 20261115 ve 42 seed'leriyle sabit kenar süreleri üretildi. Bunlar before/after eşdeğerliği kanıtıdır; bağımsız global optimum ispatı değildir. Mevcut 15 exhaustive/reference fixture değiştirilmeden çalıştırıldı; snapshot SHA-256 `5b44b4b31b9cd55e35340e6c9fe97d54797d342045eef0d56faf0e6f882a502f` aynı kaldı. optimality:not_proven korunur.

**162/162 eşdeğerlik PASS.** Hiçbir aday/state aktif elenmedi; gözlem hatası plan hatasına çevrilmedi.

## Sınırlı smoke sonucu

[Final artefakt](state-dominance-smoke-2026-11-15-final.json), kaynak hash'lerini başta/sonda denetleyen tek offline regresyon/smoke turudur. Her hücre yalnız bir smoke gözlemidir; geniş çok-process ABBA veya p50/p95/p99 karşılaştırması değildir.

| Gözlem | Toplam / tepe |
|---|---:|
| Görülen frontier state (initial + push, pop değil) | 924 |
| Analiz edilen küçük snapshot | 924 |
| Pair karşılaştırması | 1881 |
| Exact duplicate candidate | 0 |
| Potential dominance only | 0 |
| Not equivalent pair | 1830 |
| Unsafe/unproven pair | 51 |
| Capture failure / observation-budget skip | 0 / 0 |
| Tek solve/request'te gözlenen retained peak | 42 |
| Gerçek budanan state | **0** |
| Gerçek provider / motor tasarrufu | **0 / 0** |

Capture/compare evre sürelerinin 162 plana ait toplamı **9.612 ms**, en büyük tek plan toplamı **0.471 ms** olarak gözlendi. Factory kurulum, dış guard/counter ve log maliyetlerinin tamamını kapsamaz; toplam instrumentation overhead'i veya CPU benchmark'ı değildir. Ortam/JIT/GC etkisi ayrıştırılmadı; hızlanma iddiası yoktur.

162 plandaki veride güvenilir duplicate/dominance bulunmadı; bu, bütün üretim arama uzayında tekrar olmadığı anlamına gelmez. Kapsam/node/history identity/bellek örneklemi sınırlıdır.

Artefaktın ayrı `syntheticObserverProbe` bölümünde elle verilen 5 küçük örnekte 1 exact candidate, 2 potential, 4 not-equivalent ve 3 unproven pair oluşur; bu **rota planlarından bulunan tekrarlar değildir**. Pozitif sayaç yollarını sınar, budama/tasarruf yine 0'dır.

İlk ara smoke dosyasına dokunulmadı. Orada peak alanının aritmetik toplamı 912'dir; bu bellek tepe değeri değildir. Final artefakt sayaçları toplar, entries_peak için **maksimum 42** kullanır. Kabul verisi final dosyasıdır; eski artefaktlar üzerine yazılmadı.

## Test kapısı ve DB durumu

| Komut / kontrol | Başlangıç | Sonuç |
|---|---|---|
| `pnpm --filter @chargeroad/api test` | PASS: 707; 150 DB SKIPPED | PASS: **51 suite / 896**; 14 suite / 150 DB SKIPPED, 83.072 s |
| `pnpm --filter @chargeroad/api test:db` | FAIL ortam: 150 bağlantı hatası; 707 PASS | FAIL ortam: **14 suite / 150** bağlantı hatası; diğer **896 PASS**, 83.253 s |
| DB SELECT 1 | ECONNREFUSED | DB entegrasyon kabulü **NOT_RUN**, PASS değil |
| `pnpm -r typecheck` | — | PASS: API/shared/mobile |
| Shared test | — | PASS: **41** |
| Mobile test | — | PASS: **21** |
| API build | — | PASS |
| Yeni pure/observer testleri | — | PASS: **27** |
| Yeni state before/after/off senaryoları | — | PASS: **162** |
| Mevcut 003 senaryoları | — | PASS: **129**, orijinal testleri korundu |
| 15 reference fixture | — | PASS: fixture/golden değişmedi |
| `git diff --check` ve eski kanıt hash'leri | — | PASS |

Test toplamı 1046'dır; DB yokluğu için 150 testi geçmiş saymıyoruz. ECONNREFUSED kod regresyonu kanıtı değildir; entegrasyon kapısının açık kaldığı anlamına gelir. Kullanıcı DB'sinde migration/reset/seed/truncate/drop veya volume temizliği yapılmadı. Gerçek Valhalla/Geoapify/MET Norway çağrısı yapılmadı.

## Dosyalar, rollback ve sonraki karar

- Yeni `state-dominance.ts` ve `state-dominance-shadow.ts`: pure sınıflandırma ve bounded gözlem.
- `charge-stop-optimizer.ts`: yalnız observer import/initial/push hook'ları; array sort+shift korunur.
- `observability/planning-metrics.ts`: sabit düşük kardinaliteli sayaçlar ve state_shadow evresi.
- Yeni 3 test dosyası, `validation/state-dominance-validation.ts`, `scripts/validate-state-dominance.ts`: byte-doğrulanmış baseline ve offline kanıt.
- Yeni baseline/smoke/final/koruma JSON'ları, bu rapor; TASKS ve yalnız 004'ün kanıtlanan durum kaydı.

Provider, session, coordinator, engine, compiler, SQL, DTO/Zod, migration ve mobil kaynakları bu görevde değiştirilmedi. Başlangıçtaki dirty 001/002/003 dosyaları korundu; 003 helper ve eski testler aynıdır. Tarihsel baseline/gate/003 JSON ve raporlar yeniden üretilmedi. Git commit/push yoktur.

Shadow varsayılan kapalıdır; mevcut PLANNING_METRICS_ENABLED=false yeterlidir. Yeni env flag veya aktif pruning modu eklenmedi. Dar rollback: observer import/iki hook satırını kaldırmak; 001 ölçümlerini, 002 array kapanışını ve 003 shadow'yu korumak. Tüm dosyayı HEAD'e restore/reset etmeyin. Veri/şema geri dönüşü gerekmez.

**Aktif pruning / rollout: NO-GO.** DB kapısına ek olarak deep immutable state/future ve session/replay/budget eşdeğerliği ispatı yoktur. Sayaçları sahte biçimde koruyarak gerçek işi atlama veya sözleşmeyi değiştirme bu görevde yapılmadı.

**CR-PERF-005: CONDITIONAL GO yalnız offline hazırlık/analiz için.** Aktif optimizasyon/entegrasyon/rollout için DB önkoşulu ve 005'in kendi güvenlik kanıtları ayrıca kapanmalıdır. Bu görevde 005 koduna geçilmedi.

## 005 sonrası korunmuş karşılaştırma girdileri

001 baseline'ı, 002 historical/gate kanıtları, 003 final smoke ve orijinal optimizerWorld/reference/golden factory'ler korunur. Yeni final smoke 2026-11-15T09:00Z saatini, graph seed'lerini case kodunda, input/outcome/trace ve kaynak hash'lerini taşır. 001'in orijinal saati 2026-11-13T09:00Z'dir; farklı fixture/saatlerin mutlak sürelerini doğrudan kıyaslamayın.

005 bittikten sonra yeni çıktı adlarıyla aynı makine/fixture/objective/concurrency/cold-warm cache koşullarında 001 ve kümülatif 003–005 karşılaştırılmalıdır. 002 heap→array dönüşü ile 003/004 shadow açık/kapalı koşulları ayrı kontrol değişkenleridir. Plan p50/p95/p99, gerçek HTTP ve PG/session cache, road/weather/energy/charging, state/transition/frontier push-pop, CPU, heap/GC, response boyutu ve gözlem overhead'i ayrı ölçülmelidir. Yeni senaryolar ek regresyon katmanıdır; farklı kaynak/saat girdileriyle tarihsel baseline yerine geçirilmez. Dış servis yük testi yapılmaz ve eski artefaktlar üzerine yazılmaz.
