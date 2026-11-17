# İki seed stratejisi ve SOC durak kuralı (optimizer 1.5.0) — 2026-11-17

Başlangıç HEAD `5e874d3` (main). Kapsam: kullanıcıyla kararlaştırılan iş sırasının 3. adımı (SOC kuralları) ve öncesinde istenen seed düzeltmesi. Ölçümler süreç içi, yerel Valhalla 8004, sabit kalkış saati; hava 8 saatlik cache penceresinden (ölçülen koşularda MET isteği 0). Pilot profil, rezerv %10, varış %20, en kısa süre amacı. Offline/cache benchmark'tır; saha kabulü değildir.

## Sorun

1.4.0 seed'i tek menzil oranıyla (0,9) uzak sıçramalar yapıyordu. İstanbul→İzmir %95'te bu zincir 90 km sapmalı bir koridora (571 km) kilitlendi; aynı rota %70'te 480,5 km / 376,6 dk planlanabiliyordu (arama kaçırması). Yalnız ikinci strateji (0,6) eklemek bazı rotaları kötüleştirdi (Bursa→Ankara %95 314,4 → 318,5 dk) ve %58 varışla 1,8 dk'lık gereksiz ara şarj üretti.

## Değişiklik

- `seedReachFractions:[.9,.6]`: iki seed zinciri; ikincisi mevcut planı yalnız kesin daha iyi planla değiştirir.
- Her tamamlanmış zincir ayrı ayrı `improveFixedStopTargets` ile iyileştirilir (yalnız kazanan değil).
- `SOC_STOP_RULES` (`soc-stop-rules/1.0.0`): varış SOC'si ≥ %50 iken şarj durağı yok (seed, iyileştirme kabulü, geniş arama).
- Kural yüzünden plan yoksa ve kural bir şarjı engellediyse aynı süre sınırıyla bir kez kuralsız arama; plan `soc_stop_rule_relaxed` uyarısı taşır.
- Yeni durum-gölgesi checkpoint'i `seed-strategies-shadow-source-2026-11-17.json`; eski checkpoint'ler değişmedi.

## Sonuç (km / dk / durak)

| Rota | Başlangıç | 1.4.0 | 1.5.0 |
|---|---:|---|---|
| İstanbul→Ankara | %70 | 458,6 / 408,7 / 4 | 458,5 / 377,6 / 4 |
| Bursa→Ankara | %70 | 386,5 / 325,8 / 2 | aynı |
| İstanbul→İzmir | %70 | 480,5 / 376,6 / 4 | aynı |
| Ankara→Antalya | %70 | 527,9 / 457,5 / 3 | aynı |
| İstanbul→Ankara | %95 | 458,4 / 355,4 / 3 | aynı |
| Bursa→Ankara | %95 | 386,5 / 314,4 / 2 | aynı |
| İstanbul→İzmir | %95 | 571 / 436,1 / 4 | 480,6 / 367,6 / 4 |
| Ankara→Antalya | %95 | 526,7 / 440,3 / 2 | aynı |
| İstanbul→Ankara | %100 | 457,2 / 355,3 / 3 | aynı |
| Bursa→Ankara | %100 | 386,5 / 313,1 / 2 | aynı |
| İstanbul→İzmir | %100 | 571 / 434,8 / 4 | aynı |
| Ankara→Antalya | %100 | 526,7 / 438,3 / 2 | aynı |

12 vakanın hiçbiri kötüleşmedi; tüm duraklarda varış SOC'si < %50; hiçbir planda `soc_stop_rule_relaxed` yok. Sunucu süresi 6,5–9,1 sn (1.4.0 ile aynı bant).

Bilinen açık: İstanbul→İzmir %100'de daha kısa koridor (480,5 km / 368,9 dk) yalnız 99. km'de %58,5 varışla 1,8 dk'lık ara şarjla bulunuyordu; kural bunu yasakladığı için plan 1.4.0 ile aynı kaldı. Optimum iddiası yoktur (`optimality: not_proven`).

## Testler

- `seed-strategies.spec.ts`: iki strateji, uzak strateji tek başına kullanılana göre hiçbir amaçta daha kötü/eksik plan yok.
- `soc-stop-rules.spec.ts`: %50 sınırı; %100 başlangıçta duraklar < %50 ve uyarı yok; tek uygun istasyon %75 varışlıyken plan uyarıyla üretiliyor.
- `pnpm --filter @chargeroad/api typecheck` PASS; `pnpm --filter @chargeroad/api test` 78 suite / 1121 test PASS, 14 suite / 154 test SKIPPED (DB entegrasyonları; TEST_DATABASE_URL yok → NOT_RUN).
