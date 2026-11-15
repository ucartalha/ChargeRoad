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
