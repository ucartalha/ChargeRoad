# ChargeRoad planlama belgeleri

Son güncelleme: 2026-11-11

Bu belgeler üzerinde uzlaşılan ürün davranışını, önerilen uygulama sırasını ve henüz kararlaştırılmamış mimari tercihleri ayırır. Buradaki görevler uygulamanın geliştirilmiş olduğu anlamına gelmez.

## Okuma sırası

1. [Ürün kapsamı](PRODUCT_SCOPE.md): Kullanıcı akışları ve sürüm sınırları.
2. [Rota ve enerji kuralları](ROUTING_ENGINE.md): LLM'den bağımsız hesaplama ve yeniden planlama sözleşmesi.
3. [Görevler](TASKS.md): Bağımlılıklar, kabul ölçütleri ve geliştirme sırası.
   [V1 çıkış backlog'u](V1_RELEASE_BACKLOG.md): Task 9'dan devredilen doğrulama ve üretime hazırlık açıkları; V1 öncesi kapanış ölçütleri.
4. [Açık mimari kararlar](ARCHITECTURE_DECISIONS.md): Birlikte değerlendirilecek seçenekler.
5. [Araç kataloğu](VEHICLE_CATALOGUE.md): DB aktarımı, API, testler ve kaynak sınırları.
6. [Katalog kararı](adr/001-vehicle-catalogue.md): Bu teslimin teknik kapsamı.
7. [ADR şablonu](adr/000-template.md): Sonraki kararlar için şablon.

- [Ortak rota/enerji sözleşmeleri](DOMAIN_CONTRACTS.md): Tüketim, voltaj/termal etkiler ve doğrulama kuralları.
- [Sağlayıcı sınırları](PROVIDER_BOUNDARIES.md): Dış veri portları, kendi planlayıcımız ve veri toplama koordinasyonu.
- [Pilot doğrulama analizi](PILOT_VALIDATION.md): Ioniq 5/6, tüketim referansları, p95/p99 ve istasyon erişimi önerisi.
- [Referans doğrulama düzeneği](REFERENCE_VALIDATION.md): Elle hesaplanan snapshot'lar, bağımsız küçük ağ çözücüsü, aday plan denetimi, p95/p99 komutu ve saha kayıt şablonu.
- [Task 6 hazırlığı](TASK_006_PREPARATION.md): Kaynak matrisi, bağımsız araç kimliği, sürümlü referanslar, atomik yayınlama ve uygulama sırası.
- [Task 6 teknik teslimi](VEHICLE_KNOWLEDGE.md): Yeni katalog/kanıt şeması, kaynak sync, kullanıcı aralıkları, DB provider'ı ve kalan pilot veri açıkları.
- [Task 7 mimari hazırlığı](TASK_007_PREPARATION.md): Türkiye istasyon kataloğu, kaynak/eşleştirme politikaları, kapsamlı koridor cevabı ve DB sınırları.
- [Task 7 teknik teslimi](STATION_CATALOGUE.md): EPDK kataloğu, PostGIS koridoru, dinamik geometri, kaynak kotası, API ve ölçümler.
- [Task 8 hazırlığı](TASK_008_PREPARATION.md): Canlı sağlayıcı seçimi, toplu sorgu/push, EVSE eşleştirmesi, tazelik ve uygulama adımları.
- [İstasyon kaynak araştırması](STATION_SOURCE_RESEARCH.md): Gerçek EPDK marka sorgusu/429 kanıtı, alan analizi ve Google/HERE için 24 istasyonluk ölçülmemiş örneklem.
- [Open Charge Map araştırması](OPEN_CHARGE_MAP_RESEARCH.md): Seçilen başlangıç kaynağı; ücretsiz API, rota sorguları, genel durum/canlı doluluk ayrımı, lisans ve DB uyarlama adımları. Diğer servisler yedekte.
- [OCM gerçek API doğrulaması](OCM_VALIDATION.md): Anahtarla 25 kayıt ve 24 lokasyon sorgusu, lisans filtresinin sınırı, eşleştirme adayları ve kalan import işi.
- [Provider mimarisi ve OCM teslimi](STATION_PROVIDERS.md): Çok kaynaklı registry/politika, ortak worker koruması, 1.737 gerçek OCM kaydı, testler ve kalan canlı feed kapsamı.
- [Task 9 hazırlığı](TASK_009_PREPARATION.md): Yönetilen yol API pilotu, hız/yükseklik/trafik ayrımı, gerçek istasyon sapması, kota ve doğrulama adımları.
- [Task 9 yol provider teslimi](ROAD_PROVIDERS.md): Valhalla/OSM, ücretsiz veri/kendi haritamız, PostgreSQL cache/kota, gerçek sapma kanıtı ve kalan doğrulama kapıları.
- [Task 10 hazırlığı](TASK_010_PREPARATION.md): MET Norway, geçiş saatine göre örnekleme, PostgreSQL cache/304, hava veri kalitesi ve alt görevler.
- [Task 10 hava provider teslimi](WEATHER_PROVIDERS.md): Gerçek MET Türkiye verisi, örnekleme/geçiş zamanı, ortak cache/kota, HTTP pilotu ve p95/p99 kanıtı.
- [Hava sağlayıcısı kararı](adr/008-weather-provider-and-planning-policy.md): MET Norway başlangıcı, eksik temel hava politikası ve 72 saatlik hareket penceresi.
- [Yol pilotu kararı](adr/007-road-provider-pilot.md): Kabul edilen üç tercih ve sağlayıcı seçiminde ücretsiz plan koşulları.
- [Canlı müsaitlik kararı](adr/006-live-availability-provider-boundary.md): Sağlayıcıdan bağımsız port, ortak PostgreSQL durumu ve kabul edilen kaynak erişim kapıları.
- [İstasyon politika kararı](adr/005-station-catalogue-policy.md): Türkiye geneli + pilot, EPDK önceliği ve bilinmeyen müsaitlik için kabul edilen ilkeler.
- [Kişisel enerji verisi](PERSONALIZED_ENERGY_DATA.md): Hız/koşul referansları, 15 dakikalık sürüş özetleri, enerji kanıtları, kişisel eğri ve ortak referans birleşimi.
- [Araç kimliği/veri kalitesi kararı](adr/004-vehicle-identity-and-data-quality.md): Kabul edilen çok kaynaklı katalog, etiketli mühendislik tahmini ve kaynak erişim sınırları.
- [CR-003 veri mimarisi önerisi](DATA_ARCHITECTURE.md): Hesap, tek araç kotası, misafir geçmişi, transaction ve performans.
- [Paylaşılan rate limiting](RATE_LIMITING.md): PostgreSQL adapter'ı, günlük üç aşım, proxy ve işletim sınırları.
- [Hesap/garaj/geçmiş kararı](adr/002-account-garage-history.md): Kabul edilen ürün kuralları ve açık kalan teknik seçimler.

## Belge kuralları

- Ürün gereksinimi ile teknoloji önerisi aynı şey değildir.
- Açık bir karar, konuşulmadan kabul edilmiş sayılmaz. Mevcut kodda bir teknoloji bulunması da yeni bir mimari onay değildir.
- Karar alındığında ilgili DEC kaydı güncellenir ve gerekiyorsa ayrı bir ADR oluşturulur.
- Görev kimlikleri korunur. Durumlar: TODO, IN_PROGRESS, BLOCKED, DONE.
- DONE için görevdeki kabul ölçütleri sağlanmalı ve doğrulama kanıtı yazılmalıdır.
- Depoda uygulanan davranış değişirse ilgili belgeler de güncellenir.

## Mevcut durum

- Mobilde marka → model → yıl/varyant seçimi DB API'sine bağlı. Onaylanan araç kimliği cihazda saklanıp rota ekranında gösteriliyor. API sağlık endpoint'i ve ortak TypeScript sözleşmeleri mevcut.
- Araç katalog şeması, migration, OpenEV Data aktarımı ve DB'den okuyan HTTP uçları uygulandı.
- 65 marka, 260 model, 1.189 kayıt yerel DB'ye aktarıldı. Tüketim ve şarj eğrisi bu kaynak sürümünde bulunmuyor.
- Son CR-007 kontrolünde DB/PostGIS entegrasyonları dahil 163 API testi ve 31 ortak sözleşme testi geçti; atlanan yok. Üç paketin TypeScript kontrolü ve API production derlemesi doğrulandı. İlk katalog tesliminin gerçek DB doğrulama kanıtı katalog belgesinde korunur.
- Kaynaklardan bağımsız katalog 1.189 eski ve 2 pilot konfigürasyonunu içerir. Kilowatt kaynağındaki 1.321 kayıt inceleme adayı olarak alındı; otomatik olarak doğrulanmış araç/test sayılmadı. Üç Ioniq 6 kullanıcı tüketim aralığı ayrıca korunur. Pilot enerji profilleri için veri yeterliliği açık.
- CR-005 için 15 elle hesaplanan sentetik vaka, bağımsız küçük ağ referansı, aday plan denetimi ve 10.000 örnek p95/p99 raporu hazır; gerçek Ioniq saha verisi henüz yok.
- Statik istasyon kataloğu ve dinamik yol geometrisiyle PostGIS aday sorgusu hazır: 17.165 lokasyon ve 50.259 soket beyanı. Canlı müsaitlik ve fiziksel EVSE gruplaması bu kaynaktan türetilmedi.
- Rota motoru, kullanıcı hesabı, navigasyon ve haftalık veri jobu henüz uygulanmadı.
