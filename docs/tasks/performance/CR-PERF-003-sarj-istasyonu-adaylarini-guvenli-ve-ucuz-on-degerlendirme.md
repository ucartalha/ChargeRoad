# CR-PERF-003 — Şarj istasyonu adaylarını güvenli ve ucuz ön değerlendirme

**Faz:** A · Güvenli hızlandırma  
**Öncelik:** P0  
**Risk:** Orta  
**Bağımlılıklar:** 01, 02  
**Durum:** DONE — yalnız shadow/analiz (2026-11-15)

15 Kasım kullanıcı ek talimatı esas alındı: production frontier stabil array, aday sınıflandırması gözlem amaçlı; aktif filtreleme NO-GO ve uygulanmadı. DB kabulü bağlantı nedeniyle açık; 004/005 başlamadı. [Güncel teknik rapor](../../validation/candidate-eligibility-shadow-2026-11-15.md). Aşağıdaki özgün görev kapsamı tarihsel olarak korunur.

## Amaç

Pahalı provider çağrısı öncesi yalnız kanıtlanabilir biçimde uygun olmayan adayları ayır ve rota koridorunda çeşitliliği koru.

## Değişiklik kapsamı / önce incelenecek alanlar
- `apps/api/src/planning/catalogue-station-scenario.ts`
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/stations/db-station.provider.ts`
- `apps/api/src/planning/__tests__/`

## Uygulama adımları
1. Mevcut PostGIS corridor sonuçları, katalog senaryosu, EVSE/connector ID, erişim ve kaynak kalitesi davranışlarını incele.
2. Ucuz eligibility kontrollerini açık gerekçe kodlarıyla uygula: kesin uyumsuz DC standardı, kesin kapalı/erişilemez, yanlış lifecycle, geçersiz/tekrarlı ID, kesin yasaklı bağlantı. Unknown ve fiziksel EVSE eksikliğini doğrulanmış ret gibi kullanma.
3. Geliştirme sırasında aynı rota üzerinde daha zayıf görünen fakat daha iyi yol sapması, şarj süresi veya rezerv sağlayabilecek adayları rastgele atma.
4. Mevcut 2/5/10 km koridor genişletmesi, maxStations, coverage.completeForQuery, truncated, data-quality ve catalogue_power_scenario semantiğini koru.
5. İlk sürümde sonucu değiştirmeyen pre-check/ordering tercih et; aday sayısını azaltmak zorunluysa güvenli kanıt ve feature flag koy.
6. Fixture senaryolarına alternatif erişim, iki yönlü yol, farklı araç soketi, null availability, yüksek kW ama kötü detour ve rezerv sınırı ekle.

## Kabul kriterleri
- Mevcut geçerli plan hiçbir fixtureda kaybolmuyor.
- Eksik/veri belirsizliği yanlışlıkla infeasible olarak sunulmuyor.
- İstasyon seçimi ve plan bütçe kullanımından önce/sonra kıyaslanıyor.
- Sözleşme ve veri kalitesi etiketleri korunuyor.

## Beklenen teslim

Candidate seçim gerekçe matrisi ve geriye uyumluluk testleri.

## Codex'e doğrudan yapıştırılacak prompt

```text
# Codex uygulama promptu — CR-PERF-003

Repo: ucartalha/ChargeRoad (Windows/PowerShell + pnpm monorepo). Bu mesaj TEK GÖREV talimatıdır.
Görev: Şarj istasyonu adaylarını güvenli ve ucuz ön değerlendirme. Hedef: Pahalı provider çağrısı öncesi yalnız kanıtlanabilir biçimde uygun olmayan adayları ayır ve rota koridorunda çeşitliliği koru.
Bağımlılıklar: 01, 02. Önce tamamlanmış görevlerin kanıtını kontrol et; eksikse yanlış tamamlandı deme.

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
- `apps/api/src/planning/catalogue-station-scenario.ts`
- `apps/api/src/planning/ev-planning.service.ts`
- `apps/api/src/stations/db-station.provider.ts`
- `apps/api/src/planning/__tests__/`

## Sırayla uygulama
1. Mevcut PostGIS corridor sonuçları, katalog senaryosu, EVSE/connector ID, erişim ve kaynak kalitesi davranışlarını incele.
2. Ucuz eligibility kontrollerini açık gerekçe kodlarıyla uygula: kesin uyumsuz DC standardı, kesin kapalı/erişilemez, yanlış lifecycle, geçersiz/tekrarlı ID, kesin yasaklı bağlantı. Unknown ve fiziksel EVSE eksikliğini doğrulanmış ret gibi kullanma.
3. Geliştirme sırasında aynı rota üzerinde daha zayıf görünen fakat daha iyi yol sapması, şarj süresi veya rezerv sağlayabilecek adayları rastgele atma.
4. Mevcut 2/5/10 km koridor genişletmesi, maxStations, coverage.completeForQuery, truncated, data-quality ve catalogue_power_scenario semantiğini koru.
5. İlk sürümde sonucu değiştirmeyen pre-check/ordering tercih et; aday sayısını azaltmak zorunluysa güvenli kanıt ve feature flag koy.
6. Fixture senaryolarına alternatif erişim, iki yönlü yol, farklı araç soketi, null availability, yüksek kW ama kötü detour ve rezerv sınırı ekle.

## Kabul ve test kapısı
- Mevcut geçerli plan hiçbir fixtureda kaybolmuyor.
- Eksik/veri belirsizliği yanlışlıkla infeasible olarak sunulmuyor.
- İstasyon seçimi ve plan bütçe kullanımından önce/sonra kıyaslanıyor.
- Sözleşme ve veri kalitesi etiketleri korunuyor.

Her görevde asgari olarak `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api build`, `pnpm --filter @chargeroad/shared typecheck`, `pnpm --filter @chargeroad/shared test`, `pnpm --filter @chargeroad/mobile typecheck`, `pnpm --filter @chargeroad/mobile test` çalıştır; değişiklik alanına göre API testlerini ve kullanılabilir TEST_DATABASE_URL ile `pnpm --filter @chargeroad/api test:db` de koş. DB bağımlılığı sağlanmıyorsa DB testlerini SKIPPED/NOT_RUN raporla. Kod değiştirilmediyse hangi testlerin anlamlı olduğunu gerekçelendir.

## Teslim çıktısı
Candidate seçim gerekçe matrisi ve geriye uyumluluk testleri.
Son raporda 1) başlangıç HEAD/diff, 2) değişen dosyalar, 3) davranış farkı, 4) test komutu + PASS/FAIL/SKIPPED ve neden, 5) performans / önce-sonra ölçümü, 6) güvenlik ve lisans kontrolleri, 7) bilinen açıklar, 8) geri dönüş/flag, 9) sonraki göreve geçiş için GO/NO-GO yaz. Yapmadığın testi geçmiş gibi gösterme; ölçülmemiş hız yüzdesi iddia etme. Yalnız bu görevi bitir, sıradaki göreve geçme.

```
