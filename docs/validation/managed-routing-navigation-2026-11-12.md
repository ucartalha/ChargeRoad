# Yönetilen rota / asenkron iş / ön plan navigasyon doğrulaması

Tarih: 2026-11-12. [Kabul edilen kararlar](../adr/014-managed-road-jobs-and-foreground-navigation.md).

## Bulgu ve düzeltmeler

- Önceki `ROAD_PROVIDER_FAILED` bildirimleri sırasında Valhalla için yerel günlük 100 edinim sınırı doluydu. Yeni istekler çok kısa sürede reddediliyordu; internet erişimi hatasıyla aynı mesaj altında görünüyordu. Kota/backoff/yerel pacing/gerçek upstream hataları ayrı kod ve gerçek Retry-After taşır. Kota sıfırlanmadı veya sessizce yükseltilmedi.
- Uzun soğuk planın tek 30 saniyelik HTTP isteğine sığması güvenilir değildi. Mobil artık küçük POST ile işi oluşturur, yol önizlemesini bağımsız gösterir, beş saniyede bir durumu izler ve tamamlanan sonucu indirir. İptal gerçek solver sinyaline kadar doğrulandı.
- Uzun iş bütçesi admission lease'in sabit üst sınırını aşıyordu; uzun süreli lease yerine kısa ve yenilenen lease kullanıldı. Pacing testi ayrıca PostgreSQL `-infinity` zamanından çıkarma hatasını yakaladı; retry hesabı sonlu değerle yapılır.
- Polling sadece küçük durum kolonlarını okur; çok MB'lık plan JSON'u her sorguda taşınmaz. Sonuç gzip, 16 MiB çözülmüş/2 MiB aktarım sınırı ve strict sözleşmeyle korunur.
- Expo Go için istemcide AbortSignal statik yardımcılarına bağımlılık kaldırıldı; iptal ve süre sonu açık AbortController ile uygulanır. Tekrarlanan HTTP başarısızlığı çalışan işi sahipsiz bırakmaz.
- Harita GPS geldikçe tüm rotayı yeniden fit etmez. Aktif navigasyonda manevra/SOC özeti panel kapalıyken de görünür; elle sürükleme takip merkezlemesini durdurur.

## Gerçek sağlayıcı testleri

Kişisel GPS yerine kamuya açık İstanbul/Ankara noktaları kullanıldı. Enerji isteğinde yol noktaları açıkça test girdisi olarak onaylandı. Araç Ioniq 6 pilotu; başlangıç %95, rezerv %10, hedef varış %20. Mühendislik profili ve katalog gücü senaryosu açıkça seçildi.

| Ölçüm | İlk edinim | Önbellekli tekrar |
| --- | --- | --- |
| Mobil asenkron HTTP sonucu | planned | planned |
| İstemciden toplam süre | 77.566 ms | 10.276 ms |
| Yol önizlemesi iş sırasında | Evet | Evet |
| Şarjlı mesafe / durak | 480,896 km / 2 | 480,896 km / 2 |
| Tahmini varış SOC | %25,92 | %25,90 |
| Yeni Geoapify edinimleri | 26 | 0 |

Önizleme ana yolu 446,120 km'dir; şarjlı mesafe istasyon bağlantıları ve yeniden hesaplanan bacakları içerir. Arama `data_budget`, `optimality:not_proven` ile bitti: eldeki en iyi doğrulanmış koşullu plan, küresel optimum değildir. 28.849 hava değerlendirmesi MET HTTP isteği sayısı değildir. Donanım, üyelik, erişim saatleri, canlı durum ve kuyruk belirsizlikleri korunur. Sürüş enerjisi yaklaşık 108,6 kWh'tır; test günü hava/model tahminidir, saha tüketim ölçümü değildir ve verilen 410 km kullanıcı gözlemiyle aynı rota/koşul sayılmaz.

[Geoapify alan raporu](geoapify-pilot.json): 3,038 km kısa ve 446,120 km uzun yol; bu iki yanıtta hız/yükseklik alanları tam. [İlk gerçek mobil istemci sonucu](async-planning-live.json), [son kodla önbellekli sonuç](async-planning-live-warm.json). İki örnekten rota süresi p95/p99 veya SLA çıkarılmaz. Anahtar backend `.env` içinde; mobil dışa aktarımında bulunmadığı kontrol edildi. Yerel koruma 100 istek/gün; gerçek servis kredi tüketimi ayrıca izlenmeli.

## Kontrollü regresyonlar

Nihai sonuç: API/DB 50 test grubu / 612 test, shared 41 test, mobil 21 test; toplam 674 başarılı, atlanan test yok. Üç paket typecheck ve API build başarılı; son Android/iOS paketleri `artifacts/mobile-navigation-final` içinde. Sadece üretilmiş test paketidir, mağaza dağıtımı veya imzalı APK değildir.

- API/DB tüm testleri ve ek hedefli regresyonlar: sağlayıcı kota/pacing/geri çekilme, gzip büyük plan, üç amaç, sıcaklık/rezerv kısıtları, iş sahipliği/UUID idempotency, submit öncesi iptal, lease devri, geç sonuç çitlemesi, TTL/silme.
- 100 gerçek HTTP durum isteği, eşzamanlılık 20, gerçek izole PostgreSQL: p95 38,16 ms, p99 39,26 ms; toplam 22.700 bayt, dış servis çağrısı 0. Bu iş takip katmanının yerel ölçümüdür; rota motoru veya üretim yük kabulü değildir.
- Mobil saf çekirdek: gürültülü/eski GPS, poliline eşleme, rota döngülerinde ilerleme sürekliliği, SOC enterpolasyonu/rejenerasyon, gerçekleşmeyen şarjın eklenmemesi, gerçek yüzdeyle anchor, provenance koruyan yeniden plan, snapshot doğrulama/eskime/duraklatılmış geri yükleme.
- Üç paket typecheck, API build, Android/iOS Expo export. Gerçek cihaz dokunma/GPS testi otomatik olarak yapılmış sayılmadı.

## Telefon kabulü ve kalan kapsam

Expo Go: `exp://10.57.6.157:8081`, backend `http://10.57.6.157:3000/v1`; cihaz aynı ağa bağlı olmalı. API ready, istasyon viewport sorgusu ve Metro HTTP kontrolü 200 döndü. Ağ değişirse her iki LAN adresi yenilenmelidir.

1. Ioniq 6 seç; başlangıç/varış, SOC/rezerv/varış hedefini seç. Yaklaşık model/katalog varsayımlarını okuyup onayla. Gerekirse yakın yol noktasını açıkça onayla.
2. Önizleme ve iş durumunu izle; iptal edip eski sonucun ekranı ezmediğini kontrol et. Tamamlanan planda durak, DC/AC soket ve kaynak atfını aç.
3. “Navigasyonu başlat” ile göstergedeki gerçek SOC'yi doğrula; GPS izni ver. Telefonu sürücü yerine yolcu kullansın. Rota sapması, konum kaybı, SOC düzeltmesi ve şarj sonrası gerçek yüzdeyle devamı kontrol et.
4. Uygulamayı arka plana al: takip duraklamalı; dönünce güncel SOC ile açık devam gerekir. Yeniden açılışta rota duraklatılmış dönmeli. Yolculuğu bitirince yerel aktif kayıt silinmeli.

Gerçek cihaz bağlı/ADB kurulmuş olmadığı için izin pencereleri, native harita ve gerçek GPS kabulü açık. Arka planda navigasyon, kalıcı sunucu misafir/hesap geçmişi, premium/garaj, kişisel/genel öğrenme yayın hattı, gerçek araç tüketim/şarj hata kabulü ve üretim sağlayıcı kapasitesi bu teslimle kapanmadı.
