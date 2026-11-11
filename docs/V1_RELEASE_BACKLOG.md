# V1 çıkışı öncesi kapanacak açıklar

Son güncelleme: 2026-11-11.

Kullanıcı kararıyla CR-009'un kalan doğrulama ve üretime hazırlık işleri bu backlog'a taşındı. CR-009 teknik uygulama kapsamı DONE; aşağıdaki işler tamamlanmış sayılmaz. Sonraki görevler ilerleyebilir, V1 yayını öncesinde bu maddelerin kapanış kanıtları birlikte incelenir. Bu liste şu an yalnızca Task 9'dan devredilen işleri içerir; diğer görevlerin açıkları otomatik kapanmaz.

Tüm maddeler TODO. Sorumlu henüz atanmadı. V1 çıkış kontrolünde açık madde bırakılacaksa kapsam/ürün davranışı için ayrıca açık karar kaydedilir; yalnızca erteleme, mevcut üretim korumalarını kaldırmaz.

| Kimlik | İş | Kapanış ölçütü | Bağlı kapsam |
| --- | --- | --- | --- |
| V1-ROAD-001 | Gerçek ücretsiz hız verisini doğrula | İzinli OSM kaynağından dolu hız etiketleri alınır; yol kimliği/yön eşleşmesi, koşullu ve eksik değer davranışı gerçek örnekle doğrulanır. Bilinen/bilinmeyen hız mesafesi raporlanır. Mevcut Ankara örneğinin sıfır kapsaması başarı kanıtı olarak kullanılmaz. | CR-009, CR-011, CR-016 |
| V1-ROAD-002 | İstasyon giriş/çıkış ve yaklaşımını doğrula | Seçilmiş tesislerde bağımsız harita/saha kanıtıyla kapı, yön, bölünmüş yol, bariyer/özel erişim ve hatalı snap senaryoları incelenir. Ana yoldan ayrılma ve geri dönüş hesabı kontrol edilir. Kanıtsız tesisler fiziksel erişimi doğrulanmış diye gösterilmez. | CR-007, CR-009, CR-013, CR-019 |
| V1-ROAD-003 | Gerçek rota örneklemini ve performans ölçümünü genişlet | Kısa/uzun, şehirler arası, dağlık, iki yönlü, ücretli yol/feribot kaçınması ve ulaşılamayan nokta senaryoları kaydedilir. Mesafe/süre, yükseklik, kesim bütçesi ve eksik veri davranışı doğrulanır. Uzun rota için yerel p95/p99 raporu ve önceden kararlaştırılmış kabul sınırları eklenir; kamu servisine yük testi yapılmaz. | CR-009, CR-011, CR-013 |
| V1-ROAD-004 | Üretim yol/hız servisini ve işletim bütçesini seç | Kendi barındırmamız veya kullanımımıza izin veren yönetilen servis seçilip çalıştırılır. Saklama/kendi haritamızda gösterim koşulları, atıflar, kapasite, aylık maliyet ve hata davranışı belgelenir. Üretim provası kamu demo/Overpass bağımlılığı olmadan geçer; mevcut üretim engeli korunur. | CR-009, CR-016, CR-019 |
| V1-ROAD-005 | Yükseklik veri seti ve lisansını doğrula | Kaynak/veri sürümü, örnekleme, saklama/gösterim hakkı ve atıf kaydedilir; ara tırmanış/iniş ve eksik yükseklik örnekleri bağımsız kontrol edilir. Uygun değilse ayrı yükseklik provider'ı seçilir. Doğrulanmamış profil kesin enerji girdisi sayılmaz. | CR-009, CR-011 |
| V1-ROAD-006 | Önbellek fiziksel temizliğini işletime al | Mevcut `roads:cleanup` komutu periyodik çalıştırılır. Süresi dolan rota yanıtları/OSM etiketleri silinir, aktif lease korunur; hata takibi ve erişim/saklama politikası doğrulanır. TTL'nin okuma sırasında geçersizleşmesi ile fiziksel silmenin ayrı olduğu işletim belgesinde kalır. | CR-009, üretim işletimi |

Her madde kapanırken durum, tarih ve test/rapor/saha kanıtının bağlantısı bu dosyaya eklenir. Canlı trafik desteği bu açıkların tamamlanmış bir özelliği değildir; kabul edilen V1 davranışı, trafik yoksa açık uyarıyla devam etmektir. Harita ekranı ve navigasyon kendi görevlerinde uygulanır.

Başlangıç kanıtları: [yol provider teslimi](ROAD_PROVIDERS.md), [gerçek rota/sapma raporu](validation/task9-road-validation.json), [yerel performans raporu](validation/task9-road-benchmark.json), [ADR-007](adr/007-road-provider-pilot.md).
