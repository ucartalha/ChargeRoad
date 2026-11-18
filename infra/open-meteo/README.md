# Self-hosted Open-Meteo (DWD ICON, Türkiye) — yerel pilot runbook

2026-11-18, kullanıcı kararı: MET Norway günlük kotası (1.000 istek/UTC günü) referans koşularında doldu ve planlar bayat hava verisi nedeniyle başarısız oldu. Ticari ve ölçeklenebilir seçenek olarak açık kaynak Open-Meteo sunucusu yerelde çalıştırılır. Bu kurulum **geliştirme pilotudur**, üretim onayı değildir. MET varsayılan sağlayıcı olarak kalır.

## Bileşenler (`compose.yaml`)

| Servis | Ne yapar | Erişim |
|---|---|---|
| `api` | `openmeteo-api serve`; aynı `/v1/forecast` API'si | `127.0.0.1:8090` (yalnız yerel) |
| `sync` | AWS açık veri kovasından (`s3://openmeteo`, us-west-2) DWD ICON'u eşitler: her tur ayrı süreç, en fazla 15 dk (`timeout 900`), turlar arası 10 dk. Model verisi 12 saatten eskiyse `docker ps`'te `unhealthy` | dışarıya yalnız indirme |
| `meta` | `busybox httpd`; volume'u **salt okunur** sunar. API model koşu zamanını yayımlamadığı için `*/static/meta.json` buradan okunur | `127.0.0.1:8091` (yalnız yerel) |

- İmaj digest ile sabit: `ghcr.io/open-meteo/open-meteo@sha256:bf94e8b3…846a` (2026-11-03 build). Güncelleme ayrı karar ve duman testi ister.
- Volume: `chargeroad-open-meteo-data` (~11 GB; ~9,8 GB'ı Copernicus DEM90).
- Model: `dwd_icon_global_native` (DWD ICON küresel, yerel ~13 km ızgara, saatlik, ~7,5 gün, 6 saatte bir koşu). API'de `models=dwd_icon`.
- Değişkenler: `temperature_2m, wind_u_component_10m, wind_v_component_10m, precipitation, pressure_msl, snow_depth`.
- Kutu: `--bounding-box 35.5,25.5,42.5,45.0` (Türkiye). Kutu dışı noktalar `null` döner; adaptör bunu "eşitlenen alan dışında" hatası sayar.
- `--past-days 2`: eşitlenen dosyalar 2 günden eski olunca bırakılır.

## İlk kurulum (repo kökünden)

```powershell
docker compose -f infra/open-meteo/compose.yaml pull
# Statik ızgara dosyaları kutulu eşitlemeden önce gerekir (otomatik inmez):
docker run --rm -v chargeroad-open-meteo-data:/app/data ghcr.io/open-meteo/open-meteo@sha256:bf94e8b39761b59a91bd04bb926b3834cad00eaf71f1aa64b2fd17fbe987846a sync dwd_icon_global_native static
docker run --rm -v chargeroad-open-meteo-data:/app/data ghcr.io/open-meteo/open-meteo@sha256:bf94e8b39761b59a91bd04bb926b3834cad00eaf71f1aa64b2fd17fbe987846a sync dwd_icon_global_eps_native static
# Sıcaklığın noktanın yüksekliğine indirgenmesi için 90 m DEM (~9,8 GB, ~22 dk; kutu DEM'i fazla daraltmıyor):
docker run --rm -v chargeroad-open-meteo-data:/app/data ghcr.io/open-meteo/open-meteo@sha256:bf94e8b39761b59a91bd04bb926b3834cad00eaf71f1aa64b2fd17fbe987846a sync copernicus_dem90 static --bounding-box 35.5,25.5,42.5,45.0
docker compose -f infra/open-meteo/compose.yaml up -d
# Statik dosyalar API açıldıktan sonra indiyse API'yi yeniden başlat (eksik ızgara durumu önbelleğe alınabiliyor):
docker compose -f infra/open-meteo/compose.yaml restart api
```

## Duman testi

```powershell
curl.exe "http://127.0.0.1:8090/v1/forecast?latitude=39.92&longitude=32.85&models=dwd_icon&hourly=temperature_2m,wind_speed_10m,pressure_msl,snow_depth&cell_selection=nearest&timezone=GMT&forecast_days=1"
curl.exe http://127.0.0.1:8091/dwd_icon_global_native/static/meta.json
docker logs --tail 5 chargeroad-open-meteo-sync
```

Beklenen: Ankara için `elevation` ≈ 876 (DEM), boş olmayan seriler; meta'da `last_run_initialisation_time`. Kutu dışındaki bir nokta (ör. 50.11, 8.68) `null` seri döner.

## API'yi bu sağlayıcıyla çalıştırma

Varsayılan `met-norway`'dır. `.env` dosyasını değiştirmeden süreç ortamıyla seçilir (dotenv süreç ortamını ezmez):

```powershell
$env:WEATHER_ENABLED='true'; $env:WEATHER_PROVIDER_ID='open-meteo-local'
pnpm --filter @chargeroad/api start
```

İsteğe bağlı: `WEATHER_OPEN_METEO_ENDPOINT` (varsayılan `http://127.0.0.1:8090`), `WEATHER_OPEN_METEO_META_ENDPOINT` (`http://127.0.0.1:8091`), `WEATHER_OPEN_METEO_MODEL` (`dwd_icon`), `WEATHER_OPEN_METEO_DOMAIN` (`dwd_icon_global_native`). Uç noktalar yalnız loopback `http` olabilir; aksi halde API açılmaz. MET'in koşul/User-Agent kapısı bu sağlayıcıda aranmaz (dış hizmete istek yok).

## Lisans ve atıf

- Sunucu: AGPL-3.0; **değiştirilmeden** çalıştırılır. Değiştirilmiş bir sürümü ağ hizmeti olarak sunmak kaynak paylaşımı gerektirir.
- Veri: Open-Meteo açık verisi CC BY 4.0; kaynak Deutscher Wetterdienst (DWD) ICON. Uygulamada atıf zorunludur: "Weather data: DWD ICON via Open-Meteo (CC BY 4.0)". Adaptör bu atıfı her tahmine yazar; mobil görünür atıf ayrı iş (P1).
- Open-Meteo'nun barındırılan ücretsiz API'si ticari kullanıma kapalıdır; burada kullanılmaz. Kendi sunucuda ticari kullanım belgelerde açıkça serbesttir.

## Yapılmayacaklar

- `docker compose down -v` veya volume silme: DEM'in yeniden indirilmesi ~22 dk ve ~10 GB trafik demektir.
- Portları LAN'a açmak. Telefon yalnız ChargeRoad API'sine bağlanır; hava sunucusuna doğrudan değil.
- Sağlayıcının barındırılan `api.open-meteo.com` adresine yük testi.

## Bilinen açıklar

- Sıcaklık/rüzgâr doğruluğu MET ile ve sahayla karşılaştırılmadı (MET kotası ölçüm sırasında doluydu).
- `cell_selection=nearest` kullanılır; varsayılan `land` göl/kıyı kenarında ~20 km uzaktaki bir hücreyi seçebiliyordu.
- Yerel ızgara verisi S3'e geç düşüyor (2026-11-17: 12Z koşusu S3'te 16:52Z, yerelde 21:29Z; o sırada düzenli ızgaralı `dwd_icon`'da 18Z hazırdı). Tazelik kuralı yerel kullanılabilirlik zamanına bakar; sunulan koşu birkaç saat geride olabilir.
- Ağ adresi değişirse telefon için Expo'yu yeni Wi-Fi IP'siyle başlat (`EXPO_PUBLIC_API_URL`); hava sunucusu loopback'te kaldığı için etkilenmez.
- Üretim dağıtımı (sunucu, yedeklilik, izleme, disk) tasarlanmadı.
