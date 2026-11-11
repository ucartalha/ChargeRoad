# İstasyon kaynağı doğrulaması — 11 Kasım 2026

Bu çalışma kaynak araştırmasıdır; CR-008 canlı entegrasyon teslimi değildir. Kullanıcının son talebiyle mail ve operatörlerle dış iletişim pas geçildi; talep gönderilmedi.

Sonraki kullanıcı kararı: Başlangıçta OCM entegrasyonu seçildi; Google/HERE ve diğer hizmetler yedekte tutulacak. [Güncel OCM araştırması](OPEN_CHARGE_MAP_RESEARCH.md). Aşağıdaki Google/HERE örneklem planı yedek araştırma olarak korunur; aktif ilk entegrasyon adımı değildir.

## 1. EPDK: gerçek çağrı sonucu

11 Kasım 2026 14:44 Türkiye saati: `https://apigateway.epdk.gov.tr/sarjIstasyonlari` adresine GET + JSON body `{"markaAdi":"TRUGO"}` gönderildi. TLS doğrulaması açık, API anahtarı kullanılmadı. HTTP 200; 1.384.808 byte; yaklaşık 3,59 saniye. Bu tek istek gecikmesidir, p95/p99 ölçümü değildir.

| İncelenen içerik | Gerçek sonuç |
|---|---|
| İstasyon | 1.428; 1.418 halka açık, 10 özel |
| Soket beyanı | 4.383 |
| İstasyon alan sayısı | 15 |
| Soket alan sayısı | 4 |
| Canlı müsaitlik/arıza, durum gözlem zamanı | Yanıtta alan yok |
| Fiyat/tarife | Yanıtta alan yok |
| Fiziksel EVSE gruplaması | Yanıtta alan yok |

İstasyon alanları: `sarjIstasyonuNo`, `sarjIstasyonuAdi`, `sarjIstasyonuIsletmecisi`, `sarjAgiIsletmecisiLisansNo`, `sarjAgiIsletmecisiUnvan`, `adres`, `hizmetSekli`, `marka`, `olumluGorusVerenDagitimSirketiLisansNo`, `olumluGorusVerenDagitimSirketiLisansUnvani`, `enlem`, `boylam`, `soketler`, `yesilSarjIstasyonuMu`, `dagitimSirketiOlumluGorusBelgeNumarasi`.

Soket alanları: `soketNo`, `soketTipi`, `soketTuru`, `soketGucu`. İncelenen yanıtta bu 15/4 alanın tamamı bütün ilgili kayıtlarda mevcut ve dolu. Üst seviyedeki `statusCode=200` API işleminin durumudur; istasyonun çalıştığı veya müsait olduğu anlamına gelmez. `hizmetSekli=HALKA_ACIK` erişim türüdür; doluluk değildir. `yesilSarjIstasyonuMu` da müsaitlik değildir.

[Alan doluluk sayımları ve indirme kanıtı](validation/task8-epdk-filtered-audit.json). Ham cevaplar ve checksum manifest'leri Git dışında `artifacts/task8-sources/` altında tutuldu. Statik katalog yayınlanmadı/değiştirilmedi; yalnız mevcut kaynak kota tablosundaki slotlar kullanıldı.

### Swagger, kota ve kullanım koşulları

[Swagger](https://apigateway.epdk.gov.tr/sarjIstasyonlari?swagger) HTTP 200; sürüm 2.0, `security: []`, zorunlu GET body parametresi var. Body şeması `string` yazsa da örneği JSON nesnesi; gerçek nesneyle çağrı başarılı. `definitions` boş, response alan şeması tanımlı değil. Bu nedenle alanlar Swagger'dan varsayılmadı, gerçek yanıtta sayıldı.

[Resmî servis sayfası](https://epdk.gov.tr/Detay/Icerik/3-34680/enerji-donusum-piyasasi-web-servisleri) ve [kullanım kılavuzu](https://epdk.gov.tr/Detay/DownloadDocument?id=mqXhIJuluA8=) incelendi; kılavuz yeniden indirildi, SHA-256 önceki indirmeyle aynı. Kılavuz GET kullanımını, altı filtreyi (`lisansNo`, `sarjIstasyonuAdi`, `sarjIstasyonuNo`, `markaAdi`, `yesilSarjIstasyonuMu`, `hizmetSekli`) ve parametresiz saatte bir / parametreli dakikada bir sınırını açıklıyor. İncelenen Swagger/kılavuzda açık veri lisansı, genel yeniden dağıtım hakkı veya hizmet garantisi doğrulanamadı. Kamuya açık sorgu erişimi, sınırsız yeniden kullanım lisansı olarak etiketlenmez.

Ulusal ilk deneme ağ erişiminde `EACCES` ile başarısız oldu; önceden ayrılan yerel saatlik slot korununca ikinci deneme dış isteğe çıkmadan durdu. Bu turda yeni başarılı ulusal snapshot alındığı iddia edilmiyor. Önceki 17.165 istasyonluk katalog 10 Kasım 2026 alımıdır.

14:46:17 Türkiye saati: `{"sarjIstasyonuNo":"ŞRJ/23604"}` ile tekil sorgu denendi; ilk başarılı sorgudan yaklaşık 137 saniye sonra **HTTP 429 / ERR-227** döndü. Yanıt kota nedeniyle engelleme bildiriyor. Otomatik retry yapılmadı. Bu deneme tekil filtrenin başarılı olduğunu veya istasyonun bulunmadığını kanıtlamaz. [429 kanıtı](validation/task8-epdk-station-audit.json).

**Sonuç:** Kılavuzdaki periyot minimum yerel sınır olarak korunmalı; buna rağmen uzak 429 alınabiliyor. Gerçek kota kapsamı/penceresi ve varsa ortak IP/anahtar etkisi henüz bilinmiyor. `Retry-After` ve kontrollü backoff/devre kesici ayrıca gerekli; filtre değiştirerek kota aşılmaz. Bu turdaki 429 yanıtının header'ları kaydedilmedi; tanılama aracı sonraki çalıştırmalar için `Retry-After` alanını kaydeder.

## 2. Google / HERE: örneklem hazır, ölçüm yapılmadı

[Karşılaştırma girdisi](validation/task8-station-sample.json): Trugo, Eşarj, ZES için sekizer halka açık DC lokasyon; toplam 24. Kaynak 10 Kasım EPDK snapshot'ı; alım zamanı ve checksum dosyada korunur. Kimliklerin SHA-256 sırası ve farklı adres il son ekleriyle deterministik, coğrafi çeşitliliği gözeten seçimdir; Türkiye'yi istatistiksel temsil eden rastgele örnek değildir.

| Sağlayıcı | Seçilen istasyon | Gerçek API çağrısı | Canlı alan doluluk oranı |
|---|---|---|---|
| Google Places (New) | 24 | 0 — anahtar yok | Ölçülmedi (`null`) |
| HERE EV Charge Points | 24 | 0 — anahtar/token ve ürün erişimi yok | Ölçülmedi (`null`) |

`not_run`, bulunamadı veya boş canlı alan anlamına gelmez. Ortamda `.env`, mobil `.env` ve süreç değişkenlerinde ilgili tanımlı anahtar bulunmadı; hiçbir sır rapora yazılmadı.

### Doğrulanan API kabiliyetleri

- Google Places'in `evChargeOptions.connectorAggregation` nesnesi tip/güç bazında `count`, `availableCount`, `outOfServiceCount`, `availabilityLastUpdateTime` sunabiliyor. Bu, tekil fiziksel EVSE kimliği/durumu değildir. `businessStatus` ve açılış saatleri de şarj doluluğu yerine kullanılamaz. [Google alan sözlüğü](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places).
- Google'da `evChargeOptions`, Enterprise + Atmosphere SKU alanıdır; testin faturalandırması field mask'e bağlıdır. Projenin etkin API/faturalandırma ve anahtar kısıtları kontrol edilmelidir. [SKU alanları](https://developers.google.com/maps/billing-and-pricing/sku-details/places).
- Google Places verisi için genel cache/depolama/scraping ve haritada gösterim kısıtları var; `place_id` istisnası tüm müsaitlik içeriğine yayılmaz. Bu yüzden Google'ı mevcut sınırsız ortak PostgreSQL feed modeline doğrudan koyamayız; kullanım amacına uygun sözleşme ve izin ayrıca doğrulanır. [Google veri politikası](https://developers.google.com/maps/documentation/places/web-service/policies).
- HERE'nin EV Charge Points v2 kılavuzunda ticari veya değerlendirme lisansı için ürün erişimi etkinleştirmesi gerektiği yazıyor. Standart HERE anahtarı tek başına yeterli olmayabilir. [Resmî başlangıç](https://docs.here.com/ev-products/docs/here-ev-products-quick-start).
- HERE v3 `countryMetadata` Türkiye (`TUR`) ve operatör kapsamını incelemek için kullanılabilir. Statik operatör listesinde görünmek canlı durum garantisi değildir. v3 dokümanı bearer token örnekleri sunuyor; v2 API-key erişimiyle aynı yetki varsayılmaz. [Metadata yöntemi](https://docs.here.com/ev-products/docs/tutorial-metadata).

### Erişim geldiğinde uygulanacak ölçüm

1. Google için Places (New) etkin anahtar; HERE için seçilen sürüme uygun, EV ürün yetkili anahtar veya token sağlanır. Anahtarlar sohbet/Git yerine yerel ortamda tutulur.
2. Aynı 24 EPDK lokasyonu için sağlayıcı kimlikleri bulunur. Operatör, ad/adres, koordinat mesafesi ve ekipman birlikte incelenir; yan yana ayrı lokasyonlar veya karşı şerit birleştirilmez. Belirsiz eşleşmeler otomatik olumlu sayılmaz.
3. Başarılı yanıt sayısı, doğrulanan lokasyon eşleşmesi, statik ekipman alanı, canlı durum alanı ve kullanılabilir durum zamanı ayrı ölçülür. Alan varlığı `hasOwn`/null kontrolüyle yapılır; `availableCount=0` geçerli dolu alandır.
4. Paydalar açık raporlanır: bütün seçili lokasyonlar içindeki canlı veri oranı ile başarılı ve eşleşmiş lokasyonlar içindeki alan oranı ayrılır. 401/403/429/timeout, boş alan veya kapsama yok diye sayılmaz. Kısmi aggregate grupları ayrıca belirtilir.
5. Kaynak zamanı ile alım zamanı farkı veri yaşıdır; operatör olay zamanı olmadan uçtan uca güncelleme gecikmesi/SLA diye sunulmaz. Tek snapshot değişim gecikmesini ölçmez; izinli aralıkla tekrar gözlem ve gerekirse operatör olay kanıtı gerekir.
6. Sağlayıcı içeriği saklama/gösterim hakları doğrulanmadan ham Google/HERE yanıtı kalıcı DB'ye veya Git'e yazılmaz. Yetkili karşılaştırma sonuçlarının tutulması için de uygun kullanım şartları doğrulanır.

## Tekrarlama ve kalan işler

Tanılama aracı: [audit-epdk.cjs](../apps/api/scripts/audit-epdk.cjs). `apps/api` bağımlılıklarını kullanır; `.env` otomatik okunur. Tam komutlar proje kökünden:

```sh
node apps/api/scripts/audit-epdk.cjs --sample-only
node apps/api/scripts/audit-epdk.cjs --filtered
node apps/api/scripts/audit-epdk.cjs --station 'ŞRJ/23604'
# Ulusal kaynak kotası uygunsa; veri yayını yapmaz:
node apps/api/scripts/audit-epdk.cjs
```

`--sample-only` önceki ham dosyanın manifest checksum'unu doğrular; ağ/DB çağrısı yapmaz. Diğer modlar mevcut ortak EPDK kota kapısından geçer, 429 dahil hatada otomatik tekrar yapmaz. Araç, üretim canlı durum adapter'ı veya Google/HERE ölçüm runner'ı değildir.

Kalan işler: Google/HERE yetkili örneklem ölçümü; EPDK yeniden kullanım/kota ayrıntılarının netleştirilmesi; Eco-Movement kapsam/gecikme/tarife/yıllık lisans teklifi. Sonuncu ile operatör veri/OCPI/roaming görüşmeleri kullanıcının talebiyle şimdilik yapılmayacak. CR-008'in gerçek feed kabul kapısı açık kalır.
