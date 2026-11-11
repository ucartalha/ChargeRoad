# Açık mimari kararlar

DEC-005 ve DEC-007 araç kataloğu kapsamıyla kısmen uygulandı; diğer alanları açık. 2026-11-10: Redis bu aşamada eklenmeyecek; haftalık job mekanizması açık. Misafir/hesap, ücretsiz tek araç ve ayrıntılı geçmiş gereksinimleri [ADR-002](adr/002-account-garage-history.md) ile kabul edildi. Teknik sahiplik/oturum tercihleri ve saklama süreleri kısmen açık. Katalog ayrıntıları [ADR-001](adr/001-vehicle-catalogue.md), yeni öneriler [veri mimarisinde](DATA_ARCHITECTURE.md).

Mevcut depoda Expo/React Native, NestJS, TypeScript, pnpm/Turbo ve Docker PostGIS bulunuyor. Bunlar mevcut durumdur. README veya ortam değişkenlerinde bir sağlayıcının adının bulunması seçimin kesinleştiği anlamına gelmez.

Karar süreci: İhtiyaç ve ölçütleri netleştir → küçük teknik denemeyi değerlendir → birlikte karar ver → ADR yaz → ilgili görevi başlat.

| Kimlik | Konu | Değerlendirilecek seçenekler / sorular | Karar için gereken kanıt |
|---|---|---|---|
| DEC-001 | Redis, cache, arka plan işleri | Redis gerekli mi? DB tabanlı işler veya uygulama içi scheduler yeterli mi? Cache ile kuyruk ihtiyaçları ayrı mı? | Veri hacmi, yenileme sıklığı, çoklu API örneğinde iş tekrarı, retry/dayanıklılık ihtiyacı, işletim maliyeti |
| DEC-002 | Authentication — kısmi karar | Misafir rota kullanımı ve hesap için e-posta/şifre kabul edildi; Google ileride. Yönetilen/kendi servis seçimi, doğrulama ve kurtarma akışı açık. | Sağlayıcı karşılaştırması, mobil oturum güvenliği ve bakım yükü |
| DEC-003 | Authorization ve veri sahipliği — kısmi karar | Misafire garaj yok; ücretsiz hesaba tek değiştirilebilir araç. Misafir geçmişi sunucuda ve doğrulanarak hesaba aktarılabilir. Teknik sahiplik modeli ve yönetim rolleri açık. | Kaynak sahipliği matrisi, eşzamanlı kota/claim ve hesaplar arası erişim testleri |
| DEC-004 | Oturum yaşam döngüsü | Kimlik sağlayıcı seçimine göre oturum/token yaklaşımı, yenileme, iptal, çıkış, cihazda saklama ve hesap silme nasıl olacak? | Mobil tehdit modeli, sağlayıcı kabiliyetleri, kayıp cihaz ve tekrar kullanım senaryoları |
| DEC-005 | DB erişimi ve şema | Mevcut PostgreSQL/PostGIS temelini koruyor muyuz? ORM/query yaklaşımı, migration ve coğrafi indeksler ne olacak? | PostGIS sorgu denemesi, veri aktarımı ihtiyaçları, migration/geri alma uygulaması |
| DEC-006 | Yol, harita ve navigasyon — kısmi karar | Yönetilen API ile pilot; trafik yoksa uyarılı devam; önce ücretsiz/geliştirme kotası. İlk sağlayıcı, harita/geocoding/navigasyon SDK'sı ve işletim bütçeleri açık. [ADR-007](adr/007-road-provider-pilot.md). | Kullanım amacına uygun plan/erişim; Türkiye örneklerinde hız/yükseklik/manevra/sapma; lisans/cache ve gerçek kredi maliyeti |
| DEC-007 | Dış veri ve veri sözleşmeleri | Araç kataloğu, tüketim, şarj eğrisi, hava ve canlı istasyon kaynakları hangileri? Kaynak önceliği ve tazelik eşikleri ne? | Araç varyant kapsamı, gerçek örnek kayıtlar, kullanım şartları, veri kalitesi, kota ve canlı erişim |
| DEC-008 | Algoritma ve optimizasyon | Amaç fonksiyonu, rezerv varsayılanı, varış şarjı, aday koridorlar, A*/Dijkstra/etiketleme, çözünürlük ve risk politikası ne? | Referans senaryolarda doğruluk, hesaplama süresi, sonlandırma ve açıklanabilir sonuçlar |
| DEC-009 | Navigasyon ve plan saklama — kısmi karar | Ayrıntılı hesap/misafir geçmişi sunucuda tutulacak. Batch, yerel tampon, arka plan konumu ve bağlantı kaybı ayrıntıları açık. | Gerçek cihazda pil/konum denemesi, yeniden bağlanma ve sırası bozuk olay senaryoları |
| DEC-010 | Dağıtım ve işletim | API/DB/yol motoru nerede çalışacak? Worker ne zaman ayrılacak? Sağlayıcı anahtarları nasıl yönetilecek? | Kaynak ihtiyacı, izleme, yedekleme/geri yükleme ve maliyet tahmini |
| DEC-011 | Mahremiyet ve veri saklama — kısmi karar | Ayrıntılı geçmiş kabul edildi. Hesap/misafir saklama süreleri, silme, log kapsamı ve ayrı kalibrasyon izni açık. | Veri envanteri, saklama/silme akışı ve erişim sınırları |
| DEC-012 | Pilot ve kalite eşikleri | İlk koridor ve araçlar hangileri? Tüketim hatası, planlama gecikmesi ve rezerv doğruluğu için kabul eşikleri ne? | Referans seyahat kayıtları, ölçülebilir hedefler ve cihaz test planı |

## Sabit sınırlar

2026-11-11 CR-009 hazırlık kararı: Yönetilen API ile pilot, trafik yoksa uyarılı devam ve önce ücretsiz/geliştirme erişimi [ADR-007](adr/007-road-provider-pilot.md) ile kabul edildi. [Alt görevler](TASK_009_PREPARATION.md) hazır; gerçek yol sağlayıcısı seçilmedi. GraphHopper Free'ın ticari olmayan kullanım şartı ve HERE Limited Plan istisnaları seçim kapısında açıkça incelenecek; ücretsiz kota tek başına kullanım izni sayılmaz. Yol/harita/navigasyon ve kendi EV algoritmamız ayrı kalır.

2026-11-11 uygulama: [Provider/OCM alt teslimi](STATION_PROVIDERS.md) tamamlandı. Kaynak kabiliyeti/registry, JSON alan/maliyet politikası, EPDK/OCM adapter'ları ve PostgreSQL lease/fencing/kota/backoff eklendi; 1.737 OCM lokasyonu yayınlandı. Canlı feed/EVSE eşleştirmesi gerçek veriyle doğrulanmadı; CR-008 bütünü IN_PROGRESS. Diğer ticari sağlayıcılar yedekte, Redis yok.

2026-11-11 güncel başlangıç kaynağı: Kullanıcı OCM ile ilerlemeyi seçti; Google/HERE/Eco-Movement/Hubject yedekte tutulacak. [Araştırma](OPEN_CHARGE_MAP_RESEARCH.md) ile ücretsiz/fair-use API, rota/ID filtreleri, kaynak bazlı lisans ve aggregate ekipman sınırları belgelendi. Mevcut EPDK kataloğu korunur; Operational/IsLive canlı müsaitlik sayılmaz. Kullanıcı anahtar oluşturacak; OCM adapter/import uygulanmadı ve gerçek canlı feed kabulü açık. Bu tercih aşağıdaki önceki Eco-Movement inceleme önceliğini günceller.

2026-11-11 CR-008 hazırlığı: [ADR-006](adr/006-live-availability-provider-boundary.md) ile sağlayıcıdan bağımsız canlı müsaitlik katmanı kabul edildi. Yerel katalogdan seçili durak/yedeklerin toplu sorgusu, desteklenirse push/delta, açık EVSE kimlik eşleştirmesi, eskilikte `unknown` ve ortak PostgreSQL durumu kullanılacak. [Uygulama adımları](TASK_008_PREPARATION.md) hazır; gerçek sağlayıcı seçimi/erişimi, TTL/kota ve üretim hedefleri açık. Eco-Movement ilk inceleme adayı, Hubject alternatif; bu kayıt hizmet satın alımı veya çalışan entegrasyon değildir.

2026-11-10 CR-007 teslimi: [ADR-005](adr/005-station-catalogue-policy.md) ilkeleri ve girilen kullanıcı konumlarından dinamik güzergâh tercihiyle EPDK statik katalog/koridor altyapısı uygulandı. GET+body, ulusal saatlik kota, 17.165 lokasyon ve soket beyanı şeması doğrulandı; [işletim bütçeleri/ölçüm](STATION_CATALOGUE.md) kaydedildi. Sabit pilot şehir yok. Canlı sağlayıcı/TTL, gerçek yol erişimi ve üretim SLA'sı açık; Redis eklenmedi.

2026-11-10 CR-006 kararı ve teknik teslim: [ADR-004](adr/004-vehicle-identity-and-data-quality.md) ile kaynaklardan bağımsız araç kimliği, kaynak eşleştirmesi ve açıkça etiketlenmiş mühendislik tahminleri kabul edildi. Kaynak erişimi açık lisanslı/izinli veri ve kendi ölçümlerimizle sınırlı. [Hazırlık planından](TASK_006_PREPARATION.md) sonra ana katalog, kalite/yayın katmanı ve kaynak staging uygulandı; [teslim ve veri açıkları](VEHICLE_KNOWLEDGE.md). Pilot veri yeterliliği ve haftalık scheduler hâlâ açık. Bu karar gerçek tüketim katsayılarını veya üretim hata eşiklerini belirlemez.

2026-11-10 pilot güncellemesi: DEC-012 için 2023 Ioniq 6 RWD 53 kWh / 18 inç, 2025 Ioniq 5 63 kWh / 19 inç ve p95+p99 ölçümü kabul edildi. Varyantların kaynak/katalog eşleştirmesi, koridor ve eşikler açık. DEC-007 için yerel katalog + rota koridoru + seçilmiş adayların canlı durumu [öneri olarak değerlendiriliyor](PILOT_VALIDATION.md); kaynak veya scheduler seçimi yapılmadı.

2026-11-10: [ADR-003](adr/003-shared-security-state.md) ile paylaşılan güvenlik store sınırı kabul edildi. PostgreSQL rate adapter'ı ve günlük üç ayrı aşım koruması uygulandı. JWKS yerel cache, managed-auth, oturum/hak servisleri ve Redis entegrasyonu henüz uygulanmadı; rate katmanının tamamlanması auth sistemini tamamlamaz.

- DEC-006 ve DEC-008 hangi seçenekle sonuçlanırsa sonuçlansın EV karar motoru LLM gerektirmeyecek.
- Redis kullanımı otomatik bir gereksinim değil; cache, kuyruk ve oturum saklama ihtiyaçları ayrı gerekçelendirilecek.
- Authentication kimliğin doğrulanmasıdır. Authorization doğrulanmış veya misafir kimliğin hangi kaynağa erişebildiğidir; ikisi ayrı tasarlanacak.
- Kullanıcı arayüzünde bir düğmenin gizlenmesi API yetkilendirmesi yerine geçmez.
- Token biçimi ve oturum stratejisi kimlik sağlayıcısı seçilmeden kesinleştirilmeyecek.
- Harita çizimi, yol hesaplama, trafik verisi ve navigasyon ayrı kabiliyetler olarak değerlendirilecek.

## Önerilen görüşme sırası

1. Pilot kapsamı ve hesap gereksinimi: DEC-012, DEC-002, DEC-003, DEC-011.
2. Veri kaynakları ve harita/yol yaklaşımı: DEC-007, DEC-006.
3. Veri modeli, algoritma ve oturum ayrıntıları: DEC-005, DEC-008, DEC-004.
4. Navigasyon, altyapı ve Redis ihtiyacı: DEC-009, DEC-010, DEC-001.

Bu sıra ihtiyaç halinde değişebilir. Bir görev yalnızca gerçekten bağımlı olduğu kararlar nedeniyle bekletilir; tüm mimari kararların alınması her iş için önkoşul değildir.

## Karar kaydı

Alınan her karar için [ADR şablonu](adr/000-template.md) kopyalanır. Dosya adı örneği: 001-kimlik-ve-oturum.md. İlgili DEC kaydına ADR bağlantısı eklenir.

İlk uygulama kaydı: [ADR-001 — DB'den sunulan araç kataloğu](adr/001-vehicle-catalogue.md). Bu kayıt auth, rota sağlayıcısı veya Redis seçimini kapatmaz.

Ürün kararı: [ADR-002 — Misafir, hesap, garaj ve geçmiş](adr/002-account-garage-history.md). Teknik öneri: [CR-003 veri mimarisi](DATA_ARCHITECTURE.md). Migration ve yük testi henüz uygulanmadı.
