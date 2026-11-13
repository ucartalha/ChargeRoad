# CR-010 — Hava sağlayıcısı teknik teslimi

12 Kasım güncellemesi: beş konumlu `POST /v1/weather/route-preview`, `WeatherService.forNavigation` ileri penceresi ve koşullu hücre cache paylaşımı eklendi. [Review, politika, testler, ölçümler ve açıklar](WEATHER_REVIEW_2026_11.md). Bu yeni modlar mevcut ayrıntılı enerji planlamasının yerine geçmez; mobil aktif navigasyon bağlantısı henüz yoktur.

Tarih: 2026-11-11. Durum: DONE. MET Norway adapter'ı, provider registry, PostgreSQL paylaşılan cache/kota, rota örnekleyici, geçiş saatine eşleme ve HTTP pilotu uygulandı. Bu teslim hava veri altyapısıdır; tüketim/SOC motoru CR-011, şarj hesabı CR-012, durak optimizasyonu CR-013 ve navigasyon CR-019 kapsamındadır.

## Kabul edilen davranış

[ADR-008](adr/008-weather-provider-and-planning-policy.md): MET Norway ile başlangıç, gerektiğinde başka provider ekleme; kullanılabilir temel hava/güncel cache yoksa güvenilir enerji planında veri yetersiz sonucu; V1 için şimdiden sonraki 72 saatte hareket penceresi. Yolculuğun bütün geçiş saatleri ayrıca kaynak tahmin ufkunda olmalıdır. Daha ileri hareket zamanı için ön rota davranışı uygulanır.

Kullanıcı MET koşullarını okuduğunu ve ChargeRoad için kabul ettiğini 2026-11-11'de açıkça bildirdi. Public GitHub reposu doğrulandı; yerel User-Agent uygulama/sürüm ve repo bağlantısını içeriyor. Kaynak veri [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ile atıflı taşınır: [MET Norway lisans/atıf](https://www.met.no/en/free-meteorological-data/Licensing-and-crediting). İkinci gerçek hava sağlayıcısı veya ücretli fallback eklenmedi.

## Mimari

- `WeatherAdapterRegistry` / `WeatherAdapter`: kaynak seçimi, URL oluşturma, ham seri normalizasyonu ve kabiliyetler. Bağımsız ikinci sentetik adapter registry ile kullanılabiliyor. Mevcut `WeatherProvider` uygulama portu korunuyor.
- `MetNorwayAdapter`: `compact` GeoJSON, birim doğrulama, gerçek kaynak koordinatı/kotu, değişken zaman adımları ve veri güncelleme zamanı. Araç SOC veya kullanıcı kimliği kaynağa gönderilmez.
- `WeatherCacheStore`: PostgreSQL'de koşullu GET, shared cache, kota/pacing, eşzamanlı fetch sınırı, lease/fencing ve backoff. Ağ beklerken DB transaction açık tutulmaz.
- `sampleRouteWeather` / `WeatherService.forRoute`: yol boyunca örnek konumları, her segmentin orta geçiş saati ve durak gecikmelerini bağlar. Engine ileride bu örnekleri kullanabilir; mevcut `PlanningCoordinator` port üzerinden hazır hava verisini doğrular. Üretim enerji motoru yerine sahte engine bağlanmadı.
- `WeatherService.forecast`: sorgu başına aynı query/segment/istenen konum/zamanı korur; aynı örnek konumuna ait zaman serisini farklı geçiş saatlerinde yeniden kullanır. Yakın bir örnek kullanıldığında gerçek örnek koordinatı ve uzaklık metadata'da ayrıdır.

Sözleşme uyumu için mevcut `WeatherForecast[]` dönüşü korunup her kayda `status` ve metadata eklendi; ayrı wrapper zorunlu tutulmadı. Eski fixture'larla uyumlu opsiyonel alanlar vardır; gerçek adapter'ın bütün sonuçları açık status taşır. `available`, `partial`, `stale`, `outside_horizon`, `provider_unavailable`, `budget_exhausted` ayrılır. `partial` tek başına enerji için yeterli sayılmaz: sıcaklık, rüzgâr hızı ve hareketli rüzgârda yön/tazelik ayrıca kontrol edilir.

## Zaman ve veri kalitesi

`forecastIssuedAt` gerçek üretim zamanı bilinmiyorsa null; MET `updated_at` ayrı `sourceUpdatedAt` alanıdır. `fetchedAt` gövdenin indirildiği an; `lastValidatedAt` 304 dahil son doğrulamadır. 304 gövdeyi, kaynak güncelleme ve ilk gövde indirme zamanını değiştirmez. Sorgu sürerken yeni veri yayımlanırsa değerlendirme indirme sonrasındaki saate göre yapılır; meşru yeni güncelleme hatalı biçimde gelecekte sayılmaz.

MET [Forecast JSON](https://api.met.no/doc/ForecastJSON) ve [veri modeli](https://api.met.no/doc/locationforecast/datamodel) temel alınır. Birim/alan uyuşmazlıkları reddedilir. Sıcaklık doğrusal, rüzgâr vektör bileşenleriyle interpolasyon kullanır; 359°–1° yönleri 180° ortalamasına dönüşmez. Rüzgâr geldiği yön ve km/sa olarak taşınır. Sakin rüzgârda yön null olabilir; hareketli rüzgârda yön eksikse temel veri yetersizdir. Aralık dışına extrapolation yapılmaz; 6 saatten büyük veri boşluğu kullanılmaz.

Yağış toplamı kaynak periyoduyla saklanır; `precipitationMmPerHour` ilgili periyodun ortalamasıdır. Altı saatlik toplam tek bir saatte yağmış gibi gösterilmez. Kar derinliği ve bulunmayan yağış olasılığı null kalır. Basınç `sea_level` türüyle gelir; yüzey basıncı olarak etiketlenmez. Dış hava batarya sıcaklığı değildir; 10 m rüzgârı araç üstü ölçüm sayılmaz. Bu dönüşümlerden tüketim/termal katsayısı uydurulmaz.

Rota yükseklik verisinin doğrulama açığı sürdüğünden bu teslim rota kotunu MET'e kesin rakım olarak göndermiyor. Sağlayıcının kullandığı arazi kotu metadata'da açık. Kaynak modelinin yerel arazi koşullarını tam temsil ettiği veya meteorolojik doğruluğunun saha ölçümüyle kanıtlandığı iddia edilmez. Task 9'un [V1 backlog'u](V1_RELEASE_BACKLOG.md) korunur.

## Örnekleme ve duraklar

Başlangıç/son ve yol boyunca yaklaşık 10 km veya 15 dakika aralık ile şarj erişim/durak sınırları örnek noktalarıdır. Her segment için geometri boyunca mesafe ağırlıklı orta nokta ve zaman çizelgesindeki orta geçiş saati hesaplanır. En yakın seçilmiş örnek kullanılır; 10 km üstü uzamsal boşluk başarı diye geçmez. Kaynak çözünürlüğü olduğundan daha hassas gösterilmez.

`forRoute` girdisindeki `stops[{segmentId,delaySeconds}]`, belirtilen segment başlamadan önce uygulanır. Aynı segment için bütün bağlantı/şarj/kuyruk süreleri tek toplamda verilir; mükerrer/bilinmeyen segment reddedilir. Gecikme null ise o noktadan sonraki kesin geçiş saatleri üretilmez; önceki kesimler kalır ve sonuç `insufficient_data` olur. Şarj süresi değişince ileri kesimler yeni saatle eşlenir; mevcut kaynak serisi yeterliyse yeniden HTTP gerekmez.

Bu örnekleme sunucudaki `forRoute` yardımcısında uygulanır. Core engine'in doğrudan `forecast` sorgularında seçili konumlar `sampleLocation` ile taşınmalıdır; portun her segment için bağımsız yeni konum üretmesi HTTP tasarrufu sağlamaz. CR-011/013 gerçek engine bağlantısı bu API'yi kullanacak.

## Politika ve işletim

| Sınır | Uygulanan başlangıç değeri |
| --- | --- |
| Geçiş query / seçilmiş örnek | En fazla 10.000 / 64 |
| Aynı hesaplamada gerçek dış çağrı | En fazla 64; planın bütçe bağlamı ile bütün bacaklar arasında ortak, doğrudan çağrıda aynı AbortSignal kapsamında |
| Ortak provider hızı / aktif fetch | En fazla 2 istek/sn / 2; bütün instance'ların toplamı |
| Günlük dış çağrı | 1.000, UTC günü; bize ait koruma, sağlayıcı kotası iddiası değil |
| Fetch / hava adımı timeout | 5 sn / 30 sn; daha kısa caller deadline'ı öncelikli |
| Kaynak güncelleme yaşı / model veri aralığı | En fazla 12 saat / 6 saat |
| Lease | 15 sn; geç worker yeni sahibin verisini veya backoff durumunu değiştiremez |
| SQL transaction / lock timeout | 2 sn / 250 ms |
| Yanıt boyutu | En fazla 1 MiB, JSON |

Cache isabeti dış çağrı bütçesini tüketmez. `weather/1.1.0` politikasında 64 örneğe kadar veri alınabilir; küresel hız sınırı ve 30 saniyelik yürütme bütçesi nedeniyle soğuk cache'te hepsinin yetişeceği garanti edilmez. Eksik kesimler açıkça `budget_exhausted` veya ilgili sağlayıcı durumu olarak döner. Örnekler sessizce seyreltilmez; bu sınırlar sınırsız uzun rota hizmeti veya üretim SLA değildir.

[MET istemci kurallarına](https://api.met.no/doc/locationforecast/HowTO) uygun `Expires` / `Last-Modified` tutulur, süre sonrasında `If-Modified-Since` kullanılır. Eksik/bozuk/geçmiş `Expires` için uyarılı 1 saat güvenli tekrar beklemesi vardır; bu meteorolojik tazelik kanıtı sayılmaz. Kaynak bayatsa header hâlâ tekrar istemeyi yasaklıyorsa yeni istek yerine yetersiz veri sonucu döner. 429/Retry-After ve diğer hatalarda instance'lar ortak bekler; otomatik retry/fallback döngüsü yoktur. 203 ürün eskime uyarısı taşınır.

İlk istemcinin iptali diğer bekleyicilerin ortak fetch'ini düşürmez. Fetch bağımsız 5 saniyede sınırlıdır; iptal edilen caller kendi sonucunu beklemez. Redis veya yeni kuyruk altyapısı yoktur. Ağ sırasında açık DB transaction tutulmaz.

Migration `010_weather_provider_cache.sql` yerel DB'ye uygulandı. Cache anahtarı HMAC'tir, kullanıcı/rotanın tamamı saklanmaz. Gövde örnek koordinatını içerir; DB erişimi sınırlandırılmalıdır. Temsil, HTTP expiry sonrasına 24 saat fiziksel saklama penceresiyle tutulur. API çalışırken her 15 dakikada bir indeksli temizleme yapılır; uygulama kapalıyken çalıştırmak için `weather:cleanup` komutu vardır. Aktif lease silinmez. Bu bakım hava polling'i değildir; haftalık araç/istasyon job'larına bağlanmaz.

## Kullanım

`.env.example` kapalıdır; yerel `.env` kullanıcı kabulü sonrasında etkinleştirildi:

```env
WEATHER_ENABLED=true
WEATHER_PROVIDER_ID=met-norway
WEATHER_MET_TERMS_ACCEPTED=true
WEATHER_USER_AGENT=ChargeRoad/0.1 (https://github.com/ucartalha/ChargeRoad)
WEATHER_MET_ENDPOINT=https://api.met.no/weatherapi/locationforecast/2.0/compact
```

Bu kabul bayrağı koşul kabul işleminin yerine geçmez; burada kullanıcının açık yanıtına dayanır. Yeni kurulum kendi gerçek iletişim bilgisini kullanmalıdır. Mevcut ortak HMAC gizli anahtarı `RATE_LIMIT_IP_HASH_SECRET` ile, ayrı domain önekiyle kullanılır; anahtar mobil uygulamaya verilmez.

`POST /v1/weather/forecast` rate-limitli pilot endpoint'idir. Büyük yol geometrisini yeniden taşımak yerine en fazla 64 query alır:

```json
{
  "departureAt": "2026-11-11T18:00:00Z",
  "queries": [{
    "id": "weather-1", "segmentId": "segment-1",
    "location": {"latitude": 39.92, "longitude": 32.85},
    "validAt": "2026-11-11T18:15:00Z"
  }]
}
```

Tarih örnektir; gerçek istekte gelecekteki geçerli zaman kullanılmalı. `sampleLocation` opsiyonel kontrollü örnek koordinatıdır; istenen noktayla uzaklık denetlenir. Sonuç `weather_ready`, `insufficient_data` veya `preliminary_route` taşır. `weather_ready` SOC/şarj hesabının tamamlandığı anlamına gelmez. Core coordinator'da da 72 saat penceresi ve hava yeterliliği kontrolü vardır; istemcinin `unknownWeather` tercihi kabul edilen V1 politikasını gevşetmez.

```powershell
pnpm --filter @chargeroad/api db:migrate
pnpm --filter @chargeroad/api weather:validate ../../artifacts/task9-valhalla/normalized-route.json
pnpm --filter @chargeroad/api weather:benchmark
pnpm --filter @chargeroad/api weather:cleanup
pnpm --filter @chargeroad/api test:db
```

Doğrulama CLI'si herhangi bir normalize `RoadRoute` / route response dosyası alır; Ankara ürün kısıtı değildir. `artifacts/` yerel ve git dışıdır; gerçek kişisel seyahatler fixture/rapor olarak kaydedilmemelidir.

## Kanıt ve tamamlanma

[Gerçek Türkiye raporu](validation/task10-weather-validation.json): 207 yol kesimi iki örnek noktasıyla eşlendi; kaynakta toplam iki gerçek MET sorgusu kaydedildi. Tekrarda ve HTTP 200 kontrolünde ek dış çağrı sıfır. Temel hava alanları mevcut; gerçek model üretim zamanı, kar derinliği ve yağış olasılığı bilinmeyen olarak kaldı. Kapsam/geçiş saatleri ve kullanılan kaynak kotları raporda mevcut. Bu API entegrasyon kanıtıdır, bağımsız hava doğruluk ölçümü değildir.

[Yerel benchmark](validation/task10-weather-benchmark.json): 1.000 kez 207 query normalizasyonu p95 yaklaşık 1,54 ms, p99 1,88 ms; dört eşzamanlı worker ile 1.000 PG cache isabeti p95 2,14 ms, p99 2,74 ms. Dış hava servisine yük testi yapılmadı; sonuçlar geliştirici bilgisayarı ve bu fixture içindir.

Testler: kaynak/gövde/304 tarih ayrımı, eşzamanlı tekilleştirme/iptal, fencing, pacing/kota/backoff, model güncellemesi sırasında saat sınırı, birim/yön/interpolasyon, seyrek seri/yağış aralığı, eksik temel alan, 72 saat/ufuk, durak sonrası zaman ve bilinmeyen bekleme; HTTP ve fiziksel temizlik dahil. API/DB, shared sözleşme, mobil tip kontrolü ve API derlemesi teslim kontrolleridir. Kapanış sayıları görev kaydında tutulur.

Task 10'dan gizli ertelenmiş kabul maddesi yoktur. Gerçek tüketim doğruluğu, saha kalibrasyonu, batarya termal modeli, ürün hava ekranı ve navigasyon ayrı görevlerdir; Task 9'un V1 açıkları bu teslimle kapanmaz.
