# Hyundai başlangıç profilleri ve harita odaklı mobil düzen

Tarih: 2026-11-12. Kullanıcının Task 15 sonrası geri bildirimi uygulandı: harita ilk ekran, alttan kaydırılabilir rota paneli, ihtiyaç anında araç seçimi, SOC kaydırıcıları ve önce Hyundai kataloğunun yaklaşık hesap profilleriyle kapsanması.

## Veritabanı kapsamı

Mevcut **26 kanonik Hyundai varyantı** korunarak ek kaynak yayını yapıldı: 9 Ioniq 5, 10 Ioniq 6, 1 Ioniq 9, 6 Kona Electric. Eski ID eşlemeleri değişmedi; yeni mükerrer araç oluşturulmadı. Kullanıcının tüketim/yolculuk gözlemleri ayrı kaynaklarında korundu.

`hyundai-engineering/1.0.2` profil sürümünde 26 enerji + şarj modeli, **546 türetilmiş hız/sıcaklık referansı** ve **78 yaklaşık şarj eğrisi** bulunur. Referanslar 30/50/70/90/110/130/150 km/h ve 0/20/35°C senaryolarıdır. Şarj eğrileri soğuk/serin/ılık batarya bantları içindir. Sayılar 546 bağımsız internet testi veya 78 ölçülmüş oturum anlamına gelmez. Her varyant için bağımsız ölçülmüş sabit hız/termal şarj verisi bulunamadı; eksikler açıkça **engineering_estimate** olarak türetildi ve verified profili yayımlanmadı.

Yayın denetimi: İlk 1.0.0 revizyonu kWh/100 km ↔ yol kuvveti dönüşüm kontrolünde düzeltilerek 1.0.1 ile değiştirildi; 1.0.2 sıcaklık bantlarındaki küçük aralık boşluklarını ve birim yazımını düzeltti. Aktif yayın yalnız 1.0.2'dir; eski immutable revizyonlar denetim geçmişidir, güncel hesap profili değildir. Birim, makul değer aralığı ve sıcaklık sınırı kontrolleri regresyon testlerine eklendi.

Kaynaklar:

- [Open EV Data — Kilowatt](https://github.com/KilowattApp/open-ev-data): commit'e sabitlenmiş, MIT with Attribution Requirement. Kullanılan ham alt küme ve tam lisans [veri dizininde](../data/vehicle-knowledge/hyundai/licensed-inputs.json) / [lisans](../data/vehicle-knowledge/hyundai/LICENSE-kilowatt.txt). Kaynak DC gücü bazı satırlarda batarya kapasitesine eşit görünüyordu; bu şüpheli güç/eğriler doğrudan kullanılmadı.
- [OpenEV Data](https://github.com/open-ev-data/open-ev-data-dataset): mevcut CDLA-Permissive-2.0 katalog kapasite/menzil/varyant bilgileri. Katalogda bilinen kapasite korundu; kapasitesi eksik pilot Ioniq 6 için aynı 53 kWh ailesindeki 50 kWh referansı, Ioniq 5 63 kWh için açık %95 kullanılabilir oranı tahmini kullanıldı.
- Üretici çapraz kontrolleri: [Ioniq 6 53/77,4 kWh teknik sayfası](https://www.hyundai.com/content/dam/hyundai/au/en/models/ioniq6/IONIQ6_Specifications_MY24.pdf), [Ioniq 5 63 kWh/170 hp teknik dokümanı](https://dmassets.hyundai.com/is/content/hyundaiautoever/Hyundai_IONIQ-5_Brochure-EN_20251021pdf), [Ioniq 9 teknik bilgileri](https://www.hyundai.com/eu/en/models/ioniq-9/technical-data-downloads.html), [Kona 39,2/64 kWh açıklaması](https://www.hyundai.news/uk/articles/press-releases/hyundai-announces-new-kona-electric-prices-and-specifications.html). Bunlar açık lisanslı veri paketi veya bağımsız sürüş testi gibi yeniden yayımlanmadı; kaynak/uyuşmazlık araştırmasında kullanıldı.

Karma tüketim ortalamasının test hızı ve enerji sınırı her kaynakta belli değildir. Bu yüzden hız eğrileri kaynak ortalamasının 90 km/h temsilî ankraj sayıldığı, açık kütle/CdA/verim/yuvarlanma varsayımlarıyla oluşturulan fizik modelidir. Şarj şekli, voltaj/SOC, kayıp ve soğukta güç düşüşü yaklaşık modeldir. Ioniq 9 tüketim ankrajı kendi katalog kapasite/menzil oranı ve 1,25 kullanım katsayısından türetildi; Ioniq 5'in tüketimi doğrudan atanmadı. Kaynak, eşleme, türetim, varsayım ve kapsam her kayıtta saklanır. Sayısal güven aralığı veya saha doğruluğu iddiası yoktur.

Paket: [engineering-v1.json](../data/vehicle-knowledge/hyundai/engineering-v1.json). [Varyant bazlı kapsam raporu](validation/hyundai-profile-coverage.json).

## Motor ve HTTP davranışı

- Kullanıcı yaklaşık hesaplamaya açıkça onay verir; strict politika ve `verified_only` ayrımı korunur. Mobilde Hyundai için ilk hesap öncesi **Onayla ve planla** açıklaması gösterilir; sessiz kalite gevşetme yapılmaz.
- Yaklaşık profilde bilinmeyen SOH %95, ek yük 100 kg ve klima 1 kW varsayılır. İlk batarya sıcaklığı, yalnız profil bunu açıkça izinliyorsa rota hava verisinden dış hava dengesi tahmini olarak başlatılır. Kullanıcı gözlemi yerine yazılmaz; estimated kaydı ve varsayım/uyarı taşır. Sıcak batarya veya tamamlanmış ön koşullandırma uydurulmaz.
- Enerji algoritması `chargeroad-energy/1.3.0`. Mevcut kullanıcı gözlemlerine veya bağımsız XLSX'lere katsayı fit edilmedi. Kişisel/genel öğrenme için mevcut ayrım korunur.
- Canlı doğrulamada MET'in geçerli model güncellemesi yaklaşık 3 saat eski olduğu halde Task 14'ün 1 saatlik sınırı hesabı durduruyordu. HTTP politika sürümü `public-planning/1.0.1`, mevcut hava ve enerji katmanının **12 saat kaynak yaşı** sınırını kullanır. Tahmin ufku/72 saat, temel alanlar ve gerçek kaynak zamanı kontrolleri kaldırılmadı. 3 saat kabul / 13 saat ret regresyonu vardır.
- Uzun rotada her geometri köşesinin ayrı enerji kesimi olması gereksiz sınır aşımı oluşturuyordu. Uyumlu aralıklar hız/yön/eğim/yol sınıfı ve kaynak sınırları korunarak birleştirilir; mesafe, süre ve yükseklik profili korunur. Şarj erişim sınırları geçilmez. Geometri 1 m toleransla sadeleştirilir, gerçek enerji/politika sınırları yükseltilmez. Harita önizlemesine ayrıca gerçek yol geometrisi eklenir; başlangıç/varış arasında sahte düz çizgi çizilmez.

Araç profili eksikliği Hyundai'de giderildi. Bu, hava servisi kesintisi, doğrulanmamış fiziksel EVSE/voltaj/akım, kaynak kotası veya gerçekten karşılanmayan SOC koşullarının gizlenmesi anlamına gelmez. Bu durumlar hâlâ dürüst sonuç ve uygun yol önizlemesi gerektirir.

## Yeni mobil akış

- Açılışta tam ekran gerçek harita; küçük ChargeRoad başlığı ve profil düğmesi. Açılışta araç seçme zorunluluğu yoktur.
- Harita üzerindeki istasyonlar mevcut DB viewport API'sinden gelir. Sınırlı alan/en fazla 50 kayıt, 900 ms bekleme ve iptal kullanılır. Uzak görünümde yakınlaştırma istenir; ülke kataloğu telefona indirilmez. Canlı durum bilinmiyor etiketi vardır.
- İki konumlu alt panel: **Nereye gidiyoruz?** görünümü ve yukarı sürüklenerek açılan rota ayarları. Sürükleme tutamaçta çalışır; içerideki adres sonuçları, ScrollView ve slider hareketleriyle yarışmaz.
- Profilde cihazdaki araç seçilir/değiştirilir. Araçsız **Planla** eylemi mevcut marka → model → varyant bileşenini açar. Seçimden sonra rota alanları korunur. Hesap sistemi/garaj/geçmiş bu düzenlemeyle varmış gibi gösterilmez.
- Başlangıç SOC, minimum rezerv ve hedef varış SOC dokunup sürüklenen yüzdelik barlardır. Eski alan anahtarları, doğrulama, ayrı rezerv/varış anlamı ve zorunlu açık seçim korunur.
- Zaman/yol tercihleri ikincil açılır bölümdedir. Plan, SOC ve şarj özeti sade gösterilir; varsayımlar ayrıntı açılınca okunur. Algoritma ID'leri ana ürün ekranından çıkarıldı; API'de korunur.
- Mevcut `useActiveVehicle`, `VehiclesScreen.onSelect`, adres API'si, public plan DTO'su, iptal/generation, Retry-After ve yol önizleme bağlantıları korunur. Mevcut erişilebilirlik alan adları korundu; `planning-map`, `route-bottom-sheet`, `plan-route-button` ve SOC slider test ID'leri eklendi.

Harita `react-native-maps`, barlar Expo Go ile uyumlu community slider kullanır. [Expo dokümanı](https://docs.expo.dev/versions/latest/sdk/map-view/) Expo Go'da ek native kurulum gerektirmediğini belirtir; mağaza binary'si için Google Maps yapılandırması ayrıca gerekir. Yol/enerji hesabı bu harita SDK'sına taşınmadı, LLM eklenmedi.

## Doğrulama

[Gerçek DB/HTTP kanıtı](validation/hyundai-live-planning.json): 26/26 enerji ve şarj profili okunuyor. Ioniq 6 ile gerçek Ankara 3.845 m rota, %95 başlangıçtan yaklaşık **%93,33 varış SOC** sonucu üretti; durum **planned**, HTTP 200. Gerçek yol/hava verileri ve yaklaşık model kullanıldı. Bu kısa şarjsız örnek bağımsız doğruluk veya uzun şarj rotası saha kabulü değildir.

Her varyant için enerji ve soğuk/ılık şarj testleri, kanonik eşlemede mükerrer/çelişki testleri, boyut/birim ve hız eğrisi kontrolleri, yoğun geometri ve kaynak/şarj sınırı regresyonları vardır. Shared/mobile testleri ve API/mobil TypeScript kontrolleri, Android/iOS Metro export ayrıca çalıştırılır. Gerçek telefon üzerinde dokunma/harita görünümü ve sürüş doğruluğu kabulü açık kalır.

Son kontrol: **540 API/DB testi, 41 shared sözleşme testi ve 11 mobil akış testi geçti; atlanan yok.** Üç paket tip kontrolü, API derlemesi ve Android/iOS export başarılı. Expo Go ve API yeni sürümle yeniden başlatıldı; fiziksel telefonda görsel kabul yapılmış sayılmaz.

Komutlar (API paketi): `vehicles:research-hyundai` araştırma girdilerini indirir; `vehicles:publish-hyundai` kaynakları/kimlikleri doğrulayıp atomik yayım yapar; `vehicles:validate-hyundai` gerçek DB ve kısa HTTP akışını doğrular. Araştırma/yayım manuel işlemlerdir; haftalık otomatik job değildir.
