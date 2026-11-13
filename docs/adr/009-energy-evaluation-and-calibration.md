# ADR-009 — Kaynaklı enerji kalibrasyonu ve deterministik değerlendirme

- Tarih: 2026-11-11
- Durum: ACCEPTED — mevcut gereksinimlere dayanan teknik uygulama; pilot saha kabulü açık.
- İlgili: DEC-008, CR-001, CR-006, CR-010–013, CR-019.

## Karar

1. Enerji çekirdeği dış servis, DB ve LLM'den bağımsızdır. Aynı normalize snapshot, değerlendirme zamanı ve model sürümü aynı sonucu verir.
2. Kaynaklı model `VehicleEnergyProfile.energyModel` içinde varyanta bağlı, sürümlü ve kalite/lisans izli tutulur; mevcut immutable JSON profil yayını kullanılır. Yeni tablolar veya Redis gerekmez. Mühendislik profili açık izinli kalite politikasından geçer.
3. Fizik ve referans fark düzeltmesi ayrı yollardır. Referans ile tam fizik toplamı toplanmaz; dahil yardımcı yükler ve düz yol tabanı çıkarılıp gerçek koşul farkları uygulanır. Bilinmeyen ayrıştırma `breakdown=null` kalır.
4. Ortalama hız gerçek hız dağılımı değildir. Opsiyonel zaman/hız izi distance/time bütünlüğüyle kinetik enerjiye girer; iz yoksa yalnız modelin izin verdiği belgeli steady-speed proxy kullanılır.
5. Kapasite/SOH, iç tepe/inişler ve ara rezerv korunur. Rejenerasyon mekanik enerji, güç, sıcaklık, SOC taper ve boşlukla sınırlıdır. Bilinmeyen sıcaklık ortamdan üretilmez; negatif batarya başarılı rotaya kırpılmaz.
6. Model/profil/hava eksikliği yetersiz veri; mevcut rota için ek şarj ihtiyacı `charge_required`; bütçe sonu `computation_limit` olur. Bunlar küresel rota yok kanıtı değildir. Şarj süreleri ve durak solver'ı kendi görevlerindedir.

## Sonuç ve kanıt

[Teknik teslim](../ENERGY_ENGINE.md), [analitik/DB/pilot raporu](../validation/task11-energy-validation.json), [yerel p95/p99](../validation/task11-energy-benchmark.json). Kaynaklı katsayı veya bağımsız saha doğruluğu yerine sentetik testler konulmaz. Kullanıcının İstanbul–Ankara kaydı kaynak bildirimi olarak korunur; koşullu 44,51 kWh hesabı kapasite/SOH fact'i veya fitted model yapılmaz.

CR-011 teknik çekirdeği uygulandı; görev bütünü uygun pilot profili ve bağımsız saha hata kabulü beklediği için IN_PROGRESS. Doğrulama verisi gelmesi, mevcut modelin aynı kayıt üzerinde bağımsız doğrulandığı anlamına gelmez. Kapanış ölçütü kullanıcı kararı olmadan gevşetilmez.
