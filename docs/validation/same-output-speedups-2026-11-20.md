# Aynı çıktı, daha az iş: planlama hızlandırmaları (2026-11-20)

Durum: **Uygulandı.** Optimizer `chargeroad-optimizer/1.9.0` kaldı. Plan çıktısı değişmedi, bu yüzden sürüm artışı yok (CLAUDE.md kural 4: eşdeğerlik kanıtı aşağıda).

## Yöntem
- 5 uzun rota: İstanbul(Kadıköy)→Erzurum, İstanbul→Kelkit, İstanbul(batı)→Kelkit, Ankara→Van, Adana→İstanbul.
- Ortak koşullar: %80 başlangıç, %10 rezerv, %20 varış, sabit kalkış `2026-11-21T09:00+03:00`.
- Tek süreç (`PlanningHttpService.plan`, uygulama içi). Önce bir ısınma turu (atılır), sonra 3 ölçüm turu; her rota için medyan alınır.
- Altyapı: yerel Valhalla ve yerel Open-Meteo. Bu ölçüm sıcak cache içindir; gerçek sağlayıcı, soğuk cache veya saha kabulü değildir.
- Eşdeğerlik için planın parmak izi alındı (durak istasyonu, konumu, varış/hedef SOC, şarj süresi, toplam süre, varış SOC'u, segment SOC/enerji). Parmak izi her adımda 5 rotanın hepsinde aynı kaldı. Oturum hava cache isabeti ve hava projeksiyonu sayısı son iki adımda ayrıca izlendi; onlar da aynı kaldı.

## Sonuç (5 rota toplamı, medyan)
| Adım | Toplam | Fark |
|---|---|---|
| 1.9.0 | 23.420 ms | — |
| + ara planlar sonda bir kez derlenir | 19.472 ms | −3.948 ms |
| + şarj motoru arama çağrılarında girdi hash'i hesaplamaz | 17.743 ms | −1.729 ms |
| + şarj motoru güvenilir arama isteğini yeniden doğrulamaz | 16.985 ms | −758 ms |
| + en yakın hava örnek noktası: her mesafe bir kez | **16.529 ms** | −456 ms |

Toplam **−%29**. Rotalar 3,6–5,6 sn'den 2,4–3,9 sn'ye indi.

Rota bazında son durum: Erzurum 3.314, Kelkit 3.390, Kelkit batı 3.856, Ankara→Van 3.543, Adana→İstanbul 2.426 ms.

## Değişiklikler
1. **Ertelenmiş derleme** (`charge-stop-optimizer.ts`, `accept`).
   - Önce: her kabul edilen ara plan tam olarak derleniyor ve sözleşme doğrulamasından geçiyordu (plan değerlendirme şeması ~130 ms). İstek başına ~5,6 kez.
   - Şimdi: kabul anındaki arama meta verisi ve uyarılar saklanıyor; derleme sonda bir kez yapılıyor. Sözleşmeyi geçemeyen plan, önceki kabul edilen plana düşüyor (eskisi gibi).
   - Fark: önceden başarısız sözleşme arama sırasında fark edilirdi. Ölçülen rotalarda böyle bir başarısızlık yok.
2. **Şarj motoru arama seçenekleri** (`ChargingEvaluationOptions`).
   - `inputChecksum:false`: arama, şarj sonucundaki girdi hash'ini hiç okumuyordu. Buna rağmen her çağrıda (istek başına 600–900 çağrı) tüm istek araç profiliyle birlikte hash'leniyordu.
   - `trustedRequest:true`: istek, kaynağında doğrulanmış parçalardan kuruluyor; şemada varsayılan değer ya da dönüşüm yok. `search-checksum.spec.ts` iki seçeneğin sonucu değiştirmediğini doğruluyor.
   - Enerji motorundaki `SearchEnergyEvaluationResult` kalıbının aynısı.
3. **En yakın örnek noktası** (`weather-sampler.ts`, `planning-session.ts`).
   - Önce: `reduce` her karşılaştırmada iki mesafe hesaplıyordu. Şimdi her mesafe bir kez hesaplanıyor.
   - Aynı katı `<` karşılaştırması kullanılıyor, eşitlikte ilk nokta kazanıyor; seçim aynı.

## Denenip alınmayanlar
- **Oturum hava cache anahtarı için yerleşik JSON + SHA-256:** ölçülebilir kazanç yok (16.985 → 16.904 ms, gürültü). Profildeki ~0,12 sn büyük ölçüde profilleyici ek yüküydü.
- **İstasyon erişim ölçümü eşzamanlılığı 4 → 12:** kazanç yok (16.774 ms). Sıcak cache'te bu iş I/O beklemiyor.

## Kalan zaman (CPU profili, istek başına)
- **Zod ~0,58 sn:** hava normalizasyonu ~0,15, enerji sonucu ~0,11, yol normalizasyonu ve Valhalla adaptörü ~0,18, son plan ~0,1. Bunlar sağlayıcı sınırı ve motor öz denetimi; güvenlik nedeniyle dokunulmadı.
- **Diğerleri:** çöp toplama ~0,34 sn, enerji motoru ~0,17 sn.
- **Hazırlık:** ~0,8 sn (ana rota, koridor, istasyon erişimi).
- **Yapısal:** istasyonlar arası bacakların önceden hesaplanması bundan sonraki büyük adımdır; yeni migration gerektirir.

Testler: API 1.199 geçti, 154 DB testi atlandı (NOT_RUN). Yeni shadow checkpoint: `stop-penalty-elimination-shadow-source-v2-2026-11-20.json` (1.9.0, kaynak değişti, çıktı aynı).
