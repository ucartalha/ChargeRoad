# CR-003: Hesap, garaj ve seyahat verisi tasarımı

Tarih: 2026-11-10. Durum: Ürün kuralları kabul edildi; aşağıdaki teknik tasarım öneridir. Bu belge migration veya çalışan auth/geçmiş sistemi değildir.

## Kabul edilen kurallar

- Misafir kullanıcı rota ve navigasyon kullanabilir; garaj oluşturamaz.
- İlk hesap giriş yöntemi e-posta ve şifre. Google girişi daha sonra eklenecek.
- Ücretsiz hesapta bir aktif garaj aracı bulunabilir; kullanıcı bu aracı değiştirebilir.
- Hesaplı garaj farklı cihazlarla eşitlenecek. Premium için genişlemeye uygun model kurulacak; premium araç adedi ve diğer hakları henüz belirlenmedi.
- Misafirlerin ayrıntılı seyahat geçmişi sunucuda güvenli misafir oturumuna bağlı tutulacak; hesap açılınca aktarılabilecek.
- Ayrıntılı seyahat geçmişi ve yolculuk sonu enerji/tüketim/maliyet raporları saklanacak.
- Redis bu aşamada eklenmiyor. Transaction, indeks, sınırlı eşzamanlılık ve yük ölçümü tasarımın parçası.
- Ayrıntılı geçmiş saklama, verinin otomatik olarak model eğitimi/kalibrasyonu için kullanılmasına verilmiş onay değildir.

## Mevcut prototiple fark

Mobil prototip bugün giriş olmadan araç ID'sini AsyncStorage'da saklıyor. Bu davranış yeni garaj kuralının tamamlanmış uygulaması değildir. Auth entegrasyonunda misafirin rota için geçici araç seçmesiyle hesaplı kullanıcının sunucuda garaj kaydetmesi ayrılacak. Mevcut yerel seçimi sessizce bulut garajına dönüştürmeyeceğiz; kullanıcı onayıyla ücretsiz tek slota alınabilecek.

## Önerilen veri alanları

| Alan | Tablolar / sorumluluk | Temel sınır |
|---|---|---|
| Hesap | accounts, auth_identities; yerel auth seçilirse password_credentials | İç hesap ID'si e-posta veya Google ID'si değildir |
| Oturum | account_sessions, guest_sessions | Kimlik doğrulama ve kaynak sahipliği ayrı |
| Veri sahipliği | data_owners | Hesap öncesi geçmişin sahibi de bulunur |
| Haklar ve garaj | account_entitlements, garage_slots, garage_entries | Misafir için slot yok; ücretsiz hesap için tek aktif slot |
| Araç enerjisi | Sürümlü tüketim referansları, şarj yolları, koşullu eğriler | Kaynak aktarımı doğrulanmış model verisini ezmez |
| İstasyon | stations, evses, connectors, power_pools, availability_observations | Statik katalog ile anlık gözlemler ayrı |
| Seyahat | trips, trip_plan_versions, trip_events, trip_samples | Sıcak durum satırı, plan snapshot'ı ve yoğun telemetri ayrı |
| Şarj ve fiyat | trip_charging_sessions, tariff_versions, cost_components | Bataryada depolanan enerjiyle ücretlendirilen enerji ayrı |
| Rapor | trip_summary_versions | Hızlı listeleme; hesap yöntemi ve veri kalitesi korunur |

Bunlar mantıksal isimlerdir; nihai migration isimleri ve ayrıntıları uygulamada netleşecek. Her aday tablo yalnızca gerçek okuma/yazma ihtiyacı varsa eklenir.

## Hesap ve gelecekte Google

accounts sabit iç ID taşır. auth_identities içinde sağlayıcı + sağlayıcının değişmez subject değeri benzersiz olur; bir hesap daha sonra birden fazla giriş kimliğine bağlanabilir. Sadece e-posta eşleşti diye Google kimliği mevcut hesaba otomatik bağlanmaz; güvenli hesap bağlama akışı gerekir.

E-posta/şifre bir ürün kararıdır; kendi auth modülümüz ile yönetilen sağlayıcı arasında seçim henüz yapılmadı. Kendi modülümüz seçilirse şifre ayrı credentials tablosunda, uygun bir parola hash'iyle tutulur; düz metin veya geri çözülebilir şifreleme kullanılmaz. Argon2id adaydır; maliyet parametreleri hedef sunucuda ölçülür. [OWASP parola rehberi](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

Oturum önerisi: kısa ömürlü erişim kimliği + sunucuda hash'i tutulan, döndürülen ve iptal edilebilen yenileme kimliği. Token biçimi, süreler, e-posta doğrulama/sıfırlama servisi ve sağlayıcı seçimi DEC-002/004'te açık kalır. Auth sırları cihazın güvenli deposunda tutulmalı; mevcut araç tercihi için kullanılan AsyncStorage'a yazılmaz. [OWASP oturum rehberi](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

## Misafir sahipliği ve hesaba aktarım

Öneri: trips kalıcı bir data_owner_id'ye bağlanır. data_owners kaydı hesaplı kullanıcıya bağlı olabilir veya henüz hesabı olmayan misafir verisinin sahibi olabilir.

Misafir erişimi rastgele, yüksek entropili ve iptal edilebilir bir oturum sırrıyla doğrulanır. DB'de token'ın kendisi yerine doğrulama hash'i tutulur. İstemcinin gönderdiği owner ID, cihaz ID'si veya trip ID tek başına erişim sağlamaz.

Hesaba aktarım:

1. Hem misafir oturumu hem hedef hesap doğrulanır; aktarım kullanıcının açık işlemi olur.
2. Tek sahiplik satırı kilitlenir; daha önce başka hesaba bağlanmadığı doğrulanır.
3. Sahiplik hesaba bağlanır ve eski misafir erişimi iptal edilir.
4. İşlem tekrar geldiğinde aynı sonuç döner; başka hesaba ikinci aktarım reddedilir.

Seyahat noktaları trip_id ile bağlı kalır. Böylece milyonlarca telemetri satırındaki sahip alanını tek tek güncellemeden aktarım yapılabilir. Bir hesabın ana sahipliği ve sonradan aktarılan misafir sahiplikleri bulunabilir; hesap geçmişi bu sahiplikler üzerinden sorgulanır.

Oturum sırrı kaybolan misafir geçmişini yalnızca cihaz kimliğinden geri açmayacağız. Kurtarma, oturum süresi ve sahipsiz geçmişin saklama süresi ayrıca kararlaştırılmalı.

## Ücretsiz tek araç ve değiştirme

Öneri: Hesap için izinli garage_slots tanımlanır; ücretsiz hesapta yalnızca slot 1 açılır. garage_entries ilgili slota ve katalog varyantına bağlanır. Her slotta en fazla bir arşivlenmemiş kayıt partial UNIQUE indeksle korunur.

Hak kontrolü yalnızca arayüz veya istemciden gelen premium alanıyla yapılmaz. Slot tahsisi sunucu hak kaydına göre yapılır. Premium rollout'u ve üst sınırları belirlenmeden ek slot açılmaz.

Değiştirme işlemi kısa bir transaction içinde:

- Hesabın hak/slot satırını tutarlı kilit sırasıyla kilitle.
- İstek tekrarını ve beklenen garaj sürümünü kontrol et.
- Yeni katalog varyantının uygunluğunu doğrula.
- Önceki aktif kaydı arşivle, aynı slota yeni kayıt oluştur.
- Tek işlem olarak commit et.

Böylece iki cihazdan eşzamanlı değişiklik ücretsiz sınırı aşamaz; eski sürüme dayanan ikinci işlem sessizce ilkinin üzerine yazmaz. PostgreSQL satır kilitleri ve partial UNIQUE indeksleri bu yaklaşımın yapı taşlarıdır. [Kilitler](https://www.postgresql.org/docs/16/explicit-locking.html), [partial indeksler](https://www.postgresql.org/docs/16/indexes-partial.html)

Geçmiş seyahat kendi araç varyantı ve enerji modeli snapshot'ını taşır. Kullanıcı garaj aracını değiştirince eski yolculuğun aracı, tüketimi ve maliyeti değişmez.

## Seyahat yazma ve transaction sınırları

- trips: Son kabul edilen olay, aktif plan sürümü, durum ve özet alanları. Her konumda büyük plan JSON'u yeniden yazılmaz.
- trip_plan_versions: Değişmez sürümler; sorgulanan metadata kolonlarda, yeniden üretim için plan/veri snapshot'ı gerektiği yerde JSONB.
- trip_events: Şarj düzeltmeleri ve durum değişiklikleri; idempotency anahtarı ve sıra bilgisi.
- trip_samples: Konum, doğruluk, hız ve mevcut batarya sinyalleri; measured/user_input/estimated kaynağı korunur.

Plan hesabı ve dış HTTP çağrıları DB transaction'ının dışında yapılır. Sonucu yazarken aktif plan/olay sürümü hâlâ beklenen değerdeyse commit edilir. Sürüm değiştiyse eski sonuç uygulanmaz.

Transaction bütünlüğü gereken sorgular aynı client ile yürütülür; hata halinde rollback, sonunda release gerekir. Aynı transaction client'ına Promise.all göndermek bağımsız DB paralelliği sağlamaz. Pool boyutu ve toplam API/worker bağlantı bütçesi ölçülerek seçilir. [node-postgres pooling](https://node-postgres.com/features/pooling)

Eşzamanlı işlemler için kilit alma sırası tanımlanır; lock/statement timeout ve yalnızca uygun, tekrar güvenli işlemler için sınırlı retry uygulanır. Kullanıcı yanıtı beklerken açık transaction tutulmaz.

## Ayrıntılı geçmiş ve performans

Ayrıntılı veri korunacak; bunun için her GPS noktasını ayrı HTTP isteği ve transaction yapmak zorunda değiliz.

- İstemci noktaları sıralı ve sınırlı boyutlu gruplar halinde gönderir; çevrimdışı tekrar yükleme mükerrer üretmez.
- Olay/stream/sequence anahtarının tam biçimi migration'da netleşir; cihaz yeniden açıldığında ve sıra dışı gönderimde tutarlı olmalıdır.
- Sunucu bulk insert kullanır; sınırsız Promise.all veya nokta başına sorgu açmaz.
- Batch kullanmak satır sayısını azaltmaz. Örneğin saniyede bir kayıt ve iki saatlik yolculuk 7.200 nokta demektir; saklama ve kapasite planı buna göre yapılır.
- Geçmiş listesi ham noktaları taramaz; trip özeti üzerinden cursor ile sayfalanır.
- Ayrıntılar zaman/sequence aralığıyla sayfalanır. Bütün geçmiş tek yanıta yüklenmez.
- İlk indeks adayları: trip sahipliği + başlangıç zamanı; sample trip ID + zaman/sıra; event idempotency; plan trip ID + revision.
- İstasyon coğrafi araması için PostGIS/GiST; her GPS noktasına ihtiyaç olmadan coğrafi indeks eklenmez.
- Zaman bazlı partition veya BRIN, veri hacmi ve EXPLAIN ANALYZE sonuçlarına göre seçilir; baştan her tabloya uygulanmaz.
- Sorgulanacak FK, durum, zaman, para ve enerji alanları kolon olur. JSONB, bütün veri modelinin yerine geçmez.
- İçe aktarma işleri kullanıcı istekleriyle sınırsız bağlantı/CPU yarıştırmaz. Büyük veri aktarımında staging ve atomik sürüm etkinleştirme değerlendirilecek.

Mevcut pool.max=10 yalnızca mevcut geliştirme ayarıdır; yük altında yeterlilik kanıtı değildir. Pool bekleme, DB gecikmesi, kilit beklemesi ve sorgu sayıları ölçülecek.

Async/await I/O beklemelerini verimli yönetir; CPU yoğun rota hesabını kendiliğinden paralel yapmaz. Ağır hesaplar yeniden kullanılan sınırlı worker havuzuna veya ayrı hesap sürecine alınmalı. Her istek için yeni worker oluşturmak önerilmez. [Node worker_threads](https://nodejs.org/api/worker_threads.html)

## Yolculuk sonu raporu

Kullanıcının ek gereksinimiyle hız/koşul bazlı referanslar, yaklaşık 15 dakikalık sürüş pencereleri ve araç konfigürasyonuna bağlı kişisel modeller [kişisel enerji veri planında](PERSONALIZED_ENERGY_DATA.md) tanımlandı. Kişisel model öğrenme izni geçmiş saklama izninden ayrıdır; GPS hızı enerji ölçümü sayılmaz. Ortak referans ve kişisel model sürümleri/ağırlık politikası gelecekteki plan snapshot'ında birlikte sabitlenecek. CR-006 ortak veri şeması ve kişisel sözleşme/DDL tasarımını hazırlayacak; kişisel migration ve erişim sahiplik temeliyle uygulanacak.

Ayrı göstergeler:

- Toplam sürüş tüketimi: kWh.
- Ortalama tüketim: kWh/100 km.
- Ortalama güç gösterilecekse: kW; tüketimle karıştırılmaz.
- Tahmini yolculuk enerji maliyeti, ücretli şarj oturumlarında ödenen/ödenecek tutar ve diğer ücretler ayrı.

Tüketim hesabında kullanılabilir başlangıç/bitiş batarya enerjisi ve yol boyunca bataryada depolanan şarj enerjisi dikkate alınır. İnletten alınan veya faturalanan kWh doğrudan bataryada depolanan kWh değildir. Veri yeterli değilse model tahmini ve eksik girdiler belirtilir. Telemetriden ölçülmüş tüketimle modelin ürettiği tahmin ayrı tutulur; tahmin, ölçüm etiketiyle kalibrasyona sokulmaz.

Başlangıçta bataryada bulunan enerjinin maliyeti bilinmiyorsa tam yolculuk maliyeti kesinmiş gibi gösterilmez. Kullanıcı referans fiyatı veya kaynaklı tarife varsa varsayımıyla hesaplanabilir. Yol boyunca satın alınan enerji, yolculukta tüketilen enerjiyle aynı miktar olmak zorunda değildir.

Para hesaplarında decimal/numeric veya uygun küçük birim temsili; açık para birimi ve tarifeye bağlı yuvarlama kullanılır. Enerji, süre, bağlantı, bekleme/işgal ve diğer ücret kalemleri ayrı tutulur. Bilinmeyen fiyat sıfır sayılmaz; farklı para birimleri kur bilgisi olmadan toplanmaz.

Rapor tarife sürümünü, geçerlilik zamanını, vergi dahil/haric bilgisini, fiyat kaynağını, model sürümünü ve kalite durumunu taşır. Tarife güncellenince geçmiş rapor sessizce değişmez; yeniden hesaplama ayrı rapor sürümü olur.

Rapor hazır olmadan seyahat kapanışını gereksiz yere bekletmemeyi öneriyoruz. Güvenilir arka plan yürütümü ve retry mekanizması CR-021'de seçilecek; Redis zorunluluğu yok. Bir işi yanıttan sonra sahipsiz bir Promise olarak bırakmak dayanıklı job çözümü sayılmaz.

## Kabul ve yük doğrulaması

CR-003 yalnızca CREATE TABLE çalışması değildir. Gerçek migration uygulamasında şu kanıtlar gerekir:

- İki paralel ücretsiz araç ekleme/değiştirme isteğinde en fazla bir aktif araç.
- Misafirin garaj kaydetmesinin ve başka sahibin seyahatini okumasının reddi.
- İki hesaba eşzamanlı guest claim denemesinde tek sahip ve eski misafir erişiminin iptali.
- Tekrarlanan/offline batch ve şarj olaylarının mükerrer üretmemesi.
- Gecikmiş plan sonucunun güncel sürümü ezmemesi.
- Garaj değişiminin eski araç/rapor snapshot'ını değiştirmemesi.
- Gerçekçi geçmiş büyüklüğünde sorgu planları, p50/p95/p99, pool ve lock beklemeleri.
- Konum yazımı sürerken katalog ve geçmiş listesinin ölçümü.
- Hata/timeout sırasında transaction'ın kapanması ve havuz bağlantısının geri verilmesi.

Eşzamanlı kullanıcı sayısı, örnekleme/yükleme sıklığı, hedef sunucu ve sayısal performans eşikleri henüz belirlenmedi. Bu yüzden yük altında hız garantisi veya benchmark sonucu verilmiş sayılmaz.

## Uygulamadan önce açık kalanlar

- Kendi auth servisi / yönetilen sağlayıcı, e-posta gönderimi ve doğrulama/kurtarma akışı.
- Hesap ve misafir oturum süreleri, token saklama/iptal ayrıntıları.
- Ayrıntılı hesap/misafir geçmişinin saklama süresi, silme ve ayrı kalibrasyon izni.
- Premium araç sınırı ve üyelik değişiminde slot davranışı.
- Pilot yük profili ve performans kabul eşikleri.
- Dayanıklı rapor/haftalık veri jobunun çalışma mekanizması.

Ürün kararları [ADR-002](adr/002-account-garage-history.md) içinde kabul edilmiş olarak, burada kalan teknik tercihler öneri olarak tutulur.
