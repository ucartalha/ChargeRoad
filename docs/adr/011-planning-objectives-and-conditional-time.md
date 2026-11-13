# ADR-011 — Planlama modları, SOC girdileri ve koşullu zaman

Tarih: 2026-11-11; son kararlar 2026-11-12. Durum: Ürün kararları kabul edildi. Kapsam: DEC-008 / CR-013. [Teknik teslim](../STOP_OPTIMIZER.md).

## Kabul edilenler

1. Kullanıcı süre, daha az şarj durağı ve düşük enerji tüketimi olmak üzere üç moddan seçer. İlk/default mod süre optimizasyonudur. Mevcut `minimum_total_duration`, `minimum_charging_stops`, `minimum_energy` amaçları bu ayrımı karşılar; gerçek solver/mobil bağlantı henüz yoktur.
2. Süre modu şarj eğrisinin uygun kısmi şarj aralıklarını değerlendirir. Kullanıcının %10–80 ifadesi evrensel alt/üst sınır değildir: rezerv daha yüksek seçilmişse o sınır geçerlidir. Sabit %80 kesimi yapılmaz; süre modu da gerekli olduğunda daha yüksek hedef seçebilir.
3. Az durak modu, uygun eğri ve donanım kapsamı içinde %80 üzerindeki şarj hedeflerini arayarak durak sayısını azaltabilir. Şarj süresinin uzaması açıkça gösterilir; daha yüksek hedefin her durumda daha iyi olduğu varsayılmaz.
4. Minimum yol rezervi ve hedef varış SOC'si her planlamada kullanıcı tarafından belirlenir. Önce önerilen %10/%20 ürün varsayılanları kabul edilmedi. Eksik girdiler otomatik tamamlanmaz. Hedef varış SOC'si rezervin altında olamaz; seçilen mod bu kısıtları aşamaz.
5. Kuyruk bilinmiyorsa 0 dakika bekleme varsayımsal senaryosuyla koşullu plan üretilir. Gerçek bekleme ve kesin ETA belirsiz kalır. Senaryo zaman çizelgesi ayrı tutulur; gerçek gözlem alanına sıfır yazılmaz. Fiilî gecikmede hava, enerji/SOC ve kalan plan yeniden değerlendirilir.
6. Tüm modlar kendi deterministik algoritmalarımızla çalışır; LLM veya tek bir dış EV-plan sağlayıcısına bağımlılık eklenmez.

## Son yanıtla kabul edilen ek kararlar

- Düşük enerji modu, sürüş/klima/batarya termal tüketiminden rejenerasyon çıkarılarak bulunan **net sürüş batarya enerjisini** en aza indirir. Şarj kayıpları bu amaca eklenmez; ayrıca raporlanır.
- Arama bütçesi dolarsa tüm kısıtları doğrulanmış mevcut en iyi plan sınırlı arama etiketiyle sunulur. Geçerli aday yoksa computation_limit; hiçbir durumda eksik doğrulamalı aday başarılı plan sayılmaz.

## Uygulama ayrıntıları

- Sıralama süre modunda süre → durak → mesafe; az durakta durak → süre → mesafe; enerjide net kWh → süre → durak → mesafe. Dakika düzeyinde bir “yakınlık” eşiği eklenmedi; yalnız sayısal enerji karşılaştırması 1e-8 kWh çözünürlükte yapılır.
- Yol/hava sorguları provider portları ve istek başına session üzerinden sınırlanır; tüm alt yollar final plan girdisinde kaynak snapshot'ı olarak doğrulanır.
- [Arama çözünürlüğü ve geliştirme bütçeleri](../STOP_OPTIMIZER.md) sürümlü parametrelerdir, üretim SLA'sı değildir.

Üç mod sunulması, her plan isteğinde üç aramanın zorunlu paralel çalıştırılması veya üç ayrı planın mutlaka döndürülmesi anlamına gelmez; seçilen moda göre çalışma önerisi teknik taslakta kalır. Fiyat optimizasyonu bu üç moddan biri değildir.

## Sonuç

[Hazırlık](../TASK_013_PREPARATION.md) ve [solver teslimi](../STOP_OPTIMIZER.md) bu karara göre güncellendi. Kalibrasyon/EVSE/hava yeterlilik kapıları ve açık CR-011/008/saha işleri korunur. Genel plan HTTP endpoint'i ve mobil akış bu görevde açılmadı.
