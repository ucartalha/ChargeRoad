# ADR-006 — Sağlayıcıdan bağımsız canlı müsaitlik

Tarih: 2026-11-11

Durum: Mimari yaklaşım kabul edildi; gerçek sağlayıcı ve sayısal işletim politikaları açık.

İlgili: DEC-001, DEC-007; CR-007, CR-008, CR-013, CR-021.

## Bağlam

EPDK kataloğu statik istasyon ve soket beyanlarını sağlıyor; mevcut yanıt canlı müsaitlik veya fiziksel EVSE gruplaması sağlamıyor. Kullanıcı, yerel katalogdan aday seçimi ve seçilen durak/yedeklerin yetkili bir canlı kaynaktan zenginleştirilmesi yaklaşımını kabul etti.

## Karar

- Statik katalog ile sıcak müsaitlik durumu ayrı tutulur. Planlayıcı sağlayıcı SDK'sına veya ham protokol durumlarına bağlanmaz; normalize edilmiş bir müsaitlik portu kullanır. EV durak seçimi ve rota optimizasyonu bizim algoritmalarımızda kalır.
- Yerel DB'den bulunan adaylar arasından ana duraklar ve yedekler için gerekli durumlar yenilenir. Kaynağın desteklediği toplu kimlik sorgusu kullanılır; her mobil istek bütün Türkiye verisini indirmez.
- Sağlayıcı push sunuyorsa yetkili değişiklikler arka planda alınır. Push kapsamı ile seçili kimliklere yönelik pull farklı kabiliyetlerdir; her kaynağın ikisini de desteklediği varsayılmaz. İlk senkronizasyon ve kopma sonrası uzlaştırma kaynak sözleşmesine göre yapılır.
- Kanonik lokasyon/EVSE kimliği ile sağlayıcı namespace/kimliği açık eşleştirmeyle bağlanır. EPDK istasyon veya soket kodu başka sağlayıcıda doğrudan geçerli kabul edilmez. Yalnız koordinat yakınlığıyla otomatik EVSE birleştirilmez.
- İstasyon veya connector türü bazında toplam müsait sayısı, belirli fiziksel EVSE'nin müsaitliği olarak sunulmaz. Ayrıntı seviyesi korunur; eşleşmeyen kayıt incelemeye alınır.
- Kaynak durumu ve kaynak gözlem zamanı, alınma zamanı ve efektif durum ayrı tutulur. Eski/eksik/doğrulanamayan veri `unknown` olur; timeout eski `available` bilgisini yeniden taze yapmaz.
- Bilinmeyen durum uyarıyla aday kalır. Güncel arızalı/engelli EVSE kullanılabilir seçenek sayılmaz; dolu EVSE katalogdan silinmez. Anlık müsaitlik varış anı garantisi değildir.
- Bütün kullanıcılar ortak durum deposunu paylaşır. Bu aşamada PostgreSQL kullanılır; süreç içi cache doğruluk kaynağı olmaz. Çok instance koordinasyonu için ortak kota/lease ve eski işçinin sonucunu reddeden sürüm kontrolü gerekir. Redis zorunlu değildir; gelecekte adapter ile eklenebilir.
- Ağ çağrısı DB transaction'ı açıkken yapılmaz. İstek tekilleştirme, sınırlı batch/eşzamanlılık, timeout, retry/backoff, circuit breaker ve sağlayıcı kotası canlı portun dışında ortak yürütme katmanında uygulanır. Kullanıcı rate limiting'i ayrıca korunur.

## Sağlayıcı seçim kapısı

2026-11-11 güncel kullanıcı tercihi: Başlangıç istasyon entegrasyonu **Open Charge Map** ile yapılacak; Google, HERE, Eco-Movement ve Hubject yedekte kalacak. API anahtarını kullanıcı oluşturacak. OCM'nin katalog/genel çalışma durumu ile canlı doluluk ayrı kabul edilir; 50/Operational veya SubmissionStatus.IsLive canlı available olmaz. Otomatik 10/20 kodları da feed/zaman/ayrıntı doğrulanmadan etkinleştirilmez. Mevcut EPDK kataloğu korunur. [Araştırma ve uygulama kapıları](../OPEN_CHARGE_MAP_RESEARCH.md). Aşağıdaki Eco-Movement önceliği tarihsel değerlendirmedir; güncel başlangıç seçimi değildir.

2026-11-10 araştırmasına göre ilk inceleme adayı Eco-Movement; Hubject alternatifidir. Bu sıralama satın alma veya entegrasyonun kesinleştiği anlamına gelmez. TomTom EV Search kapsam tablosunda Türkiye için dinamik veri işaretli değildi; doğrulama olmadan Türkiye canlı kaynağı olarak etkinleştirilemez.

Seçim için Türkiye'de operatör bazlı gerçek örnekler (özellikle ZES/Eşarj/Trugo), EVSE ayrıntısı ve kimlik eşleştirme, kaynak zamanları/gecikmesi, kota, maliyet, gösterim/cache/saklama hakları ve erişim yöntemi doğrulanır. Kamuya açık doküman veri kullanım izni veya kimlik bilgisi yerine geçmez. Doğrudan operatör API'si de aynı kapılardan geçerek adapter olabilir.

2026-11-11 [kaynak araştırması](../STATION_SOURCE_RESEARCH.md): Google Places'in depolama ve haritada gösterim koşulları nedeniyle ortak PostgreSQL durum deposuna içerik yazma hakkı varsayılmaz; uygun lisans doğrulanmadan Google kalıcı feed adapter'ı yapılmaz. HERE EV ürünü için ayrıca yetki gerekir. EPDK'nin kılavuz periyodu içinde varsayılan kota hakkına güvenilmez; gerçek 429 gözlemi kaydedildi. Mail/operatör görüşmeleri kullanıcı tarafından şimdilik pas geçildi.

## Açık kararlar ve sonuç

Canlı TTL, kaynağı belirsiz zaman politikası, batch büyüklüğü, yenileme sıklığı, bekleme bütçesi, tarihçe saklama süresi ve üretim p95/p99 hedefleri örnek veri/kota sonrasında sürümlü politikayla seçilecek. Sağlayıcıya özgü değerler tahmin edilerek kesinleştirilmez.

Bu ADR çalışan canlı entegrasyon değildir. CR-008 gerçek yetkili feed ve uçtan uca doğrulama olmadan DONE olmaz. Teknik adımlar [Task 8 hazırlığında](../TASK_008_PREPARATION.md).

## Araştırma dayanakları

- [Eco-Movement: push ve zaman aralıklı değişiklik alımı](https://developers.eco-movement.com/docs/data-api-user-guide).
- [Hubject: EVSE listesi ve operatör bazında toplu sorgu](https://github.com/hubject/oicp/blob/master/OICP-2.3/OICP%202.3%20EMP/06_EMP_Code_Snippets.asciidoc).
- [Hubject: sözleşmeli erişim](https://support.hubject.com/hc/en-us/articles/13833641509277-Hubject-Portal-101).
- [TomTom: EV Search](https://docs.tomtom.com/ev-search-api/documentation/product-information/introduction) ve [ülke kapsamı](https://docs.tomtom.com/ev-search-api/documentation/product-information/market-coverage).

Kaynaklar 2026-11-10 araştırmasını kaydeder; gerçek entegrasyon öncesi güncel kapsam ve koşullar tekrar doğrulanır.
