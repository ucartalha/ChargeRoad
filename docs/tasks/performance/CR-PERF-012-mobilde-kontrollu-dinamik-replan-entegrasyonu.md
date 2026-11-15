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
