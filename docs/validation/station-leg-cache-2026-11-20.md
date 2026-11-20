# İstasyon bacağı önbelleği ve sabit kalkış (2026-11-20)

Durum: **Uygulandı, commit bekliyor.** Optimizer `1.9.0` kaldı; plan çıktısı değişmedi.

## Sorun
Bir plan yolculuğu boyunca 35–47 yol bacağı çekiyor; bunların %80–85'i istasyon↔istasyon bacağı. Önbellek soğukken her bacak ~90–130 ms bekliyor (Valhalla `/route` + `/trace_attributes` + PG yazma). Telefondan gelen planlarda yaklaşık 3 sn bu beklemeden geliyordu. Önbellek iki nedenle neredeyse hiç tekrar kullanılamıyordu:
- Valhalla isteği saate yuvarlanmış kalkışı taşıyordu. Aynı istasyon çifti saat 09:00'da ve 14:00'te iki ayrı anahtar üretiyordu.
- Yol önbelleğinin TTL'i 1 saatti.

Bütün çiftleri önceden hesaplamak gerçekçi değil (salt okunur sayım):
- Planlayıcının kullandığı DC konum sayısı 9.097.
- 300 km içindeki sıralı çift sayısı ~25,9 milyon.
- Önbellek satırı başına ~24 KB yer kaplıyor.
- Bu, yüzlerce GB ve haftalarca Valhalla hesabı demek.

## Değişiklik
1. **Sabit kalkış (`road-departure-bucket/2.0.0`):** Valhalla isteği `date_time` alanında tek bir sabit yerel saat taşır. Yoklama: 40 istasyon çifti × 5 saat; cevaplar, geri yansıtılan `locations[].date_time` dışında birebir aynı. `date_time` alanını hiç göndermemek eşdeğer değil (süreler değişiyor).
2. **İstasyon bacağı TTL'i (`road-station-leg-cache/1.0.0`):**
   - Planlayıcı, iki ucu da istasyon olan bacakları `stationPair` ile işaretler.
   - Yol servisi bu bacakların `/route` ve `/trace_attributes` cevaplarını 30 gün saklar (`ROAD_STATION_LEG_CACHE_SECONDS`, en fazla 90 gün).
   - Yalnız `ROAD_ROUTING_CACHE_REVISION` tanımlıysa devreye girer. Revision tanımlı değilse davranış eskisi gibidir.
   - Kullanıcı konumuyla ilgili bacaklar 1 saatlik TTL'de kalır.
   - Yeni tablo ya da migration yok.

## Kanıt
- **Testler:** `road-station-leg-cache.spec`:
  - İstasyon çifti + revision varsa 30 gün geçer.
  - Kullanıcı bacağında ya da revision yoksa varsayılan TTL geçer.
  - Her kalkış saatinde gövde aynıdır.
  - `roads.spec`'teki saatlik kova testi sabit kalkışa göre güncellendi.
- **Plan parmak izleri:** 5 uzun rotada eski (saatlik gövde) ve yeni (sabit gövde) sürüm, 09:00 ve 14:00 kalkışlarında birebir aynı.
- **TTL:** Ölçüm sonrası `road_response_cache`'te 1.032 satır 30 günlük TTL ile yazılmış; ortalama ~24 KB, toplam 24 MB.

## Ölçüm
Koşullar:
- Tek süreç, 5 uzun rota, üretim dışı ölçüm betiği.
- Her kol kendi `ROAD_ROUTING_CACHE_REVISION` değeriyle soğuk yol önbelleğinden başladı.
- Hava önbelleği önceden ısıtıldı.

| Durum | Eski | Yeni |
|---|---|---|
| Soğuk (ilk istek) | 6,7–8,2 sn | 6,5–8,2 sn (aynı) |
| Aynı süreç, ikinci istek | 2,2–3,1 sn | 2,0–3,2 sn (aynı) |
| Yeniden başlatma, aynı saat (PG sıcak, bellek soğuk) | — | **2,4–3,6 sn** |
| Yeniden başlatma, **başka saat** (14:00) | 5,5–6,2 sn | **2,4–3,9 sn** |

Kazanç, ilk kez istenen bir yolda değil, aynı koridorun başka saatte ya da başka kullanıcı tarafından tekrar istenmesinde ortaya çıkar. Eski sürümde 14:00 planı `/route` anahtarlarını yeniden çekiyordu; yalnız saatten bağımsız `/trace_attributes` anahtarları tekrar kullanılıyordu.

## Sınırlar
- Hiç geçilmemiş bir istasyon çifti ilk istekte yine Valhalla'ya gider.
- Önbellek, kullanıcıların gerçekten geçtiği çiftler kadar büyür: bacak başına ~50 KB (iki satır). Örneğin 100.000 bacak ≈ 5 GB.
- Süresi dolan satırları mevcut temizlik işi siler. Az kullanılan satırları erken silmek sonraki iştir.
- Ana koridorlar için önceden doldurma (prewarm) yapılmadı.
- `ROAD_ROUTING_CACHE_REVISION` ortamda tanımlanmadıkça istasyon bacağı TTL'i devreye girmez. Sabit kalkış her durumda geçerlidir.

## Testler
- API: 1.219 test geçti; 154 DB testi atlandı (NOT_RUN).
- API typecheck temiz.
