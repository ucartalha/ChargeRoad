# Mobil plan görünümü (planning-mobile-view/1.0.0, 2026-11-19)

Kullanıcı onayı: "izin gereken mobil yanıt küçültme işlemlerini dikkatlice uygulayalım" (public sözleşme değişikliği, CLAUDE.md kural 10).

## Neden

Telefon İstanbul→Kelkit planında 5,8 MB JSON (844 KB gzip) indiriyor ve tamamını zod ile doğruluyordu. Alan bazında: yol segmenti `elevationProfile` 2,74 MB, `speedLimitSource` 0,19 MB, `sourceEdgeIds` 0,10 MB; enerji segmenti `batteryTemperatureAtEndC` 0,29 MB, `breakdown` 0,23 MB, `weatherQueryIds` 0,06 MB. Mobil kod bu alanların hiçbirini okumuyor (`apps/mobile/src` taraması).

## Sözleşme

Eklemeli: `GET /v1/planning-jobs/:id/result?view=mobile`. Varsayılan tam yanıt, `/v1/plans` ve mevcut şemalar değişmedi. Mobil şema tam şemanın alanlarından türetildi (`.omit`/`.extend`) ve aynı tutarlılık fonksiyonlarını kullanır.

## Tam şema yeniden düzenlemesinin eşdeğerliği

zod 4 refine edilmiş nesnelerde `.omit`'e izin vermediği için `roadSegmentSchema`, `roadRouteSchema`, `energySegmentSchema`, `routePlanSchema` refine gövdeleri aynı sırayla isimli fonksiyonlara taşındı. HEAD'deki eski shared derlenip yenisiyle karşılaştırıldı: 3 gerçek plan yanıtı (İstanbul→Kelkit, Ankara, İzmir) × 23 bozma (segment mesafesi, hız, kazanç, profil, kopya id, geometri boşluğu, rota toplamı, segmentasyon, enerji sırası, rezerv, breakdown, enerji işareti, zaman çizgisi, süre, varış, durak sırası, senaryo, fazla anahtar, requestId, metadata, search, değişmemiş) × 5 şema düzeyi = 345 karar/hata listesi: **0 fark**; bozmaların hepsi reddedildi.

## Ölçüm (gerçek plan yanıtları, Node 26, masaüstü)

| Plan | Tam | Mobil | Tam gzip | Mobil gzip | Tam parse+zod | Mobil parse+zod |
|---|---|---|---|---|---|---|
| İstanbul→Kelkit | 5,80 MB | 1,94 MB | 845 KB | 373 KB | 40 ms | 13 ms |
| İstanbul→Ankara | 2,40 MB | 0,81 MB | 353 KB | 160 KB | 12 ms | 4 ms |
| İstanbul→İzmir | 2,49 MB | 0,82 MB | 357 KB | 161 KB | 13 ms | 4 ms |

Telefondaki indirme ve Hermes parse süresi ölçülmedi (NOT_RUN); cihaz kabulü ayrıca yapılmalı.

## Testler

- Shared: yeni sözleşme testi (izdüşüm geçerli, tam şemadan geçmez, korunan alanlar birebir, tutarsız plan reddedilir, girdi değişmez); 43/43 PASS.
- API: `planning-jobs-mobile-view.spec.ts` (varsayılan/bilinmeyen view tam yanıt, view=mobile izdüşüm) önce FAIL sonra PASS. `benchmark-polling-latency.cjs` sahte sunucusu sorgu dizgesini rol tespitinde yok sayar ve view=mobile'ı API gibi uygular; `latency-polling.spec.ts` 13/13 PASS.
- Mobil: typecheck PASS, 85 test PASS (saf TS; cihaz kabulü değildir).
