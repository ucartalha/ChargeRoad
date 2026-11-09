# ADR-002: Misafir, hesap, garaj ve seyahat geçmişi

- Durum: ACCEPTED — ürün ve veri sahipliği gereksinimleri.
- Tarih: 2026-11-10
- Dayanak: Kullanıcının açık yanıtları.
- İlgili kayıtlar: DEC-001/002/003/004/009/011; CR-003/015/017/018/020/021/022.

## Kabul edilen kararlar

- Misafirler rota ve navigasyon kullanabilir; garaj oluşturamaz.
- Hesaplar ilk sürümde e-posta ve şifre ile giriş yapar. Google girişi ileride etkinleştirilecek.
- Garaj hesapta tutulur ve cihazlar arasında eşitlenir.
- Ücretsiz kullanıcı bir aktif araç tutabilir ve değiştirebilir.
- Premium altyapısına genişleme mümkün olmalı; premium hakları ve araç sayısı henüz belirlenmedi.
- Misafir ayrıntılı seyahat geçmişi sunucuda güvenli misafir oturumuna bağlanır; hesap açınca sahiplik doğrulanarak aktarılabilir.
- Ayrıntılı geçmiş, yolculuk sonu toplam enerji, ortalama tüketim ve tahmini maliyet için kullanılacak.
- Toplam enerji kWh, ortalama tüketim kWh/100 km olarak ayrı gösterilecek.
- Redis bu aşamada eklenmeyecek; DB transaction'ları, indeksler, asenkron I/O ve yük testleri tasarıma dahil olacak.

## Bu kararın kesinleştirmedikleri

Auth sağlayıcısı, token biçimi/süreleri, veri saklama süreleri, premium kota sayısı, kalibrasyon izni ve sayısal performans hedefleri bu kararla seçilmedi.

## Mevcut davranışa etkisi

Mobilde girişsiz yerel araç ID saklama bir prototip davranışıdır. Auth/garaj işinde geçici rota aracı ile kalıcı hesap garajı ayrılacak. Bu ADR tek başına o kodun uygulandığı anlamına gelmez.

## Teknik tasarım

[CR-003 tasarım önerisi](../DATA_ARCHITECTURE.md) sahiplik, güvenli guest claim, tek slot, transaction ve performans yaklaşımını açıklar. Oradaki teknik öneriler henüz tamamlanmış migration veya üretim kanıtı değildir.
