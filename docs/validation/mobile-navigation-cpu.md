# CR-PERF-006 — Mobil navigasyon CPU ve render kanıt kapısı

2026-11-16 · **Karar: NO-GO — aktif navigasyon optimizasyonu uygulanmadı.** Offline davranış eşdeğerliği PASS; indeksin net performansı FAIL. React/render/device kapıları NOT_RUN. CR-PERF-007 başlamadı.

## Başlangıç, kapsam ve koruma

HEAD **bf41840856a6e3c275665f8571483e9080cd7a3d**. Başlangıç dirty envanteri ve raw SHA-256 manifesti [start.json](mobile-navigation-cpu-2026-11-16/start.json): **579 dosya**, önceki 005 ve kümülatif ölçüm dosyaları dahil. Yerel dirty içerik esas alındı. Önceki 001–005/kümülatif kararlar mobil baseline yapılmadı: array sort+shift, 003/004 shadow-only, 005 cache yok. Backend, provider, DTO/Zod, DB, algoritma sürümü ve storage kontratı değişmedi. Reset/clean/stash/checkout/commit/push yapılmadı.

Başlangıç navigation-core raw hash'i **97d292effe4c71369774ddd6f66b6997a3858230b6ce6790c978070d11fbea2c**; [birebir kaynak snapshot'ı](mobile-navigation-cpu-2026-11-16/original-navigation-core.ts.txt) değişmeden korundu. Önce mevcut mobile test **21/21 PASS**, ardından production değişmeden **40 deterministik golden vaka** üretildi. [Golden](mobile-navigation-cpu-2026-11-16/baseline/golden.json) yeniden yazılmadı. Snapshot ayrı yazılmış eski solver değildir: başlangıçtaki gerçek production kaynak byte'larının kopyasıdır, aynı TypeScript compiler ile çalıştırılır; raw hash başlangıç manifestiyle eşleşir.

## Doğrulanan darboğaz ve dar aday

Orijinal locateOnRoute her ziyaret edilen segmentte geometry.slice(1).map(distanceMeters) ve reduce ile kenar uzunluklarını tekrar hesaplıyor. Continuity filtresi segment düzeyinde; geniş bir tek-polyline segment bütün kenarları her fix'te taratabiliyor. navigationProgress SOC segment döngüsü ve remainingDrivingSeconds reduce işlemini her fix'te sürdürüyor. NavigationPanel her geçerli fix'te geniş trip snapshot'ını publish/setTrip ile güncelliyor; MapCanvas props zinciri devam ediyor. Bu gözlemler güncel kaynakta doğrulandı.

Deneysel NavigationGeometryIndex yalnız scripts/validation altındadır; uygulama tarafından import edilmez. Kenar uzunlukları/toplamı aynı işlem sırasıyla bir kez hesaplanır; kendi numeric kopyaları ve frozen length/value kayıtları tutulur. Kaynak rota/array/point mutate veya freeze edilmez. İndeks rota object identity, planId/revision/algorithmVersion, segment/geometry/point identity ve numeric snapshot değişikliklerinde dispose/fallback yapar. Sadece eski continuity filtresinin ziyaret edeceği row doğrulanır; kullanılmayan row için ek geometri taraması yoktur. Dispose referansları bırakır; global/persistent cache yoktur.

Benchmark gerçek eski core'u bellekte yalnız opsiyonel index argümanı ve cached-length lookup ekleyerek derler; projeksiyon/SOC/remaining-time/score/tie-break matematiği kopyalanmaz veya yeniden yazılmaz. Her replacement beklenen tek kaynak ifadesine bağlıdır; kaynak şekli değişirse durur. Bbox, spatial pruning, prefix SOC/time, zaman throttling ve render refactor **aktif olmadı**. Özellikle floating-point toplama sırasını değiştirmemek için SOC/time döngülerine dokunulmadı. Nihai production navigation-core imzası da değişmedi.

## Tam davranış eşdeğerliği ve sınırlar

200/1000/5000/15000 kenarlı iki temsil (tek uzun polyline ve çok sayıda kısa segment), regular/hotspot/loopback/parallel/antimeridian aileleri: **40 golden vaka ×32 ordered fix =1280 tam sonuç karşılaştırması/process**, üç-process koşuda 3840. distance, crossTrackMeters, soc, remainingMeters, remainingDrivingSeconds, instruction/instructionDistance, offRoute, arrived, needsChargeConfirmation ve previous continuity tüm alanlarıyla deepStrictEqual. Önceden belirlenmiş tolerans **0**; sınıflama sapması yoktur. Hash'ler yalnız artefakt kimliği; asıl kontrol tam nesne eşitliğidir.

59 yeni pure proof testi +21 mevcut test = **80/80 PASS**. İlk fix, aynı timestamp, büyük sıçrama/ters ilerleme, yakın paralel yol/uzun loopback, sıfır edge, tek nokta/boş geometri, zero/misaligned segment, regen, manuel anchor/stop doğrulaması, stop/arrival/maneuver sınırları ve estimated/user-input replan provenance test edildi. Revision/plan/model/geometry/coordinate/segment/order/restore değişikliği eski indeksi kullanamıyor; dispose sonrası orijinal tarama ile aynı sonuç var. Invalid fix'te route/index getter'ı okunmadan null dönüşü korunuyor. Inputs mutable kalır; çıktı/cached numeric ownership testleri PASS.

Orijinal bozuk/zero-length segmentin NaN davranışı veya anti-meridian mesafe politikası bu optimizasyonda düzeltilmedi; birebir eski davranışın korunması saha doğruluğu onayı değildir. Runtime restore testinde mevcut decodeTrip yeni snapshot üretir, paused/progress:null korunur. UI generation/abort/AppState yarışları için mounted RN/device testi **NOT_RUN**; bu dosyalar byte olarak değişmediği için yeni callback/index/race davranışı üretime girmedi. Pure replan girdi testi gerçek replanFromNavigation fonksiyonunu karşılaştırır, ayrı replan algoritması kullanmaz.

## Üç-process paired performans

Nihai kabul verisi **run4**: üç bağımsız process, concurrency=1, her arm/grup 3 warmup, 4 ABBA/BAAB blok; **8 sequence örneği/arm/process, pooled 24**. Her sequence 32 fix; normal akışta 2 edge/2 saniye ilerleme. Her rota 200–15000 edge için hem polyline hem segmented ölçülür. Fixture yapımı dışarıda; index create +32 GPS processing +dispose total içinde. Fix timer build'i dışlar; startup ayrıca gösterilir. Her fix'teki per-fix timer iki armda da vardır. Kaynak/fixture/clock sabit; RNG yok. Benchmark önceki backend süreleriyle karşılaştırılmaz.

Run1 ilk candidate, run2 validation alanına taşınan aynı yaklaşım, run3 regular akış hazırlığıdır; hepsi korunur, golden değişmedi. Run3 sırasında kısa ayrı operation diagnostic işi çakıştığı için nihai kabul olarak kullanılmadı. Run4 sırasında başka task testi/diagnostic benchmark paralel başlatılmadı; çalışan kullanıcı/backend/Metro süreçleri kapatılmadı. Kaynak hash'leri ve makine/Node bilgisi her process JSON'unda.

| Edge / temsil | Before fix p50/p95/p99 ms | Index fix p50/p95/p99 ms | 32 fix +build/dispose p50 önce → sonra ms | Toplam p50 kazanç % | >%5 p95 gerileyen process |
|---|---:|---:|---:|---:|---:|
| 200 / polyline | 0.0402 / 0.0844 / 0.1362 | 0.2092 / 0.2987 / 0.4074 | 1.4184 → 6.4044 | -351.5228 | 3/3 |
| 200 / segments | 0.0465 / 0.0932 / 0.1540 | 0.0688 / 0.1995 / 0.4649 | 1.6049 → 2.6696 | -66.3406 | 3/3 |
| 1000 / polyline | 0.1609 / 0.2058 / 0.3226 | 0.2631 / 1.1077 / 1.2922 | 5.2863 → 8.7673 | -65.8495 | 3/3 |
| 1000 / segments | 0.0407 / 0.0730 / 0.4117 | 0.0601 / 0.3240 / 1.1609 | 1.7052 → 4.1564 | -143.7485 | 3/3 |
| 5000 / polyline | 0.7875 / 1.0457 / 1.4738 | 0.7337 / 4.9184 / 6.0265 | 25.8312 → 26.5334 | -2.7184 | 3/3 |
| 5000 / segments | 0.1370 / 0.2168 / 2.1651 | 0.2327 / 1.2133 / 9.1993 | 6.4392 → 21.5927 | -235.3320 | 3/3 |
| 15000 / polyline | 1.9761 / 2.6761 / 3.1710 | 1.9368 / 3.7859 / 13.1262 | 63.7945 → 79.6451 | -24.8463 | 3/3 |
| 15000 / segments | 0.3611 / 0.7218 / 5.8476 | 0.4708 / 4.4071 / 17.4825 | 17.2988 → 39.3373 | -127.3990 | 3/3 |

Ölçüm öncesi kodda sabit gate: her iş yükünde total p50 en az %5 kazanç ve üç process'in en az ikisinde >%5 p95 regresyonu olmaması. **Sekiz grubun tamamı NO-GO; hepsinde p95 3/3 süreçte geriledi.** Bu, geometri işlem sayısındaki azalmayı hızlanma kabulü saymamamızın nedenidir. Sadece per-fix timer değil, build/dispose dahil net sonuç esas alındı.

| Edge / temsil | Index build p50/p95/p99 ms | Build dahil tek ilk-fix p50 önce → sonra ms | Numeric payload proxy byte | Toplam CPU user/system önce → sonra ms (24 sequence/arm) |
|---|---:|---:|---:|---:|
| 200 / polyline | 0.0913 / 0.1905 / 0.3980 | 0.0384 → 0.1228 | 4816 | 48.0000 / 0.0000 → 283.0000 / 32.0000 |
| 200 / segments | 0.3989 / 0.5926 / 0.6506 | 0.0921 → 0.5414 | 8000 | 93.0000 / 0.0000 → 157.0000 / 0.0000 |
| 1000 / polyline | 0.2807 / 0.5219 / 0.5981 | 0.1754 → 0.3412 | 24016 | 250.0000 / 0.0000 → 606.0000 / 0.0000 |
| 1000 / segments | 1.5931 / 2.7844 / 2.8290 | 0.4235 → 1.8626 | 40000 | 48.0000 / 0.0000 → 251.0000 / 32.0000 |
| 5000 / polyline | 1.1005 / 2.4118 / 2.8543 | 0.9490 → 1.4787 | 120016 | 737.0000 / 16.0000 → 1218.0000 / 47.0000 |
| 5000 / segments | 6.2510 / 8.0736 / 8.8038 | 2.0704 → 8.3551 | 200000 | 220.0000 / 0.0000 → 857.0000 / 78.0000 |
| 15000 / polyline | 2.6737 / 3.8168 / 4.0602 | 2.0784 → 4.4117 | 360016 | 1611.0000 / 32.0000 → 2311.0000 / 62.0000 |
| 15000 / segments | 14.3806 / 21.6259 / 22.0227 | 5.9305 → 18.3043 | 600000 | 511.0000 / 16.0000 → 1941.0000 / 16.0000 |

İlk-fix-only n=3/arm (process başına bir örnek); açıklayıcı startup ölçümüdür, dengeli headline gate değildir. Uzun kullanımda amortizasyon ihtimali gate'i kurtarmadı: ölçülen 32 fix toplamı zaten negatif. Tüm seyahat uzunlukları için extrapolation yapılmadı.

| Edge / temsil | Before process1/2/3 sequence p95 ms | Index process1/2/3 sequence p95 ms | Sequence heap delta p50/p95/p99 byte önce → sonra |
|---|---:|---:|---:|
| 200 / polyline | 2.4075 / 1.7250 / 2.5097 | 7.5230 / 8.1850 / 7.6583 | 915312.0000 / 1219376.0000 / 1224480.0000 → 5802304.0000 / 5827224.0000 / 5832672.0000 |
| 200 / segments | 2.4166 / 1.9166 / 2.4721 | 6.3877 / 6.8998 / 6.5784 | 1043568.0000 / 1057472.0000 / 1066536.0000 → 1477472.0000 / 3050712.0000 / 3061808.0000 |
| 1000 / polyline | 6.2130 / 5.6854 / 5.2101 | 35.5880 / 34.3126 / 28.1043 | 3988144.0000 / 4022752.0000 / 4026728.0000 → 3951952.0000 / 28501696.0000 / 28511408.0000 |
| 1000 / segments | 2.1692 / 2.9176 / 1.7498 | 13.7680 / 11.8909 / 12.3189 | 2035800.0000 / 2039544.0000 / 2044680.0000 → 4220392.0000 / 7447120.0000 / 7501144.0000 |
| 5000 / polyline | 31.6563 / 27.4038 / 28.3724 | 68.6294 / 53.4912 / 57.3796 | 19555736.0000 / 19600160.0000 / 19600672.0000 → 8687056.0000 / 19162264.0000 / 19163400.0000 |
| 5000 / segments | 7.4656 / 8.6996 / 7.1440 | 30.9883 / 31.9646 / 33.6775 | 8308336.0000 / 8331368.0000 / 8331400.0000 → 13711760.0000 / 25084736.0000 / 25255552.0000 |
| 15000 / polyline | 74.8605 / 74.5419 / 85.9923 | 103.3716 / 108.8880 / 113.4829 | -8032640.0000 / 25471536.0000 / 25618328.0000 → -8314304.0000 / 24453248.0000 / 24475376.0000 |
| 15000 / segments | 20.2539 / 20.0296 / 19.7578 | 68.8497 / 70.9029 / 69.5979 | -2823672.0000 / 24012688.0000 / 24014440.0000 → 10401184.0000 / 14367744.0000 / 15914936.0000 |

Windows 10.0.26200, 12th Gen Intel(R) Core(TM) i7-12700H, Node v26.13.0, 20 logical CPU. CPU microsecond formatı Windows çözünürlüğü garantisi değildir; kısa değerler sıfır/kuantize olabilir, biriken user/system gösterilir. GC observer event start/duration/kind ve ölçüm window'ları ham JSON'da; explicit GC yalnız bloklar arasında. Setup/validation/JIT ve kullanıcı yükünün etkisi tam izole değil. Heap delta GC ile negatif olabilir, leak/batarya tasarrufu değildir. Numeric proxy JS array/reference/entry overhead'ini içermez; gerçek retained heap garantisi olarak kullanılmaz. Sequence n=24 p99 örnek maksimumu; fix n=768 korelasyonlu örnektir, nüfus kuyruğu/SLA veya RN FPS değildir.

## Gerçek geometri işlem sayıları

Ayrı instrumented diagnostic (headline timing'e karıştırılmadı): orijinal source'un distanceMeters ve projection döngüsüne yalnız counter eklenir; candidate constructor observer'ı gerçek distanceMeters çağrılarını sayar. İki armın tam sonuçları ve projeksiyon sayıları ayrıca eşleşir.

| Edge / temsil | 32 fix edge-length hesabı önce → index build+fix | Projection edge işlemi önce → sonra |
|---|---:|---:|
| 200 / polyline | 6400 → 200 | 6400 → 6400 |
| 200 / segments | 1585 → 200 | 1585 → 1585 |
| 1000 / polyline | 32000 → 1000 | 32000 → 32000 |
| 1000 / segments | 2385 → 1000 | 2385 → 2385 |
| 5000 / polyline | 160000 → 5000 | 160000 → 160000 |
| 5000 / segments | 6385 → 5000 | 6385 → 6385 |
| 15000 / polyline | 480000 → 15000 | 480000 → 480000 |
| 15000 / segments | 16385 → 15000 | 16385 → 16385 |

Saf uzunluk matematiği azalsa da projeksiyon sayısı değişmedi. İndeks snapshot doğrulaması, frozen array erişimi, kopyalar ve kurulum yeni işler getiriyor; toplamda net kazanç yok. Bu bileşenlerden hangisinin tek başına kaç ms aldığı ayrı CPU profilinde izole edilmedi; regresyonu yalnız birine atfetmiyoruz. Segmentli rotada eski continuity filtresi zaten birçok edge hesabını atladığından eager build'in amortizasyonu özellikle zayıf.

## Render, güvenlik ve gizlilik

React Profiler/commit/render, callback/state-update proxy ölçümü: **NOT_RUN** (mounted component yok). Kaynakta her GPS'teki publish yolu gözlendi; bu bir ölçülmüş render sayısı değildir. NavigationPanel snapshot/progress bölünmedi, callback dependency/memo/subscription değiştirilmedi, MapCanvas polyline render yolu değişmedi; id/name/testID/backend bağlantıları korunur. Render saving/FPS/batarya/kullanıcı navigasyon kabulü **NOT_RUN**. Expo export build kabulüdür, cihaz testi değildir. Metro/telefon/simulator/kullanıcı servisleri yeniden başlatılmadı.

validFix 15 sn age /2 sn future /50 m accuracy; watch 2000 ms /10 m; continuity 150 m geri /max(300,elapsed×60) ileri segment penceresi; orijinal score ve strict tie-break; monoton previous distance; off-route max(50,accuracy×2); 3 fix/10 sn replan; 60 sn cooldown; foreground/AppState pause/resume, 15 sn persistence, manuel SOC anchor/charge confirmation ve generation fencing **kaynakları değişmeden korundu**. Planlanan charge gözlemlenmiş SOC olmadı. Gerçek kullanıcı GPS/SOC/rota/history/token/IP loglanmadı; yalnız in-memory deterministik sentetik geometri üretildi, artefaktlarda hash ve aggregate var. Korunan original source snapshot'ı kod içerir, kullanıcı rotası içermez.

## Test kapıları, tam değişiklikler ve rollback

| Komut | Durum | Sonuç |
|---|---|---|
| `pnpm.cmd --filter @chargeroad/shared test` | PASS | ℹ tests 41; ℹ pass 41; ℹ fail 0; ℹ skipped 0 |
| `pnpm.cmd --filter @chargeroad/mobile test` | PASS | ℹ tests 80; ℹ pass 80; ℹ fail 0; ℹ skipped 0 |
| `pnpm.cmd --filter @chargeroad/mobile typecheck` | PASS |  |
| `pnpm.cmd --filter @chargeroad/shared typecheck` | PASS |  |
| `pnpm.cmd --filter @chargeroad/api typecheck` | PASS |  |
| `pnpm.cmd --filter @chargeroad/api build` | PASS |  |
| `pnpm.cmd --filter @chargeroad/mobile build` | PASS |  |
| `pnpm --filter @chargeroad/api test:db` | NOT_RUN | No backend/storage/provider/contract changes; optional per user scope. Current task does not reuse earlier DB PASS. |

Mobil test sayısı 80, shared 41; mobil typecheck/Expo export ve shared/API typecheck/API build PASS. API test:db bu görevde **NOT_RUN**: backend/DB/contract etkilenmedi ve bu kapı kullanıcı tarafından opsiyoneldi; önceki 1168 PASS bu teslimin çalıştırması sayılmadı. Expo export offline/CI/no-telemetry koşulunda kendi build süreciyle çalıştı; yeni paket indirilmedi. git diff --check final koruma kapısında PASS.

Yeni dosyalar: scripts/navigation-performance-fixtures.cjs, benchmark-mobile-navigation.cjs, validate-navigation-operations.cjs, scripts/validation/navigation-geometry-index.ts, tests/navigation-index-proof.test.cjs ve bu rapor/JSON/source evidence. Mevcut mobile/scripts/test.cjs yalnız proof testini ekler; docs/TASKS ve 006 görev durumu güncellenir. **navigation-core.ts, NavigationPanel.tsx, MapCanvas.tsx, trip-storage.ts, app entry, backend/shared ve package/lock dosyaları değişmedi.** Yeni dependency/servis/SDK/cache yoktur.

Üretim rollback'i gerektiren değişiklik yok. Deneyleri kaldırmak gerekirse yalnız test runner'daki ek require ve yeni proof dosyaları ilgili ayrı değişiklikle kaldırılabilir; kullanıcı task/önceki kanıtları reset/clean ile silinmez. Aktif index/render kararı ancak yeni dar hipotez, aynı güvenlik sözleşmesi ve yeni kaynak bağlı kazanç kanıtıyla yeniden açılır. CR-PERF-007 için kod veya otomatik GO verilmedi.

Kanıtlar: [baseline/golden](mobile-navigation-cpu-2026-11-16/baseline/golden.json), [nihai paired özet](mobile-navigation-cpu-2026-11-16/run4/summary.json), [P1](mobile-navigation-cpu-2026-11-16/run4/process-1.json), [P2](mobile-navigation-cpu-2026-11-16/run4/process-2.json), [P3](mobile-navigation-cpu-2026-11-16/run4/process-3.json), [operations](mobile-navigation-cpu-2026-11-16/operations-steady.json), [checks](mobile-navigation-cpu-2026-11-16/checks.json), [koruma/kapanış](mobile-navigation-cpu-2026-11-16/closure.json).

Yeniden üretim: mobile dizininde node --expose-gc scripts/benchmark-mobile-navigation.cjs --benchmark --tag=yeni-run5; baseline yeniden yazılmaz, yeni tag exclusive-write kullanır. pnpm mobile test mevcut snapshot'a karşı pure proof testlerini de çalıştırır. Final karar: **eşdeğerlik PASS, net performans NO-GO, aktif uygulama yok, cihaz/render NOT_RUN**.
