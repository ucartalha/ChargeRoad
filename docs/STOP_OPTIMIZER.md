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

Seed yedeği (`chargeroad-optimizer/1.3.0`, 2026-11-17): bir durumdan menzil ipucuyla seçilen ilk `seedAttempts` aday denemesi bataryayı tüketirse, bu başarısız bacakların rezerv altına düşmeden kat ettiği en uzak ana-rota ilerlemesi alınır ve o mesafenin içindeki denenmemiş adaylar en uzaktan başlayarak (`seedFallbackCandidates`, en fazla `seedAttempts`) denenir. Yalnız sıralamadır; hiçbir geçiş sertifikalanmaz veya budanmaz, birincil denemeler başarılıysa davranış 1.2.0 ile aynıdır. Gerekçe: yükseklik verili rotada (Valhalla 8004) İstanbul→Ankara 3 durak gerektirdi; 1.2.0 seed'i yakın adayları %100 hedefiyle hiç denemediği için plan bulunamıyordu, 1.3.0 ile planned (3 durak) ([teşhis](validation/dem-segmentation-2026-11-17.md)). Bilinen açık: geniş arama bütçesinin büyük kısmı başlangıca yakın, SOC'si yüksek bir istasyonda tüketiliyor (8004'te 471 adımın 426'sı); arama sırası değişikliği ayrı iş olarak bırakıldı.

Özdeş şarj durumları (`chargeroad-optimizer/1.4.0`, 2026-11-17): bir şarj her EVSE/soket için ayrı durum döndürür; katalog senaryosunda bunlar çoğu zaman sayısal olarak özdeştir. Sonraki her sürüş için aynı olan durumlar (istasyon, SOC, kalkış saati, batarya sıcaklığı, kapasite) seed, geniş arama ve hedef iyileştirmede ilk bulunan tutularak tek duruma indirilir (`distinctChargedStates`). Eşitlikte zaten ilk bulunan kazandığı için bağlayıcı olmayan bütçede plan aynıdır (3 özdeş EVSE = 1 EVSE testi). Bu, CR-PERF-004'teki baskınlık budaması değil, yalnız sayısal kopyaların birleştirilmesidir. Referans rotalarda (8004, aynı hava cache'i) planlar değişmedi; sürüş adımı 457→116 (İstanbul→Ankara) ve sunucu süresi ~2–3 kat azaldı. Aynı denemede A\* sıralaması (kalan sürenin kuş uçuşu/160 km/sa alt sınırı) sonuç değiştirmediği için alınmadı; hava projeksiyon bütçesini 4 katına çıkarmak da planları değiştirmedi. [Kanıt](validation/optimizer-dedup-2026-11-17.md).

İki seed stratejisi ve SOC durak kuralı (`chargeroad-optimizer/1.5.0`, `catalogue-scenario` `seedReachFractions:[.9,.6]`, `soc-stop-rules/1.0.0`, 2026-11-17, kullanıcı kuralı): seed zinciri iki menzil oranıyla kurulur — önce uzak sıçramalar (0,9; önceki tek strateji), sonra daha yakın duraklar (0,6). Her stratejinin tamamlanan zinciri ayrı ayrı `improveFixedStopTargets` ile iyileştirilir (en iyiden başlayarak); ikinci strateji ve iyileştirmeler mevcut planı yalnız kesin olarak daha iyi bir planla değiştirir, bu yüzden seed eklemek planı kötüleştiremez. Konfor kuralı: varış SOC'si %50 veya üzerindeyken şarj durağı açılmaz (seed, hedef iyileştirme ve geniş arama). Kural yüzünden hiç plan bulunamazsa ve kural gerçekten bir şarjı engellediyse arama aynı süre sınırıyla bir kez kuralsız tekrarlanır ve plan `soc_stop_rule_relaxed` uyarısı taşır: fiziksel olarak mümkün yolculukta plan her zaman üretilir. Referans rotalarda (8004, aynı hava cache'i; başlangıç %70/%95/%100) 12 vakanın hiçbiri kötüleşmedi; İstanbul→İzmir %95 571 km / 436,1 dk → 480,6 km / 367,6 dk, İstanbul→Ankara %70 408,7 → 377,6 dk. Bilinen açık: İstanbul→İzmir %100'de plan 1.4.0 ile aynı (571 km / 434,8 dk); daha kısa koridor yalnız %58 varışlı bir ara şarjla bulunuyordu ve kural bunu artık yasaklıyor. [Kanıt](validation/seed-strategies-2026-11-17.md).

Varış hedefi yedeği (`chargeroad-optimizer/1.6.0`, `arrival-target-fallback/1.0.0`, 2026-11-17, kullanıcı kuralı): arama algoritması 1.5.0 ile aynıdır (kaynak hash'i aynı); değişiklik planlama servisindedir. İstenen varış hedefiyle tüm koridorlar plan bulamazsa ve oturum varışa rezervle ulaşıp hedefi tutturamayan tam değerlendirilmiş bir bacak gördüyse (`arrivalTargetMissed`), hedef `arrivalTargetSteps` sırasıyla (ör. 80→75→…→rezerv) düşürülüp koridor döngüsü yeniden çalışır; her denemede durum/geçiş bütçesi sıfırlanır, toplam süre oturum son tarihiyle sınırlıdır. İlk plan bulunan hedef kullanılır ve plana `arrival_target_lowered` eklenir; değerlendirme kullanıcının istediği hedefe göre yapılır. 5 puanlık adım nedeniyle bulunan hedef ulaşılabilir en yüksek değerin en fazla 5 puan altında olabilir. Referans rotalarda %80 hedef doğrudan karşılandı (yedek tetiklenmedi); yedek yalnız sentetik testte doğrulandı. [Kanıt](validation/arrival-target-fallback-2026-11-17.md).

İstasyon havası örnek sınırı (`chargeroad-optimizer/1.6.1`, 2026-11-19): arama kaynağı aynı; değişiklik `PlanningSession.weather`'da. Şarj sırasında istasyon için yapılan hava sorgusu, rota boyunca daha önce alınmış en yakın seriyi yalnız hava servisinin kabul ettiği 10 km köken sınırı içindeyse kullanır; değilse istasyonun kendi konumu sorgulanır. Önceden 15 km'ye kadar bağlanıyor, servis 10–15 km aralığını `outside_horizon` sayıyordu; istasyon şarj edemiyor (`STATION_WEATHER_UNAVAILABLE`), arama bütçeyi boş sürüşlerde tüketip `NO_VALID_PLAN_WITHIN_DATA_BUDGET` dönüyordu. Telefondan İstanbul(Kadıköy)→Kelkit isteği bu yüzden plansız kaldı; düzeltmeyle 1.302,6 km / 1.103 dk planlandı. Fatih başlangıçlı plan birebir aynı; Ümraniye başlangıçlı plan arama yolu değiştiği için 870,6 → 920,6 dk oldu (bütçeye bağlı arama kırılganlığı; B aşamasında ele alınacak). Test: `station-weather-sample.spec.ts`. Ayrı açık: rota geometrisi 20.000 noktayı aşan uzun rotalar istasyon sorgusunda `Station geometry budget exceeded` ile `STATION_PROVIDER_FAILED` veriyor (B: koridor sorgusunu sadeleştirilmiş geometriyle yapmak).

Gereksinim kadar şarj, tek koridor, geniş arama payı (`chargeroad-optimizer/1.7.0`, 2026-11-19, kullanıcı raporu: "en kısa süre" seçiliyken iki kez %100 şarj ve daha kısa bir rota varken uzun yol):
- **Tohum şarjı gereksinim kadar** (`SEED_TRIM_POLICY`, `seed-charge-trim/1.0.0`): süre/enerji hedeflerinde tohum zinciri bir durağı hızlı bandın (%80) üzerine şarj ettiyse, doğrulanmış sonraki bacağın gerçekten gerektirdiği SOC + 0,05 puana (0,01'e yukarı yuvarlanmış; `improveFixedStopTargets` ile aynı çapa) yeniden şarj edilir ve bacak yeniden sürülüp doğrulanır. Kazanç 1 puandan azsa ya da yeni hedef doğrulanamazsa eski durak kalır. "En az durak" hedefi değişmez.
- **Tek koridor** (planlama servisi): istasyonlar yalnız tek bir temel rotaya göre aranır ve eşleştirilir; o rotada plan yoksa sıradaki Valhalla alternatifi aynı döngüyle denenir. Önceden iki alternatifin istasyonları karışıyor, bacaklar koridorlar arasında geçip rotayı 70–120 km uzatıyordu.
- **Geniş arama payı** (`BROAD_SEARCH_POLICY`, `broad-search/1.0.0`): doğrulanmış bir plan (incumbent) varken geniş arama en fazla 3.000 hava projeksiyonu (segment × sürüş) harcar. Referans uzun rotalarda sınırsız geniş arama daha iyi plan bulmadı ama 2–3 s harcadı; küçük grafikler (referans testleri ~100 ucuz sürüş) kesin optimumlarına ulaşmaya devam eder.
- **Erişim sapması tavanı** (`STATION_ACCESS_POLICY` `station-access/1.1.0`, `catalogue-station-scenario.ts`): bir ilerleme bölmesinde kabul edilebilir (≤3 km/3 dk) istasyon yoksa en küçük sapma yalnız ≤15 dk ise bölme adayı olur; üstündekiler aday listesine en son, yer kalırsa girer. İzmir referansında 90,6 km erişim sapmalı bir istasyon tohum tarafından kullanılıp planı 569 km / 415 dk yapıyordu; düzeltmeyle 478,9 km / 344,6 dk.

Kanıt ve sınırlar: [planning-b-2026-11-19.md](validation/planning-b-2026-11-19.md). Optimallik hâlâ `not_proven`; İstanbul→Kelkit süreç-içi süresi 5 s hedefinin üzerinde kaldı.

İstasyon uç toleransı ve hava çağrı bütçesi (`chargeroad-optimizer/1.7.1`, 2026-11-19): arama kaynağı 1.7.0 ile aynı (hash aynı).
- `ROAD_ENDPOINT_POLICY` (`road-endpoint/1.0.0`, `planning-session.ts`): yol bacağı başlangıç/varış noktasına 100 m, istasyon düğümüne 250 m içinde başlamalı/bitmelidir. Katalog koordinatı yoldan ~100 m içeride olan istasyonlar (3ffb3120: 100,0 m) önceden tüm bacaklarda reddediliyordu. Kalan otopark mesafesi enerji modelinde sürülmez; `station_road_endpoint_gap` olarak raporlanır.
- Self-hosted hava sağlayıcısının plan başına çağrı bütçesi 128 → 1.024 ([WEATHER_PROVIDERS.md](WEATHER_PROVIDERS.md)).

Referans planlar (5 rota) 1.7.0 ile özet + segment SOC hash'inde birebir aynı. [Kanıt](validation/planning-1.7.1-2026-11-19.md).

Durak sınırı, iyileştirme payı ve son durak (`chargeroad-optimizer/1.8.0`, 2026-11-19, telefon İstanbul→Erzurum ~%40 SOC: `computation_limit`):
- `STOP_LIMIT_POLICY` (`stop-limit/1.0.0`): sabit 6 durak sınırı 7–8 duraklı yolculuğu imkânsız kılıyordu. Planlama servisi sınırı ⌈rota km ÷ menzil km⌉ + 1, [6, 12] olarak yükseltir (menzil: planlama hava menzil tahmini; bilinmiyorsa 8). Çağıranın değeri taban kalır.
- Tohum stratejileri: uzak menzil zinciri rota sınırıyla; ardından (rota sınırı 6'yı aşıyorsa) 6 duraklı uzak zincir; sonra diğer menziller (ilk zincir plan bulmasa da çalışır). En iyi zincir kazanır ve iyileştirilir.
- `IMPROVE_RESERVE_POLICY` (`improve-reserve/1.0.0`): ilk plandan sonra hava projeksiyon bütçesinin %30'u kalana kadar tohum devam eder; kalan iyileştirmeye ayrılır.
- `improveWeatherAllowance`: iyileştirme payı `maxWeatherQueries` (örnek noktası birimi) yerine oturumun uyguladığı projeksiyon bütçesinden hesaplanır. Eski kural uzun rotalarda 0 veriyordu (%100 duraklar, %35–62 varış).
- Son durağa gereksinim kadar şarj: iyileştirmeden sonra en iyi planın son durağı varış hedefi + pay kadar şarj edilir (`seed-charge-trim/1.1.0`: 0,05 → 2 → 5 puan pay denemesi), motorla yeniden doğrulanır, yalnız daha iyiyse kabul edilir.
- Yedek koridor rotası kendi yol/hava bütçeleriyle aranır (önceden ilk rotanın tükenmiş bütçesiyle hiç aranamıyordu).

20 karşılaştırmada (14 rota, farklı başlangıç SOC): 4 plansız durum planlandı (Erzurum %40, Kelkit %40, Ankara→Van…), 10 durum 2,6–92,8 dk iyileşti, Ankara→Trabzon +0,5 dk, diğerleri aynı. [Kanıt](validation/optimizer-1.8.0-2026-11-19.md).

Durak cezası, durak eleme, menzil ön kontrolü (`chargeroad-optimizer/1.9.0`, 2026-11-19, telefon İstanbul→Erzurum: 9 durak, 1.–2. durak 61 km arayla, 8. durakta biraz daha şarjla gereksiz kalacak 9. durak):
- `STOP_PENALTY_POLICY` (`stop-penalty/1.0.0`, kullanıcı kararı): "en kısa süre" planları **sıralanırken** her durağa 6 dk eklenir; gösterilen süreler fiziksel kalır. Cezalı süreler 60 s'den az farklıysa daha az duraklı plan kazanır (yakın eşitlik kuralı; zincirleme yakın eşitliklerde geçişli değildir). Geniş arama budaması aynı cezalı süreyi kullanır.
- `STOP_ELIMINATION_POLICY` (`stop-elimination/1.0.0`): iyileştirme ve son durak düzeltmesinden sonra en az şarj eden duraktan başlayarak her durak, önceki durak iki bacak + gerekli varış + 2/5/8 puan pay kadar şarj edilerek kaldırılmaya çalışılır; kalan yolculuk motorla yeniden sürülür, yalnız daha iyiyse kabul edilir (en fazla 8 deneme, 3 tur).
- `REACH_PREFILTER_POLICY` (`reach-prefilter/1.0.0`): koridor mesafesi 2,5 × (SOC − rezerv) × menzil tahmini (taban 150 km) + 25 km'yi aşan bacaklar sürülmez. Önce hava bütçesinin %79'u varılamayan bacaklara gidiyordu.
- %50 kuralı gevşetilmiş ikinci arama kendi yol/hava bütçeleriyle çalışır (`resetSearchBudgets`): %20–25 rezervde ilk istasyon %50 üstünde kaldığında plan artık bulunur (uyarıyla).
- Yan etki: bir durağı kaldırmak için bazı planlarda tek bir durakta %100'e şarj önerilebilir (daha az durak + daha kısa cezalı süre).

20 durumda: kullanıcı isteği 9→7 durak (+4,5 dk), 10 durumda 1–2 durak az (en fazla +3,7 dk), 3 durumda süre de kısaldı, %20 rezerv Erzurum planlandı, diğerleri aynı. [Kanıt](validation/optimizer-1.9.0-2026-11-19.md).

Denenip reddedilenler (2026-11-20, sürüm 1.9.0'da kaldı): ölçülen tüketimle sıkılaştırılmış üst menzil sınırı (fayda yok; 1.9.0 sınırı zaten gerçekçi menzilin ~1,3 katı) ve en kötü menzil altındaki istasyonları eleyen menzil penceresi (20 durumda 5 planlanamadı, 11 kötüleşti). [Kanıt](validation/reach-bounds-rejected-2026-11-20.md). Sürüş başarısızlık hafızası da (aynı düğümden, daha az şarjla, daha uzun yola sürmeme) planı değiştirmedi ama yalnız %4 bütçe kazandırdı; reddedildi. [Kanıt](validation/failure-memory-rejected-2026-11-20.md).




Erişim sapması kontrollü aday seçimi (`catalogue-scenario/1.2.0`, `station-access/1.0.0`, 2026-11-17, kullanıcı kararı: 3 km / 3 dk): rotaya kuş uçuşu çok yakın (≤130 m) istasyonlar bile karşı yöndeki tesiste olduğunda kavşaktan dönüş nedeniyle büyük sapma doğuruyordu (İstanbul→Ankara'da tek durak +36 km). Katalog senaryosunda 16 ilerleme diliminin her biri için adayların erişim sapması gidiş yönünde ölçülür: ana rotada istasyonun 1 km öncesi → istasyon → 1 km sonrası, iki bacak olarak yerel yol sağlayıcısından (`selectAccessibleCandidates`). Dilimde, mevcut sıralamaya (rotaya ≤100 m, sonra DC gücü) göre ilk ≤3 km ve ≤3 dk ek sapmalı aday seçilir; ilk 3 adayda yoksa 6'ya kadar bakılır; hiçbiri kabul edilebilir değilse plan mümkün kalsın diye en az sapmalı aday tutulur. Ölçümler en fazla 4 eşzamanlı, plan başına istasyon başına bir kez yapılır; ölçülemezse `STATION_ACCESS_UNMEASURED`. Planlanan durağın `detourDistanceMeters`/`detourDrivingSeconds` alanları artık bu ölçümle doldurulur (sürüş süresi zaten bacaklarda); ölçüm yoksa eski `included_in_road_not_separately_quantified` kalır. Doğrulanmış donanım (`verified_hardware`) yolunda seçim değişmedi. [Kanıt](validation/station-access-2026-11-17.md).

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
