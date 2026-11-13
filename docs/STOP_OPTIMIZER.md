# Task 13 — Deterministik şarj durağı optimizasyonu

Tarih: 2026-11-12. Backend teknik hesap/arama bileşeni uygulandı. Genel HTTP endpoint'i daha sonra [Task 14'te](PLANNING_API.md) eklendi; mobil mod seçimi ve harita bağlantısı sonraki görevlerdedir. Gerçek pilot araç kalibrasyonu, fiziksel EVSE/donanım zenginleştirmesi ve bağımsız saha kabulü açık kalır.

## Kabul edilen ürün davranışı

[ADR-011](adr/011-planning-objectives-and-conditional-time.md): kullanıcı üç modu seçebilir. Amaç belirtilmezse sözleşme **süre** modunu seçer. Minimum rezerv ve hedef varış SOC'si her planlamada zorunlu kullanıcı girdisidir; %10/%20 varsayılanı eklenmedi.

| Mod | Öncelik sırası |
| --- | --- |
| Süre | Senaryo toplam süresi → durak sayısı → yol mesafesi |
| Az şarj durağı | Durak sayısı → senaryo toplam süresi → yol mesafesi |
| Düşük tüketim | Sürüşte net batarya kWh → senaryo toplam süresi → durak → mesafe |

Net sürüş enerjisi, yol ve sapma sürüşü, kabin/batarya termal tüketimi ve rejenerasyonu içerir. Şarj giriş kayıpları/yardımcı enerjisi ve bağlantı sırasındaki batarya tüketimi ayrıca kaydedilir; bu moda sürüş enerjisi gibi eklenmez. Ücret optimizasyonu yapılmaz.

%10–80 zorunlu pencere değildir. Her mod kaynak eğrisi kapsamında daha yüksek hedeflere bakabilir; az durak modu bunun uzun şarj karşılığında faydasını sıralar. Hedefler eğri SOC düğümleri, sürümlü SOC adımları ve sonraki noktaya erişim/varış hedefinden türetilen adaptif noktalardan oluşur. Hiçbir mod rezerv, fiziksel uyumluluk, kaynak/koşul veya eğri kapsamını gevşetmez.

## Uygulama ve provider sınırı

- `EvPlanningModule` root uygulamada kayıtlı, `EvPlanningService` backend servis girişidir. Mevcut VehicleEnergyProvider, RoutingProvider, StationDataProvider ve WeatherProvider portları kullanılır; dış sağlayıcıdan EV durak kararı alınmaz.
- Coordinator önce kanonik/sürümlü araç profilini okur. Enerji profili eksikse yol/hava çağrısı başlamaz. Kaynaklar tek sağlayıcıya bağlanmaz; Redis veya LLM eklenmedi.
- `PlanningSession`, istek başına yol/hava önbelleği, sorgu sayacı, deadline/iptal ve kaynak kayıtlarını tutar. Ortak provider PostgreSQL cache/kota/backoff katmanları kullanılmaya devam eder. Sürücü modeli arama sırasında değiştirilmez; ilk solver referans modele dayanır.
- Statik koridor adaylarında önce fiziksel DC EVSE ve connector uyumu aranır; ekipman/soket özetinden hayalî ünite oluşturulmaz. Yetkisiz/kapalı/planned/removed adaylar kullanılamaz. Paylaşılan güç için allocation olmadan havuzun tamamı araca verilmez.
- Uygun noktalara yönlü yol bağlantıları ihtiyaç oldukça RoutingProvider'dan alınır. İstasyonlar arasındaki yollar da gerçek sağlayıcı çıktısıdır; düz çizgi enerji/süre olarak kullanılmaz. Geometri/kaynak/kimlikler denetlenir. Aynı fiziksel tesisin farklı kaynak ID'leri tam çözümlenmiş değildir; bu kapsam problemi gizlenmez.
- Trafik içermediği açık olan yol snapshot'ı aynı bağlantıda yeniden kullanılabilir; trafik uyarısı korunur. Tarihsel/canlı/zamanı belirsiz sonuçlar farklı kalkış saatine otomatik taşınmaz. Hava her gerçek senaryo geçiş zamanına eşlenir; charge hedefi veya süresi değişince sonraki saatler tekrar değerlendirilir.
- Koridorlar yalnız geçerli plan bulunamazsa genişletilir; ilk bulunan planda daha dış koridorun mutlaka tarandığı iddia edilmez. Veri yetersizliği veya dar aday alanı küresel ulaşılamazlık kanıtı değildir.

Final yol, seçilmiş leg snapshot'larının sıralı birleşimidir. Kesim kaynak verileri korunur; ID ve offset'ler yeniden adlandırılır, sourceEdgeId/koordinat/süre/yükseklik yeniden uydurulmaz. Kopuk geometriler başarılı plan olamaz. Manevra offset'leri, kaynak/lisans ve atıflar final yola aktarılır. Ayrı sapma miktarı güvenilir şekilde ayrıştırılmadığında stop alanları null ve `included_in_road_not_separately_quantified` olur: sapmanın gerçek sürüş enerjisi/süresi final yolun içinde hesaplanmıştır, ikinci kez eklenmez.

## Arama ve sınırları

`ChargeStopOptimizer` istek kapsamındaki durumları deterministik öncelikle arar. Durum; mevcut nokta, SOC, senaryo saati, batarya termal durumu, sabit kapasite, ziyaret edilen istasyonlar ve birikmiş yol/şarj geçmişidir. Aynı noktadaki farklı SOC/zaman/sıcaklık durumları körlemesine birleştirilmez. Farklı hava/termal durumlar için kanıtlanmamış dominance kullanılmaz.

Süre ve durak modunda ancak mevcut birikmiş değeri geçerli en iyi planı zaten aşan durumlar budanır. Enerji modunda rejenerasyon nedeniyle mevcut net kWh gelecek için güvenli alt sınır sayılmaz; bu tür budama yapılmaz. Enerji sıralaması sayısal gürültünün eşit planları bozmasını önlemek için 1e-8 kWh çözünürlüktedir; dakika düzeyinde keyfi “yakın sonuç” eşiği yoktur.

Bir istasyon tekrar ziyaret edilmez; sınırlı koridor, seçili yol alternatifleri ve örneklenmiş SOC hedefleri kullanılır. Adaptif SOC önizlemesi tam SOC ile ve rezervsiz, ayrı `upper_charge_preview` olarak hesaplanır; **kabul edilen sürüş geçişi değildir**. Her gerçek aday asıl SOC, rezerv ve şarj sonrası saat/hava ile yeniden hesaplanır. İyi bir planın keşfedilmiş olması küresel optimum kanıtı değildir.

Sürümlü geliştirme ayarları: 256 genişletilmiş durum, 2.048 bekleyen durum, 4.000 geçiş, en fazla 16 istasyon / 6 şarj durağı / 64 yol sorgusu / 4.000 hava sorgusu; %5 SOC adımı; 2→5→10 km koridor. Her değer açık optimizerOptions girdisidir; fiziksel katsayı veya üretim SLA'sı değildir. Hava bütçesi ayrıca preparation üst sınırıyla daraltılır. Durum/geçiş bütçesi koridor aşamaları arasında paylaşılır; provider sorgu/cache sayaçları aynı session'da kalır. Event-loop yield, caller iptali ve toplam request deadline vardır. Bu teslim üretim yoğunluk/concurrency kapasite kabulü değildir; executor sınırı ileride worker thread'e alınabilir.

Bağlantı süresi geliştirme politikasında 120 saniyedir; gerçek ölçüm değil açık politika varsayımıdır. Pozitif bağlantı süresinde kaynaklı `chargingModel.connectionModel` ve ortam kapsamı gerekir. Bağlantıda harcanan batarya kWh, gerçek charge-start SOC'sinden düşülür; rezerv kontrol edilir. Inlet enerjisine yanlışlıkla ikinci kez eklenmez. Örnek testte 0 saniye bağlantı yalnız sentetik ölçekli modeldir.

## Kapasite ve sıcaklık sürekliliği

Enerji çekirdeğinin `capacitySnapshot`'ı bütün seyahatte sabit tutulur. Profil/varyant/SOH ve orijinal sıcaklık modeli/faktörü doğrulanır; her şarjdan sonraki yeni sıcaklıkla kapasite paydası değiştirilmez. İç `continuation` girdisi modellenmiş leg başlangıcını kullanıcı ölçümünden ayırır. Orijinal yolculuğun 72 saat kalkış sınırı korunur; sonraki leg zamanı ilk hareket zamanı gibi yeniden yorumlanmaz.

Şarj motoru varsayılan olarak ayrılış batarya sıcaklığını unknown bırakır. Opsiyonel kaynaklı `isothermal_conditioned` kalibrasyonu, yalnız belirtilen başlangıç sıcaklığı ve ortam koşullarında kontrollü sabit sıcaklık senaryosunu taşıyabilir. Bu yeni bir ısınma modeli veya ön koşullandırma talebinin tamamlandığı kanıtı değildir. Source izin/koşul kapısı vardır; kullanıcı aracına otomatik atanmaz. Model yoksa sonraki leg bilinmeyen sıcaklıkla muhafazakâr hesaplanabilir, ancak sonraki şarjda sıcak eğri varsayılmaz; geçerli alternatif yoksa veri yetersizliği döner. Çok duraklı analitik testler açık TEST-ONLY termal model kullanır.

## Kuyruk ve sonucun anlamı

Tüm belirsiz kuyruklar actual `waiting.seconds=null`, toplam gerçek süre/ETA da null kalır. Ayrı `scenario` alanı, onaylanan sıfır bekleme senaryosunda leg/stop saatlerini taşır. Hava o saatlerde hesaplanır. Bilinmeyen erişim/açılış veya doluluk uyarıları korunur; dolu istasyon kalıcı arızalı gibi işaretlenmez. Bilinen saatler tüm şarj aralığında ve tarih istisnalarıyla denetlenir. Fiziksel giriş hâlâ doğrulanmamışsa katalog koordinatına yol bulunması giriş doğrulaması sayılmaz.

Her incumbent, başarılı olarak saklanmadan önce `planningEvaluationSchema` ile denetlenir: kullanıcı rezerv/hedefi, bütün leg kaynakları, SOC ve enerji/süre dengeleri, kaynak snapshot'ları, hardware/eğri referansı, kaynak zamanları ve gerçek/senaryo zaman çizelgeleri. Limitte yalnız bu doğrulanmış incumbent sunulur. `search` kapsamı, çözünürlük, bütçe/durdurma nedeni, sorgular, atlanan veri ve `optimality: not_proven` taşır.

- `planned`: koşulları ve arama sınırı belirtilmiş, doğrulanmış aday.
- `computation_limit`: bütçe doldu ve geçerli aday yok.
- `insufficient_data`: eksik profil/hava/ünite veya sınırlı alanda geçerli aday bulunamaması; küresel olanaksızlık iddiası yok.
- `provider_error`: başarısız/yanlış sağlayıcı cevabı; ulaşılamazlık değildir. Geçerli incumbent varken alternatif dalda sağlayıcı sorunu olursa sınırlı plan korunabilir.
- `infeasible`: yol sağlayıcısı başarılı biçimde hiç yol olmadığını doğruladığında. Bounded SOC/koridor aramasından genel fiziksel olanaksızlık türetilmez.

## Doğrulama

Son kontrol: **422 API/DB testi ve 38 ortak sözleşme testi geçti; atlanan yok.** API/mobil/shared TypeScript kontrolleri, API production derlemesi ve CLI ağsız replay başarılı. Yeni DB migration'ı veya yeni runtime bağımlılığı eklenmedi.

[Analitik referans/gerçek DB kapıları](validation/task13-optimizer-validation.json), [p95/p99](validation/task13-optimizer-benchmark.json).

Bağımsız exhaustive referans ayrı scalar ağ ve analitik taper integrali kullanır; production arama, enerji motoru, şarj integratörü veya sıralama fonksiyonunu çağırmaz. Açıkça ölçekli sentetik araç ve geometri kullanılır; Hyundai veya gerçek yol performansı iddiası değildir.

Örnek: 4 kWh sentetik kapasite, %40 başlangıç, %10 rezerv / %20 varış; 2 km ölçekli ağ ve 100→5 kW taper. Süre/düşük enerji çözümü iki kısmi şarj ile 235,2 saniye; az durak çözümü tek istasyonda %95 hedef ile yaklaşık 251,3896 saniyedir. Üç mod da bağımsız taramayla eşleşir. Ayrı testte daha uzun düz yol, hızlı ama eğimli yoldan daha az net kWh tükettiğinde enerji modu onu seçer.

Diğer testler: şarjsız plan, kullanıcının SOC girdileri, %80 üstü hedef, bilinmeyen sıcaklıkta ikinci şarjı zorlamama, kapasite snapshot sürekliliği, bağlantı tüketimi, koridor genişleme, fiziksel EVSE eksikliği, kapalı/erişimi olmayan/ortak güç tahsisi olmayan istasyon, hava ve hardware eksikliği, kopuk/yanlış senaryo, bütçe sonunda incumbent ve iptal. Kaydedilmiş provider snapshot'larıyla **ağ kapalı replay**, aynı yol/enerji/şarj/senaryo ve veri checksum'larını üretir; ölçülen CPU zamanı eşitlik beklentisine dahil değildir. Algoritma sürümü eşleşmeyen replay reddedilir.

1.000'er yerel sentetik plan: şarjsız p95 ≈30,8 ms / p99 ≈33,7 ms; iki kısmi şarj p95 ≈41,8 ms / p99 ≈48,7 ms. Bütün 2.000 örnek planned. Gerçek HTTP/DB gecikmesi veya üretim yükü ölçülmedi; latency sonucu gerçek tüketim doğruluğu değildir.

İki gerçek Hyundai pilotunda DB halen `VEHICLE_ENERGY_PROFILE_MISSING` veriyor; eksik veri ile gerçek Türkiye planı üretilmedi. CR-011/006 veri, CR-008 canlı feed/EVSE ve CR-022 saha kabulü açık kalır. CR-013'ün teknik kabulü bunları kapatmaz.

```powershell
pnpm --filter @chargeroad/api test:db --cache=false
pnpm --filter @chargeroad/api planning:validate
pnpm --filter @chargeroad/api planning:benchmark
pnpm --filter @chargeroad/api planning:replay ../../artifacts/task13-planning/replay.json
```

Replay dosyaları `artifacts/task13-planning` altında yerel/ignored kalır; gerçek yolculuk snapshot'ları konum ve kaynak verisi içerebilir. CLI en fazla 32 MiB dosya alır; public sağlayıcıya çağrı yapmaz. Üretim kalıcı seyahat depolama, sahiplik ve silme işlemleri ayrı görevlerdir.
