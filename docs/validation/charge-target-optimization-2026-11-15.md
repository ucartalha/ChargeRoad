# Şarj hedefi aramasını iyileştirme — 2026-11-15

Kapsam: Kullanıcının onayladığı altı madde; enerji/eğim fiziğini koruyarak şarj hedefi ve arama sırasını iyileştirmek. CR-PERF-006 veya yeni provider/cache/worker mimarisi değildir. Önceki yerel Valhalla pacing düzeltmesi çalışma ağacında korunur.

## Sorun ve sürüm

İncelenen gerçek istek `efa6b85d-27c9-40c3-9044-62ecec1e7cdf` sunucuda 9235 ms'de tamamlanmıştı (66 ms kuyruk, 9169 ms çalışma). İlk geçerli seed %100 hedefiyle oluşturuluyor, hava değerlendirme bütçesi tükenince geniş arama bu çözümü yeterince iyileştiremeden dönüyordu. Bu yüzden en kısa süre modunda gereksiz yüksek SOC hedefleri oluşabiliyordu. Şarj motoru üst SOC güç düşüşünü zaten entegre ediyordu; bu düzeltme araç eğrilerini değiştirmez. İncelenen profil mühendislik tahminiydi; kullanıcının tüketim gözlemi tek başına saha doğruluğu kabulü değildir.

Optimizer **1.0.0 → 1.1.0**, bounded search policy **1.1.0 → 1.2.0**, catalogue scenario **1.0.0 → 1.1.0**. Yeni davranış kasıtlı olarak eski outcome/trace hash'leriyle aynı olmak zorunda değildir. EnergyConsumptionEngine ve ChargingCurveEngine kaynakları HEAD ile aynıdır; algoritma sürümleri değişmedi.

## Uygulanan sıra

1. **Başlangıç:** Feasible doğrudan varış önce değerlendirilir. Şarj gerektiğinde süre/enerji modları önce kısmi şarjı, daha az durak modu yüksek SOC'yi dener. %100 fallback korunur; %80 tavan değildir. Eğrinin kapsadığı üst sınır göz önünde tutulur. Bu seed artık yalnız catalogue opt-in durumuna bağlı değildir; gerçek EVSE planlarında da aynı doğrulama portlarını kullanır.
2. **Aynı duraklarda iyileştirme:** İlk doğrulanmış plan elde edilince, genel dallanmadan önce son duraktan başlanarak SOC adayları değerlendirilir. Önceki doğrulanmış bacağın minimum SOC ve varış SOC farkı yalnız bir aday üretir; fiziksel sonucu sertifika veya doğrusal SOC düzeltmesi olarak kullanmaz. Adaya 0,05 yüzde puanlık küçük pay eklenir, yüzdelik yuvarlama ve yakın grid/knee seçenekleri de değerlendirilir. Bu pay güvenlik garantisi değildir.
3. **Yeniden değerlendirme:** Değişmeyen prefix, mevcut doğrulanmış planın parçası olarak korunur. Değişen şarj ve sonraki suffix mevcut port üzerinden tekrar hesaplanır: gerçek şarj eğrisi/EVSE/path/termal koşullar, bağlantı süresi/enerjisi, zaman, yol, hava, tüketim, rezerv ve varış hedefi. Ham çıktının SOC alanları düzenlenmez. Her iyileştirme final planningEvaluation sözleşmesini geçmeden incumbent olamaz.
4. **Bütçe:** İyileştirme en çok 32 port işlemi, 2 geçiş turu, durak başına 5 aday turu, kalan hava/zaman bütçesinin %40'ı ve beam width 2 ile sınırlıdır. Duraklar arasında round-robin yapılır; son durağın tüm allowance'ı tüketmesi önlenir. Hava miktarı kontrolünde önceki bacak örnek sayısı tahminidir; yeni yolun boyutu değişirse hard session bütçesi yine belirleyicidir. İptal ve hard limit propagate olur; doğrulanmış incumbent korunur. Bu bir tam çözüm/optimalite garantisi değildir.
5. **Alternatifler:** Ardından mevcut genel arama durak/yol seçeneklerini değerlendirir. Yalnız SOC grid'inin sayısal sırası yerine erişim/varış adayları, eğrinin güç düşüş noktaları ve sonra grid önceliklendirilir. Grid veya >80 adaylar silinmez. Süre, durak sayısı ve net sürüş enerjisi objective comparator'ları korunur; yalnız daha iyi ve sözleşmeden geçmiş çözüm kabul edilir. İlk plan sonrası genel arama bütçesi kalır; yeni paralel solver/worker eklenmez.
6. **Ürün:** Sınırlı arama uyarısı sonuç kartında ayrıntıları açmadan görünür. Mevcut buton/testID ve backend bağları korunur. Kaynak/koşullu kuyruk, belirsiz ETA ve mühendislik tahmini açıklamaları devam eder.

Hava tekrarlarını azaltma yaklaşımı, değişmeyen itinerary prefix'ini tekrar hesaplamamak ve mevcut Session/PG series cache'lerini kullanmaktır. Yeni hava/engine sonucu cache'i veya SOC/zaman bucket'ı eklenmedi. İyileştirme ilave değerlendirme gerektirdiği için toplam query sayısının her vakada azalacağı iddia edilmez; mevcut hard sınırlar değiştirilmedi.

## Replay ve tarihsel kanıtlar

Ana rotalar replay bağlamında zaten kayıtlıydı, ancak replay parser bunları düşürüyordu. Yeni seed aşaması için optional baseRoutes doğrulaması eklendi; eksikse kayıtlı road snapshot'larından geri kurulur. Kaynaklar dışında ağ erişimi olmadan replay regression PASS.

Eski frontier golden JSON veya 001–005 JSON/Markdown ölçümleri yeniden yazılmadı. Eski optimizer'ın frontier sonuçlarını yeni ürün sürümüne eşitlemek yanlış olacağından, `legacy-frontier-v1-sources.json` içinde `f5d16c8` kaynakları/hash'leri validation-only olarak donduruldu. Bu kopya üretimde kullanılmaz ve yeni algoritmanın doğruluk kaynağı değildir; eski 30 kabul sonucunun hâlâ doğrulanmasını sağlar. Yeni sürüm ayrı küçük grafik oracle'ıyla test edilir. 004 shadow için yeni sürüme ait ayrı kaynak checkpoint'i eklendi; eski kaynak checkpoint'i korunur. Güncel algoritma ile aynı algoritmanın shadow çıkarılmış hali karşılaştırılır. 005 tam-input fingerprint karşılaştırması validation overhead'i nedeniyle vaka başına 30 sn Jest sınırı kullanır; production timeout'u artırılmadı.

Sonraki tam koşuda yalnız iki frontier bucket testi başarısızdı (1130 PASS / 2 FAIL): yeni seed, sentetik iki-state bütçesini frontier büyümeden tüketiyordu. Bu yapısal testler için explicit `seedlessStress=true` bağlamında optional baseRoutes verilmez; gerçek optimizer/session/engine çağrıları devam eder. Bu seçim fixture hash'ine girer. Normal/native benchmark yolu varsayılan false ile bütün production bağlamını korur. Medium >=64 ve large >=257, push/pop/order ve sort/heap eşdeğerlik kontrolleri gevşetilmedi; altı harness testi PASS. Bu özel stres bağlamı, kullanıcının tam plan performans kabulü olarak sunulmaz.

## Kalite deneyi

[Altı karşılaştırmalı offline artefakt](charge-target-quality-2026-11-15.json), [çalıştırıcı](../../apps/api/scripts/validate-charge-target-search.ts). Sabit saat, sentetik in-memory portlar ve gerçek tüketim/şarj motorları. Provider HTTP/PG çağrısı yok. Başlangıç davranışı eski optimizer kaynağının yalnız bellekte derlenmesiyle karşılaştırıldı; ortak bağımlılıklar/metadata güncel, eski seedTargetSoc=100 açıkça sağlandı. Bu, tüm eski uygulama paketinin tam replay'i değildir.

| Amaç / durum | Önce SOC hedefleri | Sonra SOC hedefleri | Önce şarj süresi | Sonra şarj süresi |
|---|---|---|---:|---:|
| Süre, state budget 2 | %100 | %80 / %57,55 | 184,42 sn | 115,27 sn |
| Daha az durak, state budget 2 | %100 | %95,05 | 184,42 sn | 131,64 sn |
| Net enerji, state budget 2 | %100 | %80 / %57,55 | 184,42 sn | 115,27 sn |

Her durumda net sürüş enerjisi **4 kWh** olarak korundu; varış hedefi %20, sınırlı yeni planda varış yaklaşık %20,05. Bu ölçeklendirilmiş test aracı **Ioniq 6 performansı değildir**. Query maliyeti arttı: sınırlı süre/enerji örneğinde weather items 8→22, road edinimi 3→4; daha iyi plan için ek doğrulama yapılır. Bütün karşılaştırmalarda final plan sözleşmesi geçer ve objective gerilemez. Açık bütçeli üç amaç bağımsız exhaustive, elle integre edilmiş küçük grafik optimumuyla 0,01 sn içinde eşleşti. Gerçek rota için global optimum veya gecikme SLA'sı çıkarılmaz; gerçek hava/termal/erişim koşulları aday sırasının etkisini değiştirebilir.

## Doğrulama ve dosyalar

Yeni testler: iki veri politikasıyla sınırlı bütçede kısmi şarj, final SOC fazlasını azaltma, gerekli >80 şarj, bütün grid adaylarını koruma, prefix immutability, gerçek suffix çağrıları, başarısız final kabulünde incumbent koruma, iptal ve üç amaç için bağımsız oracle. Mevcut motor/rezerv/kapasite/SOH/termal/erişim/replay testleri de tam regresyonda çalışır.

Production değişiklikleri: `charge-target-search.ts`, `charge-stop-optimizer.ts`, `optimizer-policy.ts`, `catalogue-station-scenario.ts`, `planning-replay.ts`, mobil `PlanningForm.tsx`. Test/validation değişiklikleri: yeni `charge-target-search.spec.ts`, legacy snapshot/loader, üç tarihsel eşdeğerlik testinin kapsam uyarlaması, state validation checkpoint seçimi, kalite runner'ı ve yeni kanıt JSON'ları. Önceki yerel Valhalla pacing değişiklikleri ayrıca korunur.

İlk tam koşuda eski sürüme sabitlenmiş testler ve diagnostic audit 5 sn sınırı başarısızdı; bunlar atlanmadı veya golden değiştirilerek geçirilmedi. Tarihsel/güncel ayrımı ve replay onarımı sonrasında 261 compatibility testi, yeni testler dahil 34 hedefli test PASS. Son tam regresyon ve canlı servis kontrolü kapanış notuna eklenir.

## Sınırlar ve geri alma

Küçük aday kümesi/beam ve coordinate iyileştirmesi global optimum ispatlamaz; en iyi fiziksel nokta örneklenmemiş olabilir. Daha düşük SOC bazen hava/zaman/termal sonucu değiştirdiği için başarısız olabilir; başarısız aday kabul edilmez. Hata veya bütçe sonunda son doğrulanmış plan ve sınırlı arama etiketi korunur. Kotalar/süreler yükseltilmedi; hiçbir kaynak verisi internetteki tek bir örneğe göre değiştirilmedi. Yeni algoritma sürümü eski replay paketlerinin sessizce yeni sürüm gibi kullanılmasını önler.

Rollback, yalnız bu ürün değişikliğinin optimizer/policy/replay/UI dosyalarının birlikte önceki sürümüne dönmesidir; motorlar, DB verisi, tarihsel kanıtlar veya yerel Valhalla pacing düzeltmesi hedef değildir. Bu çalışma otomatik commit/push yapmaz.

## Kapanış — 2026-11-16

Son tam koşu: **1132/1132 API/DB testi PASS**, 68 suite (231,492 sn). Shared **41**, mobile **21** PASS; workspace typecheck ve API build PASS. Yeni sekiz hedef testi de ayrı koşuda PASS. `git diff --check` PASS. Tarihsel tracked validation kanıtlarında diff yok; iki fiziksel motorun kaynakları değişmedi. Ham yerel günlükler ignored `artifacts/charge-target-closure-*` altında tutulur.

Aktif iş sayısı 0 iken backend optimizer **1.1.0** / search policy **1.2.0** derlemesiyle yeniden başlatıldı; süre metrikleri süreç ortamında açık. Backend DB readiness, yerel Valhalla 8002 ve Expo 8082 durum uçları 200 döndü. Bu kapanış, İstanbul–Kelkit gibi uzun rotalar için saha kabulü değildir: sonraki cihaz isteği `d671310d-3b84-4dd4-8b95-717949ba35eb` ayrı bir uzun-rota hava örnekleme/değerlendirme bütçesi açığını gösterdi; bu algoritma kalite deneyiyle karıştırılmamalıdır.
