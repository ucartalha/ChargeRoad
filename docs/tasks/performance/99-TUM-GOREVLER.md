# ChargeRoad — Tüm Codex Görev Promptları

GitHub referansı `c24cab249dc3cbebb29f11104fee95c04ca8d7fd`. Her prompt bağımsızdır; sadece sıradaki prompt çalıştırılmalıdır.

---

# CR-PERF-001 — Performans gözlemlenebilirliği ve tekrarlanabilir baseline

**Faz:** A · Ölçüm  
**Öncelik:** P0  
**Risk:** Düşük  
**Bağımlılıklar:** Yok  
**Durum:** TODO

## Amaç

Davranışı değiştirmeden planın hangi adımda zaman/kaynak harcadığını ve cold/warm farkını ölç.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/planning/planning-session.ts`
- `apps/api/src/planning/charge-stop-optimizer.ts`
- `apps/api/src/planning/http/planning-http.service.ts`
- `apps/api/src/planning/http/planning-jobs.worker.ts`
- `apps/api/scripts/benchmark-optimizer.ts`
- `docs/validation/`

## Uygulama adımları
1. Mevcut logları ve benchmark scriptlerini incele; aynı metriği iki kez hesaplayan mekanizma oluşturma.
2. Request-id ile ilişkilendirilen, hassas olmayan stage sürelerini topla: vehicle profile, base road, station corridor, road leg acquisitions, weather acquisition, energy evaluation, charge integration, optimizer search, plan compile, JSON serialize/gzip, job wait/execute. Gerçekten ölçülemeyen ölçümü uydurma.
3. Ayrı sayaçlar ekle: provider HTTP edinimi, PG cache hit/miss, per-plan road leg, weather sample/evaluation, energy evaluation, expanded state, transitions, frontier peak, cancelled/timeout, response bytes. Yeni sayaçları mevcut sayaçlarla çakışmadan tanımla.
4. Loglara koordinat, kullanıcı SOC, rota polylinesi, tam payload, secret, IP, bireysel konum veya tam GPS izi yazma; yalnız requestId, sürüm, evre, süre ve aggregate sayısal değerler.
5. Ağsız deterministik fixture baseline ile önbellekli/gerçek sağlayıcı ölçümünü ayrı raporla; gerçek sağlayıcı çağrısını isteğe bağlı ve kotaya saygılı yap; public demo üzerinde yük testi yapma.
6. Süre ve sayaçların kapalıyken sıfır/az ek yükle çalışacağı bir yapı tercih et; metrik altyapısını/telemetri sağlayıcısını bu görevde değiştirme.

## Kabul kriterleri
- Mevcut public API response ve optimizer sonucu bit düzeyinde veya mevcut sözleşme eşdeğerliğinde korunuyor.
- Stage metriklerinin sum/distribution mantığı belgeleniyor; gecikme kaynağı gözlemlenebilir.
- İlk baseline raporunda makine, komut, input fixture checksum, commit, p50/p95/p99, cache durumu ve gerçek ölçüm sınırları açık.
- API, shared ve mobil testleri ile tip kontrolü regresyon vermiyor.

## Beklenen teslim

docs/validation/perf-baseline-YYYY-MM-DD.md; dokunulan dosyalar listesi; baseline/after kıyaslama tablosu.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-001

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Performans gözlemlenebilirliği ve tekrarlanabilir baseline. Hedef: Davranışı değiştirmeden planın hangi adımda zaman/kaynak harcadığını ve cold/warm farkını ölç.
Bağımlılıklar: Yok. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/planning/planning-session.ts`
- `apps/api/src/planning/charge-stop-optimizer.ts`
- `apps/api/src/planning/http/planning-http.service.ts`
- `apps/api/src/planning/http/planning-jobs.worker.ts`
- `apps/api/scripts/benchmark-optimizer.ts`
- `docs/validation/`

## Sırayla uygulama
1. Mevcut logları ve benchmark scriptlerini incele; aynı metriği iki kez hesaplayan mekanizma oluşturma.
2. Request-id ile ilişkilendirilen, hassas olmayan stage sürelerini topla: vehicle profile, base road, station corridor, road leg acquisitions, weather acquisition, energy evaluation, charge integration, optimizer search, plan compile, JSON serialize/gzip, job wait/execute. Gerçekten ölçülemeyen ölçümü uydurma.
3. Ayrı sayaçlar ekle: provider HTTP edinimi, PG cache hit/miss, per-plan road leg, weather sample/evaluation, energy evaluation, expanded state, transitions, frontier peak, cancelled/timeout, response bytes. Yeni sayaçları mevcut sayaçlarla çakışmadan tanımla.
4. Loglara koordinat, kullanıcı SOC, rota polylinesi, tam payload, secret, IP, bireysel konum veya tam GPS izi yazma; yalnız requestId, sürüm, evre, süre ve aggregate sayısal değerler.
5. Ağsız deterministik fixture baseline ile önbellekli/gerçek sağlayıcı ölçümünü ayrı raporla; gerçek sağlayıcı çağrısını isteğe bağlı ve kotaya saygılı yap; public demo üzerinde yük testi yapma.
6. Süre ve sayaçların kapalıyken sıfır/az ek yükle çalışacağı bir yapı tercih et; metrik altyapısını/telemetri sağlayıcısını bu görevde değiştirme.

## Kabul ve test kapısı
- Mevcut public API response ve optimizer sonucu bit düzeyinde veya mevcut sözleşme eşdeğerliğinde korunuyor.
- Stage metriklerinin sum/distribution mantığı belgeleniyor; gecikme kaynağı gözlemlenebilir.
- İlk baseline raporunda makine, komut, input fixture checksum, commit, p50/p95/p99, cache durumu ve gerçek ölçüm sınırları açık.
- API, shared ve mobil testleri ile tip kontrolü regresyon vermiyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/perf-baseline-YYYY-MM-DD.md; dokunulan dosyalar listesi; baseline/after kıyaslama tablosu.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-002 — Optimizer frontier için stabil priority queue

**Faz:** A · Güvenli hızlandırma  
**Öncelik:** P0  
**Risk:** Düşük–orta  
**Bağımlılıklar:** 01  
**Durum:** TODO

## Amaç

Her iterasyondaki frontier.sort+shift yerine sıralama semantiğini koruyan bounded binary heap kullan.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/charge-stop-optimizer.ts`
- `apps/api/src/planning/__tests__/optimizer.spec.ts`
- `apps/api/src/planning/validation/`

## Uygulama adımları
1. compareStates fonksiyonunun üç objective için eşitlik/tie-break davranışını incele, mevcut golden fixtures çıktısını sakla.
2. Yalnız frontier veri yapısını küçük ve tip güvenli bir priority queue ile değiştir; O(log n) push/pop, maxFrontier semantiği değişmesin.
3. Tam eşitlikte eski stabil Array.sort davranışına karşı monoton insertion sequence tie-break ekle; karşılaştırma sonucu, visited ve stop sırası değişmemeli.
4. AbortSignal, state/transition bütçeleri, yieldLoop, incumbent, stopReason, computed metadata, reason kodlarını aynen koru.
5. Ayrı yeni npm dependency ekleme; yerel küçük veri yapısı ve doğrudan unit testi tercih et.
6. 15 bağımsız referans fixture + random seeded frontier yükleriyle semantik eşdeğerliği ölç; before/after CPU, heap ve sonuç checksum raporla.

## Kabul kriterleri
- Üç objective ve tie-break altında aynı kazanan plan ve sıralama.
- Bütçe aşımlarındaki hata türleri/metadata değişmiyor.
- p95/p99 ve CPU karşılaştırması, hızlı/aynı/yavaş sonuçlar açık.
- Golden/optimizer testleri geçiyor; davranış farkı varsa kodu default yapma.

## Beklenen teslim

docs/validation/frontier-queue-benchmark.md ve küçük kapsamlı optimizer diff.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-002

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Optimizer frontier için stabil priority queue. Hedef: Her iterasyondaki frontier.sort+shift yerine sıralama semantiğini koruyan bounded binary heap kullan.
Bağımlılıklar: 01. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/api/src/planning/charge-stop-optimizer.ts`
- `apps/api/src/planning/__tests__/optimizer.spec.ts`
- `apps/api/src/planning/validation/`

## Sırayla uygulama
1. compareStates fonksiyonunun üç objective için eşitlik/tie-break davranışını incele, mevcut golden fixtures çıktısını sakla.
2. Yalnız frontier veri yapısını küçük ve tip güvenli bir priority queue ile değiştir; O(log n) push/pop, maxFrontier semantiği değişmesin.
3. Tam eşitlikte eski stabil Array.sort davranışına karşı monoton insertion sequence tie-break ekle; karşılaştırma sonucu, visited ve stop sırası değişmemeli.
4. AbortSignal, state/transition bütçeleri, yieldLoop, incumbent, stopReason, computed metadata, reason kodlarını aynen koru.
5. Ayrı yeni npm dependency ekleme; yerel küçük veri yapısı ve doğrudan unit testi tercih et.
6. 15 bağımsız referans fixture + random seeded frontier yükleriyle semantik eşdeğerliği ölç; before/after CPU, heap ve sonuç checksum raporla.

## Kabul ve test kapısı
- Üç objective ve tie-break altında aynı kazanan plan ve sıralama.
- Bütçe aşımlarındaki hata türleri/metadata değişmiyor.
- p95/p99 ve CPU karşılaştırması, hızlı/aynı/yavaş sonuçlar açık.
- Golden/optimizer testleri geçiyor; davranış farkı varsa kodu default yapma.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/frontier-queue-benchmark.md ve küçük kapsamlı optimizer diff.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-003 — Şarj istasyonu adaylarını güvenli ve ucuz ön değerlendirme

**Faz:** A · Güvenli hızlandırma  
**Öncelik:** P0  
**Risk:** Orta  
**Bağımlılıklar:** 01, 02  
**Durum:** TODO

## Amaç

Pahalı provider çağrısı öncesi yalnız kanıtlanabilir biçimde uygun olmayan adayları ayır ve rota koridorunda çeşitliliği koru.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/catalogue-station-scenario.ts`
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/stations/db-station.provider.ts`
- `apps/api/src/planning/__tests__/`

## Uygulama adımları
1. Mevcut PostGIS corridor sonuçları, katalog senaryosu, EVSE/connector ID, erişim ve kaynak kalitesi davranışlarını incele.
2. Ucuz eligibility kontrollerini açık gerekçe kodlarıyla uygula: kesin uyumsuz DC standardı, kesin kapalı/erişilemez, yanlış lifecycle, geçersiz/tekrarlı ID, kesin yasaklı bağlantı. Unknown ve fiziksel EVSE eksikliğini doğrulanmış ret gibi kullanma.
3. Geliştirme sırasında aynı rota üzerinde daha zayıf görünen fakat daha iyi yol sapması, şarj süresi veya rezerv sağlayabilecek adayları rastgele atma.
4. Mevcut 2/5/10 km koridor genişletmesi, maxStations, coverage.completeForQuery, truncated, data-quality ve catalogue_power_scenario semantiğini koru.
5. İlk sürümde sonucu değiştirmeyen pre-check/ordering tercih et; aday sayısını azaltmak zorunluysa güvenli kanıt ve feature flag koy.
6. Fixture senaryolarına alternatif erişim, iki yönlü yol, farklı araç soketi, null availability, yüksek kW ama kötü detour ve rezerv sınırı ekle.

## Kabul kriterleri
- Mevcut geçerli plan hiçbir fixtureda kaybolmuyor.
- Eksik/veri belirsizliği yanlışlıkla infeasible olarak sunulmuyor.
- İstasyon seçimi ve plan bütçe kullanımından önce/sonra kıyaslanıyor.
- Sözleşme ve veri kalitesi etiketleri korunuyor.

## Beklenen teslim

Candidate seçim gerekçe matrisi ve geriye uyumluluk testleri.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-003

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Şarj istasyonu adaylarını güvenli ve ucuz ön değerlendirme. Hedef: Pahalı provider çağrısı öncesi yalnız kanıtlanabilir biçimde uygun olmayan adayları ayır ve rota koridorunda çeşitliliği koru.
Bağımlılıklar: 01, 02. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/api/src/planning/catalogue-station-scenario.ts`
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/stations/db-station.provider.ts`
- `apps/api/src/planning/__tests__/`

## Sırayla uygulama
1. Mevcut PostGIS corridor sonuçları, katalog senaryosu, EVSE/connector ID, erişim ve kaynak kalitesi davranışlarını incele.
2. Ucuz eligibility kontrollerini açık gerekçe kodlarıyla uygula: kesin uyumsuz DC standardı, kesin kapalı/erişilemez, yanlış lifecycle, geçersiz/tekrarlı ID, kesin yasaklı bağlantı. Unknown ve fiziksel EVSE eksikliğini doğrulanmış ret gibi kullanma.
3. Geliştirme sırasında aynı rota üzerinde daha zayıf görünen fakat daha iyi yol sapması, şarj süresi veya rezerv sağlayabilecek adayları rastgele atma.
4. Mevcut 2/5/10 km koridor genişletmesi, maxStations, coverage.completeForQuery, truncated, data-quality ve catalogue_power_scenario semantiğini koru.
5. İlk sürümde sonucu değiştirmeyen pre-check/ordering tercih et; aday sayısını azaltmak zorunluysa güvenli kanıt ve feature flag koy.
6. Fixture senaryolarına alternatif erişim, iki yönlü yol, farklı araç soketi, null availability, yüksek kW ama kötü detour ve rezerv sınırı ekle.

## Kabul ve test kapısı
- Mevcut geçerli plan hiçbir fixtureda kaybolmuyor.
- Eksik/veri belirsizliği yanlışlıkla infeasible olarak sunulmuyor.
- İstasyon seçimi ve plan bütçe kullanımından önce/sonra kıyaslanıyor.
- Sözleşme ve veri kalitesi etiketleri korunuyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
Candidate seçim gerekçe matrisi ve geriye uyumluluk testleri.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-004 — Optimizer state dominance için konservatif budama

**Faz:** A · Güvenli hızlandırma  
**Öncelik:** P1  
**Risk:** Orta–yüksek  
**Bağımlılıklar:** 01, 02, 03  
**Durum:** TODO

## Amaç

Yalnız aynı geleceğe sahip olduğu kanıtlanmış state tekrarlarını ele; genel SOC/time kıyasından unsafe dominance üretme.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/charge-stop-optimizer.ts`
- `apps/api/src/planning/optimizer-types.ts`
- `apps/api/src/planning/__tests__/optimizer.spec.ts`
- `apps/api/src/planning/validation/`

## Uygulama adımları
1. State içindeki node, visited, SOC, saat, batarya sıcaklığı, kapasite snapshot, charge history, objective, road/weather model ve reserve etkisini envantere al.
2. Başlangıçta aynı future-relevant context değerlerine ve eşdeğer çıktılara sahip exact-duplicate state eliminasyonu uygula; key içine sürüm ve plan politikası farklıysa dahil et.
3. Kaba SOC binning ile daha yüksek SOC her zaman daha iyi varsayma; zaman, hava, termal, fiyat/queue, state geçmişi ve rejenerasyon farklıysa state budama.
4. Minimum energy amacında net kWh için yanlış monoton pruning yapma; mevcut amaç ve incumbent kurallarına dokunma.
5. İleri dominance kuralı ancak matematiksel ispat/golden exhaustive solver karşılaştırması varsa ayrı flag altında sunulsun; yoksa bu task yalnız konservatif dedup ile kapanabilir.
6. Pareto referans fixturelarını, random seeded küçük graf exhaustive karşılaştırmasını ve düşük SOC uçlarını kullan.

## Kabul kriterleri
- Mevcut 15 golden ve exhaustive fixturelarla plan değerleri eşdeğer.
- Belirsiz state alanlarında budama yapılmadığı testle kanıtlanıyor.
- PrunedStates sayaçları ve CPU/transition farkı ölçülüyor.
- Kanıt olmadan agresif dominance etkinleşmiyor.

## Beklenen teslim

docs/validation/state-pruning-proof.md, karşı-örnekler, test sonuçları.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-004

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Optimizer state dominance için konservatif budama. Hedef: Yalnız aynı geleceğe sahip olduğu kanıtlanmış state tekrarlarını ele; genel SOC/time kıyasından unsafe dominance üretme.
Bağımlılıklar: 01, 02, 03. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/api/src/planning/charge-stop-optimizer.ts`
- `apps/api/src/planning/optimizer-types.ts`
- `apps/api/src/planning/__tests__/optimizer.spec.ts`
- `apps/api/src/planning/validation/`

## Sırayla uygulama
1. State içindeki node, visited, SOC, saat, batarya sıcaklığı, kapasite snapshot, charge history, objective, road/weather model ve reserve etkisini envantere al.
2. Başlangıçta aynı future-relevant context değerlerine ve eşdeğer çıktılara sahip exact-duplicate state eliminasyonu uygula; key içine sürüm ve plan politikası farklıysa dahil et.
3. Kaba SOC binning ile daha yüksek SOC her zaman daha iyi varsayma; zaman, hava, termal, fiyat/queue, state geçmişi ve rejenerasyon farklıysa state budama.
4. Minimum energy amacında net kWh için yanlış monoton pruning yapma; mevcut amaç ve incumbent kurallarına dokunma.
5. İleri dominance kuralı ancak matematiksel ispat/golden exhaustive solver karşılaştırması varsa ayrı flag altında sunulsun; yoksa bu task yalnız konservatif dedup ile kapanabilir.
6. Pareto referans fixturelarını, random seeded küçük graf exhaustive karşılaştırmasını ve düşük SOC uçlarını kullan.

## Kabul ve test kapısı
- Mevcut 15 golden ve exhaustive fixturelarla plan değerleri eşdeğer.
- Belirsiz state alanlarında budama yapılmadığı testle kanıtlanıyor.
- PrunedStates sayaçları ve CPU/transition farkı ölçülüyor.
- Kanıt olmadan agresif dominance etkinleşmiyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/state-pruning-proof.md, karşı-örnekler, test sonuçları.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-005 — PlanningSession içi hesaplama tekrarını azaltma

**Faz:** A · Güvenli hızlandırma  
**Öncelik:** P0  
**Risk:** Orta  
**Bağımlılıklar:** 01, 03  
**Durum:** TODO

## Amaç

Aynı plan işi içindeki tekrar eden yol/hava/enerji geçişlerini doğru cache key ile yeniden kullan; joblar arası stale fiziksel veri paylaşma.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/planning-session.ts`
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/weather/weather.service.ts`
- `apps/api/src/planning/__tests__/`

## Uygulama adımları
1. Var olan road Map, weather Map ve PostgreSQL provider cache/lease/fencing’i incele; birbirinin yerine geçen yeni cache katmanı oluşturma.
2. Tekrarlı geometri, station-to-station road leg ve hava SERİSİ acquisition tekrarını trace counters ile ortaya koy; değişen departureAt/traffic koşullarında yanlış paylaşımı engelle.
3. EnergyEvaluationResult memo ancak araç profil/model sürümü, route checksum, hava örnek/sürümü, başlangıç SOC, kapasite, batarya sıcaklığı, koşullar, departure time, continuation kind ve policy tam eşitse kullanılabilir; bunun yerine güvenli kısa kapsamlı cache de seçilebilir.
4. Shared mutable state veya global singleton in-memory per-user cache ekleme; öncelikle request-scoped memo. Unknown/insufficient/provider error sonuçlarını gizli başarılı sonuca dönüştürme.
5. Süre/ağ bütçesi, AbortSignal, kaynak atfı, replay snapshot checksum, tazelik ve 72 saat politikaları aynı kalmalı.
6. İlk önce hit/miss ve cache doğru/yanlış key testleri ekle; ardından benchmark ile dış istek sayısını ve CPU etkisini göster.

## Kabul kriterleri
- Hatalı cross-SOC, cross-weather, cross-vehicle veya cross-time cache hit olmuyor.
- Same-input tekrarında hesaplama/edinim sayısı azalıyor veya azalmıyorsa nedeni raporlu.
- Plan/energy/SOC çıktıları eşdeğer; eskime veya iptal davranışları korunuyor.
- PostgreSQL cache ve rate-limit işleyişine dokunulmuyor.

## Beklenen teslim

docs/validation/planning-memoization.md, birim/entegrasyon testleri.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-005

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: PlanningSession içi hesaplama tekrarını azaltma. Hedef: Aynı plan işi içindeki tekrar eden yol/hava/enerji geçişlerini doğru cache key ile yeniden kullan; joblar arası stale fiziksel veri paylaşma.
Bağımlılıklar: 01, 03. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/api/src/planning/planning-session.ts`
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/weather/weather.service.ts`
- `apps/api/src/planning/__tests__/`

## Sırayla uygulama
1. Var olan road Map, weather Map ve PostgreSQL provider cache/lease/fencing’i incele; birbirinin yerine geçen yeni cache katmanı oluşturma.
2. Tekrarlı geometri, station-to-station road leg ve hava SERİSİ acquisition tekrarını trace counters ile ortaya koy; değişen departureAt/traffic koşullarında yanlış paylaşımı engelle.
3. EnergyEvaluationResult memo ancak araç profil/model sürümü, route checksum, hava örnek/sürümü, başlangıç SOC, kapasite, batarya sıcaklığı, koşullar, departure time, continuation kind ve policy tam eşitse kullanılabilir; bunun yerine güvenli kısa kapsamlı cache de seçilebilir.
4. Shared mutable state veya global singleton in-memory per-user cache ekleme; öncelikle request-scoped memo. Unknown/insufficient/provider error sonuçlarını gizli başarılı sonuca dönüştürme.
5. Süre/ağ bütçesi, AbortSignal, kaynak atfı, replay snapshot checksum, tazelik ve 72 saat politikaları aynı kalmalı.
6. İlk önce hit/miss ve cache doğru/yanlış key testleri ekle; ardından benchmark ile dış istek sayısını ve CPU etkisini göster.

## Kabul ve test kapısı
- Hatalı cross-SOC, cross-weather, cross-vehicle veya cross-time cache hit olmuyor.
- Same-input tekrarında hesaplama/edinim sayısı azalıyor veya azalmıyorsa nedeni raporlu.
- Plan/energy/SOC çıktıları eşdeğer; eskime veya iptal davranışları korunuyor.
- PostgreSQL cache ve rate-limit işleyişine dokunulmuyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/planning-memoization.md, birim/entegrasyon testleri.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-006 — Mobil GPS/rota eşleme ve ekran render yükü

**Faz:** B · Mobil performansı  
**Öncelik:** P0  
**Risk:** Orta  
**Bağımlılıklar:** 01  
**Durum:** TODO

## Amaç

GPS geldiğinde tüm geometri uzunluklarını ve kalan süreyi her seferinde hesaplama; yeni sunucu bağımlılığı olmadan mobil CPU ve render yükünü azalt.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/mobile/src/features/navigation/navigation-core.ts`
- `apps/mobile/src/features/navigation/NavigationPanel.tsx`
- `apps/mobile/src/features/map/MapCanvas.tsx`
- `apps/mobile/tests/navigation.test.cjs`

## Uygulama adımları
1. NavigationRoute geometry/segment/maneuver listesi, route revision, locateOnRoute ve navigationProgress ile eski algoritmanın sonuçlarını fixturelarda sabitle.
2. Rota yüklenirken bir kez prefix distance/time, segment bbox ve gerekirse küçük spatial-window index hesapla; yeni revision geldiğinde index invalidation yap.
3. İlk fix/konum sıçraması veya paralel otoyol durumlarında yalnız yakın index sonucunu zorlamadan güvenli geniş arama fallback’i bırak; mevcut ilerleme sürekliliğini koru.
4. GPS 2 sn / 10 m ayarını ve 15 sn stale/50 m accuracy filtrelerini koru. UI için gerekli progress state ile büyük immutable route snapshot’ı ayır; mevcut AppState pause/resume ve SOC anchor davranışı aynı.
5. 200, 1000, 5000, 15000 segmentli sentetik testler, loopback/yol kavşağı, geri dönüş, stop boundary, düşük doğruluk, art arda aynı GPS ve plan revision değişimi testleri yaz.
6. RN/Expo paketleri, harita renderer ve API sözleşmesini değiştirme; harita provider değişimi bu taskta yapılmaz.

## Kabul kriterleri
- Eski ve yeni algoritma route progress/SOC/manevra çıktıları tolerans içinde eşdeğer.
- GPS update p50/p95/p99 ve render/progress update sayısı ölçülmüş.
- Plan revision değişince stale indeks kullanılmıyor.
- Expo typecheck/export ve mobil testleri geçiyor; fiziksel telefon kabulü ayrıca açık.

## Beklenen teslim

docs/validation/mobile-navigation-cpu.md ve test/benchmark.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-006

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Mobil GPS/rota eşleme ve ekran render yükü. Hedef: GPS geldiğinde tüm geometri uzunluklarını ve kalan süreyi her seferinde hesaplama; yeni sunucu bağımlılığı olmadan mobil CPU ve render yükünü azalt.
Bağımlılıklar: 01. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/mobile/src/features/navigation/navigation-core.ts`
- `apps/mobile/src/features/navigation/NavigationPanel.tsx`
- `apps/mobile/src/features/map/MapCanvas.tsx`
- `apps/mobile/tests/navigation.test.cjs`

## Sırayla uygulama
1. NavigationRoute geometry/segment/maneuver listesi, route revision, locateOnRoute ve navigationProgress ile eski algoritmanın sonuçlarını fixturelarda sabitle.
2. Rota yüklenirken bir kez prefix distance/time, segment bbox ve gerekirse küçük spatial-window index hesapla; yeni revision geldiğinde index invalidation yap.
3. İlk fix/konum sıçraması veya paralel otoyol durumlarında yalnız yakın index sonucunu zorlamadan güvenli geniş arama fallback’i bırak; mevcut ilerleme sürekliliğini koru.
4. GPS 2 sn / 10 m ayarını ve 15 sn stale/50 m accuracy filtrelerini koru. UI için gerekli progress state ile büyük immutable route snapshot’ı ayır; mevcut AppState pause/resume ve SOC anchor davranışı aynı.
5. 200, 1000, 5000, 15000 segmentli sentetik testler, loopback/yol kavşağı, geri dönüş, stop boundary, düşük doğruluk, art arda aynı GPS ve plan revision değişimi testleri yaz.
6. RN/Expo paketleri, harita renderer ve API sözleşmesini değiştirme; harita provider değişimi bu taskta yapılmaz.

## Kabul ve test kapısı
- Eski ve yeni algoritma route progress/SOC/manevra çıktıları tolerans içinde eşdeğer.
- GPS update p50/p95/p99 ve render/progress update sayısı ölçülmüş.
- Plan revision değişince stale indeks kullanılmıyor.
- Expo typecheck/export ve mobil testleri geçiyor; fiziksel telefon kabulü ayrıca açık.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/mobile-navigation-cpu.md ve test/benchmark.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-007 — Geri uyumlu kompakt mobil plan yanıtı

**Faz:** B · Veri transferi  
**Öncelik:** P1  
**Risk:** Orta  
**Bağımlılıklar:** 01, 06  
**Durum:** TODO

## Amaç

Büyük full planning kanıtını varsayılan APIyi bozmadan mobilde gereken küçültülmüş navigasyon görünümünden ayır.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/http/planning-jobs.controller.ts`
- `apps/api/src/planning/http/planning-response.ts`
- `apps/api/src/planning/plan-compiler.ts`
- `packages/shared/src/contracts/`
- `apps/mobile/src/api/planning.ts`
- `apps/mobile/src/features/navigation/navigation-core.ts`

## Uygulama adımları
1. Mevcut GET /v1/planning-jobs/:id/result ve POST /v1/plans yanıtlarını, JSON gzip limitlerini ve full plan doğrulama şemasını aynen koru.
2. Sadece mevcut plan sonucundan sunucu tarafında üretilen versioned, strict Zod validated `navigation-view` projection tasarla; optimizasyona ve enerji hesabına müdahale etme.
3. Yeni opt-in endpoint veya Accept-versioned representation tercih et; eskisini kaldırma. Mevcut job capability Bearer kontrolünü aynen kullan; CORS/log/secrets standardına uy.
4. UI için gerekli geometry, maneuvers, stops, ETA/SOC, estimated/observed ayrımı, data-quality, warnings, source license/attributions alanlarını kayıpsız tut. Ayrıntılı trace/forecast/snapshot kanıtı full response’da kalmalı.
5. React Native tarafında opt-in ve full response fallback’i flag altında aç; harita ve navigasyon akışı davranışı değişmemeli.
6. Kısa/uzun rota için wire bytes, decoded bytes, parse ms, ilk çizim gecikmesi karşılaştır; 100 kB gibi sahte kesin limit koyma.

## Kabul kriterleri
- Eski GET /result full payload, 2 MiB/16 MiB korumaları ve public contracts kırılmıyor.
- Yeni projection ile mobilde çizgi, manevra, SOC, durak ve atıf aynı.
- Eski backend veya opt-in kapalıyken mobil eski path üzerinden çalışıyor.
- Güvenlik ve gzip/encoding/abort/timeout testleri geçiyor.

## Beklenen teslim

docs/validation/mobile-response-projection.md, payload boyut kıyası.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-007

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Geri uyumlu kompakt mobil plan yanıtı. Hedef: Büyük full planning kanıtını varsayılan APIyi bozmadan mobilde gereken küçültülmüş navigasyon görünümünden ayır.
Bağımlılıklar: 01, 06. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/api/src/planning/http/planning-jobs.controller.ts`
- `apps/api/src/planning/http/planning-response.ts`
- `apps/api/src/planning/plan-compiler.ts`
- `packages/shared/src/contracts/`
- `apps/mobile/src/api/planning.ts`
- `apps/mobile/src/features/navigation/navigation-core.ts`

## Sırayla uygulama
1. Mevcut GET /v1/planning-jobs/:id/result ve POST /v1/plans yanıtlarını, JSON gzip limitlerini ve full plan doğrulama şemasını aynen koru.
2. Sadece mevcut plan sonucundan sunucu tarafında üretilen versioned, strict Zod validated `navigation-view` projection tasarla; optimizasyona ve enerji hesabına müdahale etme.
3. Yeni opt-in endpoint veya Accept-versioned representation tercih et; eskisini kaldırma. Mevcut job capability Bearer kontrolünü aynen kullan; CORS/log/secrets standardına uy.
4. UI için gerekli geometry, maneuvers, stops, ETA/SOC, estimated/observed ayrımı, data-quality, warnings, source license/attributions alanlarını kayıpsız tut. Ayrıntılı trace/forecast/snapshot kanıtı full response’da kalmalı.
5. React Native tarafında opt-in ve full response fallback’i flag altında aç; harita ve navigasyon akışı davranışı değişmemeli.
6. Kısa/uzun rota için wire bytes, decoded bytes, parse ms, ilk çizim gecikmesi karşılaştır; 100 kB gibi sahte kesin limit koyma.

## Kabul ve test kapısı
- Eski GET /result full payload, 2 MiB/16 MiB korumaları ve public contracts kırılmıyor.
- Yeni projection ile mobilde çizgi, manevra, SOC, durak ve atıf aynı.
- Eski backend veya opt-in kapalıyken mobil eski path üzerinden çalışıyor.
- Güvenlik ve gzip/encoding/abort/timeout testleri geçiyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/mobile-response-projection.md, payload boyut kıyası.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-008 — Navigasyon olayı sınıflandırıcısı ve replan policy

**Faz:** C · Dinamik karar  
**Öncelik:** P0  
**Risk:** Orta  
**Bağımlılıklar:** 06  
**Durum:** TODO

## Amaç

GPS, SOC ve istasyon değişimlerini anlık UI, charging-only, route repair veya full replan olarak ayır; henüz backend API ekleme.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/mobile/src/features/navigation/navigation-core.ts`
- `apps/mobile/src/features/navigation/NavigationPanel.tsx`
- `apps/mobile/tests/navigation.test.cjs`
- `packages/shared/src/contracts/`

## Uygulama adımları
1. Mevcut 3 fix / 10 sn off-route doğrulamasını, 60 sn Retry-After ve manual charge confirmation mantığını koru.
2. Saf deterministic `evaluateNavigationEvent` benzeri fonksiyon ile event category/reason/severity/debounce planı üret. Önce alan/fixtureları tasarla; sırf teori için global event bus ekleme.
3. Olaylar: küçük GPS hareketi -> local, verified off-route -> repair candidate, manual SOC -> charging replan candidate, verified next station outage -> charging/repair, road closure -> full, critical reserve -> urgent assessment.
4. Unknown availability bir out-of-service kanıtı değildir. 60 sn cooldown normal istekleri azaltır; kritik riskte sessizce planı güvenli ilan etme ve kör bekletme.
5. Hızlı GPS spike, tünel, paralel yol, GPS drift, arka plan pause/resume, aynı olayın tekrarları, replan iptali ve eski generation yarışı test et.
6. Bu adımda eski replan API yolunu varsayılan koru; farklı yeni modları yalnız decision/telemetry seviyesinde gösterebilir, feature flag ile dispatch etmeyi sonraki işe bırak.

## Kabul kriterleri
- Normal GPS akışı backend replan üretmiyor.
- Manual SOC, off-route, station-outage, stale-data ve critical reserve ayrı semantik.
- Anti-flapping/idempotency/event priority testleri geçiyor.
- Mobil UI/API mevcut kullanıcı davranışı aynı.

## Beklenen teslim

docs/validation/replan-event-matrix.md, karar tablosu ve testler.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-008

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Navigasyon olayı sınıflandırıcısı ve replan policy. Hedef: GPS, SOC ve istasyon değişimlerini anlık UI, charging-only, route repair veya full replan olarak ayır; henüz backend API ekleme.
Bağımlılıklar: 06. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/mobile/src/features/navigation/navigation-core.ts`
- `apps/mobile/src/features/navigation/NavigationPanel.tsx`
- `apps/mobile/tests/navigation.test.cjs`
- `packages/shared/src/contracts/`

## Sırayla uygulama
1. Mevcut 3 fix / 10 sn off-route doğrulamasını, 60 sn Retry-After ve manual charge confirmation mantığını koru.
2. Saf deterministic `evaluateNavigationEvent` benzeri fonksiyon ile event category/reason/severity/debounce planı üret. Önce alan/fixtureları tasarla; sırf teori için global event bus ekleme.
3. Olaylar: küçük GPS hareketi -> local, verified off-route -> repair candidate, manual SOC -> charging replan candidate, verified next station outage -> charging/repair, road closure -> full, critical reserve -> urgent assessment.
4. Unknown availability bir out-of-service kanıtı değildir. 60 sn cooldown normal istekleri azaltır; kritik riskte sessizce planı güvenli ilan etme ve kör bekletme.
5. Hızlı GPS spike, tünel, paralel yol, GPS drift, arka plan pause/resume, aynı olayın tekrarları, replan iptali ve eski generation yarışı test et.
6. Bu adımda eski replan API yolunu varsayılan koru; farklı yeni modları yalnız decision/telemetry seviyesinde gösterebilir, feature flag ile dispatch etmeyi sonraki işe bırak.

## Kabul ve test kapısı
- Normal GPS akışı backend replan üretmiyor.
- Manual SOC, off-route, station-outage, stale-data ve critical reserve ayrı semantik.
- Anti-flapping/idempotency/event priority testleri geçiyor.
- Mobil UI/API mevcut kullanıcı davranışı aynı.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/replan-event-matrix.md, karar tablosu ve testler.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-009 — Backend charging-only continuation çekirdeği

**Faz:** C · Kısmi yeniden planlama  
**Öncelik:** P0  
**Risk:** Yüksek  
**Bağımlılıklar:** 03, 04, 05, 08  
**Durum:** TODO

## Amaç

Rota geometrisi geçerli kaldığında yeni gerçek SOC ile kalan şarj kararlarını yeniden hesaplayan isteğe bağlı iç servis oluştur; public APIyi değiştirme.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/planning/planning-session.ts`
- `apps/api/src/planning/charge-stop-optimizer.ts`
- `apps/api/src/planning/optimizer-types.ts`
- `apps/api/src/planning/__tests__/`

## Uygulama adımları
1. Mevcut plan result, validationInput/replay, snapshots, source versions, stop IDs, time, SOC ve capacity continuity modellerini incele.
2. Yeni continuation kullanımı için server-trusted immutable route bacakları ve planın route revision/graf+DEM sürümünün uyumu gerekir. İstemciden gelen keyfi rota polylinesini trusted olarak kabul etme.
3. Güncel konumu mevcut rotaya güvenilir eşleştir; sürüş başlangıcı yalnız kalan yol olsun. Eski tamamlanmış duraklar tüketim/şarj hesabına tekrar katılmasın.
4. Yeni gözlemlenmiş SOC baseline ile enerji, batarya termal durumu ve şarj eğrisi hesabını tekrar değerlendir. Hava geçiş zamanı/charge delay değişirse yeniden örnekle. Eski enerji sonucunu her durumda geçerli sayma.
5. Mevcut motorları kullan; ayrı EV optimizasyon algoritması veya ikinci charging math implementasyonu oluşturma.
6. Kaynak/rota tam, güncel ve uyumlu değilse açık `continuation_unavailable` gibi internal diagnostic dön; mevcut full plan akışına kontrollü fallback. Yanlış veya konumu bilinmeyen prefix splice kabul etme.
7. Üç SOC senaryosu (%60, %75, %90), şarjdan erken ayrılma, rezerv ihlali, yeni rota gerektiren durak ve düşük/hatalı GPS senaryolarıyla bağımsız motor validation testi yap.

## Kabul kriterleri
- Continuation result mevcut public evaluator/energy/charging kurallarından geçiyor.
- Geçerli aynı koşullarda full replan ile feasibility ve SOC hesapları uyumlu; optimumluk iddiası yok.
- Eski plan iptal, provider stale veya route mismatch olduğunda güvenli fallback.
- Yeni HTTP/migration/mobile akışı yok; default akış etkilenmiyor.

## Beklenen teslim

docs/validation/charging-continuation.md; güvenli veri önkoşulları + testler.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-009

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Backend charging-only continuation çekirdeği. Hedef: Rota geometrisi geçerli kaldığında yeni gerçek SOC ile kalan şarj kararlarını yeniden hesaplayan isteğe bağlı iç servis oluştur; public APIyi değiştirme.
Bağımlılıklar: 03, 04, 05, 08. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/planning/planning-session.ts`
- `apps/api/src/planning/charge-stop-optimizer.ts`
- `apps/api/src/planning/optimizer-types.ts`
- `apps/api/src/planning/__tests__/`

## Sırayla uygulama
1. Mevcut plan result, validationInput/replay, snapshots, source versions, stop IDs, time, SOC ve capacity continuity modellerini incele.
2. Yeni continuation kullanımı için server-trusted immutable route bacakları ve planın route revision/graf+DEM sürümünün uyumu gerekir. İstemciden gelen keyfi rota polylinesini trusted olarak kabul etme.
3. Güncel konumu mevcut rotaya güvenilir eşleştir; sürüş başlangıcı yalnız kalan yol olsun. Eski tamamlanmış duraklar tüketim/şarj hesabına tekrar katılmasın.
4. Yeni gözlemlenmiş SOC baseline ile enerji, batarya termal durumu ve şarj eğrisi hesabını tekrar değerlendir. Hava geçiş zamanı/charge delay değişirse yeniden örnekle. Eski enerji sonucunu her durumda geçerli sayma.
5. Mevcut motorları kullan; ayrı EV optimizasyon algoritması veya ikinci charging math implementasyonu oluşturma.
6. Kaynak/rota tam, güncel ve uyumlu değilse açık `continuation_unavailable` gibi internal diagnostic dön; mevcut full plan akışına kontrollü fallback. Yanlış veya konumu bilinmeyen prefix splice kabul etme.
7. Üç SOC senaryosu (%60, %75, %90), şarjdan erken ayrılma, rezerv ihlali, yeni rota gerektiren durak ve düşük/hatalı GPS senaryolarıyla bağımsız motor validation testi yap.

## Kabul ve test kapısı
- Continuation result mevcut public evaluator/energy/charging kurallarından geçiyor.
- Geçerli aynı koşullarda full replan ile feasibility ve SOC hesapları uyumlu; optimumluk iddiası yok.
- Eski plan iptal, provider stale veya route mismatch olduğunda güvenli fallback.
- Yeni HTTP/migration/mobile akışı yok; default akış etkilenmiyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/charging-continuation.md; güvenli veri önkoşulları + testler.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-010 — Kısmi rota onarımı ve güvenli full fallback

**Faz:** C · Kısmi yeniden planlama  
**Öncelik:** P0  
**Risk:** Yüksek  
**Bağımlılıklar:** 08, 09  
**Durum:** TODO

## Amaç

Kısa sapmalarda güncel konumdan geçerli kalan güzergâha yasal ve yönlü bağlantı üret; sağlanamıyorsa full plan yap.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/roads/road-service.ts`
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/planning/planning-session.ts`
- `apps/api/src/planning/plan-compiler.ts`
- `apps/api/src/planning/__tests__/`

## Uygulama adımları
1. Valhalla/Geoapify provider portlarını, avoid toll/ferry, endpoint snap 100 m, segmentation, turn maneuvers ve source lisans/provenance kurallarını incele.
2. Yalnız doğrudan provider yönlü yol bağlantısı olan veya yeniden route edilmiş segmentleri birleştir; ham polyline ucu yakın diye sürülebilir yol varsayma.
3. Kavşak/one-way, köprü/altgeçit, bölünmüş yol, barrier, kapalı yol, erişilemeyen station driveway ve loop senaryolarını testle.
4. Bağlantı sonrası önceki yolun kalan kısmını yalnız kaynak/graf sürümü ve seçilen yeniden bağlanma noktası geçerliyse koru. Mesafe/süre, segment ID, maneuver offset ve başlangıç/endpoints validatorlarını yeniden çalıştır.
5. Yeni geçiş zamanı, actual SOC, weather forecast, detour energy/charging duration ve reserve constraints ile final validation zorunlu.
6. Route repair mümkün değilse veya optimumluk/coverage veri bütçesi yetersizse güvenli full replana geç. Geçerli incumbent varsa koşullu ve sınırlı arama etiketi korunur.
7. Pilot testte aynı yol/az sapma için gereksiz tam yol çağrıları düşmeli; provider quota veya cache namespace değişmez.

## Kabul kriterleri
- Off-route sonucu aracın erişemeyeceği geometriye bağlanmıyor.
- Yol ve enerji balance evaluator testleri geçiyor; maneuver offset düzgün.
- Zor senaryoda repair değil full fallback tetikleniyor.
- Self-hosted Valhalla DEM kalite kuralları, source attribution ve bilinmeyen hız/DEM politikası korunuyor.

## Beklenen teslim

docs/validation/route-repair.md, fixture + full fallback kanıtı.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-010

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Kısmi rota onarımı ve güvenli full fallback. Hedef: Kısa sapmalarda güncel konumdan geçerli kalan güzergâha yasal ve yönlü bağlantı üret; sağlanamıyorsa full plan yap.
Bağımlılıklar: 08, 09. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/api/src/roads/road-service.ts`
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/planning/planning-session.ts`
- `apps/api/src/planning/plan-compiler.ts`
- `apps/api/src/planning/__tests__/`

## Sırayla uygulama
1. Valhalla/Geoapify provider portlarını, avoid toll/ferry, endpoint snap 100 m, segmentation, turn maneuvers ve source lisans/provenance kurallarını incele.
2. Yalnız doğrudan provider yönlü yol bağlantısı olan veya yeniden route edilmiş segmentleri birleştir; ham polyline ucu yakın diye sürülebilir yol varsayma.
3. Kavşak/one-way, köprü/altgeçit, bölünmüş yol, barrier, kapalı yol, erişilemeyen station driveway ve loop senaryolarını testle.
4. Bağlantı sonrası önceki yolun kalan kısmını yalnız kaynak/graf sürümü ve seçilen yeniden bağlanma noktası geçerliyse koru. Mesafe/süre, segment ID, maneuver offset ve başlangıç/endpoints validatorlarını yeniden çalıştır.
5. Yeni geçiş zamanı, actual SOC, weather forecast, detour energy/charging duration ve reserve constraints ile final validation zorunlu.
6. Route repair mümkün değilse veya optimumluk/coverage veri bütçesi yetersizse güvenli full replana geç. Geçerli incumbent varsa koşullu ve sınırlı arama etiketi korunur.
7. Pilot testte aynı yol/az sapma için gereksiz tam yol çağrıları düşmeli; provider quota veya cache namespace değişmez.

## Kabul ve test kapısı
- Off-route sonucu aracın erişemeyeceği geometriye bağlanmıyor.
- Yol ve enerji balance evaluator testleri geçiyor; maneuver offset düzgün.
- Zor senaryoda repair değil full fallback tetikleniyor.
- Self-hosted Valhalla DEM kalite kuralları, source attribution ve bilinmeyen hız/DEM politikası korunuyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/route-repair.md, fixture + full fallback kanıtı.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-011 — Geriye uyumlu asenkron replan API ve plan revision

**Faz:** C · Sunucu entegrasyonu  
**Öncelik:** P0  
**Risk:** Yüksek  
**Bağımlılıklar:** 09, 10  
**Durum:** TODO

## Amaç

Server-trusted mevcut plan kimliği ve revision üzerinden charging-only/repair/full talebini opt-in kabul et; eski endpointleri kırma.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/http/planning-jobs.controller.ts`
- `apps/api/src/planning/http/planning-jobs.store.ts`
- `apps/api/src/planning/http/planning-jobs.worker.ts`
- `apps/api/src/planning/http/planning-http.service.ts`
- `packages/shared/src/contracts/`
- `apps/api/src/planning/__tests__/`

## Uygulama adımları
1. GET /v1/planning-jobs/:id, GET /result, POST create, DELETE cancel ve 30 dk TTL/capability modelini incele. Bunların response/semantiği değişmesin.
2. Yeni dar kapsamlı versioned request/endpoint veya mevcut iş akışının backward-compatible opsiyonel şekli ile `replan` isteği sun; erişim hakkı önceki planın server-side kayıtlarına dayanmalı. User-supplied geometry/vehicle model trusted olamaz.
3. TripSession/planRevision/supersedes ilişkisini en küçük kalıcı tasarımla ve mevcut ownership/token modeline uygun kur; mevcut plan `revision:1` kullanımını diğer full endpointlerde bozma.
4. Aynı session için tek aktif revision kararını CAS/transaction ile uygula. Gecikmiş worker, iptal veya stale revision sonucu yeni planı ezemesin; eski payload TTL sonrası otomatik erişilemesin.
5. İş sonucu `charging_only`, `route_repair` veya `full` hangi yol kullanıldı bilgisiyle gelsin; farklı yolun fallback nedeni ve kalite/optimality etiketleri kaybolmasın.
6. Kapasite, global admission lease, SKIP LOCKED, request idempotency ve aynı key/different payload 409 kuralları korunmalı. Migration gerekiyorsa sadece additive, rollback ve indeks/test açıklamasıyla.
7. Bütün yeni çalışma feature flag kapalıyken existing clients/API tam uyumlu kalmalı; XSS/log/secret ve cancellation güvenliği denetlensin.

## Kabul kriterleri
- Aynı owner + idempotency ile tekrar güvenli, farklı owner 404/unauthorized; stale revision reddedilir.
- İki yarışan replan çağrısında yalnız en yeni kabul edilmiş plan aktif; geç sonuç çitlenmiş.
- 30 dk TTL, cancel, lease transfer ve no-payload-leak testleri geçiyor.
- Eski POST /plans, /planning-jobs ve /result testleri kırılmıyor.

## Beklenen teslim

docs/validation/replan-api-revision.md, contract/migration test ve rollback.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-011

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Geriye uyumlu asenkron replan API ve plan revision. Hedef: Server-trusted mevcut plan kimliği ve revision üzerinden charging-only/repair/full talebini opt-in kabul et; eski endpointleri kırma.
Bağımlılıklar: 09, 10. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/api/src/planning/http/planning-jobs.controller.ts`
- `apps/api/src/planning/http/planning-jobs.store.ts`
- `apps/api/src/planning/http/planning-jobs.worker.ts`
- `apps/api/src/planning/http/planning-http.service.ts`
- `packages/shared/src/contracts/`
- `apps/api/src/planning/__tests__/`

## Sırayla uygulama
1. GET /v1/planning-jobs/:id, GET /result, POST create, DELETE cancel ve 30 dk TTL/capability modelini incele. Bunların response/semantiği değişmesin.
2. Yeni dar kapsamlı versioned request/endpoint veya mevcut iş akışının backward-compatible opsiyonel şekli ile `replan` isteği sun; erişim hakkı önceki planın server-side kayıtlarına dayanmalı. User-supplied geometry/vehicle model trusted olamaz.
3. TripSession/planRevision/supersedes ilişkisini en küçük kalıcı tasarımla ve mevcut ownership/token modeline uygun kur; mevcut plan `revision:1` kullanımını diğer full endpointlerde bozma.
4. Aynı session için tek aktif revision kararını CAS/transaction ile uygula. Gecikmiş worker, iptal veya stale revision sonucu yeni planı ezemesin; eski payload TTL sonrası otomatik erişilemesin.
5. İş sonucu `charging_only`, `route_repair` veya `full` hangi yol kullanıldı bilgisiyle gelsin; farklı yolun fallback nedeni ve kalite/optimality etiketleri kaybolmasın.
6. Kapasite, global admission lease, SKIP LOCKED, request idempotency ve aynı key/different payload 409 kuralları korunmalı. Migration gerekiyorsa sadece additive, rollback ve indeks/test açıklamasıyla.
7. Bütün yeni çalışma feature flag kapalıyken existing clients/API tam uyumlu kalmalı; XSS/log/secret ve cancellation güvenliği denetlensin.

## Kabul ve test kapısı
- Aynı owner + idempotency ile tekrar güvenli, farklı owner 404/unauthorized; stale revision reddedilir.
- İki yarışan replan çağrısında yalnız en yeni kabul edilmiş plan aktif; geç sonuç çitlenmiş.
- 30 dk TTL, cancel, lease transfer ve no-payload-leak testleri geçiyor.
- Eski POST /plans, /planning-jobs ve /result testleri kırılmıyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/replan-api-revision.md, contract/migration test ve rollback.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-012 — Mobilde kontrollü dinamik replan entegrasyonu

**Faz:** C · Kullanıcı deneyimi  
**Öncelik:** P0  
**Risk:** Orta–yüksek  
**Bağımlılıklar:** 07, 08, 11  
**Durum:** TODO

## Amaç

Yeni replan APIyi flags altında kullan, kritik riskte kullanıcıya doğru durumu göster, eski backend ile çalış.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/mobile/src/api/planning.ts`
- `apps/mobile/src/features/navigation/NavigationPanel.tsx`
- `apps/mobile/src/features/navigation/navigation-core.ts`
- `apps/mobile/src/features/navigation/trip-storage.ts`
- `apps/mobile/tests/navigation.test.cjs`

## Uygulama adımları
1. NavigationPanel generation/AbortController, pause/resume, GPS stale/accuracy, pending job cancel ve 60 sn cooldown davranışlarını koru.
2. Saf event policy sonucuna göre `charging_only`, `route_repair`, `full` talebi oluştur. Aynı anda çoklu replan varsa son kullanıcı niyeti ve server revision fencing belirleyici olsun.
3. Eski API veya feature flag kapalıysa mevcut `planningApi.planAsync()` davranışına geri dön. Server `unavailable` veya stale data döndüğünde yanlış sessiz plan kabul etme.
4. Navigasyon sırasında eski planın görselini ancak açık `recalculating`/`not_current` uyarısıyla göster; planın güvenliği şüpheliyse uygun güvenlik uyarısı ver, GPS tahmini SOCyi measured olarak gösterme.
5. İstasyon onayı verilmeden SOC artışı ekleme; manuel SOC düzeltmeleri geçmişte ölçüm gibi otomatik öğrenmeye gönderilmesin.
6. Uygulama arka planda kaldığında mevcut pause ve açık resume onayı sürmeli. Pending job kapatma ve eski response race testleri ekle.
7. Road-only fallback, ETA unknown, availability unknown, quota Retry-After, offline/no GPS ve Expo Go kısıtlarını regresyonda kontrol et.

## Kabul kriterleri
- Kullanıcıda gereksiz rota yenileme/flash, eski sonucun ezmesi veya plansız SOC artışı yok.
- Her olay tipi doğru API/fallback davranışına sahip.
- Eski API sürümü ve flag kapalıyken mobile happy path aynı.
- Android/iOS Expo export cihaz testi olarak raporlanmıyor; gerçek cihaz kabulü ayrı.

## Beklenen teslim

docs/validation/mobile-dynamic-replanning.md, olay ve UI regresyon matrisi.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-012

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Mobilde kontrollü dinamik replan entegrasyonu. Hedef: Yeni replan APIyi flags altında kullan, kritik riskte kullanıcıya doğru durumu göster, eski backend ile çalış.
Bağımlılıklar: 07, 08, 11. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/mobile/src/api/planning.ts`
- `apps/mobile/src/features/navigation/NavigationPanel.tsx`
- `apps/mobile/src/features/navigation/navigation-core.ts`
- `apps/mobile/src/features/navigation/trip-storage.ts`
- `apps/mobile/tests/navigation.test.cjs`

## Sırayla uygulama
1. NavigationPanel generation/AbortController, pause/resume, GPS stale/accuracy, pending job cancel ve 60 sn cooldown davranışlarını koru.
2. Saf event policy sonucuna göre `charging_only`, `route_repair`, `full` talebi oluştur. Aynı anda çoklu replan varsa son kullanıcı niyeti ve server revision fencing belirleyici olsun.
3. Eski API veya feature flag kapalıysa mevcut `planningApi.planAsync()` davranışına geri dön. Server `unavailable` veya stale data döndüğünde yanlış sessiz plan kabul etme.
4. Navigasyon sırasında eski planın görselini ancak açık `recalculating`/`not_current` uyarısıyla göster; planın güvenliği şüpheliyse uygun güvenlik uyarısı ver, GPS tahmini SOCyi measured olarak gösterme.
5. İstasyon onayı verilmeden SOC artışı ekleme; manuel SOC düzeltmeleri geçmişte ölçüm gibi otomatik öğrenmeye gönderilmesin.
6. Uygulama arka planda kaldığında mevcut pause ve açık resume onayı sürmeli. Pending job kapatma ve eski response race testleri ekle.
7. Road-only fallback, ETA unknown, availability unknown, quota Retry-After, offline/no GPS ve Expo Go kısıtlarını regresyonda kontrol et.

## Kabul ve test kapısı
- Kullanıcıda gereksiz rota yenileme/flash, eski sonucun ezmesi veya plansız SOC artışı yok.
- Her olay tipi doğru API/fallback davranışına sahip.
- Eski API sürümü ve flag kapalıyken mobile happy path aynı.
- Android/iOS Expo export cihaz testi olarak raporlanmıyor; gerçek cihaz kabulü ayrı.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/mobile-dynamic-replanning.md, olay ve UI regresyon matrisi.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-013 — Planning worker izolasyonu ve kapasite kontrolü

**Faz:** D · Ölçek/işletim  
**Öncelik:** P1  
**Risk:** Orta–yüksek  
**Bağımlılıklar:** 01, 11  
**Durum:** TODO

## Amaç

Mevcut PostgreSQL kuyruğunu koruyup worker çalıştırma rolünü API prosesinden opsiyonel ayır; Redis/RabbitMQ ekleme.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/http/planning-jobs.worker.ts`
- `apps/api/src/planning/http/planning-jobs.store.ts`
- `apps/api/src/planning/http/planning-http.module.ts`
- `apps/api/src/main.ts`
- `apps/api/src/cli.ts`
- `apps/api/package.json`
- `docs/`

## Uygulama adımları
1. Mevcut worker startup yeri, Nest module DI, health/ready, DB pool, admission lease, 500 ms tick, SKIP LOCKED ve cancel davranışını incele.
2. Default mevcut tek süreç davranışını koruyan, env üzerinden `api_only`, `worker_only` veya legacy combined çalıştırma yapısı ekle; env yoksa eskisi gibi çalışmalı.
3. Worker ayrı proses/container rolünde çalışabilmeli; API iş submit/status/result sunmaya devam eder, sürekli CPU hesaplama API event loopundan ayrılır.
4. Minimum istasyon/urgent replan önceliğini mevcut FIFO sınırlı kuyrukta adil uygulayabilmek için önce belge ve load fixture oluştur; priority migration gerekiyorsa ayrı küçük additive tasarım ve starvation testleri.
5. API/worker restart, lease expiry/reclaim, generation fencing, lost heartbeat, graceful shutdown, queue capacity=128, idempotency, retry-after testlerini koş.
6. Kapasite/rate limit her instance için değil global DB politikasıyla korunmalı. Büyük full planlar acil replans’i bloke etmemeli; CPU/DB pool ölçerek concurrency sınırlamasını ayarla.
7. Yeni altyapı bağımlılığı, secrets taşınması, cloud dağıtımı ve canlı public provider yük testi bu işin dışında.

## Kabul kriterleri
- Feature kapalı default combined eski davranışı sürdürür.
- Ayrı worker aktifken API /ready ve job status akışı sağlıklı; CPU event loop gecikmesi ölçülmüş.
- İki worker claim yarışında duplicate completion yok; late worker fencing geçiyor.
- Queue overload ve shutdown açık kodlarla yönetiliyor; DB migration varsa geri dönüş planı var.

## Beklenen teslim

docs/validation/worker-isolation.md, deployment/runbook ve local perf.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-013

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Planning worker izolasyonu ve kapasite kontrolü. Hedef: Mevcut PostgreSQL kuyruğunu koruyup worker çalıştırma rolünü API prosesinden opsiyonel ayır; Redis/RabbitMQ ekleme.
Bağımlılıklar: 01, 11. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `apps/api/src/planning/http/planning-jobs.worker.ts`
- `apps/api/src/planning/http/planning-jobs.store.ts`
- `apps/api/src/planning/http/planning-http.module.ts`
- `apps/api/src/main.ts`
- `apps/api/src/cli.ts`
- `apps/api/package.json`
- `docs/`

## Sırayla uygulama
1. Mevcut worker startup yeri, Nest module DI, health/ready, DB pool, admission lease, 500 ms tick, SKIP LOCKED ve cancel davranışını incele.
2. Default mevcut tek süreç davranışını koruyan, env üzerinden `api_only`, `worker_only` veya legacy combined çalıştırma yapısı ekle; env yoksa eskisi gibi çalışmalı.
3. Worker ayrı proses/container rolünde çalışabilmeli; API iş submit/status/result sunmaya devam eder, sürekli CPU hesaplama API event loopundan ayrılır.
4. Minimum istasyon/urgent replan önceliğini mevcut FIFO sınırlı kuyrukta adil uygulayabilmek için önce belge ve load fixture oluştur; priority migration gerekiyorsa ayrı küçük additive tasarım ve starvation testleri.
5. API/worker restart, lease expiry/reclaim, generation fencing, lost heartbeat, graceful shutdown, queue capacity=128, idempotency, retry-after testlerini koş.
6. Kapasite/rate limit her instance için değil global DB politikasıyla korunmalı. Büyük full planlar acil replans’i bloke etmemeli; CPU/DB pool ölçerek concurrency sınırlamasını ayarla.
7. Yeni altyapı bağımlılığı, secrets taşınması, cloud dağıtımı ve canlı public provider yük testi bu işin dışında.

## Kabul ve test kapısı
- Feature kapalı default combined eski davranışı sürdürür.
- Ayrı worker aktifken API /ready ve job status akışı sağlıklı; CPU event loop gecikmesi ölçülmüş.
- İki worker claim yarışında duplicate completion yok; late worker fencing geçiyor.
- Queue overload ve shutdown açık kodlarla yönetiliyor; DB migration varsa geri dönüş planı var.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/worker-isolation.md, deployment/runbook ve local perf.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```

---

# CR-PERF-014 — Uçtan uca regresyon, yük kanıtı ve rollout kapıları

**Faz:** D · Doğrulama  
**Öncelik:** P0  
**Risk:** Orta  
**Bağımlılıklar:** 01–13 (geçerli olanlar)  
**Durum:** TODO

## Amaç

Tüm değişikliklerin güvenlik ve verimlilik kazancını aynı fixture/cihaz/servis sınırlarında kanıtla; yeni mimari ekleme.

## Değişiklik kapsamı / önce incelenecek alanlar
- `docs/validation/`
- `apps/api/scripts/`
- `apps/mobile/tests/`
- `docs/V1_RELEASE_BACKLOG.md`
- `docs/TASKS.md`

## Uygulama adımları
1. CR-PERF-001 baseline ile aynı fixture/input checksum ve yazılım sürümlerini tekrar çalıştır; cold/warm/no-provider/replan ayrımı.
2. İlk plan, şarjsız, çok duraklı, SOC %60/%75/%90, off-route repair, kötü GPS, bozuk/süresi dolmuş availability, DEM missing/modelled, hız sınırı çelişkisi, 72s dışı hava, provider quota/retryAfter, iptal, eski revision ve false optimallik senaryoları.
3. Performans raporu: stage p50/p95/p99, cold/warm user-perceived wait, upstream calls, PG cache hit, CPU/RSS/event-loop lag, wire/decoded bytes, queue wait, mobile navigation render/CPU. Örnek sayısı ve ortam belirtilsin.
4. Gerçek sağlayıcıda yalnız izinli küçük smoke; public demo üstünde yük testi veya rate-limit bypass yok. Lokal Valhalla/DEM verisi lisans/graph sürüm incelemesi tamamlanmadıysa bunu açık bırak.
5. Gerçek telefon kabulünden geçen/ geçmeyen adımları ayır; export/CI, fiziksel cihaz GPS davranışı kanıtı değildir.
6. Golden validation, API + DB, shared, mobile, typecheck, build; skip varsa PASS yazma. Karşılaştırma tablosunda davranış farkını açık yaz.
7. Ölçüm sonuçları kötü veya emniyet testleri fail ise flags kapalı kalacak; release kararı için açık NO-GO listesi üret.

## Kabul kriterleri
- 0 kritik emniyet regresyonu: yanlış optimistic SOC, doğrulanmamış istasyon/road erişimi, stale plan overwrite, source attribution silinmesi.
- Tüm önceki API sözleşmeleri geçerli; yeni özellikler flag ile açılıp kapanabiliyor.
- Metrikler ölçüm sayısı ve test ortamıyla birlikte raporlanmış; tek örnekten p95 iddiası yok.
- No-Go açıkları ve rollback adımları dokümante; gerçek saha kabulü iddia edilmiyor.

## Beklenen teslim

docs/validation/performance-release-gates.md, PASS/FAIL/NOT_RUN tablosu ve rollout kararı.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-014

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Uçtan uca regresyon, yük kanıtı ve rollout kapıları. Hedef: Tüm değişikliklerin güvenlik ve verimlilik kazancını aynı fixture/cihaz/servis sınırlarında kanıtla; yeni mimari ekleme.
Bağımlılıklar: 01–13 (geçerli olanlar). Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

## Güvenlik ve kapsam sözleşmesi (her Codex çalışması için zorunlu)

- Kod yazmadan önce `git status --short`, `git rev-parse HEAD`, değiştirilecek dosyaların güncel içeriği, ilgili testler, `docs/TASKS.md`, `docs/V1_RELEASE_BACKLOG.md` ve ilgili ADR'leri incele. Bu görev seti gözlemlenen GitHub `main` commit'i `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` üzerinden hazırlanmıştır; çalışma ağacının farklı olması halinde mevcut gerçekliği esas al ve önemli farkları raporla.
- **Reset, clean, stash, force checkout, geçmiş commit'e dönme, başka görevlerin değişikliklerini silme veya büyük çaplı yeniden biçimlendirme yok.** Çalışma ağacındaki tracked/untracked değişiklikler kullanıcıya aittir. Çakışan dosyada mevcut değişiklikleri koru; güvenli şekilde ilerleyemiyorsan sadece o bölümü bloke et ve kanıtla.
- Mevcut NestJS modüler monolit + React Native/Expo + pnpm/Turbo + PostgreSQL/PostGIS yapısı korunur. Yeni mikroservis, Kafka, RabbitMQ, Redis, H3, harita sağlayıcısı, ORM, API gateway, harita renderer, büyük kütüphane veya geniş refactor ekleme. Yeni dependency gerekiyorsa önce var olan çözümün neden yetersiz olduğunu kanıtla; bu görevde mümkünse ekleme.
- Mevcut public DTO, Zod validation, `/v1/plans`, `/v1/planning-jobs`, araç/istasyon/yol/hava sağlayıcı sözleşmeleri, DB migration kimlikleri ve mobil eski akışlar **geriye uyumlu** kalmalı. Önceden yayınlanmış SQL migration dosyalarını değiştirme; yeni şema gerekiyorsa ayrı additive migration + geri dönüş planı.
- Enerji/şarj motorlarının fiziksel doğrulamalarını, kaynak/lisans/kalite etiketlerini, `measured`/`user_input`/`estimated`, `verified`/`modelled`/`unknown`, rezerv ve hedef varış SOC, `optimality:not_proven`, provider quota/retry-after, iptal ve iş sahipliğini gevşetme. `unknown` asla otomatik `available` veya `verified` olmasın. Planlanmış şarj SOC artışı kullanıcı doğrulaması olmadan ölçülmüş kabul edilmez.
- Valhalla/DEM/Geoapify ve hava provider'larına ilişkin mevcut üretim güvenlik sınırları, provider licence, shared PostgreSQL cache/lease/fencing ve public demo servislerine yük testi yasağı korunur. Yerel 8002/8003/8004 Docker runtime'larını bozma; `down -v`, dataset silme veya kaynak indirme yapma.
- Konum, raw GPS, IP, SOC, kullanıcı kimliği, secrets, token, rota polylinesi ve şarj geçmişini loglara/commitlere koyma. Loglarda yalnız requestId, aggregate sayaçlar, süre, hata kodları, model/sürüm değerleri.
- **Önce test, sonra en küçük değişiklik, sonra tekrar test**. Yeni fonksiyon için fail case + sınır testleri; mevcut reference solver/golden fixtures'ı değiştirerek yapay PASS elde etme. Test atlanırsa sonuç `NOT_RUN/SKIPPED`, asla `PASS` değil.
- Başlangıç raporu → uygulama diff'i → doğrulama kanıtı → açıklar ve geri dönüş adımlarını tek görev içinde sun. Bir sonraki görevin koduna geçme; bağımsız mevcut işi veya dokümanı overwrite etme.

## Öncelikle gözden geçirilecek dosyalar
- `docs/validation/`
- `apps/api/scripts/`
- `apps/mobile/tests/`
- `docs/V1_RELEASE_BACKLOG.md`
- `docs/TASKS.md`

## Sırayla uygulama
1. CR-PERF-001 baseline ile aynı fixture/input checksum ve yazılım sürümlerini tekrar çalıştır; cold/warm/no-provider/replan ayrımı.
2. İlk plan, şarjsız, çok duraklı, SOC %60/%75/%90, off-route repair, kötü GPS, bozuk/süresi dolmuş availability, DEM missing/modelled, hız sınırı çelişkisi, 72s dışı hava, provider quota/retryAfter, iptal, eski revision ve false optimallik senaryoları.
3. Performans raporu: stage p50/p95/p99, cold/warm user-perceived wait, upstream calls, PG cache hit, CPU/RSS/event-loop lag, wire/decoded bytes, queue wait, mobile navigation render/CPU. Örnek sayısı ve ortam belirtilsin.
4. Gerçek sağlayıcıda yalnız izinli küçük smoke; public demo üstünde yük testi veya rate-limit bypass yok. Lokal Valhalla/DEM verisi lisans/graph sürüm incelemesi tamamlanmadıysa bunu açık bırak.
5. Gerçek telefon kabulünden geçen/ geçmeyen adımları ayır; export/CI, fiziksel cihaz GPS davranışı kanıtı değildir.
6. Golden validation, API + DB, shared, mobile, typecheck, build; skip varsa PASS yazma. Karşılaştırma tablosunda davranış farkını açık yaz.
7. Ölçüm sonuçları kötü veya emniyet testleri fail ise flags kapalı kalacak; release kararı için açık NO-GO listesi üret.

## Kabul ve test kapısı
- 0 kritik emniyet regresyonu: yanlış optimistic SOC, doğrulanmamış istasyon/road erişimi, stale plan overwrite, source attribution silinmesi.
- Tüm önceki API sözleşmeleri geçerli; yeni özellikler flag ile açılıp kapanabiliyor.
- Metrikler ölçüm sayısı ve test ortamıyla birlikte raporlanmış; tek örnekten p95 iddiası yok.
- No-Go açıkları ve rollback adımları dokümante; gerçek saha kabulü iddia edilmiyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/performance-release-gates.md, PASS/FAIL/NOT_RUN tablosu ve rollout kararı.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```
