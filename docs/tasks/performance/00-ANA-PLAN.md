# ChargeRoad — Aşamalı Rota / Navigasyon Performans İyileştirme Planı

**Referans:** `ucartalha/ChargeRoad`, GitHub `main` `c24cab249dc3cbebb29f11104fee95c04ca8d7fd` (13.11.2026).
**Kullanım:** Her görev kendi MD dosyasında. Sıradaki göreve ancak öncekinin test/GO sonucundan sonra geçin. Kodun veya kullanıcının lokal ağacının başka versiyonları olabilir; Codex mutlaka yeniden audit yapmalıdır.

## Strateji

Mevcut modüler monolit, NestJS provider adapter'ları, saf EnergyConsumptionEngine/ChargingCurveEngine, ChargeStopOptimizer, PostgreSQL/PostGIS planlama kuyruğu ve Expo navigasyonu korunur. Bu set yeni sistem yazmayı değil, ölçerek küçük ve geri döndürülebilir optimizasyonları amaçlar.

## Görev sırası ve bağımlılıklar

| Sıra | Görev | Faz | Bağımlılık | Risk |
|---:|---|---|---|---|
| 01 | [CR-PERF-001 — Performans gözlemlenebilirliği ve tekrarlanabilir baseline](CR-PERF-001-performans-gozlemlenebilirligi-ve-tekrarlanabilir-baseline.md) | A · Ölçüm | Yok | Düşük |
| 02 | [CR-PERF-002 — Optimizer frontier için stabil priority queue](CR-PERF-002-optimizer-frontier-icin-stabil-priority-queue.md) | A · Güvenli hızlandırma | 01 | Düşük–orta |
| 03 | [CR-PERF-003 — Şarj istasyonu adaylarını güvenli ve ucuz ön değerlendirme](CR-PERF-003-sarj-istasyonu-adaylarini-guvenli-ve-ucuz-on-degerlendirme.md) | A · Güvenli hızlandırma | 01, 02 | Orta |
| 04 | [CR-PERF-004 — Optimizer state dominance için konservatif budama](CR-PERF-004-optimizer-state-dominance-icin-konservatif-budama.md) | A · Güvenli hızlandırma | 01, 02, 03 | Orta–yüksek |
| 05 | [CR-PERF-005 — PlanningSession içi hesaplama tekrarını azaltma](CR-PERF-005-planningsession-ici-hesaplama-tekrarini-azaltma.md) | A · Güvenli hızlandırma | 01, 03 | Orta |
| 06 | [CR-PERF-006 — Mobil GPS/rota eşleme ve ekran render yükü](CR-PERF-006-mobil-gps-rota-esleme-ve-ekran-render-yuku.md) | B · Mobil performansı | 01 | Orta |
| 07 | [CR-PERF-007 — Geri uyumlu kompakt mobil plan yanıtı](CR-PERF-007-geri-uyumlu-kompakt-mobil-plan-yaniti.md) | B · Veri transferi | 01, 06 | Orta |
| 08 | [CR-PERF-008 — Navigasyon olayı sınıflandırıcısı ve replan policy](CR-PERF-008-navigasyon-olayi-siniflandiricisi-ve-replan-policy.md) | C · Dinamik karar | 06 | Orta |
| 09 | [CR-PERF-009 — Backend charging-only continuation çekirdeği](CR-PERF-009-backend-charging-only-continuation-cekirdegi.md) | C · Kısmi yeniden planlama | 03, 04, 05, 08 | Yüksek |
| 10 | [CR-PERF-010 — Kısmi rota onarımı ve güvenli full fallback](CR-PERF-010-kismi-rota-onarimi-ve-guvenli-full-fallback.md) | C · Kısmi yeniden planlama | 08, 09 | Yüksek |
| 11 | [CR-PERF-011 — Geriye uyumlu asenkron replan API ve plan revision](CR-PERF-011-geriye-uyumlu-asenkron-replan-api-ve-plan-revision.md) | C · Sunucu entegrasyonu | 09, 10 | Yüksek |
| 12 | [CR-PERF-012 — Mobilde kontrollü dinamik replan entegrasyonu](CR-PERF-012-mobilde-kontrollu-dinamik-replan-entegrasyonu.md) | C · Kullanıcı deneyimi | 07, 08, 11 | Orta–yüksek |
| 13 | [CR-PERF-013 — Planning worker izolasyonu ve kapasite kontrolü](CR-PERF-013-planning-worker-izolasyonu-ve-kapasite-kontrolu.md) | D · Ölçek/işletim | 01, 11 | Orta–yüksek |
| 14 | [CR-PERF-014 — Uçtan uca regresyon, yük kanıtı ve rollout kapıları](CR-PERF-014-uctan-uca-regresyon,-yuk-kaniti-ve-rollout-kapilari.md) | D · Doğrulama | 01–13 (geçerli olanlar) | Orta |

## Hangi sırada çalıştırılmalı?

**Sıkı sıra önerisi:** 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14. Bir iş fail/NO-GO olursa kör devam etmeyin. 04 ileri dominance kanıtlanmıyorsa yalnız konservatif dedup ile kapatılabilir; güvenli değilse flag kapalı kalmalı.

**Kritik mimari kapılar:** (1) Mevcut test ve belirsizlik anlamları aynı; (2) yeni codec/route API yalnız opt-in; (3) staging/cihaz kabulü production sertifikası değildir; (4) gerçek sağlayıcı kotası ve kaynak lisansı değişmez; (5) eski işler yeni planı overwrite etmez; (6) rollback tek env flag veya küçük revert ile mümkün olmalı.

## Varsayılan test komutları

```powershell
git status --short
git rev-parse HEAD
pnpm --filter @chargeroad/shared typecheck
pnpm --filter @chargeroad/shared test
pnpm --filter @chargeroad/api typecheck
pnpm --filter @chargeroad/api build
pnpm --filter @chargeroad/api test
# İzole PostgreSQL ve TEST_DATABASE_URL gerçekten varsa:
pnpm --filter @chargeroad/api test:db
pnpm --filter @chargeroad/mobile typecheck
pnpm --filter @chargeroad/mobile test
pnpm --filter @chargeroad/mobile build
```

**Not:** `api test` DB entegrasyonlarını atlıyorsa PASS yalnız çalışan testleri kapsar. `api test:db` izole gerçek DB olmadan PASS sayılmaz. Bu komutların hepsini her işte çalıştırma gerekliliği dosya kapsamına göre optimize edilebilir; ancak final kanıt tablosunda açık raporlanmalıdır.

## Hedef metrikler (garanti değildir)

| Metrik | Başlangıç / hedef yaklaşımı |
|---|---|
| Gerçek uzun ilk plan | 12 Kasım raporu 77,6 sn cold / 10,3 sn warm (iki örnek, SLA değil); iyileştirme gerçek ölçümle doğrulanır |
| GPS konum değerlendirmesi | Yeni indeksin eski algoritmayla doğru sonuç üretmesi; CPU ve render p95 düşüşü |
| Yeniden planlama | charging-only/repair/full yolları ayrı p95 ölçülür, zor senaryoda güvenli fallback |
| Provider maliyeti | Plan başına gerçek upstream acquisition, retry/backoff, cache hit |
| Veri transferi | Ağ gövdesi, açılmış JSON, parse ms, geometri/manoeuvre doğruluğu |
| Güvenlik | Rezerv ihlalli öneri, stale plan overwrite, unknown→available/verified yok |

## Codex kullanım yöntemi

1. Repo kökünde Codex oturumunu başlatın. Önce `CR-PERF-001` dosyasının **Codex'e doğrudan yapıştırılacak prompt** bölümünü iletin.
2. Codex'ten başlangıç audit, değişen dosyalar, test komutları/sonuçları, performans ve açıkları tek görevde sunmasını bekleyin.
3. Çalışmayı gözden geçirip tercihen tek görev/tek commit olarak kayıt edin. Untracked/başka görev değişikliklerini temizlemeyin.
4. GO ise bir sonraki dosyanın promptunu gönderin; NO-GO veya eksik veri varsa açık kanıtla o adımda kalın.

## Kaynak sınırları

Bu dosyalar plan ve Codex promptlarıdır; ChargeRoad reposuna uygulanmış kod değişiklikleri değildir. Kaynak kod, çalışma ağacı ve test çıktıları Codex tarafından çalışılan bilgisayarda yeniden incelenmelidir. GitHub `main` üzerinde README bazı eski ifadeler içeriyor; en yeni kod ve tarihli validation kanıtı esas alınmalı.

## Her görev sonrası doldurulacak kontrol fişi

```text
Görev:
Başlangıç HEAD / dirty status:
Değişen dosyalar:
Yeni dependency/migration/endpoint:
Davranış eşdeğerliği:
Tests: API | DB | Shared | Mobile | typecheck | build: PASS/FAIL/SKIPPED
Baseline ve after (aynı fixture / commit / makine):
Provider cache / quota etkisi:
Sürüş güvenliği ve veri kalitesi doğrulaması:
Kalan riskler / rollback:
GO / NO-GO:
```
