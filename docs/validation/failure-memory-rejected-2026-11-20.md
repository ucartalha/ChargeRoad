# Sürüş başarısızlık hafızası: REDDEDİLDİ (2026-11-20)

Durum: **Uygulanmadı.** Optimizer `chargeroad-optimizer/1.9.0` olarak kaldı. Önceki menzil denemeleri: [reach-bounds-rejected-2026-11-20.md](reach-bounds-rejected-2026-11-20.md).

## Fikir
Bir sürüş rezervin altına düştüğünde, o düğümden o SOC ile yolda kaç km gidilebildiği bellidir. Aynı düğümden aynı ya da daha düşük SOC ile yolu (ulaşılan km + 25 km)'den uzun hedeflere sürmeye gerek yoktur.

## Ölçümler
Yöntem: eşleştirilmiş çalıştırma. Her durum önce 1.9.0 davranışıyla, hemen ardından yeni sürümle, aynı kalkışla ("şimdi + 10 dk") koşuldu. Yerel Valhalla ve yerel Open-Meteo kullanıldı.

1. **Salt okuma tanısı (atlama yok, yalnız sayım):**
   - **Koridor km'siyle karşılaştırma:** atlanacak 205 sürüşün 19'u aslında başarılıydı. Aynı düğümden farklı hedeflere giden yollar farklı olduğu için koridor km'si yanıltıcı.
   - **Aynı düğümden yol km'si, 10 km pay:** 6 rotada 2 hatalı atlama (başarısızlık noktasının 11 ve 13 km ötesi).
   - **Yol km'si, 25 km pay:** 8 rotada hatalı atlama yok. Hava projeksiyonlarının %17–39'u atlanabilir görünüyordu.
2. **Her yerde atlama (seed + geniş arama):**
   - 20 durumda 8 aynı, 6 daha iyi, 6 daha kötü (±30 dk).
   - Erzurum %60/r20/v50 **planlanamadı**.
   - Neden: seed, başarısız sürüşün enerjisinden şarj hedefi hesaplıyor ("ihtiyaç kadar şarj", 1.7.0). Başarısız sürüş bilgi taşıyor, boşa değil.
3. **Yalnız geniş aramada atlama** (orada başarısız sürüş hiçbir şey üretmiyor):
   - Planlar 1.9.0 ile aynı: 12 durum birebir, 8 durumda ≤0,1 dk / ≤0,1 SOC fark (iki kolun saniyeler arayla "şimdi"den kalkması).
   - Toplam hava projeksiyonu yalnız **%4** azaldı (619 bin → 592 bin). Rotaya göre −33 % ile +71 % arası değişti.
   - Neden: geniş arama projeksiyon sınırına kadar çalışıyor. Atlanan sürüşlerin kazandırdığı bütçe daha fazla durum incelemeye gidiyor ve aynı plan bulunuyor.
   - Süre: 100 → 85 s görünüyor, ama 1.9.0 kolu her durumda önce koştuğu için ikinci kol sıcak cache'ten yararlanıyor. Hızlanma iddia edilmez.

## Karar
Plan kalitesi değişmiyor, ölçülebilir tasarruf yok; ek karmaşıklığa değmez (kullanıcı kararı, 2026-11-20).

## Çıkarılan dersler
- Kayıp bütçe "varılamayan sürüş" olarak görünse de geniş arama bütçeyi sınırına kadar kullanıyor. Sürüş atlamak tasarruf sağlamıyor, aramayı genişletiyor.
- Tasarruf ancak arama işinin kendisi azalırsa gelir. Örnek: tek sürüşten rota üzerindeki istasyonlara varış SOC'unu okumak (açık fikir "Öneri 2", ölçülmedi).
