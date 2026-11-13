# Valhalla 3.9.1 + DEM yerel pilot runbook

Bu kurulum üretim onayı değildir. Mevcut `compose.yaml` ve `custom_files` korunur: eski 8002 ve DEM'li 8003 örneklerine dokunmaz. Yeni `compose.dem.yaml`, ayrı Compose projesi ve varsayılan **8004** portuyla çalışır. Port 3000/3001 API'leri, PostgreSQL ve OrderLane bu komutların hedefi değildir. `down -v`, `rm -f`, dataset üzerinde recursive silme/taşıma kullanmayın.

## Veri yerleşimi ve kaynak

Hazırlanmış dizinde `valhalla.json`, `valhalla_tiles.tar`, `valhalla_tiles/`, `elevation_data/*.hgt`, gerekiyorsa `admins.sqlite` ve `timezones.sqlite` bulunur. Config yolları container içinde `/custom_files/...` olmalı. Host `C:\...` ve `127.0.0.1:8004`, container içi `/custom_files` ve `8002` ile aynı şey değildir.

`manifest.example.json` gerçek dataset manifesti değildir. Her build için ürün/sürüm/indirme tarihi/kaynak URL, PBF ve tile extract SHA-256, HGT dosya listesi/SHA-256, DEM lisansı/datum, config hash ve benzersiz build ID kaydedin. HGT'nin varlığı SRTM ürününü, lisansını veya bağımsız yol kotu doğruluğunu kanıtlamaz. Kaynağı bilinmeyen alanlar `unknown`/null kalır. Mevcut yaklaşık 2 GB DEM'nin lisans/provenance kabulü açıktır. Gerçek PBF/HGT/GPH/tar dosyaları Git dışında tutulur; demo manifestte gerçek veri varmış gibi hash yazılmaz.

OSM: [Geofabrik Türkiye](https://download.geofabrik.de/europe/turkey.html), [ODbL/atıf](https://www.openstreetmap.org/copyright). DEM için gerçek indirme sağlayıcısının ürün/lisans/datum belgesini kaydedin; kaynak bilinmiyorsa bir lisans varsaymayın.

## Başlatma ve sağlık (PowerShell 5.1, repo kökünden)

Yalnız dosya/Compose doğrulama; servis başlatmaz:

```powershell
docker compose -p chargeroad-dem-hardening -f .\infra\valhalla\compose.dem.yaml config --quiet
```

Mevcut 8003 datasetini **salt okunur** kullanıp ayrı 8004 runtime başlatma (port çakışıyorsa boş bir host port seçin):

```powershell
$env:VALHALLA_DEM_DATA_DIR=(Resolve-Path .\infra\valhalla\elevation-pilot).Path; $env:VALHALLA_DEM_PORT='8004'; docker compose -p chargeroad-dem-hardening -f .\infra\valhalla\compose.dem.yaml up -d router
```

Runtime doğrudan `valhalla_service` çalıştırır; scripted download/build entrypoint'ini atlar. Her açılışta graf üretmez. Eksik config/tar/DEM dizininde fail-fast yapar; HTTP health yalnız servis erişimini gösterir, sayısal DEM kabulü değildir. Hazırlanan config'te uzaktan tile/DEM indirme URL'leri kapalı olmalı; runtime'a bilinmeyen fetch bağımlılığı taşımayın.

```powershell
docker compose -p chargeroad-dem-hardening -f .\infra\valhalla\compose.dem.yaml ps
```

Sayısal height + 30 m route profili için tekil loopback smoke (yük testi değildir):

```powershell
powershell.exe -NoProfile -File .\infra\valhalla\smoke.ps1 -BaseUrl http://127.0.0.1:8004
```

Yeni pilotu yeniden başlatma/durdurma; mevcut 8002/8003 konteynerlerini hedeflemez:

```powershell
docker compose -p chargeroad-dem-hardening -f .\infra\valhalla\compose.dem.yaml restart router
```

```powershell
docker compose -p chargeroad-dem-hardening -f .\infra\valhalla\compose.dem.yaml stop router
```

## Ayrı build, güncelleme ve kurtarma

İzinli PBF/HGT girdilerini **ayrı** `datasets/staging` içine önceden yerleştirin. İmajın 3.9.1 scripted entrypoint'i `build_tiles` ile config/admin/timezone/elevation/tar hazırlayabilir; build aşamasında yardımcı verileri ağdan indirebilir. Bu ağır adım bu teslimde otomatik çalıştırılmaz. `force_rebuild=True`, `serve_tiles=False` yalnız build servisine aittir. Mevcut pilot dizinini build mount'u yapmayın.

```powershell
$env:VALHALLA_BUILD_DATA_DIR=(Resolve-Path .\infra\valhalla\datasets\staging).Path; docker compose -p chargeroad-dem-hardening -f .\infra\valhalla\compose.dem.yaml --profile build run --rm graph-build
```

Bu `--rm`, yalnız bu komutun oluşturduğu geçici build container'ını kaldırır; mevcut servis/volume silmez. Gerçek build tepe RAM, disk ve süreleri ölçülmedi; yeterli kaynak veya bitiş süresi garantisi verilmez. Yeni grafı ayrı bir sürüm dizininde üretin; manifest/checksum/30 m QA ve yeni portta smoke sonrası API'yi kontrollü devredin. Eski dataset/servisi kabul bitene kadar koruyun. Geri dönüş, eski dataset/endpoint ve onun cache namespace'ini yeniden seçmektir. Çalışan grafı yerinde değiştirmeyin.

## API, cache ve bütçe

Varsayılan `.env` değiştirilmez. Yeni kodu doğrulayan CLI geçici ve loopback API açar; mevcut 3001/3000 süreçlerini yeniden başlatmaz:

```powershell
pnpm --filter @chargeroad/api exec ts-node scripts/smoke-valhalla-dem.ts
```

Normal runtime için seçilecek alanlar: `ROAD_ROUTING_DEPLOYMENT_MODE=self_hosted`, benzersiz provider/endpoint, `ROAD_ROUTING_ENGINE_VERSION=3.9.1`, gerçek `ROAD_ROUTING_GRAPH_VERSION` / `ROAD_ROUTING_DEM_VERSION` veya `unknown`, her dataset değişiminde **yeni** `ROAD_ROUTING_CACHE_REVISION`. Bu alanlar HTTP raw cache HMAC kimliğine ve rota source sürümüne katılır. Bilinmeyen sürümler otomatik değişim algılaması sağlamaz: graf/DEM aynı URL'de güncellenirse namespace'i mutlaka değiştirin. TTL güvenlik ağı en fazla bir saattir. Örnek `ROAD_ROUTING_CACHE_REVISION=local-build-20261112-a`; bu örnek dataset provenance kanıtı değildir.

Self-hosted pacing/backoff namespace'i endpoint'e bağlıdır; 3000/3001 aynı endpoint'i kullanıyorsa ortaktır, farklı endpoint'ler ayrıdır. Varsayılan iç servis için dış API günlük 100 kredi/istek sınırı uygulanmaz; mevcut pacing, admission, iş ve yanıt sınırları korunur. İstenirse `ROAD_ROUTING_SELF_HOSTED_DAILY_SAFETY_LIMIT` açık iç güvenlik tavanıdır. Eski `ROAD_ROUTING_DAILY_REQUEST_LIMIT` yalnız non-production loopback için bu tavana uyarlanır; ücretli sağlayıcı kotası değildir. Overpass kamu limiti ve production kamu demo engeli değişmez. Dış sağlayıcı eski bütçe kayıtları sıfırlanmaz.

`elevationQuality=modelled`, yalnız DEM var diye `verified` değildir. Valhalla 3.9.1'e özgü `-500`/`-32768` no-data null olur; başka sağlayıcılar için genel negatif rakım eşiği yoktur. 30 m ham profil korunur, 300 m kayan eğim yalnız diagnostiktir. Kısmi/null profil asla sessiz sıfır eğime çevrilmez; verified-only enerji politikası modelled veriyi reddeder. Saha/lisans/gerçek yol kotu ve üretim kapasitesi açık kabul kapılarıdır.
