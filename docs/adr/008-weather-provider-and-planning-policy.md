# ADR-008 — Hava sağlayıcısı ve planlama politikası

- Durum: ACCEPTED — üç ürün/sağlayıcı kararı ve devamında kullanıcı talebiyle uygulanan başlangıç politikası.
- Tarih: 2026-11-11
- İlgili açık karar: DEC-007, DEC-008
- İlgili görevler: CR-010, CR-011, CR-013, CR-019
- Kararı onaylayan: Kullanıcı, üç mimari soruya verdiği yanıtlarla.

## İhtiyaç

Hava verisi yalnızca çıkış şehrine veya hareket saatine göre alınamaz. Her yol kesiminde tahmini geçiş saati kullanılmalı; şarj ve bekleme süreleri zaman çizelgesine eklenmelidir. Hava adapter'ı veri sağlar; enerji/SOC/şarj durağı kararını kendi algoritmalarımız verir.

## Kabul edilen kararlar

1. İlk sağlayıcı **MET Norway Locationforecast**. Diğer sağlayıcılar sonradan eklenebilir; provider mimarisi korunur. Open-Meteo yedek adaydır, bu kararla ikinci adapter veya otomatik fallback uygulanmaz.
2. Temel hava verisi alınamıyor ve kullanılabilir güncel önbellek bulunamıyorsa **yol rotası gösterilebilir; güvenilir SOC/enerji/şarj planı için veri yetersiz sonucu verilir**. Varsayılan sıcaklık veya sıfır rüzgârla sessizce plan üretilmez.
3. V1'de ayrıntılı enerji/şarj planı için hareket zamanı **şimdiden sonraki 72 saat** içindedir. Daha ileri tarih için ön yol rotası verilir. 72 saat hareket penceresidir; bütün yolculuk kesimlerinin tahmin kapsamına girmesi ayrıca zorunludur.

Bu kararlar Redis eklememe, paylaşılan veriyi PostgreSQL'de tutma ve LLM'den bağımsız hesaplama ilkeleriyle uyumludur. Başlangıç teknik politikası [teslim belgesinde](../WEATHER_PROVIDERS.md), tarihsel taslak [Task 10 hazırlığında](../TASK_010_PREPARATION.md).

## Seçenekler ve kaynak kanıtı

11 Kasım 2026 seçim öncesi doküman araştırması (uygulama/pilot kanıtı aşağıda):

| Seçenek | Fayda | Sınır / maliyet |
| --- | --- | --- |
| MET Norway | Ticari kullanım dahil ücretsiz; CC BY 4.0, anahtarsız erişim | SLA yok; Türkiye doğruluğu/kapsamı pilotla ölçülecek; tanıtıcı istemci ve kaynak kurallarına uygun cache gerekir. |
| Open-Meteo | Çoklu konum ve geniş alan seçenekleri; geliştirme pilotu kolay | Ücretsiz servis ticari olmayan kullanımla sınırlı; ticari üründe abonelik veya ayrı barındırma değerlendirmesi gerekir. |
| İki adapter ile başlangıç | İlk günden yedeklilik | Test/işletim ve farklı model/zaman alanlarını uzlaştırma maliyeti artar; bu aşamada seçilmedi. |

Kaynaklar: [MET Norway FAQ](https://api.met.no/doc/FAQ), [MET koşulları](https://api.met.no/doc/TermsOfService), [Open-Meteo fiyatlandırma](https://open-meteo.com/en/pricing).

MET koşulları kullanım öncesinde yetkili insanın okuyup kabul etmesini ister. Kullanıcı 2026-11-11'de “Koşulları okudum ve ChargeRoad için kabul ediyorum” yanıtını verdi. Repo public olarak doğrulandı; uygulama/sürüm ve repo iletişimli User-Agent ile gerçek Türkiye sorguları yapıldı. Hesap açımı, mail veya operatör mesajı gönderilmedi.

## Sonuçlar

Mevcut zorunlu `forecastIssuedAt` alanı, sağlayıcı güncelleme zamanını gerçek model üretim zamanı gibi göstermemeli. MET'in `updated_at` bilgisi veri güncellemesini ifade eder. Bilinmeyen model zamanı ayrı ve nullable kalacak; tazelik kaynak zamanı üzerinden değerlendirilecek. Kontrat/validator/coordinator değişiklikleri birlikte yapılmalı.

Eksik zorunlu alan, tahmin ufku dışında kalma, bayat veri ve sağlayıcı hatası ayrı sonuçlar olmalı. Güncel cache kullanılması bu sonuçlarla karıştırılmamalı. Daha önce alınmış verinin tekrar indirilmesi, meteorolojik tahmini yeni üretmiş olmaz.

Türkiye gerçek yanıtı, cache başlıkları, koşullu GET/304, birim/zaman dönüşümleri, kesim geçiş saatleri ve eksik veri davranışı doğrulanmadan CR-010 DONE olmaz. Harita veya enerji motoru bu kararla tamamlanmış değildir.

2026-11-11 uygulama: Bu kabul kapıları gerçek Türkiye serisi, normalize pilot ve yerel/DB testleriyle geçildi; CR-010 DONE. Koşullu GET/304 ve hata senaryoları kontrollü testlerle doğrulandı; gerçek kaynağa header süresi dolmadan zorla revalidation yapılmadı. [Teknik teslim](../WEATHER_PROVIDERS.md), [gerçek pilot](../validation/task10-weather-validation.json), [yerel p95/p99](../validation/task10-weather-benchmark.json).

## Yeniden değerlendirme

Türkiye pilotunda alan/kapsam sorunu, ölçülen doğruluk ihtiyacı, erişim kısıtı, SLA gereksinimi veya maliyet politikası değişirse provider seçimi yeniden açılır. Sayısal örnekleme ve tazelik eşikleri gerçek veri sonrasında değerlendirilir.
