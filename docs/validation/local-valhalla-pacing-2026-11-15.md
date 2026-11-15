# Yerel Valhalla pacing düzeltmesi — 2026-11-15

Kullanıcı kararı: yerel Valhalla çağrılarında dış sağlayıcıya ait yapay istek aralığı uygulanmayacak. Bu değişiklik CR-PERF-006 uygulaması değildir; gerçek cihaz testinde saptanan provider politikası hatasının dar kapsamlı düzeltmesidir.

## Bulgular

`b3b85636-f234-4f49-8d1d-1f658c95d812` için job metrics: kuyruk 218 ms, road-leg acquisition 71201 ms, 61 road HTTP çağrısı toplam 1056 ms, weather acquisition 20095 ms, energy evaluation 740 ms, charging integration 28 ms. Bu aşamalar iç içedir; toplamları uçtan uca süre değildir. İş DB'de cancelled kaydedildi; worker kaydı 95185 ms'de iptal ile kapandı. İptal edilen/incomplete kayıtta expanded state gibi kapanış sayaçlarının 0 olması hiç arama yapılmadığı anlamına gelmez. Bu gözlem başarılı plan veya tam gecikme benchmark'ı değildir.

1100 ms varsayılanı ve bekleme 11 Kasım `e2f05d8` commit'inde mevcuttu. 13 Kasım `c24cab2` self-hosted kota ayrımı yaparken pacing ortak kalmıştı. 001–005 performans çalışmaları bu beklemeyi eklemedi; mevcut metrikler sorunu görünür kıldı.

## Değişiklik

- `road-source-policy.ts`: eşleşen routing provider ID + base URL origin + self_hosted deployment için etkin aralık 0; dış sağlayıcı/farklı origin/farklı provider için mevcut config aralığı.
- `road-client.ts`: provider budget gate artık etkin politika aralığını kullanır. Yerel çağrı eski ileri tarihli next_allowed_at değerinden beklemez. SQL gate yine blocked_until ve atomik isteğe bağlı günlük güvenlik kotasını uygular. Kota veya cache tablosunu temizleme yok.
- Aynı anahtarlı cache coalescing/lease beklemesi ve gerçek provider hata backoff'u korunur; bunlar normal sağlıklı yerel çağrıların 1100 ms pacing'iyle karıştırılmamalıdır. HTTP timeout/abort, cache TTL/version/fencing, engine/optimizer/search/DTO davranışı değişmedi. Yeni route paralelliği/worker veya sınırsız cache eklenmedi.
- Overpass ve dış routing için mevcut en az 1100 ms koruma aynı kaldı. Self-hosted doğruluğu deployment yapılandırmasının sözleşmesidir; farklı provider/origin bu muafiyeti devralmaz.

## Kanıt

İlgili iki test dosyasında 16 test PASS. Üç yeni DB testi: önceki ileri next_allowed_at ile farklı istemcilerden altı eşzamanlı yerel edinim ve cache hit muhasebesi; dört eşzamanlı edinimde atomik günlük limit 2; yerel 503 backoff ve caller abort korunumu. Mevcut testler dış pacing/quota, paylaşılmış cache, revision ve fencing'i de kapsar. Policy testi farklı origin, provider, external deployment ve Overpass'ın 1100 ms kullanmaya devam ettiğini doğrular.

[Sınırlı smoke JSON](local-valhalla-pacing-smoke-2026-11-15.json): aynı altı sıralı cold-cache çağrı; eski `f5d16c8` road-client kaynağı yalnız bellekte derlenerek güncel kodla karşılaştırıldı. Mevcut pg policy yardımcısı iki koşulda aynıydı; eski client aralığı config'den aldığı için eski 1100 ms davranışını korudu. Gerçek PostgreSQL'de yalnız bu deneyin random `road_pacing_smoke_<16hex>` şeması oluşturulup silindi. Taşıma tamamen sentetik, gerçek provider HTTP sayısı 0; kullanıcı konumu/SOC/rota veya token yazılmadı. Production cache değiştirilmedi.

| Koşul | Çağrı | Süre | Normalize çıktı SHA-256 |
|---|---:|---:|---|
| Önce | 6 | 5824,92 ms | 18d98b8577a57f3a6ec6a4e1902176313ef60581670a158ac8e9f5486d13b3a7 |
| Sonra | 6 | 37,41 ms | Aynı |

Tek sıralı smoke; warmup/ABBA/p95/p99 veya tam plan hızlanma iddiası değildir. JIT/GC/DB yükü kontrol edilmedi. Hava edinimi, cold-cache road HTTP ve bounded optimizer araması gerçek plan süresinde hâlâ yer alır. Eski cancelled iş yeniden çalıştırılmadı ve sonuç üretilmiş gibi gösterilmedi.

Tam regresyon ve canlı servis kontrolü aşağıdaki kapanış notunda kayıtlıdır. Önceki performans artefaktlarına dokunulmadı. Git commit/push bu düzeltme için henüz yapılmadı.

## Kapanış

- `pnpm --filter @chargeroad/api test:db`: **1124/1124 PASS**, 67 suite (180,747 s); eski 001–005 eşdeğerlik testleri dahil.
- `pnpm -r typecheck`: **PASS** (API, shared, mobile).
- `pnpm --filter @chargeroad/api build`: **PASS**.
- `git diff --check`: **PASS**. Test günlükleri ignored `artifacts/local-valhalla-pacing-*.log` altında.
- Aktif plan sayısı 0 iken backend yeni dist ile yeniden başlatıldı; mevcut opt-in plan metrikleri süreç ortamında açık tutuldu. Kullanıcı .env dosyası, Docker veya veri/kota tabloları değiştirilmedi.
- Derlenmiş gerçek .env yapılandırmasında `self_hosted` route aralığı **0 ms**, Overpass aralığı **1100 ms** doğrulandı. Backend readiness/DB, Valhalla status ve Expo 8082 status **HTTP 200**.
- Yeni ayarla aynı kullanıcı rotası için henüz uçtan uca gecikme/başarılı plan kabulü yok; sonraki cihaz denemesi ayrı request ID/metriklerle değerlendirilecek. Tam planın anında veya kesin başarılı döneceği iddia edilmez.
