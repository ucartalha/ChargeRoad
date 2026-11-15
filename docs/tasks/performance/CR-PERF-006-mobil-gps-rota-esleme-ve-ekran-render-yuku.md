# CR-PERF-006 — Mobil GPS/rota eşleme ve ekran render yükü

**Faz:** B · Mobil performansı  
**Öncelik:** P0  
**Risk:** Orta  
**Bağımlılıklar:** 01  
**Durum:** TODO

## Amaç

GPS geldiğinde tüm geometri uzunluklarını ve kalan süreyi her seferinde hesaplama; yeni sunucu bağımlılığı olmadan mobil CPU ve render yükünü azalt.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/mobile/src/features/navigation/navigation-core.ts`
- `apps/mobile/src/features/navigation/NavigationPanel.tsx`
- `apps/mobile/src/features/map/MapCanvas.tsx`
- `apps/mobile/tests/navigation.test.cjs`

## Uygulama adımları
1. NavigationRoute geometry/segment/maneuver listesi, route revision, locateOnRoute ve navigationProgress ile eski algoritmanın sonuçlarını fixturelarda sabitle.
2. Rota yüklenirken bir kez prefix distance/time, segment bbox ve gerekirse küçük spatial-window index hesapla; yeni revision geldiğinde index invalidation yap.
3. İlk fix/konum sıçraması veya paralel otoyol durumlarında yalnız yakın index sonucunu zorlamadan güvenli geniş arama fallback’i bırak; mevcut ilerleme sürekliliğini koru.
4. GPS 2 sn / 10 m ayarını ve 15 sn stale/50 m accuracy filtrelerini koru. UI için gerekli progress state ile büyük immutable route snapshot’ı ayır; mevcut AppState pause/resume ve SOC anchor davranışı aynı.
5. 200, 1000, 5000, 15000 segmentli sentetik testler, loopback/yol kavşağı, geri dönüş, stop boundary, düşük doğruluk, art arda aynı GPS ve plan revision değişimi testleri yaz.
6. RN/Expo paketleri, harita renderer ve API sözleşmesini değiştirme; harita provider değişimi bu taskta yapılmaz.

## Kabul kriterleri
- Eski ve yeni algoritma route progress/SOC/manevra çıktıları tolerans içinde eşdeğer.
- GPS update p50/p95/p99 ve render/progress update sayısı ölçülmüş.
- Plan revision değişince stale indeks kullanılmıyor.
- Expo typecheck/export ve mobil testleri geçiyor; fiziksel telefon kabulü ayrıca açık.

## Beklenen teslim

docs/validation/mobile-navigation-cpu.md ve test/benchmark.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-006

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Mobil GPS/rota eşleme ve ekran render yükü. Hedef: GPS geldiğinde tüm geometri uzunluklarını ve kalan süreyi her seferinde hesaplama; yeni sunucu bağımlılığı olmadan mobil CPU ve render yükünü azalt.
Bağımlılıklar: 01. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

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
- `apps/mobile/src/features/map/MapCanvas.tsx`
- `apps/mobile/tests/navigation.test.cjs`

## Sırayla uygulama
1. NavigationRoute geometry/segment/maneuver listesi, route revision, locateOnRoute ve navigationProgress ile eski algoritmanın sonuçlarını fixturelarda sabitle.
2. Rota yüklenirken bir kez prefix distance/time, segment bbox ve gerekirse küçük spatial-window index hesapla; yeni revision geldiğinde index invalidation yap.
3. İlk fix/konum sıçraması veya paralel otoyol durumlarında yalnız yakın index sonucunu zorlamadan güvenli geniş arama fallback’i bırak; mevcut ilerleme sürekliliğini koru.
4. GPS 2 sn / 10 m ayarını ve 15 sn stale/50 m accuracy filtrelerini koru. UI için gerekli progress state ile büyük immutable route snapshot’ı ayır; mevcut AppState pause/resume ve SOC anchor davranışı aynı.
5. 200, 1000, 5000, 15000 segmentli sentetik testler, loopback/yol kavşağı, geri dönüş, stop boundary, düşük doğruluk, art arda aynı GPS ve plan revision değişimi testleri yaz.
6. RN/Expo paketleri, harita renderer ve API sözleşmesini değiştirme; harita provider değişimi bu taskta yapılmaz.

## Kabul ve test kapısı
- Eski ve yeni algoritma route progress/SOC/manevra çıktıları tolerans içinde eşdeğer.
- GPS update p50/p95/p99 ve render/progress update sayısı ölçülmüş.
- Plan revision değişince stale indeks kullanılmıyor.
- Expo typecheck/export ve mobil testleri geçiyor; fiziksel telefon kabulü ayrıca açık.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/mobile-navigation-cpu.md ve test/benchmark.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```
