# ADR-010 — Deterministik DC şarj süresi bileşeni

Tarih: 2026-11-11. Kapsam: CR-012, DEC-008'in uygulama ayrıntıları. Kullanıcının Task 12'ye başlama talebi kapsamında; yeni sağlayıcı/ticari anlaşma veya üretim hata eşiği seçimi değildir.

SOC'ye bağlı kaynaklı araç eğrisi ile seçilen fiziksel EVSE/connector ve şarj yolu sınırları birlikte entegre edilir. Saf çekirdek ağ/DB/LLM kullanmaz; assessment mevcut provider portundan PostgreSQL profilini alır. Değiştirilebilir veri kaynağı yapısı korunur.

Giriş, terminal ve net depolama sınırları açık dönüştürülür; verimler/yardımcı güç kaynaklı, sürümlü `chargingModel` içindedir. Enerji motorunun kapasite snapshot'ı taşınır; SOH/sıcaklık ikinci kez uygulanmaz. Mevcut immutable JSONB yayın transaction'ı yeterlidir; yeni tablo/cache/Redis eklenmez.

SOC/voltaj düğümleri ve güç kısıtlarının kesişimleri üzerinden sınırlı adaptive quadrature seçildi. Sabit maksimum kW veya kaba sabit SOC adımı, taper ve dar güç kısıtlarını yanlış tahmin edebilir. Akım×voltaj ve converter yolu desteklenir; mimari etiketten güç/verim türetilmez.

Eksik eğri, koşul, donanım veya kayıp bilgisi açık yetersizliktir. Dinamik termal model veya saha kalibrasyonu varmış gibi davranılmaz. Koşullu şarj süresi hesaplanabilir; bilinmeyen kuyruk kesin ayrılış zamanı üretmez. AC, blocking ısınma, durak/rota optimizasyonu ve canlı servis rezervasyonu ayrı kapsamlardır.

Sonuç: backend hesap bileşeni ve replay araçları hazırdır. Gerçek Hyundai pilot profili ve bağımsız süre doğrulaması hâlâ eksiktir; CR-006/011/saha kabulü açık kalır. [Formüller, sınırlar ve kanıt](../CHARGING_ENGINE.md).
