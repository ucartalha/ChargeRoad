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
