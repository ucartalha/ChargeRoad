# Optimizer 1.9.0 — durak cezası, durak eleme, menzil ön kontrolü (2026-11-19)

## Sorun (telefon isteği, `planning_debug` izi)
İstanbul(Kadıköy)→Erzurum, %100 başlangıç, %8 rezerv, %17 varış: 9 durak, 995 dk; 1. ve 2. durak 61 km arayla; 8. durak %56'ya şarj edip 9. durağa iniyor. İz: hava projeksiyonlarının %79'u (37.769/47.679) varılamayan uzak bacaklarda; iyileştirmeye ~2.000 kaldı.

## Kararlar
- Kullanıcı: durak başına 6 dk, yalnız sıralamada (P1-a); yakın eşitlikte (60 s) daha az durak (seçenek a).
- P2: %50 kuralı plan düzeyinde: kural yüzünden plan yoksa gevşetilmiş arama kendi bütçesiyle çalışır.

## Teşhis notları (yeniden üretim, Kadıköy genel noktası)
- 9. durağı kaldırmak fiziksel +6,0 dk (+361 s): 6 dk cezayla 1 s fark → yakın eşitlik kuralıyla kaldırılır.
- 2. durağı kaldırmak için 181. km'de %100 gerekir; 181→401 bacağı rezervin (%8) altına (~%6) iner → bu istasyon dizisiyle gerekli.

## Sonuçlar (süreç-içi, yerel Valhalla + Open-Meteo; dk / durak; 1.8.0 davranışı geçici yama ile, aynı anda)
| Durum | 1.8.0 | 1.9.0 |
|---|---|---|
| Kullanıcı isteği (Kadıköy, %100, r%8, v%17, şimdi) | 998,1 / 9 | 1.002,6 / 7 |
| Kadıköy→Kelkit (sabit) | 837,1 / 7 | 837,1 / 5 |
| Fatih→Kelkit (sabit) | 865,6 / 7 | 852,8 / 6 |
| Batı→Kelkit (sabit) | 907,2 / 8 | 910,9 / 6 |
| İstanbul→Ankara (sabit) | 332,6 / 3 | 331,0 / 2 |
| İstanbul→Edirne (şimdi %80) | 197,8 / 2 | 195,2 / 1 |
| Ankara→Trabzon (şimdi %80) | 604,1 / 4 | 603,9 / 3 |
| İstanbul→Antalya (şimdi %80) | 587,6 / 4 | 589,5 / 3 |
| Kelkit şimdi %80 / %40 | 908,7 / 8 · 922,7 / 8 | 909,2 / 6 · 926,0 / 7 |
| Erzurum şimdi %40 | 1.052,4 / 9 | 1.054,1 / 8 |
| Erzurum şimdi %60, r%20, v%50 | plan yok | 1.088,8 / 9 |
| İzmir, Erzurum (sabit), Erzurum %80, Adana→İst., Ankara→Van, Bursa, İzmir→Ankara, Kadıköy→Kartal | — | aynı |

Bazı yeni planlarda tek durakta %100 şarj vardır (durak kaldırmanın bedeli). Süreler makine yüküne bağlı 2–11 s; hızlanma iddiası yok. Saha kabulü NOT_RUN.

## Testler
`optimizer-1-9.spec.ts` (6; ceza, yakın eşitlik, ön kontrol, eleme hedefleri, sürüm) önce FAIL sonra PASS. Saf süre mekanizmasını ölçen 4 test (optimizer.spec kısmi şarj, charge-target-search 2 vaka, optimizer-reference süre) ceza ve eşitlik kuralı kapalı çalışacak şekilde güncellendi (gerekçe dosyalarda). API 1.194 PASS, 154 SKIPPED (DB, NOT_RUN). Durum gölgesi: `stop-penalty-elimination-shadow-source-2026-11-19.json`.
