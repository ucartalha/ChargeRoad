# Hız, koşullar ve kişisel enerji profilleri

Tarih: 2026-11-10. Durum: Kullanıcının ürün/veri gereksinimleri kabul edildi; aşağıdaki teknik ayrıntılar uygulama planıdır. Kod, migration, telemetri toplama veya öğrenme sistemi bu belgede uygulanmış sayılmaz.

CR-006 teknik güncellemesi: Ortak referans/kanıt altyapısı ve kişisel profil/pencere/model Zod sözleşmeleri uygulandı; [kişisel DDL](schema/personal-energy.draft.sql) sahiplik temelini bekleyen taslaktır. Kullanıcı üç Ioniq 6 tüketim aralığını kWh/100 km olarak doğruladı; bunlar kendi varyantına bağlı source_reported gözlemler olarak saklandı. Aktif kişisel öğrenme veya navigasyon toplaması henüz yok. [Teslim](VEHICLE_KNOWLEDGE.md).

## Kabul edilen gereksinimler

- İzinli internet kaynaklarından farklı hızlardaki tüketim referansları alınacak.
- Planlanan yolun kesim bazlı hız sınırları ve beklenen hızları hesaba katılacak; navigasyondaki gerçek hızlarla tahmin güncellenecek.
- Yaklaşık 15 dakikalık hız özetleri geri besleme için kullanılabilecek.
- Kullanıcı profiline bağlı sürüş profilleri sonraki seyahatlere aktarılacak; kişisel veri araç konfigürasyonu ve koşullarla ayrılacak.
- Kişisel tüketim ile dış referans verisi birlikte kullanılacak. Yaz/kış ve diğer koşullar saklanabilecek.
- Kişiselleştirme şarj süresi tahminini de iyileştirmeyi hedefleyecek; sürüş tüketimi ile şarj kabul davranışı ayrı modellenecek.

## 1. Hız referansları ve yol kesimleri

Tek bir araç ortalaması yerine aynı konfigürasyona bağlı çok sayıda tüketim gözlemi tutulur. Sabit hız, seyir hedefi, hareketli ortalama ve toplam seyahat ortalaması aynı kavram değildir. Kaynağın test yöntemi ve hız tanımı kaydedilir.

Her gözlemde hız değeri/aralığı ve tanımı, tüketim kWh/100 km, enerji sınırı, test süresi/mesafesi, ortam/batarya sıcaklığı, HVAC, rüzgâr/eğim, yük, lastik/jant, mevsim etiketi, kaynak ve kalite bulunabilir. Bilinmeyen alan null/unknown kalır. Mevsim etiketi ölçülmüş sıcaklığın yerine geçmez; mevsimin atanma yöntemi/bağlamı saklanır, yalnız takvim ayından küresel mevsim varsayılmaz.

Yol kesiminde yasal hız sınırı, koşullu/zamana bağlı sınırın kaynağı, beklenen trafik/seyir hızı ve gözlenen gerçek hız ayrı tutulur. Yol motorunun geçmişte verdiği değer snapshot'ta kalır; yeni harita verisi eski seyahati sessizce değiştirmez. Sınır bilinmiyorsa sıfırla doldurulmaz. Planlanan seyir önerisi bilinen geçerli yasal sınırı aşmaz. Gerçek hız kaydı analizde yasal sınıra kırpılmaz; ölçülen davranışı değiştirmek tahmin hatasını gizler.

Enerji hesabı uygun hız/koşul referanslarıyla kesim kesim yapılacak. Tüm yolun ortalama hızını tek bir tüketim noktasına çevirmek yerine kesim enerji tahminleri toplanacak. Aralık dışı hızda sessiz extrapolation yapılmayacak; model/kalite politikası ve varsayım kaydı gerekecek. Hız sınırı ve gerçek zamanlı hız entegrasyonu CR-009/019, fiziksel enerji hesabı CR-011 kapsamındadır.

## 2. On beş dakikalık gözlemler

15 dakika bir başlangıç toplulaştırma politikasıdır; konum örnekleme/yükleme sıklığı veya her 15 dakikada bir rota değiştirme zorunluluğu değildir. Pencere süresi/yöntemi sürümlü ve ayarlanabilir tutulur. Kısa seyahat/son pencere, veri boşluğu ve şarj sınırı ayrıca işaretlenir. İç içe kayan pencereler bağımsız örnek sayılmaz ve aynı veriyi tekrar öğrenmeye sokmaz.

Önerilen pencere kaydı: seyahat, kişisel profil ve araç snapshot ID'leri; başlangıç/bitiş zamanı; geçerli süre/mesafe; hareketli ve toplam süre; dur-kalk/duruş oranı; zaman ağırlıklı hız istatistikleri; hız dilimlerinde geçirilen süre/mesafe; veri kapsaması ve GPS kalite bilgisi; hava/yol bağlamı; ölçülen/tahmin edilen enerji ve ayrı kaynakları; model sürümü.

Ortalama hız geçerli mesafenin karşılık gelen geçerli süreye bölünmesiyle hesaplanır. Düzensiz aralıklı GPS hızlarının basit aritmetik ortalaması kullanılmaz. Veri boşlukları varmış gibi tamamlanmaz. Aynı ortalama hıza sahip sabit seyir ve dur-kalk örnekleri hız dağılımı/duruş oranıyla ayrılır. İlk aşamada ivme/sert sürüş göstergeleri yalnız yeterli örnek kalitesi varsa türetilir.

GPS hızı enerji ölçümü değildir. Hız gözlemiyle kalan yol tahmini yeniden hesaplanabilir; fakat tüketim eğrisini bağımsız doğrulamak için batarya enerjisi veya SOC gözlemi gibi ek dayanak gerekir. Gelecekte araç telemetrisi/OBD, izinli manuel SOC girişleri veya belgeli tüketim ölçümü kullanılabilir. İki SOC gözlemi arasındaki enerji, kullanılabilir kapasite/SOH varsayımlarından etkilenir; ölçüm kesinliğiyle sunulmaz. Uzun aralıktaki tek SOC farkı 15 dakikalık pencerelere modelle dağıtılırsa bu pencereler ölçülmüş enerji etiketi alamaz.

Şarj içermeyen veya şarjın bataryada depolanan enerjisinin bilindiği eşleşmiş aralıklar tercih edilir. Kendi modelinin tahmini enerji çıktısı aynı modelin gerçek eğitim hedefi yapılmaz. Yalnız hız verisi varsa `speed_observed_energy_estimated` niteliğinde kalır; tüketim doğruluğu kanıtı sayılmaz.

## 3. Kişisel profil ve ortak referansın birleşmesi

Önerilen profil kapsamı: `sahip → sürüş profili → araç konfigürasyonu → koşullu model revizyonları`. Araç değişiminde eski öğrenilen eğri yeni araca taşınmaz. Aynı varyanttaki farklı kişisel araçların SOH/lastik gibi farkları da konfigürasyon snapshot'ıyla ayrılabilir. Garajdan çıkarılmış aracın geçmişi/model revizyonu yeni aktif araca yazılmaz.

Kişisel ve ortak eğri aynı hız, sıcaklık, enerji sınırı ve diğer geçerli koşullara normalize edildikten sonra birleştirilir. Önerilen deterministik kural:

`C_kesim = (1 - w) × C_referans(koşullar) + w × C_kişisel(koşullar)`

`E_kesim = C_kesim × mesafe_km / 100`

İlk kişisel veri yokken w=0. Kişisel veri oluşunca w; bağımsız seyahat sayısı, mesafe/kapsama, enerji hedefinin kalitesi, güncellik ve koşul benzerliğine bağlı olarak sınırlı artırılır. Referansın etkisi korunur; sabit %50/%50 varsayılmaz. Ağırlık fonksiyonu, üst sınırı, yaşlanma ve minimum örnek eşikleri sürümlü politika olacak; sayısal değerleri saha doğrulamasıyla CR-011/013'te seçilecek. Aynı seyahatin tekrar yüklenmesi veya kayan pencereler ağırlığı yapay artırmaz.

Mümkünse kişisel model ortak referansa göre kalan sapmayı öğrenir. Böylece hız/sıcaklık etkilerinin hem referansta hem kişisel katsayıda çift sayılması engellenebilir. Yöntem seçimi ve kalibrasyon CR-011 işidir. Eksik koşul kapsamasında başka mevsimden veri zorla kullanılmaz; referansa dönüş ve varsayım/kalite kaydı gerekir. Kullanıcı onayı olmadan bireysel kayıtlar ortak referans havuzuna katılmaz.

Her plan kullanılan ortak profil sürümü, kişisel profil sürümü, birleştirme politikası ve ağırlığın dayanağını sabitler. Mevcut seyahat içi kısa süreli düzeltme ile sonraki seyahatlere kalıcı öğrenme ayrı sürümlerdir. Tek gürültülü pencere kalıcı profili veya rota duraklarını aniden değiştirmez; minimum veri ve yeniden planlama kararlılık eşikleri sonraki algoritma görevlerinde uygulanır.

## 4. Şarj kişiselleştirmesinin sınırı

Sürüş profili şarj durağına varış SOC'si, varış zamanı, batarya termal tahmini ve kullanıcının durak tercihleri üzerinden şarj planını etkiler. Sürücünün tüketim katsayısı doğrudan şarj gücüne çarpılmaz. Hyundai, batarya koşullandırmasının batarya sıcaklığını optimize ederek şarj süresini azaltabildiğini belirtir: [üretici kılavuzu](https://ownersmanual.hyundai.com/full_webhelp/ce1/2025/en_us/topic_p5j_2xj_t5b.html). Bu kaynak pilotun tüm özelliklerini doğrulayan bir veri paketi değildir.

Kişisel şarj gözlemlerinde SOC başlangıç/bitişi ve zaman serisi, batarya sıcaklığı/ön koşullandırma, SOH, aracın şarj yolu, istasyon voltaj/akım/güç sınırı, saha paylaşımı, oturum kesintileri ve enerji sınırı tutulur. Kişisel alışkanlıklar (durak süresi/hedef SOC tercihi) ile aracın fiziksel kabul eğrisi ayrı veridir.

Saha/istasyon tarafından sınırlanan bir oturum aracın kabul eğrisini aşağı doğru öğretmez. Sadece toplam süre ve SOC uçları varsa koşullu oturum süresi gözlemi saklanabilir; gerçek SOC–güç eğrisi çıkarılmış sayılmaz. Yeterli ve karşılaştırılabilir oturum verisi oluşursa ayrı, sürümlü kişisel araç şarj modeli güncellenebilir. CR-012 fiziksel sınırları ve veri yeterliliğini denetler.

## 5. Önerilen mantıksal DB yapısı

Fiziksel isimler uygulama sırasında netleşebilir; aşağıdaki ayrımlar veri sahipliğini tanımlar.

| Yapı | Sorumluluk |
|---|---|
| Ortak tüketim referansları ve hız/koşul noktaları | Çok kaynaklı sabit hız veya seyahat gözlemleri; aynı varyantta birden fazla mevsim/sıcaklık/HVAC/lastik bağlamı |
| Referans model revizyonları | Noktalardan seçilen/türetilen ortak eğri; yöntem, kapsam ve kaynak sürümleri |
| Kişisel sürüş profilleri | Sahip, sürüş profili kimliği, araç konfigürasyonu/kişisel araç bağlantısı ve izin kapsamı |
| Sürüş pencereleri | Idempotent seyahat/pencere kimliği, zaman/mesafe/hız dağılımı, kalite, koşullar ve ayrı enerji gözlemleri |
| Enerji gözlemleri | Ölçülen/kullanıcı girişli/tahmini değer, ölçüm sınırı, zaman aralığı ve belirsizlik; pencereyle kanıt eşleştirmesi |
| Kişisel tüketim model revizyonları | Koşullu eğri veya referansa göre sapma; eğitim kapsamı, bağımsız seyahat sayısı, mesafe, kalite ve model sürümü |
| Şarj oturumları ve gözlemleri | SOC/zaman/güç/termal bilgiler ve EVSE sınırlaması; sürüş pencerelerinden ayrı |
| Birleştirme politikaları ve plan girdileri | Ortak/kişisel revizyonlar, ağırlık yöntemi/sürümü, kullanılan koşullar ve veri cutoff'u |

Filtrelenen sahip/profil/araç, zaman ve yayın sürümleri ilişkisel kolon ve indeks taşır. Hız histogramı ve değişken koşullar doğrulanmış JSONB olabilir. Bir kullanıcıya tek büyüyen JSON geçmişi yazılmaz. Çok sayıda pencere, birkaç seyahatin yerine bağımsız kanıt sayılmaz.

Önerilen erişim indeksleri: `(driving_profile_id, observed_at)`, `(trip_id, window_start)` ve `(profile_id, model_version)`; pencere tekilliği için olay/pencere politikası anahtarı. Kesin partition stratejisi gerçek veri hacmi ölçülmeden seçilmez. Özet model sürümleri ham telemetriyi her rota isteğinde taramadan okunur. Ağır öğrenme/kalibrasyon istek yolunda çalışmaz; sınırlı worker ve dayanıklı iş CR-021'de seçilecek. Redis zorunluluğu yoktur.

Kişisel veriler sahiplik ve açık kişiselleştirme izniyle ayrılacak. Hesap/garaj/geçmiş kuralları korunur; misafir geçmişi kaydı kendiliğinden hesap sürüş profili veya kalibrasyon izni oluşturmaz. Auth/sahiplik kontrolleri hazır olmadan kişisel model okuma/yazma endpoint'i açılmaz. Saklama, izin geri çekme, silme ve kişisel model geçersizleştirme birlikte tasarlanır; kalibrasyon bilgisi genel katalog API'sine sızmaz.

## 6. Task 6'ya eklenen teslim ve sonraki görevler

CR-006: Hız/koşul bazlı ortak referansların kalıcı şeması ve ingestion'ı; sürüş penceresi/enerji gözlemi/kişisel profil/birleştirme metadatası için veri sözleşmeleri ve DDL tasarımı; çok mevsimli çok referanslı okuma; ölçüm–tahmin ayrımı ve kalite testleri. Kişisel tabloların migration'ı mevcut sahiplik FK'lerine bağımlıysa CR-003/020 ile birlikte uygulanır; sahipsiz veya korumasız veri deposu açılmaz.

CR-009/010: Yol kesimindeki geçerli hız sınırı, trafik/beklenen hız ve zamanla eşlenmiş hava.

CR-011/013: Kişisel tüketim sapması/eğrisi, koşul eşleştirme, ağırlık politikası ve deterministik planlama birleşimi.

CR-012: Koşullu şarj modeli, oturum yeterlilik kontrolü ve ayrı kişisel araç şarj kalibrasyonu.

CR-017/019: İzinli telemetri, pencere üretimi, GPS kalitesi, enerji kanıtı ve seyahat içi düzeltme; bir hız penceresi otomatik yeniden rota zorunluluğu değildir.

CR-020/021: Erişim/izin/silme ve güvenilir arka plan kalibrasyonu. CR-022: Ayrı seyahatler ve yaz/kış koşullarında holdout doğrulaması, p95/p99 ve tahmin sapması. Eğitimde kullanılan seyahat doğrulama başarısı olarak yeniden sayılmaz.

Ek kabul örnekleri: aynı ortalama hız/farklı dur-kalk; yalnız GPS varken ölçülmüş tüketim üretmeme; yetersiz kış verisinde referansa dönüş; araç değişiminde öğrenme karışmaması; kaynak/tahmin/personal ağırlık izinin tekrarlanabilirliği; aynı pencerenin ikinci kez öğrenmeye girmemesi; başka hesaba erişim reddi; istasyon sınırlı oturumun araç kabul limiti diye kaydedilmemesi.
