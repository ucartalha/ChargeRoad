# CR-011 — Enerji tüketimi motoru

Tarih: 2026-11-11. Teknik çekirdek ve DB bağlantısı uygulandı; görev bütünü **IN_PROGRESS**. İki pilotta yayımlanmış enerji profili/kalibrasyon ve tekrar yürütülebilir bağımsız saha kaydı bulunmadığından gerçek araç hata kabulü açık. Matematiksel doğruluk testi, saha doğruluğu olarak sunulmuyor.

Bağımsız XLSX güncellemesi: `chargeroad-energy/1.1.0` kaynak/test serilerini ayrı indeksler; hız izi varsa referansı alt adım hızında seçer ve ivme düzeltmesi için fizik kalibrasyonu ister. Opsiyonel kaynaklı `automaticBatteryThermal`, soğuk/sıcak başlangıçta sınırlı ısıtma/soğutma ve RC sıcaklık evrimi sağlar. [Dosya değerlendirmesi, öğrenme ve sınırlamalar](INDEPENDENT_DATASET_VALIDATION.md). Hiçbir gerçek araç katsayısı bu dosyalara göre fit edilmedi.

Task 13 güncellemesi: `chargeroad-energy/1.2.0`, sabit kapasite snapshot'ı ve açık modellenmiş continuation girdisiyle şarj sonrası leg hesabını destekler; kapasite yeni sıcaklığa göre tekrar ölçeklenmez. Asıl kullanıcı SOC'si ile arama önizlemesi ayrıdır. [Solver ve doğrulama](STOP_OPTIMIZER.md).

## Teslim edilen bileşenler

- `EnergyConsumptionEngine.evaluate`: normalize araç, yol, hava ve sürüş isteğinden kesim enerji/SOC profili. Ağ, DB veya LLM çağırmaz.
- `EnergyAssessmentService.assess`: kanonik araç ID'sini çözer, DB profilini okur, yeterliyse hava örneklerini alır ve motoru çalıştırır. Model yokken hava isteği başlatmaz. Caller iptali ve bütün değerlendirme için deadline uygulanır.
- `EnergyModule`: servisleri Nest üzerinden dışa açar. Şarj durağı çözen sahte `PlanningEngine` veya yeni genel plan endpoint'i eklenmedi; CR-012/013 bunların devamıdır.
- Shared `EnergyModel`, `EnergyEvaluationRequest/Result`, audit ve opsiyonel hız profili sözleşmeleri. CJS/ESM ve mobil tip kontrolleriyle uyumlu.
- `energy:validate`, `energy:benchmark`, `energy:evaluate`: analitik doğrulama, gerçek DB veri kapısı, saha raporu ve sabit snapshot replay araçları.

## Kalibrasyon ve DB

`VehicleEnergyProfile.energyModel` isteğe bağlıdır; mevcut katalog kaydı veya tüketim gözlemi otomatik kalibrasyon değildir. Model; varyant kimliği, id/sürüm, kalite, kaynak/lisans, doğrulama notu, varsayımlar ve açık katsayıları içerir. Farklı aracın modeli profile bağlanamaz. Ortalama hız yaklaşımı, yardımcı güçler, rejenerasyon sınırları, sıcaklık aralığı, kapasite-sıcaklık eğrisi ve bilinmeyen alan fallback'leri kaynaklı modelin parçasıdır; evrensel gizli sabitler değildir.

Yeni model, mevcut `vehicles:publish` / `VehicleKnowledgeRepository` ile atomik ve immutable profil snapshot'ında saklanır. Yeni tablo/migration gerekmedi. Eski profiller model olmadan okunabilir; motor `ENERGY_CALIBRATION_MISSING` verir. Kaynaklı kapasite ve fizik parametreleri bulunan fizik profili tüketim eğrisi olmadan da yayımlanabilir. Mühendislik modeli verified-only olarak yayımlanamaz/okunamaz. Profil checksum'u ve eski snapshot replay'i korunur; hesaplama transaction dışında yapılır.

Kişisel sürüş katsayıları global araç profiline yazılmamalı. Auth/sahiplik tamamlanınca kullanıcıya özel snapshot/overlay ayrı oluşturulabilir; bu görev kişisel telemetri yazımı veya otomatik öğrenme açmaz. `calibrationRecordIds` yalnız açık doğrulama kayıtlarının eğitim/holdout ayrımını izlemeye yarar.

## İki hesap yolu

**Fizik:** yuvarlanma, yol doğrultusundaki bağıl hava direnci, potansiyel enerji ve mevcutsa hız profilindeki kinetik enerji hesaplanır. Pozitif mekanik iş batarya–teker verimiyle batarya enerjisine çevrilir; negatif iş rejenerasyon sınırlarından geçer. Genel yardımcı, kabin ve batarya termal güçleri süreye göre ayrı eklenir.

**Referans fark düzeltmesi:** varyant/koşul/hız/effect bağlamı eşleşen referans seçilir. Aynı koşul grubunda yalnız hız bandı içinde doğrusal interpolasyon vardır; dışarı extrapolation ve WLTP'nin sabit hız yerine kullanılması yok. Çelişen aynı hız kayıtları upstream uzlaştırılmadan ortalanmaz. AC-grid değeri ancak kaynaklı verim dönüşümüyle batarya-DC'ye çevrilir.

Referans toplamından düz yol fizik yükü ve belgelenmiş dahil HVAC/termal yük çıkarılır. Kalan açıklanmamış tüketim residual olarak korunur; gerçek yol yükü ve gerçek yardımcı yükler bir kez eklenir. Referans ile fizik tahmininin iki tam toplamı toplanmaz. Negatif residual, modeli sessizce yeniden uydurmak yerine yetersiz kalibrasyon sonucudur. Toplamın bileşenlere gerçek ayrımı bilinmediğinde `EnergySegment.breakdown=null`; audit bunun nasıl hesaplandığını ayrı gösterir. Fizik eksikse yalnız tamamen eşleşen düz/rüzgârsız referans kullanılabilir, rüzgâr/eğim/yük farkı uydurulmaz.

## Fizik ve veri sınırları

Temel kaynaklar: [NASA sürükleme denklemi](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/), [bağıl hız](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/factors-that-affect-drag/), [ideal gaz bağıntısı](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/equation-of-state-ideal-gas-2/), [FASTSim modelleme bağlamı](https://natlabrockies.github.io/fastsim/). Bunlar Hyundai katsayılarının kaynağı veya doğrulaması değildir; üçüncü taraf solver alınmadı.

- Eğim işi `m·g·Δh`; iç tepe/inişler korunur. Kaynak harita mesafesi boyunca yuvarlanma/yol işi ve yükseklik değişimi ayrı kullanılır.
- Rüzgârın geldiği yön yol yönüne projekte edilir. Yan rüzgâr için bağıl vektör büyüklüğü kullanılır; CdA'nın yaw bağımlılığı ayrı kalibre edilmiş aerodinamik model sayılmaz. Araçtan hızlı arka rüzgâr bataryaya ücretsiz enerji kaynağı yapılmaz.
- Yüzey basıncı ve sıcaklıktan yoğunluk; deniz seviyesi basıncı için kot varsa açık isothermal yaklaşım uygulanır. Bu, ölçülmüş yüzey basıncı değildir. Aksi halde yalnız açık/izinli kalibrasyon fallback'i kullanılabilir.
- Gerçek hız izi varsa zaman/distance bütünlüğü doğrulanır; ivmelenme/fren kinetiği hesaplanır. Kaynak yuvarlaması en fazla 0,1 m uyum toleransıyla yol uzunluğuna uzlaştırılır. Kesimler arası iz uçları çelişirse reddedilir.
- Ortalama hızdan dur-kalk veya yapay ivmelenme üretilmez. Model izin veriyorsa sabit hız proxy'si ve eksik hız dağılımı uyarısı kullanılır. Bilinen hız sınırını aşan süre/hız verisi sessizce kırpılmaz; zaman yeniden üretilmelidir.
- Islak/kar kaplı yol için katsayı yoksa pozitif yağış/kar koşulunda yetersiz veri dönülür. Bilinmeyen opsiyonel yağış/kar etkisi kayıtta uyarı olarak kalır; gözlem sıfırmış gibi işaretlenmez.
- Feribotta otomobil yol yükü uygulanmaz; özel standby model gereksinimi açık yetersiz veri sonucudur.

## Batarya ve rejenerasyon

Kapasite, referans kullanılabilir kapasite × güncel SOH / referansın ölçüldüğü SOH oranıyla hesaplanır. Etiket/brüt kWh kullanılmaz. Sıcaklık derating eğrisi varsa başlangıç durumunda uygulanır; sürüş boyunca kapasite paydası sabit kalır, ısınmayla bedava enerji üretilmez. Kalibrasyon aralığı dışında extrapolation yoktur.

Rejenerasyon; mevcut negatif mekanik iş, dönüşüm verimi, araç geri kazanım gücü, kaynaklı SOC taper'ı, sıcaklık zarfı ve batarya boşluğuyla sınırlanır. Soğuk/bilinmeyen termal durum veya bilinmeyen regen gücü, geri kazanım varsayımıyla iyimser SOC üretmez. %100 aşılmaz. Fren enerjisi = sürtünme + geri kazanılan batarya enerjisi + dönüşüm kaybı olarak audit'te korunur; `discardedRecoveryKwh` ek toplanacak tüketim değil, kullanılmayan potansiyel geri kazanım tanısıdır.

Batarya sıcaklığı ortam sıcaklığına kopyalanmaz. Kaynaklı opsiyonel pasif termal model çevreye üstel ısı alışverişi sağlar; ohmik/aktif ısı yönetimi simülasyonu değildir. Sabit aktif termal yük tek başına sıcaklık evrimi kanıtı değildir. Ayrı `automaticBatteryThermal` ve termal kütle/iletim kalibrasyonu varsa kontrollü ısıtma/soğutmayla kaynaklı koşullu sıcaklık tahmini yapılır; sabit yükle birlikte kullanılamaz. Ohmik ısı veya istenen ön koşullandırmanın tamamlandığı varsayılmaz. Bilinmeyen başlangıç veya geçersiz/zamanı eski sıcaklık gözlemi bilinmeyen kalır; başlangıç gözlemi 15 dakikadan eskiyse kullanılmaz. 400/800 V etiketi doğrudan tüketim veya termal katsayı seçmez.

Ara rezerv dipleri her entegrasyon adımında izlenir; iniş sonunda toparlanan SOC önceki ihlali gizlemez. Batarya bir sonraki adımı karşılayamıyorsa negatif enerjiye devam edilmez; açık partial segment ve `charge_required` sonucu döner. Bu, tüm alternatif yollarda çözüm yok anlamına gelmez. Şarj durakları/şarj enerjisi bu sürüş motoruna eklenmez; solver her sürüş bacağını kendi başlangıç durumuyla değerlendirecek.

## Çıktı ve çalışma bütçesi

`estimated`: verilen rota için tam tüketim tahmini; kesin saha doğruluğu iddiası değildir. `charge_required`: mevcut SOC/rezerv/hedefle ek şarj gerekir. `insufficient_data`: kaynak/koşul/model yetersiz. `computation_limit`: açık bütçe/deadline sonu. Eksik/veri sınırlı sonuç başarılı plan diye sunulmaz.

Her çıktıda algoritma/model/profil sürümü, tüm normalize girdinin SHA-256 checksum'u, kullanılan referans/hava kimlikleri, kesim SOC/enerji/minimumları, audit ve varsayımlar vardır. Sabit `evaluatedAt` ve snapshot ile replay aynı sonucu verir; duvar saati yalnız CPU bütçesi içindir. Kaynak hava, gerçek kesim konumu/zamanı ve metadata kapsamıyla uyuşmalıdır. 72 saat hareket penceresi ve temel hava yeterlilik kapısı korunur.

Sınırlar: 10.000 kesim; geometri, benzersiz yükseklik düğümleri ve hız izinde birbirinden bağımsız 20.000 nokta; 512 referans, 200.000 entegrasyon adımı. `chargeroad-energy/1.3.2` aynı mesafe ve kotta birleşen komşu kesim uçlarını yükseklik bütçesinde bir kez sayar. Ham yükseklik noktaları ayrıca `20.000 + kesim sayısı - 1` ile sınırlıdır; çelişkili yükseklikler birleştirilmez. Hesap profili ve tüm ara düğümler korunur. Adım en fazla 5 sn / 100 m; her 64 adımda event loop'a bırakılır. Çekirdek en fazla 1.500 ms veya caller'ın daha kısa hesap bütçesiyle çalışır. Değerlendirme servisi DB/hava dahil bütün isteği de request deadline'ıyla sınırlar. Redis, yeni HTTP/LLM bağımlılığı ve hesap sırasında DB yazımı yoktur.

## Doğrulama ve pilot kaydı

[Analitik/DB/saha durumu](validation/task11-energy-validation.json), [p95/p99](validation/task11-energy-benchmark.json). Elle çözülen yuvarlanma/sürükleme, iç tepe/rejenerasyon, referans tabanı ve yardımcı enerji vakaları geçer. Küçük sayısal farklar kayan nokta toleransıdır, gerçek araç hata oranı değildir. Benchmark 1 ve 1.000 kesimde ayrı ayrı 1.000 değerlendirme; tüm örnekler ve tam tahminler ayrı raporlanır. Tam EV rota/şarj çözme veya dış servis gecikmesi ölçülmez.

Teslim kontrolü: 273 API/DB testi, 35 shared sözleşme testi, mobil/API/shared tip kontrolleri ve API derlemesi geçti. Yerel sentetik 1.000 kesim ölçümünde p95 yaklaşık 49 ms, p99 73 ms; makine/yük bağımlıdır, üretim SLA değildir.

Kullanıcının İstanbul–Ankara gözlemi [v4 paketinde](../data/vehicle-knowledge/pilots-v4-istanbul-ankara-observation.json) ve DB'de source-reported olarak saklandı. Eski üç Ioniq 6 gözlemi korunur; Ioniq 5'e uygulanmaz. 410 km, 16,5 kWh/100 km, yaklaşık 15 °C, %8 şehir içi, 23 °C klima yaklaşık yarım yol, %95 çıkış, Bolu Highway %14→%90, Ankara %19 varış. 130 ile 110–120 km/sa seyir bağlamı gerçek ortalama hız sayılmaz. Tarih, süre/bacak mesafeleri, şarj kWh'si ve enerji sınırı bilinmiyor.

Gösterge ortalaması × mesafe = 67,65 kWh; SOC muhasebesi = 152 yüzde puanı. Bunların aynı enerji sınırı/sabit kapasite altında oranı koşullu 44,51 kWh eder; kullanılabilir kapasite/SOH kanıtı veya kalibrasyon hedefi değildir. Bu değer araç kapasite fact'ine, fizik katsayısına veya doğrulanmış tüketim eğrisine dönüştürülmedi.

İki pilotta DB provider'ı halen `VEHICLE_ENERGY_PROFILE_MISSING` veriyor. Bu, çekirdeğin matematiksel testlerde çalışmasından ayrı bir ürün veri kapısıdır. `fieldAccuracy=awaiting_field_data`, uygun bağımsız holdout sayısı 0. Eksik snapshot'lı kullanıcı yolculuğu veya eğitildiği kayıt aynı modelin bağımsız doğrulaması olarak sayılmaz. Saha CLI'si kanonik pilot kimliği, açık doğrulama izni, sürüş bacağı snapshot'ı ve ölçüm kanıtı ister; modelin `calibrationRecordIds` listesinde bulunan kayıt holdout olamaz. Yol sürati metadata'sı `modelled_trip_average` olarak ayrılır.

```powershell
pnpm --filter @chargeroad/api energy:validate
pnpm --filter @chargeroad/api energy:evaluate ../../artifacts/task11-energy/replay-input.json
pnpm --filter @chargeroad/api energy:benchmark
pnpm --filter @chargeroad/api energy:validate PATH_TO_REPLAYABLE_FIELD_RECORDS.json
pnpm --filter @chargeroad/api test:db
```

`artifacts/` git dışıdır. Sentetik doğrulama profilleri gerçek Hyundai kalibrasyonu olarak yayımlanmadı. Kapanış: CR-006'daki kaynaklı pilot profil/kalibrasyon açıkları ve CR-001 bağımsız saha hata kabulü tamamlanınca CR-011 bütünü kapatılabilir; kullanıcı kararı olmadan bu maddeler DONE veya ertelenmiş sayılmaz.
