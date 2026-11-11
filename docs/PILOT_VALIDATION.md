# CR-005: Pilot doğrulama ve istasyon erişimi değerlendirmesi

Tarih: 2026-11-10. Durum: Pilot araç konfigürasyonları ve p99 ölçümü kabul edildi. [CR-005 referans senaryoları ve ölçüm düzeneği](REFERENCE_VALIDATION.md) tamamlandı. Kaynak/katalog eşleştirmesi, koridorlar, gerçek saha verisi ve sayısal eşikler açık. İstasyon erişimi aşağıda öneridir; henüz uygulanmadı.

## Kabul edilen pilot kapsamı

- Hyundai Ioniq 6 ve Ioniq 5.
- Kullanıcının aracı: 2023 Hyundai Ioniq 6, RWD, 53 kWh paket, 18 inç jant, kullanıcı ifadesiyle 151 hp. Üretici güç birimi 111 kW / 151 PS olarak normalize edilir.
- İkinci pilot: 2025 Hyundai Ioniq 5, 63 kWh paket, 19 inç jant, kullanıcı ifadesiyle 170 hp. Üretici teknik verisi bu paket için RWD ve 125 kW / 170 PS gösterir. Model yılı kullanıcı seçimidir; tarihsel model yılı/pazar eşleştirmesi ayrıca doğrulanacak.
- Kullanıcı farklı hızlardaki tüketim ortalamalarını sağlayabilir. Bunlar koşulları eksik olabilecek kullanıcı bildirimleridir; doğrulanmış telemetri veya kontrollü sabit hız testi kabul edilmez.
- Belirli rotalarda saha denemesi ve koşulları belirtilmiş bağımsız kullanıcı/test kaynaklarıyla karşılaştırma yapılacak.
- Performans ölçümleri p95 yanında p99 da içerecek; eşikler henüz seçilmedi.

## Varyant kaynakları ve katalog açıkları

2026-11-10 tarihinde kontrol edilen [Hyundai Türkiye Ioniq 6 broşürü](https://www.hyundai.com/content/dam/hyundai/downloads/tr/tr/brosurler/Ioniq6-digital-brosur.pdf) (PDF sayfa 18 ve 26) 53 kWh, RWD, 111 kW / 151 PS ve 18 inç kombinasyonunu destekler. [Ioniq 5 broşürü](https://www.hyundai.com/content/dam/hyundai/downloads/tr/tr/brosurler/ioniq5-digital-brosur.pdf) (PDF sayfa 15) 63 kWh, RWD, 125 kW / 170 PS ve 19 inç kombinasyonunu destekler. Güncel URL'deki broşür tek başına 2023/2025 model yılı kanıtı sayılmaz. Donanım paketi, bölge ve model yılı kaynakla eşleştirilmeden farklı sürümlerin şarj eğrileri birleştirilmez.

Batarya kapasitesi kWh, motor gücü kW olarak tutulur; PS ile mekanik hp aynı birim sayılmaz. Üreticinin paket etiketi, doğrulanmış brüt kapasite ve kullanılabilir enerji ayrı alan/kaynaklardır. 53 veya 63 kWh doğrudan kullanılabilir kapasite kabul edilmez.

Mevcut yerel katalog kontrolü (OpenEV v1.24.0, 2026-11-10):

- 2023 Ioniq 6 Standard Range kaydı mevcut: `7274db9a8e4cc1edee6ef7bb4ed042b20899ebc6e0f0e0c8267a5189e03e09f2`. Kaynak 53 kWh brüt ve 50 kWh kullanılabilir bildiriyor. Bu bir aday eşleşmedir; jant/aktarma ve kullanılabilir kapasite bağımsız doğrulanmış sayılmaz.
- OpenEV snapshot'ında 2025 Ioniq 5 için 63 kWh kayıt mevcut değil. CR-006 teknik tesliminde kullanıcı seçimine dayalı ayrı pilot konfigürasyonu ana kataloğa eklendi; kapasite/tüketim/eğri doğrulaması hâlâ açık. Kaynaktaki 77,4/84 kWh kayıtlar pilotun yerine kullanılmadı; OpenEV kaydı değiştirilmedi. [Teslim](VEHICLE_KNOWLEDGE.md).
- İki pilotun doğrulanmış tüketim referansları ve koşullu DC şarj eğrileri henüz yok. Aynı platform/voltaj sınıfı aynı şarj eğrisi anlamına gelmez. Tek bir %10–80 süre beyanından tam eğri türetilmez.

## Tüketim referansının alınması

Her kayıt için mümkünse tam varyant/yıl, lastik/jant, hızın anlamı (sabit seyir mi yolculuk ortalaması mı), kWh/100 km, mesafe, süre, sıcaklık, HVAC, yük, rüzgâr/eğim bağlamı ve gösterge/veri kaynağı istenir. Bilinmeyen alanlar boş/unknown kalır.

2026-11-10: Kullanıcı Ioniq 6 için üç tüketim aralığı sağladı ve birimini kWh/100 km olarak doğruladı. Bunlar [v2 kaynak paketinde](../data/vehicle-knowledge/pilots-v2-user-observations.json) ve DB'de ayrı user-report gözlemleri olarak korundu; sabit hız testi veya başka aracın eğrisi sayılmadı. [Koşullar ve kalite durumu](VEHICLE_KNOWLEDGE.md#hız-koşul-ve-mühendislik-referansları).

Aynı ortalama hız farklı dur-kalk, eğim ve hız dağılımlarını temsil edebilir. Tek bir ortalamadan evrensel hız–tüketim eğrisi veya kesin düzeltme katsayısı çıkarılmaz. Farklı kullanıcıların değerleri varyant ve koşulları eşleşmeden birleştirilmez.

Kaynaklar ayrı kaliteyle izlenir: sentetik/elle hesaplanan örnek; kullanıcı bildirimi; koşulları belgeli saha ölçümü; üretici/bağımsız test. İnternet yorumları tekrar eden aynı kaynağın bağımsız doğrulaması sayılmaz; kaynak URL'si, tarihi, varyantı, koşulları ve ölçüm yöntemi kaydedilir.

Modeli ayarlamakta kullanılan yolculuklar aynı modelin bağımsız doğrulaması olarak sunulmaz. Ayrı seyahat/tarih/koşullardan doğrulama grubu ayrılır. Hesap/misafir geçmişi saklama izni otomatik kalibrasyon izni değildir.

## Doğrulama katmanları

1. Elle çözülebilir küçük yol/enerji örnekleri ve bağımsız beklenen sonuçlar.
2. Küçük ağlarda tüm geçerli adayları tarayan referans yöntemle gelecekteki hızlı solver'ın karşılaştırılması.
3. Sabit normalize kaynak snapshot'larıyla tekrarlanabilir replay.
4. Model/koşul bilgisi bulunan gerçek seyahatlerle enerji, varış SOC'si ve şarj süresi ölçümü.

İlk iki katman gerçek tüketim motoru mevcutmuş gibi raporlanmaz. Sözleşme/coordinator testlerine ek olarak 15 elle hesaplanmış snapshot vakası, küçük ağda exhaustive referans çözücü, aday karşılaştırma ve p95/p99 düzeneği var. Fiziksel model ve gerçek saha ölçümleri henüz yok; [uygulama sınırları ve komutlar](REFERENCE_VALIDATION.md).

Varış SOC hatası yüzde puanı olarak ve işaretiyle raporlanır: tahmin eksi gerçek. Pozitif hata kalan enerjinin fazla tahminidir. Toplam tüketim kWh ve normalize tüketim kWh/100 km hataları ayrı tutulur. Şarj, kuyruk ve yol sapması süreleri birbirine karıştırılmaz.

## p95/p99 planı

- Katalog DB sorgusu, istasyon koridor sorgusu, dış durum yenileme, solver ve uçtan uca API süreleri ayrı ölçülür.
- Yeterli örnek, test süresi, eşzamanlılık, veri büyüklüğü ve makine bilgisi raporlanır. Birkaç isteğin p99'u güvenilir kapasite kanıtı değildir.
- Soğuk/sıcak cache, normal/yoğun trafik, kaynak timeout'u ve telemetri yazımı altındaki davranış ayrı koşullardır.
- Hata/429/503 oranları, timeout'lar, pool kuyruğu, kilit beklemesi ve event-loop gecikmesi izlenir.
- Yalnızca hızlı reddedilen isteklerle iyi görünen gecikme raporu çıkarılmaz: başarılı istekler ve tüm trafik ayrı özetlenir.
- Çok kullanıcılı test yanlışlıkla tek IP kotasını ölçmemeli; aynı IP/NAT baskısı da ayrı güvenlik senaryosu olmalı.
- Otomatik yük testleri izin alınmamış gerçek operatör API'lerine yük bindirmez; kontrollü stub'lar ve izinli entegrasyon denemeleri ayrılır.

## İstasyon erişimi için öneri

Önerilen yapı: Yerel statik katalog + PostGIS rota koridoru adayları + seçilmiş adayların talep üzerine canlı durumu.

1. Yayın bölgesinin izinli konum/EVSE/connector kataloğu başlangıçta kontrollü ve eksiksiz alınır. Bütün dünya veya bütün canlı durum her yolculukta indirilmez.
2. PostGIS'te istasyon noktasına uygun coğrafi indeks kurulur. Yol çizgisi boyunca ST_DWithin ile metre cinsinden koridor aranır; yalnızca birkaç koordinat çevresinde en yakın istasyonları aramakla yetinilmez.
3. Soket, güç, erişim ve veri kalitesiyle adaylar filtrelenir. Ardından gerçek yol bağlantısı, sapma süresi ve enerjiyle erişim kendi planlayıcımızda değerlendirilir.
4. Canlı durum yalnızca anlamlı adaylar, seçilen durak ve yedekler için yenilenir. Sağlayıcı toplu ID sorgusu/push destekliyorsa kullanılır; desteklemiyorsa sınırlı eşzamanlılık, kota ve backoff uygulanır.
5. Aynı aday kümesine eşzamanlı talepler tekilleştirilmeli; instance belleğine dayalı global kilit kurulmaz. İlk aşamada DB koordinasyonu, ileride gerekirse Redis adapter'ı değerlendirilir.

ST_DWithin geography türünde metre kullanır ve uygun indeksle aramaya elverişlidir. [PostGIS](https://postgis.net/docs/ST_DWithin.html), [indeksli yakınlık sorgusu](https://postgis.net/documentation/tips/st-dwithin/)

Coğrafi yakınlık ulaşılabilirlik kanıtı değildir: karşı şerit, kavşak erişimi, kapalı giriş veya ciddi sapma bulunabilir. Sabit en yakın K istasyon optimum planı kaçırabilir; sonuç yetersizse aday/koridor genişletme politikası gerekir. Sınırlı aramada küresel optimum iddiası yapılmaz.

## Kaynak yetenekleri ve kimlikler

Open Charge Map şeması koordinat/mesafe, ülke, bounding box/polygon ve kendi POI ID'siyle filtreler tanımlar; operatör canlı müsaitliği garanti edilmez. [Resmî şema](https://github.com/openchargemap/ocm-docs/blob/master/Model/schema/ocm-openapi-spec.yaml)

OCPI Locations; artımlı tarih filtreleri, sayfalama ve belirli Location/EVSE/Connector'a erişim tanımlar. Gerçek operatörde sürüm ve erişim yetkisi doğrulanmalıdır; protokol desteği Türkiye kapsamı veya ücretsiz erişim garantisi değildir. [OCPI Locations](https://github.com/ocpi/ocpi/blob/2.3.0/release/core/mod_locations.asciidoc)

Tek başına koordinat veya connector_id benzersiz kimlik sayılmaz. İç istasyon ID'sine kaynak/ülke/operatör/location/EVSE/connector kimlikleri uygun namespace içinde eşlenir; farklı kaynakların aynı fiziksel yeri göstermesi alias/eşleştirme gerektirir.

## Job ve güncellik ayrımı

- Araç kataloğu: Önceden konuşulan haftalık güncelleme ayrı bir iştir.
- İstasyon statik kataloğu: Sağlayıcı destekliyorsa artımlı senkronizasyon; yoksa kontrollü bölgesel/periyodik tarama. Sıklık kota ve veri değişimine göre kararlaştırılacak.
- Canlı müsaitlik: Haftalık job'a bırakılamaz. Aktif yolculuk/adaya göre yenileme veya erişilebilen push feed gerekir.
- Süresi geçmiş durum unknown olur; şimdi müsait olması varış anı garantisi değildir.
- Sayfa/kota sınırı nedeniyle eksik import, tam katalog olarak işaretlenmez ve eski istasyonların topluca kaldırılmasına neden olmaz.
- Kapsam bölgesi, son başarılı senkronizasyon, checkpoint ve tamamlık bilgisi saklanır. Boş sonuç ile henüz yüklenmemiş bölge ayrılır; eksik kapsamdan kesin rota yok sonucu çıkarılmaz.
- Katalog kapsama bilgisi ve kaynak hata sınıfları CR-007/008 adaptör sözleşmelerinde somutlaştırılacak. Mevcut istasyon array portu tek başına bu tamamlık ayrımını kanıtlamaz.

## İstasyon adaptörleriyle doğrulanacak senaryolar

Referans düzeneği erişilebilirlik, uyumluluk, durum politikası ve eksik kapsam girdilerini sınar. Aşağıdaki gerçek sorgu/veri toplama davranışları CR-007/008 entegrasyonlarında doğrulanacak; CR-005'in tamamlanması bunların uygulanmış olduğu anlamına gelmez.

- Katalogda çok kayıt varken yalnızca koridor adayları okunur; yol arası boşluklar kaçırılmaz.
- Yakın fakat karşı yönde/erişimsiz istasyon kullanılmaz.
- Kaynaklar arası mükerrer, aynı adlı veya yakın koordinatlı farklı istasyonlar doğru ayrılır.
- Eksik sayfalama/bölgesel kapsam istasyon yok gibi yorumlanmaz.
- Eski/yanıtsız canlı veri müsait gibi gösterilmez.
- Yoğun talep altında aynı istasyona gereksiz yinelenen canlı istekler sınırlandırılır.
- Hedef/yedek istasyon seçimi ve kaynak limitleri p95/p99 ölçümünde görünür.

Bu belgede önerilen istasyon yöntemi henüz uygulanmadı. Seçilen varyantların kaynak eşleştirmesi, pilot koridoru, tüketim kayıtları, kaynak erişimi ve sayısal kabul eşikleri birlikte netleştirilecek.
