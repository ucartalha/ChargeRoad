# ADR-014 — Yönetilen yol pilotu, asenkron plan işleri ve ön plan navigasyonu

İlgili kararlar: DEC-001, DEC-003, DEC-006, DEC-009, DEC-011.

Tarih: 2026-11-12. Kullanıcı kararı: Geoapify ücretsiz pilot; önce yol önizlemesi ve takip/iptal edilebilir plan işi; ilk kabul ön planda Expo Go navigasyonu. Redis bu teslimde eklenmedi.

## Sağlayıcı seçimi

| Sağlayıcı | Geliştirme/ücretsiz | Ücretli başlangıç | Karara etkisi |
| --- | --- | --- | --- |
| Geoapify | 3.000 kredi/gün, 5 istek/sn; kaynak atıflarıyla ticari kullanım | API 10: 59 USD/ay, 10.000 kredi/gün | Seçildi. Rota ayrıntıları ve yükseklik aynı yanıtta; harita arayüzünden bağımsız adaptör. |
| GraphHopper | 500 kredi/gün; ücretsiz paket ticari olmayan kullanım | Basic: 69 EUR/ay | Alternatif; önbellek/yeniden dağıtım koşulları farklı. |
| Stadia | 200.000 kredi/ay; ücretsiz paket ticari olmayan kullanım | Starter: 20 USD/ay | Alternatif; sunucu önbelleği kısıtları mevcut mimariyle ayrıca çözülmeli. |

Bir istek bir şarj planına eşit değildir. Geoapify `route_details`, `elevation`, uzun mesafe ve kaçınma tercihleri ek kredi tüketebilir. İlk gerçek uzun plan 26 yeni yol isteği kullandı. Yerel sağlayıcı koruması 100 **istek/gün** olarak korunur; bu, Geoapify'nin 3.000 kredilik ticari kotasının bire bir sayacı değildir. Paneldeki tüm anahtarların toplam kullanımını ayrıca izlemek gerekir. Otomatik ücretli sağlayıcı geçişi yoktur. Önceki Valhalla kotası sıfırlanmadı.

Geoapify `free_flow` kullanılır; canlı trafik iddia edilmez, tek yol alternatifi açık uyarıyla değerlendirilir. `avoid` tercihleri sağlayıcıda mutlak yasak değildir; gelen toll/ferry işaretleri kısıt denetiminde korunur. Hız limitleri `provider_derived` olarak işaretlenir; fiziksel işaret doğrulaması değildir. Eksik yükseklik veya hız uydurulmaz. Yol, enerji ve şarj algoritmaları LLM kullanmaz.

Sağlayıcının [ürün koşulu açıklaması](https://www.geoapify.com/products-and-services/) sonuçların saklanmasına/önbelleğe alınmasına izin verir. [Fiyat ve atıf gereksinimleri](https://www.geoapify.com/pricing/), [genel koşullar](https://www.geoapify.com/terms-and-conditions/), [rota sözleşmesi/kredi ayrıntıları](https://apidocs.geoapify.com/docs/routing/) esas alınır. Üretim yayını öncesi güncel koşullar tekrar kontrol edilir. Alternatifler: [GraphHopper fiyat](https://www.graphhopper.com/pricing/), [koşullar](https://www.graphhopper.com/terms/), [Stadia fiyat](https://stadiamaps.com/pricing/), [koşullar](https://stadiamaps.com/terms-of-service/).

## İş yaşam döngüsü ve erişim

- `POST /v1/planning-jobs`: doğrulanmış public plan DTO'su, `requestId` idempotency kimliği. Aynı kimlik/anahtar/farklı içerik 409; farklı anahtar 404.
- `GET /v1/planning-jobs/:id`: küçük durum kaydı; büyük plan JSON'u polling sırasında DB'den çekilmez. İstemci 5 saniye aralıkla takip eder.
- `GET /v1/planning-jobs/:id/result`: tamamlanan domain sonucu, kayıpsız gzip; SOC/model ayrıntıları korunur.
- `DELETE /v1/planning-jobs/:id`: bekleyen/çalışan işi iptal eder. Submit öncesi iptal için kısa tombstone geç gelen POST'u engeller.
- Her istekte URL dışında `Authorization: Bearer <64 hex>` gizli iş anahtarı gerekir. Sunucuda HMAC saklanır; anahtar mobilde yalnız bellektedir. Bu erişim hesabın/kalıcı misafir kimliğinin yerine geçmez. HTTP dışında proxy header logları da gizli anahtarları maskelemelidir.
- PostgreSQL `SKIP LOCKED`, lease token + generation ve periyodik yenileme devralmayı ve geç sonucun yazılmasını kontrol eder. İş bütçesi varsayılan 120 saniye; genel admission aynı kalır. Kısa yenilenen admission lease uzun işte slotu korur.
- İptal kaynak işleme sinyalini en geç sonraki heartbeat'te iletir; sonuç önce DB'de çitlenir. İş durumları queued/running/completed/failed/cancelled; `completed` domain açısından provider_error da içerebilir.
- Kayıtlar 30 dakika sonra erişilemez olur; temizlik yaklaşık dakikada bir çalışır. İstek payload'u tamamlanınca silinir. En fazla 128 bekleyen/çalışan kayıt, instance başına bir worker. Uzun DB transaction boyunca HTTP beklenmez.
- “Şimdi” hareketi iş başında hesaplama bütçesi + 15 saniyelik hazırlık payına alınır; özgün zaman metadata'da saklanır ve etkin zaman UI'da gösterilir. Bu kaydırma SOC gözlemi üretmez.

## Navigasyon ve SOC doğruluğu

Ön planda yüksek doğrulukla GPS izlenir. Eski (>15 sn) veya belirsiz (>50 m) konum ilerletmez. Poliline izdüşüm, ilerleme sürekliliği ve 3 örnek/10 saniye sapma doğrulaması kullanılır; yeniden planlama en az 60 saniye ve sağlayıcı Retry-After ile sınırlanır. Telefon ekranı/arka plan geçişinde takip duraklatılır; açık devam ve güncel SOC onayı gerekir. Harita görünür kalır; elle haritayı sürüklemek otomatik merkezlemeyi durdurur.

Gösterilen SOC araçtan ölçülmüş değildir. Şarj duraklarındaki planlanan artış hiçbir zaman otomatik uygulanmaz. “Şarjım bitti” ve normal SOC düzeltmesi ayrı eylemlerdir. Düzeltme gerçek değerle yeni iş başlatır; otomatik rota sapması tahmini SOC ile açık `startingChargeSource=estimated` ve model/plan provenance kullanır. Bu kayıtlar gözlem veya eğitim gerçeği sayılmaz. Eski iş sonucu yeni rotayı ezemez.

Tek aktif yolculuğun küçük snapshot'ı, en fazla 128 kullanıcı düzeltmesiyle cihazda tutulur; 24 saat sonra geri yüklenmez. Yeniden açılışta daima duraklatılmıştır. Büyük tam plan tek AsyncStorage satırına yazılmaz. Bu yerel kurtarma, sunucu seyahat geçmişi, kimlik doğrulama veya otomatik kişisel/genel model yayını değildir; CR-017/018/020'nin kalan kapsamları açıktır.

[Expo konum belgesi](https://docs.expo.dev/versions/latest/sdk/location/) ön plan ve arka plan kapsamını ayırır. GPS simülasyonları gerçek cihaz izin/harita/yaşam döngüsü kabulünün yerine geçmez. Saha doğruluğu ve arka plan navigasyonu henüz kabul edilmiş değildir.
