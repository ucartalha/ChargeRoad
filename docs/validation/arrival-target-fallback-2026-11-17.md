# Rezerv/varış sınırları ve varış hedefi yedeği (optimizer 1.6.0) — 2026-11-17

Başlangıç HEAD `d487b16` (main). Kapsam: kullanıcıyla kararlaştırılan iş sırasının 4. adımı. Kullanıcı kararları: rezerv en fazla %25 ve varış hedefi en fazla %80, ikisi de **mobil** sınır (API sessizce kırpmaz); %80 (veya istenen) hedefle plan yoksa ulaşılabilen en yüksek hedefle plan kurulur ve kullanıcıya söylenir.

## Değişiklik

- `@chargeroad/shared` `planningEvaluationSchema`: plan hedefi istenenden düşük olabilir, yalnız `arrival_target_lowered` uyarısıyla; yükseltme veya rezerv değişikliği hâlâ reddedilir. Şema alanı eklenmedi; eski istemciler etkilenmez.
- API `EvPlanningService`: istenen hedefte plan yoksa ve `PlanningSession.arrivalTargetMissed` (varışa rezervin üstünde ulaşan ama hedefin altında kalan tam bacak) görüldüyse `arrivalTargetSteps` ile 5'er puan düşerek yeniden planlar. Sağlayıcı hatasında denenmez. Hiçbir hedefte plan yoksa ilk (istenen hedefin) hata sonucu döner.
- `OPTIMIZER_VERSION` 1.6.0; arama kaynağı 1.5.0 ile aynı (state-shadow hash `4c9fd384…`), yeni checkpoint `arrival-target-fallback-shadow-source-2026-11-17.json`.
- Mobil: rezerv slider'ı 0–25, varış slider'ı 0–80; form doğrulaması aynı sınırları uygular; plan özetinde `arrival_target_lowered` ve `soc_stop_rule_relaxed` için Türkçe uyarı (`planNotices`). Form değerleri kalıcı saklanmadığı için eski değer taşıma gerekmedi.

## Ölçüm (yerel Valhalla 8004, başlangıç %95, rezerv %10, en kısa süre)

| Rota | Varış %20 (km / dk / durak) | Varış %80 (km / dk / durak) | %80'de hedef düşürüldü mü |
|---|---|---|---|
| İstanbul→Ankara | 458,4 / 355,5 / 3 | 458,4 / 385,4 / 3 | hayır (varış %80,1) |
| Bursa→Ankara | 386,5 / 314,8 / 2 | 386,5 / 345,0 / 2 | hayır |
| İstanbul→İzmir | 480,6 / 367,6 / 4 | 480,6 / 397,4 / 4 | hayır |
| Ankara→Antalya | 526,7 / 440,3 / 2 | 526,7 / 470,7 / 3 | hayır |
| Kadıköy→Sarıyer | 27,6 / 55,1 / 0 | aynı | hayır (şarjsız, varış %83,9) |

Varış %20 satırlarında İstanbul→Ankara (355,4 → 355,5) ve Bursa→Ankara (314,4 → 314,8) 1.5.0 ölçümünden farklı: bu iki koşuda hava cache'i süresi dolmuştu ve MET'e 58 ve 46 istek gitti (geçiş sayıları aynı). Fark hava verisinden gelir, algoritmadan değil.

Referans rotaların hiçbirinde %80 hedef ulaşılamaz değildi; **yedek gerçek rotada tetiklenmedi, NOT_RUN**. Yedek yalnız sentetik dünyada doğrulandı (son istasyondan varışa en fazla %62,5 → istenen 80, plan hedefi 60).

## Testler

- `arrival-target-fallback.spec.ts`: adım dizisi; ulaşılamayan %80 hedefi 60'a düşer, uyarı istenen değeri içerir, değerlendirme orijinal isteğe göre geçer ve uyarı silinince reddeder; ulaşılabilen hedef değişmez.
- `packages/shared/tests/contracts.test.mjs`: uyarısız düşürme reddedilir, uyarılı düşürme kabul, yükseltme reddedilir.
- `apps/mobile/tests/planning-flow.test.cjs`: %25 / %80 sınırları, `planNotices` metinleri.
- `pnpm --filter @chargeroad/shared typecheck` + `test` PASS (42/42).
- `pnpm --filter @chargeroad/api typecheck` PASS; `test` 79 suite / 1124 test PASS, 14 suite / 154 test SKIPPED (DB; TEST_DATABASE_URL yok → NOT_RUN).
- `pnpm --filter @chargeroad/mobile typecheck` PASS; `test` 82/82 PASS (saf TS modülleri, cihaz kabulü değildir). `mobile build` ve cihazda görsel kontrol NOT_RUN.
