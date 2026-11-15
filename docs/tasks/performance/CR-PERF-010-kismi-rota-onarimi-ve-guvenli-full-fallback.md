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
