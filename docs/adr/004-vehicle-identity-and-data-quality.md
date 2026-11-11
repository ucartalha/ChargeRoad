# ADR-004: Kaynaklardan bağımsız araç kimliği ve veri kalitesi

- Durum: ACCEPTED — ürün/veri ilkeleri. Teknik altyapı uygulandı; pilot veri yeterliliği açık. [Teslim](../VEHICLE_KNOWLEDGE.md).
- Tarih: 2026-11-10
- İlgili açık karar: DEC-005, DEC-007, DEC-008.
- İlgili görevler: CR-003, CR-006, CR-011, CR-012, CR-013.
- Kararı onaylayan: Kullanıcı, üç açık tercih yanıtı ve hız/kişiselleştirme ek talebiyle.
- Tamamlayıcı kayıt: [ADR-001](001-vehicle-catalogue.md). İlk kaynak aktarımı korunur; çok kaynaklı kimlik ve kalite sınırları genişletilir.

## Bağlam ve kanıt

Mevcut katalog kimliği OpenEV kaynak kimliğinden türetiliyor. Kaynağa ait tüketim/şarj alt tabloları sonraki import'ta yeniden yazılıyor. Araç başına tek tüketim ve tek eğri, farklı koşullardaki referansları saklamaya yetmiyor. 2025 Ioniq 5 63 kWh pilotu mevcut kaynak snapshot'ında eksik. [Katalog](../VEHICLE_CATALOGUE.md), [pilot açıkları](../PILOT_VALIDATION.md).

## Kabul edilen kararlar

1. **Bağımsız ana katalog ve kaynak eşleştirmesi:** Uygulamanın araç kimliği tek bir sağlayıcının kimliği olmayacak. Birden fazla kaynak aynı doğrulanmış konfigürasyona bağlanabilecek. Mevcut mobil ID'ler eşleme üzerinden çalışmaya devam edecek. Belirsiz eşleşmeler otomatik birleştirilmeyecek.
2. **Mühendislik tahminlerine izin:** Kaynaklı gerçeklere ek olarak açıkça etiketlenmiş mühendislik tahminleri saklanıp uygun politikayla kullanılabilecek. Tahmin ölçüm veya üretici beyanı olarak sunulmayacak. Yöntem/sürüm, dayanak kaynaklar, koşullar ve sınırlamalar izlenecek. LLM çalışma zamanı bağımlılığı olmayacak.
3. **Kaynak erişim sınırı:** CR-006 açık lisanslı/izinli kaynaklar ve kendi ölçümlerimizle ilerleyecek. Ücretli veri satın alımı bu karara dahil değil. Her kaynağın kullanım/dağıtım koşulları kayıt altına alınacak. Kişisel seyahat geçmişi otomatik kalibrasyon izni sayılmayacak.
4. **Hız/koşul ve kişiselleştirme gereksinimi (2026-11-10 ek kullanıcı talebi):** Farklı hızlardaki ortak tüketim referansları; yol hız sınırı/beklenen/gerçek hız ayrımı; yaklaşık 15 dakikalık sürüş özetleri ve kullanıcıya/araç konfigürasyonuna bağlı sürüş profilleri veri modelinde desteklenecek. Kişisel tüketim ile ortak referans birlikte kullanılacak; yaz/kış ve diğer koşullar korunacak. Şarj gözlemleri sürüş tüketiminden ayrı modellenir. Ağırlık yöntemi ve öğrenme algoritması sonraki görevlerde doğrulanacak. [Veri planı](../PERSONALIZED_ENERGY_DATA.md).

## Teknik sonuçlar ve önerilen uygulama

Bu bölüm kabul edilen uygulama yönünü kaydeder. İlk teknik teslim uygulandı; ayrıntılar [CR-006 tesliminde](../VEHICLE_KNOWLEDGE.md), tarihsel plan [hazırlık belgesinde](../TASK_006_PREPARATION.md).

- Kaynak gerçekleri, seçilmiş katalog görünümü ve sürümlü enerji profilleri ayrı tutulacak. OpenEV import'u ek kaynak/tahmin kayıtlarını silmeyecek.
- Alanın bilimsel anlamı ile kaynağı birlikte korunacak: paket etiketi/brüt/kullanılabilir kapasite, batarya-DC/priz-AC tüketimi, giriş/depolanan güç birbirine çevrilmeden aynı alan gibi birleştirilmeyecek.
- Tahmini profil kullanımı sunucu tarafında sürümlü kalite politikasıyla denetlenecek. Sadece doğrulanmış veri isteyen politika, tahmini profille sessizce karşılanmayacak. Tahmine izin verilmesi her eksik alanın doldurulması anlamına gelmez.
- Aynı aracın sıcak/soğuk, farklı jant/lastik ve şarj yolu referansları korunacak. Koşula uygun veri seçimi CR-011/012'nin algoritma sorumluluğu olarak kalacak.
- Eksik veya çelişkili veri açık kalabilecek. Katalogda seçilebilir olmak planlama için yeterli veri bulunduğu anlamına gelmeyecek.
- Önceki published profil sürümleri değiştirilmeyecek. Gelecekteki planlar kullandıkları sürümü sabitleyebilecek; katalog güncellemesi geçmiş planın anlamını değiştirmeyecek.

## Değerlendirilen alternatifler

- Yalnız OpenEV ID'leri ve ek katman: Daha küçük ilk değişiklik; kaynak bağımlılığı ve mükerrer varyant eşleştirmesi sorunu sürüyor. Seçilmedi.
- Yalnız kaynaklı gerçek veri: Daha dar belirsizlik; mevcut veri açıklarında pilot gelişimini kısıtlıyor. Kullanıcı tahmini veriye de izin verdi.
- Ücretli sağlayıcı değerlendirmesi: Bu aşamada seçilmedi; açık/izinli verinin kapsamı ölçüldükten sonra yeniden görüşülebilir.

## Yeniden değerlendirme

Kaynak kapsamı, model doğruluğu veya dağıtım koşulları hedefi karşılamazsa kaynak/kalite politikası yeniden görüşülür. Bu kayıt mühendislik katsayılarını, tüketim modelini, şarj eğrilerini veya üretim hata eşiklerini belirlemez.
