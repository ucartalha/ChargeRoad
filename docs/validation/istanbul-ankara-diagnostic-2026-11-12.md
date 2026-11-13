# İstanbul–Ankara telefon bildirimi — tanı kaydı

12 Kasım 2026, yaklaşık 02:00–02:20 Europe/Istanbul. Kullanıcı Ioniq 6 ile “Mevcut konumumu kullan” sonrasında “hesaplama sınırı içinde doğrulanmış bir plan bulunamadı” bildirdi.

Önceki API sürümünde her plan için korelasyon/sonuç logu yoktu. Metro çıktısında model seçenekleri için tekrarlanan `chargeroad-catalogue:ioniq_5` / `ioniq_6` anahtar uyarıları vardı; kaynakların model isimlerinin harf büyüklüğü farklı olsa da slug aynıydı. DB sorguları slug'a göre tekilleştirildi. GPS doğruluğu ve telefonun tam isteği geriye dönük kesin olarak tespit edilmedi.

Yeni loglarla sonraki **gerçek telefon denemesi** doğrulandı: yerel 02:13:16, requestId `cb2226c9-f4dc-49ef-beef-c0086624a132`. Metro `originSource:device`, telefonun raporladığı doğruluk `100 m`; backend aynı requestId için 3.502 ms'de `computation_limit / NO_VALID_PLAN_WITHIN_DATA_BUDGET`, skippedData `WEATHER_QUERY_BUDGET` ve `PHYSICAL_DC_EVSE_DATA_MISSING` yazdı. Bu istek GPS uç eşleme hatasına veya 15 saniye zaman aşımına takılmadı. 100 m raporlanan GPS belirsizliğidir, aracın yoldan uzaklığı değildir.

İlk kontrol şehir adıyla aranan İstanbul merkezini kullandı. Bu kontrolün yaklaşık 132 m yol eşleme mesafesi **kullanıcının GPS doğruluğu veya konum mesafesi değildir**. Merkez adresinden yeniden üretimde `ROAD_PROVIDER_ENDPOINT_OR_SOURCE_INVALID` görüldü. Bu ayrı hata için yakın yol noktasına açık kullanıcı onayı ve farklı/ulaşılamayan adres sonucu eklendi; 100 m EV uç doğrulaması sessizce gevşetilmedi.

Kullanıcının verdiği ekran mesajına yönelik kontrollü uzun rota denemesi, belirtilen zaman aralığındaki cache paketinden yapıldı. Paket alınma zamanı `2026-11-11T22:59:13.967Z` (yerel 01:59:13), mesafe **455,521 km**. Kullanıcının SOC değerleri geçmişte kaydedilmediğinden denemede açık test değerleri %95 başlangıç / %10 rezerv / %20 hedef kullanıldı; telefonun birebir isteği olduğu iddia edilmez. Konum etkisini ayrı tutmak için ayrıca yola oturan test uçları kullanıldı. Tam koordinatlar loglanmadı veya bu rapora yazılmadı.

Sonuç:

- 5.003 yol kesimi, 47 farklı hava örnek noktası.
- Varsayılan optimizer bütçesi 4.000 dahili hava değerlendirmesi. İlk geçişte `WEATHER_QUERY_BUDGET`; yaklaşık 2 saniyede `NO_VALID_PLAN_WITHIN_DATA_BUDGET`. Bu örnekte süre dolması veya GPS kaynaklı sorun değil.
- Yalnız CLI denemesinde bütçe 10.000 yapıldığında, hava değerlendirmesinden sonra `ENERGY_COMPUTATION_BUDGET` görüldü. Dolayısıyla tek bir sayıyı artırmak uzun rota kabulünü tamamlamıyor. Bu deneyde runtime varsayılan sınırları değiştirilmedi.
- Eksik fiziksel DC EVSE bilgisi ayrıca `PHYSICAL_DC_EVSE_DATA_MISSING` olarak raporlandı. Araç profili kapsamı, istasyon donanım verisi veya şarjlı uzun rota kabulünü kendiliğinden tamamlamaz.

Güvenli tanılama eklendi: backend zaman damgalı `planning_completed` olayında requestId, sonuç/neden kodları, sınırlı skippedData ve elapsedMs; mobil yalnız geliştirme modunda aynı requestId, GPS/adres kaynağı ve raporlanan doğruluk değerini yazar. Koordinat, SOC, IP veya sağlayıcı paketi yazılmaz. Sonraki telefon denemesi gerçek hata alt nedenine bağlanabilir. Enerji sınırı alt nedenleri de session tanısına taşınır. Yanlış biçimde kullanıcıya daha kısa rota seçmesini öneren başlık düzeltildi.

Model tekilleştirme, onaylı yol noktası ve mevcut akış regresyonları ilk tanı aşamasında 542 API/DB ve 12 mobil akış testiyle doğrulandı.

## Uzun rota düzeltmesi

Sonraki uygulama değişiklikleri:

- `bounded-ev-search/1.1.0`: dahili hava değerlendirmesi 4.000 → 10.000; 5.003 kesim için 5.003 HTTP isteği yapılmaz. Bu örnekte 47 farklı hava örnek noktası vardır.
- `chargeroad-energy/1.3.1`: geometri, yükseklik ve hız örneklerine ayrı 20.000 girdi sınırı; ortak toplamın yanlış biçimde 20.000'i aşması artık ret nedeni değildir. 10.000 kesim, 200.000 integrasyon adımı ve 1.500 ms enerji yürütme sınırı korunur. Bağımsız düz-yol enerji hesabıyla kontrol edilen 450 km / 6.000 kesim testi eklendi.
- Kesirli milisaniye yol süreleri ile tam milisaniyeli ISO hava zamanları eşleştirilirken yalnız aralık sınırları milisaniye hassasiyetine yuvarlanır. Eski veya başka zamana ait hava verisi kabul edilmez; regresyon bunu ayrıca kontrol eder.
- Session hava eşleştirmesi query ID haritasıyla yapılır; her kayıt için baştan bütün sorgular taranmaz.
- İstasyon koridorunda 64 ardışık kesimlik uzamsal ön filtre kullanılır; son eşleştirme yine özgün kesim mesafesi/progress değerleriyle yapılır. İstasyon payload'u aday başına bir kez alınır. 2 saniye SQL sınırı ve küresel kota korunur.
- `weather/1.1.0`: 64 dış çağrı bütçesi, planın farklı AbortSignal kullanan bacakları arasında aynı bağlamla paylaşılır. Cache isabeti dış çağrı tüketmez; günlük 1.000 ve küresel 2 istek/sn sınırları korunur.
- `public-planning/1.1.0`: varsayılan yürütme 30 saniye, mobil istemci 35 saniye. Bu bir gecikme garantisi değildir; kullanıcı iptali ve admission sınırları korunur.
- İstasyon soket verisi, çelişkili yol hızları ve eksik temel hava verisi için açıklayıcı public nedenler eklendi. Kullanıcıdan kısa rota seçmesi istenmez.

Gerçek sağlayıcılar ve yerel DB ile düzeltme sonrası kontrollü tekrar: **7.717 ms**, `weatherQueries:5003`, 5.003 hava kaydı `available`, `firstUnusable:[]`; sonuç `insufficient_data`. `WEATHER_QUERY_BUDGET`, `ENERGY_COMPUTATION_BUDGET` ve hatalı `WEATHER_CORE_OR_FRESHNESS_MISSING` artık bu örnekte oluşmadı. Kalan nedenler `PHYSICAL_DC_EVSE_DATA_MISSING` ve `ROAD_TIME_OR_TRACE_EXCEEDS_SPEED_LIMIT`; seçilebilir fiziksel DC EVSE adayı **0**. Önceki paragraftaki değiştirilmemiş runtime sınırları ifadesi ilk tanı deneyine aittir; güncel değerler yukarıdadır.

Uzun şarjlı İstanbul–Ankara planı **çözüldü sayılmaz**. Katalogda istasyon bulunması, fiziksel EVSE kimliği/bağlantısı ve şarj donanımı doğrulamasının tamamlandığı anlamına gelmez. Sağlayıcı süre/hız sınırı çelişkisi de sessizce yok sayılmadı. Bu iki veri kabul açığı kapatılmadan tam şarjlı rota kabulü veya gerçek dünya doğruluğu iddia edilmez.

Son düzeltme doğrulaması: 44 suite / **548 API ve DB testi**, **12 mobil akış testi** başarılı; bütün paketlerin TypeScript kontrolü ve API derlemesi geçti. 5.003 kesimlik varsayılan optimizer bütçesi testi tam doğrulanmış sentetik plan üretir; 5.003 aynı kaynak noktasındaki hava sorgusunun tek cache okumasına indirgenmesi ve farklı bacak sinyallerinin ortak dış çağrı bütçesi kullanması ayrıca test edildi. Bu sentetik başarı gerçek güzergâhın açıklarını kapatmaz.

Yeniden başlatılmış public API üzerinden son kontrol: HTTP 200, requestId `4091f340-7ddc-4d6a-9a34-bfc07c65c152`, `public-planning/1.1.0`, **10.852 ms**. Sonuç `insufficient_data`; public yanıt yukarıdaki iki özgül kodu Türkçe açıklamalarıyla döndürdü. Bu kontrollü istek de aynı cache güzergâhının yol uçları ve açık test SOC değerleriyle yapılmıştır. API health `ok`, Expo Metro `packager-status:running`; 41 shared sözleşme testi de başarılıdır. Yeniden telefon üzerinde plan kabulü yapılmadı.
