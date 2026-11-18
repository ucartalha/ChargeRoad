# Kendi barındırdığımız Open-Meteo (DWD ICON) — yerel pilot, 2026-11-18

Başlangıç HEAD `92e6f54` (main; mobil arayüz değişiklikleri commit edilmemiş çalışma ağacında, bu işle ilgisiz). Tetikleyici: MET günlük bütçesi (1.000/UTC günü) 2026-11-17'de doldu; Bursa→Ankara plan üretemedi. Ölçümler yerel makinede (Docker Desktop, 20 CPU, ~8 GB Docker belleği), Valhalla 8004, pilot profil, enerji 1.4.0, optimizer 1.6.0. Offline pilot ölçümüdür; doğruluk veya saha kabulü değildir.

## Kurulum

| Öğe | Değer |
|---|---|
| İmaj | `ghcr.io/open-meteo/open-meteo@sha256:bf94e8b3…846a` (2026-11-03 build, ~1,0 GB) |
| Model | `dwd_icon_global_native` (API: `models=dwd_icon`), Türkiye kutusu `35.5,25.5,42.5,45.0` |
| Değişkenler | `temperature_2m, wind_u/v_component_10m, precipitation, pressure_msl, snow_depth` |
| İlk eşitleme | ICON: 12 dosya ~10 sn (kutu sayesinde dosya başına ~1 MB aktarım); statik ızgara 81 + 36 MB; DEM90 9,8 GB / 22 dk |
| Volume | ~11 GB |
| Yanıt süresi | Türkiye noktası 6–10 ms; kutu dışı (Frankfurt) `null` seri |
| Model meta | `last_run_initialisation_time` 2026-11-17T12:00Z; S3'te 16:52Z, yerel eşitlemeden sonra `last_run_availability_time` 21:29Z |

Kurulumda görülen ve runbook'a yazılan engeller: imaj sürümünde `dwd_icon` yerel ikosahedral ızgarayı okuyor (ilk deneme `dwd_icon` regrid verisi işe yaramadı); `static` ızgara dosyaları kutulu eşitlemede inmiyor ve EPS ızgarası da gerekiyor; API eksik ızgara durumunu yeniden başlatılana kadar tutuyor; DEM olmadan yükseklik hücre değeri (Ankara 1200 m → DEM ile 876 m, sıcaklık 6,5 → 8,7 °C).

## Uçtan uca planlama (başlangıç %95, rezerv %10, varış %20, kalkış ≈ şimdi + 10 dk)

MET satırları ~1 saat önce MET önbelleğiyle (bütçe dolu, `MET 0` istek) alınan enerji 1.4.0 koşusu; aynı saat ve aynı hava değildir. Fark hava kaynağı ve saatten gelir; hangisinin doğru olduğunu göstermez.

| Rota | MET önbelleği (km / dk / durak) | Yerel Open-Meteo (km / dk / durak) |
|---|---|---|
| İstanbul→Ankara | 458,5 / 352,3 / 3 | 458,5 / 342,5 / 3 |
| Bursa→Ankara | plan yok (`NO_VALID_PLAN_WITHIN_DATA_BUDGET`) | 386,5 / 311,4 / 1 |
| İstanbul→İzmir | 480,6 / 363,6 / 4 | 480,6 / 361,4 / 4 |
| Ankara→Antalya | 526,7 / 435,1 / 2 | 526,7 / 433,9 / 2 |
| Kadıköy→Sarıyer | 27,6 km, varış %85,8 | 27,6 km, varış %85,7 |

Son koşuda 104.979 hava sorgusunun tamamı `available`; sunucu süresi 4,8–14,8 sn.

İlk koşularda İstanbul→İzmir ve Ankara→Antalya `WEATHER_CORE_OR_FRESHNESS_MISSING` verdi. Teşhis: varsayılan `cell_selection=land` İznik Gölü yakınında (40,45 / 29,35) 19,5 km uzaktaki hücreyi seçti, adaptörün 15 km korkuluğu yanıtı reddetti ve önbellek katmanı tek hatada sağlayıcıyı 60 sn engelledi. Düzeltme: `cell_selection=nearest` (5,7 km) ve yerel sağlayıcıda geçersiz tek yanıtın yalnız o anahtarı geri çekmesi (MET davranışı değişmedi).

## MET ile karşılaştırma (2026-11-18 ~20:50Z)

Aynı 12 nokta (İstanbul, İzmit, Bursa, Bolu, Ankara, Kırıkkale, Sivas, Erzincan, Kelkit, Gümüşhane, Balıkesir, Afyon) ve +1…+24 saatlik 7 an; her iki seri de ChargeRoad normalizasyonundan geçirildi (MET'e 12 istek). Bu bir doğruluk ölçümü değildir; iki model arasındaki farktır.

| Ölçü (n=84) | Open-Meteo ICON − MET |
|---|---|
| Sıcaklık sapması / MAE | +1,72 °C / 1,81 °C |
| Rüzgâr sapması / MAE | −4,0 km/s / 5,2 km/s |

En büyük sıcaklık farkı İzmit (ort. +3,7 °C; MET kotu 11 m, ICON+DEM 143 m) ve Gümüşhane/Afyon (~+3 °C). ICON daha sıcak ve daha az rüzgârlı olduğundan aynı rotada Open-Meteo ile enerji tahmini MET'e göre biraz iyimser olur. Hangisinin doğru olduğu saha ölçümüyle belirlenmeli.

## İşletim olayı: senkron döngüsünün donması

2026-11-17 22:30Z'den 2026-11-18 20:43Z'ye kadar (`--repeat-interval` iç döngüsü) hiçbir eşitleme turu çalışmadı; konteyner `Up` görünüyordu. Yerel veri 17 Kasım 18Z koşusunda kaldı ve tazelik kuralı gereği planlar `NO_VALID_PLAN_WITHIN_DATA_BUDGET` / `WEATHER_CORE_OR_FRESHNESS_MISSING` ile düştü (telefondan gelen istekler dahil). Olası neden: makine uykudayken asılı kalan indirme. Düzeltme: her tur `timeout 900` ile ayrı süreç + 10 dk bekleme; senkron konteynerine yerel model verisi 12 saatten eskiyse `unhealthy` diyen healthcheck. Yeniden başlatmadan sonra 18 Kasım 12Z koşusu 20:44Z'de indi.

## Testler

- `src/weather/__tests__/open-meteo.spec.ts` (6): URL, dört ondalık, `cell_selection=nearest`; koşu zamanları, UTC saatleri, sonraki saat yağışı, kar derinliği; normalizasyonda kar; birim/kutu dışı/uzak hücre reddi; MET limitleri değişmedi, yerel limitler ayrı; loopback zorunluluğu ve MET koşul kapısının MET'te sürmesi.
- `pnpm --filter @chargeroad/api typecheck` PASS; `pnpm --filter @chargeroad/api test` 81 suite / 1135 test PASS, 14 suite / 154 test SKIPPED (DB; `TEST_DATABASE_URL` yok → NOT_RUN). Önbellek katmanındaki yerel-sağlayıcı geri çekme değişikliği DB entegrasyon testinde koşulmadı (NOT_RUN); yalnız canlı koşuda gözlendi.

## Açık

- Yerel ızgara verisi (`dwd_icon_global_native`) S3'te düzenli ızgaralı `dwd_icon`'dan bir koşu geride: 22:05Z'de yerel ızgarada 12Z, düzenli ızgarada 18Z (21:22Z) vardı. Tazelik `sourceUpdatedAt` (yerel kullanılabilirlik) ile değerlendirilir ve 12 saati geçmedi; ancak sunulan koşu ~6 saat daha eski olabilir.

- MET ve sahayla doğruluk karşılaştırması (aynı saat, aynı noktalar) — MET bütçesi sıfırlanınca.
- Mobil görünür atıf, üretim dağıtımı (sunucu, izleme, yedeklilik), imaj güncelleme politikası.
