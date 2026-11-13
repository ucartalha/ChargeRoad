# CR-013 — Şarj durağı optimizasyonu hazırlığı

2026-11-11 tarihli hazırlık; 2026-11-12 kararları ve [teknik teslim](STOP_OPTIMIZER.md) ile güncellendi. Üç mod, kullanıcı SOC sınırları, net sürüş enerjisi ölçütü, koşullu kuyruk senaryosu ve bütçede doğrulanmış incumbent sunumu kabul edildi. Aşağıdaki öneriler tarihsel hazırlığı açıklar; güncel davranış için teslim belgesine bakılmalı. [ADR-011](adr/011-planning-objectives-and-conditional-time.md).

## Amaç ve mevcut durum

Girilen konumlar, gerçek başlangıç SOC'si, araç profili, yol alternatifleri, hava ve uygun şarj noktaları üzerinden durakları ve her duraktaki ayrılış SOC'sini birlikte seçmek. Uygulamaya ait deterministik algoritma çalışacak; LLM bağımlılığı olmayacak.

Enerji ve DC şarj çekirdekleri, DB katalog/provider sınırları, yol/sapma, hava ve sözleşme doğrulamaları hazır. Üretim PlanningEngine bağlanmış değil. CR-011 gerçek pilot kalibrasyonu/saha kabulü ve CR-008 canlı feed/EVSE eşleştirmesi açık. Bağımsız XLSX'ler tam planlamaya hazır profil sağlamıyor. Statik ekipman/soket beyanı fiziksel EVSE, akım/voltaj ve ortak güç allocation'ı sayılmaz.

Teknik solver, sentetik tam veri ve mevcut gerçek yol/katalog snapshot'larıyla geliştirilebilir. Gerçek araç için yeterli enerji/şarj/donanım profili yoksa sonuç `insufficient_data`; genel maksimum kW ile eksik eğri tamamlanmaz. Teknik solver teslimi, gerçek Türkiye pilotunun uçtan uca kabulü değildir.

## Kabul edilen ürün kararları ve kalan öneriler

| Konu | Öneri | Ödünleşim / karar ihtiyacı |
| --- | --- | --- |
| Amaç — KABUL | Kullanıcı üç moddan seçer: süre, az durak, düşük enerji. Varsayılan süre | Modlar aynı zorunlu rezerv/uyumluluk/veri sınırlarına tabidir. Düşük enerjinin hangi enerji sınırı olduğu ve eşit sonuçlarda sıralama ayrıca netleştirilecek. Üç modun varlığı her istekte üç tam çözümün otomatik çalıştırılması kararı değildir. |
| SOC — KABUL | Minimum yol rezervi ve hedef varış SOC'sini kullanıcı her planlamada belirler | Önceki %10/%20 varsayılan önerisi kabul edilmedi; eksik alan gizlice doldurulmayacak. Başlangıç rezerv altında olursa normal planın zorunlu kısıtı sessizce gevşetilmeyecek. |
| Belirsiz kuyruk — KABUL | Gerçek bekleme `unknown` kalırken açıkça etiketlenmiş 0 dakika bekleme **senaryosunda** koşullu hesap | Senaryo zamanına göre planlar karşılaştırılır; gerçek minimum toplam süre/garantili ETA iddiası yapılamaz. Gecikmede hava/SOC tekrar değerlendirilir. |
| Şarj hedefleri — KABUL | Süre modu eğriye göre verimli kısmi şarjı arar; az durak modu %80 üstü hedefleri de değerlendirir | %10→80 sabit hedef veya zorunlu istasyon varış aralığı değildir. Kullanıcının rezervi %10'dan yüksekse o sınır geçerlidir. Süre modunda da gerektiğinde %80 üstü mümkün; hiçbir mod eğri kapsamını aşmaz. |
| İstasyon seçimi | Tüm DB'yi hesaplamak yerine PostGIS koridoru → erişim/uyumluluk → gerçek yol bağlantısı → gerektiğinde koridor genişletme | En yakın K istasyonu almak veya çok erken budamak iyi planı kaçırabilir. Karşı şerit/yol erişimi koordinat yakınlığından çıkarılamaz. |
| Bilinmeyen canlı durum | Önceki karar korunur: bilinmeyen uyarıyla aday; doğrulanmış arızalı/erişilemez dışarıda | Doluluk, erişim, çalışma saati ve kuyruk ayrı sinyallerdir. “Dolu” istasyon kalıcı arızalı sayılmaz; bekleme modelimiz yoksa koşullu/alternatif statü gerekir. |
| Kişisel model | İlk solver kabulü referans modelle; ayrı evaluator portu, sürümlü ve koşul eşleşen kişisel/genel model eklenebilir | Canlı kişisel öğrenme, izin/auth/storage hazır olmadan açılmaz. Model arama ortasında değişmez; fiziksel şarj limitleri tüketim residual'ıyla çarpılmaz. |
| Risk ve yedek | Keyfi olasılık cezası yerine açık veri kalitesi/risk sınıfı ve erişilebilir yedek bilgisi | Rezerv yüzdesi istatistiksel güven aralığı değildir. Kalibrasyon yokken %95 güven veya rastgele tüketim yüzdesi eklenmez. |
| Fiyat | Üç moddan biri fiyat değildir; fiyat varsa kaynağı/tazeliğiyle ayrı tahmini bilgi | Düşük enerji otomatik “en ucuz” değildir. Tarife/üyelik ve ücretlendirme bileşenleri bilinmeden maliyet optimumu iddiası yapılmaz. |

## Önerilen teknik ayrım

```text
PlanningCoordinator / veri hazırlama
  → kanonik araç ve sabit model/politika snapshot'ı
  → yol alternatifleri + koridor adayları
  → sınırlı, talep üzerine yol bağlantıları ve hava örnekleri
Deterministik arama
  → durum / sürüş / şarj geçişleri
  → EnergyConsumptionEngine + ChargingCurveEngine
  → birden fazla aday / açık arama bütçesi
Son plan doğrulaması
  → tam yol + duraklar + yeni saatlerde hava/SOC/termal durum
  → arama kapsamı, koşullar, eksikler ve açıklamalar
```

### 1. Coordinator ve yol bağlantıları

Mevcut `PlanningEngine.step` yalnız `weather_required` veya `result` döndürüyor. Coordinator başlangıçtaki yol/segment kimliklerini sabitliyor; solver'ın getireceği yeni istasyon bağlantıları otomatik kabul edilmez. Görev yalnız yeni bir arama sınıfı eklemekle tamamlanmaz.

Öneri: provider erişimini saf solver'ın dışında tutan veri hazırlama/graph katmanı ve sınırlı yol/hava ihtiyacı sözleşmesi. İstasyon bağlantıları gidiş ve dönüş yönünde gerçek RoutingProvider verisiyle oluşturulur; kesim kimlikleri ve provenance tüm plan girdisine dahil edilir. İki farklı şarj istasyonu arasında gerektiğinde gerçek bağlantı istenir; bütün istasyon çiftleri peşinen sorgulanmaz. Yol sapması final sürüş geometrisinin parçasıdır ve süre/enerjiye ikinci kez eklenmez.

### 2. Arama ve durum

İlk öneri: kaynak kısıtlı, birden çok etiketi saklayan deterministik arama; zamana yönelik güvenli alt sınır varsa A* benzeri önceliklendirme, yoksa güvenli sıfır alt sınır. Durum yalnız istasyon ID'si değildir: konum/bağlantı, enerji/SOC, senaryo zamanı, batarya termal durumu ve kullanılan model/politika bağlamı taşınır.

“Daha erken ve daha dolu” olmak, farklı hava/sıcaklık/erişim koşullarında her zaman diğer durumu eleme kanıtı değildir. Dominance yalnız aynı geleceğe etkili durum sınıfında ve doğrulanmış kuralla yapılır. Durum birleştirme/yuvarlama kalite kaybı yaratıyorsa yaklaşım olduğu raporlanır. Döngüler, etiket sayısı ve tekrar şarj geçişleri sınırlanır.

SOC discretization erişilebilirliği artıracak şekilde yuvarlanmaz: mevcut enerji aşağı, gereken enerji yukarı değerlendirilir. Adaptif hedefler son ayrıntılı hesapla doğrulanır. Şarj eğrisi düğümü tek başına optimum hedef garantisi değildir; bir sonraki durağa erişim ve gerekiyorsa ek çözünürlük de değerlendirilir.

Bilimsel arka plan: Değişken güçte şarj ve toplam seyahat süresini birlikte ele alan [Baum ve diğerleri, Shortest Feasible Paths with Charging Stops](https://arxiv.org/abs/1910.09812). Önerilen V1 uygulaması bu çalışmanın performans/optimalite iddialarını devralmaz; kendi test ve arama kapsamıyla ölçülür.

### 3. Zaman, kuyruk ve hava

Kuyruk senaryosu onaylanırsa `scenarioTimeline` ile gerçek bekleme/ETA ayrı sözleşmeler olmalı. Örneğin 0 dakika varsayımsal bekleme, gerçek bekleme gözlemi değildir. Mevcut sözleşmede unknown bekleme toplam süreyi null yapıyor; sonraki kesimlerin enerji/hava zamanları ise kesin timestamp gerektiriyor. Bu çelişkiyi null'ı sessizce 0'a çevirerek çözmeyeceğiz.

Şarj ve bağlantı süreleri sonraki kesimlerin saatini değiştirir; hava doğru geçiş saatinde yeniden örneklenir. İlk güncellemelerden sonra aday sırası değişebilir; sınırlı iterasyon ve son planın yeniden doğrulanması gerekir. Yakınsama yoksa veya senaryo saatinde hava kapsamı bitiyorsa eski hava ile plan “tamamlandı” sayılmaz. Önümüzdeki 72 saat hareket politikası ve tüm seyahatin kaynak tahmin ufkunda kalması ayrı denetlenir.

Otomatik termal model veya koşulu belli eğri bulunmayan bir durakta sıcak batarya varsayılmaz. Ön koşullandırma talebi tamamlanma kanıtı değildir. Bunu aşmak için gizli “batarya 30°C” varsayımı eklenmez; koşullu model seçeneği ayrıca onay ve kaynaklı kalibrasyon gerektirir.

### 4. Sonuçların anlamı

- Tam doğrulanmış aday varsa plan, koşullar ve arama kapsamıyla döner. Bütçe sonunda elde edilen geçerli en iyi adayın döndürülmesi için `searchComplete`, yaklaşık arama ve durdurma nedeni metadatası gerekir; küresel optimum denmez.
- Bütçe doldu, geçerli aday bulunamadı: `computation_limit`.
- Eksik profil/EVSE/hava/kapsama: `insufficient_data`.
- Sağlayıcı transport hatası: `provider_error`; yolun/enerjinin olanaksızlığı değildir.
- `infeasible` ancak tanımlı ve yeterli veriyle kapsanmış arama alanında olanaksızlık ispatlanıyorsa; kesilmiş koridorda aday yokluğu Türkiye genelinde ulaşılamazlık değildir.

### 5. İşletim

Mevcut paylaşılan PostgreSQL cache/kota/lease katmanı korunur. Redis bu görev için otomatik gereksinim değil. HTTP async olması CPU hesabını paralel hale getirmez: solver deadline, düzenli yield, iptal, sınırlı concurrency ve ölçülmüş etiket/geçiş bütçesi kullanır. Gerekirse `SolverExecutor` sınırı üzerinden worker thread'e taşınabilir; sağlayıcı/DB mimarisi baştan yazılmaz.

Tüm yol çiftleri/SOC hedefleri/alternatifleri için sınırsız HTTP başlatılmaz. İstek başı dış sorgu ve iş bütçeleri ayrıca belirlenir; p95/p99 başarılı planlar ve tüm talepler için ayrı raporlanır. Hedef milisaniye sayısı henüz üretim SLA'sı olarak onaylanmadı.

## Önerilen alt teslimler

1. CR-013.1: Amaç/SOC/kuyruk senaryosu ve kalite kararları; sözleşme ve sonuç metadatası.
2. CR-013.2: Yönlü istasyon bağlantıları, final yol oluşturma ve provider/veri ihtiyacı sınırı.
3. CR-013.3: Sürüş/şarj geçişleri, durum/etiket araması, adaptif SOC hedefleri ve bütçe.
4. CR-013.4: Şarj sonrası zaman/hava/termal yeniden değerlendirmesi ve bütün plan validator'ı.
5. CR-013.5: Küçük ağ exhaustive referansı, replay, başarısızlık/gürültü ve p95/p99 testleri.
6. CR-013.6: Gerçek veri yeterlilik raporu; sentetik teknik kabul ile saha kapılarının ayrı kaydı.

Kabul senaryoları: başlangıç SOC değişince durakların değişmesi; şarjsız/tek/çok durak; yavaş yakın ve hızlı uzak istasyon; sabit %80'in iyi olmadığı örnek; %80 üstü şarj gerektiren yol; karşı şerit/erişilemez istasyon; bilinmeyen kuyrukta koşullu zaman; şarj gecikmesinde hava ve aday sırasının değişmesi; soğuk batarya; arızalı/unknown istasyon; dar koridor/kesilmiş aday seti; kaynak hatası; deadline ve kullanıcı iptali; aynı snapshot replay'i; küçük tam ağda exhaustive yöntemle karşılaştırma.

## Karar durumu

Son yanıtla düşük enerji ölçütü net sürüş batarya enerjisi, bütçe davranışı ise yalnız tam doğrulanmış incumbent'ı sınırlı arama etiketiyle sunmak olarak kabul edildi. [Teknik teslim](STOP_OPTIMIZER.md) uygulama/tolerans/bütçe ve test kapsamını kaydeder; saha veri kapıları açık kalır.
