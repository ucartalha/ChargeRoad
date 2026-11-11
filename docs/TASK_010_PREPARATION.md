# CR-010 — Hava durumu adaptörü hazırlığı

Tarih: 2026-11-11. Durum: DONE; bu belge uygulama öncesi taslağın tarihsel kaydıdır. Kullanıcının “taskı böyle yapalım, başlayalım ve eksiksiz bitirelim” talebi üzerine uygulama ve gerçek MET erişimi tamamlandı. Güncel mimari, kesin sayısal sınırlar, test ve gerçek pilot kanıtı [teknik teslimde](WEATHER_PROVIDERS.md). Aşağıdaki TODO/öneri ifadeleri güncel uygulama durumu değildir. Kabul edilen kararlar [ADR-008](adr/008-weather-provider-and-planning-policy.md)'de.

## Kesinleşen kapsam

- İlk adapter MET Norway Locationforecast; diğer servisler provider sınırından sonradan eklenebilir.
- Kullanılabilir güncel cache de yoksa temel hava eksikliği güvenilir enerji/SOC/şarj planını durdurur. Yol geometrisi ön rota olarak kalabilir.
- Ayrıntılı V1 planı için hareket penceresi şimdi–72 saat. Yolculuk sonu 72 saati aşabilir, ancak her geçiş/şarj zamanı mevcut tahmin serisince kapsanmalıdır. Pencerenin içinde olmak yeterli veri garantisi değildir.
- Hava motoru tüketim katsayısı, termal model, şarj eğrisi veya rota optimumu hesaplamaz. Bunlar CR-011/012/013'tedir. Navigasyonda periyodik yeniden planlama CR-019'dadır; Task 10 gerekli veri altyapısını sağlar.

## Mevcut kod ve değişiklik ihtiyacı

`WeatherProvider.forecast(WeatherQuery[], AbortSignal)` portu mevcut; query segment/konum/geçiş saati taşır. `PlanningCoordinator` tam eşleşme, iptal, örnek bütçesi ve şarj sonrası değişen zamanı destekler. Üretime bağlı gerçek hava adapter'ı, ortak hava cache'i ve hava HTTP endpoint'i yok.

`road-weather.ts` içinde `forecastIssuedAt` zorunlu; `evaluation.ts` bunun yaşını kontrol ediyor. Sağlayıcının model üretim zamanını vermediği durum için mevcut sözleşme yeterli değil. Yalnızca yeni adapter yazmak yerine shared sözleşme, port sonucu, coordinator, evaluation ve fixture'lar birlikte güncellenecek. Sahte tarih eklenmeyecek. Mevcut road contract ve istasyon cache'i hava verisiyle birleştirilmeyecek.

## Önerilen akış ve sorumluluklar

`Kesimler + geçiş zamanları → WeatherSampler → WeatherGateway → PostgreSQL cache / WeatherAdapter → normalize seri → kesimlere zaman eşleştirmesi`

| Bileşen | Sorumluluk |
| --- | --- |
| WeatherSampler | Yol/zaman çizelgesinden sınırlı sayıda örnek noktası seçer; kaynak grid hassasiyeti ve arazi değişimini gözetir. |
| WeatherGateway | İstenen örnekleri gruplayıp kayıtlı adapter'a yönlendirir; kapsam/tazelik/alan yeterliliği ve bütçeyi uygular. |
| WeatherAdapterRegistry | Provider ve kabiliyetleri: coğrafi kapsam, değişkenler, zaman çözünürlüğü/ufku, kaynak/lisans, çoklu konum desteği. |
| MetNorwayAdapter | `compact` yanıtını okur; başlıkları, değişken birimlerini, zaman serisini ve kaynak koordinatını normalize eder. |
| WeatherCacheStore / WeatherRequestCoordinator | PostgreSQL üzerinden ortak cache, tekilleştirme, lease/fencing, kota/bekleme ve temizlik; ağ boyunca açık transaction yok. |

Road client'ın POST/JSON-odaklı taşıması doğrudan kopyalanmamalı. Hava GET, cache başlıkları, koşullu istek ve gövdesiz 304 gerektiriyor. Ortak store ilkeleri korunur; provider'a özel HTTP semantiği ayrı kalır. Kaynak ekleme otomatik ücretli fallback anlamına gelmez.

## Rota boyunca örnekleme

Her 60 saniyelik yol segmentine bir HTTP isteği yapılmaz. Önce gerçek yol boyunca meteorolojik örnek noktaları seçilir. Başlangıç önerisi: en fazla **10 km veya 15 dakika** aralık; başlangıç/son, şarj konumu ve anlamlı doğrulanmış kot değişimlerinde ek örnek. Aynı noktadan alınan zaman serisi birden çok kesim/alternatif için kullanılabilir. Bu aralıklar tahmin modeline gerçek dışı çözünürlük kazandırmaz.

Query'nin istenen konum/zamanı korunur; kullanılan örnek koordinatı, yüksekliği, uzaklığı ve zaman aralığı ayrıca taşınır. Yakın örnekten aktarım açık yöntem bilgisi taşır; komşu örnek koordinatı gerçek segment koordinatıymış gibi gösterilmez. MET'e gönderilecek koordinatlar en fazla dört ondalığa kesilir; koordinat ve yükseklik seçimi cache anahtarının parçasıdır.

İlk yol zamanları sürüş sürelerinden gelir. Şarj/kuyruk/durak süresi eklendiğinde ileri kesimlerin `validAt` değeri yeniden hesaplanır. Zaman mevcut cache serisinde kapsanıyorsa yeniden HTTP gerekmez; kapsam/tazelik yoksa bütçe içinde fetch denenir. Belirsiz kuyruk süresi kesin saat diye gizlenmez; senaryo veya yetersiz veri kararı planlayıcıya aittir.

Sabit örnek bütçesi aşılırsa örnekleri sessizce seyrelterek başarı dönülmez. Yeni bütçe/kapsam sonucu oluşturulur veya ön rota davranışına geçilir. Ülke çapında hava verisi önceden taranmaz.

## Meteorolojik doğruluk

[MET veri modeli](https://api.met.no/doc/locationforecast/datamodel), Türkiye gibi Nordic/Arctic dışındaki bölgeler için yaklaşık 9 km global model tarif ediyor; karmaşık arazide özellikle rüzgârın yerel koşulu tam yansıtmayabileceğini belirtiyor. Türkiye örnekleri olmadan doğruluk iddiası yok.

- Temel alan önerisi: gerçek hava sıcaklığı, rüzgâr hızı ve yönü. Sakin rüzgârda yönün eksik olması ayrı değerlendirilir. Hissedilen sıcaklık gerçek sıcaklığın yerine geçmez; dış hava sıcaklığı batarya sıcaklığı değildir.
- `wind_from_direction` rüzgârın geldiği yön; m/s → km/sa dönüşümü açık. 359° ile 1° ortalaması 180° olamaz: zaman interpolasyonu vektör bileşenleri üzerinden yapılır. Araç hızıyla bağıl hava hızı hesabı CR-011'in işidir; 10 m yükseklikteki tahmin doğrudan araç üstü ölçüm sayılmaz.
- Zaman serisi UTC; zaman adımları yanıttan okunur. Saatlik/6 saatlik fark gizlenmez. Sıcaklık ve rüzgâr için yalnızca aynı serinin kapsayan iki örneği arasında, yöntem ve aralık kayıtlı interpolasyon önerilir. Ufuk dışında extrapolation yapılmaz.
- Yağış miktarı bir zaman aralığı toplamıdır; 6 saatlik toplam saatlik ani yağış gibi atanmaz. Olasılık alanı her bölgede/yanıtta bulunmayabilir. Kar derinliği, yağış olasılığı veya basınç eksikse sıfır değil null kalır. Alanlar kanıt olmadan birbirinden üretilmez.
- Deniz seviyesine indirgenmiş basınç, yüzey basıncı değildir. Basınç türü/birim/yükseklik metadata'sı taşınır; ham deniz seviyesi basıncı yüksek rakımda doğrudan hava yoğunluğu hesabına verilmez.
- Rota kotunun kaynağı doğrulanmadıysa MET'e kesin rakım olarak gönderilmez; sağlayıcının kullandığı rakım ve uyarı saklanır. Task 9'un yükseklik açığı [V1-ROAD-005](V1_RELEASE_BACKLOG.md)'te devam eder.

## Zaman kaynağı ve sonuç sözleşmesi

[Forecast JSON](https://api.met.no/doc/ForecastJSON), `meta.updated_at` alanını tahmin verisinin güncellenme zamanı olarak tanımlar. Modelin başlatıldığı an veya bizim indirme anımız değildir.

Önerilen metadata: `modelRunAt`/gerçek üretim zamanı nullable; `sourceUpdatedAt`, `fetchedAt`, `lastValidatedAt`, `validAt`, `coverageStart/End`, kaynak zaman adımı, interpolasyon yöntemi, kullanılan örnek konumu/kotu, birimler, attribution ve lisans. Mevcut `forecastIssuedAt` alanı bu ayrımı bozmadan yeniden tanımlanacak/nullable yapılacak; eski validator yeni nullable alanı doğrudan parse etmeyecek.

`WeatherProvider` uygulama sınırı korunur; dönüş tipi query başına açık outcome taşıyacak şekilde genişletilmesi önerilir: `available`, `partial`, `stale`, `outside_horizon`, `provider_unavailable`, `budget_exhausted`. Outcome query ID/segment/istenen konum/zamanla birebir eşleşir; mevcut eksik/mükerrer/fazla yanıt kontrolleri korunur. Adapter keyfi query atlayamaz. Alan düzeyinde eksiklik ve kaynak hatası aynı status değildir.

Temel alanları eksik/bayat veya ufuk dışı sonuç, kabul edilen politikayla güvenilir enerji planına girdi olamaz. Yağış/kar gibi opsiyonel alanlar eksikken temel alanlar mevcut olabilir; bu durum kayıtlı uyarı taşır, kar/ıslaklık açısından veri yeterliymiş gibi gösterilmez. Enerji motoru daha fazla alan gerektirirse yeterlilik kapısını genişletebilir.

## Cache, maliyet ve yatay ölçek

İlk DDL önerisi: `weather_forecast_cache` ve `weather_provider_state`. Tam kullanıcı rotası/hesabı yerine sağlayıcı örnek koordinatı + kullanılan rakım + istenen değişkenler + adapter/politika sürümü anahtar olur. Cache zaman serisi tutar; aynı noktaya 10:10 ve 10:40 geçişi iki dış sorgu olmamalı. Aynı sorgunun eşzamanlı instance'ları PostgreSQL lease/fencing üzerinden paylaşır.

[MET istemci rehberine](https://api.met.no/doc/locationforecast/HowTO) göre `Expires` ve `Last-Modified` saklanır; süre dolunca `If-Modified-Since` kullanılır. 304 mevcut gövdeyi korur ve doğrulama/cache başlıklarını günceller; meteorolojik kaynak zamanını yenilemez. Aynı kaynağa `Expires` öncesi tekrar istek yapılmaz. Cache kullanılabilirliği ile meteorolojik tazelik farklıdır: veri bayatsa ve yenileme henüz izinli değilse başarılı güncel veri sayılmaz.

Redis eklenmez; bellek içi veri yalnızca istek kapsamındaki tekrar hesapları azaltır. Instance sayısı artsa da kota/tekilleştirme ortak store'dan geçer. Cache olmadan her GPS güncellemesinde dış istek yapılmaz. Ekran kapalıyken yalnızca bu özellik için arka plan hava polling'i açılmaz; haftalık katalog job'ı hava için uygun değildir.

Başlangıç teknik önerileri — gerçek küçük pilotta değerlendirilecek:

| Ayar | Öneri | Açıklama |
| --- | --- | --- |
| Bir hesaplamada örnek | En fazla 64 benzersiz konum | Alternatifler/iterasyonlar arasında paylaşılır; bütçe aşımı açık sonuç. |
| İş başına dış çağrı | En fazla 16 | Cache isabetleri dış çağrı bütçesini tüketmez. Cold-cache kalan örnekler için başarı uydurulmaz. |
| Provider ortak trafik | 2 istek/sn, en fazla 2 eşzamanlı fetch | Bütün instance'lar için toplam; üretim kapasite garantisi değil. |
| Günlük geliştirme bütçesi | 1.000 dış çağrı | Bize ait sınır; sağlayıcının ücretsiz kota taahhüdü değildir. |
| Timeout | Fetch başına 5 sn; hava adımı toplam 20 sn | Planlayıcının daha kısa kalan deadline'ı öncelikli. |
| Kaynak güncelleme yaşı | Başlangıçta en fazla 12 saat | Global model güncellemesi ile uyum pilotta kontrol edilir; `fetchedAt` ile hesaplanmaz. |
| Cache tekrar kontrolü | Sağlayıcının `Expires` başlığı | Keyfi 15 dakikalık polling yapılmaz; eksik/bozuk başlıkta güvenli bekleme ve uyarı. |
| Fiziksel saklama | Kapsam bitimi sonrası en fazla 24 saat | Periyodik temizlik; kişisel seyahat geçmişi değildir. |

429/Retry-After, timeout ve 5xx ortak beklemeye yol açar; sınırsız retry veya otomatik ücretli fallback yok. 203 deprecation uyarısı izlenir. İstemci iptali, ağ/gövde boyutu sınırı ve DB sorgu bütçesi uygulanır. Aynı isteği paylaşan başka bekleyici varsa bir istemcinin iptali diğerlerini hatalı biçimde iptal etmemeli.

MET için gerçek API kullanımından önce [koşullardaki](https://api.met.no/doc/TermsOfService) insan tarafından okuma/kabul gerekliliği ve gerçek iletişimli User-Agent tamamlanmalı. Bu hazırlıkta yalnızca doküman okundu. İletişim adresi/repo dışarıdan erişilebilir olmalı; özel repo otomatik uygun sayılmaz. API'ye kullanıcı kimliği/tüm rota gönderilmez; yalnızca gerekli örnek konumları gönderilir, ham URL/konum loglanmaz.

## Uygulama adımları

1. **10.1 — Kaynak erişimi ve Türkiye örneği:** Kullanım gereklilikleri, tanıtıcı istemci, küçük gerçek `compact` yanıtı; alan/birim/zaman/başlık matrisi. Ücretli hesap veya mail yok.
2. **10.2 — Sözleşme ve politika:** Zamanların ayrılması, query outcome'ları, basınç/yağış aralığı/örnekleme metadata'sı; shared fixture, coordinator ve evaluation geçişi. Ürün kararları sunucu politikasıdır, mobil istemci sessizce gevşetemez.
3. **10.3 — Provider ve normalizasyon:** Registry, MET adapter, birim/yön/interpolasyon ve açık eksik alanlar; bağımsız ikinci sahte adapter ile değiştirilebilirlik testi.
4. **10.4 — PostgreSQL altyapısı:** Ayrı migration, paylaşılan cache, koşullu GET/304, lease/fencing, global kota/bekleme ve temizlik komutu. Ağ sırasında transaction açık tutulmaz.
5. **10.5 — Kesim/zaman eşleme:** Kontrollü örnek seçimi, alternatif paylaşımı, şarj sonrası kaymış saatler; gerçek SOC motoru icat edilmeden sentetik zaman çizelgesiyle doğrulama.
6. **10.6 — Entegrasyon ve ölçüm:** Provider portu ve gerekiyorsa rate-limitli geliştirme API'si; gerçek küçük pilot + yerel p95/p99. Üretim enerji plan endpoint'i CR-011/013 tamamlanmadan varmış gibi açılmaz.

## Kabul kapıları

- En az bir gerçek Türkiye zaman serisi ve normalize alan/başlık raporu; tek şehir ürün kısıtı olmaz.
- Bütün rota için tek hareket saati kullanılmadığı ve şarj gecikmesinin sonraki geçiş saatlerine yansıdığı test edilir.
- Model zamanı/güncelleme/alınma/304 doğrulama zamanı birbirinin yerine geçmez; cache hit eski tahmini yeni tahmin yapmaz.
- m/s-km/sa, 359°–1° rüzgâr, sakin rüzgâr, seyrek zaman adımı, yağış aralığı ve deniz seviyesi/yüzey basıncı ayrımı sınanır.
- Eksik alan/bozuk yanıt, ufuk dışı, geçmiş zaman, 72 saat sınırı, saat dilimi, 203/304/429/5xx, timeout/iptal ve günlük bütçe ayrı davranır.
- Çok instance/same-key tek fetch; geç worker yeni sonucu ezemez; diğer bekleyicinin iptali/cache sahipliği bozulmaz.
- Yerel normalizasyon/cache yükünde p95/p99 raporu; kamu hava servisine yük testi yapılmaz.
- Task 9'un V1 açıkları kapanmış sayılmaz. Task 10'dan ayrıca ertelenecek madde çıkarsa kendiliğinden DONE yapılmaz; kullanıcı kararıyla backlog'a taşınır.

## Sonraki görüşmede netleşecekler

Üç ana karar kabul edildi. Sayısal örnekleme/tazelik/bütçe önerileri ve cache fiziksel saklama süresi, gerçek API erişimi için gerekli kullanım/iletişim bilgileri ve gerçek Türkiye pilot örnekleri henüz kesinleştirilmedi. Bu belge implementasyon başlamış veya API erişim gereklilikleri tamamlanmış anlamına gelmez.
