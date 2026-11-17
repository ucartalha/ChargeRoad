# MET pacing gözden geçirmesi — 2026-11-17

Başlangıç HEAD `ff0af1aa9479c0ffe4a3c5ec7954d7a3b348c15c`; çalışma ağacında E1 ve saat toleransı değişiklikleri commit edilmemiş hâlde vardı. **Teknik kabul: PASS. Üretim yük kabulü değildir.** Algoritma sürümleri değişmedi; değişiklik yalnız edinim zamanlamasıdır.

## Teşhis

Telefondan gelen gerçek plan (`362acc0e…`, 444,6 km, 23 yeni MET konumu): sunucuda 21,6 sn; tek hava çağrısı 12,0 sn, hava edinimi toplamı 13,3 sn, MET HTTP toplamı yalnız 3,7 sn. Eski kural (500 ms aralık, 2 eşzamanlı) 23 isteğin başlatılması için en az ~11,5 sn gerektiriyordu; aradaki ~8 sn ağ değil, kendi pacing beklememizdi. Optimizer'ın ilk adımı ana rotanın tüm hava noktalarını istediği için bu bekleme kritik yolun üstündeydi; önden edinim yalnız ~0,3 sn'lik istasyon sorgusuyla paralel çalışabileceğinden reddedildi.

## MET kuralları (2026-11-17'de okundu)

- ToS (son revizyon 2026-11-05): toplam trafik saniyede 20 isteğin altında olmalı; sınır uygulama toplamıdır, istemci başına değil. Üzeri özel anlaşma ister ve 429/engelleme riski taşır.
- Ayrı bir eşzamanlılık sınırı yok; istekler aynı anda yığılmamalı.
- `Expires` dolmadan tekrar istek yok, `If-Modified-Since` kullanılmalı, koordinat en fazla 4 ondalık, kimlikli User-Agent zorunlu, ticari kullanım CC BY 4.0 ile serbest.

Kaynaklar: [Terms of Service](https://api.met.no/doc/TermsOfService), [FAQ](https://api.met.no/doc/FAQ), [Locationforecast HowTO](https://docs.api.met.no/doc/locationforecast/HowTO), [Status codes](https://api.met.no/doc/StatusCodes).

## Değişiklik

`WEATHER_POLICY.minIntervalMs` 500→100, `maxConcurrency` 2→4. Aralık PG'deki ortak sağlayıcı durumu (`next_allowed_at`, `FOR UPDATE`) üzerinden bütün süreçler için uygulanır; üst sınır 10 istek/sn (MET sınırının yarısı). Günlük 1000, plan başına 128, lease 15 sn, fetch 5 sn, deadline 30 sn, backoff/fencing ve koşullu GET aynı. Yeni `weather-pacing-policy.spec.ts` bu değerleri ve 10 istek/sn tavanını sabitler.

## Ölçüm (n=1, farklı rotalar)

| | Önce: telefon isteği, 23 MET | Sonra: İstanbul–Ankara, 24 MET |
|---|---:|---:|
| En uzun tek hava çağrısı | 12,0 sn | 3,25 sn |
| Hava edinimi toplamı | 13,3 sn | 4,6 sn |
| MET HTTP toplamı | 3,7 sn | 4,0 sn |
| Sunucu çalışma süresi | 21,6 sn | 13,2 sn |
| İstemci toplam | — | 15,3 sn |

Rotalar farklı olduğundan toplam sürelerin farkı yalnız havaya bağlanmaz; hava kritik yolundaki ~8,8 sn azalma iki koşudaki aynı büyüklükteki MET isteği sayısıyla tutarlıdır. Sonraki plan 468,6 km, 2 durak, planned.

## Testler

| Komut | Sonuç |
|---|---|
| `weather-pacing-policy.spec.ts` (önce kırmızı) | PASS 3/3 |
| `jest src/weather` | 74 PASS, 25 SKIPPED (DB) |
| `pnpm --filter @chargeroad/api typecheck` | PASS |
| `pnpm --filter @chargeroad/api test` | 1076 PASS, 154 SKIPPED, 4 FAIL (önceden var olan `latency-polling.spec.ts`, `__DEV__`) |
| `weather-cache.integration.spec.ts` (pacing/lease/fencing, gerçek PG) | NOT_RUN — izole `TEST_DATABASE_URL` yok |

## Açıklar ve geri dönüş

- 4 eşzamanlı claim, sağlayıcı satırındaki `FOR UPDATE` kilidinde daha fazla yarışma yaratır (lock_timeout 250 ms). Gerçek PG yarışı ve çok kullanıcılı yük ölçülmedi.
- Çok sayıda eşzamanlı kullanıcıda toplam hız yine 10 istek/sn ile sınırlıdır; günlük 1000 koruması kullanıcı arttıkça ilk darboğaz olur (W4/W5).
- Geri dönüş: `weather-policy.ts` içindeki iki değeri 500/2'ye döndürmek.
