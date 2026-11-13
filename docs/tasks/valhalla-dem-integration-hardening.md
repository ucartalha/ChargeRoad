# ChargeRoad — Valhalla + DEM entegrasyonunu sağlamlaştırma

- **Görev ID (öneri):** `CR-009-P1-HARDENING` / `V1-ROAD-003,004,005` alt dilimi
- **Tarih:** 2026-11-12
- **Durum:** `IN_PROGRESS` — yerel hardening kodu, deterministik/DB testleri ve 8003/izole 8004 smoke uygulandı; kaynak/lisans, sıfırdan build ve üretim/saha kabulü açık. Commit/push yapılmadı. [Audit](../validation/valhalla-dem-hardening-audit-2026-11-12.md), [teslim raporu](../validation/valhalla-dem-hardening-2026-11-12.md).
- **Repo:** `ucartalha/ChargeRoad`
- **Bu dosyanın hedef yolu:** `docs/tasks/valhalla-dem-integration-hardening.md`
- **Üst ADR:** `docs/adr/009-in-app-navigation-and-self-hosted-routing.md` (revize metin ayrıca teslim edildi)
- **Karar:** Bu dilimde **alternatif rota üretimi, route optimization, fastest/shortest/EV-optimum sıralaması, MapLibre ve mobil navigasyon yok.** Sonraki ayrı görevde yapılacak.

## 1. Başlangıç durumu: gerçekten yapılanlar ve yapılmayanlar

Aşağıdaki tablo kullanıcının Windows terminal oturumu çıktıları ile 2026-11-12 GitHub `main` incelemesine dayanır. Yerel çalışan dosyalar GitHub'a commit edilmiş varsayılmayacak; Codex önce `git status`, yerel farklar ve çalışma ağacını kontrol edecek.

| Alt sistem | Elde edilmiş gözlem | İşin durumu |
| --- | --- | --- |
| PostgreSQL | Docker üzerinde mevcut; NestJS `/v1/ready` DB `ready` | **Çalışır; bu görevde bozma** |
| NestJS | Windows üzerinde port 3000 mevcut, 3001 pilot; 3001 `/v1/ready` OK | **Çalışır; 3000'e dokunma** |
| Valhalla 3.9.1 | `chargeroad-valhalla` host 8002 ve `chargeroad-valhalla-elevation` host 8003 ayrı container | **Yerel PoC başarılı** |
| DEM | 8003 HGT destekli (yaklaşık 2 GB yerel dosya), `/height` doğru sayısal yanıt | **Yerelde mevcut; veri provenance/lisans açık** |
| API → DEM | Port 3001 `ROAD_ROUTING_BASE_URL=http://127.0.0.1:8003`, `/v1/roads/routes` sonucu kaynak URL 8003 | **Test edildi** |
| Ankara test | A=(39.900000,32.800000), B=(39.910000,32.800000); Valhalla standart 4.407 km | **Tek örnek** |
| Detaylı rota | 72 normalize kesim, 229 segment-içi tekrarlı yükseklik öğesi, min/max 868.1/911.2 m; `-500` gözlemi yok | **Yerel başarılı; kalite sertifikası değil** |
| Ham DEM örnekleme | Valhalla 30 m → 148 nokta; 300 m → 16 nokta (868.7–909 m) | **Karşılaştırıldı** |
| Fiziksel yükseklik bilançosu | 92.3 m tırmanış, 109.9 m iniş; 909 m başlangıç, 891.4 m bitiş; net -17.6 m ve aritmetik fark 0 | **Aritmetik tutarlı** |
| Dış rakım kıyası | OpenTopoData SRTM30m ve Valhalla `/height`: A=905 m, B=890 m | **Eşleşme var; aynı DEM ailesi olabilir** |
| Eğim/örnek ölçeği | 30 m kesim -%31.3, 150 m hareketli pencere -%15.5, 300 m pencere en yüksek mutlak gözlenen %7.03 | **Şüpheli bölgeler ölçüldü, gerçek yokuş veya hata ayrıştırılmadı** |
| Farklı rota motorları | Valhalla standart 4.407 km / 7.72 dk; Valhalla `shortest` 2.429 km / 7.36 dk; OSRM 2.545 km / 4.16 dk; Google Maps manuel 3.2–5 km alternatifleri | **Referans notu; optimizasyon bu görevde yok** |
| Kalıcı kod | `normalize-road.ts` GitHub `main` üzerinde `elevationQuality` atamıyor; `road-policy.ts` 100/gün sabit kota | **Açık** |
| Docker kurulumu Git'te | İncelenen GitHub `main` ağacında `infra/valhalla` yok | **Açık; yerel dosyaları önce kontrol et** |
| Üretim | Graf yenileme/sürüm, lisans, kapasite, harita/nav ve saha çalışması doğrulanmadı | **Açık** |

**Önemli ayrım:** Orijinal A/B koordinatlarında iki noktanın DEM rakımı 905/890 m çıkarken normalize yol rotasının başlangıç/bitişi 909/891.4 m olabilir. Farklı snap/örnekleme geometrisini kontrol etmeden "veri tutarsız" veya "bağımsız doğrulandı" hükmü verme.

## 2. Repo gerçekliği — önce audit

İncelenmesi beklenen mevcut dosyalar (dosya isimlerini git'te yeniden doğrula):

- `apps/api/src/roads/valhalla-adapter.ts`: Valhalla `/route`, `/trace_attributes`, mevcut `elevation_interval:30` ve sürüm/attribution.
- `apps/api/src/roads/normalize-road.ts`: `height(d)` interpolasyonu, `a<=-32000` filtresi, grade change ile bölme, `elevationGainMeters`, `elevationLossMeters`, uyarılar. `elevationQuality` **henüz atanmayabilir**.
- `apps/api/src/roads/road-policy.ts`: yapılandırma ve mevcut günlük 100 limit.
- `apps/api/src/roads/road-client.ts`: HMAC + URL/body cache anahtarı, `road_response_cache` lease/fencing, `road_provider_budget` paylaşımı.
- `apps/api/src/roads/road-service.ts`, `roads.controller.ts`, `roads.module.ts`: mevcut port/interface davranışını ve HTTP sözleşmesini koru.
- `packages/shared/src/contracts/road-weather.ts`: `elevationQuality?: 'verified'|'modelled'|'unknown'`, profil, gain/loss; Zod invariants.
- `apps/api/src/energy/energy-engine.ts`, `energy-physics.ts`, `energy-policy.ts`: `elevationQuality !== 'verified'` ise `verified_only` davranışını ve `allow_engineering_estimates` akışını koru.
- `apps/api/src/roads/__tests__/roads.spec.ts` ve `fixtures/`: mevcut deterministic testleri genişlet.
- `.env.example`, `docker-compose.yml`, `docs/ROAD_PROVIDERS.md`, `docs/V1_RELEASE_BACKLOG.md`, `docs/TASKS.md`, `docs/adr/007*`, `docs/adr/008*`: API sözleşmesi, kaynağın geçmiş kararı ve backlog kapsamı.

**Bilinmeyen:** Yerel çalışma ağacındaki `/infra/valhalla`, `road-policy.ts`, `normalize-road.ts` değişikliklerinin Git'teki sürüme göre farkı. Bu farkı **görmeden dosyanın üstüne yazma**. Codex mevcut değişiklikleri saklamalı ve raporlamalı.

## 3. Bu görevde yapılacak uygulama — öncelik sırası

### H1 — Mevcut yerel altyapıyı bozmayacak kurulum / runbook

1. `infra/valhalla/` mevcutsa dosyalarını analiz et; yoksa minimum dosyaları oluştur. Proje kök `docker-compose.yml` PostgreSQL volume'ünü değiştirme veya `docker compose down` çağırma.
2. Self-hosted Türkiye OSM grafı ve DEM dahil Valhalla **3.9.1** sürümünü sabitle; script / compose yapılandırmasının *host* `127.0.0.1` bind kullandığını doğrula. Kurulu sistemdeki 8002/8003 çakışmalarını önlemek için tercihen **profil / ayrı Compose proje adı / seçilebilir host port** tasarla.
3. DEM ve PBF kaynaklarını URL, sürüm/tarih, lisans/atıf, checksum ve dosya yerleşimi açısından bir `manifest.example` / runbook ile açıkla. Gerçek kilobaytlarca OSM/HGT/Valhalla tile dosyasını git'e ekleme. Kalıcı `.gitignore` kontrolü yaz.
4. Başlatma, sağlık testi (`/height` ve `/route` smoke), yeniden başlatma, güncelleme ve kurtarma komutları üret. Windows **PowerShell 5.1 tek satırlık** örnekler ver; Docker içindeki localhost ve Windows host portlarını karıştırma.
5. Grafı her runtime boot'ta yeniden indirip üretme. Eğer kullanılan container entrypoint build'ini otomatik yapıyorsa bunu açıkça belgele; build/start ayrımı mümkünse küçük ve geriye uyumlu tut. Bellek/disk/süre ölçümü yapılmadıysa rakam uydurma.
6. 3000 çalışan API'ye ve ortak PostgreSQL konteynerine dokunmadan 3001 ile tekil doğrulama yap. Yerel `ROAD_ROUTING_BASE_URL=http://127.0.0.1:8003` yalnız runtime tercihi olarak korunabilir; `.env` veya production config'i sessizce değiştirme.

### H2 — Rakımın gerçek, eksik, yer tutucu olmasını doğru taşı

1. Valhalla'nın **kurulu 3.9.1 sürümü / gözlenen yanıtı** üzerinden gerçek no-data sinyalini tespit et. Daha önce DEM'siz örnekte görülen `-500` sahte yükseklikleri hiçbir şekilde fiziksel yol kotu kabul etme.
2. **Evrensel `height <= -499` gibi fiziksel eşikler kullanma.** Deniz seviyesi altındaki geçerli yükseklikler ve farklı sağlayıcılar için semantik, sağlayıcı no-data/sentinel sözleşmesine göre olmalı. Belirsiz veri `null` / `unknown` ve açık warning olabilir. Negatif ama geçerli rakım senaryosu test edilmelidir.
3. Mevcut `elevationProfile`, `elevationGainMeters`, `elevationLossMeters` şeması ve önceki datayla uyum korunmalı. Eksik örneği **sıfır eğim** olarak uydurma; kısmi segment politikasını belirle ve test et.
4. `RoadSegment.elevationQuality`: kullanılabilir fakat bağımsız doğrulanmamış DEM → `modelled`; veri yok/geçersiz → `unknown`; `verified` ise **yalnız doğrulanmış yol kotu için dokümante edilmiş kaynak kriteriyle**. İki SRTM API'sinin aynı rakımı vermesi bu kriter değildir.
5. `elevation_dataset_not_independently_verified` uyarısını sabit eklenmekten çıkarma/düzeltme kararı veri durumuna bağlı olmalı; warning ile segment kalite alanı birbirine ters düşmesin. Üretime sessiz doğruluk garantisi getirme.
6. `EnergyConsumptionEngine` ile sözleşme davranışını test et: `verified_only` modelled DEM'i doğrulanmış sanmasın; `allow_engineering_estimates` tahmin/assumption ve uyarıyı döndürsün; eksik profile izin verilmeyen durumda `ELEVATION_MISSING` veya mevcut doğru hata korunsun.

### H3 — 30 m veri + 300 m hareketli eğim QA (enerji profilinden ayrı)

1. **Ham örnekleme 30 m** kalır (`valhalla-adapter.ts`); kullanılabilir profil ve geometri korunsun. Kullanıcının 300 m önerisi **ham veriyi 300 m'de bir alma veya tüm normalize yol kesimlerini en az 300 m yapma emri değildir**.
2. Mesafe ekseninde **300 m kayan pencereli eğim** hesabı tasarla (endpoint interpolasyonu, gerçek izlenen güzergâh mesafesi, son kısım ve tekrar eden sınır noktaları için açık kural). Gerekli yardımcı fonksiyon testlenebilir ve saf olsun. İstenirse 30/150/300 m metrikleri raporla.
3. `300mGradePercent = 100 * (height(s+300)-height(s))/300` tanımı; `s+300 > routeLength` ise yeni pencere üretme veya ayrı `partialWindow` kuralı uygula. Pencere boyu ile 30m veri aralığını ayırt et; örnekler arası lineer interpolasyon.
4. 300 m penceresi yalnızca **diagnostic / quality score** için kullanılsın. Kısa gerçek yokuşları gizlemek için tüm yükseklikleri flatten etme; `%10` hard cap, kör median/low-pass, mesafeyi 300'e yuvarlama veya fiziksel tüketim denklemini değiştirme.
5. DEM'deki ani sıçramaları tespit eden QA çıktısı üret (`slope`, `jump`, `coverage`, `missing`, `sourceQuality`). Hata olduğunu kanıtlayamadığın dik yokuşu otomatik düzeltme; kalite `suspect` diagnostik seviyesinde tutulabilir, public contract değişimi gerekirse gerekçelendir.
6. Kazanım/kayıp, net rakım farkı, kesim mesafe/zaman toplamı, geometri ve manevra sürekliliği invariant testleri: `sum(gain)-sum(loss) ≈ endHeight-startHeight`; bu yalnız **iç tutarlılıktır**.

### H4 — Self-hosted limit/cache/provenance gözden geçirme

1. `road-policy.ts` GitHub main'de `dailyRequestLimit:100`. Yerelde `ROAD_ROUTING_DAILY_REQUEST_LIMIT=1000` workaround'u denenmiş olabilir. **Geliştirme aracı konfigürasyonunu üretim davranışı sanma**; `production` kamu Valhalla/Overpass yasağını koru.
2. Mevcut PG `road_provider_budget` **providerId** üzerinden paylaşılıyor; **3000/3001 ayrı port olsa da aynı DB ve aynı providerId için ortaktır.** Demo kredi kotası ile self-hosted iç performans/anti-abuse limitleri için ayrı politika modeli öner; mevcut sözleşmeyi bozmadan minimum uygulamayı yap ve unit test ekle.
3. `road-client.ts` cache key'de `providerId+URL+body` var, ancak graf/DEM revizyonu tam temsil edilmiyorsa yenilemeden sonra eski sonucun saatlerce dönmesi riskini değerlendir. Gerekliyse sürümlü namespace / metadata ile çöz; mevcut DB migration'a zorunlu büyük refactor yapma.
4. Rota kaynak bilgisinde **OSM graf sürümü / DEM veri sürümü bilinmiyorsa `unknown`**; sahte provenance yazma. Kaynak JSON'u `https`/secret leak durumuna karşı incele.
5. Testlerin otomatik çalışması dış demo servislerine veya canlı OpenTopoData/OSRM'ye bağımlı olmasın. Bunlar yalnız manual gözlem kaydıdır. Kamu servisine yük testi yapma.

### H5 — Tekrarlanabilir kalite raporu, belge ve test teslimi

1. **Saklanabilir metinsel fixture / snapshot** ve test komutu ekle: Ankara A/B koordinatları, gerçek 30/300 m gözlemleri ve toleranslı kalite invariant'ları. Sayısal testleri rotayı hangi snapshot'la koşturduğunu yazmadan sabitleme; graf yenilendiğinde farklı rota oluşabilir.
2. `docs/ROAD_PROVIDERS.md`'de artık "kendi Valhalla sunucumuz kurulmadı" ifadesi pilot yönünden güncellenebilir; ama bunu **production hizmeti hazır** seviyesine yükseltme.
3. `docs/V1_RELEASE_BACKLOG.md` V1-ROAD-003/004/005 maddelerini **açık / in progress** tut; yalnız kanıtlanmış alt işi işaretle. CR-016/019, canlı trafik ve saha kabulü kapanmasın.
4. Test/CI yönergeleri: `pnpm --filter @chargeroad/api typecheck`, `pnpm --filter @chargeroad/api test`, `pnpm --filter @chargeroad/api build`; varsa kök typecheck ve uygun `roads:validate` testi. Sistem/fixture yoksa skip gerekçesi raporlanmalı; başarısız test gizlenmemeli.
5. En sonda dosya bazlı değişiklik listesi + hangi test geçti/kaldı + çevresel koşullar + kalan riskler + sonraki bağımsız rota optimizasyonu task sınırı sun.

## 4. Kabul kriterleri — bu task DONE olabilmesi için

- [ ] Tam sıfırdan Türkiye graf/DEM kurulumunun yeniden üretimi açık. Hazır yerel dataset ile ayrı 8004 runtime, health ve smoke PASS; runbook/build profili hazır, kaynak/lisans manifesti ve ağır cold build kabulü tamamlanmadı.
- [x] 3000 API, `chargeroad-db-1`, OrderLane ve mevcut Valhalla container/volume'leri durdurulmadı/silinmedi; mevcut yerel dosyalar korundu.
- [x] `-500` gibi **kanıtlanmış no-data** sahte height kabul edilmiyor, geçerli negatif rakım korunuyor, eksik DEM `unknown/null` olarak taşınıyor.
- [x] DEM profili `modelled`; bağımsız yol kotu için otomatik verified üretilmiyor; `EnergyConsumptionEngine` kalite politikası test edildi.
- [x] 30 m ham yükseklik korunuyor; 300 m kayan eğim sonucu ayrı ve deterministik. Kısa gerçek eğimler ve total gain/loss keyfi yumuşatmayla değiştirilmiyor.
- [x] 30/150/300 m kalite senaryoları; aritmetik net kot bilançosu; kesim/geometri tutarlılığı; eksik yükseklik / segment boundary testleri var.
- [x] Public demo production guard ve cache/lease/fencing davranışları korunuyor; ortak PG kota riski gözden geçirildi ve belgelendi.
- [x] API typecheck/test/build sonuçları komut + pass/fail olarak raporlandı; `docs/validation` altında küçük, tekrar üretilebilir kanıt var.
- [x] Sahada doğrulanmayan rakım, OSM lisans/DEM lisans açığı, performans ve MapLibre/nav açıkları `DONE` diye raporlanmadı.
- [x] **Rota optimizasyonu yapılmadı.** Valhalla `shortest` / OSRM / Google karşılaştırması yalnız referans; yeni route preference API tasarlanmıyor.

## 5. Güvenlik ve kapsam dışı işler

**YASAK / onay gerektirir:** `docker compose down -v`, mevcut DB volume veya OrderLane SQL Server'ı silme, port 3000 process'ini durdurma, varsayılan `.env` secrets'ı loglama/commit etme, büyük `.pbf/.hgt/.gph/.tar` artefaktlarını Git'e koyma, cloud veya ücretli API hesabı açma, kamu demo endpoint'lerine yük testi, repo dışındaki veri dosyalarını izinsiz taşıma.

**Bu task'a dahil değil:** fastest/shortest/`use_distance` optimizasyonu, çoklu alternatif seçim ve enerji açısından sıralama, Google Maps'le rota kalite kıyası otomasyonu, MapLibre/Expo native, GPS turn-by-turn, gerçek cihaz testi, istasyon/şarj optimizasyonu, ücretli yol fiyat motoru, bütün Türkiye production SLA.

## 6. Beklenen Codex rapor biçimi

1. **Audit tablosu:** dosya/sürüm/mevcut davranış/yerel değişiklik/kanıt/açık risk.
2. **Uygulanan değişiklikler:** dosya yolu, tek cümle gerekçe; public contract'a etkisi.
3. **Testler:** çalıştırılan komut, sonuç, fixture ve altyapı koşulları.
4. **Pilot metrikleri:** iki kaynak tipi ayrımı (`manual_observed`, `deterministic_fixture`, `live_smoke`); rakım kalite sınıfları ve 300m grade sonucu.
5. **Açık konular:** dataset provenance/lisans, gerçek yol kotu, speed coverage, saha, graf güncelleme, üretim kapasitesi.
6. **Sonraki task:** alternatif rotalar ve EV optimizasyonu ayrı iş olarak öner; bu task'ta kodlama.

## 7. Uygulama sırasında Windows çalışma ortamı notları

- Çalışma dizini: `C:\Projects\ChargeRoad`; çalışma sistemi **PowerShell 5.1**. Kullanıcıya verilen bütün PowerShell örnekleri **tek satır** olmalı.
- NestJS **3000 mevcut**, ayrı pilot **3001**. Test sırasında yanlış PID durdurma veya port değiştirme.
- Valhalla host portları **8002** (DEM kapalı eski), **8003** (DEM açık pilot); bu portlar meşgulse ayrı proje adı/port seç.
- Yerel 8003 pilot komutunun gözlemlenen parametreleri: image `ghcr.io/valhalla/valhalla-scripted:3.9.1`, `-e build_elevation=True`, host bind `127.0.0.1:8003:8002`, custom_files volume `infra/valhalla/elevation-pilot`.
- `/v1/roads/routes` doğrulamasında API `source.url` gerçekten `http://127.0.0.1:8003` olarak okunmalı; `/v1/ready` tek başına yeterli kanıt değil.
- `road_provider_budget` aynı DB'de aynı `providerId` için ortak olduğu için test kotası ve production policy'yi karıştırma; veritabanını elle sıfırlayıp testi geçirme.
