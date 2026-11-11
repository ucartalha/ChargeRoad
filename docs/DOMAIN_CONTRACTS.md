# CR-002: Ortak rota ve enerji sözleşmeleri

Tarih: 2026-11-10. Sözleşme sürümü: 1.0.0.

Bu teslim TypeScript modellerini, çalışma zamanı doğrulamalarını ve örnek mesajları tanımlar. Gerçek tüketim/termal model, rota bölme algoritması, şarj süresi integratörü veya optimizasyon motoru bu görevde uygulanmadı. Doğrulanan bir mesajın yapısal tutarlılığı, gerçek dünyada kalibre edilmiş bir tahmin olduğu anlamına gelmez.

## Kod ve doğrulama

| Dosya | Kapsam |
|---|---|
| [common.ts](../packages/shared/src/contracts/common.ts) | Birimler, koordinat, zaman, kaynak ve gözlem türleri |
| [vehicle-energy.ts](../packages/shared/src/contracts/vehicle-energy.ts) | Tüketim referansları, voltaj, şarj yolları ve koşullu eğriler |
| [road-weather.ts](../packages/shared/src/contracts/road-weather.ts) | Yol kesimleri, bölme politikası ve geçiş zamanına bağlı hava |
| [stations.ts](../packages/shared/src/contracts/stations.ts) | İstasyon → EVSE → connector, güç paylaşımı ve erişim |
| [request.ts](../packages/shared/src/contracts/request.ts) | Plan isteği, açık kısıtlar ve kullanıcı şarj düzeltmesi |
| [charging-stop.ts](../packages/shared/src/contracts/charging-stop.ts) | Durak, alınan/depolanan enerji ve süreler |
| [planning.ts](../packages/shared/src/contracts/planning.ts) | Plan girdisi/sonucu, enerji profili ve hata durumları |
| [evaluation.ts](../packages/shared/src/contracts/evaluation.ts) | Girdi–sonuç referansları, hava zamanı ve SOC/zaman sürekliliği |

Zod şemaları tek tanımdır; TypeScript tipleri bu şemalardan türetilir. strict nesneler bilinmeyen alanları sessizce kabul etmez. Eksik bilgi sıfırla doldurulmaz; ilgili alan null veya origin=unknown olur.

Örnekler: [planning.mjs](../packages/shared/examples/planning.mjs). Bütün sayılar sentetiktir; gerçek araç verisi veya kabul edilmiş ürün varsayılanı değildir.

## Birimler ve zaman

| Nicelik | Birim / anlam |
|---|---|
| Tüketim | kWh/100 km |
| Enerji | kWh; segment net batarya tüketimi rejenerasyonda negatif olabilir |
| Mesafe | metre; rota başlangıcından kümülatif offset |
| Süre | saniye |
| Güç / akım / voltaj | kW / A / V |
| SOC ve SOH | 0–100 yüzde; SOH sıfır olamaz |
| Sıcaklık | °C; ortam ve batarya ayrı alanlar |
| Hız / rüzgâr | km/h; fiziksel modelde SI dönüşümü ayrıca yapılacak |
| Rüzgâr yönü | Rüzgârın geldiği yön; gerçek kuzeyden saat yönünde [0,360) |
| Yağış olasılığı | 0–100 yüzde |
| Zaman | ISO 8601; Z veya açık UTC offset zorunlu |

measured ve user_input gözlemleri observedAt taşır. estimated değerler estimatedAt, validAt ve modelVersion taşır; validAt bilinmiyorsa açıkça null olur. Böylece hesaplamanın üretildiği anla tahminin geçerli olduğu an karıştırılmaz.

## 1. Ortalama tüketim referansları

Araç başına tek ve koşulsuz bir tüketim sayısı kullanılmayacak. ConsumptionReference her kaydın şu bilgilerini taşır:

- Araç varyantı, referans kimliği/sürümü ve kaynak.
- Bildirilen/ölçülen/türetilen ayrımı.
- battery_dc, ac_grid veya unknown enerji sınırı.
- WLTP/EPA gibi test döngüsü veya constant_speed/real_world.
- Şehir/otoyol/karma sürüş profili.
- Hız, ortam/batarya sıcaklığı, yük, lastik ve mevcut diğer ölçüm koşulları.
- Klima, batarya termal yönetimi, eğim, rüzgâr ve şarj kayıplarının referansta dahil/haric/bilinmiyor olması.

Planlanan seçim yöntemi: Koşula ve varyanta uyan referansı seç → batarya enerji sınırını doğrula → yalnızca referans koşuluna göre değişen etkileri kalibre edilmiş modelle düzelt. Hız/sıcaklık aralıkları dışına gelişigüzel katsayı uygulanmayacak.

AC-priz referansı batarya tüketimi olarak doğrudan kullanılamaz. Açık ve kaynaklı bir gridToBatteryEfficiency varsa dönüşüm tanımlanabilir. EPA etiket değerlerinin şarj kayıplarını içermesi bu ayrımın pratik gerekçelerinden biridir. [EPA açıklaması](https://www.epa.gov/greenvehicles/fuel-economy-and-ev-range-testing)

İlerideki enerji motorunun iki yolu olabilir:

1. Referans tüketim + koşula göre fark düzeltmeleri.
2. Yeterli veri varsa araç kütlesi, hava direnci, yuvarlanma, eğim, hız değişimi, aktarma ve rejenerasyon modelinden hesap.

İkisi körlemesine toplanmaz. Örneğin referans HVAC içeriyorsa ayrıca bütün klima tüketimini eklemek yanlış olur. Toplam batarya enerjisinin bileşenlere ayrımı bilinmiyorsa breakdown=null kalır.

Güncel katalogda tüketim referansı ve gerçek şarj eğrisi yok. Katalogdaki menzilden bu değerler üretilmedi. VehicleCatalogueEntry ile VehicleEnergyProfile ayrı modellerdir; katalog kaydı otomatik olarak planlamaya hazır sayılmaz.

## 2. Rota kesimleri ve hava

Segmentler sabit mesafeli parçalara indirgenmeyecek. Uygulanacak algoritma yol sağlayıcısının kenar/geometri verisini koruyarak şu noktalarda bölmeli:

- Yol sınıfı, tahmini hız ve hız limiti değişimleri.
- Yön ve eğim değişimleri.
- Şarj istasyonu yol erişimi ve sapma bağlantıları.
- Politikanın açık maksimum mesafe/süre sınırları.
- Hava örneklemesinin zaman/konum çözünürlüğü.

Bölme eşikleri SegmentationPolicy içinde kimlik ve sürümle taşınır; bu teslim herhangi bir 500 m / 1 km varsayılanını kabul etmez. Örnekteki 1 km yalnızca test değeridir.

RoadSegment; rota offset'leri, gerçek yol mesafesi, sürüş süresi, geometri, beklenen hız, yol sınıfı, yön, yükseklik profili ve ayrı toplam yükseliş/iniş taşır. Gidiş-dönüş eğimli bir kesimin başlangıç/bitiş yüksekliği aynı diye yükselişi sıfırlanmaz.

Doğrulamalar:

- Segment offset'leri ve geometri uçları birbirine bağlanır.
- Mesafeler ve süreler rota toplamına uyar.
- Beklenen ortalama hız mesafe/süreyle tutarlıdır; hız limiti gerçek hız yerine atanmaz.
- Yükseklik örnekleri varsa ayrı yükseliş ve iniş toplamları korunur.
- Şarj durakları segment sınırında bulunur.
- İstasyon sapması sürüş rotasının içindedir; detour alanları raporlama alt kümesidir, toplam süreye ikinci kez eklenmez.

Ortalama hız tek başına dur-kalk dinamiği değildir. Ayrıntılı hız/ivme verisi olmayan bir şehir kesiminde uydurma fiziksel hız profili oluşturulmayacak; uygun sürüş döngüsü referansı ve kalibrasyon gerekecek.

WeatherQuery her segment için konum ve validAt taşır. Şarj durağı sonraki segmentin zamanını değiştirirse hava yeniden örneklenir. Yağış olasılığı, gerçek yağış miktarı ve kar derinliği farklı alanlardır. Rüzgâr yol yönüyle birlikte değerlendirilir. Ortam sıcaklığı doğrudan batarya sıcaklığına kopyalanmaz.

CR-010 güncellemesi: `forecastIssuedAt` gerçek üretim zamanı bilinmiyorsa null; kaynak veri güncellemesi `sourceUpdatedAt`, indirme `fetchedAt`, 304 dahil doğrulama metadata'da ayrı tutulur. Query başına durum, kullanılan örnek konumu/kotu, interpolasyon aralığı, yağış periyodu ve basınç türü taşınır. Eksik temel hava veya kaynak zamanı güvenilir enerji planını desteklemez; indirme zamanı tazelik yerine geçmez. [Hava teslimi ve 72 saat politikası](WEATHER_PROVIDERS.md).

## 3. Şarj eğrisi, voltaj ve donanım

DcChargingCurve tek bir araç-genel maksimum güç sayısı değildir. Varyant ve chargingPathId ile eşleşen, kaynaklı/sürümlü bir eğridir.

| Alan | Anlam |
|---|---|
| curve.representation | power_by_soc veya current_by_soc |
| powerBoundary | vehicle_inlet, pack_terminal veya battery_stored |
| points | Artan SOC; güç veya akım + gerçek voltaj; varsa nokta batarya sıcaklığı |
| conditions | Batarya/ortam sıcaklığı, SOH, ön koşullandırma, deney istasyonu sınırları |
| semantics | Araç kabul sınırı veya belirli istasyonda gözlenen seans |
| interpolation | Şimdilik açık linear sözleşmesi |
| extrapolation | forbidden; kapsanmayan SOC aralığı uydurulmaz |

Akım eğrisinde voltaj zorunludur. P(kW)=V×I/1000 yalnızca aynı elektriksel sınırdaki akım ve voltaj için kullanılır; bu net depolanan enerji gücü değildir.

400 V / 800 V bir mimari etiketidir. Hesap için ayrıca nominal ve SOC'ye bağlı gerçek voltaj, EVSE çıkış aralığı, akım sınırı ve araç giriş yolu gerekir. Açık devre voltajı, yük altındaki şarj giriş voltajı yerine geçirilmez.

DcChargingPath üç durumu ayırır:

- native_pack: Doğrudan uygun yüksek voltajlı giriş.
- boost_converter: Örneğin daha düşük voltajlı kaynaktan yükseltme; dönüştürücünün güç/akım/verim sınırı ayrı.
- pack_reconfiguration: Destekleyen aracın farklı elektriksel paket bağlantısı.

Bunlar araçta varmış gibi varsayılmaz; üretici/test kaynağı gerektirir. Bir yol için elde edilen eğri başka bir şarj yoluna otomatik taşınmaz. Düşük voltaj desteğinin araç/donanıma bağlı olması üretici bilgilerinde de görülür. [Porsche şarj açıklaması](https://ask.porsche.com/gb/en-GB/charging-capacity-taycan/)

Planlanan DC güç hesabı:

    giriş sınırı = min(istasyonun mevcut güç sınırı,
                       gerçek giriş voltajı × izin verilen akım / 1000,
                       araç giriş/dönüştürücü sınırı,
                       koşullara uygun araç kabul sınırı)

Bu yalnızca hesap akışıdır; bu görevde sayısal güç integratörü yazılmadı. Voltajla değişen güç zarfı, istasyonun ortak güç havuzu ve BMS/termal sınırlar dikkate alınacak. Dönüştürücü varsa giriş tarafıyla paket tarafı aynı güç kabul edilmeyecek.

Örnek aritmetik: Aynı 500 A sınırında 400 V → 200 kW, 800 V → 400 kW elektriksel üst sınır verir. Bunlar aracın alacağı güç değildir; 150 kW istasyon veya daha düşük BMS/dönüştürücü sınırı sonucu düşürür. Gerçek voltaj SOC ile değişebilir.

## 4. Dış etkenler ve şarj süresi

İlk batarya sıcaklığı ölçüm, kullanıcı bilgisi, model tahmini veya unknown olabilir. Ortam soğuk diye batarya sıcaklığı kesin olarak aynı kabul edilmez.

- Yük ve kabin hedef sıcaklığı kullanıcı/ölçüm/tahmin olarak ayrı tutulur.
- HVAC modu, lastik kurulumu ve ön koşullandırma isteği açıkça belirtilir.
- Isı pompası ve ön koşullandırma desteği araç profilinde present/supported veya unknown olabilir.
- Seyir süresi, kullanım geçmişi, dış sıcaklık, soğutma/ısıtma ve ön koşullandırma gelecekteki termal modele girdi olur.
- Sıcak eğrinin şartları sağlanmıyorsa koşullu bir termal model gerekir; sırf bir model sürümü yazılması onun doğrulanmış olduğunu kanıtlamaz.
- Ön koşullandırma seyir sırasında enerji tüketiyorsa segmentte, durakta ek bekleme yaratıyorsa blockingPreconditioningSeconds içinde ele alınır. Şarjla eşzamanlı termal tüketim ikinci kez süre olarak eklenmez.
- Batarya SOH ve referans kapasitenin hangi SOH'da verildiği ayrı tutulur; kapasite iki kez azaltılmaz.
- Kabin/batarya termal yönetimi ve şarj performansı arasındaki ilişki üretici servis bilgisinde de açıkça yer alır. [BMW teknik açıklaması](https://static.nhtsa.gov/odi/tsbs/2024/MC-10252039-0001.pdf)

Gelecekteki süre integratörü SOC boyunca küçük aralıklarda etkin net depolama gücünü kullanacak:

    şarj süresi = integral(dE_depolanan / P_net_depolama)

Sabit maksimum kW ile bütün bataryayı bölmek kullanılmayacak. İnlet/paket/net-depolama sınırları arasında kayıplar ve termal yardımcı enerji uygun tarafta hesaba katılacak; net depolama eğrisi bu kayıpları zaten içeriyorsa tekrar düşülmeyecek.

## 5. İstasyon ve durak modeli

ChargingStation → EVSE → Connector yapısı kullanılır. Bir EVSE'de alternatif iki soket, iki bağımsız eşzamanlı araç kapasitesi sayılmaz. AC/DC özellikleri ayrı şemalarla tanımlı; DC eğrisi AC şarj hesabına uygulanmaz. AC süresi için ayrı araç/onboard charger modeli sonraki hesaplama işi kapsamında geliştirilecek.

İstasyon; erişim, çalışma saatleri/saat dilimi/istisna günleri ve ortak güç havuzlarını taşır. Unknown güç veya unknown erişim sıfır/uygun olarak yorumlanmaz.

PlannedChargingStop şu bilgileri taşır:

- İstasyon/EVSE/soket ve kullanılan araç şarj yolu.
- Rota üzerindeki mesafe ve dahil edilmiş yol sapmasının rapor alanları.
- Varış ve hedef SOC.
- İnletten alınan, bataryada depolanan, yardımcı sistemlerde kullanılan ve kaybedilen enerji.
- Kullanılan eğrinin kimlik/sürümü ve gerçek SOC kapsamı.
- Varış/ayrılış batarya sıcaklığı tahminleri ve termal model sürümü.
- Ayrı sürüş, bağlantı, bloke eden ön koşullandırma, bekleme ve şarj süreleri.
- Kaynaktaki durum, gözlem/alınma/değerlendirme zamanı ve politikaya göre etkin durum.

Eski veya tarihi bilinmeyen müsaitlik unknown olmalı. Güncel müsaitlik varış anı garantisi değildir. Bilinmeyen bekleme süresi null olarak kalır; kesin toplam/ETA üretmez. Politika varsayımıyla süre kullanılırsa gerekçesi planda bulunur. Varmış olduktan sonra hedefte şarj ederek varış SOC kısıtı sağlandı kabul edilmez.

## 6. Yeniden planlama, sonuçlar ve sınırlar

ChargeCorrection; eventId, sequence, görülen plan kimliği/sürümü, mutlak kullanıcı SOC'si, olay/alınma zamanı ve konum doğruluğunu taşır. Şarj sonrası olay ilgili durak kimliğine bağlanır. Düşük/yüksek kullanıcı girdisi delta olarak önceki tahmine eklenmez; yeni enerji başlangıcıdır.

Plan; requestId, planId/revision, önceki plan bağlantısı, araç/algoritma/politika sürümleri ve veri snapshot checksum'larını içerir. Girdi ile sonuç birlikte doğrulanınca:

- Donanım, eğri, tüketim ve hava referanslarının varlığı/uyumu.
- Kaynak snapshot'ları ve politika eşleşmesi.
- Sürüş–şarj arasında SOC ve zaman sürekliliği.
- Segment rezervi ve varış şarjı.
- Şarj gecikmelerinden sonraki hava zamanı.
- Enerji ve süre bileşenlerinin dengesi kontrol edilir.

planningResultSchema şu durumları ayırır: planned, infeasible, insufficient_data, provider_error, computation_limit. Eksik tüketim/eğri, rota yok anlamına gelmez; veri yetersizliği olarak raporlanır.

Henüz uygulanmayanlar: Olayların DB'de idempotent işlenmesi, yeniden planlama servisi, model registry/kalibrasyon, gerçek güç–SOC integrasyonu, voltaj eğrisi değerlendirme, adaptif bölme algoritması, uygun eğrinin otomatik seçimi ve LLM'siz optimizasyon. Bunlar CR-009/011/012/013/017/018 kapsamındadır. Şema doğrulaması bu algoritmaların yerine geçmez.

## Derleme ve test

Ortak paket hem ESM hem CommonJS çıktısı üretir. API için CommonJS, Expo için ESM ve her ikisi için tip bildirimleri vardır. Build öncesinde kaynaktan doğrudan runtime import yapılmaz.

~~~sh
pnpm --filter @chargeroad/shared build
pnpm --filter @chargeroad/shared test
pnpm typecheck
~~~

Root dev/typecheck görevleri önce bağımlı shared build'ini çalıştırır. Shared kaynakları değiştirilince build tekrar çalıştırılmalı; bu teslimde shared watch servisi eklenmedi.

33 senaryo; geçerli mesajlar, enerji sınırı dönüşümü, eğri kapsamı, voltaj yolu, soğuk batarya, yük, shared power, eski müsaitlik, şarj sonrası hava, bilinmeyen bekleme, süre/SOC sürekliliği ve sürüm hatalarını sınar. CR-010 ile bilinmeyen model zamanı/kaynak güncellemesi ve yeni indirmeyle eski/eksik havanın gizlenmemesi eklenmiştir. Örneklerin başarısı gerçek araç tüketim doğruluğunu ölçmez; saha/kalibrasyon testleri ayrıca yapılacaktır.

Rezerv yüzdeleri, bölme eşikleri, güvenilir kaynaklar, model katsayıları, sağlayıcı ve optimizasyon yöntemi bu teslimle kesinleştirilmedi. Örnek dosyadaki sayılar test fixture'ıdır.
