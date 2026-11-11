# OCM yetkili örneklem doğrulaması

Tarih: 2026-11-11. Kullanıcının sağladığı anahtar, Git tarafından ignore edilen backend `.env` dosyasına kaydedildi. Anahtar rapora, kaynak koduna, URL'ye veya mobil ortama konmadı. Anahtarla GET çağrıları başarılı; bu teslim tanılama/doğrulamadır, üretim adapter'ı veya katalog yayını değildir.

## Gerçek sorgular

Sonraki teslim: [Provider mimarisi ve ülke import'u uygulandı](STATION_PROVIDERS.md). Aşağıdaki 25/24 örneklem raporu ilk doğrulamadır; güncel katalogda 1.737 OCM kaydı yayınlandı.

`X-API-Key` header'ı, özel User-Agent ve `client=ChargeRoad` kullanıldı. Toplam 26 benzersiz dış çağrı: 1 referans sözlüğü + 1 küçük Türkiye örneği + 24 koordinat çevresi sorgusu. Hepsi HTTP 200. Otomatik retry/yük testi yapılmadı. Tekrar raporlama checksum'u doğrulanan yerel cache üzerinden yapıldı; raporlardaki `networkCallsThisRun=0` bu son çevrimdışı rapor üretimine aittir. Manifest'lerde gerçek indirme zamanları, URL, HTTP durumları ve checksum bulunur.

Ham cevaplar/manifest'ler Git dışındaki `artifacts/task8-ocm/` dizininde. [Tanılama aracı](../apps/api/scripts/audit-ocm.cjs); [küçük örnek raporu](validation/task8-ocm-audit.json); [24 lokasyon raporu](validation/task8-ocm-comparison.json). Kaynak: [Open Charge Map](https://www.openchargemap.org/develop/api); kayıt sağlayıcılarının lisansları raporda ayrıca korunur.

## Türkiye'den ilk 25 kayıt

Filtre: `countrycode=TR&opendata=true&maxresults=25&sortby=id_asc&compact=false&verbose=true&includecomments=false`. En eski ID'lerden başlayan bu örnek Türkiye'yi istatistiksel temsil etmez.

| Alan | Sonuç |
|---|---|
| POI / connection özeti | 25 / 61 |
| Genel POI durumu | 25/25 Operational (50) |
| Connection genel durumu | 54/61 Operational; 7/61 null |
| Connector tip kimliği | 61/61 dolu |
| Nominal güç | 60/61 dolu |
| Quantity | 53/61 dolu |
| Akım / voltaj | 38/61 dolu |
| Serbest metin UsageCost | 8/25 dolu; doğrulanmış kWh fiyatı değildir |
| Doğrulanmış canlı müsaitlik | Yok; efektif durum unknown |

Kayıt güncelleme zamanları 2016–2026 arasında; kaynağı bugün indirmek eski kayıtları güncel fiziksel gözleme dönüştürmez. Referans sözlüğündeki 10/20 otomatik durum kodları bu örnekte gelmedi. `DateLastStatusUpdate` POI/alt alan güncelleme zamanıdır; canlı EVSE gözlem zamanı sayılmadı.

### Lisans kapısı: opendata=true tek başına yeterli değil

25 kaydın 21'i OCM Contributors (DataProviderID=1), CC BY 4.0; 4'ü Oplaadpalen.nl (26), Attribution-NonCommercial-ShareAlike 3.0 olarak geldi. İkinci grubun `IsOpenDataLicensed=true` olması ticari ürün kullanımı için yeterli kabul edilmeyecek. Ayrı izin olmadan bu grup ürün import'una alınmaz. Araştırma örneğinde görünmesi onaylanmış ürün yayını değildir.

Ürün import'u için sağlayıcı bazlı açık lisans izin listesi gerekir; ilk aday Contributors/CC BY 4.0 olur. Diğer sağlayıcılar lisans/atıf şartları doğrulanarak ayrıca açılır. OCM API anahtarı bütün kaynak lisanslarının yerine geçmez. Bu politika kapsamı daraltabilir; filtre ve kabul edilen sağlayıcı kümesi snapshot kapsamına yazılmalı.

`includecomments=false` olmasına rağmen iki POI'de MediaItems nesneleri döndü. Medya URL'lerine istek yapılmadı; yorum/medya içeriği normalize ürün verisine taşınmayacak. API filtresine ek olarak alan izin listesi gerekir.

## Hazırlanan 24 EPDK lokasyonunun karşılaştırması

Her birine aynı ağın OCM operator ID'si, `countrycode=TR`, `opendata=true`, 2 km yarıçap ve en fazla 100 sonuç ile sorgu yapıldı. EPDK karşılaştırma girdisi 10 Kasım snapshot'ıdır. 150 metre, bu araştırmada inceleme adayı ayırmak içindir; otomatik eşleştirme veya üretim kabul eşiği değildir.

| Ağ | İncelenen | 2 km içinde aynı operator ID ile aday dönen | 150 m içinde aday bulunan |
|---|---:|---:|---:|
| Trugo | 8 | 2 | 1 |
| Eşarj | 8 | 2 | 0 |
| ZES | 8 | 3 | 2 |
| Toplam | 24 | 7 | 3 |

17 sorgu boş döndü. Bu sonuç OCM'de bütün ülkede kapsama olmadığı veya istasyonun fiziksel olarak bulunmadığı anlamına gelmez; açık veri/ağ filtresi ve 2 km arama kapsamındaki sonuçtur. Hiçbir sorgu 100 sonuç sınırına ulaşmadı. Yakındaki komşu istasyonlar, aranan istasyonla aynı yer sayılmaz; doğrulanmış crosswalk üretilmedi.

16 farklı yakın POI adayının tamamı CC BY 4.0 / Contributors kaynağından ve genel durum 50 olarak geldi. Bunlarda 22 connection özeti; tip 22/22, güç 21/22 dolu. Otomatik müsait/dolu (10/20) iddiası yok. Bu paydalar **yakın adaylara** aittir; doğrulanmış 24 istasyon eşleşmesinin veri doluluk oranı değildir. Canlı veri tazeliği veya gecikmesi ölçülmüş sayılmaz.

### Eşleştirme örnekleri

- Trugo Shell İzmir Çıkışı için OCM Shell Selçuk 25 m yakınlıkta; lokasyon eşleşmesine güçlü aday. Karar ve fiziksel ekipman doğrulaması yine ayrı.
- EPDK'nin DC örneklemindeki İbis Hotel Eskişehir için OCM kaydı 50 m yakınlıkta, ancak 2021 tarihli ve yalnız 22 kW AC özeti içeriyor. Lokasyon benzerliği güncel DC ekipman kanıtı değildir.
- Green Nature Diamond Hotel için 96 m yakındaki OCM sonucu **ZES 3M Migros Marmaris**. Ad/tesis farklı; sırf 150 m içinde diye birleştirilmedi.
- Bir Marmaris adayının başlığında Trugo, OperatorID alanında ZES bulunuyor. Alan çelişkisi inceleme gerektirir; kaynak etiketinin hatasız olduğu varsayılmaz.

## Sonuç ve sonraki uygulama

OCM katalog zenginleştirmesi için kullanılabilir; bu küçük örnek tek başına EPDK kataloğunun yerine geçirilmesini veya canlı müsaitlik sunulmasını desteklemiyor. Mevcut EPDK kimlikleri/kataloğu korunacak. Önce Contributors gibi ürün kullanımına uygun lisansı doğrulanmış kaynaklar, sıkı kimlik/eşleştirme ve aggregate ekipman modeliyle staging'e alınmalı.

Gerekli sonraki teslim: quantity/aggregate ve kayıt düzeyinde lisans sözleşmesi; yeni migration gerekiyorsa ayrı dosya; OCM normalizer/import adapter'ı; kontrollü yayın; doğru kaynak atfı; API okumasında dış HTTP olmaması. Bu turda DB migration/import/yayın yapılmadı. CR-008 gerçek canlı feed kabulü açık; başlangıçta efektif müsaitlik unknown.

## Tekrarlama

```sh
node apps/api/scripts/audit-ocm.cjs
node apps/api/scripts/audit-ocm.cjs --compare
```

24 saat içindeki aynı URL için checksum doğrulanan araştırma dosyası kullanılır; bu süre yalnız tanılama cache'idir, üretim canlı TTL'si değildir. İlk sorgulama 26 istekle sınırlandırıldı; ardışık dış çağrılar en az 1,1 saniye arayla başladı. Bu hız OCM'nin ilan ettiği kota olarak yorumlanmaz. 429/timeout/auth hatasında çalışma durur; cache yoksa sonraki çalıştırma ağ erişimi gerektirir.
