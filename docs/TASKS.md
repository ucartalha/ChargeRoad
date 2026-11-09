# Geliştirme görevleri

2026-11-09: Kullanıcı önceliğiyle araç kataloğu ilk teknik teslim olarak öne alındı. Katalog alt kapsamları uygulandı. 2026-11-10 itibarıyla CR-002 v1 sözleşmeleri DONE; CR-003 ve CR-006 daha geniş kabul kapsamları nedeniyle IN_PROGRESS. Pilot ve rota görevleri TODO.

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
- Durum: TODO
- Bağımlılık: DEC-012.
- İş: İlk koridor, araç varyantları, veri kapsamı ve başarı eşiklerini belirle.
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
- Durum: TODO
- Bağımlılık: CR-002.
- İş: Yol sağlayıcısını EV planlama servisinden ayır; hava, araç ve istasyon sözleşmelerini tanımla.
- Kabul: Yol sağlayıcısı şarj durağı seçmiyor; plan motoru sahte sağlayıcılarla çalışabiliyor; hata ve eksik veri sonuçları açık; LLM SDK/API gerekmiyor.

### CR-005 — Referans senaryolar ve doğrulama düzeneği
- Durum: TODO
- Bağımlılık: CR-001, CR-002.
- İş: Küçük elle doğrulanabilir yol/enerji örnekleri ve pilot seyahat veri seti hazırla.
- Kabul: Aynı veri anlık görüntüsüyle tekrar üretilebilir testler var; enerji korunumu, rezerv, ulaşılamaz rota ve şarj düzeltme senaryoları kapsanıyor. Özel konum verisinin kullanımı DEC-011'e uygun.

## Veriler ve planlama motoru

### CR-006 — Araç kataloğu aktarımı
- Durum: IN_PROGRESS
- Bağımlılık: DEC-007; CR-003.
- İş: Seçilen açık veri kaynağından modelleri/varyantları normalize ederek aktar.
- Tamamlanan alt teslim: DB katalog şeması, doğrulanan OpenEV Data adaptörü, manuel import, idempotent güncelleme, işlem kaydı ve DB okuma API'si. Teknik kanıt [katalog belgesinde](VEHICLE_CATALOGUE.md).
- Kalan kabul: Pilot araç listesinin alan bazında doğrulanması; tüketim ve şarj eğrisi için yeterli kaynak. Mevcut sürüm bu değerleri içermiyor.
- Kabul: Tekrarlanan import mükerrer üretmiyor; kaynak/sürüm kaydı var; eksik değerler uydurulmuyor; aynı modelin batarya varyantları ayrılıyor; pilot araçlar kontrol ediliyor.

### CR-007 — İstasyon kataloğu ve yol koridoru sorgusu
- Durum: TODO
- Bağımlılık: DEC-007; CR-003, CR-004.
- İş: Konum, EVSE, connector, güç ve erişim koşullarını içeri al; mekânsal aday araması ekle.
- Kabul: Kaynaklar arası mükerrer istasyon politikası var; soket uyumu filtreleniyor; coğrafi adaylık gerçek yol erişilebilirliğiyle karıştırılmıyor.

### CR-008 — Canlı istasyon durumu
- Durum: TODO
- Bağımlılık: DEC-001, DEC-007; CR-007. Gerçek sağlayıcı erişimi gerekir.
- İş: Durum alma, tazelik ve hata politikasını uygula.
- Kabul: Kaynak güncelleme/alınma zamanları ayrı; eski veri bilinmiyor oluyor; timeout/kota/hata kontrol ediliyor; EVSE durumları doğru eşleniyor. Sağlayıcı yoksa görev DONE olmaz, katalog akışı bilinmiyor durumuyla ilerleyebilir.

### CR-009 — Yol verisi adaptörü
- Durum: TODO
- Bağımlılık: DEC-006; CR-004.
- İş: Alternatif rota, gerçek istasyon sapması, süre, manevra ve mevcut kesim özelliklerini getir.
- Kabul: Pilot koridorda yol geometrisi ve sapmalar doğrulanıyor; yükseklik/hız eksikleri açık; dış servisin hazır EV durakları motor yerine kullanılmıyor.

### CR-010 — Hava durumu adaptörü
- Durum: TODO
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

Tamamlanan görev için şu alanlar eklenir: tarih, ilgili değişiklik/commit bağlantısı, kabul ölçütü sonucu, test/ölçüm kanıtı ve kalan sınırlamalar.
