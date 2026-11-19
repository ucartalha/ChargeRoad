# Menzil sınırı denemeleri: REDDEDİLDİ (2026-11-19/20)

Durum: **Uygulanmadı.** Optimizer `chargeroad-optimizer/1.9.0` olarak kaldı. Bu belge aynı fikirlerin ölçülmeden yeniden denenmemesi içindir.

## Deneme A: kalibre edilmiş üst sınır
Fikir: 1.9.0 ön filtresi (`REACH_PREFILTER_POLICY`, 2,5 × (SOC − rezerv) × menzil tahmini + 25 km) yerine, isteğin kendi sürüşlerinde ölçülen tüketimle (en düşük tüketim, 1,3 pay) daha sıkı bir üst sınır.

Ölçüm (İstanbul→Erzurum, Kelkit; motorun gerçekten hesapladığı bacaklar):
- Bacak tüketimi: ≥150 km bacaklarda 0,138–0,226 kWh/km (medyan ~0,175); 30–80 km bacaklarda en düşük 0,107 (yokuş aşağı).
- Menzil tahmini 175 km iken 1.9.0 sınırı %80→%10 için ~331 km; ölçülen tüketimle 1,3 paylı sınır ~328 km. **1.9.0 sınırı zaten gerçekçi menzilin ~1,3 katı.**
- Üç varyant (≥30 km/1,3; ≥150 km/1,15; ≥150 km/1,0): planlar aynı, bir durumda 0,8 dk kötü; hava projeksiyonu rotaya göre azaldı da arttı da (Kelkit 26,9 bin → 37–39 bin).

Sonuç: fayda yok.

## Deneme B: menzil penceresi (alt sınır), kullanıcı fikri
Fikir: "%80'le en iyi 330 km, her şey aleyhimize olsa en kötü 110 km; sonraki istasyonu 110–330 km arasında ara." En kötü menzil = ölçülen en yüksek uzun bacak tüketimi × 1,2; pencerede istasyon varsa daha yakın istasyonlar sürülmedi (varış hiç elenmedi, ölçüm yetersizken uygulanmadı).

Eşleştirilmiş ölçüm (her durum aynı anda, aynı kalkış "şimdi + 10 dk", önce 1.9.0 davranışı sonra pencere; Open-Meteo yerel, 20 durum):

| Sonuç | Durum sayısı |
|---|---|
| Aynı plan | 4 |
| Daha iyi (cezalı süre) | 5 — en iyi: Kelkit sabit 6→5 durak (−1,3 dk), Ankara→Trabzon 4→3 durak, İzmir −5,2 dk |
| Daha kötü | 11 — **5'i planlanamadı** (Erzurum %100 ve %80, Erzurum %60/r20, Kelkit batı, Ankara→Van: `computation_limit`/`insufficient_data`); Kelkit %80 +50,3 dk, Erzurum (ikinci İstanbul başlangıcı, %8 rezerv) %100 +22,2 dk, Adana→İstanbul +17 dk |

Toplam süre 106,7 → 93,4 s; hava projeksiyonu 627 bin → 713 bin (planlanamayan durumlar bütçe sınırına kadar arandı).

Neden: yakın istasyonu **eleme** kuralı, pencere istasyonu düşük güçlü/sapmalı ya da sonraki zinciri kötü olduğunda tek iyi seçeneği yok ediyor (ör. Erzurum'da durak geometrisi gereği gereken 181/242 km çifti).

## Açık kalan fikir
Pencere **sıralama** olarak (pencere içindeki istasyonlar önce denenir, yakınlar sona bırakılır, hiçbiri elenmez) ölçülmedi. Denenirse aynı eşleştirilmiş yöntemle ölçülmeli.

Not: Bu geçici ölçümler scratchpad betikleriyle yapıldı (fixture/offline değil, yerel Valhalla + yerel Open-Meteo); gerçek sağlayıcı veya saha kabulü değildir.
