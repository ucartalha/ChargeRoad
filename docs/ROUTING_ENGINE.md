# Rota, enerji ve yeniden planlama kuralları

Durum: Davranış gereksinimleri ve tasarım önerisi. Algoritma ayrıntıları DEC-008 ile kesinleştirilecek.

## Sorumluluk sınırı

Yol sağlayıcısı yol geometrisi, mesafe, tahmini sürüş süresi, manevralar ve mevcutsa kesim özelliklerini sağlar. Kendi motorumuz tüketimi, ulaşılabilirliği, şarj hedeflerini ve durak seçimini hesaplar.

CR-002 ile RoutingProvider.routes() yalnızca RoadRoutingRequest/RoadRoutingResult taşır. EV planlama ve şarj durakları bize aittir. WeatherProvider her sorgunun kendi konum ve geçiş zamanını alır. Bunlar arayüz sözleşmeleridir; gerçek sağlayıcı uygulamaları henüz yok. [Ortak sözleşmeler](DOMAIN_CONTRACTS.md).

Hiçbir hesaplama veya yeniden planlama adımı LLM çağrısı gerektirmemeli. Aynı normalize edilmiş girdi, veri anlık görüntüsü ve algoritma sürümüyle sonuç yeniden üretilebilmeli.

## Girdiler

- Başlangıç/hedef koordinatları, hareket zamanı ve araç varyantı.
- Kullanılabilir batarya kapasitesi; varsa batarya sağlık bilgisi.
- Başlangıç veya kullanıcı tarafından güncellenen şarj yüzdesi.
- Minimum rezerv ve hedef varış şarjı.
- Kesim mesafesi, tahmini hız/süre, yükseklik ve yol yönü.
- Kesimden geçiş zamanındaki sıcaklık, rüzgâr yönü/hızı ve yağış bilgisi.
- Uyumlu istasyonlar, EVSE/connector özellikleri, erişim koşulları ve durum verisinin yaşı.
- Araç şarj eğrisi ve istasyonun sağlayabildiği güç sınırları.

Eksik veriler için varsayımlar açıkça kaydedilir; tahminler ölçüm gibi sunulmaz.

## Enerji hesabı

Temel ilişki:

    kalanEnerjiKwh = kullanılabilirKapasiteKwh × şarjYüzdesi / 100
    sonrakiEnerjiKwh = öncekiEnerjiKwh - kesimBataryaTüketimiKwh

Kesim batarya tüketimi; yol alma, eğim, yardımcı sistemler ve sınırlı rejenerasyon etkilerini kapsar. Kapasite ve enerji korunumu sınırları uygulanır; hesaplanan şarj %100'ü aşamaz. Ulaşılamayan bir kesimde negatif enerji sıfıra kırpılıp rota geçerli kabul edilmez.

- İlk model: Referans tüketim + açıkça tanımlanmış hız/sıcaklık/eğim düzeltmeleri.
- Gelişmiş model: Hava direnci, yuvarlanma, eğim, aktarma verimi, rejenerasyon ve yardımcı güç.
- Aynı etki hem referans veride hem düzeltmede iki kez sayılmamalı.
- WLTP veya tek ortalama tüketim gerçek yol tüketimiyle eşdeğer kabul edilmemeli.
- Rüzgâr etkisi yol yönüne göre hesaplanmalı.
- Soğuk batarya etkisi, hava sıcaklığı ile birebir aynı kabul edilmemeli.
- Model gerçek seyahat verileriyle doğrulanmalı; hata payı için rezerv kullanılmalı.

## Şarj süresi

Sabit maksimum kW ile süre hesaplamak yeterli değildir. Güç; şarj yüzdesine, araç eğrisine, istasyona ve mevcut bilgiye bağlıdır.

    süreSaat ≈ integral(dE / etkinBataryaŞarjGücüKw)

AC/DC tarafındaki güç ve kayıpların nerede hesaba katıldığı sözleşmede belirtilir. Bir EVSE'deki alternatif connector'lar bağımsız eşzamanlı şarj kapasitesi gibi sayılmaz.

Önerilen hedef her durakta %100 değildir. Motor, sonraki kesimler ve rezerv için gerekli seviyeleri toplam süre açısından değerlendirir.

## Arama ve erişilebilirlik

Öneri: Durumu konum + batarya seviyesi + zaman olarak modellemek; yol alma ve şarjı geçişler olarak tanımlamak. A*/Dijkstra veya uygun etiketleme yaklaşımı DEC-008'de seçilecek.

- Alternatif yol koridorları değerlendirilir; tek bir polyline yakınındaki istasyonlarla sınırlı çözümün kısıtı belgelenir.
- İstasyona gerçek yol bağlantısı ve sapma süresi hesaplanır. Kuş uçuşu yakınlık erişilebilirlik kanıtı değildir.
- Soket, araç gücü, çalışma saatleri ve erişim koşulları filtrelenir.
- Yolculuk boyunca rezerv ve hedefte varış şarjı kısıtları kontrol edilir.
- Önerilen ilk amaç toplam sürüş + sapma + bekleme + şarj süresini azaltmaktır. Tercihler ve risk politikasını DEC-008 belirler.
- Hava ve istasyon değerlendirmesi varış saatine bağlıdır. Şarj durakları varış saatlerini değiştirir; plan bu zamanlarla yeniden değerlendirilir.
- İterasyon sınırı, sonlandırma ve başarısızlık politikası tanımlanır.
- Batarya/zaman ayrıklaştırması ve aday budama sınırları kaydedilir. Kısıtlı aramada tüm yol ağı için küresel optimum iddiası yapılmaz.

## Müsaitlik ve veri tazeliği

- İstasyon kataloğu ile canlı durum ayrı veri akışlarıdır.
- Durum, asıl kaynak güncelleme zamanı ve sistemin aldığı zaman ayrı saklanır.
- Eski veya erişilemeyen durum bilinmiyor olarak değerlendirilir.
- Güncel müsaitlik, gelecekteki varış anının garantisi değildir.
- Geçmiş veri olmadan kesin bekleme süresi veya istatistiksel müsaitlik olasılığı üretilmez.
- Uygun olduğunda rezervle erişilebilir yedek durak sunulur; yedek yoksa bu durum belirtilir.
- Güncellik eşikleri ve bilinmeyen durum cezası DEC-007/DEC-008'de seçilecek.

## Kullanıcı şarj düzeltmesi

Kullanıcı şarj yüzdesi girdiğinde:

1. Değerin 0–100 aralığında ve sonlu olduğu doğrulanır.
2. Olay zaman damgası, konum bağlamı ve kaynak=user_input ile kaydedilir.
3. Önceki tahminin üzerine fark eklemek yerine yeni enerji başlangıcı atanır.
4. Tamamlanan seyahat geçmişi korunur; yalnızca kalan yolculuk yeniden planlanır.
5. Eski hesaplama yanıtının yeni planı ezmesi engellenir; plan/olay sürümü kontrol edilir.
6. Güncel planın durakları, süreleri ve varış şarjı birlikte güncellenir.

Tekrarlanan düzeltmeler enerjiyi iki kez artırıp azaltmamalıdır. Gecikmiş konum veya şarj olayları açık bir sıralama politikasına tabi olmalıdır.

## Navigasyon tahmini

- GPS ve geçen süre üzerinden hesaplanan değer estimated olarak gösterilir.
- Kullanıcı girişi user_input; gelecekte telemetri gelirse measured olarak ayrılır.
- Rota sapması, GPS gürültüsü ve veri yenilemeleri için tetikleme eşikleri tanımlanır.
- Gereksiz durak değişimini önleyen kararlılık politikası kullanılır.
- Konum kaybında araç ilerliyormuş gibi kesin şarj değeri üretilmez.
- İnternet yokken mevcut planın gösterilmesi ile yeni rota hesaplayabilme kabiliyeti ayrı belirtilir.

## Sonuç ve izlenebilirlik

Plan sonucu; yol geometrisini, kesim enerji/şarj profilini, şarj duraklarını, varış-ayrılış zamanlarını, alınacak enerjiyi, ayrıştırılmış süreleri ve veri güncelliğini içermeli.

Ayrıca algoritma/model sürümü, veri sürümü, varsayımlar ve plan sürümü kaydedilmeli. Sağlayıcı hatası, eksik veri ve ulaşılamaz rota farklı sonuçlar olmalı.

## Zorunlu doğrulama senaryoları

- Şarjsız ulaşılabilen rota; tek durak; birden fazla durak.
- Başlangıç şarjının ilk uyumlu istasyona ulaşmaya yetmemesi.
- Şarj sonrası öneriden düşük/yüksek/aynı kullanıcı girdisi.
- Yolculuk ortasında art arda düzeltme ve gecikmiş yeniden planlama sonucu.
- Soğuk hava, karşı rüzgâr, uzun yükseliş ve kapasiteyle sınırlı iniş rejenerasyonu.
- Eski durum, hizmet dışı istasyon, uyumsuz soket ve yolun karşı tarafında erişilemeyen istasyon.
- GPS sapması, bağlantı kesilmesi ve geçersiz yüzdeler.
- Hiçbir adımda enerji veya rezerv kısıtının sessizce ihlal edilmemesi.
