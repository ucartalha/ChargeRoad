# ADR-001: Araç kataloğunu DB'den sunmak

- Durum: ACCEPTED — yalnızca bu teslimin araç kataloğu kapsamı.
- Tarih: 2026-11-09
- İlgili kararlar: DEC-005 ve DEC-007 kısmi; DEC-001 için haftalık güncelleme hedefi.
- İlgili görevler: CR-002, CR-003, CR-006, ileride CR-021.
- Dayanak: Kullanıcı araç verilerinin önce DB'ye alınmasını, uygulamanın dış kaynak isteğini beklememesini ve haftalık jobun sonraya bırakılmasını istedi.

## Karar

Mevcut PostgreSQL/PostGIS ortamı korunur. Bu teslimde pg bağlantı havuzu, parametreli SQL repository'leri ve checksum'lı ileri yönlü SQL migration kullanılır. Bu seçim bütün uygulama için ORM yasağı veya diğer veri alanlarının onayı değildir.

İlk kaynak OpenEV Data'nın sürümlenmiş JSON release dosyasıdır. Kaynak adaptörü indirme/doğrulama yapar; VehicleImportService akışı yönetir; import repository transaction içinde normalize tablolara yazar. HTTP katalog modülü sadece DB okur.

İlk aktarım manuel CLI ile çalışır. Gelecekte haftada bir job aynı servisi çağırır. Redis, scheduler, kimlik sağlayıcısı ve oturum mimarisi seçilmedi.

## Gerekçe ve alternatifler

- Kullanıcı isteği sırasında kaynağı çağırmak gecikme ve dış servis bağımlılığı yaratır; seçilmedi.
- Yalnızca JSON dosyasını uygulamaya gömmek filtreleme ve güncelleme ihtiyacını karşılamaz; seçilmedi.
- Ayrı veri servisi, kuyruk veya Redis bu ilk teslim için gerekli değil.
- SQL, verinin constraint ve transaction davranışını açık tutar; repository sınırı ileride farklı DB erişim araçlarını değerlendirmeyi mümkün kılar.

## Kanıt

1.189 gerçek kaynak kaydı iki kez aktarıldı; kimlik ve kayıt sayısı korundu. 18 test, production build ve production HTTP kontrolü geçti. Ayrıntılar [katalog rehberinde](../VEHICLE_CATALOGUE.md).

## Sınırlamalar

Kaynak sürümünde doğrudan tüketim/şarj eğrisi ve açık TR pazar etiketi yok. Pilot araç doğrulaması ayrı kabul kapısıdır. Bu veriler rota motoruna otomatik olarak hazır kabul edilmez.

## Yeniden değerlendirme

Kaynak kalitesi/yeterliliği, veri hacmi, başka kaynaklarla eşleştirme veya haftalık iş güvenilirliği ihtiyaçları değişirse ilgili DEC kayıtları yeniden ele alınır.
