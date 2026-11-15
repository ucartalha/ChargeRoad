# Uzun rota teşhisi — 2026-11-16

İstek: `d671310d-3b84-4dd4-8b95-717949ba35eb`, kullanıcı tarafından İstanbul–Kelkit olarak tanımlandı. Çalışan sürüm optimizer 1.1.0 / energy 1.3.2 / charging 1.2.0. İnceleme salt okunur kayıt ve sentetik sampler kontrolüdür; bu rapor uzun rota düzeltmesi veya başarılı yeniden planlama iddiası değildir.

## Elde kalan kanıt

Worker çıktısındaki ilgili job_execute sayaçları: hava query item **29982** (catalogue policy sınırı **30000**), enerji değerlendirmesi **130**, şarj entegrasyonu **36**, expanded state **6**, transition **266**, frontier peak **31**. Yol edinimi budgeted **49**, gerçek road HTTP **66**; weather PG hit **2284**, miss **13**, gerçek weather HTTP **13**. İstasyon candidate total **500**, seçilen **16**. Query item, cache hit, engine değerlendirmesi ve HTTP ayrı anlamlardır.

DB sorgusunda job artık bulunamadı. İş tablosu 30 dakikalık TTL ve expired cleanup kullanır; kayıt, hata kodu ve tam süre DB'den yeniden doğrulanamadı. Bu nedenle kesin response kodu/süresi veya ayrıntılı replay bu raporda uydurulmaz. Elde kalan sayaçlar veri değerlendirme sınırına dayanmayı gösterir; tek başına kaynakta hiç istasyon bulunmadığı veya sağlayıcının erişilemediği anlamına gelmez.

İlgili server-log zaman penceresindeki cache'te en uzun road trip **1133,643 km** idi; bu yalnız zaman penceresi eşleşmesidir, request ID ile kesin ilişkilendirme değildir. Ham koordinat, SOC veya sağlayıcı paketi rapora alınmadı.

## Yeniden üretilebilen kod sınırı

`weather-sampler.ts/sampleRouteWeather` tüm yol boyunca yaklaşık 10 km / 900 sn aralıklarla örnek seçer; query'yi her segmentin geçiş zamanına üretir. `WEATHER_POLICY.maxSamples=64`. Sonuçta uzun yolun tamamını tek seferde örnekleme, örnek sayısı limitine çarpar. Drive bunu `WEATHER_SAMPLING_INCOMPLETE` issue'suna çevirerek ilgili bacağı değerlendiremez.

Hiçbir dış sağlayıcı veya DB çağrısı olmadan, aynı fonksiyonla üretilmiş lineer 1 km segmentli sentetik kontrol:

| Sentetik rota | Sonuç |
|---|---|
| 410 km | 42 örnek / 410 query item, PASS |
| 600 km | 61 örnek / 600 query item, PASS |
| 700 km | Weather sample budget, FAIL |
| 1000 km | Weather sample budget, FAIL |
| 1200 km | Weather sample budget, FAIL |

Bu, gerçek İstanbul–Kelkit geometrisinin tam replay'i değildir. Geometri, zaman ve access bölünmeleri nedeniyle eşik kesin bir km sabiti değildir. Yine de uzun rota yolunun sampler sınırına takılabildiğini doğrudan kanıtlar.

## Aramada büyüyen etki

1. Tek uzun bacak örneklenemediğinde seed için başlangıç sürüşünden fiziksel erişim mesafesi çıkartılamayabilir. `fullBatteryProgress` o durumda route fraction **0.55** fallback'inde kalır. Bu, aracın 1134 km'nin %55'ini gidebildiğinin fiziksel kanıtı değildir; uzun yolda seed adaylarını fazla uzağa sıralayabilir.
2. Sonraki node/şarj hedefleri her bacağın bütün segment query item'larını tekrar değerlendirme bütçesine ekler. PG'de hava serisi bulunduğunda dahi farklı segment/zaman sorguları ücretsiz CPU işi değildir ve mevcut muhasebede yeniden sayılır. Bu vakada 13 weather HTTP yanında 29982 item gözlenmesi bu ayrımı gösterir.
3. 500 adaydan 16 seçimi ve ilk feasible zinciri bulmadan bütçe tüketimi, gerekli ardışık durakların değerlendirilememesi riskini artırır. Sadece bu sayaçlardan hangi istasyonun eksik kaldığı kesin söylenemez; bunun için request-scoped replay gerekir.

## Önerilen düzeltme kapsamı

Tüketim/eğim veya şarj eğrisi fiziğini değiştirmek ya da kota sayısını körlemesine yükseltmek yerine: uzun rota boyunca kapsama garantisi olan parçalara ayrılmış/adaptif hava edinimi; her segmentin gerçek ETA'sında forecast eşlemesi ve provenance/tazelik koruması; seed erişimini route yüzdesi yerine doğrulanmış batarya menzili/ilerleyen bacaklardan kurma; ilk feasible şarj zinciri için ayrı bütçe ve koridor boyunca erişilebilir istasyon seçimi. 700–1200+ km ve 3–6 duraklı kabul senaryoları eklenmeli. Mevcut navigation 50 km rolling-window fonksiyonu bütün rota planının yerine doğrudan konamaz: kapsam dışındaki yolu doğrulamış saymak yanlış olur.

Bu incelemede sampler/policy/candidate budget değiştirilmedi; gerçek rota tekrar çağrılmadı ve mevcut DB/cache temizlenmedi. Şarj hedefi iyileştirmesinin 1132 testlik kapanışı ayrı rapordadır.
