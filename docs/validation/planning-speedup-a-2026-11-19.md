# Planlama hızlandırma — A aşaması (çıktıyı değiştirmeyen), 2026-11-19

Başlangıç HEAD `184198b` (main). Kullanıcı kararı: önce çıktıyı değiştirmeyen iyileştirmeler (A), cihaz testi, sonra yapısal değişiklik (B). Hedef: İstanbul→Kelkit planı < 5 sn. Ölçümler yerel makine (20 CPU), Valhalla 8004, kendi Open-Meteo sunucumuz, optimizer 1.6.0, enerji 1.5.0; offline ölçümdür, saha kabulü değildir.

## Darboğaz ölçümü (karar girdisi)

Event loop kullanımı (ELU) ve sağlayıcı isteklerinin uçuşta olduğu sürelerin birleşimi, aynı süreçte iki Kelkit planı:

| | Toplam | CPU (ana iş parçacığı) | Valhalla | PostgreSQL | Open-Meteo |
|---|---|---|---|---|---|
| Soğuk | 14,2 sn | 10,7 sn (%75) | 1,5 sn / 161 istek | ~0,7 sn | ~0 (önbellek) |
| Isınmış | 10,0 sn | 8,4 sn (%84) | 0,6 sn / 46 istek | ~0,6 sn | ~0 |

Darboğaz sağlayıcılar değil, kendi CPU'muz: yol/hava verisinin her sürüş değerlendirmesinde yeniden normalize edilmesi, doğrulanması ve özetlenmesi (zod toplam ~2,7 sn). Enerji fiziği toplamın ~%12'si.

## Değişiklikler (hepsi çıktı-eşdeğer)

| Değişiklik | Kanıt |
|---|---|
| İstasyon erişim ölçümü yalnız toplam mesafe/süre kullandığı için `RoadRoutingService.measure` + `measureRoadTrip`: aynı sağlayıcı çağrıları/önbellek, segment/yükseklik/şema inşası yok (plan başına ~125 normalizasyon) | `road-measure.spec.ts`: mesafe birebir, süre farkı < 1e-6 sn (toplama sırası); hız sınırı düzeltmesi ve hatalı girdi davranışı aynı |
| `RoadRoutingService` sonuçlarını `validatedRoadResults` ile işaretleme; oturum ve taban rota bu nesneleri yeniden ayrıştırmaz (her rota zaten `roadRouteSchema`'dan geçti) | işaretsiz her sonuç ayrıştırılır |
| `EvPlanningService`'in doğruladığı plan sonucu `validatedPlanOutcomes` ile işaretlenir; HTTP katmanı aynı sonucu/girdiyi ikinci kez doğrulamaz | diğer tüm sonuçlar HTTP'de doğrulanmaya devam eder |
| `plan-compiler` `checksum`: nesne kimliğine göre bellek (aynı `sha256(canonicalJson)` değeri) | saf fonksiyon |
| Oturum hava önbelleği anahtarı `canonicalJsonSha256` (akış hâlinde, aynı özet) | özet eşitliği denetlendi |
| Hava normalizasyonu: seri zamanları çağrı başına bir kez çözülür (`seriesTimes`, isteğe bağlı parametre) | test serisini değiştiren mevcut test geçiyor |
| Yol birleştirmede kaynak karşılaştırmasına referans eşitliği kısayolu | aynı sonuç |

Denenip geri alınan: oturum önbelleği anahtarını düz `JSON.stringify` yapmak; arama yolunu değiştirdi (A/B'de farklı plan), geri alındı.

## Eşdeğerlik ve süre (aynı anda A/B)

`A_OFF` çalışma anı yamasıyla A değişiklikleri (ve daha önceki seri önbelleği/güvenilir girdi) kapatılarak aynı veri ve aynı dakikada çalıştırıldı. Plan özeti: km, toplam süre, varış SOC'si, durak istasyonları/varış/hedef/şarj süreleri, enerji kesimi SOC özeti, uyarı kodları.

| Rota (sabit kalkış 2026-11-19 07:00Z) | A kapalı | A açık | Plan |
|---|---|---|---|
| İstanbul→Kelkit, süreçte ilk | 18,7 sn | 10,1 sn | birebir aynı |
| İstanbul→Ankara | 11,3 sn | 7,0 sn | birebir aynı |
| İstanbul→Kelkit, ikinci | 21,7 sn | 8,0 sn | birebir aynı |

Oturum başındaki ölçümde (aynı rota, ilk durum) Kelkit 21,3 sn idi.

## Durum

5 sn hedefi **karşılanmadı**. Kalan CPU kesim × değerlendirme sayısıyla ölçekleniyor (uzun bacakların yol normalizasyonu ~1,3 sn, hava normalizasyonu/örnekleme ~1,5 sn, plan derleme ~0,9 sn, enerji ~0,8 sn); bu kalemler B (daha uzun kesimler, istasyon sorgusunun kesimlerden ayrılması, km tabanlı arama bütçesi) ile ele alınacak.

Testler: `pnpm --filter @chargeroad/api typecheck` PASS; `test` 83 suite / 1145 test PASS, 14 suite / 154 test SKIPPED (DB; `TEST_DATABASE_URL` yok → NOT_RUN).
