# Open Charge Map — başlangıç entegrasyonu araştırması

Tarih: 2026-11-11. Kullanıcı başlangıçta OCM ile ilerlemeyi ve Google/diğer ticari hizmetleri yedekte tutmayı seçti. Bu belge araştırma ve uygulama planıdır; adapter, import veya canlı feed tamamlandığı anlamına gelmez. İlk araştırma anahtarsız doküman incelemesiydi. Sonrasında kullanıcı anahtar sağladı; `/referencedata`, 25 Türkiye kaydı ve 24 lokasyon çevresi sorgusu başarıyla doğrulandı. [Gerçek sonuçlar ve lisans/kapsam sınırları](OCM_VALIDATION.md).

## 1. Kaynak seçimi ve ürün sınırı

Uygulama güncellemesi: [provider/OCM alt teslimi tamamlandı](STATION_PROVIDERS.md). Aşağıdaki uygulama önerileri tarihsel hazırlığı korur; güncel DB sayıları, testler ve açıklar teslim raporundadır.

OCM başlangıçta entegre edilecek istasyon kaynağıdır. Mevcut EPDK kataloğu ve kanonik UUID'ler korunur; EPDK sicil kimlikleriyle OCM ekipman/erişim bilgisi kaynak dayanakları korunarak birleştirilir. Bu seçim mevcut kaynakların alan önceliğini ölçmeden değiştiren toplu bir DB güncellemesi değildir. Google, HERE, Eco-Movement ve Hubject için ilk sürümde bağlantı veya otomatik fallback açılmayacak. Mail/operatör görüşmeleri şimdilik yapılmayacak.

OCM ile konum, connector standardı, nominal güç, erişim/üyelik ve genel çalışabilirlik bilgisi sağlanabilir. Türkiye genelinde tamlık, güncellik ve ağ bazında kapsam henüz API üzerinden ölçülmedi. OCM'nin seçilmesi gerçek yol motoru, navigasyon, fiyat hesaplayıcı veya canlı müsaitlik ihtiyacını tamamlamaz. Rota/şarj kararı bizim algoritmalarımızda kalır.

## 2. Erişim, ücret ve adil kullanım

Resmî [API dokümanı](https://www.openchargemap.org/develop/api), v3 taban URL'sini `https://api.openchargemap.io/v3` olarak tanımlar. Ücretsiz anahtar kullanıcı profilindeki uygulama kaydıyla alınır. Başlangıç API hizmeti ücretsizdir; garanti/SLA yoktur. `X-API-Key` header'ı veya `key` query parametresi desteklenir. Biz header kullanacağız; anahtar URL/log/mobil pakete konmayacak. Backend ortam değişkeni için önerilen ad `OPEN_CHARGE_MAP_API_KEY`; bu araştırmada runtime config'e eklenmedi.

Sabit ve garantili sayısal dakika/gün kotası incelenen dokümanda verilmemiştir. Aynı sorgunun tekrarı engellenmeli, istekler debounce/throttle edilmeli; aşırı/ayrım gözetmeyen kullanım engellenebilir. Özel `User-Agent` ve `client=ChargeRoad` kullanılacak. Yüksek hacimde kendi DB'sine import veya özel API mirror öneriliyor. Bu nedenle mobil istekler OCM'ye doğrudan gitmez; PostgreSQL kataloğumuzdan okunur. [Adil kullanım ve erişim](https://www.openchargemap.org/develop/api).

## 3. İşimize yarayan sorgular

| Endpoint / parametre | Anlamı ve kullanımımız |
|---|---|
| `/referencedata/` | Countries, Operators, ConnectionTypes, CurrentTypes, StatusTypes, UsageTypes, DataProviders gibi sözlükler; ayrı sürüm/checksum ile bir kez alınır |
| `/poi/?countrycode=TR` | Türkiye filtresi; tek yanıt ülke kataloğunun tamamı demek değildir |
| `latitude`, `longitude`, `distance`, `distanceunit=km` | Koordinat çevresinde sorgu; mesafe birimi açık seçilir, varsayılan mil kullanılmaz |
| `polyline`, `distance`, `distanceunit=km` | Kodlanmış rota çizgisi çevresinde aday arama; uygun kodlama gerçek API örneğiyle doğrulanır |
| `boundingbox` / `polygon` | Dikdörtgen veya polygon içinde adaylar; gerçek yol erişimini kanıtlamaz |
| `chargepointid=ID1,ID2` | Birden fazla **OCM POI ID** ile sorgu; EPDK kodları veya fiziksel EVSE kimlikleri değildir |
| `operatorid`, `connectiontypeid`, `usagetypeid` | OCM sözlük kimlikleriyle filtre; EPDK lisans/kodlarıyla karıştırılmaz |
| `maxresults` | Sonuç sınırı; varsayılan 100, incelenen şemada garantili en yüksek değer yok |
| `compact=true`, `verbose=false` | Referans nesneleri/null alanları azaltır; lisans ve lookup bilgisi ayrıca saklanır |
| `modifiedsince` | Değişmiş kayıt sorgusu; canlı doluluk aboneliği değildir |
| `sortby=id_asc`, `greaterthanid` | Kimlik sıralı cursor; tam ilk alım için sınanabilir |
| `opendata=true` | Açık lisanslı olarak işaretlenmiş kayıtlar; sağlayıcı lisansı ayrıca doğrulanır |

Kaynak: [resmî OpenAPI şeması](https://github.com/openchargemap/ocm-docs/blob/master/Model/schema/ocm-openapi-spec.yaml). Resmî export aracı da `sortby=id_asc&greaterthanid=N&maxresults=1000` şeklinde alım yapıyor. Bu 1000 değeri garantili API üst sınırı veya bizim kesin batch seçimimiz değildir. [Export açıklaması](https://github.com/openchargemap/ocm-export/blob/main/README.md).

İlk yetkili araştırma isteği için örnek; henüz çalıştırılmadı:

```http
GET /v3/poi/?output=json&countrycode=TR&opendata=true&maxresults=25&compact=false&verbose=true&includecomments=false&client=ChargeRoad
Host: api.openchargemap.io
X-API-Key: <yalnız backend ortamındaki anahtar>
User-Agent: ChargeRoad-station-import
```

## 4. Durum alanlarını doğru yorumlama

**Genel çalışabilirlik ile o anda boş olma ayrı kavramlardır.** Referans sözlüğündeki bazı kodlar:

| OCM StatusTypeID | Anlam | Başlangıçta davranışımız |
|---|---|---|
| 0 | Unknown | Müsaitlik bilinmiyor |
| 10 | Currently Available (Automated Status) | Otomatik durum iddiası saklanabilir; yetkili feed, kapsam ve durum zamanı doğrulanmadan canlı `available` yapılmaz |
| 20 | Currently In Use (Automated Status) | Aynı doğrulama gerekir; tek başına fiziksel EVSE doluluğu veya varış tahmini değildir |
| 30 | Temporarily Unavailable | Genel geçici kullanılamama kanıtı; kaynağı/yaşı incelenir |
| 50 | Operational | Genel çalışıyor bilgisi; canlı müsaitlik `unknown` kalır |
| 75 | Partly Operational (Mixed) | Bütün ekipman arızalı veya müsait diye işaretlenmez |
| 100 / 150 | Not Operational / Planned | Kaynak ve güncellik politikasına göre ekipman/lifecycle değerlendirmesi |
| 200 / 210 | Removed / Duplicate Listing | Kaynak kaydı düzeyinde kaldırma/eşleştirme incelemesi; diğer kaynakların kanıtı otomatik silinmez |

`IsOperational=true` hem Operational hem otomatik dolu hem de bazı geçici durumlarda bulunabilir; tek boolean ile kullanılabilirlik hesaplanmaz. `SubmissionStatus.IsLive` kaydın yayın durumudur. `DateLastStatusUpdate`, POI veya ilişkili alt özelliklerin güncellenme zamanıdır; gerçek soket durumunun gözlem zamanı diye kullanılamaz. `DateLastVerified`/`IsRecentlyVerified` kullanıcı doğrulama sinyalleridir; canlı doluluk kanıtı değildir. Bu nedenle başlangıçta OCM kayıtlarının canlı doluluğu `unknown` tutulur; kaynaktan yeni indirmek bu bilgiyi taze canlı gözlem yapmaz.

Kaynaklar: [güncel export referans sözlüğü](https://github.com/openchargemap/ocm-export/blob/main/data/referencedata.json), [alan tanımları](https://github.com/openchargemap/ocm-docs/blob/master/Model/schema/ocm-openapi-spec.yaml). Şemada 10/20 kodlarının bulunması Türkiye'de bunları besleyen gerçek operatör bağlantısı olduğunu kanıtlamaz. Araştırma bu feed kapsamını doğrulamadı.

## 5. Türkiye için doğrulanabilenler

Resmî [export deposunda Türkiye klasörü](https://github.com/openchargemap/ocm-export/tree/main/data/TR) var. Referans sözlüğünde Türkiye `CountryID=229`, Eşarj `OperatorID=70`, ZES `3323`, Trugo `3712` olarak yer alıyor. Bunlar incelemede görülen lookup değerleridir; adapter sözlüğü kaynaktan okuyacak. Operatörün sözlükte bulunması lokasyon sayısı, güncellik veya canlı veri kapsamı değildir.

Bir [Türkiye örneğinde](https://github.com/openchargemap/ocm-export/blob/main/data/TR/OCM-107953.json) Eşarj lokasyonu; Type 2/CCS2/CHAdeMO, güç ve `StatusTypeID=50` var. `NumberOfPoints=1` iken üç connection özeti bulunuyor; bunlar üç bağımsız eşzamanlı şarj ünitesi sayılamaz. Örneğin kayıt zamanı da eski: 2020. Bu statik export incelemesidir, bugünkü yetkili API yanıtı veya ülke geneli kalite ölçümü değildir. GitHub dizininin kesilmiş dosya listesi Türkiye toplamı olarak raporlanmaz.

Tam ulusal snapshot için dokümanın önerdiği GitHub seçeneğinin güncel deposu `ocm-export` olur; eski `ocm-data` deposu arşivlenmiş/deprecated. Export ile API karıştırılmaz; commit/checksum ve gerçek kaynak zamanı korunur, güncellik ölçülmeden üretim kaynağı sayılmaz.

## 6. Lisans ve saklama

Gerçek API bulgusu: `opendata=true` içinde NC (ticari olmayan) lisanslı kayıtlar da geldi. Bu filtre tek başına ürün kullanım izni değildir. Sağlayıcı bazlı lisans izin listesi gerekir; ayrı izin olmadan NC kayıt ürün yayınına alınmaz. [Kanıt](OCM_VALIDATION.md).

OCM verisi karışık lisanslıdır. İlk alımlarda `opendata=true` kullanılır; `DataProviderID`, sağlayıcı lisans metni/URL'si, izin kontrolü, atıf ve normalize değişiklikler kayıtla birlikte korunur. Genel koşullar ve güncel referans sözlüğü OCM katkıcı verisini CC BY 4.0 olarak gösteriyor. Üçüncü taraf verisi aynı lisans varsayılmaz; eski şema örneklerindeki lisans metni yetkili güncel sağlayıcı kanıtının yerine geçmez. Belirsiz lisanslı kayıt incelemeye alınır.

Kullanıcıya görünür kaynak/lisans atfı gerekir; yalnız sunucu logunda bulunması yeterli değildir. İlk kapsamda yorum/fotoğraf içeriği alınmaz. Ham/normalize içerik ve kaynak lisansı korunarak DB'ye alınabilir; hangi kaynak kaydının hangi lisansla kabul edildiği izlenebilir olmalı. Yazılım deposunun MIT lisansı, içindeki veri setinin lisansı olarak kullanılmaz. [Resmî veri koşulları](https://openchargemap.org/about/terms).

## 7. Mevcut DB'ye uyarlamada gerekenler

Mevcut import/staging, kanonik UUID, source alias, atomik yayın ve PostGIS koridoru tekrar kullanılır. Kaynak indirme/parse transaction dışında; kısa yayın transaction'ı korunur. Mobil API istekleri sırasında dış kaynak beklenmez.

- OCM POI `ID` namespace ile kararlı alias olur; `OperatorsReference` varsa kanıt olarak saklanır, EPDK/EVSE kodu olduğu varsayılmaz. Operatör veya DataProvider değişikliği aynı POI'yi yeni lokasyon yapmamalı. Mevcut `partyId`/source-key kapsamı buna göre değerlendirilir.
- Yakınlık, ad/adres ve işletmeci eşleştirme adayı üretir; yalnız yakınlık otomatik birleştirmez. Açık crosswalk varsa aynı UUID'ye bağlanır; belirsizler incelemeye alınır. Kaynak sayıları toplanarak ekipman sayısı artırılmaz.
- `Connections[]` ekipman özetidir; `Quantity`/`NumberOfPoints` gerçek EVSE sayısı değildir. Fiziksel gruplama doğrulanmadan OCM connection ID'sinden EVSE üretilmez. Mevcut `connectorClaimSchema` quantity/aggregate ayrımını taşımıyor; sürümlü ve geriye uyumlu genişletme gerekir.
- `PowerKW`, `Voltage`, `Amps` nominal beyanlardır; DC voltaj aralığı, paylaşılan güç havuzu veya garanti edilen alınabilir güç oluşturmaz. Açık connector standardı kaynak lookup'uyla eşlenir; EPDK'nin belirsiz CCS beyanı tüm kayıtlarda kendiliğinden CCS2 olmaz.
- `UsageCost` serbest metindir; doğrulanmış kWh fiyatına çevrilmez. Üyelik ve erişim bilgisi lookup kanıtıyla taşınır; bilinmeyen saatler/erişim tahmin edilmez.
- Mevcut paket kaynak düzeyinde tek lisans/öncelik taşıyor. OCM'de sağlayıcı bazlı lisans için kayıt düzeyinde provenance veya açık lisans grubuyla bölünmüş import tasarlanmalı; POI alias'ı bu gruplardan bağımsız kalmalı. İzinli veriyi tek, yanlış genel lisansla yayınlamayacağız.
- Uygulanmış 006/007 migration'ları değiştirilmeyecek; ihtiyaç varsa yeni migration ve sözleşme revizyonu eklenecek. Bu araştırmada DB veya runtime kodu değiştirilmedi.

## 8. Veri edinme ve yenileme yaklaşımı

İlk küçük API örneği + reference data → lisans/kalite denetimi → sınırlandırılmış Türkiye alımı → staging/eşleştirme → atomik DB yayını → yerel rota koridoru sorgusu.

Rota bazlı kaynak sorgusu gerekirse tüm uzun polyline tek başına `maxresults` ile tam kabul edilmez. Bölümlere ayırma veya kontrollü cursor, POI ID ile tekilleştirme, arama sınırı ve eksik kapsam raporu gerekir. Yol geometri/gerçek sapma CR-009 sorumluluğudur. API geometrisi gerçek rota yerine üretilmez.

Tam ilk alımda ID sırası/cursor denenecek; sayfa sınırına ulaşan cevap son sayfa sayılmaz. Kısmi/yarıda kesilen/429 alan tarama tam snapshot olarak yayınlanmaz. `modifiedsince` için örtüşmeli zaman penceresi, idempotency ve ancak başarılı tüm alımdan sonra ilerleyen watermark gerekir. Güncelleme sırasında kayıtlar hareket edebileceğinden ID cursor'ı tek başına tutarlı snapshot garantisi sayılmaz.

Silinen/görünmez olan kayıtlar, filtre değişikliği ve `opendata` kapsamından çıkma ayrıca ele alınır; delta'da görünmemek silme değildir. Tam uzlaştırma veya açık kaldırma kanıtı gerekir; kaynak izni değiştiğinde yeniden kullanım da incelenir. Güvenilir periyodik job CR-021'de; ilk teslim manuel tekrar kullanılabilir servis/CLI olur. Sayısal sıklık ve istek bütçeleri gerçek yanıta göre seçilecek; varsayımsal sağlayıcı kotası uydurulmayacak.

## 9. Anahtar geldikten sonraki kabul adımları

1. Anahtarı yalnız backend `.env` içine koy; `/referencedata` ve Türkiye'den en fazla 25 kayıtla izinli küçük örnek al. Auth hatasında otomatik anahtarsız veya ticari fallback yok.
2. Üç ağdan hazırlanan [24 lokasyon](validation/task8-station-sample.json) ile OCM eşleşme, connector tipi/gücü, yaş, lisans ve genel çalışma durumu doluluğunu ölç. Google/HERE karşılaştırması yedekte kalır. Bulunamayanı kesin istasyon yok sayma.
3. Aggregate ekipman/lisans/kimlik sözleşmelerini ve gerekli yeni migration'ları uygula; izinli örneklerle normalizer ve atomik import kur.
4. Aynı import, eksik sayfa, yanlış lisans, bilinmeyen lookup, kaynak operatörü değişimi, toplam ekipman belirsizliği, yanlış timestamp, 429/timeout ve eski snapshot senaryolarını doğrula.
5. DB liste/koridor okumasının OCM çağrısı yapmadığını, kanonik UUID'lerin korunduğunu, kaynak atfının taşındığını ve 50/IsLive/10/20 verilerinin doğrulanmadan canlı müsaitliğe dönüşmediğini kontrol et. p95/p99 yük denemesi yerel fixture üzerinde yapılır.

OCM katalog/genel durum entegrasyonu ayrı teslim olarak doğrulanabilir. CR-008'in gerçek canlı müsaitlik kapsamı yetkili ve güncel durum kanıtı olmadan DONE yapılmaz; başlangıç ürünü bunu uyarılı `unknown` ile sunabilir. Anahtar oluşturmak dışında bu araştırma için kullanıcıdan yeni izin/hesap açma veya mail gönderme adımı gerekmiyor.
