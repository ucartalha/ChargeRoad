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
