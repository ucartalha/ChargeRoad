# CR-005 — Bağımsız referans doğrulama düzeneği

Durum: Teknik doğrulama zemini tamamlandı. Gerçek Ioniq tüketim doğruluğu ve üretim yük kapasitesi henüz ölçülmedi.

Doğrulama kanıtı (2026-11-10): Bu teslimin 52 testi geçti; tüm API testlerinde 85 başarılı, DB URL'si verilmediği için 13 entegrasyon testi atlandı. Ortak sözleşmelerin 31 testi, üç paketin typecheck'i ve API production build'i başarılı. Rapor 15 golden vakayı ve 10.000 mikrobenchmark örneğini içerir.

## Çalıştırma

Depo kökünden:

```sh
pnpm --filter @chargeroad/api test -- reference-validation.spec.ts
pnpm --filter @chargeroad/api validate:planning
```

PowerShell execution policy `pnpm.ps1` dosyasını engelliyorsa aynı komutlarda `pnpm.cmd` kullanılır. Yeni servis, ağ erişimi, API anahtarı, Redis veya DB gerekmez.

İkinci komut elle hesaplanmış sonuçları doğrular, 200 ısınma çağrısından sonra 10.000 örnek ölçer ve `artifacts/planning-validation/latest.json` üretir. İsteğe bağlı son argüman rapor dosyasıdır. Golden uyuşmazlığı, checksum hatası, çalışma hatası veya arama sınırına ulaşma başarısız exit code üretir. Yerel artifacts Git'e alınmaz; paylaşılabilir örnek çalıştırma [referans raporunda](validation/reference-run-2026-11-10.json) saklanır.

## Referans yöntemi ve sınırları

`apps/api/src/planning/validation/` üretim Nest modülüne bağlı değildir ve production build kapsamından çıkarılmıştır. `PlanningEngine` yerine geçmez. Üretim solver'ının kodunu veya hesapladığı beklenen çıktıları kullanmaz.

Referans; en fazla 8 düğümlü, 24 kenarlı yönlü döngüsüz ağdaki tüm yol ve şarj seçeneklerini tarar. Yolun enerji ihtiyacı önceden verilidir; burada fiziksel tüketim tahmini yapılmaz. Şarj hedefleri açık Wh grid'ine bağlıdır (en fazla 40 adım). Mevcut snapshot 50 kWh kullanılabilir enerji ve 5 kWh grid kullanır; başlangıç enerjisi grid dışında olabilir. Bu değerler sentetik araç içindir, Ioniq kullanılabilir kapasitesi değildir.

Minimum toplam süre; sürüş, şarj, bağlantı ve bilinen bekleme sürelerini içerir. Eşit maliyetli planlarda veri sırasındaki ilk sonuç seçilir. Sonuç yalnızca verilen ağ, enerji bütçesi ve grid üzerinde optimumdur. Sürekli SOC uzayında veya gerçek yol ağında küresel optimum iddiası yoktur. 100.000 keşif bütçesi aşılırsa bulunan aday dahi optimum diye sunulmaz; `search_limit` döner. Eksik katalog kapsamı `insufficient_data` olur, kesin ulaşılmazlık veya optimum sayılmaz.

`compareCandidate` gelecekteki hızlı solver'ın aynı senaryoya ait normalize çıktısını karşılaştırır. Önce kenar sırasını, şarj duraklarını, kesim içi rezervi, kapasiteyi, enerji/süre defterini ve risk açıklamasını yeniden denetler; sonra referans optimumuyla süre farkını verir. Aynı maliyetli farklı yol kabul edilir. Farklı grid veya kapsamla karşılaştırma yapılmamalıdır; gerçek üretim planından bu küçük formata adapter CR-013'te bağlanacak.

## Enerji ve şarj referansları

- Her yol, sıralı tüketim/rejenerasyon Wh adımları içerir. Rezerv her adımda kontrol edilir. Sonradan rejenerasyon, önceden ihlal edilen rezervi düzeltmez.
- Kapasite üzerindeki rejenerasyon kırpılır ve ayrı kaydedilir: `başlangıç + şarj - net tüketim - kırpılan rejenerasyon = varış`.
- Sentetik şarj eğrileri her aralıkta sabit kabul gücü/voltaj içerir. Süre analitik olarak `Wh × 3,6 / net kW` üzerinden aralık aralık toplanır. Bu, ortak domain'deki lineer eğri interpolasyonunun veya CR-012 üretim integratörünün uygulanmış olduğu anlamına gelmez.
- Giriş gücü; kabul gücü, araç şarj yolu, EVSE, paylaşılan saha ve `giriş voltajı × akım` sınırlarının minimumudur. Depolanan net güç, dönüşüm verimi ve yardımcı tüketimden sonra hesaplanır. Sıfır/negatif net güçte veya voltaj uyumsuzluğunda şarj kullanılamaz.
- 400/800 V etiketiyle güç atanmaz veya boost converter uydurulmaz. Aralıklardaki gerçek giriş voltajı kullanılır.
- Soğuk/sıcak batarya ve olumsuz hava senaryolarında girdiler açıkça farklıdır. Ampirik termal katsayı, evrensel tüketim çarpanı veya Ioniq eğrisi türetilmez.

## Tekrarlanabilir senaryolar

`fixtures/reference-v1.json` 15 tam tanımlı vaka ve her vakanın elle hesaplama gerekçesini içerir. `manifest.json` dosya byte'larının SHA-256 özetini sabitler. Değişiklikte sonuçlar bağımsız incelenip manifest/sürüm bilinçli güncellenmelidir; test veya CLI checksum'u kendiliğinden değiştirmez.

Vakalar: şarjsız, tek duraklı, çok duraklı, düşük başlangıç şarjı, ilk durağa erişememe, rezervden farklı hedef varış, kesim içi rezerv ihlali, rejenerasyon kırpılması, yol yok, eksik/boş kapsam, açık olumsuz koşul enerji bütçesi ve şarjdan %60/%75/%90 ile ayrılma.

Ek testler; elektriksel sınırlar, soğuk eğri, erişimsiz/uyumsuz/dolu istasyon, bilinmeyen müsaitlik politikası ve risk kaydı, kuyruk/sapma nedeniyle rota değişimi, bozuk snapshot, arama sınırı, aday plan denetimi ve istatistik doğruluğunu kapsar. `unknown` durumu girdi olarak verilir; gerçek kaynağın zaman damgasını eskilik politikasına göre dönüştürmek CR-008 işidir. PostGIS koridor sorgusu veya sağlayıcı yenileme/tekilleştirme bu testlerle uygulanmış sayılmaz.

## Ölçüm raporu

p50/p95/p99, sıralı örneklerde nearest-rank yöntemiyle hesaplanır. Bütün çağrılar ve yalnızca `planned` çağrılar ayrı özetlenir; durum sayaçları saklanır. Böylece hızlı reddedilen örnekler başarılı planların gecikmesini gizlemez.

Raporda checksum, her vakanın sonucu/enerji/süre defteri, örnek sayısı, ısınma, eşzamanlılık, toplam süre, CPU zamanı, RSS, event-loop örnek sayısı/gecikmesi ve makine/Node bilgisi bulunur. Kısa mikrobenchmark'ta event-loop örnekleri az olabilir; bu kuyruk gecikmesinin p99 kapasite kanıtı değildir.

Bu, tek süreçte küçük sentetik ağ ölçümüdür. HTTP, DB pool/kilit, PostGIS, canlı kaynak, telemetri yazımı ve yatay ölçek yük testi değildir. CR-001'de üretim kabul eşikleri seçilmediğinden keyfi gecikme eşiğiyle başarı iddiası yapılmaz. Bu bileşenler bağlandığında CR-021/022 aynı ayrımla normal/yoğun trafik, soğuk/sıcak cache, timeout ve hata oranlarını ayrıca ölçmelidir. CPU işi üretimde sınırlı worker'a taşınmalıdır; bu senkron oracle API event loop'una bağlanmaz.

## Pilot kayıtları ve gizlilik

Pilot araç konfigürasyonları ve kaynak açıkları [pilot belgesinde](PILOT_VALIDATION.md) korunur. `pilot-observations-v1.json` bilinçli olarak boş listedir. `pilot-observation-template.json` doldurulacak şablondur; null alanlar yüzünden ölçüm olarak kabul edilmez. Sahte gerçek seyahat eklenmedi.

Gerçek kayıt; anonim seyahat ID'si, varyant, hızın anlamı, mesafe, koşullar, batarya-DC ölçüm sınırı, kanıt yöntemi/referansı, model sürümü ve ölçülen/tahmin edilen değerleri içerir. Sayaçtaki kWh/100 km değeri, prizden alınan kWh veya batarya enerjisiyle kaynağı belirsiz şekilde birleştirilmez. Hassas koordinat/kullanıcı kimliği şemada yoktur; bilinmeyen alan reddedilir. Serbest metinlere kimlik veya özel konum yazılmamalıdır. Git'e gerçek kayıt konulması otomatik değildir; açık izin ve veri incelemesi gerekir. Şemadaki izin beyanı auth/consent altyapısının yerine geçmez.

Kalibrasyon ve holdout ayrıdır; aynı seyahat ID'si iki gruba konamaz. Yalnızca holdout kayıtlarından doğrulama hatası çıkarılır. Metrikler: işaretli varış SOC yüzde puanı (pozitif = iyimser), tüketim kWh, kWh/100 km ve şarj süresi hatası. Özetler araç/model sürümüne göre ayrılır; farklı varyantlar karıştırılmaz. Az sayıdaki gözlemin p99'u saha doğruluğu kanıtı değildir. Boş kayıt listesi sıfır hata yerine `awaiting_field_data` verir. Rapor ölçüm dosyasının checksum'unu da içerir.

CR-005'in tamamlanması doğrulama aracının hazır olmasıdır. Eksik Ioniq 5 kataloğu/tüketim/şarj kaynakları CR-006, koridor ve sayısal eşikler CR-001, gerçek sürüş ve cihaz doğrulaması CR-022 kapsamında açık kalır.
