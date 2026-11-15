# CR-PERF-007 — Geri uyumlu kompakt mobil plan yanıtı

**Faz:** B · Veri transferi  
**Öncelik:** P1  
**Risk:** Orta  
**Bağımlılıklar:** 01, 06  
**Durum:** TODO

## Amaç

Büyük full planning kanıtını varsayılan APIyi bozmadan mobilde gereken küçültülmüş navigasyon görünümünden ayır.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/http/planning-jobs.controller.ts`
- `apps/api/src/planning/http/planning-response.ts`
- `apps/api/src/planning/plan-compiler.ts`
- `packages/shared/src/contracts/`
- `apps/mobile/src/api/planning.ts`
- `apps/mobile/src/features/navigation/navigation-core.ts`

## Uygulama adımları
1. Mevcut GET /v1/planning-jobs/:id/result ve POST /v1/plans yanıtlarını, JSON gzip limitlerini ve full plan doğrulama şemasını aynen koru.
2. Sadece mevcut plan sonucundan sunucu tarafında üretilen versioned, strict Zod validated `navigation-view` projection tasarla; optimizasyona ve enerji hesabına müdahale etme.
3. Yeni opt-in endpoint veya Accept-versioned representation tercih et; eskisini kaldırma. Mevcut job capability Bearer kontrolünü aynen kullan; CORS/log/secrets standardına uy.
4. UI için gerekli geometry, maneuvers, stops, ETA/SOC, estimated/observed ayrımı, data-quality, warnings, source license/attributions alanlarını kayıpsız tut. Ayrıntılı trace/forecast/snapshot kanıtı full response’da kalmalı.
5. React Native tarafında opt-in ve full response fallback’i flag altında aç; harita ve navigasyon akışı davranışı değişmemeli.
6. Kısa/uzun rota için wire bytes, decoded bytes, parse ms, ilk çizim gecikmesi karşılaştır; 100 kB gibi sahte kesin limit koyma.

## Kabul kriterleri
- Eski GET /result full payload, 2 MiB/16 MiB korumaları ve public contracts kırılmıyor.
- Yeni projection ile mobilde çizgi, manevra, SOC, durak ve atıf aynı.
- Eski backend veya opt-in kapalıyken mobil eski path üzerinden çalışıyor.
- Güvenlik ve gzip/encoding/abort/timeout testleri geçiyor.

## Beklenen teslim

docs/validation/mobile-response-projection.md, payload boyut kıyası.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-007

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Geri uyumlu kompakt mobil plan yanıtı. Hedef: Büyük full planning kanıtını varsayılan APIyi bozmadan mobilde gereken küçültülmüş navigasyon görünümünden ayır.
Bağımlılıklar: 01, 06. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

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
- `apps/api/src/planning/http/planning-jobs.controller.ts`
- `apps/api/src/planning/http/planning-response.ts`
- `apps/api/src/planning/plan-compiler.ts`
- `packages/shared/src/contracts/`
- `apps/mobile/src/api/planning.ts`
- `apps/mobile/src/features/navigation/navigation-core.ts`

## Sırayla uygulama
1. Mevcut GET /v1/planning-jobs/:id/result ve POST /v1/plans yanıtlarını, JSON gzip limitlerini ve full plan doğrulama şemasını aynen koru.
2. Sadece mevcut plan sonucundan sunucu tarafında üretilen versioned, strict Zod validated `navigation-view` projection tasarla; optimizasyona ve enerji hesabına müdahale etme.
3. Yeni opt-in endpoint veya Accept-versioned representation tercih et; eskisini kaldırma. Mevcut job capability Bearer kontrolünü aynen kullan; CORS/log/secrets standardına uy.
4. UI için gerekli geometry, maneuvers, stops, ETA/SOC, estimated/observed ayrımı, data-quality, warnings, source license/attributions alanlarını kayıpsız tut. Ayrıntılı trace/forecast/snapshot kanıtı full response’da kalmalı.
5. React Native tarafında opt-in ve full response fallback’i flag altında aç; harita ve navigasyon akışı davranışı değişmemeli.
6. Kısa/uzun rota için wire bytes, decoded bytes, parse ms, ilk çizim gecikmesi karşılaştır; 100 kB gibi sahte kesin limit koyma.

## Kabul ve test kapısı
- Eski GET /result full payload, 2 MiB/16 MiB korumaları ve public contracts kırılmıyor.
- Yeni projection ile mobilde çizgi, manevra, SOC, durak ve atıf aynı.
- Eski backend veya opt-in kapalıyken mobil eski path üzerinden çalışıyor.
- Güvenlik ve gzip/encoding/abort/timeout testleri geçiyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
docs/validation/mobile-response-projection.md, payload boyut kıyası.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```
