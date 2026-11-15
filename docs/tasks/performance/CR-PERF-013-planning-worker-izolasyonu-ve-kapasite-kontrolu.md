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
