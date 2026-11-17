# Optimizer arama israfı ve özdeş şarj durumları — 2026-11-17

Başlangıç HEAD `6cf42e7` (main). Kapsam: kullanıcıyla kararlaştırılan iş sırasının 1. adımı (arama sırası). Ölçümler süreç içi, yerel Valhalla 8004, sabit kalkış saati; hava 8 saatlik cache penceresinden (ölçülen koşularda MET isteği 0). Pilot profil, başlangıç %95, rezerv %10, varış %20, en kısa süre amacı.

## Referans rota seti

İstanbul→Ankara, Ankara→İstanbul, Bursa→Ankara, İstanbul→İzmir, Ankara→Antalya, Kadıköy→Sarıyer (kamuya açık uç noktalar). Uzun rota (Kelkit) günlük MET kotası nedeniyle sonraya bırakıldı.

## Teşhis

| Bulgu | Ölçüm |
|---|---|
| Geriye (varıştan uzaklaşan) sürüş | 0 / 457 |
| Aynı durum→hedef sürüşünün birebir tekrarı | 346 / 457 (İstanbul→Ankara) |
| Şarj başına dönen durum / sayısal olarak farklı | İstanbul→Ankara 95 / 20, İstanbul→İzmir 116 / 20, Kadıköy→Sarıyer 8 / 4 |

Neden: `PlanningSession.charge` her EVSE/soket için ayrı durum döndürüyor; katalog senaryosunda güçleri aynı olduğu için durumlar özdeş ve her biri tüm hedeflere ayrı ayrı sürülüyordu.

Denenip alınmayan: süre amacında A\* sıralaması (geçen süre + kuş uçuşu kalan mesafe / 160 km/sa). Altı rotada sonuç ve adım sayıları 1.3.0 ile birebir aynı çıktı (alt sınır gerçek ortalamaya göre çok zayıf); değişiklik geri alındı.

## Değişiklik (optimizer 1.4.0)

`distinctChargedStates` (charge-target-search.ts): sonraki her sürüş için aynı olan şarj durumları (istasyon, SOC, kalkış saati, batarya sıcaklığı, kapasite) seed, geniş arama ve hedef iyileştirmede ilk bulunan tutularak birleştirilir. Yeni durum-gölgesi checkpoint'i `charged-state-dedup-shadow-source-2026-11-17.json`; eski checkpoint'ler değişmedi.

## Sonuç

| Rota | Plan (km / dk / durak) 1.3.0 → 1.4.0 | Sürüş adımı | Sunucu süresi |
|---|---|---:|---:|
| İstanbul→Ankara | 502,6 / 402 / 3 → aynı | 457 → 116 | 23,9 → 8,5 sn |
| Ankara→İstanbul | 456,4 / 363,6 / 2 → aynı | 367 → 122 | 22,6 → 8,1 sn |
| Bursa→Ankara | 388,8 / 320,4 / 2 → aynı süre (eşit sürede farklı hedef SOC) | 213 → 127 | 16,8 → 7,5 sn |
| İstanbul→İzmir | 588,1 / 477 / 4 → aynı | 344 → 105 | 39,4* → 8,0 sn |
| Ankara→Antalya | 526,7 / 440,3 / 2 → aynı | 197 → 96 | 33,6* → 7,3 sn |
| Kadıköy→Sarıyer | 27,6 / 55,1 / 0 → aynı | 194 → 130 | 13,7* → 1,8 sn |

\* Baz koşuda hava soğuktu; süreye MET beklemesi dahil.

Arama hâlâ hava projeksiyon bütçesinde (~30 bin) duruyor. Kopya sürüşler hava hesabını oturum cache'inden okuduğu için bu bütçeyi zaten tüketmiyordu. Bütçe süreç içinde 4 katına çıkarıldığında (`maxSegmentPasses` 32 → 128) beş rotanın hiçbirinde plan değişmedi, süre ~2 kat arttı; bütçe büyütülmedi.

Kalite açığı: İstanbul→İzmir 588 km (ana rota 480 km) ve 4 durak; ilk iki şarj %42 ve %48 SOC'de. Bu, aramanın kaçırdığı bir plan değil, mevcut ölçütlere göre en hızlı görünen plandır; sapma/otoyol çıkışı cezası (2. adım) ve SOC kuralları (3. adım) bunun için planlandı.

## Testler

| Komut | Sonuç |
|---|---|
| `charged-state-dedup.spec.ts` (önce kırmızı: 3 EVSE ile 735 geçiş, 1 EVSE ile 193) | PASS 3/3 |
| `pnpm --filter @chargeroad/api test` | 1104 PASS, 0 FAIL, 154 SKIPPED (DB yok) |
| `pnpm --filter @chargeroad/api typecheck` | PASS |
| `test:db` | NOT_RUN — izole `TEST_DATABASE_URL` yok |
