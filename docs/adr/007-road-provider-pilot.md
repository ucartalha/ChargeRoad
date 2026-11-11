# ADR-007 — Yol verisi pilotu, trafik ve maliyet sınırı

Tarih: 2026-11-11. Durum: ACCEPTED. İlk geliştirme adapter'ı Valhalla/OSM; üretim barındırması ve harita SDK seçimi açık. CR-009 uygulaması ve kabul kapıları [teknik teslimde](../ROAD_PROVIDERS.md).

İlgili: DEC-006, DEC-007, DEC-008; CR-004, CR-009–013, CR-016, CR-019.

## Kabul edilen kararlar

Kullanıcı üç soruya şu seçimleri verdi:

1. **Yönetilen API ile pilot.** İlk yol motoru yönetilen servis olacak. Provider sınırı korunacak; kendi sunucumuzda çalışan bir motora geçiş core planlayıcıyı değiştirmeyecek.
2. **Trafik varsa kullan; yoksa uyarıyla devam et.** Başarılı yol sonucu trafik içermiyorsa statik/model hız-süre kaynağı açık belirtilir. Trafik yokluğu yol bulunamadı değildir. Taşıma/auth/kota hatası da başarılı trafiksiz sonuç gibi sunulmaz; başka provider'a geçiş ancak açık politikayla yapılır.
3. **Önce ücretsiz/geliştirme kotasıyla doğrula.** Ücretli kullanım, otomatik kota aşımı veya ücretli fallback kararı alınmadı. İlk sağlayıcı seçimi kullanım amacı ve deneme koşulları uygunluğundan sonra yapılır.

Daha önce kabul edilen sınırlar devam eder: EV durak/şarj ve enerji hesabı bizim algoritmalarımızda; LLM zorunluluğu yok. Yol sağlayıcısı gerçek yol geometrisi, süre ve mevcut yol özelliklerini getirir. Harita renderer, geocoding, yükseklik, trafik ve navigasyon ayrı kabiliyetler olarak değerlendirilir. Sabit pilot şehir yerine kullanıcı başlangıç/varışları kullanılır.

## Araştırma bulgusu ve sağlayıcı kapısı

11 Kasım 2026 resmî doküman incelemesi:

- [HERE Limited Plan koşulları](https://www.here.com/get-started/pricing/limited-plan-restrictions): günlük 1.000 request ve otomobil routing için 10 RPS listeleniyor; bunlar plan kapsamındaki sınırlar, bizim uçtan uca rota başına bütçemiz değil. Aynı sayfa Asset Management, UBI/Telematics ve Optimization istisnaları tanımlıyor. ChargeRoad kullanımının kapsamı ayrıca doğrulanmadan ücretsiz plan uygun kabul edilmez. Genel fiyat sayfası tarama aracına 403 döndü; hesaba atanmış plan/kota henüz görülmedi.
- [GraphHopper fiyat/plan koşulları](https://www.graphhopper.com/pricing/): Free plan 500 kredi/gün, istek başına en fazla 5 konum; ticari olmayan kullanım ve bazı özellik kısıtları var. Free planın gelecekteki ticari ürüne uygunluğu varsayılmaz. [Kredi açıklaması](https://www.graphhopper.com/faq/what-is-one-credit/) alternatif rota isteğini 2 kredi olarak listeliyor; HTTP çağrısı ile kredi aynı şey değildir.
- [HERE Routing API](https://docs.here.com/routing/reference/routing-api-v8-calculateroutes) ve [GraphHopper'ın açık kaynak API dokümanı](https://github.com/graphhopper/graphhopper/blob/master/docs/web/api-doc.md) veri ayrıntıları için adaydır. Açık kaynak motordaki özelliğin yönetilen Free planında aynı şekilde açık olduğu varsayılmaz.

Bu inceleme bir hesap açımı, sözleşme kabulü, yazılı sağlayıcı teyidi veya başarılı Türkiye API denemesi değildir. Mail/operatör iletişimini pas geçme tercihi korunur. Anahtar varsa bile plan/amaç uygunluğu ayrıca değerlendirilir. Deneme koşulları ürüne uygun değilse sağlayıcı değişikliği veya ayrı değerlendirme erişimi gerekir; ücretsiz diye ticari kısıtlar atlanmaz.

## Uygulama kararı — ücretsiz veri ve kendi haritamız

Kullanıcı kendi haritasında kullanılabilir ücretsiz hız/yol verisi istedi. Valhalla'nın OSM yol motoru, FOSSGIS'in sınırlı yerel geliştirme servisi üzerinden ilk adapter oldu. OSM hız etiketleri ayrı attribute provider ile OSM way ID üzerinden tamamlanır. [ODbL](https://www.openstreetmap.org/copyright) atıf ve türetilmiş veri koşulları korunur; veri ücretsizliği sunucu işletiminin ücretsizliği değildir.

[FOSSGIS demo kuralları](https://routing.openstreetmap.de/about.html) ve [Valhalla başlangıç rehberi](https://github.com/valhalla/valhalla/blob/master/docs/docs/start/introduction.md) nedeniyle kamu servisi üretim bağımlılığı yapılmaz. [Overpass politikası](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) da tüketici uygulamaları için kendi altyapısını ister. Üretim konfigürasyonu bu iki kamu servisini engeller; kendi sunucumuza veya uygun lisanslı yönetilen servise geçiş port üzerinden yapılır. Operatörlere mesaj gönderilmedi.

İlk politika: provider başına 100 çağrı/gün, 1,1 sn aralık, iş başına 12 eylem; üç alternatif/üç istasyon; PG cache en fazla 1 saat, OSM etiketleri 1 gün, 45 sn lease; ana sorgu 25 sn, opsiyonel etiket 8 sn. Timeout/5xx ve 429 için ortak bekleme vardır. Bu sayılar üretim SLA değildir.

Canlı trafik bu adapter'da yok; açık uyarıyla statik/model süre döner. Ankara gerçek yol/sapma kanıtı alındı. Hız alanları kamu Overpass yoğunluğu nedeniyle henüz gerçek dolu değerle doğrulanamadı; bu alanda sahte hız sınırı üretilmez. Yükseklik profilinin bağımsız veri seti/lisans doğrulaması, fiziksel tesis giriş incelemesi, uzun/iki yönlü saha örneklemi ve üretim hosting kararı açık. CR-008'in canlı feed açığı, yol altyapısını durdurmaz.

## Kapsam devri — 2026-11-11

Kullanıcı kalan eksiklerin V1 çıkışı öncesinde kapatılacak backlog olarak bırakılmasını istedi. CR-009 teknik uygulaması DONE kabul edilerek kalan işler [V1-ROAD-001–006](../V1_RELEASE_BACKLOG.md) maddelerine devredildi. Bu kapsam kararı gerçek veri/saha doğrulaması veya üretim uygunluk kanıtı değildir; bilinmeyen alan davranışı ve kamu servislerinin üretim engeli devam eder.
