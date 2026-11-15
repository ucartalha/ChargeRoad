# CR-PERF-002 — Ek performans kabul kapısı

**Karar: NO-GO — kalıcı hızlandırma kabulü verilmedi. Algoritmik eşdeğerlik PASS.**

Çalışma tarihi **2026-11-15**; dosya adı kullanıcı talebiyle 2026-11-13 olarak korundu. Yalnız ek benchmark/validation uygulandı. Production optimizer, kuyruk, motorlar, provider, DTO/Zod, migration, algoritma sürümü ve public API değiştirilmedi. CR-PERF-003'e başlanmadı. Önceki teknik teslim belgeleri tarihsel kayıt olarak korundu; bu rapor onların ötesinde bir performans kabulü vermez.

## Başlangıç ve kanıtların korunması

HEAD: `c24cab249dc3cbebb29f11104fee95c04ca8d7fd`. Çalışma ağacında Görev 1/2'nin commit edilmemiş tracked/untracked değişiklikleri vardı. Git status, mevcut optimizer/queue, benchmark scriptleri, üç eski frontier JSON artefaktı ve önceki rapor incelendi. Reset/clean/stash/checkout/force yapılmadı.

Başlangıçta hash'i alınan **480 mevcut dosyanın tamamı aynı kaldı**. [Koruma kanıtı](frontier-queue-gate-2026-11-13/preservation.json) başlangıç/son aggregate hash'lerini, production kaynaklarını ve eski artefakt hash'lerini içerir. Özellikle tarihsel `frontier-queue-before.json` SHA-256 değeri değişmedi: `87f6d7332a7745bb88ab44cf76526d06e30d0d0998a981e27947b96239281683`. Eski after/structure JSON'ları, golden/reference fixture'lar ve Görev 1 diff'leri de korundu.

## Aynı algoritma, değiştirilebilir benchmark kuyruğu

`frontier-performance-harness.ts`, diskteki gerçek `charge-stop-optimizer.ts` kaynağını mevcut TypeScript bağımlılığıyla **bellekte** derler. Ayrı bir solver kopyası yoktur. Yalnız tam adı `./stable-priority-queue` olan import için benchmark bağımlılığı verilir; diğer import'lar orijinal dizinden çözülür. Kaynak/module cache dosyaları patch edilmez. Beklenen import bulunamazsa düzenek fail eder.

- A: aynı push/length/pop arayüzü içinde eski stabil `Array.sort(compareStates) + shift()`.
- B: değişmemiş production `StablePriorityQueue`, aynı gözlem wrapper'ı içinde.
- Native anchor: bellek derlemesini kullanmayan **gerçek production `ChargeStopOptimizer`**. Her profil/objective hücresi önce buna karşı doğrulanır.

İki strateji aynı `EvPlanningService`, `PlanningSession`, gerçek enerji ve şarj motorları ile çalışır. Yalnız provider'lar deterministic in-memory synthetic fixture'lardır. Ağ erişimi benchmark sürecinde yasaktır. Yeni npm bağımlılığı veya production test seam'i eklenmedi.

Bu düzenek aynı algoritmanın karşılaştırmasıdır; eski inline array kodunun ve canlı deployment'ın tam maliyet kopyası değildir. Wrapper, sayaçlar, queue timer'ları, pop/transition hash hesapları iki tarafta da vardır. Native anchor semantik doğruluk kaynağıdır; performans numarası olarak kullanılmaz.

## Deney düzeni ve kapsam

Üç **ayrı Node process**, ardışık çalıştırıldı; concurrency=1. Her hücrede native anchor ve dört metrik modu kontrolünden sonra strateji başına 3 warmup, ardından **12 blok** çalıştı. Blok sırası process/blok parity'sine göre dönüşümlü **A-B-B-A / B-A-A-B**; her blokta iki A ve iki B bulunur. Süreç başına strateji/hücre başına 24, üç süreçte **72** ölçüm vardır.

Toplam: 9 profil/objective hücresi × 3 process × 48 = **1.296 ölçülen tam plan**; ayrıca **27 native anchor**, **108 metrik açık/kapalı eşdeğerlik kontrolü** ve **162 warmup planı**. Metrik açık kontroller in-memory sink kullanır. Zaman dağılımları metrik kapalı koşuldadır; logger I/O veya metrik açmanın overhead'i için kabul verilmez. Ön kalibrasyon `probe.json`, warmup/ölçüm sayısı sıfır olan ayrı bir kayıt olup performans tablosuna katılmaz.

Fixture Date tüm process'lerde `2026-11-13T09:00Z` olarak dondurulur; monotonic timer, AbortSignal zamanlayıcıları ve CPU saatleri gerçektir. RNG kullanılmaz; profil, alternatifler ve rota geometrisi sabit formüllerle üretilir. Model/engine/fixture/harness kaynak hash'leri süreçler arasında aynı ve ölçüm sonunda diskteki içerikle eşleşir. Küçük profil ayrıca önceki tarihsel tam plan outcome hash'lerine eşleşir.

| Profil | Gerçek frontier peak | Push / pop | Plan kapsamı |
|---|---:|---:|---|
| Küçük `<64` | 8 | 10 / 10 | Önceki iki istasyonlu fixture; frontier_exhausted |
| Orta `64–256` | 77 | 79 / 2 | 4 synthetic istasyon, 3 yol alternatifi; maxStates=2 |
| Büyük `>256` | 455 | 457 / 2 | 8 synthetic istasyon, 6 yol alternatifi; maxStates=2 |

Orta/büyük profiller gerçek motorlarla **doğrulanmış planned incumbent** döndürür, fakat arama `state_budget` ile sınırlıdır; optimality iddiası yoktur. Bunlar kuyruk tamamen boşalana kadar arama senaryosu değildir. Kuyruğa eklenip hiç çıkarılmayan state'ler özellikle korunur; bu, budget dolduğunda heap'in maliyetini gözlemlemeyi sağlar. Bu fixture'lar saha/geografik doğruluk testi değildir.

## Semantik kapı

Her koşuda normalize edilmiş **tam outcome** (plan, validation input, replay, search metadata dahil) bellekte `isDeepStrictEqual` ile karşılaştırılır. Yalnız doğal değişken `elapsedMilliseconds` alanları dışlanır. Tüm drive/charge çağrıları tam state/parametreleriyle sırayla hash'lenir. Queue pop sırası hash'i, peak/push/pop sayıları da A/B arasında eşit olmalıdır. Hassas içerik bellekte hash'lenir; raw outcome/trace artefakta veya loga yazılmaz.

Sonuç: **bütün ölçümler, warmup'lar ve açık/kapalı metrik kontrolleri eşleşti**. Üç process'in fixture/output/trace hash'leri aynı; bütün blokların sırası dengeli. Küçük profil, eski `frontier-queue-before.json` üç objective outcome hash'iyle de eşleşti. Mevcut 15 bağımsız reference fixture her process'te kendi solver'ıyla geçti; snapshot/sonuç hash'leri tarihsel kanıtla aynı. Golden/reference dosyaları değiştirilmedi.

Eşitsizlik olsaydı worker/summary nonzero çıkacak, ölçüm kabulü verilmeyecekti. Yeni testler yanlış trace, pop sırası, search metadata ve eksik import seam'inde bu fail davranışını da doğrular.

## Tam plan wall time — önce/sonra

A=sort+shift, B=heap. Her hücre/strateji n=72; değerler ms. Süre yalnız plan çağrısı kapsamındadır; fixture kurulumu ve son outcome normalizasyon/hash karşılaştırması dışarıdadır. Çağrı/pop trace hash'leri ve queue gözlemleri planın içinde olduğundan dahildir. Bu nedenle önceki rapordaki 43.795/86.809 ms gibi **daha az gözlem içeren** koşularla mutlak süreler doğrudan kıyaslanmamalıdır.

| Profil / amaç | A p50 | B p50 | A p95 | B p95 | A p99 | B p99 |
|---|---:|---:|---:|---:|---:|---:|
| Küçük / süre | 77.062 | 75.413 | 107.944 | 110.217 | 122.478 | 136.754 |
| Küçük / az durak | 91.464 | 91.215 | 118.349 | 119.552 | 130.773 | 143.380 |
| Küçük / enerji | 77.449 | 79.738 | 112.175 | 111.205 | 142.977 | 137.646 |
| Orta / süre | 81.817 | 76.461 | 122.096 | 115.272 | 148.944 | 194.535 |
| Orta / az durak | 85.535 | 84.329 | 127.471 | 119.836 | 189.098 | 128.412 |
| Orta / enerji | 80.617 | 86.215 | 114.833 | 118.627 | 151.269 | 139.994 |
| Büyük / süre | 367.379 | 377.030 | 511.239 | 478.910 | 550.519 | 540.663 |
| Büyük / az durak | 383.482 | 409.091 | 505.034 | 554.673 | 675.131 | 620.821 |
| Büyük / enerji | 333.787 | 337.915 | 465.161 | 447.304 | 605.894 | 560.258 |

Percentile mevcut nearest-rank yardımcısıyla hesaplanır. Process başına n=24 iken p99 en büyük, p95 ikinci en büyük örnektir; birleşik n=72'de de p99 en büyük örnektir. Bunlar yüksek güvenilirlikte tail SLA kanıtı değildir.

### Süreçler arası varyans

Pozitif yüzde B'nin p95'inin daha yavaş olduğunu gösterir. SD, üç process p95 değerinin **örnek standart sapmasıdır** (ms); bağımsız tüm planların standart sapması değildir.

| Profil / amaç | Process 1 Δp95 % | Process 2 Δp95 % | Process 3 Δp95 % | p95 SD A / B ms |
|---|---:|---:|---:|---|
| Küçük / süre | +2.11 | +5.28 | −6.22 | 2.768 / 8.911 |
| Küçük / az durak | +10.06 | +6.09 | +8.84 | 11.039 / 9.687 |
| Küçük / enerji | +11.47 | −0.49 | −16.80 | 11.869 / 5.010 |
| Orta / süre | +2.68 | −14.88 | −6.05 | 6.540 / 10.197 |
| Orta / az durak | +5.26 | −5.80 | −17.63 | 18.542 / 4.924 |
| Orta / enerji | +2.44 | +26.27 | −11.36 | 6.144 / 15.880 |
| Büyük / süre | +4.11 | −8.63 | +2.58 | 54.814 / 38.071 |
| Büyük / az durak | −1.63 | +10.65 | +14.09 | 51.880 / 32.439 |
| Büyük / enerji | +1.59 | −1.94 | +7.13 | 48.506 / 45.457 |

Özellikle **küçük/az durak p95'i 3/3 process'te geriledi**. Küçük/enerji için önceki yaklaşık iki kat p95 gerilemesi dengeli deneyde tekrarlanmadı; 2/3 process iyileşti. Bu durum tüm objective'lerde heap kazancı anlamına gelmez. Birleşik dağılım process varyasyonunu maskeleyebilir: örneğin büyük/enerjide pooled p95 daha iyi olsa da 2/3 process'te p95 daha kötüdür.

Her process'in 12 dengeli bloğunda A/B ortalama süre farkı ayrıca hesaplandı (toplam 36 blok/hücre). Median paired değişim küçük/az durakta **+3.18%**, küçük/enerjide **−1.63%**, orta/enerjide **+3.05%**, büyük/az durakta **+2.85%**. Tüm hücrelerin mutlak/yüzdesel blok farkları ve process p95 min/max/mean/SD değerleri [summary.json](frontier-queue-gate-2026-11-13/summary.json) içinde bulunur; güven aralığı veya istatistiksel anlamlılık iddiası yapılmaz.

## Queue maliyeti, CPU ve GC

Queue süresi yalnız push/pop wrapper'ında alınır; compareStates ve karşılaştırma sayacı dahildir. Length getter, trace/hash, dış kod ve logger kapsam dışıdır. İki performance.now çağrısının ve sayaçların ek maliyeti sıfır değildir; alt milisaniyelik farkları production overhead'i diye sunmuyoruz.

| Profil / amaç | A / B comparator çağrısı | A / B median queue ms |
|---|---|---|
| Küçük / süre | 38 / 24 | 0.0485 / 0.0793 |
| Küçük / az durak | 38 / 24 | 0.0267 / 0.0481 |
| Küçük / enerji | 38 / 24 | 0.0252 / 0.0275 |
| Orta / süre | 2 / 78 | 0.0199 / 0.0811 |
| Orta / az durak | 2 / 78 | 0.0214 / 0.0926 |
| Orta / enerji | 2 / 88 | 0.0197 / 0.0979 |
| Büyük / süre | 8 / 459 | 0.0730 / 0.1789 |
| Büyük / az durak | 8 / 459 | 0.0786 / 0.1934 |
| Büyük / enerji | 8 / 546 | 0.0676 / 0.1993 |

**Ölçümle desteklenen mekanizma:** küçük frontier'de daha az comparator çağrısı, mutlaka daha düşük queue süresi getirmiyor; wrapper/heap girişleri ve kısa işlemlerin sabit maliyeti var. Orta/büyük budget-limited durumda array push sıralamayı erteliyor ve yalnız iki pop yapıyor; heap ise sonradan çıkarılmayacak yüzlerce state'i de push sırasında sıralıyor. Burada daha çok karşılaştırma yaptığı doğrudan ölçüldü. Önceki tamamen drain edilen 2048 elemanlık structure benchmark'ının kazancı bu plan türüne genellenemez.

Queue median farkları yaklaşık 0.002–0.132 ms iken wall farkları çok daha büyük ve değişken. Bu yüzden bütün wall p95 farkını queue'ya bağlamak veya tamamını ortam gürültüsü saymak için kanıt yoktur. Domain engine/refactor/filtreleme gibi başka değişiklikler yapılmadı.

Ölçülen 648 A + 648 B planın process CPU/GC toplamları:

| Gözlem | A sort | B heap |
|---|---:|---:|
| Process CPU user ms | 122064 | 124756 |
| Process CPU system ms | 3094 | 3834 |
| Timed aralıkta gözlenen GC sayısı | 3397 | 3398 |
| Timed aralıkta gözlenen GC süre toplamı ms | 5841.766 | 6099.893 |
| Örneklenen process heapUsed aralığı MB | 414.7–1682.8 | 413.5–1693.5 |

CPU, plan window'larının tüm process thread'lerini (JIT/GC dahil) kapsayan toplamıdır; fixture kurulum/son hash ve warmup hariçtir. Süreç ömrünün startup/validation/warmup dahil CPU user/system toplamları da artefaktlarda ayrıca vardır. Windows CPU accounting değerleri kuantizedir; çok kısa queue işlemleri için güvenilir CPU ayrıştırması yapılmadı. Sıfır CPU gözlemi sıfır maliyet anlamına gelmez.

GC `PerformanceObserver` ile gözlenir; window'a event başlangıç zamanıyla atanır. Hash/kurulum gibi window dışındaki GC'ler worker toplamında kalabilir. GC zorlanmadı. Heap öncesi/sonrası örneklemedir; peak allocation, retained heap, GC nedeni veya kuyruk başına bellek tasarrufu kanıtı değildir. JIT ayrıca bir profiler ile ayrıştırılmadı.

## Çevresel belirsizlik

Windows 10.0.26200 x64, Intel i7-12700H, 20 logical CPU, 16.87 GB RAM, Node v26.13.0. Ağ/DB kullanılmadı; ölçümlerle eşzamanlı test/build başlatılmadı. Başka servisler durdurulmadı; CPU affinity, güç/termal rejimi ve diğer kullanıcı uygulamaları kontrol edilmedi.

Machine-wide CPU busy oranı process aralıklarında **20.36%, 13.09%, 11.58%** olarak gözlendi; buna benchmark da dahildir, yalnız background load değildir. Process sonlarındaki serbest fiziksel bellek sırasıyla yaklaşık **0.85, 1.44, 0.47 GB** idi; bunlar tüm koşunun minimumu değildir. Dolayısıyla tam sabit yük/bol bellek iddiası yoktur. Üç bağımsız process, dengeli sıra ve ortak fixture belirsizliği azaltır; ortadan kaldırmaz. Mutlak süreler canlı API veya saha SLA'sı değildir.

## Test kapısı

| Komut / kontrol | Sonuç |
|---|---|
| 3 process benchmark + summary | PASS: 1296 ölçüm, 108 metrik modu kontrolü, 27 native anchor; tüm sonuç/trace/pop eşdeğer |
| Yeni benchmark seam testleri | PASS: 6 test; normal/orta/büyük ve fail kontrolleri |
| `pnpm --filter @chargeroad/api test` | PASS: 45 suite / 545 test; **14 suite / 150 DB testi SKIPPED**, toplam 695 |
| `pnpm --filter @chargeroad/api test:db` | **Komut FAIL (ortam)**: 14 suite / 150 test DB bağlantısında kaldı; 545 diğer test geçti. DB senaryo kabulü **NOT_RUN**, PASS değil |
| Salt okunur DB `SELECT 1` kontrolü | Bağlantı kurulamadı: **ECONNREFUSED**; DB içeriğine ulaşılamadı |
| `pnpm -r typecheck` | PASS: shared, API, mobile |
| `pnpm --filter @chargeroad/api build` | PASS |
| Başlangıçtaki mevcut 480 dosya | PASS: byte hash'leri aynı; eski kanıtlar ve production kodu korunuyor |

DB yokluğu için container/servis başlatılmadı veya testleri yeşile çevirmek üzere ayar değiştirilmedi. Yeni benchmark testleri, mevcut frontier/reference/optimizer testleri ve diğer DB'siz API testleri gerçekten çalıştı. DB kabulü ayrıca açık kalır.

## Yeni dosyalar ve tekrar çalıştırma

- `apps/api/src/planning/validation/frontier-performance-harness.ts` ve `.spec.ts`: izole dependency seam'i, tam plan fixtures, gözlem ve eşdeğerlik testleri.
- `apps/api/scripts/benchmark-frontier-performance-gate.ts`: üç bağımsız process ve dengeli bloklar.
- `apps/api/scripts/summarize-frontier-performance-gate.ts`: source/reference/trace/blok bütünlüğü, varyans ve kabul özeti.
- Bu rapor ve `docs/validation/frontier-queue-gate-2026-11-13/` altındaki yeni JSON artefaktları.

```powershell
pnpm --filter @chargeroad/api exec ts-node scripts/benchmark-frontier-performance-gate.ts --processes=3 --blocks=12
pnpm --filter @chargeroad/api exec ts-node scripts/summarize-frontier-performance-gate.ts
pnpm --filter @chargeroad/api test:db
pnpm --filter @chargeroad/api test
pnpm -r typecheck
pnpm --filter @chargeroad/api build
```

Yeni worker ve summary dosyaları bile mevcutsa üzerine yazılmaz; tekrar ölçüm için ayrı bir çıktı dizinli **benchmark-only** kopya/parametre düzenlemesi gerekir. Mevcut artefaktları silerek veya eski before dosyasını yeniden üreterek tekrar etmeyin. Bu turda üç process art arda tek seferlik aynı sürümle ölçüldü; probe performans hesabından çıkarıldı.

Artefaktlar: [process 1](frontier-queue-gate-2026-11-13/process-1.json), [process 2](frontier-queue-gate-2026-11-13/process-2.json), [process 3](frontier-queue-gate-2026-11-13/process-3.json), [özet](frontier-queue-gate-2026-11-13/summary.json), [ön kalibrasyon](frontier-queue-gate-2026-11-13/probe.json), [koruma kanıtı](frontier-queue-gate-2026-11-13/preservation.json).

## Son karar ve kapsam sınırı

**NO-GO, kalıcı performans kazanımı için.** Kullanıcının tekrarlanan p95 gerilemesinde kabul vermeme talimatı ihtiyatlı uygulanmıştır: bir hücrede 3 process'in en az 2'sinde p95 artışı varsa kalıcı hızlanma kabul edilmez. Bu istatistiksel anlamlılık testi veya production eşik kararı değildir. Küçük/az durakta 3/3 tekrarlanan gerileme ve diğer bazı hücrelerde 2/3 gerileme bulundu. Genel hız kazanımı kanıtlanmadı; eski yaklaşık iki kat farkın her objective'de sabit kaldığı da söylenemez.

**Eşdeğerlik PASS**, fakat DB entegrasyon kabulü bağlantı nedeniyle açık. Production uygulaması kullanıcı talebine uygun olarak değiştirilmedi veya geri alınmadı; bu rapor bir rollout/onay değildir. Sonraki bir kararla kuyruk stratejisi tartışılabilir; bu doğrulama o değişikliği uygulamaz. CR-PERF-003 koduna geçilmedi.

Raw konum/SOC/GPS/rota/token/kullanıcı verisi yazılmadı; yalnız synthetic verinin hash'leri, sürüm/kod hash'leri ve aggregate sayısal gözlemler saklandı. Gerçek provider'a istek, quota/cache temizleme, migration, Git push veya tarihçe değişikliği yapılmadı.
