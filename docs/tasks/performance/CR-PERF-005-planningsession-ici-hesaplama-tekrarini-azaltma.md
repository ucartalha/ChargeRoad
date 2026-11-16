# CR-PERF-005 — PlanningSession içi hesaplama tekrarını azaltma

**Faz:** A · Güvenli hızlandırma  
**Öncelik:** P0  
**Risk:** Orta  
**Bağımlılıklar:** 01, 03  
**Durum:** BLOCKED — Aşama A DONE / Aşama B offline proof DONE, aktif reuse NO-GO (2026-11-16)

Son kullanıcı ekindeki güvenlik kapıları bu eski promptu daraltır. [Teslim raporu](../../validation/session-repeat-analysis-2026-11-15.md): 69 sentetik vaka/amaç eşdeğer; son DB regresyonu 1121/1121 PASS. Aktif tekrar kullanımı uygulanmadı; sampler referans sahipliği, tam semantik key/deadline ve net CPU kazanımı kanıtlanmadan açılmayacak. Eski baseline ve 001–004 değişiklikleri korunur; 006 başlamadı.

Aşama B: [yeni kanıt raporu](../../validation/session-repeat-active-proof-2026-11-15.md). 207 normal A/B ve 69 native ankraj PASS; ek crafted-prototype eşdeğerlik kontrolü FAIL ve üç süreçte net performans kapısı NO-GO. Üretime cache eklenmedi; B3 NOT_RUN. Önceki Aşama A kanıtları korunur, CR-PERF-006 başlamadı.

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
