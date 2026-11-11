# Araç kataloğu: ilk teknik teslim

Tarih: 2026-11-09. Kapsam: Ortak araç verisini dış kaynaktan DB'ye alıp uygulamaya DB üzerinden sunmak.

2026-11-10 güncellemesi: Bu belge ilk OpenEV tesliminin kaydıdır. [CR-006 teknik katmanı](VEHICLE_KNOWLEDGE.md) katalog API'sini kaynaklardan bağımsız UUID kimliklerine taşıdı; eski ID'ler alias olarak desteklenir. Yeni kaynak adayları, kanıtlar, kullanıcı tüketim aralıkları ve sürümlü profiller ayrı tutulur. Aşağıdaki kaynak sahipliği garantileri korunur; public okumalar artık yayınlanmış ana katalog görünümündendir.

## Akış

Manuel CLI → OpenEV Data sürüm çözümleme/indirme → checksum ve şema doğrulama → VehicleImportService → transaction içinde katalog güncelleme.

Mobil istemci → VehiclesController → VehiclesRepository → PostgreSQL.

API başlangıcında, listeleme veya detay isteğinde dış kaynağa gidilmez. Veritabanındaki son başarılı katalog dış kaynağın o anki durumundan bağımsız okunabilir. Bu, cihazın kendi API'mize HTTP isteği göndermeyeceği anlamına gelmez; mobil kalıcı cache bu teslimde yok.

## Sorumluluklar

- config/environment: Kök .env dosyasını yükler; mevcut ortam değişkenlerini ezmez.
- database: PostgreSQL bağlantı havuzu ve migration yürütücüsü.
- vehicles/import/open-ev.provider: Sürüm metadata'sı ve eşleşen JSON dosyasını indirir.
- vehicles/import/open-ev.schema: Desteklenen şema, sayılar, kapasite ve kimlikleri doğrular.
- vehicles/import/vehicle-import.service: Elle çağrılır; gelecekteki job aynı servisi kullanabilir.
- vehicles/import/vehicle-import.repository: Atomik aktarım, kaynak kilidi ve işlem geçmişi.
- vehicles/vehicles.repository: Sadece DB okuma sorguları.
- packages/shared/src/vehicle-catalogue: Eksik veriyi null ile ifade eden istemci sözleşmesi. Rota motorunun gerekli bütün alanları dolu Vehicle modeliyle aynı tip değildir.

## Tablolar

| Tablo | Amaç |
|---|---|
| app_migrations | Uygulanan SQL dosyası ve checksum |
| vehicle_data_sources | Kaynak ve lisans bilgisi |
| vehicle_imports | Sürüm, checksum, kaynak üretim/alınma zamanı, kayıt sayısı ve durum |
| vehicle_makes | Kaynak kapsamında marka |
| vehicle_models | Markaya bağlı model |
| vehicle_variants | Yıl, trim, varyant, batarya, AC/DC güç, pazarlar, ham kaynak kaydı |
| vehicle_charge_ports | Soketler ve kaynak sırası |
| vehicle_range_ratings | Test döngüsü veya gerçek kullanım profiliyle menzil |
| vehicle_consumption_profiles | Kaynak sağlarsa doğrudan tüketim |
| vehicle_charge_curves | Kaynak sağlarsa eğri türü, koşulları ve referansı |
| vehicle_charge_curve_points | Yüzdeye göre güç/akım/voltaj noktaları |

Coğrafi tablo bu teslimin konusu değil. Mevcut PostGIS kurulumu korunur; istasyon şeması sonraki işte ele alınır.

## Yerelde çalıştırma

Kök .env.example dosyasını .env olarak kopyalayın ve DATABASE_URL'yi yerel DB'ye ayarlayın. Bu çalışma sırasında mevcut olmayan yerel .env örnekten oluşturuldu; gerçek sağlayıcı anahtarı eklenmedi.

~~~sh
pnpm install
pnpm db:up
pnpm db:migrate
pnpm vehicles:import
pnpm --filter @chargeroad/api dev
~~~

Varsayılan sürüm VEHICLE_DATA_VERSION=v1.24.0 ile sabitlenir. Bilinçli güncelleme için:

~~~sh
pnpm vehicles:import --version latest
~~~

Latest gerçek release tag'ine çözümlenir; işlem geçmişine latest yerine somut sürüm yazılır. Belirli sürüm için --version v1.24.0 kullanılabilir. Kabul edilmeyen şema sürümü otomatik dönüştürülmez.

Production derlemesi sonrasında apps/api dizininden:

~~~sh
node dist/cli.js db:migrate
node dist/cli.js vehicles:import --version v1.24.0
node dist/main.js
~~~

Deployment paketi dist ile birlikte apps/api/migrations dizinini de içermelidir. Migration API açılışında otomatik çalışmaz. Uygulanmış SQL dosyası değiştirilmez; düzeltme yeni migration ile yapılır.

## API

| Metot ve yol | Sonuç |
|---|---|
| GET /v1/vehicles/makes | Aktif varyantı bulunan markalar |
| GET /v1/vehicles/models?make=audi | Marka slug'ına bağlı modeller |
| GET /v1/vehicles?make=audi&model=a6_e_tron&year=2024&limit=25&offset=0 | Sayfalı aktif varyantlar |
| GET /v1/vehicles?q=audi&market=DE | Metin ve açık pazar filtresi |
| GET /v1/vehicles/:id | Varyant, soketler, menzil değerleri ve varsa şarj eğrisi |

Liste yanıtı items, total, limit, offset içerir. Limit varsayılan 25, üst sınır 100. Bilinmeyen filtreler veya geçersiz değerler 400, bulunmayan kimlik 404 döndürür. Filtreler SQL parametreleriyle uygulanır; yüzde/alt çizgi arama jokeri olarak yorumlanmaz.

Her kayıtta kaynak kimliği, lisans, sürüm, şema sürümü, üretim ve alınma zamanları bulunur. Daha önceki bir snapshot'ta bulunan pasif kayıt ID ile okunabilir; aktif seçim listesinde gösterilmez.

Bu uçlar ortak katalog için salt okunur ve şu anda public. HTTP üzerinden import/yönetim ucu eklenmedi. Kişisel araç/seyahat verileri ve auth bu modüle dahil değil.

## Aktarım garantileri ve sınırlar

- İndirme boyutu ve zaman aşımı sınırlı. JSON release dosyası beklenen depodan seçilir; mevcut release digest'iyle SHA-256 doğrulanır.
- Bütün kaynak kayıtları DB yazımından önce doğrulanır. Boş veri, kayıt sayısı uyuşmazlığı, mükerrer kaynak kimliği ve desteklenmeyen şema reddedilir.
- Sadece kaynağın açıkça verdiği tüketim kullanılır. Wh/km → kWh/100 km dönüşümü /10 ile yapılır; kaynağın belirtmediği test döngüsü atanmaz.
- Gross kapasite, kullanılabilir kapasite yerine geçirilmez. Menzilden tüketim türetilmez.
- Kaynak + kaynak araç kimliği kararlı ID üretir. Kaynağın kendi kimliğini değiştirmesi yeni kayıt oluşturur; kaynaklar arası eşleştirme bu kapsamda değildir.
- Aynı kaynak için eşzamanlı DB aktarımı advisory lock ile engellenir.
- Daha eski generated_at değerine sahip snapshot, yeni başarılı kataloğun üzerine yazılmaz.
- Marka/model/varyant ve alt tablolar tek transaction içinde güncellenir. Okuyucu yarım aktarım görmez.
- Kaynaktan kalkmış kayıtlar fiziksel silinmez; yalnızca eksiksiz doğrulanmış snapshot başarıyla yazıldıktan sonra pasifleşir.
- DB yazım hatasında önceki katalog korunur ve import failed kaydı tutulur. Kaynak indirme/şema doğrulama hatası DB aktarımı başlamadan CLI'da hata verir; bu hatalar için henüz DB import kaydı yok.
- İçe aktarma süreç zorla kesilirse transaction geri alınır; önceden açılan running kaydı kalabilir. Asılı iş uzlaştırması ve retry politikası haftalık job kapsamında ele alınacak.
- Ham araç verileri tutulur; kaynak doğruluğu, yeni bir sürümün araç kapsamının güvenilirliği veya Türkiye varyant eşleşmesi otomatik garanti edilmez.

## Gerçek veri doğrulaması

OpenEV Data v1.24.0 JSON dosyası; generated_at: 2025-12-30T18:56:57.274514516+00:00.

| Ölçüm | Sonuç |
|---|---|
| Marka | 65 |
| Model | 260 |
| Aktif araç/yıl/varyant kaydı | 1.189 |
| Soket kaydı | 1.275 |
| Menzil kaydı | 1.590 |
| Kullanılabilir kapasitesi bulunan kayıt | 1.189 |
| Doğrudan tüketim profili | 0 |
| DC şarj eğrisi | 0 |
| Açık TR pazar etiketi | 0 |

İki gerçek aktarımın ardından 1.189 aktif ve 1.189 benzersiz kimlik kaldı. Bu sürüm katalog başlangıcıdır; Türkiye pilotu veya tüketim motoru için tek başına yeterli değildir. Pazar listesinde TR bulunmaması Türkiye'de satış olmadığının kanıtı değildir; market=TR filtresi bu kaynakta sıfır sonuç verir.

Kaynak: [OpenEV Data sürümü](https://github.com/open-ev-data/open-ev-data-dataset/releases/tag/v1.24.0). [Lisans metni](../third_party/open-ev-data.LICENSE.md) veriyle birlikte korunur; downstream veri dağıtımına da dahil edilmelidir.

## Testler

~~~sh
pnpm --filter @chargeroad/api exec jest --runInBand --cache=false
pnpm --filter @chargeroad/api typecheck
pnpm --filter @chargeroad/mobile typecheck
pnpm --filter @chargeroad/shared typecheck
pnpm --filter @chargeroad/api build
~~~

DB entegrasyonu opt-in. PowerShell örneği:

~~~powershell
$env:TEST_DATABASE_URL = 'postgresql://chargeroad:chargeroad@localhost:5432/chargeroad'
pnpm --filter @chargeroad/api test:integration
~~~

Testler rastgele isimli vehicle_test_ şemasını oluşturur; yalnızca kendi şemasını temizler. Mevcut katalog tablolarına fixture yazmaz. Ayrı test DB'si de verilebilir. Varsayılan test çalıştırmasında TEST_DATABASE_URL yoksa DB testleri atlanır.

Doğrulanan sonuç: DB/HTTP entegrasyonu dahil 18 test geçti, üç paket typecheck ve production build geçti. Production API geçici yerel portta gerçek DB ile açılarak 1.189 kaydı sundu ve kapatıldı. Bu kontroller mobil arayüz entegrasyonu veya rota doğruluğu testi değildir.

## Sonraki iş: haftalık güncelleme

Haftada bir yenileme kullanıcı gereksinimidir; henüz scheduler yok. CR-021 kapsamında gün/saat/saat dilimi, job altyapısı, son başarılı veri yaşı, retry, asılı işler ve bildirimler belirlenecek. Mevcut CLI/VehicleImportService yeniden kullanılacak. API istekleri import tetiklemeyecek.

## Mobil katalog seçimi — 2026-11-10

Araçlar sekmesi marka → model → model yılı/varyant sırasıyla açılır. Yeni marka seçmek model ve varyantı, yeni model seçmek varyantı sıfırlar. Her aşama kendi DB okuma endpoint'ini çağırır.

- Marka ve model listesinde yerel metin araması; varyantlarda 250 ms beklemeli sunucu araması.
- Varyantlar 50 kayıtlık sayfalarla gelir. Diğer varyantları göster düğmesi sonraki sayfayı ekler.
- Yükleniyor, boş sonuç, bağlantı hatası ve tekrar dene durumları var.
- Değişen seçimlerde eski istekler iptal edilir ve gecikmiş sonuçlar gösterilmez.
- Varyant detayında model yılı, kullanılabilir batarya, maksimum DC güç ve soketler gösterilir. Eksik değerler Bilgi yok olarak kalır.
- Bu araçla devam et seçimi onaylar. Yalnızca sabit katalog ID'si AsyncStorage içinde cihazda saklanır; hesap veya kişisel veri tablosu oluşturulmaz.
- Uygulama yeniden açıldığında kayıtlı ID'nin güncel ayrıntıları DB API'sinden okunur. Bulunmayan/pasif araç veya bağlantı hatası kullanıcıya bildirilir; çevrimdışı tam katalog saklama bu kapsamda değildir.
- Onaylanan araç rota ekranına taşınır. 0–100 doğrulamalı başlangıç şarjı alanı eklendi; rota hesaplama henüz bağlı değil.

Telefon için apps/mobile/.env dosyasındaki EXPO_PUBLIC_API_URL, bilgisayarın LAN IP'sini ve /v1 önekini içermeli; localhost telefonda bilgisayarı göstermez. Yerel çalışmada API 0.0.0.0:3000 üzerinde, Expo Go 8081 üzerinde çalıştırılır. Bu dosya git tarafından yok sayılır. IP değişirse mobil ortam değişkeni güncellenir ve Expo yeniden başlatılır.

Yeni kaynaklar için modüller:
- src/api/catalogue.ts: Ortak API istemcisi, timeout ve iptal.
- src/features/vehicles/useCatalogueQuery.ts: İstek yaşam döngüsü ve geçerli sonuç kontrolü.
- src/features/vehicles/useActiveVehicle.ts: Cihazdaki araç ID'si ve açılış doğrulaması.
- src/features/vehicles/VehiclesScreen.tsx: Kademeli seçim ve varyant listesi.
- src/theme.ts: Ortak renkler.

Doğrulama: Mobil TypeScript kontrolü, Android/iOS export ve LAN API üzerinden gerçek marka/model/varyant/detay zinciri. Gerçek telefonda dokunma, klavye ve uygulamayı kapatıp açma akışı ayrıca denenmeli.
