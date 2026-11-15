# CR-PERF-001 — Performans gözlemlenebilirliği ve tekrarlanabilir baseline

**Faz:** A · Ölçüm  
**Öncelik:** P0  
**Risk:** Düşük  
**Bağımlılıklar:** Yok  
**Durum:** DONE (2026-11-13, teknik kabul; üretim/saha kabulü değil)

**Teslim:** [Baseline, test kanıtı ve geri dönüş planı](../../validation/perf-baseline-2026-11-13.md).
API/DB 646, shared 41, mobile 21 test PASS; typecheck ve API build PASS. Ölçüm varsayılan kapalıdır.
CR-PERF-002 için GO; sonraki görev uygulanmadı. Aşağıdaki özgün görev kapsamı korunmuştur.

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
