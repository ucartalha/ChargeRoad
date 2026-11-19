# Optimizer 1.8.0 — durak sınırı, iyileştirme payı, son durak (2026-11-19)

## Sorun
Telefondan İstanbul→Erzurum (başlangıç SOC ~%40, "şimdi") iki kez `computation_limit` / `NO_VALID_PLAN_WITHIN_DATA_BUDGET`. İstek yükü gizlilik gereği silindiği için Kadıköy başlangıcı ve SOC taramasıyla yeniden üretildi (%40'ta aynı hata).

## Kök nedenler
1. `maxStops` = 6 sabitti; %40'tan Erzurum 7–8 durak gerektirir. 858. km'den sonra yalnız doğrudan varış (408 km) deneniyordu.
2. Tohum zincirleri hava projeksiyon bütçesinin ~%90'ını harcıyordu.
3. `improveFixedStopTargets` payını `maxWeatherQueries` (10.000 örnek noktası) − kullanılan projeksiyon (~40.000) olarak hesaplıyordu: uzun rotalarda pay 0, iyileştirme hiç çalışmıyordu (%100 duraklar, %34–62 varış).
4. Yedek koridor rotası ilk rotanın tükenmiş bütçesiyle başlıyordu (0 durum).
5. İyileştirme son durak yerine önceki durağı düşürebiliyor, son durak %80'de kalıyordu; sıkı (0,05) pay ile yeniden sürüş hedefi kaçırıyordu.

## Değişiklikler
`STOP_LIMIT_POLICY`, strateji sırası (rota sınırlı uzak → 6 duraklı uzak → yakın), `IMPROVE_RESERVE_POLICY` (%30), `improveWeatherAllowance`, son durak gereksinim kadar şarj (`seed-charge-trim/1.1.0` 0,05/2/5 pay), yedek rota için `resetSearchBudgets`. Ayrıntı: [STOP_OPTIMIZER.md](../STOP_OPTIMIZER.md).

## Sonuçlar (süreç-içi, yerel Valhalla + Open-Meteo; dk; A/B aynı anda, 1.7.1 davranışı geçici yama ile)
| Durum | 1.7.1 | 1.8.0 |
|---|---|---|
| Kadıköy→Kelkit (sabit kalkış, %100) | 873,3 | 837,1 |
| Fatih→Kelkit (sabit) | 887,3 | 865,6 |
| Batı→Kelkit (sabit) | 910,9 | 907,2 |
| İstanbul→Ankara / İzmir / Erzurum (sabit) | 332,6 / 344,6 / 950,4 | aynı |
| Erzurum şimdi %80 / %60 / %40 | 1.033,2 / 1.038,7 / plan yok | 1.006,6 / 1.011,9 / 1.049,1 |
| Kelkit şimdi %80 / %60 / %40 | 968,2 / 973,6 / plan yok | 902,7 / 880,8 / 916,9 |
| Ankara→Van şimdi %80 | plan yok | 1.062,2 |
| Adana→İstanbul şimdi %80 | 655,7 | 653,1 |
| Ankara→Trabzon şimdi %80 | 602,7 | 603,2 |
| İstanbul→Antalya / Bursa / Edirne, İzmir→Ankara, Kadıköy→Kartal | — | aynı |

Varış SOC'leri hedefte (%20); 1.7.1'de %34–62 vardı. Hesaplama süreleri 1–10 s (makine yükü ve önbelleğe bağlı; hızlanma iddiası yok). 20+ farklı rota ölçütü bu 14 rota/20 durumla kısmen karşılandı; saha kabulü NOT_RUN.

## Testler
`stop-limit-and-reserve.spec.ts` (7) ve `seed-charge-trim.spec.ts` eki önce FAIL sonra PASS. API 1.185 PASS, 154 SKIPPED (DB, `test:db` NOT_RUN). Durum gölgesi: `stop-limit-reserve-shadow-source-2026-11-19.json`.
