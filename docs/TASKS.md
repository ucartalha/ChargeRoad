# Geliştirme görevleri

2026-11-09: Kullanıcı önceliğiyle araç kataloğu ilk teknik teslim olarak öne alındı. Katalog alt kapsamları uygulandı. 2026-11-10 itibarıyla CR-002/004/005/007 DONE; CR-001/003/006 daha geniş kabul kapsamları nedeniyle IN_PROGRESS. Gerçek rota motoru ve saha pilotu henüz uygulanmadı.

Durumlar: TODO, IN_PROGRESS, BLOCKED, DONE. Bir göreve başlanırken durum ve sorumlu; bitirirken doğrulama kanıtı eklenir. DEC kayıtları görev değildir, ilgili teknik işin karar kapılarıdır.

## Önerilen teslim sırası

1. CR-001–005: Kapsam, sözleşmeler, veri modeli ve doğrulama zemini.
2. CR-006–013: Veri aktarımı ve LLM'den bağımsız ilk rota/şarj planı.
3. CR-014–016: Mobil araç seçimi, şarj girdisi ve haritada plan.
4. CR-017–019: Seyahat durumu, şarj düzeltmesi ve navigasyon.
5. CR-020–022: Hesap/erişim kapsamı, işletim ve pilot doğrulaması.

Bu sıra bağımlılıkların yerine geçmez. Kimlik ve erişim çalışmaları, ilgili kararlar alınınca diğer uygun işlerle birlikte ilerleyebilir. Kullanıcıya özel uzaktan saklama, erişim kontrolleri tamamlanmadan yayına açılmaz.

## Temel hazırlık

### CR-001 — Pilot kapsamı ve kabul eşikleri
- Durum: IN_PROGRESS
- Bağımlılık: DEC-012.
- İş: İlk koridor, araç varyantları, veri kapsamı ve başarı eşiklerini belirle.
- 2026-11-10: Pilotlar 2023 Ioniq 6 RWD 53 kWh / 18 inç ve 2025 Ioniq 5 63 kWh / 19 inç olarak seçildi; Ioniq 5 paketinin RWD bilgisi üretici kaynağıyla destekleniyor. Tarihsel model yılı/pazar ve katalog eşleştirmesi ile koridorlar açık. Kullanıcı ortalamaları başlangıç referansı; bağımsız saha doğrulaması ayrıca gerekiyor. p95 ve p99 birlikte ölçülecek. [Değerlendirme](PILOT_VALIDATION.md).
- Kabul: Pilot listesi, tüketim hata metriği, planlama süre hedefleri ve rezerv ihlali kriterleri yazılı; ölçüm yöntemi tanımlı.

### CR-002 — Ortak domain sözleşmeleri
- Durum: DONE
- Bağımlılık: CR-001 ve DEC-008 üretim politika değerlerini belirler; sözleşme bu değerleri varsayılan atamadan parametre olarak taşır.
- İş: Araç varyantı, enerji kesimi, yol sonucu, şarj eğrisi, EVSE, plan ve şarj düzeltme sözleşmelerini tanımla.
- 2026-11-10: v1 sözleşmeler ve çalışma zamanı doğrulaması tamamlandı. Koşullu tüketim, SOC/güç veya SOC/akım/voltaj eğrileri, farklı elektriksel şarj yolları, termal/yük/HVAC bağlamı, yol ve hava zamanları, EVSE/power pool, enerji/süre dengesi, plan sürümü ve şarj düzeltmesi dahil. 31 sentetik senaryo geçti. [Ayrıntılar](DOMAIN_CONTRACTS.md). Gerçek motor/kalibrasyon, pilot, eşikler ve varsayılanlar sonraki görevlerdir.
- Kabul: Başlangıç şarjı, rezerv ve hedef varış şarjı ayrı; birimler ve zaman formatları açık; measured/user_input/estimated ayrımı ve plan sürümü mevcut; örnek payload'lar doğrulanıyor.

### CR-003 — Veri modeli ve migration temeli
- Durum: IN_PROGRESS
- Bağımlılık: DEC-005, DEC-011; CR-002.
- İş: Araç/varyant, tüketim/şarj eğrisi, kaynak sürümü, istasyon/EVSE/connector, durum gözlemi ve seyahat kayıtlarının şemasını oluştur.
- 2026-11-10 tasarım: [Hesap/garaj/geçmiş ürün kuralları](adr/002-account-garage-history.md) kabul edildi; [veri, transaction ve performans önerisi](DATA_ARCHITECTURE.md) hazırlandı. Bu kayıt migration, auth uygulaması veya yük testi tamamlandı anlamına gelmez.
- 2026-11-10 güvenlik alt teslimi: 002_rate_limiting migration'ı ve atomik PostgreSQL store uygulandı; [günlük IP engeli](RATE_LIMITING.md) iki API instance'ıyla doğrulandı. Diğer CR-003 tabloları ve yük kabulü açık.
- Kabul: Migration temiz DB'ye uygulanıyor; coğrafi indeks ve örnek koridor sorgusu doğrulanıyor; kaynak kimlikleri ve kaynak/güncelleme/alınma zamanları korunuyor. Kullanıcı sahipliği DEC-003'e göre uygulanıyor.

### CR-004 — Sağlayıcı sınırlarının ayrılması
- Durum: DONE
- Bağımlılık: CR-002.
- İş: Yol sağlayıcısını EV planlama servisinden ayır; hava, araç ve istasyon sözleşmelerini tanımla.
- 2026-11-10: Normalize veri/provenance portları, kendi engine adım sözleşmesi, snapshot doğrulayan coordinator ve Nest DI modülü uygulandı. 16 senaryo sahte sağlayıcılarla doğrulanıyor. Gerçek adapter ve optimizasyon motoru ayrı görevler; üretime sahte fallback veya plan endpoint'i eklenmedi. [Ayrıntılar](PROVIDER_BOUNDARIES.md).
- Kabul: Yol sağlayıcısı şarj durağı seçmiyor; plan motoru sahte sağlayıcılarla çalışabiliyor; hata ve eksik veri sonuçları açık; LLM SDK/API gerekmiyor.

### CR-005 — Referans senaryolar ve doğrulama düzeneği
- Durum: DONE
- Bağımlılık: CR-001, CR-002.
- İş: Küçük elle doğrulanabilir yol/enerji örnekleri ve pilot seyahat veri seti hazırla.
- 2026-11-10 teslim: 15 elle hesaplanan/checksum sabitlenmiş sentetik vaka, sınırlandırılmış exhaustive küçük ağ referansı, aday plan fizibilite/optimum denetimi, enerji/süre defterleri, %60/%75/%90 şarj düzeltmeleri, anonim pilot kayıt şeması/boş ölçüm dosyası ve 10.000 örnekli p95/p99 CLI tamamlandı. [Komutlar ve sınırlar](REFERENCE_VALIDATION.md), [örnek rapor](validation/reference-run-2026-11-10.json). Teknik doğrulama zemini DONE; gerçek sürüş verisi/tüketim doğruluğu CR-006/022, koridor ve üretim eşikleri CR-001'de açık. Üretim motoru veya API kapasitesi bu teslimle tamamlandı sayılmaz.
- Kabul: Aynı veri anlık görüntüsüyle tekrar üretilebilir testler var; enerji korunumu, rezerv, ulaşılamaz rota ve şarj düzeltme senaryoları kapsanıyor. Özel konum verisinin kullanımı DEC-011'e uygun.

## Veriler ve planlama motoru

### CR-006 — Araç kataloğu aktarımı
- Durum: IN_PROGRESS
- Bağımlılık: DEC-007; CR-003.
- İş: Seçilen açık veri kaynağından modelleri/varyantları normalize ederek aktar.
- 2026-11-10 hazırlık: [ADR-004](adr/004-vehicle-identity-and-data-quality.md) ile bağımsız araç kimliği, açıkça etiketli mühendislik tahminleri ve açık lisanslı/izinli kaynaklar + kendi ölçümlerimiz kabul edildi. [Uygulama adımları](TASK_006_PREPARATION.md) hazır; yeni CR-006 kodu/migration/import'u bu hazırlık turunda başlatılmadı.
- Ek veri kapsamı: Farklı hız/koşul tüketim noktaları; yaklaşık 15 dakikalık sürüş penceresi ve enerji kanıtı sözleşmeleri; sahip–sürüş profili–araç ilişkisi ve ortak/kişisel model revizyonları için DDL tasarımı. Kişisel migration sahiplik temeliyle uygulanır. [Kişiselleştirme veri planı](PERSONALIZED_ENERGY_DATA.md); aktif öğrenme/navigasyon CR-011–013/017/019, izin ve iş yürütümü CR-020/021'de kalır.
- 2026-11-10 teknik teslim: 003/004/005 migration, UUID/legacy alias kataloğu, atomik/sürümlü kanıt yayını, kalite politikası, DB enerji provider'ı, global kaynak sync/staging ve kişisel veri sözleşmeleri uygulandı. 1.189 eski + 2 pilot katalog kaydı; Kilowatt kaynağından 1.321 inceleme adayı; Ioniq 6 için birimi doğrulanmış 3 kullanıcı tüketim aralığı kaydedildi. 132 API/DB + 31 shared testi; typecheck/build başarılı. [Teslim, komutlar ve açıklar](VEHICLE_KNOWLEDGE.md).
- Teknik altyapı alt kapsamı DONE; görev bütünü IN_PROGRESS. Pilotlarda koşullu hız testi/şarj eğrisi ve kapasite/kimlik doğrulaması açık; kaynak adayı veya kullanıcı aralığı doğrulanmış planlama profili sayılmaz. Kişisel DDL taslağı sahiplik bağımlılığı nedeniyle uygulanmadı.
- Tamamlanan alt teslim: DB katalog şeması, doğrulanan OpenEV Data adaptörü, manuel import, idempotent güncelleme, işlem kaydı ve DB okuma API'si. Teknik kanıt [katalog belgesinde](VEHICLE_CATALOGUE.md).
- Kalan kabul: Pilot araç listesinin alan bazında doğrulanması; tüketim ve şarj eğrisi için yeterli kaynak. Mevcut sürüm bu değerleri içermiyor.
- 2026-11-10 pilot veri açığı: OpenEV v1.24.0 kataloğunda seçilen 2025 Ioniq 5 63 kWh yok; izinli ek kaynakla ayrı provenance korunarak tamamlanmalı. Ioniq 6 53 kWh aday kaydının kullanılabilir kapasite/jant/aktarma eşleşmesi doğrulanmalı. [Kaynak kontrolü](PILOT_VALIDATION.md#varyant-kaynakları-ve-katalog-açıkları).
- Kabul: Tekrarlanan import mükerrer üretmiyor; kaynak/sürüm kaydı var; eksik değerler uydurulmuyor; aynı modelin batarya varyantları ayrılıyor; pilot araçlar kontrol ediliyor.

### CR-007 — İstasyon kataloğu ve yol koridoru sorgusu
- Durum: DONE
- 2026-11-10: [ADR-005](adr/005-station-catalogue-policy.md) ilkeleri ve kullanıcının sabit güzergâh yerine girilen konumları kullanma tercihiyle uygulandı. EPDK GET+body adapter'ı, ortak kaynak kotası, 006/007 migration, aşamalı/atomik katalog, namespace kimlikleri ve alan kaynakları, socket-claim/EVSE ayrımı, indeksli koridor, kapsamlı provider/coordinator sözleşmesi ve salt okunur API teslim edildi. 17.165 lokasyon / 50.259 soket beyanı; 13.238 halka açık. 163 API/DB + 31 shared testi; typecheck/build başarılı. [Teslim ve p95/p99 kanıtı](STATION_CATALOGUE.md).
- Başlangıç sunucu politikası: 2→5→10 km koridor, en çok 500 aday / 5 alternatif / 20.000 geometri noktası, SQL 2 sn, statik soft-age 24 saat; bunlar üretim SLA veya rota kalitesi garantisi değildir. OCM gerçek bağlantısı açılmadı; izinli normalize ek paket ve açık crosswalk altyapısı var. Canlı durum CR-008, gerçek yol/sapma CR-009, EV planı CR-013'te kalır.
- Bağımlılık: DEC-007; CR-003, CR-004.
- İş: Konum, EVSE, connector, güç ve erişim koşullarını içeri al; mekânsal aday araması ekle.
- Kabul: Kaynaklar arası mükerrer istasyon politikası var; soket uyumu filtreleniyor; coğrafi adaylık gerçek yol erişilebilirliğiyle karıştırılmıyor.

### CR-008 — Canlı istasyon durumu
- Durum: IN_PROGRESS
- 2026-11-11 provider/OCM alt teslimi DONE: Kaynak registry/kabiliyetleri, alan/maliyet politikası, EPDK+OCM adapter'ları, PostgreSQL lease/fencing/kota/backoff, atomik materyalizasyon ve lisans/aggregate sözleşmeleri uygulandı. OCM'den 1.737 lokasyon / 2.168 ekipman özeti yayınlandı; dört 0,0 koordinat kaydı incelenmiş karantinada. EPDK 17.165 UUID korunuyor. 182 API/DB + 31 shared testi, typecheck/build ve p95/p99 başarılı. [Teslim raporu](STATION_PROVIDERS.md). Gerçek canlı müsaitlik feed'i/TTL ve EVSE eşleştirmesi açık olduğu için tüm CR-008 DONE değildir.
- 2026-11-11 yetkili OCM doğrulaması: Anahtar yerel backend ortamına kaydedildi; reference data, 25 Türkiye kaydı ve 24 lokasyon çevresi HTTP 200 ile alındı. [Gerçek bulgular](OCM_VALIDATION.md): opendata filtresinde NC lisans; 7/24 yakın aday, 3/24 150 m içinde aday; otomatik crosswalk ve canlı müsaitlik yok. Normalizer/import/migration/yayın henüz yapılmadı.
- 2026-11-11 güncel tercih: Başlangıçta OCM entegrasyonu; Google/HERE ve diğer ticari hizmetler yedekte. [OCM araştırması ve alt kabul adımları](OPEN_CHARGE_MAP_RESEARCH.md) hazır; anahtarı kullanıcı oluşturacak. Mevcut EPDK kataloğu korunur. OCM katalog/genel çalışma bilgisi gerçek canlı doluluk teslimi sayılmaz; başlangıçta müsaitlik `unknown`. Bu kayıt önceki Eco-Movement önceliğini günceller; adapter/import henüz uygulanmadı.
- 2026-11-11 araştırma: EPDK marka sorgusu HTTP 200 ile 1.428 istasyon / 4.383 soket beyanı getirdi; canlı durum/tarife alanı yok. Swagger/kılavuz yeniden doğrulandı, istasyon kodu sorgusu 429 verdi. [Rapor ve 24 istasyon örneklemi](STATION_SOURCE_RESEARCH.md) hazır; Google/HERE alan doluluğu anahtar/ürün erişimi olmadığından ölçülmedi. Dış iletişim kullanıcı talebiyle pas geçildi.
- 2026-11-11 hazırlık: [ADR-006](adr/006-live-availability-provider-boundary.md) ile yerel katalog + seçili durak/yedeklerin toplu canlı sorgusu, desteklenirse push/delta, açık EVSE kimlik eşleştirmesi ve ortak PostgreSQL durum katmanı kabul edildi. [Alt görevler ve kabul kapıları](TASK_008_PREPARATION.md) hazır. İlk inceleme Eco-Movement, alternatif Hubject; sağlayıcı seçimi/erişimi ve sayısal TTL/kota politikaları açık. Kod/migration veya canlı entegrasyon bu hazırlıkta başlatılmadı.
- Bağımlılık: DEC-001, DEC-007; CR-007. Gerçek sağlayıcı erişimi gerekir.
- İş: Durum alma, tazelik ve hata politikasını uygula.
- Kabul: Kaynak güncelleme/alınma zamanları ayrı; eski veri bilinmiyor oluyor; timeout/kota/hata kontrol ediliyor; EVSE durumları doğru eşleniyor. Sağlayıcı yoksa görev DONE olmaz, katalog akışı bilinmiyor durumuyla ilerleyebilir.

### CR-009 — Yol verisi adaptörü
- Durum: DONE (teknik uygulama kapsamı; V1 açıkları devredildi)
- 2026-11-11 uygulama: [Teknik teslim](ROAD_PROVIDERS.md). Valhalla/OSM yol adapter'ı, değiştirilebilir registry/attribute portu, PostgreSQL ortak kota/cache/lease, HTTP API ve gerçek istasyon sapması hazır. Ankara örneği 3.845 m / 512,5 sn; gerçek sapma +1.170 m / +137,53 sn. Canlı trafik yok, bilinmeyen hız null. 206 API/DB testi ve 31 ortak sözleşme testi geçti; mobil dahil tip kontrolleri ve API derlemesi başarılı.
- 2026-11-11 kapsam kararı: Kullanıcı kalan açıkları V1 çıkışına devretti. Gerçek hız alanı doğrulaması, tesis erişimi, geniş rota örneklemi, üretim hosting, yükseklik kaynağı ve periyodik temizlik [V1-ROAD-001–006](V1_RELEASE_BACKLOG.md) altında TODO; bu işler tamamlandı veya üretim onayı alındı sayılmaz. Kamu demo servislerinin üretim engeli korunur. [ADR-007](adr/007-road-provider-pilot.md), [önceki hazırlık/kabul planı](TASK_009_PREPARATION.md).
- Bağımlılık: DEC-006; CR-004.
- İş: Alternatif rota, gerçek istasyon sapması, süre, manevra ve mevcut kesim özelliklerini getir.
- Kabul: Teknik pilotta gerçek yol geometrisi ve katalog koordinatına sapma üretildi; yükseklik/hız eksikleri açık; dış servisin hazır EV durakları motor yerine kullanılmıyor. Geniş doğrulama ve üretime hazırlık kapıları kullanıcı kararıyla V1 backlog'una taşındı.

### CR-010 — Hava durumu adaptörü
- Durum: DONE
- 2026-11-11 teslim: [Hava provider teknik raporu](WEATHER_PROVIDERS.md). MET Norway adapter/registry, migration 010, PostgreSQL cache/304/lease/fencing, ortak kota/backoff, periyodik temizlik, geçiş saati ve durak gecikmesi örnekleme uygulandı. Gerçek Türkiye pilotu: 207 kesim, 2 hava örnek noktası, tekrar/HTTP kontrolünde ek dış çağrı 0. Kaynak güncelleme zamanı model üretim/alınma/doğrulama zamanlarından ayrı; eksik alanlar null. 234 API/DB testi ve 33 shared sözleşme testi geçti; yerel p95/p99 raporu var.
- [ADR-008](adr/008-weather-provider-and-planning-policy.md): MET Norway, temel hava/güncel cache yoksa güvenilir enerji planında veri yetersiz sonucu ve V1 için 72 saat hareket penceresi uygulanıyor. Hazırlık planı [tarihsel kayıtta](TASK_010_PREPARATION.md); gerçek SOC/enerji/optimizasyon ve navigasyon kendi görevlerinde, Task 9 V1 açıkları korunuyor.
- Bağımlılık: DEC-007; CR-004, CR-009.
- İş: Rota üzerindeki konum ve tahmini geçiş zamanına göre hava verisi getir.
- Kabul: Bütün rota için yalnızca hareket saati kullanılmıyor; rüzgâr yönü mevcut; tahmin üretim zamanı kaydediliyor; eksik veri ve tahmin ufku aşımı açık sonuç veriyor.

### CR-011 — Enerji tüketimi motoru
- Durum: TODO
- Bağımlılık: DEC-008; CR-005, CR-006, CR-009, CR-010.
- İş: Kesim bazında batarya tüketimini ve batarya profilini hesapla.
- Kabul: Hız, sıcaklık, eğim, rüzgâr ve yardımcı tüketimin varsayımları kayıtlı; rejenerasyon fiziksel sınırları aşmıyor; enerji çift sayılmıyor; pilot hata metriği CR-001'e göre raporlanıyor.

### CR-012 — Şarj eğrisi ve süre hesabı
- Durum: TODO
- Bağımlılık: DEC-007, DEC-008; CR-005, CR-006, CR-007.
- İş: Araç eğrisi ve istasyon sınırlarından alınacak enerji ve süreyi hesapla.
- Kabul: Sabit maksimum güç varsayımı yapılmıyor; yüzdelere bağlı güç ve kayıp tanımı açık; eksik eğri politikası var; elle hesaplanabilir örnekler ve kapasite sınırları geçiyor.

### CR-013 — Şarj durağı optimizasyonu
- Durum: TODO
- Bağımlılık: DEC-008; CR-007, CR-009, CR-010, CR-011, CR-012. Canlı durum varsa CR-008 eklenir.
- İş: Alternatif yol ve durakları rezerv, zaman ve uyumluluk kısıtlarıyla değerlendir.
- Kabul: Başlangıç şarjı sonucu değiştiriyor; şarjsız/tek/çok duraklı ve ulaşılamaz örnekler geçiyor; sapma ve şarj süreleri hesaba katılıyor; hava/varış zamanı yeniden değerlendiriliyor; arama sınırları ve veri belirsizliği sonuçta mevcut.

## API ve mobil planlama

### CR-014 — Planlama API'si
- Durum: TODO
- Bağımlılık: DEC-002, DEC-003; CR-013.
- İş: Seçilen erişim modeline uygun plan isteği/yanıtı ve hata sözleşmesini uygula.
- Kabul: Yüzde/koordinat/zaman doğrulanıyor; sağlayıcı hatası ile ulaşılamaz rota ayrılıyor; plan/model/veri sürümü dönüyor; kötü veya aşırı büyük isteğe karşı sınırlar tanımlı.

### CR-015 — Araç seçimi ve başlangıç şarj formu
- Durum: IN_PROGRESS
- Bağımlılık: DEC-002, DEC-003; CR-006, CR-014.
- İş: Araç varyantı, adres/konum, başlangıç şarjı, hareket zamanı ve rezerv tercihlerini bağla.
- 2026-11-10 alt teslim: Marka → model → yıl/varyant akışı, arama, sayfalama, yükleniyor/hata/tekrar dene, yerel araç ID saklama ve rota ekranında araç özeti uygulandı. Başlangıç şarjı alanı 0–100 doğrulamasıyla eklendi. Rota isteği, geocoding, hareket zamanı ve rezerv tercihleri henüz bağlı değil; görev bu nedenle IN_PROGRESS.
- Kabul: Kullanıcıdan başlangıç şarjı alınıyor; geçersiz değer gönderilmiyor; seçilen varyantla plan yapılıyor; yükleniyor/hata/sonuç durumları görünür. Yerel veya hesapta saklama ilgili karara uyuyor.

### CR-016 — Haritada plan ve durak ayrıntıları
- Durum: TODO
- Bağımlılık: DEC-006; CR-014, CR-015.
- İş: Rota çizgisi, duraklar, varış şarjları ve süre ayrımını göster.
- Kabul: Gerçek cihazda harita açılıyor; duraklar doğru konumda; önerilen şarj ve veri yaşı görünür; bilinmeyen müsaitlik uygun şekilde belirtiliyor.

## Seyahat ve yeniden planlama

### CR-017 — Seyahat durumu ve olay sıralaması
- Durum: TODO
- Bağımlılık: DEC-003, DEC-009, DEC-011; CR-002, CR-014.
- İş: Aktif seyahat, tamamlanan kesimler, son şarj girdisi ve plan sürümünü yönet.
- Kabul: Aynı olayın tekrarı çift etki üretmiyor; gecikmiş plan yeni sonucu ezmiyor; yeniden başlatma/saklama davranışı tanımlı; özel uzak kayıtlar CR-020 erişim kontrolleri olmadan yayına açılmıyor.

### CR-018 — Kullanıcı şarj düzeltmesi ve kalan plan
- Durum: TODO
- Bağımlılık: CR-013, CR-017.
- İş: Şarjdan ayrılırken veya yolculuk sırasında kullanıcı yüzdesini yeni başlangıç yap.
- Kabul: Öneri %75 iken %60/%90/aynı değer örnekleri geçiyor; önceki tahmin yerine yeni enerji atanıyor; rezerv korunuyor; durak ekleme/atlama hesapla doğrulanıyor; geçmiş seyahat değişmiyor.

### CR-019 — Konum takibi ve navigasyon
- Durum: TODO
- Bağımlılık: DEC-006, DEC-009; CR-016, CR-017, CR-018.
- İş: Konumu rotaya eşle, tahmini şarjı güncelle, manevraları ve yeniden planlamayı bağla.
- Kabul: GPS gürültüsü, rota sapması, arka plan, bağlantı kaybı ve izin reddi gerçek cihazda deneniyor; tahmin ölçümden ayrılıyor; tetikleme/kararlılık eşikleri uygulanıyor; eski müsaitlik güncel gösterilmiyor.

## Kimlik, işletim ve pilot

### CR-020 — Kimlik, oturum ve erişim kuralları
- Durum: TODO
- Bağımlılık: DEC-002, DEC-003, DEC-004, DEC-011; CR-003.
- İş: Onaylanan misafir/hesap kapsamını, kaynak sahipliğini ve yönetim erişimini uygula.
- Güncel kapsam: E-posta/şifre; misafir sunucu oturumu ve güvenli geçmiş claim; misafire garaj yasağı; ücretsiz hesapta tek aktif araç ve güvenli değiştirme. Google ileride. Mevcut girişsiz yerel araç tercihi, kalıcı hesap garajından ayrılacak.
- Güvenlik alt kapsamı: Paylaşılan RateLimitStore, üç ayrı günlük aşım engeli, güvenli proxy varsayılanı ve fail-closed guard uygulandı. Auth endpoint'leri ve kimlik sağlayıcısı henüz bağlı değil; görev DONE sayılmaz.
- Kabul: Hesap varsa giriş/yenileme/çıkış/iptal ve cihazda saklama doğrulanıyor; başka kullanıcının araç/seyahatine erişim reddediliyor; import/yönetim uçları korunuyor; saklama ve silme akışı var. Hesap kapsam dışı seçilirse bu karar belgeleniyor ve kalan erişim sınırları yine uygulanıyor.

### CR-021 — Veri işleri, izleme ve dağıtım
- Durum: TODO
- Bağımlılık: DEC-001, DEC-010, DEC-011; CR-003, CR-006, CR-007.
- İş: Onaylanan scheduler/kuyruk/cache yaklaşımı, veri yenileme, log/metric ve dağıtım düzenini kur. Araç kataloğunu haftada bir yenilemek için mevcut VehicleImportService yeniden kullanılacak; gün/saat/saat dilimi ve job altyapısı ayrıca seçilecek. Bu teslimde scheduler veya Redis kurulmadı.
- Kabul: Retry ve mükerrer iş politikası var; veri tazeliği/sağlayıcı hatası/plan gecikmesi izleniyor; anahtarlar mobil pakete sızmıyor; yedek geri yükleme deneniyor; konum logları saklama kararına uyuyor. Redis yalnızca kararlaştırılırsa ekleniyor.

### CR-022 — Pilot uçtan uca doğrulama
- Durum: TODO
- Bağımlılık: CR-001, CR-005, CR-014–021; canlı müsaitlik kapsamdaysa CR-008.
- İş: Seçilen koridorda gerçek/denetimli seyahatlerle plan ve güncellemeleri doğrula.
- Kabul: Tüketim hatası ve planlama süreleri raporlu; rezerv/ulaşılamaz rota senaryoları geçiyor; düşük/yüksek şarj düzeltmeleri doğrulanıyor; cihaz testi ve erişim testleri tamam; veri kapsamı ve bilinen sınırlamalar yazılı. Her sapma açık görev veya kapsam kararı olarak kaydediliyor.

## Tamamlanma kaydı

2026-11-09 — İlk araç kataloğu teknik teslimi tamamlandı. 65 marka, 260 model ve 1.189 varyant iki gerçek aktarım sonrasında mükerrer olmadan DB'de. 18 test, üç paket typecheck, production build ve gerçek DB üzerinde production HTTP kontrolü geçti. Daha geniş CR-002/003/006 kabul kapsamları açık; rota, pilot ve haftalık job tamamlandı sayılmadı.

2026-11-10 — CR-005 teknik doğrulama zemini tamamlandı: 15 golden vaka ve bağımsız küçük ağ referansı, 52 yeni test ve 10.000 örnek p95/p99 raporu. Tüm API testlerinde 85 başarılı / 13 DB entegrasyon testi atlandı; shared 31 başarılı; üç paket typecheck ve API build başarılı. [Teslim ve saha sınırları](REFERENCE_VALIDATION.md).

Tamamlanan görev için şu alanlar eklenir: tarih, ilgili değişiklik/commit bağlantısı, kabul ölçütü sonucu, test/ölçüm kanıtı ve kalan sınırlamalar.
