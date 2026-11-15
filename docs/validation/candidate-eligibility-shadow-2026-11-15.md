# CR-PERF-003 — Güvenli aday uygunluğu: shadow teknik teslim

Tarih: 2026-11-15. **Aşama A: DONE (shadow/analiz). Aktif filtreleme: NO-GO, uygulanmadı.** DB kabulü açık; CR-PERF-004/005 koduna geçilmedi. Genel hızlanma kabulü veya üretim/saha onayı verilmez.

## Başlangıç ve CR-PERF-002 kapanışı

HEAD `c24cab249dc3cbebb29f11104fee95c04ca8d7fd`; çalışma ağacında Görev 1/2 ve ek performans kapısının commit edilmemiş değişiklikleri vardı. Başlangıç git status/HEAD, diff, TASKS, V1 backlog, station SQL/coordinator/session/catalogue senaryosu, domain sözleşmeleri, ADR-005/006/010/011 ve 001/002 raporları incelendi. [Önceki performans NO-GO](frontier-queue-performance-gate-2026-11-13.md) korunur.

Kullanıcının yeni kararıyla production optimizer'da yalnız heap import'u kaldırıldı, frontier `[initial]` oldu, pop satırı eski `frontier.sort(compareStates) + shift()` davranışına döndü. Comparator, eşit öncelik sırası, seed/incumbent, push sınırı, yield, tüm bütçeler ve CR-PERF-001 frontier peak ölçümleri aynı kaldı. StablePriorityQueue, testleri ve tüm eski benchmark/JSON kanıtları silinmedi/yeniden üretilmedi.

**CR-PERF-003 koduna geçmeden** 30 tarihsel frontier kabul senaryosu, queue sınır testleri, native/heap/array seam testleri ve optimizer reference testleri çalıştırıldı: **4 suite / 53 test PASS**. Dolayısıyla bu dar geri dönüş eşdeğerlik kanıtından sonra kapatıldı. Yeni regresyonlar da array varsayılanıyla çalışır.

Önceki benchmark harness'ı yalnız bellek içindeki dependency seam'ini array source biçiminde de tanıyacak kadar güncellendi: tam eşleşen initialization/sort-pop ifadeleri bellekte alternatif kuyruk arayüzüne çevrilir. Üretim dosyası bunun için değiştirilmez. Native production sınıfına karşı testler sürer. Kapsamlı ABBA benchmark'ları bu görevde **çalıştırılmadı**; eski source hash'leri tarihsel sürüme aittir.

## Eksik/tekrarlanan kontroller matrisi

| Kural | Zaten nerede vardı? | Bu görevde ne eklendi / neden güvenli? |
|---|---|---|
| Lifecycle | SQL yalnız operating/unknown; coordinator planned/removed/temporarily_closed pinlemez | Aynı ret, ancak güncel alan kanıtıyla shadow sınıfı. Seçilmiş listede zaten elenmiş lifecycle için yeni tasarruf iddiası yok |
| Public access=false | SQL çıkarır; session.charge reddeder | Alan bazlı güncel/lisanslı kanıt ve tam kaynak kapsamı varsa kesin ret gözlemi. SQL yolu zaten elediğinden gerçek DB tasarrufu varsayılmaz |
| Membership=true | charge(), catalogue_power_scenario dışındaysa reddeder; katalogda uyarı bırakır | Aynı politika ayrımı. Katalog üyeliği otomatik ret değildir; belirsiz kalır |
| DC + araç soket standardı | SQL kısmi standart ön filtresi; coordinator physical kümesi; charge() tekrar denetler | Kontroller aktif olarak tekrarlanmadı/değiştirilmedi. Tam EVSE envanteri kanıtı için domain'de ayrı completeness alanı yok: eksik/AC/uyumsuz liste yeni kesin ret sayılmaz |
| Tek arızalı EVSE | charge() EVSE'leri ayrı değerlendirir | Alternatif uygun EVSE varsa istasyon reddedilmez |
| Unknown/stale/occupied | charge() freshness, unknownAvailability ve EVSE bazlı kuralları uygular | Belirsiz sınıf; occupied kalıcı arıza sayılmaz. Stale out_of_service güncel arıza diye elenmez |
| Opening hours | Gerçek şarj geçişinde arrival/departure aralığı değerlendirilir | Saf helper saat hesabı veya prefilter yapmaz. `eligible`, saat/SOC/şarj fizibilitesi garantisi değildir |
| Shared pool / SOC / eğri / sıcaklık | Session + ChargingCurveEngine | State'e bağlı olarak kalır. Statik eleme gerekçesi yapılmaz |
| Kaynak kapsamı/çatışma | Provider metadata ve alan bazlı merge evidence zaten var | Bunlar shadow kanıt kapısı olarak kullanılır. Eksik/stale/truncated/çatışmalı veri uncertain; indirme zamanı yayın/gözlem zamanı yerine geçmez |
| MaxCandidates/SQL LIMIT, maxStations | Provider maxCandidates+1/truncated ve coordinator mevcut limit/ranking | Aynı SQL, aynı pagination/coverage, aynı pinned sıra; backfill/ranking/top-N değişmedi |
| Katalog sentetik EVSE | Yalnız açık catalogue_power_scenario dönüşümü | Dönüşümün sonrası gözlenir; fiziksel EVSE yokluğu yeni ret değildir. Sentetik donanım verified sayılmaz |
| Geometry/match/duplicate ID | Mevcut Zod/coordinator endpoint ve kimlik denetimleri | Hatalı veri aynı eski reason ile reddedilir; shadow yeni hata/uyarı üretmez |

**Yeni fayda:** mevcut seçilmiş adaylara rağmen üyelik/erişim yüzünden charge girişinde erken dönülen tekrarlar görünür oldu. SQL veya coordinator'ın önceden elediği adaylar yeni performans kazancı gibi sunulmadı. Aktif eleme, outgoing/seed arama sırası, skippedData ve bütçe tüketimini değiştirebilir; bu görevin birebir eşdeğerlik şartında güvenliği kanıtlanmadı.

## Davranış özeti — 12 madde

1. Varsayılan frontier yeniden stabil array sort+shift'tir.
2. Pure `classifyCandidate`, eligible/provably_ineligible/uncertain ve sabit gerekçe döndürür.
3. Eligible yalnız kaba snapshot kontrollerini geçen adaydır; doğrulanmış şarj çözümü değildir.
4. Kesin ret yalnız mevcut statik erişim/üyelik/lifecycle kurallarıyla ve yeterli alan kanıtıyla üretilir.
5. Eksik EVSE listesi, tam envanter yokluğu kanıtı sayılmaz.
6. Eksik, eski, geleceğe tarihli, çatışmalı veya kapsamı yetersiz kanıt uncertain kalır.
7. Opening hours/availability/pool/curve/SOC/thermal geçiş kontrolleri yerinde kalır.
8. Aday dizisi, sırası, metadata, uyarılar ve replay içine gözlem alanı yazılmaz.
9. Shadow sadece açık CR-PERF-001 ölçüm bağlamında çalışır; varsayılan kapalıdır.
10. Gerekçe sayaçları sabittir; station/user kimliği, SOC, konum veya payload loglanmaz.
11. Potansiyel drive/charge girişleri sayılır; hiçbir çağrı bastırılmaz.
12. Yeni env flag, dependency, migration, endpoint veya public DTO eklenmez.

## Sınıflandırmanın sınırları ve sayaçlar

Pure helper tam candidate/metadata/vehicle/request policy, evaluatedAt ve mevcut STATION_POLICY.staticSoftAgeSeconds değerini alır. Bu süre yalnız gözlem kanıt kapısıdır, yeni domain kabul politikası değildir. Kanıt için alanın fieldEvidence kaydı, lisans, kapsama kaynak eşleşmesi ve geçerli/güncel publishedAt gerekir; retrievedAt tek başına yeterli değildir. Gelecek/eski zamanlar, kaynak çatışması ve eksik coverage kesin ret üretemez.

`candidate_eligibility` evresinde coordinator'ın mevcut pinning/katalog dönüşümü sonrası `all` listesi değerlendirilir. Mevcut physical/maxStations sonucu ayrıca `candidate_selected_total` sayılır. Bunlar **koridor başına gözlem sayılarıdır**, benzersiz istasyon sayısı değildir. Metadata, mevcut sınırlama sonucu incomplete olmuşsa sınıflandırma da conservative uncertain olur.

`candidate_call_shadow`, yalnız seçilmiş istasyona yönelik gerçek session.drive/charge girişlerinde aynı saf kontrolü gözlemler. Request memoization, cache veya aday sonucu saklayan yeni state eklenmedi. Şarj/SOC mantığı değişmedi. Varsayılan kapalı yolda gözlem fonksiyonları aday verisini okumadan döner; bunu getter-trap testi doğrular. Beklenmedik gözlem getter hatası plan hatasına çevrilmez.

Yeni sayaçlar: total/selected/eligible/uncertain/provably_ineligible; üç sabit ret gerekçesi (public access/membership/lifecycle); iki hypothetical session girişi (drive/charge). Hiçbiri public reason veya provider HTTP bütçesi yerine geçmez. Ölçüm açıkken ek CPU/zaman maliyeti vardır; gerçek deadline sınırına yakın davranış için sıfır overhead iddiası yapılmaz. Domain deadline/iptal limitleri gevşetilmedi.

## Regresyon kanıtı

**43 vaka × 3 objective = 129 karşılaştırma**; her birinde üç çalışma: önceki shadow'suz davranış, yeni shadow açık, yeni ölçüm kapalı. Toplam 387 service-plan girişimi. Tarih `2026-11-15T09:00Z` sabit; motor/provider fixture'ları aynı. Dış ağ yasak.

Önceki davranış bağımsız bir solver kopyası değildir: güncel coordinator/session kaynaklarından yalnız yeni shadow import/çağrı satırları **bellekte** çıkarılır; kalan kaynak, array optimizer ve domain motorları aynıdır. Tam outcome (validation input, replay, metadata, warnings/skippedData dahil), provider/motor çağrı sırası ve sayıları deep eşittir; yalnız `elapsedMilliseconds` hariçtir. Mevcut CR-PERF-001 sayaçları da eşit kalır. Çıktı ve trace yalnız hash olarak yazılır.

Vaka kapsamı: AC/yanlış DC soket/eksik EVSE; bozuk+sağlam EVSE; unknown/null observedAt/stale/occupied/future; public false/null, membership true/null/katalog; sentetik katalog EVSE; değişen varışta opening hours; shared pool, dar eğri; duplicate ID, bilinmeyen match, endpoint gap; 2/5/10 km koridor; maxStations, truncated/incomplete/bozuk metadata; boş aday; doğrudan varış; rezerv sınırı; tek geçerli istasyon; ölçekli uzun rota ve altı istasyon; state/yol/hava bütçesi, deterministik deadline, iptal ve provider timeout/quota.

Normal, doğrudan varış, rezervdeki tek geçerli istasyon, katalog claims, uzun ve çok istasyonlu örneklerin `planned` olması ayrıca zorunlu tutulur. Uzun fixture, sentetik küçük ağın 10 katı mesafe/kapasiteyle ölçeklenmiş halidir; gerçek İstanbul–Ankara/saha kabulü değildir. Segmentler mevcut segment politikası içinde bölünür. Çok istasyonlu örnek state_budget ile doğrulanmış incumbent döndürür; optimality:not_proven korunur.

**129/129 eşdeğerlik PASS.** İptal/provider_error/computation_limit/insufficient_data ayrı kalır. Duplicate ID/bozuk metadata mevcut STATION_PROVIDER_INVALID_DATA, hatalı match mevcut STATION_ROUTE_OR_NODE_ID_INVALID, erişilmeyen endpoint mevcut ROAD_ENDPOINT_NOT_REACHABLE sonucunu korur.

Yeni fixture hazırlığında unknown availability ve geçersiz reserve/arrival hedefi test hataları düzeltildi; uzun fixture mevcut segment kurallarına uygun bölündü. Üretim doğrulamaları veya eski golden/reference beklentileri gevşetilmedi. İlk ara smoke dosyası yeniden yazılmadı; kabul için son kaynak sürümünün [final artefaktı](candidate-eligibility-smoke-2026-11-15-final.json) kullanılır. Script ölçüm başı/sonu kaynak hash'lerini denetler ve mevcut çıktı üzerine yazmaz.

## Smoke ölçümleri — tasarruf iddiası yok

Final 129 vaka/amaç grubunun toplam gözlemleri:

| Gözlem | Sayı |
|---|---:|
| Aday gözlemi (koridor tekrarları dahil) | 231 |
| Mevcut seçilmiş aday gözlemi | 219 |
| Kaba eligible | 132 |
| Uncertain | 75 |
| Provably ineligible sınıfı | 24 |
| Ret sınıfı: public access / membership / lifecycle | 3 / 21 / 0 |
| Hypothetical drive girişi | 42 |
| Hypothetical charge girişi (entegrasyon değil) | 165 |
| Yeni katmanın gerçekten elediği aday | **0** |
| Gerçekleşen provider/motor çağrısı tasarrufu | **0 / 0** |

Örnekler (yalnız minimum_total_duration; her satır before/new aynı):

| Fixture | Total / selected | Kesin / uncertain | Hypothetical drive / charge | Charging engine çağrısı |
|---|---|---|---|---:|
| normal | 2 / 2 | 0 / 0 | 0 / 0 | 56 |
| private | 2 / 2 | 1 / 0 | 1 / 11 | 0 |
| membership | 2 / 2 | 1 / 0 | 1 / 11 | 0 |
| no_dc | 2 / 1 | 0 / 2 | 0 / 0 | 0 |
| source_conflict | 2 / 2 | 0 / 1 | 0 / 0 | 0 |
| catalogue_claims | 2 / 2 | 0 / 1 | 0 / 0 | 57 |
| 2/5/10 km corridors | 6 / 6 | 6 / 0 | 12 / 33 | 0 |
| many_stations | 6 / 6 | 0 / 0 | 0 / 0 | 10 |

Private/membership charge girişleri zaten mevcut erken ret nedeniyle motoru çalıştırmıyordu. 165 girişin 165 pahalı entegrasyon tasarrufu olduğunu söylemek yanlış olur. Drive girişleri session cache'ine takılabilir; 42 de HTTP sayısı değildir. SQL zaten bazı adayları çıkarır; bu sentetik provider örneği canlı DB kazancı değildir. Mevcut physical/maxStations seçiminin 231→219 farkı **yeni sınıflandırmanın elemesi değildir**.

Sınıflandırma ve çağrı gözlemi süreleri artefakta ayrı tutulur; tek smoke/regresyon turudur. CPU/heap veya p50/p95/p99 kabulü çıkarılmadı. Kapsamlı üç process ABBA tekrarı yapılmadı.

## Test kapısı

| Komut / kontrol | Başlangıç | Sonuç |
|---|---|---|
| `pnpm --filter @chargeroad/api test` | PASS: 45 suite / 545; 14 suite / 150 DB skip | PASS: 48 suite / 707 test; 14 suite / 150 DB skip, 55.093 s |
| Yerel DB salt okunur SELECT 1 | ECONNREFUSED; erişim yok | DB entegrasyon kabulü açık |
| `pnpm --filter @chargeroad/api test:db` | Bağlantı önkoşulu yok; başlangıç NOT_RUN | Komut FAIL (ortam): 14 DB suite / 150 test bağlantı hatası; diğer 707 PASS. DB senaryo kabulü NOT_RUN, PASS değil |
| `pnpm -r typecheck` | PASS | PASS: API/shared/mobile |
| Shared test | PASS: 41 | PASS: 41 |
| Mobile test | PASS: 21 | PASS: 21 |
| API build | PASS | PASS |
| Dar array geri dönüş testi | — | PASS: 4 suite / 53, CR-003 öncesi |
| Pure helper + fixture eşdeğerliği | — | PASS: 158 (29 pure + 129 vaka/amaç) |
| Shadow gizlilik/kapalılık/hata testleri | — | Son API çalışmasına dahil, 4 test |
| 129 vaka smoke | — | PASS: plan/replay/trace/mevcut sayaç eşit |
| `git diff --check` | — | PASS |

DB için servis başlatma/durdurma, veri/kota temizliği veya production migration yapılmadı. Test DB yokluğu yeşil sonuç sayılmaz. Gerçek provider'a istek atılmadı.

## Değişen dosyalar ve koruma

- `charge-stop-optimizer.ts`: CR-PERF-002 için üç satırlık dar array dönüşü; ölçümler korunur.
- `validation/frontier-performance-harness.ts`: array production source ile eski queue testlerini yaşatan bellek içi seam uyumu.
- `candidate-eligibility.ts`, `candidate-eligibility-shadow.ts`: pure sınıflandırma ve isteğe bağlı aggregate gözlem.
- `ev-planning.service.ts`, `planning-session.ts`: seçimi değiştirmeyen üç gözlem giriş noktası.
- `observability/planning-metrics.ts`: mevcut kapalı-varsayılan altyapıya sabit sayaç/evre adları ve bağlam kontrolü.
- Yeni `candidate-eligibility.spec.ts`, `candidate-shadow.spec.ts`, `eligibility-equivalence.spec.ts`; yeni `validation/eligibility-{fixtures,validation}.ts` ve `scripts/validate-candidate-eligibility.ts`.
- Yeni smoke/koruma artefaktları, bu rapor ve kanıtlanan TASKS durum güncellemesi.

SQL/provider, domain engine, ortak Zod/DTO, migration ve mobil kaynaklar değişmedi. Önceki baseline/gate/reference JSON/MD dosyaları aynen korundu. CR-PERF-004/005 kodu uygulanmadı. [Dosya koruma özeti](candidate-eligibility-preservation-2026-11-15.json) değişen mevcut dosyaları ve korunmuş tarihsel kanıtları listeler.

## Flag, rollback ve sonraki kapı

Shadow varsayılan olarak kapalıdır; yalnız mevcut `PLANNING_METRICS_ENABLED=true` bağlamı içinde çalışır. Yeni env flag gerekmiyor. Aktif filtreleme uygulanmadığından açılabilir bir prefilter flag'i de yoktur. Ölçümü kapatmak için mevcut flag=false yeterlidir; gerçek `.env` bu görevde değiştirilmedi ve çalışan servis yeniden başlatılmadı.

Dar kod rollback'i: yeni gözlem import/çağrılarını kaldırmak shadow'yu kaldırır; yardımcılar/testler/kanıtlar teşhis için kalabilir. Array frontier kapanışı ve CR-PERF-001 ölçümleri korunmalıdır. Tüm dosyayı Git HEAD'e restore etmek eski kullanıcı çalışmalarını siler; kullanılmamalıdır. DB geri dönüşü gerekmez.

**CR-PERF-004 için koşulsuz GO yok (NO-GO: DB kabulü açık).** Aşama A shadow/analiz kapsamı DONE olabilir; aktif elemenin birebir plan/trace/bütçe eşdeğerliği kanıtlanmadı. DB sağlandığında izole testler geçmeli ve sonraki görevin önkoşulları ayrıca incelenmelidir. Şarj verisi kalite/saha/lisans açıkları bu teslimle kapanmaz.

## CR-PERF-005 sonrası toplu karşılaştırma girdileri

001 before/after/instrumented/local-provider ve 002 historical before/after/structure/gate artefaktları yeniden yazılmadı. Yeni final smoke; HEAD/dirty, motor sürümleri, fixture saati, her vakanın input/outcome/trace hash'leri ve kaynak dosya hash'lerini içerir. Orijinal optimizerWorld/golden/reference ve 001 baseline dosya hash'leri korunur.

005 sonrasında 001 baseline ile 003–005 kümülatif değişiklik aynı makine/fixture/profil/objective/concurrency, cold/warm cache ve ölçüm açık/kapalı koşullarında karşılaştırılmalı. Farklı gözlem overhead'i ve 002'nin heap→array kapanışı açık kontrol değişkenleri olmalı. Provider HTTP, PG/session cache, weather/energy/charging çağrıları, frontier push/pop, wall p50/p95/p99, process CPU, heap/GC ve response boyutları ayrı raporlanmalı; session girişi HTTP veya motor çağrısı yerine kullanılmamalıdır. Bu toplu benchmark bu görevde uygulanmadı.
