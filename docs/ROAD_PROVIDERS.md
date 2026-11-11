# CR-009 — Yol sağlayıcısı teknik teslimi

Tarih: 2026-11-11. Yol adapter'ı, API, PostgreSQL koordinasyonu ve gerçek istasyon sapma hesabı uygulanmıştır. CR-009 teknik uygulama kapsamı DONE. Kullanıcı kararıyla kalan doğrulama/üretime hazırlık işleri [V1 çıkış backlog'una](V1_RELEASE_BACKLOG.md) taşındı; açıkların kendisi tamamlanmış değildir. Harita ekranı CR-016, navigasyon CR-019, EV durak optimizasyonu CR-013 kapsamındadır.

## Veri ve servis seçimi

Kullanıcının kendi haritasında kullanılabilir ve ücretsiz yol/hız verisi isteği üzerine ilk adapter Valhalla + OpenStreetMap oldu. Valhalla yalnızca otomobil yolu üretir; şarj durağı/SOC/enerji kararlarını bizim algoritmalarımız verir. LLM bağımlılığı eklenmedi.

OSM veri lisansı [ODbL](https://www.openstreetmap.org/copyright); veri için lisans ücreti alınmaması, sınırsız ücretsiz sunucu kapasitesi anlamına gelmez. Kaynak atfı, lisans ve gerekiyorsa türetilmiş veri paylaşımı koşulları korunmalıdır. Kendi harita renderer'ımızda gösterim mümkündür; taban harita tile sağlayıcısının lisansı ve barındırması ayrıca seçilecektir. Hız etiketlerinin Türkiye genelinde tam veya güncel olduğu iddia edilmez.

Geliştirme denemesi [FOSSGIS Valhalla](https://routing.openstreetmap.de/about.html) üzerinden yapıldı. 1 istek/sn sınırından daha temkinli 1,1 sn aralık, tanıtıcı User-Agent/X-Client-Id, kaynak ve harita düzeltme bağlantısı uygulanır. Bu bir üretim sözleşmesi değildir; [Valhalla başlangıç dokümanı](https://github.com/valhalla/valhalla/blob/master/docs/docs/start/introduction.md) son kullanıcı uygulamaları için işleticiyle iletişim ister. Mail/mesaj gönderilmedi, ücretli hizmet alınmadı. FOSSGIS'in bağlantılı tam Almanca koşul sayfası araştırmada zaman aşımına uğradı; tüm sözleşme koşulları doğrulanmış sayılmıyor.

[Overpass kamu sunucusu politikası](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) tüketici uygulamalarının kendi altyapısını kullanmasını ister. Bu nedenle kamu Valhalla/Overpass uçları `NODE_ENV=production` ortamında etkinleştirilemez. Üretim için kendi Valhalla ve OSM veri aktarımı veya uygun koşullu yönetilen servis gerekir; yalnızca endpoint değiştirmek veri/lisans değerlendirmesinin yerine geçmez. Kendi sunucumuz henüz kurulmadı.

## Provider sınırları

- `RoadAdapterRegistry` / `RoadShapeAdapter`: gerçek yol geometrisi, manevra, süre, alternatif ve ara durak. `RoutingProvider` core portu korunur. Bağımsız ikinci fixture adapter aynı servisten çalıştırılıyor.
- `RoadAttributeProvider`: yol özellikleri. `OsmWayAttributeProvider`, rota üzerindeki OSM way ID'lerini topluca okur; tüm ülkeyi HTTP ile taramaz. Aynı kimlik yoksa farklı servislerin shape indeksleri birleştirilmez.
- `RoadJsonClient`: paylaşılan önbellek, tekilleştirme, kota, timeout ve taşıma. Kaynak seçimi açık konfigürasyonladır; gizli ücretli fallback yoktur.
- Harita çizimi, geocoding, canlı trafik, yükseklik veri seti ve kişisel seyahat kaydı bu adapter'a bağlanmış ürün özellikleri değildir.

Gelecekte başka adapter registry'ye kaydedilebilir. Yol sağlayıcısının harita üzerinde yeniden kullanıma uygunluğu capability kapısından geçer; boolean bayrak bir hukuki izin kanıtı değildir. Veri önceliği/lisans incelemesi yeni adapter eklenirken yapılır. Süre matrisi henüz yok; küçük aday kümesine gerçek ara durak rotası kullanılıyor.

## Hız, zaman ve enerji kesimleri

[Valhalla route](https://valhalla.github.io/valhalla/api/route/api-reference/) ve [trace attributes](https://valhalla.github.io/valhalla/api/map-matching/) yanıtları normalize edilir. `edge_walk` yalnızca orijinal Valhalla şekline uygulanır; geometri ve indeks sürekliliği kontrol edilir. Eşleşmeyen attribute yanıtı uyarıyla elenir.

Hareket zamanı UTC alınır, başlangıç zaman dilimine çevrilip Valhalla'nın dakika hassasiyetinde gönderilir. Türkiye varsayılanı Europe/Istanbul; başka zaman dilimindeki rota için `originTimeZone` gerekir, sağlayıcıyla çelişirse 422 döner. Bu adapter canlı trafik kullanmaz: `traffic=none` ve uyarı vardır. Ayrı trafik adapter'ı henüz eklenmedi.

`expectedSpeedKph`, manevra sürelerini koruyan mesafe/zaman ortalamasıdır; sabit seyir veya hız sınırı olarak kullanılmaz. Manevra yuvarlamaları leg toplamına uzlaştırılır. Segmentler kaynak şekil/edge sınırlarında ayrılır; en fazla 1.000 m / 60 sn ve anlamlı eğim değişimi ek sınır oluşturur. İç yükseklik örnekleri korunur; eksik yükseklik sıfıra çevrilmez. Sağlayıcının döndürdüğü yükseklik veri setinin kaynağı/lisansı bağımsız doğrulanmadığı için metadata uyarısı kalır.

OSM `maxspeed` verisi, yönlü/motorcar etiketleri ve mph dönüşümü desteklenir. Koşullu etiket çözümlenemiyorsa sayısal sınır verilmez. `none` sınırsızdır; bilinmeyen `null` değerinden ayrı tutulur. `TR:urban`, `signals`, birden fazla değer gibi çözümlenmeyen etiketlerden yasal sınır tahmin edilmez. Valhalla sayısal değer döndürürse `provider_derived` olarak kaynaklandırılır; ham OSM tabelası gibi gösterilmez. Tür, kaynak, ham değer ve kapsanan/kapsanmayan mesafe sözleşmede bulunur.

## İstasyon sapması

`POST /v1/roads/station-access` gerçek ana yol geometrisi üzerinden PostGIS'ten koridor adaylarını alır. En çok üç seçili aday için aday konumundan yaklaşık 1 km önceki/sonraki ana yol noktaları arasında `ayrıl → istasyon → geri dön` rotası hesaplanır. Yeni yolun mesafe/süresinden değiştirilen ana yol alt parçası çıkarılır; durak iki kez sayılmaz. Ek değerler işaretlidir; daha kısa alternatif açık uyarı taşır.

İstasyon katalog koordinatına snap mesafesi 100 m'yi aşarsa veya ara durak ayrımı doğrulanamazsa erişilebilir diye etiketlenmez. Snap yakın olsa dahi `physicalAccessVerified=false`: tesis kapısı, bariyer, yaklaşım yönü ve özel erişim saha/bağımsız harita incelemesiyle doğrulanmalıdır. Koridor sonucu bounded olduğundan adayın bulunmaması fiziksel yokluk veya optimum EV rota kanıtı değildir. Gerçek yol bulunamaması ile kota/sağlayıcı hatası ayrı statülerdir.

## PostgreSQL ve işletim

Migration `009_road_provider_cache.sql` uygulanmıştır:

- `road_response_cache`: HMAC anahtar, en fazla 1 saat yanıt TTL, 45 sn sahiplik lease'i ve generation fencing. Aynı istek çok instance'ta tek dış sorguya dönüşür. Ham kullanıcı isteği kaydedilmez; önbellek yanıtı rota konumları içerdiği için erişimi sınırlandırılmalıdır.
- `road_provider_budget`: sağlayıcı başına günlük 100 HTTP çağrısı, ortak pacing ve 429/5xx için ortak bekleme. Bu servislerde çağrı sayılıyor; gelecekte krediyle fiyatlanan adapter için kredi hesabı ayrıca gerekir.
- `osm_way_attributes`: yalnızca hız etiketleri, OSM way ID, kaynak zamanı/alınma zamanı, lisans; 1 günlük TTL. Eksik etiket hız sıfır değildir.

İş başına en fazla 12 acquisition eylemi (cache isabeti de sayılır), üç toplam alternatif, üç istasyon, 20.000 geometri noktası ve 10.000 segment. Overpass tek sorguda en fazla 200 eksik way alır; daha fazlası eksik kalır. Ana yol timeout'u 25 sn; opsiyonel Overpass en fazla 8 sn; uçtan uca 90 sn ve istemci bağlantı iptali uygulanır. Ağ sırasında açık DB transaction tutulmaz. Yoğunlukta bilinmeyen alanlar uyarıyla taşınır; yol/geometri uydurulmaz.

Redis gerekmiyor; paylaşılan durum PostgreSQL'dedir. Gizli HMAC anahtarı mevcut `RATE_LIMIT_IP_HASH_SECRET` üzerinden, ayrı domain önekiyle kullanılır. Kişisel geçmiş ve kullanıcı sahiplik endpoint'i açılmaz.

`roads:cleanup` süresi dolmuş yanıtları ve way etiketlerini siler, aktif lease'leri korur. TTL sorguda otomatik geçersizleşir; fiziksel silme için komutun periyodik çalıştırılması gerekir. Bu görev scheduler kurmadı. `roads:validate` ve ham probe çıktıları yerel geliştirme araçlarıdır; `artifacts/` git dışındadır, gerçek kullanıcı seyahatleri bu doğrulama dosyalarına kaydedilmemelidir.

## Kullanım ve kanıt

`.env.example` varsayılanı kapalıdır. Yerelde pilot ve etiket denemesi açık, anahtar gerekmez:

```env
ROAD_ROUTING_PILOT_ENABLED=true
ROAD_ROUTING_PROVIDER_ID=valhalla-osm
ROAD_ROUTING_BASE_URL=https://valhalla1.openstreetmap.de
ROAD_OSM_TAGS_ENABLED=true
ROAD_OSM_TAGS_URL=https://overpass-api.de/api/interpreter
```

`POST /v1/roads/routes` ortak `RoadRoutingRequest` alır. Örnek şekil `roads/__tests__/fixtures.ts`; CLI doğrulama dosyasında `segmentationPolicy` verilmezse sunucu varsayılanları eklenir. Koordinatlar istek girdisidir, Ankara ürün kısıtı değildir.

```powershell
pnpm --filter @chargeroad/api db:migrate
pnpm --filter @chargeroad/api roads:validate ../../artifacts/task9-valhalla/request.json
pnpm --filter @chargeroad/api roads:benchmark
pnpm --filter @chargeroad/api roads:cleanup
pnpm --filter @chargeroad/api test:db
```

[Gerçek pilot raporu](validation/task9-road-validation.json): Ankara örneği 3.845 m, 512,5 sn, 207 kesim; tüm kesimlerde yükseklik profili, canlı trafik yok. Gerçek istasyon sapması +1.170 m / yaklaşık +137,53 sn, snap yaklaşık 6,72 m, fiziksel erişim doğrulanmamış. HTTP 200; tekrarda ek dış çağrı 0. İlk opsiyonel hız denemesi 8 sn timeout'a takıldı; doğrudan tanı sorgusu Overpass'tan HTTP 502 ve kapasite dolu açıklaması döndürdü. Bu örnekte sayısal hız kapsaması **0 m**; çalışan ücretsiz hız alanı doğrulaması tamamlandı diye sunulmaz.

[Yerel performans raporu](validation/task9-road-benchmark.json): 1.000 normalizasyon ve dört eşzamanlı worker ile 1.000 PG cache isabeti; p95/p99 ayrı. Dış servise yük testi uygulanmadı. Bu değerler küçük şehir örneği ve geliştirici bilgisayarı içindir, üretim SLA veya uzun rota ölçümü değildir.

V1 öncesi kapanacak işler [V1-ROAD-001–006](V1_RELEASE_BACKLOG.md) altında kabul ölçütleriyle izlenir: gerçek dolu hız alanı, bağımsız tesis erişimi, geniş rota örneklemi, üretim hosting, yükseklik kaynağı ve periyodik fiziksel temizlik. Bu devir sonraki görevleri açar; üretim korumalarını kaldırmaz. Harita ekranı bu teslimle eklenmedi.
