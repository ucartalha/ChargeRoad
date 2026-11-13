# Uygulamanın mevcut yetenekleri

Tarih: 2026-11-12. Mobil harita/planlama HTTP API'lerine bağlıdır. Hyundai için kaynaklı yaklaşık profiller yayımlandı. Geoapify ücretsiz pilot, takip/iptal edilebilir plan işleri ve ön plan GPS/SOC navigasyon akışı eklendi. Gerçek pilot kalibrasyonu ve telefon üzerinde kabul henüz tamamlanmadı.

İstanbul–Ankara telefon bildirimi: Valhalla geliştirme servisindeki yerel günlük 100 çağrı korumasının dolduğu doğrulandı. Kota sıfırlanmadı. Seçilen Geoapify ile gerçek uzun şarj planı artık `planned`: yol önizlemesi 446,120 km; şarjlı rota 480,896 km, iki durak. Açık mühendislik/katalog senaryosu onayı ve test girdileri %95/rezerv10/varış20 kullanıldı. İlk edinim yaklaşık 77,6 sn, önbellekli tekrar 10,3 sn; 26 yeni yol isteği, tekrarda 0. En iyi olası rota iddiası yok; sınırlı arama ve donanım/erişim belirsizlikleri açık. [Uçtan uca rapor](validation/managed-routing-navigation-2026-11-12.md), [karar](adr/014-managed-road-jobs-and-foreground-navigation.md), [kalan kabul işleri](V1_RELEASE_BACKLOG.md).

## Mobilde çalışanlar

- Expo/React Native mobil uygulama; haritaya açılan sade Türkçe arayüz, profil ve alttan sürüklenerek açılan rota paneli. [Geri bildirim teslimi](HYUNDAI_AND_MAP_FEEDBACK.md).
- DB kaynaklı marka → model → yıl/varyant seçimi; katalog araması, sayfalama ve seçim değiştirme.
- Yükleniyor, hata ve tekrar deneme davranışları.
- Seçili araç ID'sini telefonda saklama ve açılışta güncel bilgisini backend'den okuma.
- Rota ekranında seçili araç özeti; mevcutsa kullanılabilir batarya/DC şarj gücü.
- %0–100 başlangıç SOC, minimum rezerv ve hedef varış SOC kaydırıcıları/doğrulama; otomatik rezerv yüzdesi yok.
- [Task 15 planlama formu](MOBILE_PLANNING.md): adres araması ve sonuçtan koordinat seçimi, isteğe bağlı cihaz konumu, üç mod, hareket zamanı, yol tercihleri ve mühendislik profiline açık onay. Gerçek telefon izin/GPS davranışı henüz kabul edilmedi.
- Plan API'sine istek, yükleniyor/iptal, hata/tekrar dene ve eski yanıtı engelleme. Metinsel plan/SOC özeti ve gerçek yol çizgisi; görünür harita alanındaki DB istasyonları ve önerilmiş şarj durakları haritada işaretlenir. Canlı durum bilinmiyor etiketi korunur.
- Açılışta araç seçimi zorunlu değil; profil veya rota başlatma sırasında mevcut marka/model/varyant akışı açılır. Yerel araç seçimi hesaplı sunucu garajı değildir.

## Backend'de çalışanlar

- Önceden indirilip PostgreSQL'e yayımlanan araç kataloğu; mobil okumalarda dış kaynağa gitmeme.
- Kaynaktan bağımsız kanonik araç kimliği, eski ID eşleme, sürümlü kaynak/kanıt ve atomik immutable profil yayını.
- Koşullu tüketim/şarj referansları ve kullanıcı bildirimleri için kalite/kaynak ayrımı; eksik veya karantinadaki veriyi gerçek profil saymama.
- EPDK/OCM katalog adapter'ları, kaynak politikası, izinli import ve DB istasyon API'si.
- Son doğrulanan kaynak yayını: EPDK 17.165 ve OCM 1.737 lokasyon; kaynaklar arası fiziksel mükerrerler tamamen çözülmüş değildir.
- PostGIS rota koridoru ve sınırlı harita alanı istasyon sorguları; istasyon detayları.
- Geoapify pilotu ve korunmuş Valhalla adaptörüyle yol geometrisi, mesafe/süre, manevra, yükseklik ve hız alanları. İlk gerçek Geoapify uzun rota yanıtında hız/yükseklik kapsamı tam; sınırlar sağlayıcı türevi olarak etiketli, eksik veri null. LLM kullanılmaz.
- Seçili istasyona gerçek yol sapması hesabı; fiziksel tesis girişi ayrıca doğrulanmamış olarak kalır.
- MET Norway hava adapter'ı; kesim geçiş saatine eşleme, şarj gecikmesi sonrası saat kayması, 72 saat hareket penceresi ve eksik temel hava politikası.
- Task 11 enerji çekirdeği: fizik veya uygun referans düzeltmesi; hız/rüzgâr/eğim/yük, yardımcı tüketim, SOH/başlangıç SOC, rejenerasyon ve ara rezerv kontrolü. Teknik doğrulama hazır; gerçek pilot kalibrasyonu/saha kabulü açık. [Ayrıntı](ENERGY_ENGINE.md).
- İstanbul–Ankara tüketim/SOC/şarj gözlemini kaynaklı ve belirsizlikleri açık biçimde DB'de koruma; otomatik kapasite veya şarj eğrisi türetmeme.
- [İki bağımsız XLSX değerlendirmesi](INDEPENDENT_DATASET_VALIDATION.md): 23 tüketim, 7 şarj oturumu ve 9 kısmi nokta; satır bazlı eksik veri/kimlik raporu. Katsayı fit edilmedi, üretim profili yayımlanmadı ve gerçek hata metriği için veri yeterli sayılmadı. Kaynak serisi ayrımı, hız iziyle referans hesabı, opsiyonel kaynaklı otomatik termal kontrol ve daha verimli şarj interpolasyonu hazır.
- Çevrimdışı SOC geri besleme/kişisel ve genel residual birleştirme çekirdeği hazır. Ön planda GPS eşleme, manevra, SOC tahmini, manuel düzeltme ve yeniden planlama bağlandı; kalıcı kişisel sunucu verisi ve otomatik model yayını henüz yok.
- Task 12 DC şarj çekirdeği: SOC eğrisi, voltaj/akım, converter/istasyon/ortak güç sınırları ve ayrı kayıp/yardımcı enerji hesabı; Task 11 kapasite snapshot'ı ve sürümlü DB replay. Son geri bildirimle 26 Hyundai için yaklaşık şarj profili yayımlandı; ölçülmüş varyant/saha kabulü açık. [Ayrıntı](CHARGING_ENGINE.md).
- Task 13 şarj durağı optimizasyonu: süre/az durak/net sürüş enerjisi modları, kullanıcı rezerv/varış SOC'si, adaptif ayrılış hedefleri, gerçek yönlü yol bağlantıları ve şarj sonrası hava/SOC değerlendirmesi. Kuyruk bilinmiyorsa koşullu senaryo ve belirsiz gerçek ETA; sınırlı arama etiketiyle yalnız doğrulanmış plan. [Teslim ve veri kapıları](STOP_OPTIMIZER.md).
- Task 14 [planlama HTTP API'si](PLANNING_API.md): `POST /v1/plans`, strict istemci sözleşmesi, model/sürüm bilgisi, hata/veri yetersizliği ayrımı, iptal ve süre sınırları. IP rate limit ve PostgreSQL genel kapasite kontrolü yatay ölçeklenen instance'lar arasında ortak. Hesapsız, durum saklamayan erişim; henüz seyahat geçmişi kaydetmez.
- Ioniq 5/6/9 ve Kona dahil 26 Hyundai varyantı için kaynaklı mühendislik profili DB'de: 546 türetilmiş hız/sıcaklık referansı, 78 koşullu yaklaşık şarj eğrisi. Eski araç ID'leri ve kullanıcı gözlemleri korundu. İlk yaklaşık plan için açık onay alınır.
- Gerçek Ioniq 6 / Ankara HTTP kontrolü artık `planned`: 3.845 m, %95 başlangıç → yaklaşık %93,33 varış. [Kanıt](validation/hyundai-live-planning.json). Önceki yaklaşık 458 km İstanbul–Ankara kontrolü yalnız yol önizlemesidir; önceki 410 km saha kaydıyla aynı rota değildir.
- Adres sağlayıcı port/registry'si ve Photon geliştirme adapter'ı; PostgreSQL ortak kota/cache, Türkiye filtresi ve kaynak atfı. Public demo üretimde engelli; üretim geocoder seçimi açık.

## Güvenlik ve işletim altyapısı

- PostgreSQL paylaşılan cache, istek tekilleştirme, lease/generation fencing, provider kota/backoff ve sınırlı concurrency.
- API rate limiting, günlük IP ihlal/engel politikası ve ters proxy güven sınırı.
- Timeout/iptal, runtime sözleşme doğrulaması, kaynak zamanı/sürüm/checksum ve eski worker'ın yeni veriyi ezmesini önleme.
- Yerel p95/p99 ve DB entegrasyon doğrulama araçları; hava cache'i periyodik fiziksel temizlik ve manuel bakım komutları.
- Redis ve LLM eklenmedi; saf enerji çekirdeği DB/ağ beklemez. Bu altyapı üretim yük/SLA kabulünün tamamlandığı anlamına gelmez.

## Henüz tamamlanmayan ürün akışları

- Ayrıntılı istasyon/durak ekranları ve gerçek cihaz harita/etkileşim kabulü.
- Gerçek cihazda planlama/konum kabulü ve gerçek araç/istasyon verisiyle uçtan uca otomatik EV plan kabulü.
- Ön plan navigasyonunun gerçek cihazda GPS/izin/rota sapması/yaşam döngüsü kabulü; arka plan navigasyonu ve kalıcı kullanıcı sürüş profili.
- Gerçek canlı istasyon müsaitliği, fiziksel giriş doğrulamaları ve Task 9 V1 açıkları.
- E-posta/şifre ve Google girişi; sunucu garajı, ücretsiz/premium yetkilendirmesi.
- Seyahat geçmişi, kişiye özel sürüş verisi/kalibrasyonu, yolculuk sonu maliyet/tüketim ekranları.
- Şarj başlatma/ödeme, haftalık katalog job'ları ve üretim işletim/pilot kabulünün bütünü.

Kaynaklar: [görevler](TASKS.md), [araç](VEHICLE_KNOWLEDGE.md), [istasyon](STATION_PROVIDERS.md), [yol](ROAD_PROVIDERS.md), [hava](WEATHER_PROVIDERS.md), [enerji](ENERGY_ENGINE.md), [V1 backlog](V1_RELEASE_BACKLOG.md).
