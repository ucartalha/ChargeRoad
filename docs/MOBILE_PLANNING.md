# Task 15 — Mobil planlama formu ve yol önizlemesi

Tarih: 2026-11-12. CR-015 teknik uygulaması tamamlandı. Araç seçimi ve planlama formu gerçek backend API'lerine bağlıdır. Harita/rota çizimi CR-016; canlı navigasyon, kalıcı seyahat ve kişisel öğrenme kendi görevlerindedir. Telefon üzerinde izin/GPS/görsel kabulü ayrıca yapılmalıdır.

## Kullanıcı tarafından kabul edilen davranış

1. Araç profili veya temel hava bilgisi yetersizse yol önizlemesiyle devam edilir. Mesafe ve sürüş süresi gösterilir; SOC ve otomatik şarj önerisi verilmez. İlk sonuçtaki eksiklik nedeni korunur.
2. Mevcut, sürümlü mühendislik profili açık onayla kullanılabilir. Onay eksik profili oluşturmaz, veri kalite kapısını kaldırmaz ve başka aracın profilini seçmez.
3. Adres araması backend adapter'ından geçer. Cihaz konumu isteğe bağlıdır; izin verilmezse adres aramasıyla devam edilir.

[ADR-013](adr/013-mobile-planning-and-road-preview.md) bu kararları kaydeder.

## Mobilde tamamlanan akış

- DB'den marka/model/varyant seçilir; kalıcı olan yalnız cihazdaki araç ID'sidir. Hesapsız seçim sunucu garajı olarak tanıtılmaz.
- Başlangıç/varış adresi yazılıp **Ara** düğmesine basılır; sonuçlardan gerçek koordinat seçilir. Serbest metin doğrudan rota girdisine dönüşmez. Metin değişince eski seçim geçersizleşir. Arama sonuçları/seçilen adres için kaynak atfı gösterilir.
- **Mevcut konumumu kullan** yalnız basıldığında foreground izni ister. Tek konum okuması yapılır; arka plan takibi yoktur. İzin reddi, 12 saniye bekleme ve doğruluğun bilinmemesi/500 m üstünde olması adres aramasına yönlendirir. Gerçek cihaz davranışı henüz doğrulanmadı.
- Başlangıç SOC, minimum yol rezervi ve hedef varış SOC ayrı zorunlu alanlardır. Boşluklar otomatik yüzdeye dönüşmez. Hedef rezervden düşük olamaz.
- Süre/az durak/net sürüş tüketimi seçilir; ilk seçim süredir. Ücretli yol ve feribot tercihleri ile mühendislik profiline açık onay vardır. Onay araç değişince sıfırlanır.
- Şimdi veya telefonun yerel saatinde `YYYY-AA-GG SS:DD` hareket zamanı girilir. Takvim/gün/saat/geçmiş doğrulanır. Şimdi için 1 dakika hazırlık payı vardır; 72 saat dışı hareket enerji hesabında veri yetersizliği, ardından yol önizlemesi verir.
- SOH, batarya sıcaklığı, yük ve klima ayrıntıları bu ilk formda toplanmaz; API'nin açık unknown alanları olarak kalır. Bu alanlara sayısal değer uydurulmaz.
- Planlama yalnız **Planla** ile yapılır. Yükleniyor/iptal, doğrulama ve sunucu hataları görünür. Çift gönderim engellenir; değişen form/araç eski isteği iptal eder, geç yanıt yeni sonucu ezmez. Sekme geçişinde form bellekte korunur; devam eden plan iptal edilir. Uygulama kapanınca seyahat/form geçmişi kaydedilmez.
- Başarılı planda mesafe, varış SOC, durak sayısı ve süre ayrımları gösterilir. Varsayımlar/uyarılar ve belirsiz ETA saklanmaz. Durakların haritada ayrıntılı sunumu CR-016'dadır.
- `insufficient_data`, `infeasible`, `provider_error`, `computation_limit` ve protokol/ağ hataları ayrı sunulur. Yalnız veri yetersizliğinde otomatik bir yol önizlemesi istenir. Kaliteyi otomatik gevşetip tekrar hesap yapılmaz. Önizleme de başarısızsa ilk veri yetersizliği nedeni korunur. Retry-After geri sayımı vardır; otomatik tekrar döngüsü yoktur.

## Backend ekleri

`POST /v1/locations/search` gövdesi `{query}`; 3–120 karakter, en fazla 6 seçilebilir sonuç. Genel IP rate limiter kullanılır. `GeocodingProvider` portu ve registry, istemciyi sağlayıcı biçiminden ayırır. Yeni adapter eklenip yapılandırma değiştirilerek başka sağlayıcıya geçilebilir. İstemci endpoint/provider URL gönderemez.

İlk geliştirme adapter'ı Photon'dur. [Resmi kullanım açıklaması](https://github.com/komoot/photon/blob/master/README.md) makul hacimli public demo kullanımına izin verir; geniş kullanım kısıtlanabilir ve erişilebilirlik garantisi yoktur. Bu bir üretim sağlayıcı anlaşması değildir. [API dokümanı](https://github.com/komoot/photon/blob/master/docs/api-v1.md) esas alındı. Türkiye bounding box ve mevcut countrycode ile filtre uygulanır; kesin adres/tesis girişi doğrulaması sayılmaz. Veri atfı OpenStreetMap/Photon olarak korunur.

`GEOCODING_ENABLED`, `GEOCODING_PROVIDER_ID`, `GEOCODING_BASE_URL` backend ayarlarıdır. Varsayılan `photon` / `https://photon.komoot.io`; public demo production ortamında açık bırakılamaz. Üretimde izinli/kendi barındırılan adres veya `GEOCODING_ENABLED=false` gerekir. Kullanım koşulları farklı başka adapter için önbellek/atıf politikası ayrıca değerlendirilmelidir.

Migration `012_geocoding_budget.sql` yerel DB'ye uygulandı. PostgreSQL'de instance'lar arası atomik sağlayıcı bütçesi vardır: günlük UTC 100 dış çağrı ve soğuk sorgular arasında 7 saniye rezervasyon; instance başına en fazla 4 bekleyen iş. Sağlayıcı çağrısında timeout 5 saniye, yanıt sınırı 256 KiB; otomatik retry ve açık DB transaction'ı yoktur. Soğuk sorgu bütçeye takılırsa 503/Retry-After döner; arama sağlayıcısının meşgul olması IP ihlali olarak kaydedilmez.

Başarılı arama sonuçları 24 saat ortak cache'dedir. Anahtar SHA-256(provider, endpoint, sürüm, normalize sorgu); ham arama metni, IP veya kullanıcı kimliği saklanmaz. Cache payload'ında sonuç adresi/koordinatı bulunur; kişiye bağlanmaz. Boş başarı cache'lenebilir, hata cache'lenmez. Son kullanımı geçen kayıtlar yazma sırasında silinir; üst sınır 5.000 kayıttır. Trafik durursa fiziksel kayıtlar TTL sonunda kendiliğinden silinmez; periyodik temizlik üretim backlog'undadır. Redis eklenmedi.

`POST /v1/roads/preview`: origin/destination, departureAt, avoidTolls/avoidFerries alır. Sunucu alternatif sayısını 1 tutar; istemci segment/iş bütçesi belirleyemez. Doğrudan mesafe 1 m–2.000 km. Dönüş yalnız mesafe/sürüş süresi, trafik türü, kaynak/atıflar, uyarılar ve yola eşleme mesafesidir. Enerji kesimleri, SOC veya şarj tavsiyesi yoktur.

Önizleme authoritative yol bacağı mesafe/süresinden üretilir; enerji segmentasyonu ve trace-attribute çağrıları çalıştırılmaz. Gerçek uzun rota önce bu gereksiz segment sınırına takıldığı için bu ayrım uygulandı. Enerji rotasının segment bütçeleri değiştirilmedi. Şehir merkezi yolun üstünde değilse eşleme mesafeleri gösterilir; erişim/yürüme süreleri toplamda değildir. Önizlemede 1 km üzeri eşleme reddedilir, 100 m üstü ayrıca uyarılır. Bu, EV planının mevcut 100 m başlangıç/varış doğrulamasını gevşetmez. Gelecekte harita üzerinden daha kesin nokta seçimi bu ayrımı kullanmalıdır.

## Kanıt ve açıklar

[Gerçek HTTP raporu](validation/task15-mobile-http-validation.json): Photon ile İstanbul/Fatih ve Ankara/Çankaya seçildi. Gerçek Ioniq 6 enerji profili eksik sonucu korundu; Valhalla yol önizlemesi **457,776 km / yaklaşık 290 dk** döndü. İstanbul yol eşlemesi yaklaşık 132 m, Ankara yaklaşık 10 m; trafik yok. Şarj/bekleme ve erişim süreleri dahil değildir. Bu örnek kullanıcının önceki 410 km saha kaydıyla aynı başlangıç/varış noktaları değildir; kalibrasyon veya bağımsız doğruluk testi sayılmaz.

Otomatik kontroller: **481 API/DB, 41 shared sözleşme ve 11 saf mobil akış testi başarılı; atlanan yok.** Üç paket typecheck ve API derlemesi başarılı. Android/iOS Metro export native modül/bundle uyumunu kontrol eder; telefon üzerinde çalıştırılmış uygulama veya mağaza build'i değildir.

Çalıştırma: repo kökünde `pnpm db:migrate`; API paketinde `planning:mobile-validate` iki şehir araması + eksik profil + tek gerçek yol önizlemesini doğrular. Mevcut ortak kotalar uygulanır; public servise yük testi yapmaz. Mobil `.env` içindeki `EXPO_PUBLIC_API_URL`, telefondan erişilen backend'in `/v1` adresini içermelidir. Fiziksel telefonda localhost yerine LAN IP gerekir.

V1 öncesi cihaz kabulünde Android/iOS konum izni reddi/verilmesi/kalıcı ret, GPS doğruluğu/zaman aşımı, klavye/tarih/erişilebilirlik ve ağ kesilmesi görülmelidir. Üretim geocoder/yol sağlayıcısı ve gerçek araç profili/saha kabulü açık kalır. Harita CR-016, kalıcı geçmiş ve kişisel öğrenme CR-017/018/020 kapsamındadır.
