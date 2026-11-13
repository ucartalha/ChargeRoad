# ADR-012 — Genel planlama API'si ve paylaşılan kapasite

Tarih: 2026-11-12. Durum: CR-014 uygulandı. İlgili kararlar: DEC-001/002/003/008; [teslim](../PLANNING_API.md).

## Bağlam

Deterministik planlayıcının mobil istemciye açılması gerekir. Dahili profil/politika girdileri güvenilir istemci verisi sayılamaz. Hesapsız planlama desteklenir; garaj, geçmiş aktarımı ve kişisel öğrenme için daha sonra gerçek sahiplik gerekir. Kaynak çağrıları ve hesap maliyeti, instance sayısı arttığında da sınırlanmalıdır.

## Karar

`POST /v1/plans` için ayrı, strict ve sürümlü genel DTO kullanılır. Rezerv ve hedef SOC zorunludur. Sunucu hesap/kalite politikalarını uygular; kullanıcı yalnız izinli tercihler ve kendi gözlemlerini verir. Eksik gözlemler bilinmiyor kalır. Alan başarısızlıkları ile HTTP/protokol hataları ayrı sözleşmelerdir. Model ve algoritma sürümleri döner; özel replay/validation paketleri dönmez. Sonuç, çalıştırılan isteğe karşı doğrulanır.

İlk endpoint `stateless_guest` ve `historyStored:false` döndürür. Bu bir misafir kimlik sistemi değildir. Hesap/oturum ve kalıcı seyahat geçmişi CR-017/020 sınırında sahiplik doğrulamasıyla eklenecektir. İstemcinin UUID'si yetki veya idempotency sağlamaz.

Mevcut PostgreSQL rate limiting'e plan politikası eklenir. Yerel concurrency sınırına ek olarak `PlanningAdmissionStore` portunun PostgreSQL uygulaması tüm instance'larda ortak lease kapasitesi uygular. Slot alma kısa atomik transaction ile yapılır; ağ/hesap boyunca transaction tutulmaz. Token fencing, TTL, heartbeat, iptal ve geç tamamlanan işlemlerin temizlenmesi gerekir. Kuyruk oluşturulmaz; kapasite dolunca 503/Retry-After döner. Redis zorunluluğu getirilmez.

## Sonuçlar

API ve deterministik çekirdek ayrılır; sonraki mobil/auth çalışmaları çekirdeği değiştirmeden bağlanabilir. PostgreSQL erişilemezse pahalı yeni işlem başlatılmaz. Üretim kapasitesi ölçülerek ayarlanmalıdır; başlangıç sınırları SLA değildir. Saha verisi eksikse API de veri yetersiz sonucu verir. Kalıcı geçmiş, kimlik doğrulama, kişisel öğrenme yayını ve gerçek pilot kabulü bu kararla tamamlanmaz.
