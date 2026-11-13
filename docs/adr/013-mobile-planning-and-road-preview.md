# ADR-013 — Mobil planlama ve veri yetersizliğinde yol önizlemesi

Tarih: 2026-11-12. Durum: Kullanıcı ürün kararları kabul edildi; CR-015 uygulandı. [Teslim](../MOBILE_PLANNING.md).

## Kabul edilen ürün kararları

- Araç profili/temel hava yetersizliğinde yol önizlemesi sunulur; SOC/otomatik şarj önerisi kapalı kalır. Eksiklik nedeni silinmez.
- Uygun ve sürümlü mühendislik profili yalnız açık kullanıcı onayıyla kullanılabilir. Eksik model kendiliğinden üretilmez.
- Adres araması ve isteğe bağlı cihaz konumu sağlanır; backend adapter'ı ile sağlayıcı değiştirme mümkündür.

## Teknik uygulama

İstemci strict public plan DTO'sunu gönderir. Girdilerden türetilmiş güncel istek kimliği, iptal ve generation kontrolü eski yanıtları engeller. Planlama tuşla başlar; her karakterde pahalı rota hesabı yapılmaz. Kalite onayı araç değişiminde sıfırlanır. Rezerv/varış SOC zorunluluğu ADR-011'den gelir.

Adres seçimi ayrı port/registry ve genel HTTP sözleşmesiyle yapılır. Geliştirme için Photon adapter'ı, PostgreSQL ortak bütçe/cache ve public demo üretim engeli eklenir. Bu sağlayıcı seçimi üretim tedarik kararını kapatmaz. Foreground konum yalnız kullanıcı eylemiyle okunur; izin reddi akışı engellemez.

Yol önizlemesi ayrı endpoint ve ayrı sonuç modelidir. Tam enerji kesimleri veya EV reachability hesabı gerektirmez; yol sağlayıcısının gerçek mesafe/süresi, atıfları ve yola eşleme mesafelerini gösterir. Enerji modelinin doğrulama kapıları veya sınırları gevşetilmez. Önizleme alındığında ilk planın veri yetersizliği sonucu korunur; kalite otomatik değiştirilmez.

## Sonuç

Kullanıcı veri eksikliği halinde temel güzergâh bilgisine erişir; doğrulanmamış SOC/şarj önerisi alamaz. Harita, navigasyon ve sahipliğe bağlı kalıcı veri akışları sonraki görevlere kalır. Gerçek cihaz kabulü ve üretim sağlayıcı/lisans/kapasite kararı V1 öncesinde doğrulanmalıdır.
