# ADR-005: İstasyon kataloğu kapsamı, kaynak önceliği ve belirsizlik

- Durum: ACCEPTED — CR-007 statik katalog/koridor teslimi uygulandı. [Teknik kanıt ve sınırlar](../STATION_CATALOGUE.md).
- Tarih: 2026-11-10
- İlgili kararlar: DEC-005, DEC-007, DEC-008, DEC-012.
- İlgili görevler: CR-003, CR-007, CR-008, CR-009, CR-013, CR-021.
- Onaylayan: Kullanıcı, üç tercih sorusu ve girilen konumları güzergâh olarak kullanma ek yanıtıyla.

## Kabul edilen kararlar

1. **Türkiye geneli katalog ve dinamik güzergâh.** İlk istasyon veri kapsamı Türkiye'dir. Kullanıcının ek tercihiyle sabit pilot şehir/güzergâh seçilmedi; başlangıç/varış konumlarından yol sağlayıcısının ürettiği geometriler kullanılacak. Testler farklı uzunluk/şekil ve yönlerde geometrilerle yapılır. Gerçek yol/sapma doğrulaması CR-009'dadır.
2. **EPDK öncelikli, OCM kontrollü tamamlayıcı.** Önce EPDK servisinin alan kapsamı, erişim ve kullanım koşulları doğrulanır. Uygun olduğu alanlarda ana kaynak yapılır. Open Charge Map yalnız uygun kaynak lisansı ve güvenilir eşleştirmeyle eksikleri tamamlar. EPDK'de bulunmayan alanlar varmış sayılmaz. Kaynak geçişi sessizce yapılmaz; başarısızlık ve kapsam eksikliği raporlanır.
3. **Canlı müsaitlik bilinmiyorsa uyarıyla aday tut.** Bilinmeyen durum müsait sayılmaz. Güncel olarak arızalı veya erişilemez olduğu doğrulanan ekipman aday şarj seçeneği olarak dışlanır. Bir EVSE'nin kullanılamaması bütün lokasyonun arızalı olduğu anlamına gelmez. Dolu gözlemi kalıcı arıza değildir; varış zamanı/bekleme politikası CR-008/013'te ayrıca değerlendirilir. Planlanan/kaldırılan ekipmanın yaşam döngüsü canlı müsaitlikten ayrı değerlendirilir.

## Kaynak kanıtı ve sınırı

2026-11-11 ek tercih: Kullanıcı başlangıç entegrasyonunu OCM ile ilerletmeyi, Google ve diğer ticari hizmetleri yedekte tutmayı seçti. Yukarıdaki 2. maddenin entegrasyon sırası bu tercihle güncellendi; mevcut EPDK kataloğu/sicil dayanakları ve alan bazlı kaynak politikası korunur. OCM lisanslı ekipman/genel durum kaynağı olarak incelendi; canlı doluluk garantisi değildir. [Güncel araştırma](../OPEN_CHARGE_MAP_RESEARCH.md), [canlı katman kararı](006-live-availability-provider-boundary.md). API/import uygulaması henüz yapılmadı.

EPDK [web servisleri sayfasında](https://epdk.gov.tr/Detay/Icerik/3-34680/enerji-donusum-piyasasi-web-servisleri) `https://apigateway.epdk.gov.tr/sarjIstasyonlari` bağlantısı yer alıyor. [SSS 13](https://epdk.gov.tr/Detay/Icerik/12-1040/enerji-donusumu) istasyon/işletmeci sorgulama servislerini açıklıyor. Kontrol tarihi 2026-11-10. Servisin gerçek cevap şeması, kota ve dağıtım koşulları bu turda doğrulanmadı; web tarama aracının endpoint'i açamaması servis erişiminin kapalı olduğu kanıtı değildir. Şarj@TR uygulamasındaki tüm alanların bu serviste bulunduğu varsayılmayacak.

OCM [geliştirici rehberi](https://github.com/openchargemap/ocm-docs/blob/master/System/DeveloperGuide.md) karışık kaynak lisanslarını ve `opendata=true` filtresini açıklıyor. Gerçek adapter güncel API parametreleri, erişim ve kaynak atıflarını ayrıca doğrulayacak. OCM, canlı operatör feed'i yerine otomatik müsaitlik garantisi sayılmaz.

## Sonuçlar

Kaynaklardan bağımsız lokasyon/EVSE/soket kimliği, kaynak alias'ları, alan bazında dayanak ve kapsam kaydı gerekir. Statik yayın, canlı durum ve gerçek yol erişimi ayrı sınırlar olacak. Redis bu kararla eklenmez. Canlı veri sağlayıcısı, tarife entegrasyonu, harita/yol sağlayıcısı veya scheduler seçilmiş değildir.

Resmî kılavuzdaki ulusal saatlik/filtreli dakikalık kota doğrulandı. V1 koridor/aday/SQL/statik soft-age işletim bütçeleri [teslim belgesinde](../STATION_CATALOGUE.md) ölçümle birlikte kaydedildi; canlı TTL ve üretim SLA'sı seçilmedi. [Tarihsel hazırlık](../TASK_007_PREPARATION.md).
