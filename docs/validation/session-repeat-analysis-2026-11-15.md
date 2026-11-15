# CR-PERF-005 — PlanningSession tekrar analizi

2026-11-15 · Sorumlu: Codex · **Aşama A DONE / Aşama B BLOCKED (kanıt eksik)** · Tasarım kararı: **SHADOW_ONLY**.

Bu teslim aktif optimizasyon veya hızlanma kabulü değildir. Gerçek tekrar gözlendi; güvenli çıktı sahipliği, tam operasyonel eşdeğerlik ve net kazanım kanıtlanmadığı için hesaplama atlanmadı. CR-PERF-006 başlamadı; kapsamlı ABBA/p50/p95/p99 kabul deneyi yapılmadı.

## Başlangıç ve DB kapısı

HEAD: `c24cab249dc3cbebb29f11104fee95c04ca8d7fd`. Çalışma ağacı 001–004 tracked/untracked değişikliklerini içeriyordu; yerel dosyalar kaynak kabul edildi. Başlangıçtaki 515 dosyanın SHA-256 manifesti alındı. Üretim frontier stabil `sort(compareStates)+shift()` olarak kaldı; 003/004 yalnız shadow. Tarihsel fixture/golden/kanıtlar yeniden yazılmadı.

İlk salt okunur SELECT 1 bağlantıları ECONNREFUSED; ilk API çalışması 896 PASS / 150 DB skipped, ilk test:db 896 PASS / 150 bağlantı kaynaklı FAIL idi. Bu aşamada yalnız A yürütüldü. Son doğrulamada DB erişilebilir hale geldi: SELECT 1 PASS, test:db **1121/1121 PASS**. Ajan Docker/DB başlatmadı, .env değiştirmedi; erişimin ne tarafından değiştiği doğrulanmadı. Mevcut test harness .env içindeki TEST_DATABASE_URL veya DATABASE_URL ile testlere özel schema/search_path kullanır; kullanıcı şemalarına migration/seed/reset/truncate/drop uygulanmadı. Kimlik bilgileri loglanmadı.

DB kapısı artık açık bir engel değildir. B'nin blokajı cache sahipliği/semantik ve kazanım kanıtıdır; başlangıç DB hatasıyla karıştırılmamalıdır.

## Mevcut cache ve yan etki haritası

| Katman | Mevcut davranış ve sınır | Karar |
|---|---|---|
| Session.roads | Yönlü from>to@at; trafiksiz rota @static; hazırlık rotası seed edilir. Static tekrar kullanımının issue etkisi var. | İkinci cache ekleme. Method girişi HTTP değildir. |
| Session.weatherCache | climateSamples uygulandıktan sonra checksum(queries). Hit, provider/budget/replay edinimini atlar; engine hâlâ forecast doğrular. | Mevcut muhasebeyi koru. |
| Session.climateSamples | 10 km içinde hava örneğini yeniden kullanır; özgün query konumu ile sampleLocation/provenance ayrıdır. Map zamanla gelişir. | Yalnız koordinat hash'i yeterli değildir. |
| PgRoadClient | Provider/URL/body + graph/DEM/build cacheRevision kapsamında HMAC key; PostgreSQL TTL, lease/fencing, pacing/kota. | Cache hit HTTP değildir; yeniden yazılmadı. |
| WeatherCacheStore | Provider/sürüm/URL key, pending coalescing, PG tazelik/Last-Modified/backoff, detached acquisition ve bütçe. | Yeni provider cache yok. |
| drive | route → sampleRouteWeather → weather → energy.evaluate. Sampler forecast hit'inden önce çalışır. | Sampler saf CPU adayı; engine çağrısını atlamak kanıtlanmadı. |
| charge | Erişim/üyelik, hava, EVSE/connector/curve, availability/shared pool, termal seçenekler, hardware evaluation ve opening-hours. Issue/budget/yield etkileri var. | Session metodunun tamamını memoize etme. |

## Deney yöntemi ve eşdeğerlik

Tamamen deterministic sentetik in-memory fixture; canlı provider/HTTP veya PG benchmark'ı değildir. Saat 2026-11-15T09:00Z, concurrency=1, model/algoritma/policy ve kaynak hash'leri sabit. 23 senaryo × 3 objective = **69 karşılaştırma**, her biri üç plan denemesi: native production; aynı güncel session/coordinator kaynaklarının yalnız bellekte derlenip gözlemciyle sarmalanmış kopyası; aynı gözlemci ve mevcut metrikler kapalı. Test kopyası algoritmanın doğruluk kaynağı değildir; native production çıktısı kontrol grubudur. Hiçbir fonksiyonun sonucu cache'ten dönmez; bütün özgün işler çağrılır. Production module cache/prototype değiştirilmez.

Tam normalize outcome (plan, validation input, replay, warnings, search metadata dahil), input hash, engine/provider geçiş sırası ve sayıları eşleşti; yalnız elapsedMilliseconds normalize edildi. 001–004 sayaçları native/gözlemci arasında bire bir aynı; metrik kapalı iken snapshot yok. Harici fetch yasak. Diagnostic key'ler SHA-256, payload/konum/SOC/token/raw rota yazılmaz.

Senaryolar: normal, direct, catalogue claims/membership, 2/5/10 km corridors, equal alternatives, opening-hours, stale, unknown excluded, shared pool, long route, many/sole station, SOH, thermal, expired weather, different hour, weather/road/state budget, cancel, provider quota/timeout. Bu matris B'nin tüm kabul kapılarını kapatmaz: gerçek deadline sırasında iptal yarışı, aktif cache eviction, değişen canlı availability ve immutable cache okuma/yazma davranışı **NOT_RUN**. Provider timeout, optimizer global deadline kanıtı değildir.

## Gözlenen tekrar ve maliyet matrisi

Aşağıdaki sayılar `session-repeat-smoke-2026-11-15-final.json` gözlenen 69 koşusundan. Nihai metadata düzeltmeli `...-closure.json` aynı eşdeğerlik ve tekrarları yeniden doğrular. Süreler sınırlı smoke gözlemidir; performans kabulü değildir. Fingerprint süresi input önce/sonra ve output hash'lerini içerir; gelecekte tek lookup maliyetiyle eşit sayılmaz. İç içe süreler toplanamaz.

| İşlem | Çağrı | Tam veri tekrarı | Oran | İşlem ms | Fingerprint ms | Maliyet/yan etki ve güvenlik kararı |
|---|---:|---:|---:|---:|---:|---|
| sample_weather | 4015 | 2255 | %56,2 | 35,70 | 233,62 | Geometri/zaman üretimi; çıktı rota endpoint'ine alias. Sahiplik ve kazanç kanıtı eksik. |
| road_provider port | 306 | 0 | %0 | 9,84 | 17,40 | Edinim/issue/budget/replay; port gerçek HTTP değildir. |
| weather_provider port | 1955 | 0 | %0 | 11,19 | 1055,23 | Forecast edinimi; kaynak/tazelik/bütçe etkileri. |
| energy_evaluate | 4012 | 1965 | %49,0 | 1219,08 | 1260,21 | Fiziksel hesap/deadline/negatif sonuçlar; çağrı atlanmadı. |
| charging_evaluate | 1879 | 468 | %24,9 | 495,28 | 391,47 | Entegrasyon/termal/negatif sonuçlar; çağrı atlanmadı. |
| session_drive | 3097 | 60 | %1,9 | 4985,63 | 1395,99 | İç içe engine/cache/issue/replay; wholesale reuse yok. |
| session_charge | 2284 | 72 | %3,2 | 1598,64 | 975,53 | Erişim/EVSE/hava/termal/opening-hours etkileri. |
| session_route | 3097 | 1509 | %48,7 | 54,55 | 116,63 | Mevcut road cache etkisi; yeni tasarruf değildir. |
| session_weather | 6200 | 4242 | %68,4 | 1595,99 | 162,74 | Mevcut forecast cache; yeni tasarruf değildir. |

Tam veri eşitliği AbortSignal/deadline/budget eşitliği değildir. Fulfilled tekrar sayıları başarısız domain sonuçlarını da içerir; yalnız başarılı plan veya reuse edilebilir sonuç sayısı değildir. Bütün gözlemlerde output conflict, input mutation, keySkipped ve diagnostic eviction 0. Bu, gelecekte cache çıktısının mutasyona uğramayacağı garantisi değildir.

Mevcut road session cache hit **2854**, weather session cache hit **4242**. Provider port edinimleri road **306** (300 fulfilled/6 throw), weather **1955**; session route 3, drive 6, weather 3 throw. Weather queries **7916**, budgeted forecast items **4430**. 3 örnekleme sonrasında weather budget işlemi energy'ye ulaşmadı: sampler 4015, energy 4012. Weather girişleri 6200 = 4242 hit + 1955 provider + 3 budget stop. Road budgeted 300 ile 306 provider farkı hazırlıktaki 6 provider hatasını içerir; girişlerden HTTP türetilmez.

Sentetik koşulda road/weather PG hit/miss/coalesced ve gerçek HTTP sayaçları **0**. Frontier peak **40**, expanded **381**, transition **5381**; 003 candidate selected **141**, shadow potential reject **18**, gerçek eleme **0**. 004 states **498**, pairs **1125**, gerçek prune **0**. Mevcut caches/003/004 sayıları bu görevin tasarrufu değildir.

**saved_provider_http=0; saved_energy_evaluations=0; saved_charging_evaluations=0; saved_pure_computations=0.** 207 denemelik üçlü diagnostic loop CPU user/system **22000/640 ms** (setup/trace/hash/bellekte derleme dahil); heap örnekleri **442897160→574139392 byte**. Bunlar engine CPU, allocation/retained/peak veya performans kazancı değildir. Ortam Node v26.13.0 / Windows 10.0.26200 / Intel i7-12700H; scheduling/JIT/GC etkisi ayrıştırılmadı. Sampler'ın toplam gerçek işi hash gözleminden çok küçük; naive full-key cache'in net faydası kanıtlanmış değil.

## Key, invalidation ve sahiplik sözleşmesi

Diagnostic anahtar typed canonical tam veri SHA-256: undefined/absent/null, -0/0, küçük SOC farkı, dizi sırası korunur; nesne alanları sıralanır. Nonfinite/class/accessor/symbol desteklenmez, sessiz yanlış hit yerine diagnostic skip ve özgün iş devamı. Her işlem/koşu en çok 512 hash kaydı, FIFO; key serialization 4 MiB/depth128/nodes200000 sınırı. Sonuç/promise tutulmaz. Bu validation indeksi **production reuse key kontratı değildir**.

Aktif tasarım yeniden değerlendirilirse aynı solve/session ömrü ve sabit küçük kapasite, oturum bitişinde discard, yazma/okumada owned immutable kopyalar zorunlu. Şimdiki sampler samples dizisi rota endpoint nesnelerini paylaşır; bir sonucu mutate etmenin sonraki gerçek çağrıya taşınmadığını test ettik. Cache'e bu referansı doğrudan koymak yasak; caller route'u freeze/mutate etmek çözüm değildir. Nesne identity WeakMap'i route mutability/version kanıtı olmadan yeterli olmaz. Hata/iptal/expired/unknown sonuçlar ve signal/deadline davranışı kanıtlanmadan cache'lenmez; cache hit gerçek engine/HTTP olarak sayılmaz. Eviction yalnız performansı etkileyebilir; doğru hit tazelik veya budget kontrolünü atlayamaz.

Tam anahtar/invalidation gereksinimleri:

- **Saf sampler:** yönlü tam route/segment ID, geometri noktaları ve sırası, mesafe/süre/access alanları, kaynak/sürüm/kalite, tam departureAt ve stop sırası/gecikmesi, sampler/geometri/policy sürümleri. Değişen tek girdide miss. Cloning ve lookup dahil net maliyet ayrıca ölçülmeli.
- **Yol:** tam yönlü from/to/waypoint, preferences/alternatives, departure/traffic, graph/DEM/build/source sürüm, lisans/kalite. Mevcut provider cache ve acquisition olaylarını çoğaltma veya atlama.
- **Hava:** tam requested location/time/seri, actual sample location/provenance, observation/forecast issue/tazelik, policy ve warnings. climateSamples state değişimi ve expiry invalidation kapsamındadır.
- **Enerji:** tam route/segment/forecast, araç/reference/person/profile/model ve algoritma sürümü, kesin SOC, sıcaklık/provenance, kullanılabilir kapasite/SOH snapshot, yük/HVAC/rüzgâr, continuation/target ve zaman. Deadline/issue/replay etkileri ayrıca kanıtlanmalı.
- **Şarj:** station/EVSE/connector/curve ve sürümler, gerçek SOC aralığı, termal/kapasite, tam arrival, availability snapshot/effective policy, opening-hours ve queue varsayımı. Güncel availability/expiry her kullanımda geçerli olmalı.

Tek stationId/routeId, yuvarlatılmış SOC veya zaman bucket'ı, yalnız koordinat hash'i güvenli değildir. Pozitif/negatif/null/unknown/stale ayrımı ve replay/budget/issue muhasebesi korunmadan fiziksel sonuç tekrar kullanılmaz.

## Test kapısı ve teslim dosyaları

| Komut | Nihai sonuç |
|---|---|
| API test | PASS: 971, DB skipped 150; 53 passed/14 skipped suite |
| API test:db | PASS: 1121, 67 suite; DB testleri dahil |
| shared test | PASS: 41 |
| mobile test | PASS: 21 |
| pnpm -r typecheck | PASS |
| API build | PASS |
| Yeni targeted audit/equivalence | PASS: 75 (6 unit + 69 karşılaştırma) |

Tam API koşusu mevcut 002 array kapanışı, 003 before/shadow/off ve 004 before/shadow/off testlerini de içerir. Golden/fixture beklentileri değişmedi. Ham test günlükleri ignored artifacts/perf005-* altında yerel olarak korunur; repo içindeki kapanış artefaktı sonuç/hash kanıtını taşır.

Bu görevde eklenenler:

- `apps/api/src/planning/validation/session-repeat-audit.ts`
- `apps/api/src/planning/validation/session-repeat-validation.ts`
- `apps/api/src/planning/__tests__/session-repeat-audit.spec.ts`
- `apps/api/src/planning/__tests__/session-repeat-equivalence.spec.ts`
- `apps/api/scripts/validate-session-repeats.ts`
- `docs/validation/session-repeat-smoke-2026-11-15.json`, `...-final.json`, `...-closure.json`
- Bu rapor; `session-repeat-preservation-2026-11-15.json` ve `session-repeat-checks-2026-11-15.json`.

Yalnız mevcut `docs/TASKS.md` ve Task005 Markdown durum notu güncellendi. Önceki bütün kod/kanıtların korunumu ayrı preservation manifestinde doğrulanır. İlk iki smoke JSON'un DB_GATE etiketi üretildikleri andaki başlangıç engelidir; son DB testinden sonraki nihai karar bu rapor ve closure JSON'daki **BLOCKED_EVIDENCE**'dır. Tarihsel JSON'lar düzeltilmek için üzerine yazılmadı.

## Rollout ve kalan riskler

Production import/hook/cache/flag eklenmedi; servis davranışı aynıdır. Mevcut metrik varsayılanı kapalı; 003/004 shadow ve 002 array davranışı korunur. Validation runner yalnız açık CLI/Jest çalışmasında devrededir; geri alma yalnız bu beş yeni validation/script/test dosyasını ve yeni durum notlarını kapsayabilir, 001–004'e dokunulmaz. Yeni default-off aktif reuse toggle yok çünkü aktif yol yok.

B için owned sampler snapshot/clone kontratı, operasyonel deadline/iptal ve failure kapsamı ile lookup+clone maliyeti dahil gerçek net CPU azalması kanıtlanmalıdır. Mevcut aliasing ve maliyet bulgularını görmezden gelerek cache eklemek güvenli bir hızlandırma olmaz. Şu an hız kazanımı PASS değil; bütün gözlemler korunmuş özgün hesaplamalar üzerinden yapılmıştır.
