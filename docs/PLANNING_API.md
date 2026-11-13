# Task 14 — Planlama HTTP API'si

Tarih: 2026-11-12. CR-014 teknik teslimi tamamlandı. `POST /v1/plans`, CR-013 deterministik planlayıcısını HTTP üzerinden sunar. Mobil bağlantı CR-015/016 kapsamındadır. Gerçek pilot enerji/şarj profili ve saha doğruluğu kapıları açık kalır.

## Erişim ve sözleşme

İlk uç hesap gerektirmeyen, durum saklamayan `stateless_guest` erişimidir. Yanıtta `historyStored:false` bulunur. Hesapsız plan yapma ürün kararı korunur; bu teslim misafir oturumu, seyahat geçmişi, garaj veya kişisel model kaydı oluşturmaz. Bunlar sahiplik/auth tasarımıyla CR-017/020'de bağlanmalıdır. İstemcinin `requestId` değeri korelasyon içindir; kimlik, yetki veya idempotency anahtarı değildir. Kaydedilmiş planı okuyan bir GET endpoint'i yoktur.

İstek `application/json` olmalıdır. Zorunlu alanlar:

- `schemaVersion:"1.0.0"`, UUID `requestId`, `origin`/`destination` koordinatları ve UUID veya eski katalog ID'si `vehicleVariantId`.
- Saat dilimli ISO `departureAt`, `startingChargePercent`, `startingChargeObservedAt`.
- `constraints.minimumReserveChargePercent` ve `constraints.targetArrivalChargePercent`: her istekte kullanıcıdan alınır; otomatik SOC varsayılanı yoktur. Hedef rezervden düşük olamaz.

`objective` varsayılanı `minimum_total_duration`; diğer seçenekler `minimum_charging_stops` ve `minimum_energy`. Her istek seçilen modu çalıştırır. `vehicleDataQuality` varsayılanı `verified_only`; mühendislik tahminleri için açık `allow_engineering_estimates` seçimi gerekir.

Batarya sıcaklığı, SOH, yük ve kabin sıcaklığı opsiyoneldir; eksikse `{origin:"unknown",value:null}` olur. Kullanıcı gözlemi `{origin:"user_input",value,observedAt}` biçimindedir. Eksik SOH %100 veya eksik sıcaklık sıcak batarya sayılmaz. `operatingConditions` klima/preconditioning/lastik bilgisini; `roadPreferences` ücretli yol ve feribot tercihlerini taşır. Ücretli yoldan kaçınma varsayılanı false, feribottan kaçınma true'dur.

İstemci dahili `policy`, optimizer bütçesi, model, sahiplik, trip veya replay paketi gönderemez. Bilinmeyen alanlar reddedilir. Sayılar sonlu, yüzdeler 0–100, koordinatlar geçerli olmalıdır. Gözlemler gelecekte olamaz; başlangıç SOC gözlemi hareketten sonra olamaz. İki nokta arasındaki doğrudan mesafe 1 m–2.000 km aralığındadır; bu gerçek yol mesafesi limiti değildir.

Makinece okunabilir sözleşmeler: [istek](api/planning-request.schema.json), [yanıt](api/planning-response.schema.json), [hata](api/planning-error.schema.json). Kaynak `packages/shared/src/contracts/planning-http.ts`; `planning:contracts` ile üretilir. Alanlar arası ve güncel zamana bağlı kontrollerde runtime Zod/controller doğrulaması esas alınır; JSON Schema bütün bu koşulları ifade etmez.

## Sonuçlar

| HTTP | Gövde durumu | Anlamı |
| --- | --- | --- |
| 200 | `planned` | Tüm sözleşme/kısıt kontrollerinden geçen plan |
| 200 | `insufficient_data` | Güvenilir hesap için gerekli veri yok |
| 200 | `infeasible` | Değerlendirilen kapsam içinde kısıtları karşılayan rota yok |
| 503 | `provider_error` / `computation_limit` | Kaynak hatası veya geçerli aday olmadan hesap sınırı |
| 400 / 413 / 415 | `error` | Geçersiz JSON/girdi, büyük istek veya medya türü |
| 429 | `error` | IP rate limit veya günlük engel |
| 503 | `error` | Kapasite, admission DB, yürütme süresi veya yanıt boyutu sınırı |
| 500 | `error` | Geçersiz backend sonucu veya beklenmeyen sunucu hatası |

Alan sonucu, hata envelope'undan ayrıdır. Hatalar `schemaVersion`, `requestId`, `status:"error"`, `error:{code,message,...}` taşır. Doğrulama hataları en fazla 20 alan yolu/kodu içerir; gönderilen değer, stack veya sağlayıcı hata metni döndürülmez. `X-Request-Id` ve `Cache-Control: no-store` kullanılır. Geçici 503 sonuçları ve rate limit yanıtlarında `Retry-After` bulunur.

`planned` sonuçta plan/revizyon, veri snapshot'ları ve kaynak yaşları korunur. `metadata` API/politika/algoritma sürümlerini ve çalıştırılan enerji/şarj model ID/sürümlerini taşır; model yoksa null'dır. Özel validation girdisi, profil paketi ve replay istemciye verilmez. Sonuç, çalıştırılan isteğe ve tam plan değerlendirmesine göre yeniden doğrulanır; yalnız şeklen doğru JSON olması yeterli değildir.

Arama bütçesi sonunda geçerli en iyi aday varsa mevcut solver bunu sınırlı arama etiketiyle sunar; optimum garantisi verilmez. Bilinmeyen kuyruk için 0 dakika koşullu senaryo ve belirsiz gerçek ETA korunur. Temel hava yoksa güvenilir enerji/SOC planı sunulmaz; 72 saat hareket penceresi CR-010 politikasından gelir. Yol önizleme akışı ayrı yol API'siyle yapılabilir.

## Yük, süre ve veritabanı

- İstek JSON'u 16 KiB; Content-Length yanında chunked/inflate edilmiş gerçek gövde de kontrol edilir. `public-planning/1.2.0` yanıtı aktarımda en fazla 2 MiB, açılmış JSON olarak en fazla 16 MiB'dir. 32 KiB üzerindeki yanıtlar istemci destekliyorsa async gzip ile kayıpsız sıkıştırılır; `Vary: Accept-Encoding` korunur. Büyük yanıt için gzip desteği yoksa 406 `PLANNING_RESPONSE_ENCODING_REQUIRED`, herhangi bir boyut sınırı aşılırsa 503 döner. Alanlar, SOC satırları, kaynaklar ve geometri sessizce kırpılmaz. Native fetch'in otomatik gzip görüşmesi kullanılır; mobilde elle Accept-Encoding header'ı eklenmez.
- `RATE_LIMIT_PLANNING_PER_MINUTE=6`. Mevcut ortak PostgreSQL rate limiter kullanılır. Aynı penceredeki tekrarlar tek ihlal sayılır; bir günde üç ayrı ihlal penceresi günlük engel oluşturur. [Politika](RATE_LIMITING.md).
- `PLANNING_LOCAL_CONCURRENCY=2`: instance başına sınır. Yeni istek kuyrukta bekletilmeden kapasite sonucu alır.
- Migration `011_planning_admission.sql`: PostgreSQL genel kapasitesi başlangıçta 4; 64 sabit slot ve tek ayar satırı. İki ayrı API instance'ı aynı kapasiteyi paylaşır. İşletim değişikliği örneği: `UPDATE planning_admission_config SET capacity=4 WHERE singleton;` (1–64). Mobil istekle değiştirilemez; üretimde değer yük testiyle seçilmelidir.
- Atomik kısa transaction, `SKIP LOCKED`, token fencing, süreli lease ve yenileme kullanılır. Yol/hava/hesap beklenirken DB transaction'ı açık tutulmaz. Pool ve admission sorgularında kısa bekleme sınırı vardır; DB yoksa yeni iş kabul edilmez.
- `PLANNING_HTTP_BUDGET_MS=30000` yürütme bütçesi; solver'a en fazla 250 ms daha kısa bütçe verilerek geçerli adayın derlenip dönebilmesi için pay ayrılır. Bu, body upload/rate limiter dahil uçtan uca ağ SLA'sı değildir. Mobil istemci 35 saniyede zaman aşımına uğrar. Uzun rota politikası `public-planning/1.1.0`: 10.000 dahili kesim/hava değerlendirmesi ile en fazla 64 harici hava çağrısı ayrı sınırlardır; harici bütçe aynı planın bütün bacakları arasında paylaşılır. PostgreSQL küresel kota ve admission sınırları korunur.
- Bağlantı kesilmesi, süre veya lease kaybı abort sinyalini yayar. Bir adapter iptali dikkate almazsa alttaki işlem gerçekten bitene kadar yerel izin bırakılmaz; geç alınan lease temizlenir. Worker kaybında süreli lease kurtarma sağlar. Yeni adapter'lar iptale uymalıdır.

`PlanningAdmissionStore` portu depolamayı hesap motorundan ayırır. Redis eklenmedi; yatay ölçeklemede süreç belleğine dayalı ortak kapasite/rate limit varsayımı yoktur. Bu teslim üretim yük/SLA kabulünü kapatmaz.

## Doğrulama ve mevcut veri sınırı

465 API/DB testi (38 suite, atlanan yok) ve 39 ortak sözleşme testi başarılı. Üç paket TypeScript kontrolü ve API production derlemesi başarılı. HTTP testleri gerçek Nest/bootstrap ve PostgreSQL kullanır; plan sağlayıcıları kontrollü sentetiktir. Üç mod, girdi enjeksiyonu, gövde sınırları, hata ayrımı, yanlış isteğe ait plan, süre/iptal, iki instance ortak kapasitesi ve günlük engel test edilir. Kontrollü sentetik başarı gerçek Hyundai kalibrasyonu değildir.

Yerel DB'ye migration 011 uygulandı. [Gerçek HTTP raporu](validation/task14-planning-http-validation.json), katalogdaki Ioniq 6 için HTTP 200 `insufficient_data` / `VEHICLE_ENERGY_PROFILE_MISSING` doğrular. Dış yol/hava çağrısı veya sentetik üretim profili eklenmedi. Böylece API tamamlanırken gerçek veri açığı gizlenmedi. Bu rapor bir HTTP gecikme veya saha doğruluğu benchmark'ı değildir.

Komutlar (API paketinde): `test:db`, `planning:contracts`, `planning:http-validate`. Son komut pilotta profil yokken gerçek DB kapısını doğrular ve örnek isteği git dışında `artifacts/task14-http/example-request.json` dosyasına yazar. Profil yayımlanmışsa beklenmedik canlı sağlayıcı çağrısı yapmak yerine durur. V1 saha doğrulaması, gerçek profiller, canlı EVSE kapsamı ve mobil bağlantı ayrı açık görevlerdir.
