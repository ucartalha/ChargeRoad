# Weather review — 2026-11-12

## Kod değişikliği öncesi inceleme

- **Confirmed Bug:** eski koordinat URL anahtarı yakın kullanıcıların meteorolojik serilerini paylaşmasını engelliyor. PostgreSQL lease, fencing, Expires/304, kaynak tarihi ve global kota zaten mevcut; bunlar değiştirilmeyecek.
- **Performance Risk:** ayrıntılı örnekleme bütün uzun rotayı bir kerede ele alıyor. Son düzeltme dış çağrı bütçesini 64'e çıkarmış; nottaki 16 değeri güncel değil. Yeni çözüm global provider hızını artırmayacak.
- **Missing Integration:** mobilde aktif navigasyon henüz uygulanmış değil; ileri pencere için backend akışı yok. Yeni pencere hesabı mevcut WeatherService içinde kullanılacak; tamamlanmış mobil navigasyon iddia edilmeyecek.
- **Enhancement:** en fazla beş eşit-mesafe bölümünün orta noktasıyla preliminary hava önizlemesi; 50 km ileri pencere / 20 km ilerleme / riskte sıklaştırma; koşullu coğrafi hücre paylaşımı.
- **Doğrulanmayan eski bulgu:** `AppModule → PlanningHttpModule → EvPlanningService → PlanningSession → WeatherProvider` üretim yolu bağlı. `PlanningCoordinator/PlanningEngine` eski porttur; ikinci bir sahte optimizer veya gereksiz DI kaydı eklenmeyecek. Task 12/13 gerçek motorları mevcut.
- **72 saat:** public plan enerji hesabını reddediyor; mobil ayrı gerçek yol önizlemesiyle devam ediyor. Bu mevcut public sözleşme karşılığı korunacak. WeatherService ileri tarih için `preliminary_route` dönüyor.

## En küçük uyumlu çözüm

Mevcut ayrıntılı `sampleRouteWeather`, enerji/şarj motorları, public plan contract ve PostgreSQL tabloları korunur. Aynı dosyaya iki örnekleme modu, WeatherService'e önizleme/pencere yardımcıları eklenir. Pencere durumu çağıran navigasyon oturumuna aittir; kullanıcı rotası/SOC'si global cache'e girmez. Yeni veritabanı, queue, Redis, H3 bağımlılığı veya migration gerekmez.

Beş nokta rota boyunca ayrıntılı hava kapsaması değildir. Önizleme her zaman preliminary kalır; özellikle kritik SOC çevresinde ek doğrulama gerektirir. Mevcut doğrulanmış tam rota hesabı bu seyrek örnekleme ile değiştirilmez.

## Implemented Fixes

- `samplePreviewWeather`: yol mesafesinin %10/%30/%50/%70/%90 noktaları gerçek geometride seçilir. Geçiş zamanları durak gecikmeleriyle hesaplanır. Başlangıç/varış kapsam metadata'sında kalır; ek provider noktası olmaz. Bilinmeyen beklemeden sonraki zamanlar üretilmez.
- `WeatherService.forPreview` / `POST /v1/weather/route-preview`: toplam beş dış acquisition bütçesi; hücre reddedilip exact koordinata dönüldüğünde de bu bütçe aşılmaz. Çıktı daima `preliminary_route`, `energyReady:false`; kesin SOC veya şarj durağı içermez. Eksik forecast durumları ayrıca döner. 72 saat dışında yol geometrisi korunur, hava indirilmez.
- `sampleNavigationWeather` / `WeatherService.forNavigation`: en fazla ileri 50 km; 150 km dahil kısa rotalarda 10 km, uzunlarda 20 km örnekleme. 20 km ilerleme, en az 15 dakika ETA kayması, durak değişikliği, sapma veya cache expiry pencereyi yeniler. Önemsiz GPS güncellemesinde `window_unchanged`, boş yeni sorgu listesi döner; çağıran önceki pencereyi tutar.
- Dağlık/yüksekliği bilinmeyen, şarj erişimi/durağı olan veya çağıranın kritik SOC/hava riski bildirdiği kesimler sıklaştırılır. Risk adımı 5 km üst sınırıdır; kısa kesim sınırları ek örnek verebilir. Bütçe aşılırsa açık `insufficient_data` ve kapsam sınırları döner.
- Aynı seriden farklı ETA'lar yeniden normalize edilir. HTTP açısından geçerli cache yeni indirme gerektirmez; expiry sonrası koşullu revalidation korunur. Yeni bir durak yeni coğrafi nokta gerektirebilir; mevcut durağın süresini değiştirmek tek başına yeni HTTP gerektirmez.
- Aynı süreçte ortak cache anahtarını bekleyenler tek acquisition promise'ı paylaşır; en fazla 128 bekleyen farklı anahtar vardır. İstemci iptali ortak işi iptal etmez; acquisition/fetch bağımsız sürelerle sınırlıdır. Farklı instance'lar PostgreSQL lease/fencing kullanır.

## Architectural Changes

Yeni dependency/migration yok. `weather-sampling/2.0.0`: preview 5, kısa rota 150 km / 10 km, uzun rota 20 km, risk 5 km, pencere 50 km, ilerleme 20 km, ETA 900 saniye.

Coğrafi hücreler deterministik 0,005° grid kullanır; merkezle uzaklık en fazla 500 m olmalıdır. Yalnız açık yükseklik ve 100 m'den az yerel relief bilgisi olan sorgularda paylaşım denenir. Kaynak rakımı örnekten 100 m'den fazla farklıysa veya rakım yoksa hücre reddedilip exact koordinata dönülür. Yüksek yerel değişkenlikte exact örnek seçilebilir. **30 m provider koordinat kontrolü ve yol hedefiyle gerçek sample arasındaki 10 km üst sınır korunur.** Grid meteorolojik/zemin doğruluk kanıtı değildir; doğrulanmamış rota kotu kesin sayılmaz.

Cache anahtarı provider + adapter sürümü + seçilmiş provider URL'sinden HMAC ile oluşmaya devam eder. Kullanıcı, rota ID, SOC veya kişisel sürüş verisi cache'e eklenmez. Yol hedefi `forecast.location`, gerçek provider noktası `metadata.sampledLocation`, uzaklık/rakım ve paylaşım/reddetme uyarısı ayrı izlenir.

Mevcut `POST /plans`, ayrıntılı `forRoute` ve enerji/şarj kriterleri korunur. Yeni endpoint mevcut origin/destination/departureAt/avoidTolls/avoidFerries request şeklini kullanır. `WeatherModule`, `RoadsModule` export'una bağlanır. Tam segmentler önizleme HTTP yanıtına konmaz.

## Changed Files

- `apps/api/src/weather/weather-policy.ts`: sürümlü örnekleme değerleri.
- `weather-sampler.ts`: preview, pencere, durak/zaman/kapsam; ayrıntılı sampler korunur.
- `weather-spatial.ts`: yeni küçük hücre/rakım yardımcısı.
- `weather.service.ts`: mevcut provider/cache üzerinden yeni modlar, fallback tekilleştirme, beş acquisition sınırı.
- `weather-cache.ts`: bounded local single-flight ve sayısal sayaçlar; SQL lease/kota/304 korunur.
- `weather.controller.ts`, `weather.module.ts`: ayrı preview endpoint'i ve routing bağlantısı.
- `packages/shared/src/contracts/road-weather.ts`: optional örnek rakımı/relief; eski payload'lar geçerli.
- `weather/__tests__/weather-window.spec.ts`: yeni örnekleme testleri.
- `weather/__tests__/weather-cache.integration.spec.ts`: gerçek PostgreSQL ve motorlar, fake dış hava transport'u ile integration/load testleri.
- Bu rapor ve `WEATHER_PROVIDERS.md`. Önceki görevlerden kalan değişiklikler bu teslimin yeni değişikliği sayılmaz.

## Tests and Results

Tam API/DB: **45 suite / 580 test geçti** (49,321 s). Typecheck, API build, **41 shared ve 12 mobil** test geçti. 100 kullanıcı / aynı rotanın beş noktası testi dahil. Son eklenen kademeli tırmanış sıklaştırması da dahil **19 örnekleme unit testi ayrıca geçti**; bu son değişiklikten sonra typecheck ve API build yeniden başarılı oldu.

40/140/150/151/450/800 km, gerçek orta nokta/zaman hesabı, pencere/ilerleme, ETA, sapma, dağlık/şarj/kritik kesimler, bilinmeyen kuyruk doğrulandı. Provider/adapter/konum anahtar ayrımı, hücre rakım reddi, iptal, 304, expiry, lease expiry/supersession, 429/backoff, günlük kota ve provider timeout test edildi. Gerçek enerji/şarj optimizer'ı shared WeatherService/PG cache ile sentetik dış veriler üzerinde şarjlı plan üretti. Gerçek MET'e yük testi yapılmadı.

## Before/After Metrics

Sabit 100 km/sa, düz sentetik geometride konum sayıları:

| Rota | Önce: tam ayrıntılı | Yeni preview | Yeni ilk navigation penceresi |
| --- | --- | --- | --- |
| 40 km | 5 | 5 | 5 |
| 140 km | 15 | 5 | 6 |
| 150 km | 16 | 5 | 6 |
| 151 km | 17 | 5 | 4 |
| 450 km | 46 | 5 | 4 |
| 800 km | 64 konum bütçesini aşar | 5 | 4 |

Bu farklı modların iş yükü karşılaştırmasıdır; beş örneğin tam rota kadar doğru olduğu veya tam optimizer maliyetinin bu oranda azaldığı iddia edilmez.

Yerel PG, aynı süreçte iki bağımsız servis/cache, fake transport (50 ms), tek ortak hücre; gerçek MET HTTP çağrısı yok:

| Kullanıcı / cache | Fake dış çağrı | DB sorgusu | Hit / miss / coalesced | p50 ms | p95 ms | p99 ms | Yetersiz veri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 / cold | 1 | 21 | 1 / 2 / 98 | 78,86 | 123,79 | 124,29 | %0 |
| 100 / warm | 0 | 2 | 2 / 0 / 98 | 8,95 | 12,49 | 12,87 | %0 |
| 1.000 / cold | 1 | 21 | 1 / 2 / 998 | 145,16 | 181,22 | 184,99 | %0 |
| 1.000 / warm | 0 | 2 | 2 / 0 / 998 | 69,34 | 100,67 | 103,73 | %0 |

`coalesced` aynı instance'ta ortak acquisition bekleyenlerdir; hit/miss DB okumalarıyla ilgili olduğundan toplam kullanıcı sayısını vermek zorunda değildir. Cold durumda bir kota tüketildi. Bu mikro yük testinde kullanıcı başına tek weather query vardır; tam rota API SLA testi değildir. Önceki sürüm latency baseline'ı alınmadı; hızlanma yüzdesi verilmez.

Ek tam rota preview testi: iki servis örneğinde 100 kullanıcı / 500 query, 2 ortak hücre, 2 fake dış HTTP çağrısı, 699,29 ms toplam süre, yetersiz veri %0. Beş noktanın aynı hücreye düşenleri paylaşması doğrulandı. Yukarıdaki latency tablosu bir önceki aynı cache test koşumunun ölçümleridir; bir üretim SLA'sı değildir.

Ayrık 100 / 1.000 cold konum ve dolu günlük kota: p99 73,29 / 182,52 ms, yeni dış çağrı/kota tüketimi 0, yetersiz veri %100. Bu kontrollü reddir; 1.000 benzersiz cold rotaya mevcut 2 istek/sn sınırıyla anlık veri sağlanabileceğini göstermez.

Tekrar: `pnpm --filter @chargeroad/api test:db --testPathPattern=weather`; ölçümler `weatherLoad` JSON satırlarında. Gerçek PG gerekir; testler yalnız kendi rastgele şemalarını oluşturup siler.

## Remaining Risks

- Mobil aktif navigasyon henüz yok. Backend penceresi hazır; cihaz GPS/ETA olayları bağlı değil. Mevcut mobil buton tam enerji/şarj planına devam eder; seyrek preview bu planın yerine geçirilmedi.
- Meteorolojik risk/kritik SOC, navigasyon orkestratöründen `riskSegmentIds` / `criticalSegmentIds` olarak gelir; otomatik sensör/risk dedektörü eklenmedi.
- Pencere/beş nokta bütün seyahatin güvenilir enerji/şarj onayı değildir. İleri bölüm hazır olmadan bütün rota SOC'si gösterilmemeli; kritik rezerv için ayrıntılı doğrulama korunur.
- Hücre rakım bağlamı kaynak yol kotunun doğruluğuna bağlıdır; saha/kot ve yerel hava değişkenliği doğrulanmalıdır.
- Multi-instance testi aynı süreçte farklı nesnelerle gerçek ortak PG kullanır; dağıtık deployment/ağ/cihaz kabulünün yerine geçmez.
- İstanbul–Ankara'nın eksik fiziksel DC EVSE ve çelişkili yol süresi/hız sınırı açıkları kapanmadı.

## Deferred Tasks

Mobil navigasyon GPS/ETA/SOC/reroute/cancel olaylarını pencereye bağlamak; risk dedektörü/saha doğrulaması; ayrı süreçlerle deployment/load provası; üretim provider kapasitesi ve farklı cold rotaların kabul politikası. Yeni altyapı eklenmedi; üretim kapasitesi veya tam mobil navigasyon iddia edilmedi.
