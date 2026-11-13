# Başlangıç audit — Valhalla/DEM hardening

Kanıt: 2026-11-12 canlı yerel dosya/Git/Docker denetimi. Bu rapor başlama durumudur, test başarısı veya üretim kabulü değildir.

| Alan | Gözlenen mevcut durum | Açık / korunacak |
| --- | --- | --- |
| Çalışma ağacı | Önceki görevlerden çok sayıda tracked/untracked değişiklik; `infra/` untracked | Reset/stash/üzerine toplu yazma yok. Dokunulan mevcut kaynakların başlangıç kopyaları ignored `artifacts/valhalla-hardening/baseline` içinde. |
| Yerel Compose | `infra/valhalla/compose.yaml`, image 3.9.1, 127.0.0.1:8002, DEM kapalı | Dosya aynen korunur; yeni ayrı Compose eklenir. |
| DEM runtime | `chargeroad-valhalla-elevation`, 127.0.0.1:8003, build_elevation=True, elevation-pilot bind mount | Yaklaşık 2 GB HGT ve tile/config mevcut; provenance/lisans manifesti yok. Servis durdurulmaz. |
| Diğer runtime | API 3000/3001 ready 200; Valhalla 8002/8003 status 200; PostgreSQL/OrderLane healthy | Port/PID/volume değişikliği yapılmaz. Yeni kod için ayrı geçici HTTP listener. |
| Git ignore | Sadece `custom_files/` kapsamda; `elevation-pilot` büyük tar/GPH/HGT dosyaları ignore dışında | Örnek veri/manifestten ayrı artifact ignore eklenir. Gerçek veri taşınmaz/silinmez. |
| Yerel policy farkı | HEAD sabit 100; yerelde non-production loopback `ROAD_ROUTING_DAILY_REQUEST_LIMIT` override mevcut | Mevcut değişikliğin amacı korunur; iç kapasite/dış kota ve endpoint namespace ayrılır. |
| Yükseklik normalizer | Geometrik/interval yükseklik var; kalite alanı atanmıyor; genel <=-32000 filtresi var | Sağlayıcı sentinel politikası, modelled/unknown ve null invariants testlenir. |
| Enerji | `ELEVATION_NOT_VERIFIED`, `ELEVATION_MISSING`, açık engineering policy mevcut | Fizik değişmez; modelled girdinin politika davranışı doğrudan testlenir. |
| ADR/görev | İstenen iki hedef dosya yok; mevcut `009-energy-evaluation-and-calibration.md` var | Kullanıcı belgeleri yeni farklı dosya adlarıyla eklenir; aynı 009 numarası isim çakışması değildir, mevcut ADR silinmez. |
| Güncel uygulama | Geoapify, asenkron plan işleri ve mobil navigasyon önceki yerel değişikliklerde mevcut | Belgelerin main incelemesindeki eski durumuyla karıştırılmaz; bu task mobil/şarj/alternatif optimizasyonuna dokunmaz. |

Kaynak doğrulaması: Valhalla **3.9.1** [graphconstants.h](https://github.com/valhalla/valhalla/blob/3.9.1/valhalla/baldr/graphconstants.h) graf no-data `-500`; [Skadi sample.cc](https://github.com/valhalla/valhalla/blob/3.9.1/src/skadi/sample.cc) `-32768`. Bu iki kesin sağlayıcı değeri genel coğrafi cutoff değildir. İmajın yerel `/valhalla/scripts/docker-entrypoint.sh` betiği `build_tiles`/`tar_tiles` ve `serve_tiles` akışını doğruladı; yeni runtime build girişini atlar.
