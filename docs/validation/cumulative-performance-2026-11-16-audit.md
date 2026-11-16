# Kümülatif ölçüm — son süreçler arası denetim

2026-11-16. [Tam ölçüm raporu](cumulative-performance-2026-11-16.md) ve ham benchmark sonuçları değişmedi. Son çapraz kontrol **PASS**; hızlanma kabulü **NO-GO**, tarihsel karşılaştırma **NOT_COMPARABLE** kalır.

İlk ek denetim bütün metrik sayaçlarını byte olarak da sabit beklediğinden FAIL verdi. İncelemede yalnız response_decoded_bytes ve response_wire_bytes değiştiği görüldü: izin verilen doğal elapsedMilliseconds alanının metin uzunluğu cevap boyutunu değiştiriyor. Bu boyutlar her koşudaki gerçek JSON/body uzunluğuyla ayrıca eşleşti. Fixture/outcome/transition-provider trace/physical-call hash'leri ve kalan tüm semantik sayaçlar 18 grubun her birinde üç süreç boyunca sabit.

İlk [strict denetim FAIL](cumulative-performance-2026-11-16/run1/final-audit.json) silinmedi veya üzerine yazılmadı. [Sınıflandırılmış son denetim](cumulative-performance-2026-11-16/run1/final-audit-v2.json) yalnız bu iki türetilmiş boyut sayacını semantik eşitlikten ayrı kontrol eder; gerçek boyutlar gizlenmedi. Fixture/golden/result/benchmark kaynaklarına veya ham ölçümlere müdahale yoktur. Bu bir algoritma eşitsizliğini normalleştirme değildir; esas normalize outcome ve trace hash'lerinin her biri zaten tek değerdi.

Başlangıçtaki 565 dosya, önceki CR-PERF-001–005 kanıtları ve üretim kodu değişmedi. API/DB 1168, shared 41, mobil 21 PASS; typecheck/build PASS. CR-PERF-006 başlamadı.
