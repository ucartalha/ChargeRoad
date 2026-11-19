# Şehir içi navigasyon: yön, ters yön ve sapma (2026-11-19)

Kullanıcı raporu: şehir içinde ters yön ve rotadan çıkma algılanmıyor. Kullanıcı 1–4 numaralı önerileri ve API eklemesini onayladı.

## Kök nedenler (önce)
- GPS noktası rotaya yalnız uzaklık + süreklilikle eşleniyordu; gidiş yönü kullanılmıyordu (bölünmüş yolda karşı şerit 10–30 m).
- Rotadan çıkma sınırı en az 50 m idi; paralel sokak ve karşı şerit bu sınırın içinde kalıyordu.
- İlerleme yalnız artabildiği için ters gidiş görünmüyordu.
- Yeniden hesaplama 3 okuma ve 10 s sonra ve yönsüz yapılıyor, sonraki yeniden hesaplama 60 s bekliyordu.

## Değişiklikler
- Mobil `locateOnRoute`: hız ≥ 2 m/s iken GPS yönü ile rota parçası yönü arasındaki fark ≤ 120° olan aday tercih edilir (en yakından en fazla 60 m uzak olmak koşuluyla).
- `navigationProgress.wrongWay`: güvenilir yön ile rota yönü farkı > 120°. Ekranda kırmızı "Ters yön" kartı.
- Rotadan çıkma sınırı: şehir yolları 25 m (1,5 × GPS doğruluğu), otoyol ve yol sınıfı bilinmeyen eski kayıtlı yolculuklar 50 m (2 × doğruluk).
- `trackDeviation`: rotadan çıkma veya ters yön 2 okuma boyunca sürüp 4 s ya da 40 m'ye ulaşınca yeniden hesaplama; tek iyi okuma sıfırlar.
- Başarılı yeniden hesaplamadan sonra bekleme 20 s (planlama sınırı varsayılan 6/dk); hata sonrası 60 s / `Retry-After` korunur.
- İlerleme mesafesi bilinçli olarak geri gitmez: SOC tahmini sürülen mesafeden düşülür; geri gidiş tüketimi azaltmamalı. Ters gidiş `wrongWay` ile tanınır ve yeniden hesaplanır.
- API: `originHeading` (bkz. PLANNING_API.md), Valhalla `heading`/`heading_tolerance` yalnız başlangıçtan çıkan isteklerde.

## Testler
- Mobil `navigation-heading.test.cjs` (5): karşı şerit/yön seçimi, ters yön, şehir/otoyol sınırı, sapma takibi, yeniden hesaplamada yön (eski yön asla tekrar kullanılmaz). Önce FAIL, sonra PASS. Mobil toplam 106 PASS.
- API `origin-heading.spec.ts` (5): Valhalla gövdesi, gövde değişmezliği, sözleşme sınırları, hazırlık, yalnız başlangıçtan çıkan isteklerde yön. API 1.172 PASS, 154 SKIPPED (DB); shared 43 PASS.
- Sentetik koordinatlar; gerçek konum verisi yok. Sahada (şehir içi sürüş) doğrulama NOT_RUN.
