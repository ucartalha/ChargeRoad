# CR-008 — Canlı müsaitlik hazırlığı

Tarih: 2026-11-11. Hazırlık ve mimari yaklaşım kabul edildi. Provider/OCM alt teslimi uygulandı; CR-008 gerçek canlı feed kapsamı nedeniyle IN_PROGRESS. [Güncel teslim raporu](STATION_PROVIDERS.md). Aşağıdaki hazırlık adımları kalan kapsam ve tarihsel planı korur.

[ADR-006](adr/006-live-availability-provider-boundary.md) karar kaydıdır. CR-007 statik katalog teslimi korunur. Bu görev gerçek yol motorunu veya EV durak optimizasyonunu uygulamaz.

2026-11-11 kaynak araştırması: [EPDK marka çağrısı/Swagger/kılavuz doğrulandı](STATION_SOURCE_RESEARCH.md); tekil çağrı 429 verdi. Trugo/Eşarj/ZES'ten toplam 24 lokasyon seçildi, Google/HERE gerçek çağrısı erişim olmadığı için yapılmadı. Kullanıcı mail ve operatör iletişimini şimdilik pas geçti. Bu araştırma gerçek canlı feed teslimi değildir.

## Hedef akış

2026-11-11 güncel öncelik: [OCM araştırması](OPEN_CHARGE_MAP_RESEARCH.md) tamamlandı; başlangıç entegrasyonu OCM kataloğu/genel durum zenginleştirmesi olacak. Kullanıcı API anahtarını oluşturacak. Google/HERE/Eco-Movement/Hubject bağlantıları yedekte. OCM teslimi gerçek canlı müsaitlik kabulünü tek başına kapatmaz; başlangıçta canlı doluluk `unknown` kalır.

Sonraki doğrulama: Kullanıcı anahtarı sağladı ve backend yerel ortamına kaydedildi. [Gerçek API incelemesi](OCM_VALIDATION.md) tamamlandı: 25 kayıt + 24 çevre sorgusu. Yakın aday 7/24; 150 m içinde aday 3/24; bunlar doğrulanmış eşleşme değildir. `opendata=true` içinde NC lisanslı kayıt bulunduğu için ürün import'unda sağlayıcı lisans izin listesi gerekecek. Canlı durum doğrulanmadı; DB import/adapter henüz uygulanmadı.

Yerel katalog/rota adayları → seçili durak ve yedek kimlikleri → ortak müsaitlik okuması → gerekiyorsa tekilleştirilmiş toplu yenileme → kaynak/yaş/ayrıntı bilgili normalize sonuç.

Push destekleyen sağlayıcı → doğrulanmış alıcı → kimlik/doğrulama ve olay sırası kontrolü → ortak durum deposu. HTTP alıcı yalnız kısa doğrulama/yazma yapar; kalıcı kabul sağlanmadan başarı bildirmez. Tekrar gelen güncelleme çift etki üretmez.

## Uygulama adımları

### 8.1 — Sağlayıcı yeterlilik dosyası

- Önce OCM reference data ve küçük Türkiye örneğiyle açık lisans, kimlik, aggregate ekipman, genel durum ve kaynak zamanı doğrulanır. [OCM kabul adımları](OPEN_CHARGE_MAP_RESEARCH.md) uygulanır. Gerçek canlı kaynak seçimi ileriki aşamada değerlendirilir; Eco-Movement/Hubject ve Google/HERE yedekte kalır.
- Toplu kimlik sorgusu, delta/push, tam uzlaştırma, kota, zaman alanları, detay seviyesi ve cache/gösterim/saklama hakları kaydedilir.
- Gerçek izin/erişim gelmeyen kaynak etkinleştirilmez. Sağlayıcıya ileti gönderme veya ücretli abonelik bu hazırlığın parçası değildir.
- Çıktı: örnek payload ve ölçülebilir seçim gerekçesi; erişim yoksa açık kalan bağımlılık raporu.

### 8.2 — Normalize sözleşmeler ve kabiliyetler

- Mevcut `availabilityObservationSchema` geriye uyumluluk açısından değerlendirilerek kaynak gözlemi ile efektif tazelik sonucu ayrılır.
- `StationAvailabilityProvider` benzeri ayrı port; toplu kimlik girdisi, kısmi sonuçlar, eşleşmeyen kimlikler ve kaynak hataları açık modellenir.
- `available/occupied/reserved/blocked/out_of_service/unknown` eşleştirmesi kaynak başına belgelenir. Bilinmeyen ham değer `available` olamaz.
- Zaman, saat sapması, `last_updated` alanının durum zamanı mı tüm kayıt zamanı mı olduğu ve zamansız yanıt politikası tanımlanır. Sadece alınma zamanı gözlem zamanı olarak taklit edilmez.
- Sağlayıcı kabiliyetleri `bulk-by-id`, `push`, `delta`, `reconcile`, ayrıntı seviyesi ve limitleri taşır. Desteklenmeyen işlem sessizce tüm ülke sorgusuna dönüşmez.

### 8.3 — Kimlik ve DB migration

- Kaynak/namespace EVSE alias'ları ve doğrulanan kanonik eşleştirmeler; eşleşmeyen/çelişen kayıtların inceleme akışı.
- Statik revizyonları yeniden yazmadan kaynak bazlı durum gözlemi ve en son durum tabloları; erişim desenine uygun tekil anahtar ve indeksler.
- Yalnız doğrulanmış fiziksel EVSE grupları kullanılır; EPDK soket beyanlarından sahte EVSE oluşturulmaz. EVSE ayrıntısı getiren kaynağın statik ekipman eşleştirmesi de doğrulanır.
- Olay kimliği veya kaynak sırası/zamanı ile idempotency; geç gelen olay yeniyi ezmez. Eşit zamanlı çelişki deterministik ve incelemeye açık olur. Sırasız/geçmişsiz akışta gerektiğinde yetkili son durum uzlaştırılır.
- Ortak kaynak kotası, süreli yenileme lease'i ve sürüm/fencing kaydı. Ağ işlemi transaction dışında; sonuç kısa atomik yazımla yayınlanır. Uygulanmış 006/007 migration'ları değiştirilmez.

### 8.4 — Yenileme ve erişim adapter'ı

- Bir ilk gerçek sağlayıcı adapter'ı; sırlar yalnız backend ortamında.
- Kaynağın izin verdiği toplu sorgu veya push/delta akışı; kısmi batch hatası diğer kimlikleri silmez veya taze göstermez.
- Aktif durak/yedek ihtiyacını birleştirme, bounded concurrency/timeout, retry/backoff/jitter ve devre kesici.
- Çoklu instance aynı yenileme işini/kotayı ortak koordine eder; lease bitince eski worker yeni sonucu ezemez.
- Push varsa kimlik doğrulama, boyut sınırı, tekrar/sıralama kontrolü, dayanıklı kabul ve kesinti sonrası uzlaştırma eklenir. Sağlayıcı izin vermiyorsa pull dışına çıkılmaz.
- Manuel/yeniden kullanılabilir yürütme CR-008'de; dayanıklı periyodik scheduler dağıtımı CR-021'de. Cache temizleme görevi çalışmasa da okuma anında eskilik hesaplanır.

### 8.5 — Planlama sınırı ve okuma

- Statik aday portu korunur; canlı zenginleştirme ayrı katmandan geçer. Planlama sınırlı bekleme bütçesiyle ortak son durumu okur; sağlayıcı kesintisi sınırsız bekletmez.
- Snapshot/plan, kullanılan durum, kaynak zamanı, efektif durum ve politika sürümünü izlenebilir taşır. Sağlayıcının normalleştirme ayrıntıları mobil akışa sızmaz.
- Canlı katman kapalıyken katalog kullanılabilir; eksik/eskimiş durum uyarıyla `unknown` olur. Eski arıza da süresiz güncel sayılmaz; statik erişim/lifecycle kuralları ayrıca geçerlidir.
- Doluluk bekleme süresi ve varış anı müsaitlik tahmini bu görevin doğrulanmış çıktısı değildir. Yeniden planlama CR-013/017–019 ile bağlanır.

### 8.6 — Doğrulama ve kabul

- Toplu/kısmi yanıt, kaynak durum eşlemeleri, zamansız/gelecek/eski olay, yinelenen/sırası bozuk push, belirsiz kimlik ve aggregate/EVSE ayrımı.
- Timeout, 429, retry sınırı, devre kesici ve kota paylaşımı; iki worker aynı işe yarışırken tekilleştirme ve lease süresi biten worker'ın reddi.
- PostgreSQL'de gerçek migration/indeks ve eşzamanlı upsert doğrulaması; N+1 ve ağ beklerken açık transaction bulunmaması.
- İzinli gerçek örnekle EPDK lokasyonu → sağlayıcı EVSE eşleştirmesi → güncel durum → TTL sonrası `unknown` uçtan uca gösterimi.
- Yerel fixture yüküyle cache okuma ve yenileme koordinasyonu p95/p99, DB pool/kuyruk, batch boyutu, dış çağrı sayısı ve hata oranı ölçülür. Sağlayıcıya izinsiz yük testi yapılmaz; yerel ölçüm gerçek feed gecikmesi diye sunulmaz.

Teknik altyapı ile gerçek canlı erişim ayrı raporlanır. Tüm görevin DONE olması için yetkili kaynak, doğru kimlik/ayrıntı eşleştirmesi, tazelik ve hata politikası ile uçtan uca doğrulama gerekir.

## Açık seçimler

- Gerçek sağlayıcı ve izin/erişim; Türkiye'de operatör bazlı kapsama.
- Kaynağa göre TTL ve yenileme/batch/kota bütçeleri; gecikme ve p95/p99 hedefleri.
- Durum tarihçesi saklama süresi, push kapsamı ve uzlaştırma sıklığı.

Redis kurulumu ve ücretli hizmet seçimi yapılmadı. LLM veya dış sağlayıcının hazır EV rota çözücüsü bu akışa eklenmez.
