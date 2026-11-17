# E1 — Arama sırasında enerji girdi checksum'ını atlama

2026-11-17 · Başlangıç HEAD `ff0af1aa9479c0ffe4a3c5ec7954d7a3b348c15c`; başlangıçta yalnız `CLAUDE.md` ve `_claude_setup/` untracked idi. **Teknik kabul: PASS. Saha/üretim kabulü değildir.** Algoritma sürümleri (`ENERGY_ALGORITHM_VERSION`, `OPTIMIZER_VERSION`, `CHARGING_ALGORITHM_VERSION`) değişmedi.

## Teşhis

W0 sıcak plan profilinde `optimizer_search` süresinin ~%64'ü `energy_evaluation` aşamasındaydı. Tek bir İstanbul–Ankara planından yakalanan 436 gerçek enerji girdisinden 60'ı çevrimdışı ölçüldü (girdiler yalnız geçici scratchpad'de tutuldu, repoya girmedi). Değerlendirme başına ortalama:

| İş | ms | Pay |
|---|---:|---:|
| Girdi checksum'ı (~1 MB canonical JSON + SHA-256) | ~8 | ~%47 |
| Zod istek doğrulaması | 4,3 | ~%25 |
| Zod sonuç doğrulaması | 1,3 | ~%8 |
| Fizik ve diğer | ~3,4 | ~%20 |

Canonical girdinin ortalama büyüklüğü: hava ~590 KB, rota ~400 KB, araç ~38 KB. Planlama yolunda bu checksum yayımlanan plana (`result`), `validationInput`'a, HTTP yanıtına veya `EvPlanningService` replay kaydına girmez. Yalnız optimizer'ın iç `replay.state` teşhis kopyasında bacak başına yer alıyordu; servis bu alanı kendi `{versions,context,providers}` kaydıyla değiştirir.

## Değişiklik

- `canonicalJsonSha256` (knowledge-package): `sha256(canonicalJson(x))` ile aynı bayt akışını, tokenları bölmeden, büyük string kurmadan üretir. Enerji motoru eager yolda bunu kullanır. Tek başına kazancı küçüktür (gerçek girdilerde ~1,1–1,2×).
- `EnergyConsumptionEngine.evaluate(raw,signal,{inputChecksum:false})`: checksum hesaplanmaz; sonuç tam şema + refinement doğrulamasından geçer ve yalnız `inputChecksumSha256` alanı çıkarılmış hâlde döner (`SearchEnergyEvaluationResult`). İki argümanlı çağrı ve `EnergyService` davranışı aynıdır.
- `PlanningSession` arama değerlendirmelerini bu seçenekle çağırır; `DriveLeg.energy` tipi `SearchEnergyEvaluationResult` oldu.
- Dört doğrulama harness'ında yalnız tip ataması (cast) güncellendi; çalışma zamanı argüman aktarımı aynıdır.

Zod istek/sonuç doğrulaması, bütçeler, rezerv/hedef SOC, kalite etiketleri ve `optimality: not_proven` değişmedi.

## Eşdeğerlik kanıtı

| Kontrol | Sonuç |
|---|---|
| `canonicalJsonSha256` = `sha256(canonicalJson)`: kenar değerler, unicode/surrogate, `undefined`/fonksiyon/symbol/boş dizi elemanı, 64 KB sınırını aşan yapılar, 500 deterministik rastgele yapı, BigInt hata davranışı | PASS |
| 60 gerçek planlama girdisinde eski/yeni checksum | 0 fark |
| Enerji motoru: dört girdi varyantında (farklı durumlar dahil) search sonucu = eager sonuç − checksum (`toStrictEqual`) | PASS |
| Optimizer: üç amaç + state bütçesi 2, aynı sabit saat; `result`, `validationInput`, `search` birebir aynı; tek fark `replay/state/legs/*/energy/inputChecksumSha256` yokluğu; motor her çağrıda seçeneği aldı | PASS (4 senaryo) |
| Gerçek plan A/B (aşağıda): plan parmak izi (varış SOC, durak/istasyon/hedef, mesafe) yedi koşuda aynı | PASS |

## Performans — gerçek rota, süreç içi A/B

İstanbul–Ankara, sabit kalkış, aynı süreç, ısınma koşusundan sonra ABAB×3; A = motor seçeneği yok sayar (eski davranış), B = E1. Isınma koşusu MET'e 24, yerel Valhalla'ya 51 istek yaptı; ölçülen altı koşuda dış istek 0.

| Kol | Plan süresi (ms) | Medyan | `energy_evaluation` toplamı (ms) | Medyan | Değerlendirme |
|---|---|---:|---|---:|---:|
| A | 15336 / 11949 / 14718 | 14718 | 9505 / 6831 / 9051 | 9051 | 439 |
| B | 10200 / 7586 / 11573 | 10200 | 4716 / 3469 / 5491 | 4716 | 439 |

Medyan plan süresi ~%31, enerji aşaması ~%48 kısaldı. n=3/kol, tek rota, aynı makinede çalışan API ile; p95/SLA çıkarılmaz. İki kol da `canonicalJsonSha256` içerdiğinden eski HEAD'e göre fark biraz daha büyüktür; bu ayrıca ölçülmedi.

## Testler

| Komut | Sonuç |
|---|---|
| `pnpm --filter @chargeroad/api typecheck` | PASS |
| Yeni testler (canonical-hash, energy-checksum, search-energy-checksum) | PASS 11/11 |
| `pnpm --filter @chargeroad/api test` (ikinci koşu) | 1063 PASS, 154 SKIPPED (DB yok), **4 FAIL**: `latency-polling.spec.ts`, E1'den bağımsız; `ff0af1a`'da mobil istemciye eklenen `__DEV__` Jest'te tanımsız |
| İlk tam koşu | Ek olarak `optimizer.spec.ts` 1 FAIL; tek başına 21/21 ve ikinci tam koşuda PASS (CR-LAT-002R'de kayıtlı yük altı 5 sn sınırı) |
| `pnpm --filter @chargeroad/api test:db` | NOT_RUN — izole `TEST_DATABASE_URL` yok |
| Mobil/shared testleri | NOT_RUN — dokunulmadı |

## Açıklar ve geri dönüş

- Zod istek doğrulaması (~%25) bu adımda azaltılmadı.
- Optimizer'ın iç `replay.state` kopyası artık bacak enerji checksum'ı taşımıyor; bu alanı okuyan üretim kodu yok. Bu alanı içeren eski tarihli doğrulama hash'leriyle yeni ham optimizer çıktısı NOT_COMPARABLE'dır; eski kanıt dosyaları değiştirilmedi.
- Geri dönüş: `planning-session.ts` içindeki `{inputChecksum:false}` argümanını kaldırmak eski davranışı geri getirir.
