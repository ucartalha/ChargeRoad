# Ürün kapsamı ve kullanıcı akışları

Durum: Ürün hedefi üzerinde uzlaşıldı; mimari seçimler açık.

## Amaç

Elektrikli araçlar için araç özelliklerini, hava durumunu ve şarj istasyonlarının durumunu dikkate alan bir mobil rota ve şarj planlayıcı geliştirmek. Navigasyon sırasında batarya seviyesini tahmin etmek ve yeni bilgi geldiğinde kalan planı güncellemek.

## Kesin gereksinimler

- Rota ve şarj kararları herhangi bir LLM'e bağlı olmayacak; kendi algoritmalarımızla hesaplanacak.
- Harita/yol, hava durumu ve istasyon verileri sağlayıcılardan alınabilir. Enerji hesabı ve durak seçimi bize ait olacak.
- Araç modelleri, varyantları ve tüketim verileri uygun açık veri kaynaklarından alınarak DB'de tutulacak.
- İlk plan için kullanıcıdan başlangıç şarj yüzdesi alınacak.
- Kullanıcı şarj sonrasında önerilen değerin altında veya üstünde kaldıysa gerçek ayrılış yüzdesini girebilecek.
- Girilen güncel yüzde, önceki batarya tahmininin yerini alacak; mevcut konumdan kalan rota yeniden hesaplanacak.
- Kullanıcı yolculuk sırasında da şarj yüzdesini düzeltebilecek.
- Minimum batarya rezervi ve hedef varış şarjı yeniden planlamada da korunacak.
- Ölçüm, kullanıcı beyanı ve hesaplanan tahmin arayüzde ayırt edilecek.
- Misafirler rota/navigasyon kullanabilir; kalıcı garaj oluşturamaz. Rota için geçici araç seçimi yapılabilir.
- Hesap girişi ilk sürümde e-posta/şifre ile olacak; Google girişi ileride etkinleştirilecek.
- Hesaplı garaj cihazlar arasında eşitlenecek. Ücretsiz hesapta değiştirilebilir bir aktif araç bulunacak; premium araç sınırı henüz belirlenmedi.
- Misafirlerin ayrıntılı geçmişi sunucuda oturuma bağlı saklanacak ve hesap açıldığında doğrulanmış sahiplikle aktarılabilecek.
- Ayrıntılı seyahat geçmişinden toplam enerji (kWh), ortalama tüketim (kWh/100 km) ve kaynak/varsayım bilgisiyle tahmini maliyet raporu üretilecek.
- Ayrıntılı geçmişin saklama süresi ve kalibrasyon için ayrı kullanımı ayrıca kararlaştırılacak.

## İlk planlama akışı

1. Kullanıcı başlangıç ve hedef konumunu seçer.
2. Araç modelini ve batarya/donanım varyantını seçer.
3. Başlangıç şarj yüzdesini, hareket zamanını ve gerekli rota tercihlerini girer.
4. Minimum rezerv ve hedef varış şarjı açıkça gösterilir. Varsayılan değerleri ayrıca kararlaştırılacak.
5. Motor yol alternatiflerini, enerji ihtiyacını ve şarj seçeneklerini değerlendirir.
6. Kullanıcı sürüş süresini, şarj sürelerini, durakları ve tahmini varış şarjını görür.
7. Ulaşılabilir plan yoksa neden açıklanır; uydurma rota veya durak üretilmez.

## Şarjdan ayrılma akışı

1. Durakta önerilen ayrılış şarjı gösterilir.
2. Kullanıcı gerçekleşen şarj yüzdesini girer ve devam eder.
3. Motor bu değeri yeni enerji başlangıcı kabul eder.
4. Düşük şarjda ek/yakın durak gerekebilir; yüksek şarjda durak atlanabilir veya değişebilir. Her iki sonuç da erişilebilirlik hesaplanarak belirlenir.
5. Değişen duraklar, süre ve tahmini varış şarjı kullanıcıya gösterilir.

Örnek: Öneri %75 iken %60 girilirse kalan plan %60 üzerinden hesaplanır. %90 girilirse daha ilerideki duraklar değerlendirilir. Durak ekleme veya kaldırma otomatik bir yüzde kuralı değildir.

## Navigasyon akışı

- Konum ilerledikçe kalan mesafe, süre ve tahmini batarya güncellenir.
- Rota dışına çıkma, kullanıcı şarj düzeltmesi ve seçili istasyonun hizmet dışı kalması yeniden planlama sebepleridir.
- Bağlantı veya konum kaybında veri yaşı ve tahminin güncellenemediği gösterilir.
- Canlı istasyon durumu, varış anı için müsaitlik garantisi olarak sunulmaz.
- İlk sürümde araç telemetrisi olmadan kullanıcı girişi ve enerji tahminiyle çalışılabilir.

## Önerilen ilk sürüm sınırı

Bu kapsam sıralaması planlama önerisidir; sağlayıcı ve altyapı onayı değildir.

- Önce seçilecek bir Türkiye şehirler arası koridorunda ve sınırlı doğrulanmış araç kataloğunda uçtan uca planlama.
- Ardından mobil harita, konum takibi, navigasyon ve seyahat sırasında yeniden planlama.
- Misafir kullanım, hesaplı tek araç garajı ve sunucuda misafir geçmişi [ADR-002](adr/002-account-garage-history.md) ile kararlaştırıldı. Auth sağlayıcısı ve oturum ayrıntıları açık.
- Operatör canlı verisi yoksa katalogla planlama yapılabilir; müsaitlik bilinmiyor olarak gösterilir. Canlı müsaitlik özelliğinin tamamlandığı iddia edilmez.
- Rezervasyon, ödeme, şarj başlatma, araç telemetrisi, CarPlay/Android Auto ve tam çevrimdışı rota hesaplama ayrı kapsam değerlendirmesine bırakılır.

## Başarı ölçümü

Eşikler DEC-012'de kararlaştırılacak; ölçüm başlıkları:

- Planlanan ve gerçekleşen tüketim/varış şarjı farkı.
- Minimum rezervi ihlal eden plan oranı ve ulaşılamaz senaryoların doğru reddi.
- İlk plan ve yeniden planlama süresi.
- İstasyon durumunun yaşı, canlı veri kapsamı ve sağlayıcı hata oranı.
- Konum takibinin mobil batarya tüketimi ve bağlantı kaybındaki davranış.
