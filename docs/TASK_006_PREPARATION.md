# CR-006 — Uygulama öncesi hazırlık

Tarih: 2026-11-10. Bu belge uygulama öncesi hazırlık kaydıdır. Sonraki turda teknik altyapı uygulandı; güncel durum, gerçek aktarım ve kalan kabul açıkları [teknik teslimde](VEHICLE_KNOWLEDGE.md) bulunur. Aşağıdaki adımlar planın tarihsel kaydıdır.

## Hedef ve kabul edilmiş sınırlar

İlk katalog aktarımını yeniden yapmak yerine mevcut DB kataloğunu çok kaynaklı, alan bazında izlenebilir ve sürümlü enerji verisiyle tamamlamak. Mobil okuma isteği yine sadece kendi DB/API'mize gidecek. [ADR-004](adr/004-vehicle-identity-and-data-quality.md) ile bağımsız araç kimliği, etiketli mühendislik tahminleri ve açık lisanslı/izinli kaynaklar + kendi ölçümlerimiz seçildi.

Ek kapsam (kullanıcı gereksinimi): Farklı hız ve yaz/kış koşullarındaki referanslar, yol hız sınırı/beklenen/gerçek hız ayrımı, yaklaşık 15 dakikalık sürüş özetleri ve kullanıcı–sürüş profili–araç ilişkisi veri modelinde karşılanacak. Kişisel tüketim ortak referansla koşula ve veri kalitesine bağlı ağırlıkla birleştirilecek. [Ayrıntılı veri modeli ve görev sınırları](PERSONALIZED_ENERGY_DATA.md). Bu turda algoritma veya telemetri uygulaması başlatılmadı.

Haftalık scheduler CR-021, istasyon/hava/yol verisi CR-007–010, gerçek enerji ve şarj algoritmaları CR-011–013, mobil rota/harita sonraki görevlerdir. Bu görevde yeni Redis veya ORM önerilmiyor; mevcut pg repository/migration yaklaşımı korunacak.

## Mevcut durumdan çıkan teknik ihtiyaçlar

- `stableId(sourceKey, sourceVehicleId)` kaynak kimliğidir; kaynaklardan bağımsız uygulama kimliği değildir.
- `VehicleSnapshot.source` doğrudan `typeof OPEN_EV_SOURCE`, araç payload'ı da OpenEV tipine bağlıdır. Yeni kaynak bu tipe zorlanmamalı; kaynak adapter'ı ve ortak ingestion modeli ayrılmalı.
- `VehicleImportRepository.saveVehicle` kaynak alt kayıtlarını transaction içinde silip yeniden ekler. Bağımsız ek veriler bu sahiplik alanına yazılmamalı.
- Eski tüketim tablosu araç başına bir `unspecified` kayıt, eğri tablosu araç başına bir eğri saklar. Birden fazla referans/koşul/sürüm için ayrı yapı gerekir.
- Zod tüketim `basis=derived` değerini destekliyor; fakat türetme yöntemi/girdi sürümleri/belirsizlik yok. Eğriler ve kapasite için de açık kalite metadatası eksik. Yalnız yeni enum etiketi eklemek yeterli değil.
- `VehicleEnergyProvider.profile(id, signal)` veri kalitesi politikası almıyor. Seçilecek profilin politikayla tutarlı olması için port/coordinator sözleşmesi de güncellenmeli; üretim rota endpoint'i açılmayacak.

## Uygulama adımları ve önerilen ayrıntılar

### 6.1 — Kaynak ve pilot alan matrisi

İlk teslim kaynak raporudur: erişim/dağıtım koşulları, format, somut sürüm/checksum, güncellik ve iki pilottaki alan kapsamı. OpenEV mevcut sürümü sabitlenmiş temel kaynak kalır. Kontrol edilen `latest` bağlantısı hâlâ [v1.24.0](https://github.com/open-ev-data/open-ev-data-dataset/releases/tag/v1.24.0) sürümüne yönleniyor (2026-11-10); güncelleme tek başına pilot açığını çözecek varsayılmaz. Proje [README](https://github.com/open-ev-data/open-ev-data-dataset) ve [lisans](https://github.com/open-ev-data/open-ev-data-dataset/blob/main/LICENCE) kayıtları kaynak envanterinde korunur.

Pilotlar: 2023 Ioniq 6 RWD / 53 kWh paket / 18 inç ve 2025 Ioniq 5 RWD / 63 kWh paket / 19 inç. Model yılı, pazar, donanım ve lastik eşleşmesi alan alan doğrulanacak; güncel bir broşür tarihsel model yılı kanıtı sayılmayacak. 2025 Ioniq 5 63 kWh mevcut snapshot'ta yoktur. Ioniq 6 için kaynağın 50 kWh kullanılabilir kapasite iddiası henüz bağımsız doğrulanmış sayılmaz.

Üretici teknik belgeleri kimlik/özellik kanıtı; izinli açık veri ve belgeli ölçümler tüketim/eğri adaylarıdır. Site görünürlüğü otomatik veri dağıtım izni sayılmayacak. Yeni kaynağa adapte olmadan kapsam ve kullanım koşulları kaydedilecek; lisanssız toplu scraping veya ücretli API eklenmeyecek.

### 6.2 — Ortak ingestion ve kalite sözleşmeleri

Önerilen akış: `adapter → ham snapshot → doğrulama → normalize kaynak gerçekleri → eşleştirme → kalite raporu → yayınlama`.

Ham veri/sürüm ile seçilen değer ayrı kalır. Kaynak kimliği, kayıt kimliği, sürüm, yayın/alınma zamanı, checksum, erişim dayanağı ve orijinal birim korunur. Tüketim/şarj referansı birden fazla kaynak girdisine dayanabilir.

Mühendislik tahmini için yöntem kimliği/sürümü, girdi referansları, varsayımlar, uygulanabilir varyant/koşullar ve varsa dayanaklı alt/üst sınır zorunlu izlenebilirliktir. Belirsizlik bilinmiyorsa açıkça unknown kalır; keyfi güven yüzdesi atanmaz. Salt Wh/km → kWh/100 km birim dönüşümü mühendislik tahminiyle aynı sınıfa konmaz.

Önerilen kalite politikaları: `verified_only` ve `allow_engineering_estimates`. Politikalar sunucu kontrollü ve sürümlü olacak. Tahmini veri ikinci modda kullanılabilir; birinci modda kullanılmaz. Eksik eğri, tahmine izin verilmiş olması nedeniyle kendiliğinden var sayılmaz. Önce geçerli kapsamı ve yöntemi bulunan tahmini referans yayınlanmış olmalıdır. Gerçek verilerle tahminler aynı ölçüm gibi ortalanmaz; eşlenmiş alanlarda seçim politikası açıklanır.

Ortak şema/sözleşme sürümü bilinçli güncellenecek; CR-002/004/005 fixture'ları ve parser'ları birlikte taşınacak. Strict Zod şemasına sessizce yeni alan eklenmeyecek. Tahmin kullanan sonuçlara veri kalitesi/varsayım bilgisinin taşınması sağlanacak; mobilde gösterimi ilgili ekran işiyle bağlanacak.

### 6.3 — Yeni migration ve veri sahipliği

Mantıksal ayrım (fiziksel tablo isimleri uygulama sırasında netleştirilebilir):

| Katman | İçerik / kural |
|---|---|
| Ana araç konfigürasyonu | Kaynaktan bağımsız, özelliklerden yeniden üretilmeyen sabit opaque ID; yıl/pazar/aktarma/paket/jant-lastik kimliği |
| Kaynak kayıtları ve eşlemeler | `(source, externalRecordId)` benzersiz; kaynak geçmişi ve eşleşme durumu; eski katalog ID alias'ları |
| Kaynak gerçekleri / dayanaklar | Alan bazında değer, birim, kanıt, kalite ve kapsam; çelişkili adaylar kaybolmaz |
| Tüketim ve şarj referansları | Aynı varyant için birden fazla koşul/kaynak/sürüm; mühendislik referansları ayrı köken taşır |
| Hız ve koşul referans noktaları | Sabit hız/seyahat ortalaması ayrımı, sıcaklık/HVAC/mevsim/lastik bağlamı; tek koşulsuz tüketim sayısına indirgenmez |
| Kişisel veri sözleşmeleri ve DDL tasarımı | Sahip–sürüş profili–araç, sürüş pencereleri, enerji kanıtları ve ayrı şarj gözlemleri; migration sahiplik temeliyle birlikte uygulanır |
| Kişisel model/birleştirme revizyonları | Ortak ve kişisel eğri sürümleri, ağırlık politikası, veri kapsamı ve kalite; öğrenme algoritması sonraki görevlerde |
| Enerji profil revizyonları | Değişmez, şema doğrulanmış payload + profil/checksum/politika sürümü; published sürüm işaretçisi |
| Aktarım/kalite raporu | Eşleşmeyen/çelişen/eksik alanlar, kabul/karantina gerekçeleri, hangi kapsamın tam olduğu |

Filtrelenen kimlik alanları, FK'ler, unique kuralları ve yayın işaretçileri ilişkisel/indeksli tutulur. Değişken koşullar ve tam enerji profil payload'ı Zod doğrulanmış JSONB olabilir. Liste isteğinde büyük ham JSON veya bütün eğri noktaları taşınmaz; yayımlanmış okuma görünümü kullanılır. Böylece her istekte kaynak önceliklerini tekrar hesaplama veya N+1 sorgu gerekmez.

001/002 uygulanmış migration dosyaları değiştirilmez. Yeni migration mevcut ID'leri kaybetmeden başlangıç eşlemelerini kurar. Daha önce okunmuş/cihazda saklanmış ID'ler çözülmeye devam eder. Kaynak import'u kendi kayıtlarının dışındaki veriyi silemez; kaynaktan kalkma ana araç veya diğer kaynakların doğrulanmış verisini doğrudan silmez.

### 6.4 — Pilot eşleştirmesi ve çelişki politikası

İsim + yakın batarya değeri otomatik birleştirme için yeterli değildir. Yıl, pazar, aktarma, paket, jant/lastik ve donanım kapsamı kontrol edilir. Eksik özellik bir wildcard gibi kabul edilmez. OpenEV'deki alanı belirsiz kaydın exact pilot varyantıyla eşleşmesi kanıtlanamıyorsa aday olarak kalır.

Kaynak önceliği alan ve ölçüm bağlamına bağlıdır: üretici paket beyanı ile ölçülen kullanılabilir kapasite birbirinin rakibi değildir. Çelişki aynı anlam/kapsamdaki değerler arasında aranır; keyfi ortalama veya son gelen kazanır kuralı kullanılmaz. Gerekçeli seçim sürümlenir; çözülemeyen kritik alan yayınlanmaz.

Farklı kaynakların marka/model kayıtları mobil listede çoğaltılmayacak. Ana katalog görünümü mevcut marka → model → varyant API biçimini koruyacak; ID geçişi alias üzerinden yapılacak.

### 6.5 — Tüketim/şarj veri paketi ve mühendislik tahminleri

Kapasite etiketi, brüt kapasite ve kullanılabilir enerji ayrı tutulur. Brüt değer kullanılabilir alana kopyalanmaz. Kullanılabilir kapasite tahmin edilecekse bu ayrı, yöntemli ve etiketli tahmindir.

Tüketimde hızın anlamı, sıcaklık, HVAC, lastik/yük, test döngüsü ve AC/DC ölçüm sınırı korunur. WLTP birleşik değer sabit otoyol tüketimi sayılmaz. Kullanıcının hız ortalamaları başlangıç gözlemidir; evrensel hız eğrisi değildir. Fiziksel katsayı/model kalibrasyonu CR-011 işidir.

Şarjda SOC kapsamı, güç/akım/voltaj, şarj yolu, batarya sıcaklığı/ön koşullandırma ve enerji sınırı tutulur. Gözlenen istasyon oturumu araç kabul limiti sayılmaz. Tek %10–80 süresi tekil bir eğriyi belirlemez. Tahmini eğri kullanılacaksa ek dayanaklar ve varsayımlar ayrı profil olarak açıkça kaydedilir; gerçek eğri diye işaretlenmez. Aynı E-GMP/800 V etiketi Ioniq 5/6 eğrilerinin aynı olduğu anlamına gelmez. Sıcak/soğuk eğri seçimi ve termal simülasyon CR-012'de uygulanacak.

Gerçek referans yoksa yalnız belgeli bir yöntemle tahmini referans eklenir; yöntem dayanağı da yoksa alan eksik kalır. Pilot için tüm alanların kesin bulunacağı peşinen vaat edilmez.

### 6.6 — Atomik yayınlama ve DB okuma

İndirme/parse/eşleştirme dış I/O'su yayın transaction'ı dışında yapılacak. Boyut, süre ve eşzamanlılık sınırlanacak. Staging kayıtları batch yazılabilir; okuma görünümüne yarım katalog açılmayacak. Yayın transaction'ı seçilmiş görünüm/sürüm işaretçisini atomik ilerletecek; kaynak bazında advisory lock ve eski sürümden geri gitmeme kontrolü korunacak. Çok sayıda sorguyu tek client'ta `Promise.all` yapmak performans çözümü sayılmayacak.

İçerik checksum'u ve kaynak kapsamı tekrar import'ta idempotency sağlayacak. Tam snapshot ile kısmi ek paket ayrılacak; kısmi paket eski kayıtları topluca pasifleştirmeyecek. Yanlış yayın yeni bir yayın seçimiyle geri alınabilir; önceki profil byte'ları değiştirilmez. Normal refresh eski snapshot'ın üzerine geri yazmaz.

`VehicleEnergyProvider` DB'den yayınlanmış, istenen kalite politikasına uygun profil okur. Geçerli profil yoksa null/eksik veri sonucu verir; HTTP fetch veya uydurma fallback yoktur. Profil/sözleşme verisinin bulunması tek başına gerçek rota doğruluğu garantisi değildir.

### 6.7 — Doğrulama ve teslim

- Temiz DB ve mevcut katalog üzerine migration/backfill; eski ID ile erişim ve mobil seçim regresyonu.
- Aynı snapshot'ın tekrarında mükerrer yok; eşzamanlı import, eski sürüm ve tam/kısmi kapsam davranışı.
- OpenEV yenilemesinde ek kaynak/tahmin verisinin korunması; belirsiz eşleşmelerin birleşmemesi.
- Birden fazla koşullu tüketim/eğri; ölçüm/tahmin, AC/DC ve kapasite sınırlarının korunması; politika ihlallerinin reddi.
- Hatalı paket/rollback'te önceki yayın okunabilir; yayın sürümü değişse de eski profil revizyonu erişilebilir.
- DB okuma sırasında dış HTTP çağrısı olmadığının testi; okumayla eşzamanlı staging/yayın senaryosu.
- Aynı makine/veri büyüklüğünde katalog ve profil sorgusu p95/p99 baseline karşılaştırması; örnek/eşzamanlılık/hata oranı raporu. CR-005 mikrobenchmark'ı DB performans kanıtı olarak kullanılmaz. Üretim SLA'sı burada varsayılmaz.
- İki pilot için alan/kaynak/kalite/kapsam raporu; bulunan gerçek ve tahmini referanslar ayrı listelenir. Eksikler CR-006 kabulünden gizlenmez.
- Farklı hız/koşul referanslarının birlikte korunması; GPS hızından ölçülmüş enerji uydurulmaması; kişisel profil/araç ayrımı ve sürümlü birleştirme metadatası sözleşmeleri. [Ek kabul senaryoları](PERSONALIZED_ENERGY_DATA.md).

## Sonraki prompt için uygulama sırası

`6.1 kaynak matrisi → 6.2 sözleşmeler → 6.3 migration/backfill → 6.4 kimlik eşleştirme → 6.5 veri paketleri → 6.6 DB yayınlama/provider/API → 6.7 entegrasyon ve ölçüm`.

Sonraki promptta bu plana göre CR-006 uygulanabilir. Bu turda adapter yazımı, DB değişikliği, veri import'u veya scheduler başlatılmadı. Somut mühendislik katsayıları/şarj eğrileri ve saha hata eşikleri bu hazırlık kararıyla seçilmiş değildir. Veri altyapısının tamamlanması, gerçek referansların ve doğrulama kabulünün eksik olduğu durumda CR-006'nın tamamını DONE yapmaz; kabul açıkları raporlanır.
