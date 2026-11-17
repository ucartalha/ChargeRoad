# Yükseklik verili rota (Valhalla 8004) için segmentasyon analizi — 2026-11-17

**Yalnız analiz; kod değişmedi.** Rotalar yerel Docker Valhalla'dan (8004, yükseklik verili; loopback). Hava verisi cache'teki ızgara hücrelerinden okundu; deneyde MET'e istek gitmedi. Enerji motoru ve sürümleri aynı.

## Sorun

8004'e geçince İstanbul→Ankara 587 yerine **5041** segmente bölündü; canlı plan 30 sn bütçesinde `computation_limit` ile bitti (enerji değerlendirmesi ~51 ms, hava sorgu öğesi 158 bin).

Neden: Valhalla yüksekliği 30 m aralıkla veriyor (`elevation_interval:30`). `normalize-road.ts` her 30 m noktasında komşu aralıkların eğimini karşılaştırıp fark ≥ %3 ise bölüyor (`splitAtGradeChangePercent:3`). DEM'in ~1 m dikey çözünürlüğü 30 m'de tek başına %3,3 eğim farkı demek; bölünmelerin çoğu gürültüdür. Enerji motoru ise eğimi zaten segment içindeki profil noktalarından (`elevationAt`) entegre ediyor.

## Deney — Ankara (Kızılay) → Bolu, 186 km

Aynı rota, aynı hava hücreleri, aynı motor; yalnız segmentasyon değişiyor.

| Varyant | Segment | Profil noktası | Enerji hesabı | Net enerji | Rejenerasyon | Varış SOC |
|---|---:|---:|---:|---:|---:|---:|
| Bugün (%3) | 2111 | 8275 | 93 ms | 35,004 kWh | 4,164 kWh | %21,307 |
| %5 | 933 | 7143 | 51 ms | 35,001 | 4,164 | %21,314 |
| %8 | 368 | 6543 | 27 ms | 35,005 | 4,165 | %21,305 |
| %15 | 233 | 6386 | 23 ms | 35,001 | 4,165 | %21,315 |
| **Eğimde bölme yok** | **227** | 6387 | **22 ms** | **35,004** | **4,164** | **%21,307** |
| Bölme yok + profil sadeleştirme 1 m | 227 | 2092 | 16 ms | 34,731 (−%0,8) | 3,768 (−%9,5) | %21,883 |
| Bölme yok + profil sadeleştirme 2 m | 227 | 1326 | 15 ms | 34,335 (−%1,9) | 3,195 (−%23) | %22,716 |

- Eğimde bölmeyi kaldırmak segmentleri **9,3 kat** azaltıyor, enerji hesabını **4,2 kat** hızlandırıyor; net enerji, rejenerasyon ve SOC değişmiyor (fark ≤ 0,005 kWh / 0,01 SOC puanı).
- Profili sadeleştirmek rejenerasyonu belirgin düşürüyor; tahmini değiştirdiği için önerilmez.
- Yükseklik verisinin değeri: aynı bacakta 4,16 kWh rejenerasyon (net enerjinin ~%12'si); yüksekliksiz rotada (8002) rejenerasyon 0 hesaplanır.
- Azami segment uzunluğu (1 km) ve süre (60 sn) sınırları korunur; hava zaman çözünürlüğü değişmez.

## Ayrı bulgular

1. **Yükseklik verisi bazen tamamen atılıyor.** Kadıköy→Bolu'da 8004 yükseklik döndürdü ama `elevation_sampling_count_mismatch` oldu: `values.length` beklenen `ceil(uzunluk/30)+1` değerinden 1 farklı. `normalize-road.ts` bu durumda bacağın tüm yüksekliğini `null` yapıyor (`elevation_missing`). Valhalla'nın `summary.length` yuvarlamasından kaynaklandığı düşünülüyor; ±1 tolerans + son noktanın bacak sonuna sabitlenmesi önerilir (test gerekir).
2. **Sağlayıcı "veri yok" değeri sızıyor.** Adapter yalnız tam `-500` ve `-32768` değerlerini `null` yapıyor; 8002 rotalarında `-499.9` değerleri `modelled` kalitesiyle segmentlere girdi.

## Önerilen uygulama

1. `ROAD_SEGMENTATION`: eğim değişiminde bölmeyi kapat (no-data geçiş bölmesi, sınıf/hız/yön/şarj erişimi bölmeleri ve 1 km / 60 sn sınırları kalır); segmentasyon politikası sürümü artar (1.0.0 → 1.1.0). Enerji motoru ve sürümü değişmez.
2. Valhalla yükseklik sayısı için ±1 tolerans ve −430 m altı değerleri "veri yok" sayma (testlerle).
3. API'nin kalıcı olarak 8004'e geçmesi: `.env` içindeki `ROAD_ROUTING_BASE_URL=http://127.0.0.1:8004` (kullanıcı tarafından).
4. Doğrulama: İstanbul→Ankara, Bursa→Ankara, Ankara→İstanbul canlı planları (segment, süre, MET, plan sonucu); flag'siz eski/yeni enerji farkı.
5. Saha doğruluğu (gerçek tüketim/rejenerasyon ölçümü) bu analizin kapsamı dışında; ölçülmüş yolculuk verisi gerektirir.

## Ek — Uygulama ve canlı sonuç (aynı gün)

Uygulandı (test önce kırmızı): `ROAD_SEGMENTATION` 1.0.0 → **1.1.0**, `splitAtGradeChangePercent` 3 → 1000 (fiilen kapalı; mekanizma politika ile hâlâ açılabilir). Valhalla yükseklik sayısında ±1 tolerans (son kullanılan aralık bacak sonunda biter; daha büyük fark hâlâ atılır). −499,9 gibi değerler için adapter kuralına dokunulmadı: mevcut test, yalnız tam sentinel değerlerin "veri yok" sayılmasını bilinçli olarak sabitliyor; hava ızgarası bu değerleri zaten kullanmıyor. Testler: yeni 6/6, API 1093 PASS / 4 FAIL (önceden var olan `latency-polling`), typecheck PASS. Enerji/şarj/optimizer kodu ve sürümleri değişmedi.

Canlı (API süreç ortamında 8004, ızgara ve 8 saat cache açık):

| Rota | Sonuç | MET | Sunucu |
|---|---|---:|---:|
| İstanbul→Ankara | `computation_limit` (NO_VALID_PLAN_WITHIN_DATA_BUDGET) | 0 | 12 sn |
| Bursa→Ankara | planned, 386,5 km, 2 durak, varış %20,07 | 21 | 15 sn |
| Ankara→İstanbul | planned, 456,4 km, 2 durak, varış %20,07 | **0** | 17 sn |

İstanbul→Ankara, hava projeksiyon sınırına (`min(200000, max(30000, ana segment × 32))`) 29.964'te takıldı. Segment sayısı azaldığı için bu sınır 30.000 tabanına indi. Süreç içinde `maxSegmentPasses` 32 → 100 denendi: 754 geçiş, 55.025 projeksiyon, yine geçerli plan yok (21 sn). Yani yalnız bütçe değil; yükseklik verisiyle bu rotada arama bir plan bulamıyor — ayrı teşhis gerekir. API telefonda kullanılabilir kalsın diye 8002'ye geri alındı; 8002'de İstanbul→Ankara planned (10 sn, MET 0). Günlük MET kullanımı 684/1000.

## Ek 2 — İstanbul→Ankara 8004 teşhisi (kod değişmedi)

Aynı istek süreç içinde 8004 ve 8002 ile çalıştırıldı; her `drive`/`charge` sonucu kaydedildi (hava cache'ten).

1. **Gerçek yükseklikle ilk durak zinciri kopuyor.** 8002'nin planı: başlangıç → `39c23268` (194,5 km, varış %24,5) → %98 şarj → `5dd6151c` → %42 → varış. 8004'te aynı ilk bacak Bolu tırmanışı nedeniyle **%9,5** ile bitiyor ve %10 rezervi ihlal ediyor (rejenerasyon 9,3 kWh hesaplanmasına rağmen net tüketim daha yüksek). Bu pilot profilde kullanılabilir enerji ~47,5 kWh (%100'den tükenmeye kadar), yani ~180 km'lik menzil; yüksekliğe göre rota artık 3 durak gerektiriyor.
2. **Seed üç duraklı zinciri bulamıyor.** Arama `1b71234d` (172 km, varış %21) istasyonuna gidiyor, %80 ve %100'e şarj ediyor. %100'den sonra yalnız uzak adaylar (233–276 km) ve varış deneniyor; %80'de denenip başarısız olan yakın adaylar (`23d7043a` 163,5 km, `122742a4` 168,2 km) %100 ile **hiç denenmiyor**.
3. **Geniş arama bütçeyi başlangıca 17,6 km uzaklıktaki bir istasyonda harcıyor.** Sürüş adımlarının 458'inin **429'u** `97df5019`'dan (varış %89) yapılıyor: %89→90/91,8/95/100 şarj ve her birinden ~128 hedef. Bu davranış 8002'de de var (466'nın 416'sı), ama orada seed zaten 2 duraklı plan bulduğu için görünmüyordu. Bütçeyi 3 katına çıkarmak da bu yüzden işe yaramadı.

Sonuç: sorun segmentasyon ya da hava değil; yükseklik verisi zinciri sıkılaştırınca optimizer'ın seed ve arama sırası zayıflığı ortaya çıkıyor. Önerilen düzeltme (optimizer davranışı değişir, `OPTIMIZER_VERSION` artışı ve onay gerekir):

- **Seed:** her durakta, başarısız uzak bacakların tükenme noktasından (başlangıç bacağında zaten kullanılan `reachFromDrive` mantığı) ulaşılabilir mesafeyi çıkarıp adayları buna göre yakından uzağa denemek; %100 hedefinde yakın adayları da denemek.
- **Arama sırası:** başlangıca çok yakın ve SOC'si zaten yüksek istasyonlarda şarj genişletmesini düşük öncelikli yapmak (aktif budama değil; CR-PERF-004'teki NO-GO kararına aykırı olmamalı).

## Ek 3 — Optimizer 1.3.0 (seed yedeği) ve canlı sonuç

Değişiklik: `charge-stop-optimizer.ts` içinde `seedFallbackCandidates`; birincil seed denemeleri bataryayı tüketirse, başarısız bacakların güvenle kat ettiği en uzak ilerleme içindeki denenmemiş adaylar en uzaktan başlayarak denenir. `OPTIMIZER_VERSION` 1.2.0 → 1.3.0; durum-gölgesi doğrulaması için yeni checkpoint `seed-fallback-shadow-source-2026-11-17.json` (eski checkpoint'ler değişmedi). Testler: yeni 4/4, API 1097 PASS / 4 FAIL (önceden var olan `latency-polling`), typecheck PASS. Arama sırası (başlangıca yakın yüksek SOC'li şarj) değiştirilmedi.

Canlı, API süreç ortamında 8004 + ızgara + 8 saat cache + segmentasyon 1.1.0 + optimizer 1.3.0:

| Rota | Sonuç | MET | Sunucu |
|---|---|---:|---:|
| İstanbul→Ankara | planned, 512,6 km, **3 durak**, varış %20,01 | 0 | 12 sn |
| Bursa→Ankara | planned, 386,5 km, 2 durak, varış %20,07 | 0 | 8 sn |
| Ankara→İstanbul | planned, 456,4 km, 2 durak, varış %20,07 | 0 | 10 sn |

Üç planın hava verisi tamamen cache'ten geldi. Günlük MET kullanımı 684/1000.
