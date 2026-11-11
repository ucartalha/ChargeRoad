# CR-009 — Yol verisi adaptörü hazırlığı

Tarih: 2026-11-11. Durum: Teknik uygulama kapsamı DONE; kalan işler kullanıcı kararıyla [V1 backlog'una](V1_RELEASE_BACKLOG.md) devredildi. Aşağıdaki metin uygulama öncesi kapsam ve kabul planının tarihsel kaydıdır; devirden önceki DONE koşulları ve açık seçim ifadeleri güncel görev durumunu değiştirmez. Güncel [teknik teslim](ROAD_PROVIDERS.md): Valhalla/OSM adapter, migration 009, HTTP ve gerçek istasyon sapması uygulandı. Doğrulanmamış alanlar ve üretim engelleri korunuyor. Kararlar [ADR-007](adr/007-road-provider-pilot.md)'de.

## Kesinleşen çerçeve

- Yönetilen API ile pilot; başka yönetilen veya kendi sunucumuzdaki motor için adapter sınırı.
- Trafik varsa kullan; yoksa kaynağı belli statik/model süre ile uyarılı devam.
- Önce ücretsiz/geliştirme erişimiyle doğrulama; ücretli fallback veya otomatik kota aşımı yok.
- Yol/durak/enerji ayrımı korunur. Harita ekranı CR-016, navigasyon CR-019; hazır EV şarj rota çözücüsü kullanılmaz.

## Mevcut altyapı ve değişecek sözleşmeler

`RoutingProvider.routes` portu mevcut. `road-weather.ts` sözleşmesi başlangıç/hedef, hareket zamanı, alternatifler, ücretli yol/feribot kaçınması, kesim politikası, geometri, mesafe/süre, hız sınırı, yükseklik ve kaynak bilgisini içeriyor. Henüz gerçek adapter, manevra, istasyon giriş–çıkış sapması veya yol sağlayıcısı registry'si yok.

CR-009'da yol alternatifi, istasyon erişim/sapma sorgusu ve gerekirse süre matrisi ayrı kabiliyetler olacak. Yükseklik/traffic gibi eksik alanlar başka kaynaktan gelebilir; ancak farklı sağlayıcıların geometri indeksleri/edge ID'leri doğrudan birleştirilmez. Aynı yol/kesimle eşleşme doğrulanmalı; eşleştirilemeyen veri eksik kalmalı. Kaynak seçimindeki maliyet önceliği, veri/lisans uygunluğu kapısını geçemez.

## Alt görevler

### 9.1 — Sağlayıcı yeterlilik matrisi ve örnek sorgu

HERE ve GraphHopper ilk inceleme adayları; ikisi de seçilmiş değildir. Gerekirse başka yönetilen aday eklenebilir. Her aday için hesap/planın bizim test ve ürün amacımıza uygunluğu; ülke kapsamı; rota/alternatif/sapma kabiliyeti; hız/yükseklik/trafik/manevra alanları; attribution, cache/saklama ve farklı haritada kullanım koşulları kaydedilir.

GraphHopper Free'ın ticari olmayan kullanım sınırı ve HERE Limited Plan kullanım istisnaları nedeniyle yalnız ücretsiz kota görmek yeterli değildir. Uygunluk doğrulanmadan pilot uygulama entegrasyonu etkinleştirilmez. Hesap/anahtar backend'de kalır; gizli bilgiler URL veya loga yazılmaz. Dış servisin auth biçimi query gerektiriyorsa URL/log redaksiyonu zorunludur.

İzinli küçük örnekle aynı başlangıç–hedef ve hareket zamanı için ham yanıt + normalize alan matrisi çıkarılır. Henüz anahtar/uygun erişim verilmediğinden gerçek Türkiye yanıtı veya gecikme ölçümü yoktur. Sabit bir şehir rotası ürün kuralı yapılmaz; doğrulama geometrileri test girdisi olur.

### 9.2 — Normalizasyon ve eksik veri politikası

- Mesafe metre, süre saniye, hız km/sa, zaman UTC; API'nin koordinat sırası ve polyline hassasiyeti açık çevrilir.
- Hız sınırı, beklenen ortalama hız ve kullanıcı hedef seyir hızı ayrı kalır. Kesim mesafe/süresinden elde edilen hız yolculuk ortalamasıdır; sabit seyir/ölçülmüş hız diye etiketlenmez. Sinyal/kavşak beklemesi ayrılabiliyorsa ayrıca taşınır; ayrılamıyorsa uydurulmaz.
- Trafik kaynağı `live/historical/modelled/none/unknown` ayrımı ve geçerlilik zamanı taşımalı. Yanıtta trafik kanıtı yoksa `live` atanmaz. Trafik desteklenmeyen bölgede otomatik statik sonuç dönen servisler de bu ayrımı korumalı.
- Eksik hız sınırı `null`; sınırsız hız ile bilinmeyen hız ayrı. Eksik yükseklik sıfır eğim değildir. Sadece rota başı/sonu kotundan ara tırmanış kaybolmaz. Yükseklik kaynağı ve örnekleme/filtreleme politikası ayrı izlenir.
- Yol bulunamaması, provider hatası, uyarılı trafiksiz rota ve enerji hesabına yetersiz veri ayrı sonuçlardır. Ulaşılabilir yol üretmek, enerji/SOC tahminine yeterli veri bulunduğu anlamına gelmez.
- Manevralar, yol sınıfı, kaçınma tercihleri ve sağlayıcının ihlal uyarıları korunur. Feribot veya ücretli yoldan kaçınma soft tercih ise sonuç kesin kısıta uydu diye gösterilmez.

### 9.3 — Enerji kesimlerine bölme

Kaynak yol/link sınırları, anlamlı hız/yol sınıfı/yükseklik değişimleri ve şarj erişim noktaları bölme girdisi olur. Mesafe/süre üst sınırı, bütünlük ve geometri bütçeleriyle küçük ve tekrar üretilebilir kesimler oluşturulur. Kısa/uzun kesim dengesinin sayısal değerleri örnek payload sonrasında seçilir.

Toplam mesafe/süre korunur; geometri boşlukları ve sıfır mesafeli manevralar fiziksel sürüş kesimi yapılmaz. Dönüş/ışık beklemeleri yalnız tüketim hesabını kolaylaştırmak için sıfırlanmaz. Geometri sadeleştirmesi görsel çizgi için ayrı uygulanabilir; enerji için hız/irtifa sınırlarını yok etmez. Tahmin/model/provenance bilgisi kesim bazında taşınır.

### 9.4 — İstasyon erişimi ve sapma

Önce gerçek yol geometrisiyle yerel PostGIS koridor adayları alınır. Sonra kısıtlı adaylar için ana yoldan ayrılma → tesis girişi/şarj noktası → yola geri dönüş hesaplanır. Varsa doğrulanmış giriş/çıkış koordinatı ve yaklaşım yönü kullanılır. Sadece POI merkezini yola yapıştırmak tesis girişini doğrulamaz.

Karşı şerit, bölünmüş yol, tek yön, bariyer/özel erişim, kapalı tesis ve hatalı snap örnekleri incelenir. Bilinmeyen fiziksel erişim, provider'ın yalnız geometri üretebilmesiyle kesinleştirilmez. Sapma süre/mesafesi rota dışında çift sayılmaz; dönüş noktası/ilerleme bilgisi taşınır. Aynı rota üzerindeki farklı geçişler tek coğrafi nokta diye kaybedilmez.

### 9.5 — Orkestrasyon, kota ve saklama

Sorgu başına alternatif/adaya ve toplam dış çağrı/krediye bütçe konur. Öneri: ilk etapta en fazla üç toplam yol alternatifi, coğrafi/uyumluluk elemesinden sonra az sayıda gerçek sapma sorgusu. Sayısal bütçe plan erişimiyle kesinleştirilecek. Bütün 500 katalog adayına API çağrısı yapılmaz; az sayıda eleme sonucunun optimum EV plan garantisi olmadığı kapsam metadatasında kalır.

Maliyet HTTP adedi yerine sağlayıcının request/kredi birimiyle de izlenir. Günlük ortak kota ve eşzamanlı istek tekilleştirme çok instance'ta PostgreSQL store sınırından geçer. Route request işleri statik katalog import lease'ine körlemesine bağlanmaz; istek kapsamı/öncelik/iptal farklıdır. Ağ çağrısı açık DB transaction'ında beklemez. Timeout/cancellation/429/backoff kontrollü, ücretli kaynağa sessiz geçiş yok.

Cache ancak kaynak koşulları izin veriyorsa kullanılır. Anahtar; koordinat/yaklaşım yönü, araç/yol profili, kaçınmalar, hareket zamanı/zaman dilimi, sağlayıcı ve veri/politika sürümünü dikkate alır. Koordinatı kaba yuvarlayarak karşı şeridi aynı sorgu saymak yanlış olabilir. Statik geometri ve trafik TTL'si aynı olmaz. İzin verilmediyse ham/normalize yol yanıtı kalıcı ortak DB'ye alınmaz; keyfi kendi yol grafiği oluşturulmaz.

Seyahat adresleri/konumlar hassas veri kabul edilir; paylaşılan cache/loglar için en az veri ve erişim sınırı gerekir. Kalıcı kişisel seyahat geçmişi auth/sahiplik altyapısı tamamlanmadan bu görevle açılmaz.

### 9.6 — Doğrulama ve tamamlanma

Kısa şehir içi, uzun şehirler arası, dağlık yol, iki yön, karşı şerit/otoyol tesisi, ücretli yol/feribot tercihi, ulaşılamayan nokta, eksik hız/yükseklik/trafik, bozuk geometri ve kota hatası senaryoları hazırlanır. Koordinatlar kullanıcıdan/test girdisinden gelir; belirli koridor ürün kısıtı değildir.

- Gerçek yetkili yanıt doğru normalize ediliyor; hareket zamanı ve trafik statüsü taşınıyor.
- Rota toplamları/segmentler uyumlu; manevra ve kesim sınırları doğru.
- Yerel istasyon sorgusundan gelen bir adayın gerçek sapma hesabı, bağımsız dönüş/erişim incelemesiyle doğrulanıyor.
- İkinci sahte yol adapter'ı core değiştirmeden aynı sözleşmeyi sağlıyor; başka provider'a geçişte kimlik/geometri karışmıyor.
- Normalizasyon/DB koordinasyonu için yerel fixture yükünde p95/p99; izinli düşük hacimde gerçek dış servis süresi ayrı ölçülüyor. Free API'ye yük testi yapılmıyor.

DONE için sözleşme/sahte sağlayıcı yeterli değil: yetkili gerçek adapter, Türkiye örneği, eksik veri politikası, kaynak/hesap maliyet sınırları ve gerçek sapma kanıtı gerekiyor. Haritada gösterim/navigasyon veya enerji motoru ayrıca tamamlandı sayılmaz.

## Açık seçimler ve sonraki adım

İlk sağlayıcı ve uygun değerlendirme hesabı; ilk örnek koordinatlar; cache/gösterim koşulları; eksik yükseklik için ek kaynak; sayısal alternatif/sapma/timeout ve ölçüm bütçeleri açık. Önce sağlayıcı uygunluk matrisi tamamlanıp seçim birlikte yapılacak, ardından gerçek erişimle teknik uygulama başlayacak. Bu hazırlıkta yeni servis kurulmadı, dış mesaj gönderilmedi veya ücretli hizmet alınmadı.
