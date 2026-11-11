# CR-007 — İstasyon kataloğu ve rota koridoru: teknik teslim

Tarih: 2026-11-10. Durum: DONE — statik katalog, kaynak/kimlik politikaları, kapsamlı aday portu ve gerçek PostGIS sorgusu uygulandı. Canlı müsaitlik CR-008, gerçek yol erişimi/sapma CR-009, EV optimizasyonu CR-013 kapsamındadır.

## Kesinleşen kapsam

Türkiye geneli katalog, EPDK önceliği ve kontrollü tamamlayıcı kaynak; bilinmeyen müsaitlik uyarıyla aday kalır. Kullanıcının ek tercihiyle sabit pilot şehir/güzergâh seçilmedi. Yol sağlayıcısının kullanıcının başlangıç–varış konumları için verdiği geometriler kullanılır. Başlangıç/hedefi düz çizgiyle birleştirip gerçek yolmuş gibi sunan fallback eklenmedi. Benchmark'taki geometriler yalnız test girdisidir.

## Gerçek kaynak keşfi ve veri

[EPDK servis listesi](https://epdk.gov.tr/Detay/Icerik/3-34680/enerji-donusum-piyasasi-web-servisleri), [Swagger](https://apigateway.epdk.gov.tr/sarjIstasyonlari?swagger), [resmî kullanım kılavuzu](https://epdk.gov.tr/Detay/DownloadDocument?id=mqXhIJuluA8=).

Servis **GET + JSON body** bekliyor. Gövdesiz çağrı 400 verdi; resmî çağrı biçimiyle `{}` gönderilince başarılı ulusal yanıt alındı. Fetch GET body desteklemediğinden adapter Node HTTPS kullanır. TLS doğrulaması kapatılmaz; timeout 45 saniye, yanıt sınırı 64 MiB. Filtre anahtarları resmî altı alanla sınırlıdır.

Kılavuza göre parametresiz ulusal sorgu saatte bir, parametreli sorgu dakikada birdir. CLI ulusal indirmeden önce PostgreSQL'de ortak quota slot'u ayırır; farklı instance aynı slotu tekrar alamaz. Hata olduğunda sınırsız retry yapılmaz. Filtreli cevap için delta birleştirme henüz uygulanmadığından otomatik filtreli yayın kapalıdır; böylece tek istasyon cevabı ülke kataloğunun yerine geçemez.

İlk gerçek snapshot:

| Ölçüm | Sonuç |
|---|---|
| Kaynak lokasyonu | 17.165 |
| Halka açık | 13.238 |
| Özel | 3.927 |
| Soket beyanı | 50.259 |
| Kaynaktan doğrulanabilen fiziksel EVSE grubu | 0 — yanıtta gruplanmıyor |
| Koordinat/şema karantinası | 0 |

Kaynak istasyon/soket kodları, soket tipi/gücü, işletmeci lisans numarası, adres ve koordinat sağlıyor. Bu yanıt canlı durum, tarife, voltaj aralığı, akım sınırı veya EVSE gruplaması sağlamıyor. Bunlar uydurulmadı. `DC_CCS` ifadesi CCS alt tipini açıkça belirtmediğinden `other` + ham tip ve inceleme uyarısıyla korunur; coğrafyadan CCS2 kesinliği üretilmez. AC_TYPE2 ve DC_CHADEMO açıkça eşlenir. Soket gücü kaynağın nominal kW beyanıdır; gerçek şarj gücü/süre garantisi değildir.

İzin dayanağı kamuya açık sistem entegrasyon servisi olarak kaydedildi; veri açık lisanslı/CC0 diye etiketlenmedi. Kaynak atfı EPDK olarak korunur. OCM erişimi veya canlı operatör feed'i bu teslimde kurulmadı; izni/kalitesi doğrulanmış normalize ek paket ve açık crosswalk için yayın altyapısı hazırdır. Sessiz fallback yoktur.

## DB ve yayınlama

006/007 migration'ları uygulandı; önceki migration dosyaları değiştirilmedi. PostGIS public schema'da kullanılır; izole test şemaları spatial tip/fonksiyonları açık schema adıyla çağırır.

- `station_data_sources`: izin/attribution, kaynak önceliği.
- `station_source_snapshots`: ham byte'lar, raw/normalize checksum, kapsam, tamlık, karantina ve sürüm.
- `charging_locations` / `station_source_aliases`: kararlı UUID; kaynak/ülke/işletmeci/istasyon kimliği. Yakın konum otomatik birleşmez.
- `station_location_revisions`: değişmez normalize lokasyon verisi ve spatial nokta.
- `station_connector_claims`: gerçek soket koduyla kaynak beyanları; EVSE olarak taklit edilmez.
- `charging_evses` / `charging_connectors` / `charging_power_pools`: kaynak fiziksel gruplanmış ekipman sağladığında kullanılacak ayrı yapılar. EPDK aktarımında boş kalır.
- `station_source_publications` / `station_catalogue_heads`: yayın işaretçisi ve GiST indeksli okuma görünümü.
- `station_import_runs` / `station_source_fetch_gates`: deneme/hata geçmişi ve paylaşılan kaynak kotası.

Download/normalize/şema kontrolü önce yapılır. Staging 250'lik batch'lerle ayrı transaction'da yazılır. Sonra kısa yayın transaction'ı pointer ve okuma görünümünü atomik ilerletir. Okuyucular yarım ülke yayını görmez. İptal/hata sonrası önceki yayın korunur. Kısmi veya karantinalı snapshot staging'de kalır ve mevcut tam yayını değiştirmez. Stale yayın reddedilir. Kaybolan kaydın geçmiş revizyonu silinmez; sadece aktif görünümden kalkar. Diğer kaynak aynı kanonik lokasyonu destekliyorsa varlığı korunur.

Tekrarda normalized içerik checksum'u aynıysa yeniden kimlik/ekipman üretilmez. Kaynağın `elapsedTime`/alım tarihi gibi geçici yanıt metadatası yeni veri sayılmaz. Aynı içerik gerçekten yeniden indirildiyse last-checked zamanı ilerleyebilir. Offline import için ham checksum'a bağlı açık acquisition manifest gerekir; dosyanın kopyalanma/mtime tarihi otomatik kaynak güncelliği kabul edilmez.

Kaynak A durumundan B'ye, sonra yeniden A'ya dönerse daha yeni acquisition receipt ile önceki değişmez veri revizyonu tekrar seçilebilir. Eski receipt mevcut yayını geriye alamaz. Her denemenin alım zamanı ve raw/content checksum'u ayrıca saklanır. Snapshot kanıtı ve ekipman revizyonları SQL seviyesinde değişmez korunur; sadece yayın durumu/pointer ilerler.

Açık crosswalk varsa farklı kaynak aynı UUID'ye bağlanabilir. Öncelikli kaynağın bilinen alanı korunur; null erişim alanları düşük öncelikli uygun kayıtla tamamlanabilir. Alanın kaynak dayanağı taşınır, çelişki uyarısı üretilir. EVSE ve power-pool grubu bir paket olarak seçilir; farklı kaynakların ünite sayıları toplanmaz. 2 km'den büyük otomatik koordinat değişimi inceleme ister. Bu eşik v1 kalite kapısıdır, gerçek istasyon taşınmasının imkânsız olduğu iddiası değildir.

## Koridor ve kapsam sözleşmesi

`StationDataProvider` artık `StationCandidateSet` döndürür:

- Tekilleştirilmiş istasyonlar ve her rota/kesimle ilişkileri.
- Kaynak/ülke/snapshot tamlığı, alım/gözlem zamanı, eskilik ve kalite dışlamaları.
- Koridor, aday sınırı, truncation, bir sonraki genişleme ve boş sonuç gerekçesi.
- Snapshot kimlikleri/checksum'ları ve alan kaynakları.

Geography(Point,4326) + GiST ile tam kesim çizgisi boyunca `ST_DWithin` kullanılır. Yalnız başlangıç/hedefe en yakın istasyonlar aranmaz. Rota alternatifleri/tekrarlanan geçişler aynı lokasyonu çoğaltmaz; routeMatches korunur. Mesafe ve kesim ilerlemesi coğrafi aday bilgisi, gerçek yol sapması veya ETA değildir.

Known-private, planned/removed/temporarily_closed lokasyonlar varsayılan aday değildir. Bilinmeyen erişim/saatler uyarıyla kalır. Bilinen uyumsuz standart filtrelenebilir; alt tipi belirsiz connector iddiası doğrulanmış uyumluluk sayılmaz. Düşük güç tek başına varsayılan dışlama değildir.

Başlangıç işletim politikası `station-corridor/1.0.0`:

| Bütçe | Başlangıç değeri |
|---|---|
| Koridor adımları | 2 → 5 → 10 km; sıfır adayda kontrollü genişleme |
| Tek çağrı aday üst sınırı | 500; fazlasında truncated |
| Yol alternatifi / geometri noktası | 5 / 20.000 |
| SQL statement timeout | 2 saniye |
| Statik soft-age | 24 saat; canlı durum TTL'si değildir |
| Otomatik koordinat değişimi incelemesi | 2 km |

Bunlar ölçülebilir/versiyonlanabilir başlangıç bütçeleridir; üretim SLA veya optimum rota kalite eşiği değildir. Aday varken enerji açısından yetersizlikte yeniden genişleme CR-013'teki solver tarafından nextCorridor bilgisiyle ele alınacak. Girdi geometri/bütçe sınırı aşıldığında hata açık döner; sessiz kesme yoktur.

Source snapshot'ının tam alınması fiziksel dünyada tüm istasyonların/erişimlerin bilindiğini kanıtlamaz. EPDK için `sourceSnapshotComplete=true`, `geographicCoverageVerified=false` korunur. Tam query kapsamı ancak açıkça doğrulanmış alan bütün kesimleri kapsıyorsa, veri tazeyse ve arama kesilmediyse ilan edilebilir. Uzak/eksik bölge boşluğu kesin “istasyon yok” değildir.

Coordinator metadata'yı input ve plan sonucuna taşır. Eksik/kesilmiş istasyon aramasında engine'in `infeasible` sonucunu `insufficient_data` olarak ayırır. Plan varsa kapsam uyarısı ve kullanılan snapshot bilgisi korunur; shared evaluation da bunu doğrular.

## API ve komutlar

```sh
pnpm --filter @chargeroad/api db:migrate
pnpm --filter @chargeroad/api stations:sync-epdk
pnpm --filter @chargeroad/api stations:import-epdk --file ../../artifacts/task7-sources/epdk-stations.json
pnpm --filter @chargeroad/api stations:publish --file NORMALIZED.json --raw-file SOURCE.bin
pnpm --filter @chargeroad/api stations:benchmark
pnpm --filter @chargeroad/api test:db
```

Offline import varsayılan olarak `PATH.manifest.json` okur; alternatif `--manifest PATH` verilebilir. Manifest: endpoint, `retrievedAt` (UTC), `rawSha256`, `httpStatus=200`. Snapshot ve manifest taşıma sırasında birlikte korunmalıdır. CLI/yayın yönetim HTTP ucu yoktur; periyodik yürütüm CR-021'de bağlanacak.

Salt okunur, mevcut catalogue rate limit'iyle korunan uçlar:

- `GET /v1/stations?west=32.7&east=32.9&south=39.8&north=40&limit=50&offset=0`
- `GET /v1/stations/:uuid`

Liste `{items,total,limit,offset}` döner; limit en fazla 100, viewport en fazla 5°×5°. Bu bir başlangıç map-query bütçesidir; ülke görünümü için kümelendirme/zoom politikası CR-016'da değerlendirilecek. Rota portuna sabit şehir/koridor sınırı koymaz. Özel ve planlama dışı yaşam döngülü lokasyonlar bu uçlardan sunulmaz. Ekipman/uyumluluk/saat bilinmiyorsa null/uyarı korunur. İstekler dış kaynağı çağırmaz.

## Doğrulama

163 API testi (DB/PostGIS/HTTP dahil, atlanan yok), 31 shared testi, üç paket typecheck ve API build başarılı. Gerçek snapshot tekrar import edildi: unchanged, aynı 17.165 UUID/50.259 soket beyanı korundu. Gerçek production API'de sınırlı viewport ve UUID detayı kontrol edildi; geçici test süreci kapatıldı.

[Benchmark](validation/task7-stations-benchmark.json): gerçek katalogda 4 eşzamanlı okuyucu, dört geometri türünde 1.000'er örnek. Kısa çizgi p95/p99 14,62/18,19 ms; iki yön 16,48/17,48 ms; uzun kıvrımlı çizgi 38,23/44,12 ms; seyrek geometri 4,70/5,78 ms. Hata ve pool kuyruğu görülmedi. EXPLAIN gerçek `station_heads_geog_idx` kullanımını gösterdi. [Production HTTP kontrolü](validation/task7-http-check.json).

Kısa yerel mikrobenchmark; canlı sağlayıcı, gerçek yol/karşı şerit, şarj süresi, yoğun telemetri veya sürdürülebilir üretim yük kapasitesi testi değildir. Sahte geometri gerçek navigasyon rotası sayılmadı.

## Sonraki kapılar

CR-008: yetkili canlı feed, fiziksel EVSE gruplarıyla eşleşme, güncellik ve durak/yedek yenileme. Statik EPDK cevabıyla canlı müsaitlik doğrulanamaz.

CR-009: kullanıcının konumlarından gerçek yol geometrisi, istasyon girişi/karşı yön ve sapma süresi.

CR-011–013: araç enerji/şarj profilleri, erişilebilirlik, durak seçimi ve yetersiz adayda yeniden arama. CR-006 pilot veri açıkları hâlâ geçerli.

CR-016/019/021: mobil harita, navigasyon ve dayanıklı scheduler. Redis veya LLM bu teslimde eklenmedi. Kaynak staging/published arası kopmuş işlerin uzlaştırılması ve arşiv retention politikası işletim görevi olarak açık; failed/running denemeler gizlenmez.
