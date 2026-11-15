# CR-PERF-004 — Optimizer state dominance için konservatif budama

**Faz:** A · Güvenli hızlandırma  
**Öncelik:** P1  
**Risk:** Orta–yüksek  
**Bağımlılıklar:** 01, 02, 03  
**Durum:** DONE — yalnız shadow/analiz (2026-11-15)

15 Kasım kullanıcı talimatıyla aktif budama uygulanmadı (NO-GO); stabil array frontier korundu. 162 senaryo eşdeğer; gerçek budama/tasarruf 0. DB entegrasyon kabulü açık, 005 uygulanmadı. [Güncel teknik rapor](../../validation/state-dominance-shadow-2026-11-15.md). Aşağıdaki özgün görev kapsamı tarihsel olarak korunur.

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
