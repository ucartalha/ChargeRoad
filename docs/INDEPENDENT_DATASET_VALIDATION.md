# Bağımsız 13 araç dosyası ve motor iyileştirmeleri

2026-11-11. Kullanıcının verdiği iki XLSX yerel olarak okundu. Dosya metinleri/talimat benzeri hücreler veri olarak tutuldu; komut veya proje talimatı olarak çalıştırılmadı. Formüller çalıştırılmadı, varsa önbellekteki formül sonucu ölçülmüş veri sayılmadı. Makro veya dış bağlantı çalıştırılmadı.

## Veri ve testin anlamı

| Dosya | SHA-256 |
| --- | --- |
| ChargeRoad_13_EV_Sarj_Egrileri_Dogrulanmis.xlsx | `87b7b0a4c31be11c4709cc8eeb0b9a4f21dcac412c010d081c023e342e3c4131` |
| ChargeRoad_13_EV_Tuketim_Dogrulanmis.xlsx | `25eff811b6a3830e0dba90984e3b3fed1e7e0218a66dbdccdc5fc88e77f97d4c` |

13 ana konfigürasyon, 23 tüketim gözlemi, 7 şarj oturumu, 9 kısmi SOC–güç noktası ve 4 ikincil şarj beyanı alındı. Boş hız/sıcaklık matrisi hücreleri yeni ölçüm sayılmadı. `CR012_Export` satırları asıl Measurements/Charge_Sessions satırlarının tekrarlarıdır; ikinci bağımsız test olarak sayılmadı. İlişkili SR/LR, farklı jenerasyon ve AWD konfigürasyonları ana modelin kanıtı olarak birleştirilmedi.

Kaynak/izin/koşul bağlamıyla [normalize veri](../data/validation/independent-13ev-benchmarks.json) ve [satır bazlı doğrulama raporu](validation/independent-13ev-validation.json) kaydedildi. Dosya adındaki “Doğrulanmış”, bizim üretim profili doğrulaması veya yeniden kullanım lisansı anlamına gelmez. Kaynak sayfalarının halka açık olması otomatik açık lisans değildir; bu teslim yerel değerlendirmedir, üretim kataloğuna yayın yapılmadı.

Mevcut dosyalar iki motorun bağımsız **sayısal tahmin hatasını** ölçmeye henüz yetmiyor:

- Tam SOC–güç/akım/voltaj serisi, ölçüm sınırı, batarya sıcaklığı ve EVSE/yol limitleri birlikte yok. Oturum uçları ve tepe güç bir kabul eğrisi değildir. Örneğin BMW oturumu %8→80; %10→80 gibi değerlendirilmez. Tesla `<24 dakika` kesin 1.440 saniye sayılmaz. Kısmi EVKX noktaları %10→80'e uzatılmaz.
- BAB130 azami hızı 130 olan değişken çevrimdir; sabit 130 km/h ölçümü sayılmadı. Tüketim satırlarında tekrarlanabilir hız/eğim/hava izi ve bağımsız kaynaklı tam araç kalibrasyonu yok. AC-priz, batarya DC ve belirsiz ölçüm sınırları birbirinin yerine kullanılmadı.
- `kia-ev3-lr-rwd-2025` kimliğinde RWD yazarken master alanı FWD. Çelişki raporlandı; ID veya varyant sessizce değiştirilmedi. SR ADAC verisi LR modele, 2022 Ioniq 5 58 kWh gözlemi 2025 pilot 63 kWh modele taşınmadı.
- 36 motor reddetme kontrolü sentetik çevre içinde yalnız eksik gerçek referansın kabul edilmediğini sınar. Sentetik araç/istasyon koşulları gerçek testin koşulu gibi sunulmaz. Oturumlar ayrıca veri yeterliliği açısından incelenir. Yeterli kapasite/kimlik/tepe/süre alanı olan bir örnekte enerji/tepe-güç alt sınırı kontrol edildi; bu bir süre tahmini değildir.

Bu nedenle MAE ve gerçek şarj süresi hata metriği **null**, replay yapılabilir bağımsız holdout sayısı **0**. Bu sonuç “hata sıfır” veya “bağımsız testler ile doğruluk kanıtlandı” anlamına gelmez. Mevcut kayıtlar kaynaklı regresyon/karşılaştırma verisi olarak yararlıdır; referans noktalarından kendilerini yeniden üretip doğruluk başarısı ilan edilmedi. Hiçbir araç katsayısı bu dosyalara fit edilmedi.

Birincil kaynak spot kontrolleri: BYD 2023 tüketim tablosundaki 18,2/18,0/28,1/25,1 değerleri ve 59,3 kWh kullanılabilir kapasite [Green NCAP](https://www.greenncap.com/assessments/byd-atto-3-2023-0145/) sayfasında; Ioniq 5 2022'nin şebeke tüketimi ve 58,8 kWh ölçümü [kendi değerlendirmesinde](https://www.greenncap.com/assessments/hyundai-ioniq-5-2022-0091/) bulunuyor. [NAF EV3](https://www.naf.no/bilguiden/bilmodell/kia-ev3?tab=test) test kimliği FWD olarak gösteriliyor. Bu kontroller tüm satırların kaynak/izin veya Türkiye varyant doğrulaması değildir. AC verimini farklı koşuldaki bütün testlere tek çarpan olarak uygulamadık.

## Veri kümesine özel olmayan motor değişiklikleri

1. **Karşılaştırılabilir referans serisi:** `comparabilityGroupId`, kaynak, kaynak sürümü, test kayıt kimliği ve aynı koşullar birlikte değerlendirilir. Farklı sitelerin/oturumların 90 ve 120 km/h noktaları yanlışlıkla tek eğri yapılmaz. Seri kimliği bilinmeyen tekil noktalar ayrı kalır. İndeks her değerlendirmede bir kez hazırlanır; hız araması binary search kullanır.
2. **Hız izi:** Referans tüketimi gerçek hesap alt adımındaki hızda seçilir. Tek kesim ortalaması değişken hız izinin yerine geçmez; kullanılan bütün referans ID'leri denetim izinde korunur. Hız iziyle ivme düzeltmesi için fizik kalibrasyonu gerekir; iz kapsamı dışına çıkılırsa yetersiz veri sonucu korunur. Dururken modelde açık yardımcı güç kullanılır; hız sıfırken menzil/tüketim eğrisi uydurulmaz.
3. **Soğuk/sıcak başlangıç:** Opsiyonel `automaticBatteryThermal` kalibrasyonu eklendi. Aynı dış sıcaklıkta farklı batarya başlangıç sıcaklıkları için, termal kütle/iletim, kaynaklı güç limitleri ve COP ile sınırlı ısıtma/soğutma hesaplanabilir. Birinci dereceden RC çözümü ve kontrollü güç kullanılır; sabit termal yük ile çift sayılmaz. Kontrol bandı/parametreler hiçbir araca otomatik atanmadı; bilinmeyen batarya sıcaklığı ortamdan türetilmez. Ohmik ısı/şarj ön koşullandırmasının tamamlandığı varsayılmaz. Bu, bu dosyalardan türetilmiş Hyundai/Tesla termal kalibrasyonu değildir.
4. **Şarj eğrisi araması:** Sıralı SOC/voltaj noktaları binary search ile aranır. Kaynak kapsamı, güç kesişimleri, kayıp/yardımcı enerji dengesi ve quadrature korunur; tepe kW üzerinden sabit süre kestirimi eklenmedi.

Tüketim algoritması `chargeroad-energy/1.1.0`, şarj algoritması `dc-curve-integration/1.0.1`. Kaynak profil/kalibrasyon sürümü ayrıca korunur. Ölçüm doğruluğunu iyileştirecek katsayı seçimi saha verisinden sonra yapılacak; bu teslim doğruluk yüzdesi iddiası taşımaz.

Son doğrulama: **391 API/DB testi ve 37 shared sözleşme testi geçti; atlanan yok.** Mobil/API/shared TypeScript kontrolleri ve API production derlemesi başarılı. Her grupta 1.000 tam tahminle yerel ölçüm:

| Sentetik hesap | p95 | p99 |
| --- | --- | --- |
| Şarj, lineer taper | 0,26 ms | 0,69 ms |
| Şarj, 101 nokta + voltaj güç zarfı | 1,53 ms | 2,01 ms |
| Tüketim, 1.000 kesim fizik | 42,07 ms | 50,71 ms |
| Tüketim, 1.000 kesim + 64 hız referansı | 42,92 ms | 50,73 ms |

Bunlar yerel CPU/async değerlendirmeleridir; DB/harita/hava ağ gecikmesi, üretim SLA'sı veya gerçek araç tahmin doğruluğu değildir. Önceki makine ölçümleriyle farkı doğrudan doğruluk iyileşmesi ya da garantili hızlanma yüzdesi sayılmaz.

## Kullanıcının SOC düzeltmesinden öğrenme

[Geri besleme tasarımı](PERSONALIZED_ENERGY_DATA.md) için çalışan, deterministik **çevrimdışı** çekirdek ve ortak sözleşme eklendi: `soc-feedback/1.0.0`, `learnConsumptionResidual`, `blendConsumption`. Genel/kullanıcı model yayını veya navigasyon toplama endpoint'i açılmadı.

```text
İki gerçek SOC gözlemi + sabit kapasite snapshot'ı
  → Şarj/yeniden başlangıç/kalite/izin/kimlik/holdout denetimi
  → Aynı aralıkta kişiselleştirilmemiş referansa göre enerji sapması
  → Seyahat başına tek kanıt birimi → koşullu kişisel model revizyonu
  → Ayrı paylaşım izni ve yeterli farklı kullanıcıyla genel model adayı
  → Referans + sınırlı genel katkı + sınırlı kişisel katkı
```

`E_gözlenen = C_etkin × (SOC_ilk − SOC_son) / 100`; `sapma = E_gözlenen / E_referans`. Bu, batarya enerjisi sensör ölçümü değildir: manuel SOC belirsizliği ve kapasite varsayımı taşır. Örneğin tahmin edilen kalan %40 yerine %35 girişi, tüketimi `40/35` oranında artırma gerekçesi değildir. Başlangıç SOC'si, aradaki şarj, mesafe ve aynı aralığın referans enerjisi gerekir.

Öğrenme için:

- Gerçek ölçüm veya kullanıcı girişli **iki** SOC gözlemi gerekir; model tahmini eğitim etiketi olamaz. Kaydedilen baseline kişisel/genel ağırlığı sıfır olan aynı referans sürümüne ait olmalıdır.
- Sahip, sürüş profili, kişisel araç, konfigürasyon, araç varyantı, referans profil/algoritma sürümü ve koşul bucket/politika sürümü eşleşir. Farklı mevsim/hız/HVAC koşulları bucket üretiminde ayrı tutulmalıdır. Bucket üretimi gerçek navigasyon/telemetri görevinde uygulanacak; serbest istemci etiketi olarak güvenilmez.
- Şarj içeren aralık, şarj sonrası giriş veya anchor reset tüketim eğitimi değildir. Şarj sonrası gerçek SOC kalan planın yeni başlangıcı olur (CR-018); ardından yeni gözlem çifti beklenir. Daha düşük gerçek tüketim gözlemi öğrenilebilir; net SOC artışı/çok küçük SOC düşüşü bu basit pozitif tüketim kalibrasyonuna alınmaz.
- Aynı olay idempotenttir; farklı içerikli aynı ID reddedilir. Aynı aracın çakışan pencereleri farklı trip ID'leriyle de yeniden sayılmaz; ayrık pencereler seyahat başına birleştirilir. Tek seyahatten onlarca pencere üretmek bağımsız örnek sayısını büyütmez.
- Yeterli mesafe/kapsama, SOC düşüşü ve belirsizlik oranı denetlenir; manuel girdinin belirsizliği için politika tabanı vardır, istemcinin sıfır yazması ölçümü kesinleştirmez. Uç sapmalar incelemeye ayrılır. Yaşlanan gözlemlerin etkisi azalır. Yeterli bağımsız seyahat olmadan kişisel ağırlık 0 kalır. Sağlam weighted median ve sınırlı shrinkage ağırlığı kullanılır; tek giriş kalıcı eğriyi aniden değiştirmez.
- Kişisel izin ile ortak havuza katkı izni ayrıdır. Genel modelde farklı kullanıcı sayısı eşiği vardır; bir sürücünün çok seyahati havuzu tek başına domine etmez. Kullanıcının kendi verisini iki kez saymamak için katkıda bulunduğu genel model bu prototipte ona kişisel model yanında uygulanmaz; uygun bağımsız cohort yoksa referans katkısı korunur.
- Servis anında izin revizyonu, sahip/araç/koşul/sürüm ve son kullanım tarihi tekrar kontrol edilir. İzin geri çekilirse kişisel revizyon veya ilgili cohort kullanılmaz; model yeniden üretilmelidir.
- Kaynak, kişisel ve genel bileşen ağırlıkları toplamı 1'dir; referansın payı pozitif kalır. Veri yoksa mevcut kaynak referansı; yeni kullanıcıda yeterli bağımsız genel veri varsa sınırlı cohort katkısı kullanılabilir.
- Sabit akım, gerilim, maksimum şarj gücü veya rejenerasyon katsayısı tüketim sapmasıyla çarpılmaz. Şarj kişiselleştirmesi için koşullu ve istasyonca kısıtlanmadığı bilinen ayrı oturum kanıtı gerekir. Yalnız süre/tepe bilgi yeterli değildir.

Sayısal eşikler sabit ürün doğrusu olarak atanmadı: sürümlü politika girdi olarak verilir ve bu sürüm `stage: offline_validation` kabul eder. Testlerdeki minimum seyahat/kullanıcı sayıları ve ağırlıklar sentetiktir. Üretim eşikleri CR-001/022 saha protokolünde belirlenecek. Çekirdek batch worker için hazırdır; rota isteği sırasında ham telemetri üzerinden eğitim yapılmaz.

Güven sınırı: owner, izin, profil ve baseline alanları gelecekte kimliği doğrulanmış sunucu tarafından çözülecek; ham istemci JSON'una güvenilerek bu fonksiyonlar çağrılmaz. Auth/sahiplik, kalıcı feedback/outbox/job, silme, navigasyon olay sırası ve mobil bağlantı henüz yoktur. Bu işlevler tamamlanmadan kullanıcı verisi toplamaya veya otomatik canlı öğrenmeye başlanmaz.

## V1 sonrası saha kabulü

V1 sonrasında referans-only ve kişisel/genel birleşim, aynı sabit yol/hava/model snapshot'larıyla karşılaştırılacak. Önce shadow değerlendirme, ardından sürümlü ve geri alınabilir model yayını kullanılacak. Başarısız model yayına geçmeyecek; yalnız ortalama hatayı düşürmek yeterli değildir, rezerv altı risk ve uç sapmalar da izlenecek.

Kayıtlar seyahat, test oturumu/kaynağı ve konfigürasyon düzeyinde eğitim/doğrulama ayrılacak; ilişkili hız noktaları rastgele iki tarafa dağıtılmayacak. Genel model için ayrı kullanıcı holdout'u da gerekir. İyileştirme sürecinde kullanılan bu XLSX'ler artık geliştirme/regresyon verisidir; dokunulmamış son saha holdout'u sayılmaz.

Ölçümler: tüketim kWh/100 km ve toplam enerji MAE, varış SOC mutlak hatası p50/p95/p99, sıcak/soğuk başlangıç, hız/HVAC/mevsim/araç grupları, şarj süresi mutlak hata ve uygun SOC aralığı, veri yeterliliği/red oranı, rezerv ihlali ve hesap p95/p99. Bilinmeyen veya yeniden üretilemeyen kayıt hata sıfır olarak sayılmayacak. Yeni kullanıcı performansı kişisel verisi olan kullanıcılarla karıştırılmayacak.

## Tekrar çalıştırma

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/api/scripts/read-validation-workbooks.ps1 -SourceDirectory 'C:\Users\UÇAR OPTİK\Downloads' -OutputPath "$PWD\artifacts\user-workbooks.json"
pnpm --filter @chargeroad/api validation:workbooks
pnpm --filter @chargeroad/api test:db --cache=false
pnpm --filter @chargeroad/api energy:benchmark
pnpm --filter @chargeroad/api charging:benchmark
```

XLSX dosyaları olmadan normalize edilmiş JSON ile regresyon testleri çalışır; ham dosyalar `artifacts` altında yerel kalır. Formül/harici bağlantı/makro çalıştırılmaz. [Enerji](ENERGY_ENGINE.md), [şarj](CHARGING_ENGINE.md), [p95/p99 enerji](validation/task11-energy-benchmark.json), [p95/p99 şarj](validation/task12-charging-benchmark.json).
