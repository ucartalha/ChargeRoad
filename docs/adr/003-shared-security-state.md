# ADR-003: Güvenlik durumu ve rate limiting sınırı

- Durum: ACCEPTED — paylaşılan durum yaklaşımı ve ilk faz rate limiting uygulaması.
- Tarih: 2026-11-10
- İlgili kayıtlar: DEC-001/004/010; CR-003/020/021/022.
- Dayanak: Kullanıcı yatay ölçeklemede katmanı yeniden yazmamak için paylaşılan store sınırını ve günlük üç IP aşımı korumasını istedi.

## Karar

- Açık JWT doğrulama anahtarları yerel süreli cache kullanabilir; gerçek auth entegrasyonu sonraki iş.
- Oturum iptali, sahiplik, haklar ve genel rate sayaçları sunucular arasında ortak durum gerektirir.
- İlk rate adapter'ı PostgreSQL; Redis kurulmadı. RateLimitStore.consume atomik domain işlemi olarak tanımlandı.
- Aynı IP'nin gün içinde üç ayrı politika/pencere aşımı, gün sonuna kadar geçici engel üretir. Aynı aşılmış pencerenin tekrarları ayrı ihlal sayılmaz.
- Gün Europe/Istanbul; eşikler ayarlanabilir. Kota aşımı 429, ortak store/admission hatası 503.
- Yerel güvenlik sayacına fail-open yapılmaz. Reverse proxy yalnızca açıkça güvenilen adreslerle yapılandırılır.

## Sonuçlar

Ek servis ve paket bağımlılığı eklenmedi; DB'nin küçük fakat sıfır olmayan maliyeti var. Rate guard controller'ların işini keser; ağ seviyesindeki saldırıyı kesmez. IP engeli ortak NAT kullanıcılarını etkileyebilir; limitler ve geçici ban operasyonel olarak izlenecek.

## Kanıt ve sonraki adım

[Rehber](../RATE_LIMITING.md): Atomiklik, iki API instance'ı, hata ve gün sınırı testleri. Redis/edge/üretim kapasitesi henüz uygulanmadı veya ölçülmedi. Auth sağlayıcısı ve kendi uygulama verilerinin yetkilendirme mekanizması bu ADR ile tamamlanmış sayılmaz.
