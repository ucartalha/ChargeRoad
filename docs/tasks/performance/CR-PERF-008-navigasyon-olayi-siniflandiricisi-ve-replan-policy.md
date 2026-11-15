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
