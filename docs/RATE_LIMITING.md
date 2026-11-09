# Paylaşılan rate limiting — ilk faz

Tarih: 2026-11-10. Durum: Uygulandı. Bu katman DDoS/WAF veya henüz eklenmemiş auth sistemi değildir.

## Davranış

- Korumalı endpoint'ler controller çalışmadan önce global Nest guard ile denetlenir.
- Sabit zaman penceresinde kota aşılırsa HTTP 429, RATE_LIMIT_EXCEEDED ve Retry-After döner.
- Aynı IP için aynı politika/pencere içindeki tekrarlar tek ihlal sayılır. Pencereler arasında veya farklı politikalarda üç ayrı aşım günlük engeli tetikler.
- Üçüncü ihlal IP'yi o günün sonuna kadar engeller; korumalı tüm politikalarda IP_BLOCKED_UNTIL_DAY_END döner.
- Gün Europe/Istanbul saat dilimine göre değişir. Gece yarısında yeni gün sayacı açılır; kalıcı ban uygulanmaz.
- IP, güvenilen proxy ayarı yokken doğrudan socket'ten alınır. Kullanıcının X-Forwarded-For başlığına güvenilmez.
- IPv4, IPv4-mapped IPv6 ve IPv6 metinleri normalize edilir.
- DB'de çıplak IP yerine paylaşılan sırla HMAC-SHA256 anahtarı tutulur. Bu takma kimlikli güvenlik verisidir; anonimleştirme garantisi değildir.
- Sağlık endpoint'i ve CORS preflight bu sayaca dahil değildir. Eşleşmeyen 404 yolları Nest guard'dan geçmez.

## Başlangıç ayarları

| Değişken | Değer | Açıklama |
|---|---|---|
| RATE_LIMIT_CATALOGUE_PER_MINUTE | 120 | Mevcut araç katalog endpoint'leri ortak kota |
| RATE_LIMIT_GENERAL_PER_MINUTE | 60 | Aksi belirtilmeyen korumalı controller |
| RATE_LIMIT_AUTH_PER_MINUTE | 10 | Gelecekte bize ait auth endpoint'lerine açıkça atanabilir |
| RATE_LIMIT_DAILY_STRIKES | 3 | Aynı gün ayrı aşım sayısı |
| RATE_LIMIT_DAY_TIMEZONE | Europe/Istanbul | Gün sınırı |
| RATE_LIMIT_MAX_PENDING | 32 | Instance başına en fazla devam eden/bekleyen store işlemi |
| RATE_LIMIT_IP_HASH_SECRET | Zorunlu, en az 32 karakter | Bütün instance'larda aynı rastgele sır |
| TRUSTED_PROXY_CIDRS | Boş | Yalnızca gerçek reverse proxy IP/CIDR'leri |

Bunlar ayarlanabilir operasyonel başlangıç değerleridir; üretim kapasite testi değildir. Mobil arama, ortak Wi-Fi ve operatör NAT trafiğine göre izlenip ayarlanmalı. IP aynı cihaz/kullanıcı anlamına gelmez. IPv6 adres döndürme ve dağıtık saldırılara karşı IP kotası tek başına yeterli değildir.

Auth politikası tanımlı olsa da auth endpoint'leri henüz uygulanmadı. Mobil istemcinin doğrudan kimlik sağlayıcısına yaptığı istekler bizim guard'dan geçmez; sağlayıcının kendi kotaları ayrıca yapılandırılmalıdır.

Fixed-window sınırları pencere geçişinde kısa süreli çift kota kadar trafiğe izin verebilir. Daha hassas trafik şekillendirme gerekirse algoritma ve politika sürümü birlikte değiştirilir.

## Mimari sınır

RateLimitGuard → RateLimitStore.consume → PostgresRateLimitStore.

consume tek atomik işlemdir: sayacı tüketme, tekil pencere ihlali, günlük ihlal sayısı ve engel kararı birlikte güncellenir. Redis adapter'ı ileride bu işlemi atomik uygulamalıdır; sıradan get/increment/set dizisi yeterli değildir. Guard ve controller'lar Redis client'ını bilmez.

JWT/JWKS açık anahtarları için süreli yerel önbellek yaklaşımı kabul edildi; gerçek IdentityVerifier ve managed-auth entegrasyonu henüz yok. Oturum/iptal, sahiplik ve premium hakları ortak kaynakta tutulacak; instance belleği bunların asıl kaynağı olmayacak.

## DB ve kaynak kullanımı

002_rate_limiting migration'ı bir tablo ve atomik PostgreSQL fonksiyonu ekler.

- Bir IP/gün için tek satır, sınırlı politika sözlüğü. Her URL veya her istek için log satırı oluşturulmaz.
- Korumalı istek başına tek DB round-trip.
- Normal sayaç güncellemesi kısa transaction/row lock içinde yapılır.
- Zaten engellenmiş trafik indeksli okuma ile döner; sayaç güncellemez ve row lock almaz.
- Fonksiyonun lock timeout'u 250 ms. Devam eden store işleri instance başına sınırlıdır.
- Store veya admission kapasitesi erişilemezse controller çalıştırılmaz; 503 ve kısa Retry-After döner. Altyapı hatası kullanıcı ihlali sayılmaz.
- Yerel allow-cache veya instance'a özel güvenlik sayacı yok. Bellekte yalnızca kaynak tüketimini sınırlayan admission sayısı ve hata logu aralığı bulunur.

Bu yöntem ayrı Redis/servis aboneliği gerektirmez. DB CPU, WAL, bağlantı ve depolama maliyeti sıfır değildir; trafik arttıkça ölçülmelidir. Uygulama katmanında reddedilen trafik hâlâ ağ/TLS/HTTP ve küçük bir DB kontrolü tüketir.

Çok yoğun saldırıları sunucuya ulaşmadan engellemek için edge/reverse proxy/WAF sonraki fazdır. Redis'e geçiş tetikleri: rate kontrol gecikmesi, pool/lock bekleme ve DB yazım yükü. Şu an üretim throughput garantisi yok.

## Yatay ölçekleme ve proxy

Bütün instance'lar aynı DB, IP hash sırrı, saat dilimi ve politika ayarlarıyla çalışır. Yerel cache kaybolunca sayaçlar sıfırlanmaz. Ayar/sır değişimi kontrollü yapılmalı; sır değişimi IP anahtarlarını değiştirdiği için mevcut blok durumunu etkiler.

TRUSTED_PROXY_CIDRS yalnızca bilinen proxy adresleriyle doldurulmalı. Geniş trust proxy=true kullanılmaz. Proxy de forwarded başlıklarını temizlemeli/yeniden yazmalı; doğrudan API erişimi deployment'ta uygun şekilde sınırlandırılmalı. [Express açıklaması](https://expressjs.com/en/guide/behind-proxies/)

Store unavailable davranışı gelecekteki Redis adapter'ında da korunmalı. Redis yerel sayaca sessiz geçiş yapamaz; DB fallback'i varsa aynı otoriter sayaç durumuyla tutarlılığı ayrıca tasarlanmalı. Mevcut kodda Redis veya dual-write yok.

## Kurulum ve temizlik

.env içinde RATE_LIMIT_IP_HASH_SECRET için rastgele güçlü bir değer tanımlayın; gerçek değeri .env.example veya repoya koymayın. Yerel geliştirme sırrı bu teslimde oluşturuldu; mevcut dolu sır ezilmedi ve tool çıktısına yazılmadı.

~~~sh
pnpm db:migrate
pnpm --filter @chargeroad/api build
pnpm --filter @chargeroad/api start
pnpm --filter @chargeroad/api security:cleanup
~~~

CLI migration/import için boş örnek sır kabul edilebilir; HTTP API sırsız açılmaz. Anahtar saklama ortamı ve dağıtım sırları CR-021'de ele alınacak.

expires_at erişim kararının süresini belirler, satırı otomatik silmez. security:cleanup çağrı başına en fazla 1000 süresi geçmiş satırı temizler; canlı kayıtları silmez. Güvenilir periyodik cleanup henüz kurulmadı. Deployment işletiminde periyodik çağrı yapılmalı; hacim/retry takibi CR-021'in parçasıdır. Bekleyen temizlik, gün sonunda engelin kalkmasını geciktirmez.

## Test ve kapsam

30 API testi geçti; 12 yeni test rate guard/config ve gerçek DB/HTTP davranışını kapsar. Özellikle iki uygulama instance'ı, eşzamanlı store çağrıları, tek pencere ihlali, üçüncü aşım, İstanbul gece yarısı, proxy spoof, IP normalizasyonu, store hatası, admission ve bounded cleanup doğrulandı. Araç katalog testleri korunuyor; migration checksum testi birden çok migration'ı doğru geri yüklüyor.

Bu bir yük testi veya tüm saldırı türlerine karşı koruma kanıtı değildir. Eşiklerin kalibrasyonu, edge koruması, hesap bazlı limitler, merkezi izleme, erken unblock operasyonu ve Redis adapter'ı sonraki işlerdir.
