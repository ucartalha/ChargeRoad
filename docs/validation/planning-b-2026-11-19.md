# Planlama B aşaması — doğrulama (2026-11-19)

Kapsam (kullanıcı kararı, "5 maddeyi B'nin kapsamına al"): gereksinim kadar şarj, devamı gözeten istasyon seçimi, uç nokta toleransı, alternatif rotalar, segment/bütçe/polling/istasyon sorgusu sınırları. Sürüm: `chargeroad-optimizer/1.7.0`, `station-access/1.1.0`, `seed-charge-trim/1.0.0`, `broad-search/1.0.0`.

## Yapılanlar

| Madde | Değişiklik | Durum |
|---|---|---|
| Gereksinim kadar şarj | Tohum, %80 üstü şarjı sonraki bacağın gereksinimine (+0,05 puan) indirip bacağı yeniden doğrular | Yapıldı (`seed-charge-trim.spec.ts`) |
| Alternatif rotalar | Tek koridor; plan yoksa sıradaki alternatif | Yapıldı |
| Devamı gözeten seçim | 15 dk'yı aşan erişim sapması bölme adayı olmaz, yalnız boş yer kalırsa en sona eklenir | Yapıldı (`station-access-selection.spec.ts`) |
| Arama bütçesi | Geniş arama, incumbent sonrası 3.000 hava projeksiyonu ile sınırlı | Yapıldı |
| Polling | `GET /v1/planning-jobs/:id?waitMs` long-poll, mobil 15 s | Yapıldı (`planning-jobs-longpoll.spec.ts`) |
| İstasyon sorgusu nokta sınırı | Geometri yalnız `maxGeometryPoints` aşılırsa sadeleştirilir | Yapıldı (`corridor-query-geometry.spec.ts`) |
| Segment uzunluğu | 3 km segment denendi; kalite ve hız gerekçesiyle reddedildi, 1.000 m kaldı | Değişiklik yok |
| Uç nokta toleransı (>100 m snap) | — | **Açık** |
| "Şimdi" kalkışlarında yol cache anahtarı | — | **Açık** |

## Referans rotalar (süreç-içi, yerel Valhalla + yerel Open-Meteo DWD ICON, başlangıç %100, varış hedefi %20)

Kalkış 2026-11-20T07:00Z (sabit). "Önce" = 1.6.1/erken 1.7.0 ölçümleri, "Sonra" = bu raporun kaynağı.

| Rota | Önce | Sonra |
|---|---|---|
| İstanbul (Kadıköy) → Kelkit | 1.302,6 km / 1.103 dk (telefon, 1.6.1) | 1.128,5 km / 873,3 dk, 6 durak |
| İstanbul (Fatih) → Kelkit | 1.147,5 km / 899,1 dk | 1.147,5 km / 887,3 dk |
| İstanbul (batı) → Kelkit | — | 1.182,3 km / 910,9 dk |
| İstanbul → Ankara | 458,5 km / 341,7 dk | 458,5 km / 332,6 dk, 3 durak |
| İstanbul → İzmir | 569,4 km / 415,1 dk (90,6 km sapmalı durak) | 478,9 km / 344,6 dk, 3 durak |

Planlarda %100 durak kalmadı (sabit kalkış). "Şimdi+10 dk" kalkışında bir Kelkit planında hâlâ bir 10,3→%100 durağı görüldü: plan tohumdan değil geniş aramadan geldiğinde gereksinim kadar şarj uygulanmıyor ve `improveFixedStopTargets` bütçe nedeniyle onu düşüremeyebiliyor. Bu açık bir kalite sınırıdır.

## Süre

Süreç-içi plan süreleri bu ölçümlerde 3,3–17,8 s arasında dalgalandı. Ölçüm sırasında başka bir yerel geliştirme süreci sürekli ~2 çekirdek kullanıyordu; bu nedenle burada hızlanma yüzdesi iddia edilmez. Aynı makinede yük yokken yapılan önceki ölçümlerde Kelkit 7,5–9 s, Ankara ~3,2 s, İzmir ~3,7 s idi. **İstanbul→Kelkit için 5 s hedefi karşılanmadı**; süre tohum zincirinin sürüş/hava projeksiyon maliyetinde.

Yol sorgu bütçesi 64→96/128 denendi: hiçbir referans planı değişmedi, süre arttı. Bütçe 64 kaldı.

## Geçici başarısızlık notu

Aynı gün daha önce sabit kalkışla iki Kelkit koşusu `computation_limit` (`WEATHER_QUERY_BUDGET`, 3.863 tahmin `budget_exhausted`) döndü. Aynı kaynak ve kalkışla tekrar koşuda hepsi planlandı, hiç `budget_exhausted` yoktu. Sebep yerel Open-Meteo verisinin o andaki zaman kapsamıdır (senkron arası), algoritma değildir. Bu, yerel hava verisi geçici olarak eksik kaldığında planın bütçe hatasıyla düşebildiğini gösterir.

## Testler

- `pnpm --filter @chargeroad/api typecheck`: PASS. `pnpm --filter @chargeroad/mobile typecheck`: PASS.
- `pnpm --filter @chargeroad/api test`: 87 suite / 1.158 test PASS, 14 suite / 154 test SKIPPED (DB; `TEST_DATABASE_URL` yok → `test:db` NOT_RUN).
- `pnpm --filter @chargeroad/mobile test`: 85 PASS.
- `latency-polling.spec.ts`: long-poll istemcisi ilk durum okumasını hemen yaptığı için, `waitMs`'i tanımayan sentetik sunucuda okuma sayısı 1→2 olarak güncellendi; pilot/pilot-dışı 3.000 ms fark aynı.
- Durum gölgesi checkpoint'i: ilk 1.7.0 dosyası kaynak son halini almadan yazıldığı için yeni dosya eklendi (`charge-to-need-shadow-source-v2-2026-11-19.json`); eski dosya değiştirilmedi.

Cihaz/Expo kabulü bu raporda NOT_RUN.
