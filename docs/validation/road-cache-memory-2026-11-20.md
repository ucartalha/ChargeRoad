# Yol cache temizliği ve bellek katmanı (2026-11-20)

Durum: `perf/road-cache` dalında. `main` (`10afe5f`) dokunulmadı; geri dönüş için `main`'e geçmek yeterli. Plan çıktısı değişmedi, optimizer `1.9.0` kaldı.

## Sorun
- **Şişkinlik:** `road_response_cache` satırları en fazla 1 saat geçerli, ama süresi dolanlar hiç silinmiyordu. Yerel DB'de 52.434 satır (904 MB) vardı, bunların yalnız 464'ü geçerliydi.
- **I/O yükü:** Her plan, sıcak cache'te bile 330–430 yol satırını PostgreSQL'den okuyordu (ortalama 16 kB). 100–1.000 eşzamanlı kullanıcıda bu, saniyede binlerce okuma ve yüzlerce MB veri aktarımı demek.

## Değişiklikler
1. **Temizlik (`RoadMaintenance`, `cleanupRoadCache`).**
   - 15 dakikada bir, açılıştan 30 sn sonra bir kez daha çalışır.
   - Süresi dolmuş ve doldurulmakta olmayan (lease'siz) satırları siler.
   - 5.000 satırlık partiler halinde, tarama başına en fazla 20 parti.
   - Yalnız silinen satır sayısını loglar.
2. **Bellek katmanı (`BoundedMemoryCache`, `PgRoadClient`).**
   - PostgreSQL okumasının önündedir. Anahtar aynıdır: HMAC, saat kovası dahil.
   - Bellekteki kayıt PostgreSQL satırından uzun yaşamaz: isabette satırın `expires_at` değeri, yazımda yazım anı + TTL kullanılır. Runbook'taki 1 saatlik güvenlik ağı korunur.
   - Değerler derin dondurulur, salt okunur paylaşılır.
   - Kayıt başına isabet sayacı tutulur. 15 dakikalık bir pencerede hiç isabet almayan kayıt soğuk sayılır ve silinir.
   - Sınırlar 128 MB / 20.000 kayıt; aşılırsa en az yakın zamanda kullanılan silinir.
   - Tarama `RoadMaintenance` ile birlikte çalışır ve yalnız toplu istatistik loglar.
   - Nest DI ile verilir; her uygulama örneği kendi cache'iyle başlar. Doğrudan oluşturulan `PgRoadClient` eski davranışını korur.

## Ölçüm
**Temizlik, yerel DB'de bir kez çalıştırıldı:**
- 52.214 süresi dolmuş satır 7,3 sn'de silindi (11 parti).
- 220 geçerli satıra dokunulmadı.
- Disk dosyası `VACUUM FULL` yapılmadıkça küçülmez; boşalan alan yeniden kullanılır.

**Bellek katmanı, A/B ölçümü:**
- Koşullar: 5 uzun rota, sabit kalkış, uygulama içi, ısınma turu + 3 ölçüm turu (medyan). İki kol art arda koşuldu; kapalı kolda katman ön yüklemeyle devre dışı bırakıldı.

| | Katman kapalı | Katman açık |
|---|---|---|
| Plan başına PostgreSQL yol okuması | 329–427 | **0–2** |
| 5 rota toplam süre | 16.506 ms | 15.780 ms (−%4,4) |
| Plan parmak izi, oturum hava isabeti, projeksiyon | — | birebir aynı |

Yerel PostgreSQL aynı makinede ve hızlı olduğu için süre kazancı küçük. Asıl etki veritabanı yükünde. Bu ölçüm sıcak cache ve tek süreç içindir; gerçek eşzamanlı yük testi yapılmadı (NOT_RUN).

**Hava tarafı:** `WEATHER_EXECUTION_MODE=legacy` (mevcut ayar) zaten süreç geneli seri bellek cache'ini (`WeatherService.series`) kullanıyor. Yeniden başlatma sonrası ilk istekte PostgreSQL'den okuma normal. Değişiklik yapılmadı.

## Testler
- API: 1.209 test geçti; 154 DB testi atlandı (NOT_RUN, `TEST_DATABASE_URL` yok).
- Yeni testler: `road-maintenance.spec.ts`, `bounded-memory-cache.spec.ts`, `road-memory-layer.spec.ts`.
