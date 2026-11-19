# Hava yolu: tekrarlanan doğrulamanın kaldırılması (2026-11-19)

Kapsam: "hava sorgu sınırı ve hız" çalışmasının Adım 1'i. Çıktıyı değiştirmeyen hızlandırma; algoritma sürümleri değişmedi.

## Bulgu
- Sınır (`WEATHER_QUERY_BUDGET`) segment projeksiyonu sayar: ana rota segmenti × 32. İstanbul→Kelkit ~43.000'de durur.
- Sınır 64× / 128× / sınırsız: 5 referans planın hiçbiri değişmedi (873,3 / 887,3 / 910,9 / 332,6 / 344,6 dk); yalnız arama süresi arttı.
- Projeksiyonların %94'ü (segment, tam saat) olarak tekildir; aynı segment 15 dk içinde %40 tekrar eder.
- CPU profili (2 Kelkit planı): zod 1,22 s, GC 1,21 s, sorgu önbellek anahtarı (kanonik JSON + SHA-256) ~0,8 s, hava normalizasyonu ~0,3 s. Hava servisi her tahmini `normalizeWeather` içinde zaten `weatherForecastSchema` ile doğruluyor; planlama oturumu aynı tahminleri ikinci kez, servis de oturumun kendi kurduğu sorguları yeniden şemadan geçiriyordu.

## Değişiklik
`apps/api/src/weather/trusted-weather.ts`: `trustedWeatherForecasts` (WeatherService çıktısı) ve `trustedWeatherQueries` (oturumun kurduğu sorgu dizisi). Oturum güvenilir tahmin dizisini yeniden parse etmez; servis güvenilir sorgu dizisinde yalnız şema parse'ını atlar (en fazla 10.000 sorgu ve tekrar eden id kontrolleri sürer). Diğer tüm diziler (başka sağlayıcı, test sahteleri, HTTP) eskisi gibi parse edilir.

## Eşdeğerlik
- 5 referans plan (kalkış 2026-11-20T07:00Z), hızlı yol kapalı/açık A/B, aynı anda: plan özeti + segment SOC/enerji hash'i **birebir eşit**.
- Doğrulama kolu: atlanan her parse için `deepStrictEqual(schema.parse(x), x)`: 308.284 sorgu, 154.142 tahmin, 0 fark.
- Testler: `trusted-weather.spec.ts` (5) önce 3 FAIL, sonra PASS; API 1.177 PASS, 154 SKIPPED (DB; `test:db` NOT_RUN).

## Hız (süreç-içi, aynı makine, A/B dönüşümlü 2 tur, önbellek sıcak)
| Rota | Önce (ms) | Sonra (ms) |
|---|---|---|
| İstanbul(Kadıköy)→Kelkit | 4.726 / 4.604 / 4.378 / 4.251 | 4.291 / 4.014 / 3.891 / 3.836 |
| İstanbul(batı)→Kelkit | 6.074 / 6.231 / 5.638 / 5.553 | 5.719 / 5.651 / 5.294 / 5.132 |

Kazanç plan başına ~0,4–0,5 s (~%9–11). Telefon üzerinden uçtan uca ölçülmedi. Sınırın kendisi değişmedi; yeniden tanımlanması (Adım 2) ayrı karar ve optimizer sürüm artışı gerektirir.
