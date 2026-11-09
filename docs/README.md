# ChargeRoad planlama belgeleri

Son güncelleme: 2026-11-10

Bu belgeler üzerinde uzlaşılan ürün davranışını, önerilen uygulama sırasını ve henüz kararlaştırılmamış mimari tercihleri ayırır. Buradaki görevler uygulamanın geliştirilmiş olduğu anlamına gelmez.

## Okuma sırası

1. [Ürün kapsamı](PRODUCT_SCOPE.md): Kullanıcı akışları ve sürüm sınırları.
2. [Rota ve enerji kuralları](ROUTING_ENGINE.md): LLM'den bağımsız hesaplama ve yeniden planlama sözleşmesi.
3. [Görevler](TASKS.md): Bağımlılıklar, kabul ölçütleri ve geliştirme sırası.
4. [Açık mimari kararlar](ARCHITECTURE_DECISIONS.md): Birlikte değerlendirilecek seçenekler.
5. [Araç kataloğu](VEHICLE_CATALOGUE.md): DB aktarımı, API, testler ve kaynak sınırları.
6. [Katalog kararı](adr/001-vehicle-catalogue.md): Bu teslimin teknik kapsamı.
7. [ADR şablonu](adr/000-template.md): Sonraki kararlar için şablon.

- [Ortak rota/enerji sözleşmeleri](DOMAIN_CONTRACTS.md): Tüketim, voltaj/termal etkiler ve doğrulama kuralları.
- [Sağlayıcı sınırları](PROVIDER_BOUNDARIES.md): Dış veri portları, kendi planlayıcımız ve veri toplama koordinasyonu.
- [Pilot doğrulama analizi](PILOT_VALIDATION.md): Ioniq 5/6, tüketim referansları, p95/p99 ve istasyon erişimi önerisi.
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
- 18 API/birim/DB entegrasyon testi geçti; üç paketin TypeScript kontrolü ve API production derlemesi doğrulandı.
- Rota motoru, kullanıcı hesabı, navigasyon ve haftalık veri jobu henüz uygulanmadı.
