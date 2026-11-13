# Task 12 — DC şarj eğrisi ve süre hesabı

2026-11-11. CR-012'nin DC hesap bileşeni uygulandı. Motor deterministiktir; LLM, dış HTTP veya anlık DB okuması kullanmaz. Mobil ekran ve durak optimizasyonu henüz bu bileşene bağlı değildir.

Bağımsız XLSX güncellemesi: `dc-curve-integration/1.0.1`, SOC/voltaj noktalarında binary search kullanır; aynı güç/enerji/süre sözleşmesini korur. [23 tüketim, 7 şarj oturumu ve 9 kısmi noktanın değerlendirmesi](INDEPENDENT_DATASET_VALIDATION.md) ayrı regresyon raporudur; tam kabul eğrisi veya bağımsız süre hata metriği değildir.

Task 13 güncellemesi: `dc-curve-integration/1.1.0`, kaynaklı opsiyonel `isothermal_conditioned` koşullu sıcaklık modelini destekler; eksikse ayrılış sıcaklığı unknown kalır. Connection modeli ve stop charge-start SOC'si ayrı kaydedilir. [Süreklilik ve veri kapıları](STOP_OPTIMIZER.md).

## Kullanım ve veri sınırı

`ChargingCurveEngine.evaluate` doğrulanmış araç/istasyon snapshot'ını alır. `ChargingAssessmentService` kanonik araç ID'sini çözüp mevcut `VehicleEnergyProvider` üzerinden PostgreSQL'deki yayımlanmış immutable profili okur. Sağlayıcı değişikliği hesap çekirdeğini değiştirmez. `ChargingModule` uygulamada kayıtlıdır; bu görev genel HTTP planlama endpoint'i açmaz.

Profilin isteğe bağlı `chargingModel` alanı kaynak, izin, varyant, kalite ve sürümüyle paket tarafı yardımcı güç ve terminal→depolama verimini taşır. Mevcut JSONB profil revizyonu/yayın transaction'ı kullanılır; yeni tablo, migration veya Redis gerekmedi. Yayın sırasında modelin araç ID'si kanonikleştirilir; mühendislik tahmini verified olarak yayımlanamaz. Sürüş kalibrasyonu olmayan, kendi kapasite/şarj kanıtı yeterli bir şarj profili de yayımlanabilir.

Enerji motoru `UsableCapacitySnapshot` üretir: profil kimliği/sürümü, kullanılabilir referans kapasite, referans ve kullanılan SOH, sıcaklık modeli/faktörü, değerlendirme sıcaklığı ve etkin kapasite. Şarj motoru kimlik ve faktörleri doğrular, etkin kapasiteyi sabit tutar. SOH/sıcaklık ikinci kez uygulanmaz; ısınmayla ücretsiz enerji üretilmez. Profil değişirse eski snapshot yeni profile uygulanamaz; eski profil korunarak replay yapılır.

## Güç ve enerji hesabı

Her SOC aralığında araç kabul eğrisi, seçilen **tek fiziksel connector** ve araç şarj yolunun güç/akım sınırı, gerçek giriş voltajı, varsa voltaja bağlı güç zarfı ve üniteye ayrılan ortak güç birlikte değerlendirilir. Başka soketlerin güçleri toplanmaz. Ortak havuzun tüm gücü araca verilmez: en fazla 300 saniyelik, kaynaklı ve havuz sınırlarını aşmayan allocation snapshot'ı gerekir. Gelecekte aynı payın süreceği garanti değildir.

`Pin` araç giriş gücü, `ηpath` girişten paket tarafına dönüşüm verimi, `A` paket tarafındaki yardımcı tüketim, `ηstorage` terminalden net depolamaya verim:

```text
Pterminal = Pin × ηpath − A
Pstored = Pterminal × ηstorage
Ploss = Pin × (1 − ηpath) + Pterminal × (1 − ηstorage)
Pin = Pstored + A + Ploss
ΔEstored = effectiveCapacityKwh × ΔSOC / 100
dt(hours) = dEstored / Pstored(SOC)
```

Bu modelde `pack_terminal` sınırı, yardımcı tüketim ayrıldıktan sonraki hücreye giden elektriksel gücü ifade eder. Şarj kaynağı başka ölçüm sınırı kullanıyorsa yayın öncesinde açıkça normalize edilmelidir.

Araç eğrisinin giriş gücü sınırına dönüşümü:

| Kaynak eğrinin sınırı | Girişte eşdeğer kabul sınırı |
| --- | --- |
| `vehicle_inlet` | `Pcurve` |
| `pack_terminal` | `(Pcurve + A) / ηpath` |
| `battery_stored` | `(Pcurve / ηstorage + A) / ηpath` |

Ardından istasyon/yol sınırlarının minimumu alınır. Net depolama eğrisindeki kayıplar ikinci kez düşülmez; istasyon daha düşük güce zorlarsa aynı kalibrasyonla yeni net güç bulunur. Sınırın giriş tarafında termal yardımcı ve dönüşüm etkileri henüz ayrılmadığından `excluded/excluded`, terminal/net depolama tarafında upstream etkiler temsil edildiğinden `included/included` beklenir. `unknown` veya farklı anlam taşıyan veri sessizce yorumlanmaz; `CHARGING_ENERGY_BOUNDARY_AMBIGUOUS` döner. Ek kayıp bileşenleri varsa bu basit model yerine açık sürümlü kalibrasyon gerekir.

SOC/akım eğrisinde **aynı ölçüm sınırındaki** akım ve voltaj ayrı ayrı lineer enterpole edilip çarpılır. Terminal veya açık-devre voltajı giriş voltajı sayılmaz. 400/800 V etiketi, nominal voltaj veya motor gücünden converter limiti/verimi türetilmez. Boost ve native yollar kendilerine bağlı eğri, voltaj ve sınırlarla ayrı değerlendirilir. Giriş voltajı ya giriş eğrisindeki kaynaklı voltajlardan ya da `charging_inlet` voltaj profilinden gelir. Sıfır kayıp veya sıfır yardımcı tüketim de açık kalibrasyon olmalıdır; eksik değer için otomatik %100 verim kullanılmaz.

## İntegrasyon ve çalışma sınırları

Kaynak SOC/voltaj düğümleri, istasyon voltaj zarfı geçişleri ve bütün güç sınırı kesişimleri aralıkları böler. Her kaynak aralığındaki en fazla ikinci dereceden güç fonksiyonlarının kesişimleri analitik çözülür; dar bir istasyon darboğazı sabit SOC adımlarında kaybolmaz. Ekstremumlarda da bölünür. Vektör adaptive Simpson integrasyonu süre, giriş enerjisi, yardımcı enerji ve kaybı birlikte toplar. Sonuç ve aralıkların SOC/enerji/süre dengesi runtime sözleşmeyle doğrulanır. Sonlu sayısal tolerans gerçek araç ölçüm doğruluğu iddiası değildir.

Seçili kaynak başına en fazla 2.048 nokta; en fazla 10.000 aralık, 100.000 değerlendirme, 18 quadrature derinliği, 24 saatlik şarj ve 1.500 ms hesap bütçesi vardır. Hesap düzenli event-loop yield ve iptal kontrolü yapar; assessment toplam 2 saniyeyle sınırlıdır. Sınır aşılırsa tamamlanmış süre verilmez. CLI snapshot'ı en fazla 8 MiB kabul eder. Bu bütçeler üretim SLA'sı değildir.

## Eksik veri ve koşullar

- Eğri yoksa, SOC kapsamı dışındaysa veya başka şarj yoluna aitse tahmin uydurulmaz; ekstrapolasyon yoktur.
- Tek istasyon oturumu `observed_station_session`, genel araç kabul eğrisi sayılmaz. Kaynak incelemesi/yayın kalibrasyonu gerekir.
- Gerçek DC güç, akım, voltaj aralığı veya verim eksikse güvenilir süre verilmez. Voltaj zarfı varsa en az iki sıralı nokta, açık lineer interpolasyon ve gereken voltaj kapsamı gerekir.
- Bataryanın **şarj başlangıcındaki** sıcaklığı ve kaynak sıcaklık bandı gerekir. Güncel ölçüm gelecek varışın sıcaklık tahmini değildir. Ölçüm/user input gelecekte olamaz; şarj başlangıcına en fazla 15 dakika uzak olabilir. Estimated sinyalin üretim zamanı gelecekte olamaz ve validAt senaryodaki başlangıca uymalıdır. Ortam sıcaklığı, SOH ve ön koşullandırma kısıtları varsa ayrıca doğrulanır.
- Ön koşullandırma talebi tamamlanmış sayılmaz. Soğuk/koşulu bilinmeyen bataryaya sıcak eğri uygulanmaz. Bu bileşen dinamik termal simülatör değildir: eğri koşullarının sürdüğü varsayımı açıkça yazılır, ayrılış batarya sıcaklığı `unknown` kalır. Yol/termal motoru sonraki hesapta bu belirsizliği ele almalıdır.
- Yardımcı termal tüketim enerji hesabındadır; ayrıca örtük ısınma süresi eklenmez. `blockingPreconditioningSeconds` bu sürümde yalnız 0 olabilir; gerçek beklemeli ısıtma için ayrı kaynaklı model gerekir.
- AC için DC eğrisi kullanılmaz; ayrı AC modeli gereklidir.
- Sıfır/negatif net güçte hedef bu koşullarda `unreachable` olur. %100'e giderken güç sıfıra iniyorsa sonlu süre uydurulmaz. Eşit başlangıç/hedefte durak süresi ve enerji sıfırdır.
- Kuyruk bilinmiyorsa `waitingSeconds`, toplam durak ve ayrılış zamanı belirsizdir. Şarj süresi, verilen başlangıç sıcaklığı senaryosuna koşulludur. Açılış saatleri, güncel arıza/erişilebilirlik ve müsaitlik, kuyruk tahmini ve alternatif durak seçimi planlayıcının sorumluluğudur; bu çıktı durak rezervasyonu değildir.

Başarılı hesap `estimated`, gerek yoksa `no_charge_required`; diğer sonuçlar `insufficient_data`, `incompatible`, `unreachable`, `computation_limit`. `dataQuality` ayrıca verified / engineering_estimate / unknown olarak taşınır; yalnız doğrulanmış veri politikası, doğrulama etiketi olmayan profili kabul etmez. Başarısız sonuçta tamamlanmış enerji/süre alanları null; varsa önceki aralıklar yalnız tanı amaçlıdır. Giriş checksum'u, algoritma/model/eğri/profil sürümleri replay içindir.

## Doğrulama ve veri açıkları

Elle kontrol edilen örnekler: 80 kWh bataryada %20→80, 100 kW sabitte **1.728 s**; aynı aralıkta 100→50 kW lineer taper **2.395,516656 s**; %90 yol / %95 depolama verimi ve 2 kW yardımcı tüketimde **2.066,985646 s**; 400 V / 100 A istasyon sınırında **4.320 s**. Bunlar sentetik test araçlarıdır, Hyundai değerleri değildir.

Testler ayrıca akım×voltaj, boost/native sınırları, net eğride çift kayıp düşmeme, SOC/SOH/kapasite snapshot'ı, ortak güç, bilinmeyen bekleme, kaynak/koşul uyumsuzluğu, AC reddi, iptal, hesap sınırı ve immutable DB yayını/replay'i kapsar.

Son tam doğrulama: 319 API/DB testi ve 37 ortak sözleşme testi geçti; atlanan yok. API/mobil/shared TypeScript kontrolleri, API production derlemesi ve snapshot CLI replay'i başarılı.

- [Hesap ve gerçek DB pilot kapıları](validation/task12-charging-validation.json).
- [1.000'er örneklik yerel p95/p99](validation/task12-charging-benchmark.json): yalnız CPU/async hesap, ağ veya üretim yükü değil.
- İki Hyundai pilotunda yayımlanmış kullanılabilir şarj profili henüz yok; `VEHICLE_CHARGING_PROFILE_MISSING` gerçek DB'de doğrulandı. Bağımsız şarj oturumu sayısı 0, gerçek süre hata metriği null. Araç kataloğundaki maksimum kW'dan eğri üretilmedi.
- CR-011'in kalibrasyon/saha kabulü açık kalır. CR-012'nin hesap bileşeni bu açığı kapatmaz; gerçek araç planlaması yeterli profil yayımlanana kadar veri kapısında durur.

```powershell
pnpm --filter @chargeroad/api test:db --cache=false
pnpm --filter @chargeroad/api charging:validate
pnpm --filter @chargeroad/api charging:benchmark
pnpm --filter @chargeroad/api charging:evaluate ../../artifacts/task12-charging/replay-input.json
```

`charging:validate` `.env` üzerinden yerel DB'yi salt okunur denetler ve sentetik replay dosyası üretir; örnekleri gerçek katalog olarak yayımlamaz. Testler kendi rastgele şemalarını oluşturup yalnız onları temizler.
