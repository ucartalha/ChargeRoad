# Geliştirme teşhis logları (yalnız geliştirme)

Durum: **GEÇİCİ.** 2026-11-19'da kullanıcı isteğiyle eklendi. Uygulama canlıya (Google Play) hazır olmadan önce bu belgedeki "Canlıya çıkış kontrol listesi" uygulanır.

## Neden
Planlama darboğazlarını (bütçe nereye gitti, hangi istasyon neden elendi, hangi kural planı engelledi) geçici scratch yamaları olmadan, tek bir log satırından görmek; mobilde istek ve navigasyon zamanlamasını izlemek.

## API: `planning_debug`

- **Açma:** `PLANNING_DEBUG_TRACE=true`. `NODE_ENV=production` iken bayrak açık olsa bile **hiç çalışmaz** (`apps/api/src/observability/planning-debug.ts`, `planningDebugEnabled`).
- **Çıktı:** Her plan için tek satır, `PlanningDebug` logger'ı, `{"event":"planning_debug","devOnly":true,...}`.
- **Davranış:** Yalnız okur. İz açık/kapalı plan çıktısı birebir aynı (5 referans plan özet hash'i eşit; `planning-debug.spec.ts`).

| Alan | İçerik |
|---|---|
| `request` | requestId, başlangıç SOC, rezerv, varış hedefi, amaç |
| `corridors[]` | Denenen her koridor rotası: km, segment sayısı, menzil tahmini, durak sınırı, aday istasyonlar (`km/kW/+sapma`), sonuç, durma nedeni, durum/geçiş sayısı, hava projeksiyonu kullanılan/sınır, yol sorgusu |
| `phases` | Aşama başına hava projeksiyonu: `seed`, `seed_after_first_plan`, `improve`, `final_trim`, `broad` (gevşetilmiş arama için `relaxed_*`) |
| `drives` | Sürüş sayısı, sonuç türüne göre adet ve projeksiyon (`charge_required_partial` = hedefe varılamayan sürüş), en pahalı 5 sürüş (`fromKm→toKm`, başlangıç SOC) |
| `stopRuleBlocks` | "%50 üstünde şarj yok" kuralının engellediği şarjlar (km, varış SOC; ilk 5 örnek) |
| `charges` | Başarılı/başarısız şarj denemesi |
| `incumbents` | Bulunan planlar sırasıyla (ms, dakika, durak, varış SOC, aşama) |
| `contractFailures` | Son doğrulamada reddedilen planların şema kuralı ve mesajı |
| `finalPlan` | Dönen plan (yalnız `planned`): optimizer/enerji modeli sürümü, rota km, durak sayısı, varış SOC; dakika (sürüş, şarj, bağlantı, ön ısıtma, bekleme, bilinen toplam, durak cezalı sıralama süresi); planı bulan aşama (`sourcePhase`); her durak için km, önceki durağa/başlangıca uzaklık, varış/hedef SOC, şarj dakikası, ortalama güç kW, sapma km, bekleme; son bacak km |

Koordinat, adres, polyline, kullanıcı/oturum kimliği **yoktur**; konumlar koridor rotası üzerindeki km'dir. **SOC, rezerv ve varış hedefi vardır**: CLAUDE.md'nin "SOC loglara girmez" kuralına geçici, bayrakla sınırlı istisnadır.

Örnek okuma (İstanbul→Erzurum, %60 başlangıç, %20 rezerv): `broad` 44.588 projeksiyon, bunun 42.024'ü `charge_required_partial` uzak sürüşler; `stopRuleBlocks` 17. km %53,2; `relaxed_seed` 1 projeksiyon; `incumbents` boş → bütçe ulaşılamaz hedeflere gidiyor ve %50 kuralı ilk durağı engelliyor.

## Mobil: `[dev] …` (`console.info`)

- **Açma:** Yalnız React Native `__DEV__` true iken (Expo geliştirme sunucusu). Release derlemede yazılmaz (`apps/mobile/src/dev/dev-log.ts`).
- Yük yalnız ilkel değerdir (sayı/metin/boolean); iç içe nesne (koordinat) atılır, sayılar 0,1'e yuvarlanır (`dev-log.test.cjs`).

| Olay | Yer | Alanlar |
|---|---|---|
| `plan_job_created` | `src/api/planning.ts` | requestId, ms, durum |
| `plan_job_status` | `src/api/planning.ts` | requestId, yeni durum, atMs, okuma sayısı |
| `plan_job_failed` | `src/api/planning.ts` | requestId, hata kodu, atMs |
| `plan_result_timing` | `src/api/planning.ts` | requestId, sonuç, toplam / sunucu bekleme / sonuç indirme / ayrıştırma ms, durum okuma, durak sayısı, neden kodu |
| `nav_deviation_start` | `src/features/navigation/NavigationPanel.tsx` | ters yön, rotadan çıkma, rotaya uzaklık m, GPS doğruluğu m, hız km/s |
| `nav_replan_trigger` | aynı | ters yön, okuma sayısı, sapma süresi, bekleme süresi |
| `nav_replan_start` / `nav_replan_done` | aynı | gözlenen/tahmini SOC, kalan km; süre, sonuç, durak, neden |
| `soc_correction` | aynı (sağ üst şarj kutusu veya panel düzeltmesi) | araç varyant kimliği + etiketi, enerji modeli, optimizer sürümü, son kullanıcı SOC'u (baz), tahmin, girilen değer, hata, model/gerçek düşüş, oran, km, otoyol payı, tırmanış m, dakika, ort. hız, kalite |
| `soc_feedback_summary` | aynı | aynı araç + enerji modeli için cihaz günlüğü özeti: kayıt, kullanılabilir, ort. hata, medyan oran, km |

### SOC düzeltme geri bildirimi (2026-11-19)

Navigasyonda sağ üstteki kutu **tahmini** SOC'u gösterir; dokununca − / + (uzun bas ±5) ile göstergedeki değer girilir. Kaydet: yolculuk bu değerden yeniden bazlanır, rota yeniden planlanır ve tahmin hatası kaydedilir (`apps/mobile/src/features/navigation/soc-feedback.ts`).

- Karşılaştırma **son kullanıcı girişinden** (başlangıç / düzeltme / şarj sonrası) bu yana yapılır; aradaki tahmini yeniden planlamalar hatayı gizlemez. Konum yok; yalnız sürülen metre.
- Kalite: `ok` dışındakiler (`no_baseline`, `after_charging`, `soc_rose` = arada şarj/hata, `too_short` < 2 km, `small_drop` < 2 puan) oran hesabına girmez.
- Cihaz günlüğü: AsyncStorage `chargeroad:soc-feedback:v1`, en yeni 500 kayıt. **Yüklenmez, motor otomatik öğrenmez**; enerji motoru değişikliği sürüm artışı ve onay ister.
- Rapor: Metro çıktısını dosyaya kaydedip `node apps/mobile/scripts/soc-feedback-report.cjs <log.txt>` → araç + enerji modeli tablosu ve otoyol/şehir ayrımı.

Bu belgeden önce de var olan geliştirme logları: `planning_started`, `planning_result`, `planning_failed` (`PlanningForm.tsx`), `planning_rejected` (`api/planning.ts`).

## Canlıya çıkış kontrol listesi

1. API: `PLANNING_DEBUG_TRACE` üretim ortam değişkenlerinde **tanımlı olmamalı**; `NODE_ENV=production` olmalı. Tercihen `planning-debug.ts` ve çağrıları (`ev-planning.service.ts`, `planning-session.ts`, `plan-compiler.ts`, `charge-stop-optimizer.ts` içindeki `debug?.` satırları) kaldırılır.
2. Mobil: `src/dev/dev-log.ts` ve yukarıdaki tüm `devLog(...)` çağrıları kaldırılır veya her biri gizlilik açısından yeniden incelenir. SOC geri bildirim günlüğü (`chargeroad:soc-feedback:v1`) üretimde ya kaldırılır ya da açık rıza (`socFeedbackSchema` consent alanları) ve gizlilik beyanıyla sunucuya taşınır; bu ayrı bir onay konusudur. Mevcut `planning_*` geliştirme logları da gözden geçirilir.
3. Google Play: Kullanıcı verisi politikası ve konum izinleri beyanı açısından cihaz loglarında (logcat) konum, SOC, kimlik bulunmadığı doğrulanır; release APK/AAB'de `console.*` çağrıları için bir derleme kuralı (ör. babel `transform-remove-console`) değerlendirilir. Yeni bağımlılık onay gerektirir.
4. Sunucu log saklama: Geliştirme logları içeren `artifacts/runtime-api-*.log` dosyaları üretim ortamına taşınmaz; gerekirse silinir.
5. CLAUDE.md gizlilik kuralı (SOC dahil loglara girmez) üretimde tamamen geri gelir; bu belge "KALDIRILDI" olarak güncellenir.
