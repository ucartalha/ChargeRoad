# CR-004: Sağlayıcı sınırları ve planlama koordinasyonu

Tarih: 2026-11-10. Durum: Altyapı ve sahte sağlayıcı testleri uygulandı. Gerçek sağlayıcılar ve enerji/optimizasyon motoru bu teslimde yok.

2026-11-11 güncellemesi: Gerçek [yol adapter'ı](ROAD_PROVIDERS.md) ve [hava adapter'ı](WEATHER_PROVIDERS.md) ayrı görevlerde uygulandı. Aşağıdaki ilk CR-004 teslim akışı korunur; hava tarafında buna PostgreSQL ortak cache/304, query durumları ve V1 72 saat/temel hava yeterlilik politikası eklenmiştir. Üretim enerji/optimizasyon motoru hâlâ ayrı görevdir.

## Sorumluluk ayrımı

| Bileşen | Sorumluluk | Karar vermez |
|---|---|---|
| VehicleEnergyProvider | Varyantın doğrulanmış/sürümlü enerji profilini okumak | Katalog menzilinden tüketim uydurmak |
| RoutingProvider | Yol alternatifleri, segmentler ve yol özellikleri | Şarj durakları veya EV enerji planı |
| StationDataProvider | Rota koridorundaki coğrafi istasyon adayları | Gerçek yol erişimi ve enerjiyle ulaşılabilirlik |
| WeatherProvider | İstenen konum, segment ve geçiş zamanına karşılık tahmin | Durak veya hedef SOC |
| PlanningEngine | Kendi algoritmamız; hava örneklerini ve nihai EV planını istemek/hesaplamak | Dış sağlayıcının hazır EV planını kullanmak |
| PlanningCoordinator | Doğrulama, kaynak snapshot'ları, iptal ve sınırlı veri toplama döngüsü | Tüketim/termal model veya şarj süresi hesabı |

Dış portlar abstract class olarak Nest DI token'larıdır. Her adapter ProviderResponse<T> ile normalize data ve SourceReference döndürür. Yol sağlayıcısının data sözleşmesine chargingStops eklenmesi çalışma zamanında reddedilir.

## Akış

1. Plan isteğini ve sunucu tarafından belirlenecek hazırlık ayarlarını doğrula.
2. Enerji profilini oku. Profil yoksa dış harita/hava isteği başlatmadan insufficient_data dön.
3. Başlangıç/hedef/zaman ve yol tercihleriyle yol alternatiflerini al. Yol portuna araç SOC'si veya enerji profili gönderilmez.
4. Alternatiflerin koridorunda istasyon adaylarını al. Boş katalog geçerli olabilir; sağlayıcı hatası boş listeye dönüştürülmez.
5. Normalize veri ve snapshot'ları kendi PlanningEngine.step metodumuza ver.
6. Engine weather_required döndürürse yalnızca belirttiği konum/zaman örneklerini getir ve tekrar değerlendir.
7. Engine nihai sonuç döndürürse CR-002 planningEvaluationSchema ile giriş–sonuç tutarlılığını doğrula.

Yol sağlayıcısının başarılı null yanıtı bu sözleşmede doğrulanmış yol yok anlamına gelir. Ağ/servis hatası reject edilmelidir; infeasible ile karıştırılmaz.

## Hava güncellemeleri ve veri izi

- Forecast yanıtı istenen query ID, segment, koordinat ve zamanla eşleşir; eksik/fazla/mükerrer sonuç reddedilir.
- Şarj nedeniyle geçiş saati değişince aynı query ID için yeni konum/zaman örneği istenebilir.
- Aynı plan çağrısında birebir aynı örnek için tekrar HTTP çağrısı yapılmaz. Bu yalnızca o hesaplamaya ait bellek içi veri tekrar kullanımını sağlar; global hava cache'i değildir.
- Her başarılı kaynak cevabının normalize datasından SHA-256 üretilir; kaynak ID/sürüm/alınma zamanı korunur.
- Her engine adımı sabitlenmiş bir veri görünümü alır. Engine yeni sonucu döndürür; gelen snapshot'ları değiştirmez.
- Provider hataları kaynak rolü ve güvenli kodla provider_error olur; ham hata/URL/anahtar sonuçta gösterilmez.
- Kendi engine'imizin sözleşme hatası PlanningContractError olarak ayrılır; dış sağlayıcıya yüklenmez.

## Kaynak ve süre sınırları

- request.policy.maxIterations ve maxComputationMilliseconds döngüyü sınırlar.
- maxWeatherQueries hem batch hem toplam hesaplama örnek sayısını sınırlar.
- Son iterasyonda tekrar değerlendirilemeyecek gereksiz bir hava isteği başlatılmaz.
- Monotonik saatle bütçe kontrolü yapılır; bekleyen I/O için deadline timer bulunur.
- Caller iptali bütün işlemlere aynı AbortSignal üzerinden yayılır; artık kullanılmayacak işler için sinyal kapatılır.
- Gerçek adapter'lar HTTP/DB/worker operasyonlarında iptali ve kendi boyut/kota sınırlarını uygulamalıdır.
- Timer, CPU yoğun senkron kodu zorla durdurmaz. Gerçek solver için sınırlı worker ve işbirlikli iptal sonraki görevlerin konusudur.

Hazırlık limitleri şu anda metodun açık argümanıdır; kullanıcıya bunları sınırsız belirleme hakkı veren HTTP endpoint'i eklenmedi. Üretim planlama controller'ı eklenirken politika, yetki ve rate limit sunucuda uygulanmalı.

## Nest entegrasyonu

PlanningModule.register(adapters), dört veri portunu ve uygulamaya ait PlanningEngine'i bağlayan provider'ları alır; PlanningCoordinator'ı dışa açar. Eksik bağlama startup/test compile hatasıdır. Sahte engine veya sağlayıcı üretimde varsayılan olarak eklenmez.

PlanningModule şu anda AppModule'e bağlı değildir; gerçek adapter/engine bulunmadan plan endpoint'i veya çalışan rota hesaplaması sunulmaz. Mevcut araç kataloğu, rate limiting ve mobil ekranlar korunur. LLM SDK/API bağımlılığı eklenmedi.

## Doğrulama ve kalan işler

16 senaryo; Nest DI ile kaynaklardan sentetik plan oluşturma, eksik enerji profili, yol yok/servis hatası ayrımı, dış EV duraklarını reddetme, provenance/varyant kontrolü, hava zamanı/konumu, kaynak hatası, tekrarlı sorgu, örnek bütçesi, iptal, deadline ve iç motor hatasını kapsar.

Test engine yalnızca fixture çıktısı üretir; gerçek tüketim doğruluğu veya rota optimalliği ölçülmez. HTTP çağrısı, provider key'i, yeni servis veya Redis gerekmez.

CR-009/010: Gerçek yol/hava adaptörleri, geometri bölme, sapmalar ve örnekleme.
CR-011/012/013: Kalibre tüketim, termal model, şarj integrasyonu, yol/durak araması ve optimizasyon.
CR-017/018: Seyahat olayları, kalıcı sürüm yönetimi ve kullanıcı şarj düzeltmesinden kalan rota.

Mevcut road request başlangıç/hedef arasındadır; çok duraklı gerçek yol sorguları ve istasyon erişimi CR-009 ile genişletilecek. Bu teslim coğrafi adaylığın yol erişilebilirliği kanıtı olduğunu iddia etmez.
