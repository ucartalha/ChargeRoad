# CR-PERF-002 — Stabil frontier kuyruğu

Tarih: 2026-11-13. Kapsam yalnız Görev 2; Görev 3 uygulanmadı.

## Başlangıç

HEAD `c24cab249dc3cbebb29f11104fee95c04ca8d7fd`. Ağaç temiz değildi: önceki Görev 1 kodu, testleri, benchmark'ları ve belgeleri commit edilmeden duruyordu; tümü korundu. Başlangıç `test:db`: **56 suite / 646 test PASS**, skip 0, 65.829 s. Görev 1'in [GO kanıtı](perf-baseline-2026-11-13.md), TASKS, V1 backlog, görev talimatları ve ADR-009/011/012 incelendi.

Üretim optimizer değişmeden önce 30 kabul senaryosu, 15 bağımsız referans çıktısı ve üç amaç için 100'er tam plan örneği [before artefaktına](frontier-queue-before.json) kaydedildi. Bu dosya historical kanıttır; güncel kodla yeniden yazılmasına script izin vermez.

## Değişiklik ve sıralama sözleşmesi

Yeni `StablePriorityQueue<T>` yerel, kapasitesi sınırlı bir min binary heap'tir. Push/pop O(log n), length O(1), bellek O(frontier). Yeni npm bağımlılığı yoktur. Üretim değişikliği `stable-priority-queue.ts` ve optimizer'da import, başlangıç kuyruğu, pop satırlarıyla sınırlıdır; Görev 1'in metrik çağrıları korunur.

`compareStates` değişmedi:

- Süre: seconds → stops.length → distance → visited.join('|').
- Az durak: stops.length → seconds → distance → visited.join('|').
- Enerji: 1e-8 kWh çözünürlüğünde netKwh → seconds → stops.length → distance → visited.join('|').

Bu anahtarların hepsi eşitse monoton insertion sequence FIFO sırasını korur. Eski stabil Array.sort aynı öncelikli eski elemanları yeni eklenenlerden önce tutuyordu; heap bu davranışı açıkça uygular. Öncelik alanları kuyruktayken değiştirilmez; optimizer zaten yeni state nesneleri üretiyor. Queue state veya visited dizisini değiştirmez.

`maxFrontier` kontrolü eski yerde, push öncesinde aynıdır; dolu kuyruk aday atmaz veya incumbent ile değiştirmez. Ek queue kapasite koruması da sınır dışı push'ı reddeder; normal optimizer yolu önce mevcut `FRONTIER_BUDGET` kontrolünden geçer. Tek initial eleman kapasiteye dahildir. maxStates/maxTransitions/deadline, yield sıklığı, iptal, seed/incumbent, durak sırası, metadata/reason kodları ve public DTO aynı kaldı. Algoritma/politika sürümü değiştirilmedi; arama semantiği eşdeğer bir veri yapısı değişikliğidir.

## Davranış kanıtı

Her üç objective için complete, duplicate-route/equal-priority, frontier/state/transition/road/weather limit, deterministik deadline, işlem öncesi ve işlem içi iptal: **30 senaryo**. Eski sonucu, validation input'u ve replay'i içeren outcome hash'i; drive/charge çağrılarının tam sıralama hash'i ve search metadata'sı karşılaştırılır. Yalnız zaten değişken olan `elapsedMilliseconds` hariçtir. Date sabitlenir; timeout/event loop/monotonic saatler gerçek kalır. Deadline testinde optimizer'a mevcut constructor üzerinden deterministik clock verilir. Ağ çağrısı testte yasaktır.

Tüm 30 before/after kayıt aynıdır. Normal ve eşit öncelik senaryoları planned/frontier_exhausted; frontier/state/transition limitleri mevcut reason'ları; yol/hava limitleri data_budget; deadline mevcut deadline sonucunu; iptaller exception davranışını korur. Mevcut optimizer testleri, bütçe dolarken doğrulanmış incumbent'in limited etiketiyle dönmesini ayrıca sınar.

Bağımsız 15 reference fixture mevcut solver'ıyla tekrar çalıştırıldı; golden veya solver değiştirilmedi. Bunlar üretim optimizer'ıyla birebir aynı graph modeli olduğu iddiası değildir; mevcut bağımsız regresyon katmanıdır. Üretim eşdeğerliği ayrıca yukarıdaki 30 senaryoyla ölçülür.

Reference snapshot SHA-256: `5b44b4b31b9cd55e35340e6c9fe97d54797d342045eef0d56faf0e6f882a502f`; 15 sonuç hash'i iki koşuda `15af172e9d5bfc6da73e9e8408958e9f2bff1ed3a63e737b91be47af228cc4f3`.

Queue unit testleri: boş/tek eleman/yeniden kullanım, geçersiz kapasite, dolulukta veri koruma, araya daha yüksek öncelik girerken FIFO, NaN comparison'ın stable eşitlik anlamı, üç objective × üç seed × 6000 karışık push/pop. Kimlik düzeyinde her pop eski sort+shift sonucu ile aynıdır. Enerji örnekleri negatif/pozitif ve aynı yuvarlama aralığında eşit değerler içerir. 4096 elemanlık ters ekleme/drain testi comparator çağrı sayısını O(n log n) sınırı altında doğrular; kırılgan süre assert'i yoktur.

## Tam plan benchmark'ı

Ortam: Windows 10.0.26200 x64, i7-12700H (20 logical CPU), 16.87 GB RAM, Node v26.13.0; aynı HEAD + belgelenmiş dirty diff. Mevcut optimizerWorld(false), gerçek enerji/şarj motorları, synthetic in-memory provider'lar, PG/HTTP yok. Date `2026-11-13T09:00Z` sabit, performance.now gerçek. Her objective 100 ölçüm + 5 warmup, concurrency 1, metrik kapalı. Latency yalnız service.plan; fixture kurulum/hash dışında. CPU bütün grup + kurulum/hash/warmup kapsamındadır. Heap process heapUsed değerinin iterasyon sonlarında örneklenmesidir; saf kuyruk allocation veya OS peak değildir. GC zorlanmaz, gruplar ardışık aynı process'tedir.

| Amaç | Sürüm | p50 ms | p95 ms | p99 ms | Grup CPU user+system ms | Örneklenen heap peak MB |
|---|---|---:|---:|---:|---:|---:|
| Süre | Sort before | 44.819 | 77.727 | 89.950 | 5890 | 536.4 |
| Süre | Heap after | 48.740 | 76.794 | 77.904 | 6125 | 530.9 |
| Az durak | Sort before | 36.262 | 43.795 | 48.848 | 4266 | 658.9 |
| Az durak | Heap after | 51.677 | 86.809 | 95.723 | 6312 | 653.2 |
| Enerji | Sort before | 34.722 | 38.571 | 40.987 | 3984 | 777.3 |
| Enerji | Heap after | 50.635 | 87.361 | 97.917 | 6969 | 685.7 |

**Karışık sonuç:** süre modunun p95/p99'u düşerken median/CPU yükseldi; diğer iki amaçta tam plan ölçümü daha yavaştı. Küçük frontier'li bu fixture'da tüm planın hızlandığı veya bellek allocation'ının azaldığı kanıtlanmadı. Ayrı process koşuları paylaşılan makine/JIT/GC etkilerini ayırmaz; farkları kesin heap overhead'i ya da kesin ortam gürültüsü olarak etiketlemiyoruz. Ham değerler gizlenmeden raporlanır. Buradan üretim SLA'sı veya genel hızlanma yüzdesi çıkarılmaz.

Üç tam outcome hash'i (before=after):

| Amaç | SHA-256 |
|---|---|
| Süre | `6d2abdac030eb1904a80bab4943fa9b46e0ae2fd8da6460fc14f70fd5e41a52b` |
| Az durak | `ab19a6ca832af911ed0e1e721b4bcc771b3a99681764fe5f04e0705e405fea1b` |
| Enerji | `a5629da9e7defdc7b156d9fa43e09a9705ee71b6015f9a913197019fc484d330` |

Artefaktlar: [before](frontier-queue-before.json), [after](frontier-queue-after.json). Kaynak optimizer raw-file SHA-256 before `a8890cffb588194d2367b36edb72803424f415442261df3375dc7497ea234454`, after `3ee1a97d67b174fcf21862f001ed638a05d5449a44f9732d39a4a45a78b3cee7`; queue `98245aa81e87e169328eff96c6a2a10e7d76b5524d04ecd880ec5b5a8c44f200`. Fixture/outcome/trace checksum'ları JSON SHA-256 olup yalnız elapsedMilliseconds dışlanır; kullanıcı payload'ı saklanmaz.

## Ayrı frontier yükü

[Structure benchmark](frontier-queue-structure.json) aynı process'te sort+shift ve heap'i dönüşümlü sırayla ölçer. Seed 20261113; capacity 64 ve 2048; her üç objective; 30 örnek + 3 warmup; ekleme, pop ve araya yeni state ekleme iş yükü. Her tek koşuda tüm pop kimlik sırası checksum'ı aynıdır. Bu workload ve sonuç hash'leri artefaktta bulunur. p99 için n=30 olduğundan nearest-rank sonucu en büyük örnektir; genel p99 garantisi değildir.

2048 kapasiteli karışık yük, bir ölçümde 2560 push + 2560 pop içerir:

| Amaç | Sort p95 / p99 ms | Heap p95 / p99 ms | Sort / heap CPU toplam ms | Sort / heap comparator çağrısı |
|---|---|---|---|---|
| Süre | 296.493 / 300.468 | 3.541 / 4.093 | 8455 / 77 | 2774754 / 51378 |
| Az durak | 348.207 / 364.509 | 3.620 / 3.725 | 8799 / 139 | 2775069 / 51333 |
| Enerji | 323.720 / 344.424 | 3.506 / 3.825 | 9078 / 79 | 2776011 / 51292 |

Bu büyük frontier iş yükünde heap daha hızlı ve daha az karşılaştırma yapıyor. 64 kapasiteli örnekte de heap p95'i daha düşük (süre 0.405→0.070, az durak 0.653→0.054, enerji 0.278→0.059 ms). Küçük ölçümlerde process CPU sonucu 0 ms çıkabilir; Windows CPU ölçüm çözünürlüğü nedeniyle bu sıfır hesap maliyeti anlamına gelmez. Yapı benchmark'ı saf kuyruk avantajını gösterir; yukarıdaki tam plan regresyon ölçümlerinin yerine geçmez.

Comparator çağrıları, p50/p95/p99, CPU ve örneklenen process heap aralıkları ayrı ayrı artefakta kaydedilir. CPU yalnız kuyruk iş döngüsü kapsamındadır; workload kurulum/hash dışarıda. Örneklenen process heap aralıkları iki uygulamanın allocation'larını izole etmez; GC ve sıra etkisi vardır. Bu ölçüm büyük frontier darboğazını izole eder, kullanıcıya görünen rota süresinin garantisi değildir.

## Doğrulama ve çalıştırma

```powershell
pnpm --filter @chargeroad/api exec ts-node scripts/benchmark-frontier-queue.ts --phase=after
pnpm --filter @chargeroad/api exec ts-node scripts/benchmark-frontier-structure.ts
pnpm --filter @chargeroad/api test:db
pnpm -r typecheck
pnpm --filter @chargeroad/shared test
pnpm --filter @chargeroad/mobile test
pnpm --filter @chargeroad/api build
```

`--phase=before` yalnız değiştirilmemiş optimizer başlangıcında bir kez çalıştırıldı; mevcut historical artefaktını korur. After, before validation/reference/outcome checksum'larını karşılaştırır ve fark varsa nonzero exit verir. Aynı fixture, sabit tarih ve aynı sample sayısı korunmalıdır. Test fixture/golden değiştirerek PASS üretilmedi. Yeni scriptlerin ilk çalıştırılmasındaki TypeScript mock/boş dizi tür sorunları ve Windows shell'in pipe regex aktarımı düzeltildi; bunlar planlama davranış hatası değildi.

| Kontrol | Sonuç |
|---|---|
| Başlangıç `pnpm --filter @chargeroad/api test:db` | PASS: 56 suite / 646 test, skip 0 |
| Son `pnpm --filter @chargeroad/api test:db` | PASS: 58 suite / 689 test, skip 0, 82.591 s; unit + izole gerçek PG entegrasyonları |
| `pnpm -r typecheck` | PASS: API, shared, mobile |
| `pnpm --filter @chargeroad/api build` | PASS |
| `pnpm --filter @chargeroad/shared test` | PASS: 41 test, skip 0 |
| `pnpm --filter @chargeroad/mobile test` | PASS: 21 test, skip 0 |
| Before/after 30 senaryo ve 15 referans | PASS: sonuç/trace/search/reference checksum eşit |
| Üç amaçta tam plan benchmark | PASS: 100'er sonuç deterministik ve aynı; performans karışık, yukarıda raporlandı |
| Structure benchmark | PASS: 6 grup × 30 ölçüm, her sort/heap pop sırası aynı |
| Kaynak/checksum kanıtı ve `git diff --check` | PASS |
| Gerçek provider benchmark/yük testi | NOT_RUN: görev offline veri yapısı değişikliğidir; public servis kotası kullanılmadı |
| Mobil export/cihaz/GPS saha kabulü | NOT_RUN: mobil kod değişmedi; bu görev cihaz kabulü değildir |

Görev 2'de eklenen/değişen dosyalar (önceki Görev 1 diff'inden ayrı):

- `apps/api/src/planning/stable-priority-queue.ts`, `charge-stop-optimizer.ts`: kuyruk ve dar entegrasyon.
- `apps/api/src/planning/__tests__/{stable-priority-queue,frontier-equivalence}.spec.ts`: sınır/semantik/regresyon testleri.
- `apps/api/src/planning/validation/frontier-scenarios.ts`: synthetic kabul senaryoları; üretim çağrı yoluna eklenmedi.
- `apps/api/scripts/benchmark-frontier-{queue,structure}.ts`: offline karşılaştırma komutları.
- `docs/validation/frontier-queue-{before,after,structure}.json` ve bu rapor: tarihsel/güncel ölçüm kanıtı.
- Görev 2 durum dosyası, `docs/TASKS.md`, `docs/README.md`: teslim indeksleri.

## Güvenlik, kapsam ve geri dönüş

Yeni dependency, migration, endpoint, DTO/policy sürüm değişikliği veya provider isteği yok. Mevcut source/license/quality/unknown, reserve/arrival hedefleri, conditional ETA ve optimality:not_proven anlamları korunur. Benchmark'lar offline ve synthetic; raw state, SOC, koordinat, GPS, token veya kullanıcı kimliği log/artefakta yazılmaz; yalnız hash, aggregate süre/sayaç ve metadata kullanılır. Mevcut süreçler/.env/Docker/cache/bütçe tabloları değiştirilmedi. V1 backlog, gerçek yol/DEM lisansı ve saha kabulü açık kalır.

Bu veri yapısı için ayrı runtime flag eklenmedi. Geri dönüş yalnız queue import/başlangıç/pop satırlarını eski array/sort/shift'e döndürüp yeni queue kullanımını kaldırmaktır; Görev 1 metrikleri ve diğer çalışma dosyaları korunmalıdır. Ortak uncommitted ağaca reset/clean uygulanmaz. Önceki baseline, test ve yeni queue dosyaları teşhis için korunabilir; DB dönüşü gerekmez.

Üretimdeki uzun rota performansı, cihaz kabulü, fiziksel doğruluk veya V1 yayını bu görevle onaylanmaz. İlerideki optimizasyonlar daha geniş gerçekçi fixture ve aynı koşullarda tekrar ölçülmelidir.

**Karar: Görev 2 teknik kapsamı DONE; Görev 3 önkoşulu için GO.** Sıralama/sonuç/bütçe eşdeğerliği korunmuş, büyük frontier için karşılaştırma yükü azalmıştır. Bu GO, küçük tam plan örneklerinin hızlandığına veya bir performans SLA'sının geçtiğine dair kabul değildir; o ölçümlerdeki yavaş sonuçlar açıkça kalır. Görev 3 kodu uygulanmadı.
