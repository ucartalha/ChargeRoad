# İstasyon provider mimarisi ve OCM teslimi

Tarih: 2026-11-11. Provider/OCM katalog alt teslimi DONE. CR-008 bütünü IN_PROGRESS: gerçek canlı müsaitlik feed'i henüz yok.

## Uygulanan yapı

`StationCatalogueSource` → `StationSourceRegistry` → `StationSourceService` → sürümlü staging/yayın → PostgreSQL/PostGIS → `StationDataProvider` / HTTP API.

- EPDK ve OCM aynı katalog adapter sözleşmesine bağlı. Adapter kaynak formatını, ülke/kabiliyetlerini ve normalizasyonunu tanımlar. Registry ve composition root üzerinden üçüncü adapter eklemek, import/planlayıcı/mobil okuma kodunu değiştirmez.
- `planMissingFields` eksik alanlar için uygun sağlayıcı sırasını üretir. Yetkili ülke/kabiliyet ve enabled filtresinden sonra alan tercihi, kaynak önceliği ve maliyet sırası uygulanır. Bu saf seçim fonksiyonudur; otomatik ücretli çağrı veya her kullanıcı için dış HTTP başlatmaz. Aynı öncelikte düşük `costRank` öne gelir; bu operatörün göreli ayarıdır, sağlayıcı fiyatı iddiası değildir.
- [Politika dosyası](../data/station-sources/policy.json) sağlayıcı açma/kapama, genel sıra, göreli maliyet ve alan bazında önceliği yönetir. `STATION_SOURCE_POLICY_FILE` ile başka incelenmiş JSON seçilebilir. Politika değişince `stations:rebuild`, ağ çağrısı olmadan mevcut kaynak kanıtlarını yeniden birleştirir. Aktif politika/snapshot kimlikleri DB'de kaydedilir; deployment'a `data/station-sources` da dahil edilir.
- Aynı kanonik lokasyona açık crosswalk ile bağlanan kayıtlar alan bazında birleşir. Boş alan sonraki uygun kaynaktan tamamlanır; çelişkiler uyarı olarak korunur. Connector/EVSE ekipmanı sağlayıcılar arasında toplanmaz; ekipman paketi ve lisansı seçilen kaynaktan taşınır.
- Kaynak indirme/parse işlemleri DB transaction'ı dışında. Çok worker için PostgreSQL lease/token/generation; ortak istek kotası; timeout/boyut sınırı; 429 için paylaşılan backoff ve üç ardışık iş hatasında kısa devre kesici var. Süresi geçmiş worker yayın yapamaz veya yeni owner'ın lease'ini silemez. Otomatik HTTP retry yok; dayanıklı scheduler/retry kuyruğu CR-021'de.
- `StationAvailabilityProvider` canlı EVSE gözlemleri için ayrı porttur; OCM/EPDK bunu uyguluyor diye gösterilmedi. Google/HERE/Eco-Movement/Hubject adapter'ları eklenmedi. Ücretli veya kaynağı belirsiz fallback yok. Redis ve LLM eklenmedi.

## OCM kabul kapsamı

Türkiye ve yalnız DataProviderID=1 (OCM Contributors); gerçek kayıt lisans metni/flag'i ayrıca doğrulanır. Kaynak genel meta lisansı yerine kayıt bazında CC BY 4.0, atıf ve kayıt URL'si tutulur. `opendata=true` tek başına ticari kullanım onayı değildir; başka sağlayıcılar yeni lisans incelemesiyle açılır.

ID sıralı cursor ile 500'lük sayfalar, en fazla 20 sayfa; ortak istek aralığı 1,1 saniye. Bunlar başlangıç istemci bütçesidir, OCM kota/SLA taahhüdü değildir. Sayfa sınırına ulaşma, ID'nin ilerlememesi, timeout, yanlış lisans veya incelenmemiş karantina yayını durdurur. Ülkenin fiziksel istasyon tamlığı doğrulanmış sayılmaz.

OCM `Connections` ekipman özetleri `granularity=equipment_summary` ve nullable quantity ile korunur; fiziksel EVSE üretilmez. Sıfır quantity bilinmiyordur. Referans sözlüğündeki Unknown=0 kabul edilir. Operational/IsLive/otomatik 10–20 katalog kodları canlı müsaitliğe dönüştürülmez. Genel negatif lifecycle yalnız kaynak kayıt zamanı son 365 gün içindeyse kullanılır; aksi halde unknown ve eskilik uyarısı taşınır. Bu 365 gün genel durum için sürümlenecek başlangıç mühendislik eşiğidir; canlı TTL veya durum gözlem zamanı değildir. Yorum/medya normalize ürün kaydına alınmaz; UsageCost sayısal tarife olarak yorumlanmaz.

## Gerçek DB yayını

| Kaynak | Yayındaki lokasyon | Halka açık | Connector beyanı/özeti |
|---|---:|---:|---:|
| EPDK | 17.165 | 13.238 | 50.259 |
| OCM Contributors | 1.737 | 1.714 | 2.168 |

OCM alımı 1.741 kayıt içerdi. Dört kaydın koordinatı 0,0: 267423, 274244, 274246, 298083. İlk yayın kalite kapısında durdu; kayıtlar incelenerek `ZERO_COORDINATE` nedeni ve sürümlü dışlama listesiyle karantinada bırakıldı. Yalnız bu ID+neden eşleşmeleri için geçerli kayıtlar yayınlanabilir. Diğer karantina ve lisans hataları yayını durdurur. Karantina sayısı kapsam metadatasında kalır; tam kalite/kapsama iddiası yapılamaz. İncelenen kayıt sonradan düzelirse normalizer onu tekrar kabul edebilir; ID kalıcı olarak kara listeye alınmaz.

Toplam 18.902 kanonik kaynak lokasyonu, fiziksel dünyada tekilleştirilmiş 18.902 istasyon garantisi değildir. Coğrafi benzerlikler otomatik birleştirilmedi; kaynaklar arasında henüz onaylanmış gerçek crosswalk yok. EPDK'nin 17.165 alias/UUID kontrol özeti import öncesi ve sonrası aynı. Tam ülke OCM alımı başlangıç manuel import'udur; haftalık/periyodik job kurulmadı.

[DB/HTTP kanıtı](validation/task8-provider-delivery.json): yeni OCM kaydı gerçek API'den HTTP 200 ve CC BY 4.0 atfıyla okundu; geçici test API'si kapatıldı. 008 migration uygulandı; uygulanmış önceki migration'lar değiştirilmedi. Mevcut mobil katalog/istasyon okuması dış sağlayıcıya istek yapmaz.

## Doğrulama

182 API testi (gerçek PostgreSQL/PostGIS/HTTP dahil), 31 ortak sözleşme testi geçti. API/mobil TypeScript kontrolü ve API production build başarılı. Üçüncü sahte adapter'ın core değiştirmeden eklenmesi; maliyet/alan sıralaması; iki worker; stale worker; 429; kapatma/açma sonrası UUID/kapsam; lisans; quantity; sayfa limiti/tekrar; incelenmiş ve incelenmemiş karantina test edildi.

[Yerel p95/p99 ölçümü](validation/task8-stations-benchmark.json): dört eşzamanlı okuyucu, dört geometride 1.000'er örnek. Kısa çizgi 14,92/17,83 ms; iki yön 18,60/22,89 ms; uzun çizgi 36,87/43,58 ms; seyrek alan 4,44/5,51 ms. Hata ve pool kuyruğu görülmedi. Bu PostGIS aday okuma mikrobenchmark'ıdır; dış servis gecikmesi, üretim SLA, gerçek yol veya tamamlanmış EV planlama performansı değildir.

## Komutlar

```sh
pnpm --filter @chargeroad/api db:migrate
pnpm --filter @chargeroad/api stations:sources
pnpm --filter @chargeroad/api stations:sync --provider open-charge-map
pnpm --filter @chargeroad/api stations:sync --provider epdk-stations
pnpm --filter @chargeroad/api stations:rebuild
```

Eski `stations:sync-epdk` komutu aynı provider servisine delegasyon yapar. `stations:publish` normalize paketi/ham dosyayı açık yönetim işlemi olarak alır; karantina incelemesi ve kaynak zamanı kontrolü yine geçerlidir. `scripts/review-ocm.ts`, DB'deki son ham OCM alımını dış HTTP olmadan yeniden normalize eder; kendi başına yayın yapmaz.

## Açık kalanlar

- Gerçek canlı müsaitlik feed'i, fiziksel EVSE kimlik eşleştirmesi, güncel gözlem zamanı ve TTL: CR-008'in kalan kapsamı. OCM/EPDK ile başlangıçta canlı müsaitlik unknown.
- Tarife sağlayıcı adapter'ı ve doğrulanmış sayısal fiyat; otomatik ücretli veri edinimi uygulanmadı.
- Kaynaklar arası gerçek crosswalk incelemeleri; farklı lisanslı sağlayıcıların kabulü; hata sonrası dayanıklı zamanlama ve retention.
- Rota geometrisi/sapma CR-009, gerçek EV çözücü CR-011–013; bu teslim bunları tamamlamaz.
