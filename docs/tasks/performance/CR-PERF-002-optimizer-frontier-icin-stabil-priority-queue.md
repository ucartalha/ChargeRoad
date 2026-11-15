# CR-PERF-002 — Optimizer frontier için stabil priority queue

**Faz:** A · Güvenli hızlandırma  
**Öncelik:** P0  
**Risk:** Düşük–orta  
**Bağımlılıklar:** 01  
**Durum:** DONE (2026-11-13, teknik kapsam; üretim/saha kabulü değil)

**Teslim:** [Frontier eşdeğerliği ve benchmark raporu](../../validation/frontier-queue-benchmark.md).
API/DB 689, shared 41, mobile 21 test PASS; typecheck ve API build PASS.
30 üretim senaryosu ve 15 referans korunur. Büyük frontier ölçümü daha hızlı; küçük tam plan sonuçları karışık/yavaş ölçümler içerir, genel hızlanma iddiası yoktur.
Görev 3 önkoşulu için GO; sonraki görev uygulanmadı. Aşağıdaki özgün kapsam korunmuştur.

## Amaç

Her iterasyondaki frontier.sort+shift yerine sıralama semantiğini koruyan bounded binary heap kullan.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/charge-stop-optimizer.ts`
- `apps/api/src/planning/__tests__/optimizer.spec.ts`
- `apps/api/src/planning/validation/`

## Uygulama adımları
1. compareStates fonksiyonunun üç objective için eşitlik/tie-break davranışını incele, mevcut golden fixtures çıktısını sakla.
2. Yalnız frontier veri yapısını küçük ve tip güvenli bir priority queue ile değiştir; O(log n) push/pop, maxFrontier semantiği değişmesin.
3. Tam eşitlikte eski stabil Array.sort davranışına karşı monoton insertion sequence tie-break ekle; karşılaştırma sonucu, visited ve stop sırası değişmemeli.
4. AbortSignal, state/transition bütçeleri, yieldLoop, incumbent, stopReason, computed metadata, reason kodlarını aynen koru.
5. Ayrı yeni npm dependency ekleme; yerel küçük veri yapısı ve doğrudan unit testi tercih et.
6. 15 bağımsız referans fixture + random seeded frontier yükleriyle semantik eşdeğerliği ölç; before/after CPU, heap ve sonuç checksum raporla.

## Kabul kriterleri
- Üç objective ve tie-break altında aynı kazanan plan ve sıralama.
- Bütçe aşımlarındaki hata türleri/metadata değişmiyor.
- p95/p99 ve CPU karşılaştırması, hızlı/aynı/yavaş sonuçlar açık.
- Golden/optimizer testleri geçiyor; davranış farkı varsa kodu default yapma.

## Beklenen teslim

docs/validation/frontier-queue-benchmark.md ve küçük kapsamlı optimizer diff.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-002

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Optimizer frontier için stabil priority queue. Hedef: Her iterasyondaki frontier.sort+shift yerine sıralama semantiğini koruyan bounded binary heap kullan.
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
- `apps/api/src/planning/charge-stop-optimizer.ts`
- `apps/api/src/planning/__tests__/optimizer.spec.ts`
- `apps/api/src/planning/validation/`

## Sırayla uygulama
1. compareStates fonksiyonunun üç objective için eşitlik/tie-break davranışını incele, mevcut golden fixtures çıktısını sakla.
2. Yalnız frontier veri yapısını küçük ve tip güvenli bir priority queue ile değiştir; O(log n) push/pop, maxFrontier semantiği değişmesin.
3. Tam eşitlikte eski stabil Array.sort davranışına karşı monoton insertion sequence tie-break ekle; karşılaştırma sonucu, visited ve stop sırası değişmemeli.
4. AbortSignal, state/transition bütçeleri, yieldLoop, incumbent, stopReason, computed metadata, reason kodlarını aynen koru.
5. Ayrı yeni npm dependency ekleme; yerel küçük veri yapısı ve doğrudan unit testi tercih et.
6. 15 bağımsız referans fixture + random seeded frontier yükleriyle semantik eşdeğerliği ölç; before/after CPU, heap ve sonuç checksum raporla.

## Kabul ve test kapısı
- Üç objective ve tie-break altında aynı kazanan plan ve sıralama.
- Bütçe aşımlarındaki hata türleri/metadata değişmiyor.
- p95/p99 ve CPU karşılaştırması, hızlı/aynı/yavaş sonuçlar açık.
- Golden/optimizer testleri geçiyor; davranış farkı varsa kodu default yapma.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/frontier-queue-benchmark.md ve küçük kapsamlı optimizer diff.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```
