# CR-006 — Çok kaynaklı araç verisi: teknik teslim

Tarih: 2026-11-10. Teknik katman uygulandı. **CR-006 bütünü IN_PROGRESS:** İki pilot için koşullu hız–tüketim ve şarj eğrisi kaynak yeterliliği hâlâ açık. Eksik veri uydurulmadı; mühendislik tahmini desteği gerçek ölçüm diye sunulmadı.

## Uygulanan yapı

- 003/004/005 migration'ları: Kaynaktan bağımsız UUID araç kimlikleri, eski ID eşlemeleri, yayımlanmış katalog görünümü, çok kaynaklı kanıtlar, değişmez profil revizyonları, atomik yayın işaretçileri, aktarım denemesi/kalite raporları ve global kaynak adayları.
- 001/002 dosyaları değiştirilmedi. 1.189 mevcut kayıt geriye uyumlu ID alias'larıyla taşındı; iki exact pilot konfigürasyonu ayrı eklendi. Belirsiz OpenEV kaydıyla pilotun jant/pazar doğrulaması otomatik birleştirilmedi.
- Mobilin mevcut marka → model → varyant API biçimi korunur. Marka/model listeleri kaynak başına çoğaltılmaz. Eski 64 karakterli ID ve yeni UUID ile detay okunabilir; cevap ana katalog ID'sini döndürür. Mobil kalıcı seçim hem ID türünü kabul eder.
- OpenEV import'u kendi verisini günceller. Ana katalogda ek kaynağın seçilmiş verisini ezmez; tüketim/şarj referansları kaynak alt tablolarında kaybolmaz.
- Yeni CLI paketleri bütün kayıtlar doğrulandıktan sonra transaction içinde yayınlar. Checksum aynıysa idempotent; eski snapshot reddedilir; bir kayıt hatalıysa bütün yayın geri alınır. Kısmi ek pakette atlanan kayıtlar pasifleşmez. Revizyonlar güncellenmez/silinmez, yayın pointer'ı değişir.
- Kaynak sahipliği ve veri kalitesi ayrıdır: `verified`, `source_reported`, `engineering_estimate`, `quarantined`. Şüpheli kayıt kalıcı kaynak/inceleme verisi olarak saklanabilir; planlama profiline alınmaz.

`VehicleSnapshot` ve eski adapter OpenEV'e özgü kalır; yeni kaynak o tipe zorlanmaz. Ek kaynak/kanıt için ayrı `vehicle-knowledge/1.0.0` ingestion sözleşmesi vardır. Global aday indirme/yayınlama ile kullanıcı isteği yolundaki DB okuması ayrıdır. Tek evrensel provider tipine bütün ham kaynak formatlarını sıkıştırmadık.

## Hız, koşul ve mühendislik referansları

Bir varyant için birden fazla hız, sıcaklık, mevsim, HVAC ve test yöntemi korunabilir. Nokta referansları ile kullanıcının aralık bildirimleri ayrıdır; aralık ortası ölçüm diye atanmaz. Sabit hız testi, seyir hedefi ve yolculuk ortalaması aynı etiketle saklanmaz.

`consumptionObservationSchema` açık sıcaklık sınırı (örneğin >25 °C), tüketim aralığı, bilinmeyen hız ve enerji sınırını destekler. Kullanıcı 11–12 / 17–20 / 18–22 birimlerini **kWh/100 km** olarak doğruladı. Ioniq 6 için kaydedilenler:

| Bağlam | Hız | Sıcaklık / HVAC | Tüketim |
|---|---|---|---|
| Şehir içi | Bilinmiyor | 18–21 °C / kapalı | 11–12 kWh/100 km |
| Şehirler arası | Yaklaşık 130 km/h seyir hedefi | 18–21 °C / bilinmiyor | 17–20 kWh/100 km |
| Şehirler arası | Yaklaşık 130 km/h seyir hedefi | >25 °C / açık | 18–22 kWh/100 km |

Bunlar yalnız `ioniq6-2023-53-rwd-18` konfigürasyonuna bağlı kullanıcı bildirimidir. Mesafe, gerçek ortalama hız ve batarya-DC ölçüm sınırı bilinmediğinden kontrollü test veya başka modelin referansı sayılmaz. Ham bildirim ve aralıklar [v2 pakette](../data/vehicle-knowledge/pilots-v2-user-observations.json) korunur. Ioniq 5'e veya diğer markalara taşınmaz.

Mühendislik profili yayınlanabilir; yöntem/sürüm, dayanaklar, varsayımlar ve uygulanabilirlik zorunludur. Kullanılan kapasite/tüketim/şarj kanıtı denetlenir; eşleşmeyen/karantina/incelemesiz kanıt reddedilir. `verified_only` tahmini profili kabul etmez. `allow_engineering_estimates` açıkça tahmini profile izin verir; varsa doğrulanmış profil tercih edilir. Engineering etiketini coordinator sonuç varsayım/uyarılarına taşır. Sadece bu desteğin var olması, pilot için eksik eğri veya fiziksel katsayı üretildiği anlamına gelmez.

## Sözleşme uyumu

Yeni ingestion, pencere ve kişisel model şemaları kendi sürüm adlarını taşır. Mevcut domain `1.0.0` için geriye uyumlu, isteğe bağlı `vehicleDataQuality` politika alanı ve profil `dataQuality` metadatası eklendi; eski fixture'lar geçerlidir. Yeni kalite verisini anlayan shared paket API/istemciyle birlikte dağıtılmalıdır; eski strict parser yeni alanı kabul etmeyebilir. Profil JSONB checksum'u anahtar sırasından bağımsız canonical JSON üzerinden doğrulanır.

`DbVehicleEnergyProvider`, yayınlanmış profili yalnız DB'den okur. Kalite politikasına uygun profil yoksa null döner. Legacy ID coordinator'da ana kimliğe çözülür. DB sorguları read-only transaction ve 2 saniye server statement timeout ile sınırlıdır; caller iptali yeni aşamaya geçişi engeller. Halihazırdaki SQL anında iptal edilmiş sayılmaz; server timeout'u ve pool'un bağlantı zaman aşımı geçerlidir.

## Bütün modeller ve yenileme

OpenEV v1.24.0 temel katalog olarak korunur. İkinci veri kaynağı [Open EV Data / KilowattApp](https://github.com/KilowattApp/open-ev-data), sabit commit `32d7dc59e7b8b7391572ca1e132a1517be9a3b5e` üzerinden indirildi. [Lisans metni](../third_party/kilowatt-open-ev-data.LICENSE.md) ve README attribution saklandı.

Yeni provider `latest` veya tam commit SHA alır; metadata, lisans ve veri için boyut/süre sınırları vardır. Lisans checksum'u değişirse inceleme ister. 1.321 kaynak kaydı SQL'e 250'lik batch'lerle aday olarak alındı; bunlardan 445'i kaynağın generic şarj eğrisi etiketi taşıyor. Kaynak verisinde aynı modelin mükerrer/alternatif isimleri olabilir. Bu sayı benzersiz/yeni uygulama modeli veya doğrulanmış test sayısı değildir.

Adaylar ham kayıt, kaynak sürümü/checksum'u ve inceleme bayraklarıyla tutulur. Doğrulanmamış kayıtlar mobil listelere otomatik eklenmez; isim benzerliğiyle birleştirilmez. Yeni modeller ve veri revizyonları aynı adapter/staging servisiyle tekrar alınabilir. Haftalık scheduler CR-021'de bağlanacak; bu teslim cron veya Redis eklemez.

Kaynak inceleme matrisi:

| Kaynak | Bulgular | Kullanım |
|---|---|---|
| OpenEV v1.24.0 | 1.189 katalog kaydı; mevcut snapshot'ta doğrudan tüketim/eğri yok | Temel kaynak ve alias backfill |
| Kilowatt sabit commit | 1.321 aday; ortalama tüketim iddiaları var, hız/enerji sınırı belirsiz. Ioniq 6 SR 2023 kaydı 50 kWh / 14,9 tüketim / 50 kW eğri bildiriyor | Tam kaynak staging; pilotta kapasite iddiası source_reported, tüketim/eğri karantinada |
| gaia-charge/evdb `173aaf5ae7720631f5dd9b50084afdac0ef41b24` | İncelenen Ioniq 6 SR kaydı 2024 yılına ait; 53 kullanılabilir / 54 toplam iddiası ve yalnız Wikipedia kaynak referansı var. Standard Ioniq 5 dosyaları 2024/2026 | Pilotla otomatik eşleştirilmedi, veri yayınlanmadı |
| Kullanıcı Ioniq 6 bildirimi | Üç koşullu tüketim aralığı; birim doğrulandı | Ayrı source_reported gözlemler, başka modele uygulanmaz |

Bu araştırma tüm internette test yok demek değildir. İncelenen lisanslı kaynaklardan pilotlara uygun koşullu hız testi/şarj eğrisi henüz kabul edilmedi. Tüm araçlar için gerçek test garantisi verilemez; kapsam boşlukları model bazında raporlanır.

## Komutlar

Depo kökünden (PowerShell'de gerekirse `pnpm.cmd`):

```sh
pnpm --filter @chargeroad/api db:migrate
pnpm --filter @chargeroad/api vehicles:sync-kilowatt --version latest
pnpm --filter @chargeroad/api vehicles:stage-kilowatt --file ../../artifacts/task6-sources/kilowatt.json --manifest ../../data/vehicle-knowledge/kilowatt-manifest.json
pnpm --filter @chargeroad/api vehicles:publish --file ../../data/vehicle-knowledge/pilots-v2-user-observations.json
pnpm --filter @chargeroad/api vehicles:report
pnpm --filter @chargeroad/api vehicles:benchmark
pnpm --filter @chargeroad/api test:db
```

`sync` indirir ve aday olarak saklar; `publish` incelenmiş paketi katalog/referans görünümüne alır. Hiçbiri HTTP uçlarından veya mobil okumadan tetiklenmez. `latest` somut commit'e çözülür. Offline staging için indirilen dosyanın manifest checksum'u doğrulanır. Test komutu TEST_DATABASE_URL veya yerel .env DATABASE_URL ile yalnız rastgele test şemalarını kullanır. Production dosyaları `dist` yanında migrations dizinini gerektirir.

API: Mevcut katalog uçları korunur. Yeni `GET /v1/vehicles/:id/references?limit=50&offset=0`, yayınlanmış kanıtları kalite/kaynak bilgisiyle döndürür; `{items,total,limit,offset}`, üst limit 100. Profil yayınlanmış olmasıyla karantina kaynak iddiası okunabilmesi aynı şey değildir. Kişisel model/telemetri uçları açılmadı.

## Kişiselleştirme teslimi

`personal-driving/1.0.0`, `driving-window/1.0.0` ve `personal-energy/1.0.0` Zod sözleşmeleri hazır. Süre/mesafe/hız dağılımı, açık enerji kökeni, yolun yasal/beklenen/planlanan/gözlenen hız ayrımı, araç snapshot'ı, profil/izin bağlantısı, bağımsız seyahat sayısı ve eğitim/holdout ayrımı tanımlı. Kişisel ağırlık referansı tamamen silemez; veri yokken kişisel ağırlık sıfırdır. Sayısal öğrenme yöntemi ve minimum örnek eşikleri seçilmedi.

[Kişisel DDL taslağı](schema/personal-energy.draft.sql) **uygulanmadı**: Sahiplik/izin/seyahat FK'leri CR-003/020'ye bağlıdır. GPS'ten tüketim ölçümü üretme, 15 dakikalık aktif toplama/öğrenme, kişisel şarj kalibrasyonu veya ortalama alma algoritması bu görevde çalıştırılmaz. [Görev sınırları](PERSONALIZED_ENERGY_DATA.md).

## Kanıt ve kalan sınırlar

132 API testi (DB entegrasyonları dahil, atlanan yok), 31 shared testi, üç paket typecheck ve API production build başarılı. Gerçek DB'ye 003/004/005 uygulandı. Yeni provider gerçek internet üzerinden aynı snapshot'ı tekrar çekip mükerrer üretmeden tamamlandı. Geçici production API'de sağlık, pilot listesi, eski ID ve üç kullanıcı gözlemi kontrol edildi.

- [Veri kapsam raporu](validation/task6-data-coverage.json)
- [Yerel DB p95/p99 raporu](validation/task6-db-benchmark.json)
- [Production HTTP kontrolü](validation/task6-http-check.json)

DB benchmark: 4 eşzamanlı okuyucu, beş senaryoda 2.000'er örnek. Canonical detay p99 yaklaşık 1,00 ms, eski ID çözümü 1,11 ms, Hyundai sayfası 2,58 ms, sentetik yayınlanmış profil hit'i 4,25 ms. Sıfır hata; kısa yerel mikrobenchmark üretim SLA/yatay ölçek/telemetri yük kanıtı değildir. Profil hit'i ayrı test şemasındadır; pilot verisinin hazır olduğu anlamına gelmez.

Mevcut ek paket üst sınırı 5.000 kayıt / 16 MiB. Doğrulama önce yapılır; kayıtların DB'ye yazımı ve yayın pointer'ları tek transaction'dadır. Çok büyük kataloglar için kalıcı staging + daha kısa pointer transaction ayrımı ileride genişletilebilir. Aktarım sırasında sıradan okuyucular eski tamamlanmış sürümü görür. İndirme/parse hataları DB işlem kaydı açılmadan reddedilir; süreç zorla kesilirse running denemelerinin uzlaştırılması CR-021'de ele alınacak.

Tam CR-006 kabulünü kapatmak için iki pilotun kapasite/kimlik eşleştirmesi ve uygun koşullu tüketim/şarj kaynakları hâlâ gerekiyor. Kullanıcı internet araştırması da kaynak/lisans/koşul incelemesine tabi tutulacak. Bir modelden diğerine ölçüm taşımak veya eksik eğriyi uydurmak bu kabulü karşılamaz.
