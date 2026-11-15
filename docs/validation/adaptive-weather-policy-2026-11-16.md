# Menzile göre hava örnekleme — 2026-11-16

Kullanıcının onayladığı politika uygulandı. Katalog menzilinin %85'i **örnekleme ufkudur**, aracın güncel SOC ile gideceği mesafenin garantisi değildir. Gerçek başlangıç SOC, rezerv, SOH, kapasite, tüketim, termal durum, şarj eğrisi ve her segmentin ETA'sı mevcut fiziksel motorlarla hesaplanır.

## Mesafe politikası

| Ana rota | İlk bölüm | Kalan bölüm |
|---|---|---|
| ≤200 km | Tüm yol 15 km aralık | Yok |
| >200 ve ≤1000 km | min(toplam yol, %85 katalog menzili), 15 km aralık | 25 km aralık |
| >1000 km | min(toplam yol, %85 katalog menzili), 15 km aralık | 25 eşit parça |

Başlangıç, bölüm sınırı ve varış kapsanır. 25 eşit parça, ortak sınır dahil 26 nokta ve ilk bölümden sonra 25 ek nokta anlamına gelir. Hesaplamada hâlâ bütün yol segmentleri vardır; yol/eğim geometrisi seyreltilmedi. Kısa/uzun navigation rolling-window modülü ayrı kalır; bu değişiklik planlama sampler'ına uygulanır.

Katalog menzili DB'deki mevcut canonical catalogue detail'den okunur. Rated cycle sırası WLTP, EPA, NEDC, CLTC; bilinmeyen rated cycle daha sonra gelir. Kaynağın lisansı ve snapshot zamanı korunur; real-world kaydı rated cycle diye yeniden etiketlenmez. Menzil yoksa lisanslı kullanılabilir kapasite / lisanslı batarya-DC tüketim referansı ile hesaplanan değer kullanılır; referanslar arasında yüksek tüketim seçimi örnekleme ufku için konservatif tercihtir. Bu, kondisyon eşleştirilmiş fiziksel menzil hesabının yerine geçmez. İkisi de yoksa yalnız kaynak bulunmadığı etiketlenen sabit 200 km hava penceresi kullanılır; hayali araç menzili üretilmez.

Ana yol üzerindeki örnek noktaları bir kez oluşturulur ve oturum/replay bağlamında sabitlenir. Farklı şarj yüzdeleri veya overlapping bacaklar aynı geometri noktalarının hava serilerini kullanabilir. Forecast yine her segmentin **gerçek tahmini geçiş zamanında** normalize edilir; bir segmentin hava sonucunu başka zamana kopyalama/time bucket cache'i eklenmedi. Ana yoldan fazla uzak alternatif, uzaktaki örneği zorla kullanmak yerine exact lokasyona düşer; bu istisnalar da edinim bütçesine tabidir.

## Kaynak sınırları ve belirsizlik

- Toplam örnek ve plan başına gerçek external acquisition tavanı **64→128**. Bu sınırsız artış değildir: 15 km ilk bölüm + 25 gelecek parça yüksek menzilli araçlarda 64 noktayı aşabilir. Günlük MET kotası **1000**, 500 ms pacing, iki eşzamanlı edinim, PG cache/lease/fencing/backoff ve 30 sn batch deadline korundu. Cold geniş örnek grupları yine gecikme/kısmi veri üretebilir; gecikme SLA'sı iddia edilmez.
- `weather_sample_evaluations`: bir batch'teki farklı örnek-serisi grupları; hard `maxWeatherQueries` bunun bütçesidir. `weather_forecast_query_items` ve search `weatherQueries` ise gerçek segment projeksiyonu sayısını göstermeye devam eder. Hiçbiri otomatik olarak HTTP sayısı değildir.
- CPU/bellek işi ayrıca bounded: `min(200000, max(maxWeatherQueries, base segment count × 32))` segment projeksiyonu. Süre/transition/road/hardware ve admission limitleri korunur. Büyük rota yalnız tek sabit 30000 item bütçesine takılmaz; bütün sınırlar kaldırılmadı.
- Yeni optional shared `samplingResolution` alanı named policy, near/future ve gerçek aralığı taşır. Metadata'sız eski forecast'lerde 10 km kontrolü korunur. Yeni near bölümde 15 km, future bölümde açıkça bildirilen aralık kontrol edilir; gerçek sampledLocation/distance ve zaman provenance kontrolü sürer. Provider koordinat toleransı yeni politika için 30 m'dir.
- Future forecast ve plan `coarse_future_weather_scenario` uyarısını taşır. Mobil sonuç kartında ayrıntılar kapalıyken de seyrek gelecek hava senaryosu açıklanır. Herhangi bir doğruluk yüzdesi uydurulmadı; 72 saat/freshness/core-data kuralları gevşetilmedi.

## Seed ve sürümleme

Eski %55 rota yüzdesi seed fallback'i kaldırıldı. Öncelik, ilk sürüş değerlendirmesindeki model menzilinden; bu çıkarılamazsa kaynaklı menzil hint'inden oluşturulur. Modelden erişim elde edilemiyorsa yakın ilerleme adayları önce denenir; her aday gerçek road/weather/energy/charge değerlendirmesinden geçer. Bu sıralama hiçbir istasyonu fiziksel olarak erişilebilir ilan etmez.

Optimizer **1.2.0**, search policy **1.3.0**, weather policy **1.2.0**, range-adaptive policy **1.0.0**. Enerji sürümü **1.3.3** yalnız hava provenance kabulünün değiştiğini kaydeder; enerji/ısı/eğim denklemleri ve şarj eğrisi fiziği değişmedi. Replay, kaynaklı örnekleme planını ve anchor'ları saklar. Eski frontier golden ve önceki raporlar değiştirilmedi; eski weather/session/energy bağımlılıkları validation-only ayrı frozen overlay ile tarihsel teste verilir. Yeni sürümün shadow checkpoint'i ayrı dosyadır.

## Doğrulama

[Offline örnekleme artefaktı](adaptive-weather-sampling-2026-11-16.json), [çalıştırıcı](../../apps/api/scripts/validate-adaptive-weather.ts). 199/200/201, 700, 1000/1001, 1200 ve 2000 km sentetik geometri sınırları; 15/25 km ve 25 parça kontrolü. 400 km katalog menzilli sentetik araçta 1200 km güzergâh ilk 340 km ayrıntılı, kalan 860 km 25 parçadır. Örnek sayısı HTTP çağrısı olarak sunulmaz.

Yeni gerçek WeatherService/normalizer testinde 1200 ayrı segment ETA'sı 64'ten az sentetik seri edinimiyle üretildi; gerçek HTTP yok. Distant forecast yalnız named coarse policy ile kabul edildi, etiketsiz 10 km kontrolü korundu. 700 ve 1200 km ölçekli sentetik enerji grafiğinde gerçek motorlar ile valid şarj zinciri üretildi; bu geometrik/araç kalibrasyonu veya gerçek İstanbul–Kelkit kabulü değildir. Katalog cycle/lisans/bozuk rating ve kapasite-referans fallback testleri eklendi. Nihai regresyon ve canlı sürüm doğrulaması kapanışta kayıtlıdır.

Bu değişiklik gerçek hava bilgisi olmadan SOC üretmez; unavailable/stale/time-unknown sonuçları başarılıya çevirmez. Konum/SOC/token/raw sağlayıcı paketi loglanmadı. Kaynaklı menzil DB'den yalnız okunur; migration/import/seed veya cache/kota temizleme yapılmadı. Sonraki cihaz denemesinde source/forecast/budget sayaçları ayrıca incelenmeli.

## Kapanış

**1149/1149 API/DB testi PASS**, 71 suite; shared **41**, mobile **21**, workspace typecheck ve API build PASS. İlk regresyonda bulunan dar state bütçesinde menzil hint'inin uzaktaki adaya yönelmesi düzeltildi: sürüşten erişim elde edilemezse yakın aday önceliği uygulanır. Eski fixture beklentileri gevşetilmedi; tarihsel golden/raporlar yeniden yazılmadı. Sekiz sampler sınır vakası ve 700/1200 km iki fiziksel test grafiği PASS; bu gerçek Hyundai saha tüketim doğrulaması değildir.

Çalışan backend aktif iş yokken yeni derlemeyle başlatıldı (PID 2396). API/DB readiness, Valhalla 8002 ve Expo 8082 status uçları 200 döndü. Yerel request-ID/aşama metrikleri ignored `artifacts/runtime-api-adaptive-2026-11-16.log` dosyasına da yazılır; job TTL'si dolunca sonraki teşhiste yalnız DB kaydına bağımlı kalınmaz. Runtime'da optimizer **1.2.0**, energy **1.3.3**, weather **1.2.0** doğrulandı. Gerçek İstanbul–Kelkit cihaz kabulü yeni request ile beklenir; başarılı gerçek rota üretilmiş gibi raporlanmadı.
