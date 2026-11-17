# Enerji için 300 m yükseklik penceresi (chargeroad-energy 1.4.0) — 2026-11-18

Başlangıç HEAD `d487b16` (main; 4. adım değişiklikleri commit edilmemiş çalışma ağacında). Tetikleyici: kullanıcının İstanbul→İzmir planında 1. ve 2. durak arasındaki 81 km'lik bacakta (%45 → %8) tüketimi gerçekçi bulmaması. Ölçümler süreç içi, yerel Valhalla 8004, pilot profil (Hyundai IONIQ 6 2023 Standard Range, mühendislik tahmini). Offline/cache ölçümü; saha kabulü değildir.

## Teşhis

| Bulgu | Ölçüm |
|---|---|
| Kullanıcı planında bacak tüketimi | 1–2 arası 0,456 %/km; ilk bacak 0,443, sonraki 0,632 — bacağa özgü hata yok |
| Kullanıcı planındaki şüpheli >%20 ham eğim | rota 237, 1–2 bacağı 26; en büyük %45,3 |
| 1–2 bacağı toplam tırmanış | 30 m: 1.610 m · 300 m: ~856 m (500 m) · 1 km: 634 m |
| Köprü/tünel hipotezi (Valhalla `edge.bridge/tunnel`, 3 güzergâh, 410 km) | 152 şüpheli eğimin 0'ı köprü/tünel içinde, 7'si 60 m yakınında → çürüdü |
| Gürültü biçimi (102 km örnek, net +82 m) | tek nokta sıçraması değil; tırmanış 30 m 2.368 · 300 m 1.416 · 1 km 961 m |

Sonuç: DEM zemini örnekliyor (yarma/dolgu); enerji motoru 30 m'lik her düğümü entegre ettiği için sahte çık-in döngüleri rejenerasyon kaybı kadar enerji ekliyor.

## Değişiklik

- `apps/api/src/energy/elevation-window.ts`: `modelled` kesimlerde her düğüm, rota boyunca ortalanmış 300 m penceredeki ortalama kot (trapez integrali). Pencere rota uçlarında simetrik daralır; uç kotları korunur. `verified` arazi değişmez.
- `energy-engine.ts`: yalnız fiziksel entegrasyon (`integratePieces`, `elevationAt`) pencereli profili kullanır; ham kesim tüm veri/kalite/hava kapılarında kalır. Varsayım kodu `modelled_elevation_distance_window_300m`.
- `ENERGY_ALGORITHM_VERSION` 1.3.3 → 1.4.0; `ENERGY_POLICY.elevationWindowMeters=300`.
- ADR-009 §17 ek karar notu; `docs/ENERGY_ENGINE.md`.

## Ölçüm (aynı hava, kalkış ≈ şimdi + 10 dk, başlangıç %95, rezerv %10, varış %20)

Önce/sonra aynı süreçte `ENERGY_POLICY.elevationWindowMeters` 0 / 300 ile koşuldu.

| Ölçüm | Pencere 0 (≈ 1.3.3) | Pencere 300 (1.4.0) |
|---|---|---|
| İstanbul→Ankara direkt, tam batarya menzili | 211,7 km (21,32 kWh/100 km) | 226,4 km (19,93 kWh/100 km) |
| İstanbul→Ankara plan | 458,4 km / 355,6 dk / 3 durak | 458,5 km / 352,3 dk / 3 durak |
| İstanbul→İzmir plan | 480,6 km / 368,2 dk / 4 durak | 480,6 km / 363,6 dk / 4 durak |
| Ankara→Antalya plan | 526,7 km / 440,3 dk / 2 durak | 526,7 km / 435,1 dk / 2 durak |
| Kadıköy→Sarıyer varış SOC | %84,0 | %85,8 |
| Bursa→Ankara | `NO_VALID_PLAN_WITHIN_DATA_BUDGET` | aynı |

Önceki ölçümde (scratch, ortalama pencere) İstanbul→İzmir tam batarya menzili ham 213,8 km, 300 m 226,3 km, 1 km 232,6 km idi.

Bursa→Ankara iki koşulda da hava projeksiyon bütçesi tükendiği için plan üretmedi (29.707 / 30.000; önceki sabit kalkış saatinde 29.717 ile planlanıyordu). Arama kaynağı 1.5.0 ile aynı ve sonuç pencereden bağımsız; ayrı iş olarak açık.

Saha referansı (kayıtlı sahip raporları, bağımsız ölçüm değil): İstanbul–Ankara 410 km ortalama 16,5 kWh/100 km; 130 km/s ılık havada 17–20 kWh/100 km. Model 1.4.0 ile hâlâ bunların üstünde; araç profili saha kalibrasyonlu değildir.

## Testler

- `src/energy/__tests__/elevation-window.spec.ts` (5): pencere 300; 30 m zikzak tırmanışı %80'den fazla düşer, uçlar korunur; sabit eğim değişmez ve kesim sınırında süreklilik; `verified`/pencere 0 dokunulmaz; gürültülü `modelled` profil düz yola yakın enerji, `verified` gürültü değil.
- Analitik enerji vakaları (scratch, dosya yazmadan): 4/4, hata 0. `energy:validate` mevcut `task11-energy-validation.json` dosyasının üzerine yazdığı için koşulmadı (NOT_RUN).
- `pnpm --filter @chargeroad/api test`: 80 suite / 1129 test PASS, 14 suite / 154 test SKIPPED (DB; TEST_DATABASE_URL yok → NOT_RUN).
