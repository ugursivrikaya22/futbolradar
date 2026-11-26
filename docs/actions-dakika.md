# GitHub Actions dakika tüketimi

Depo **özel**; Actions dakikası kotalı (Free 2.000, Pro 3.000 dk/ay; aşım faturalanır
ya da harcama limiti dolunca işler hiç başlamaz). 6 Kasım 2026'dan beri tüm iş akışları
2–3 sn'de adımsız kırmızı bitiyor ve senkron durmuş durumda: bu, kota/harcama limiti
belirtisiyle uyumlu. Kesin neden Actions arayüzündeki hata anotasyonundadır
(API vermiyor) — **önce oraya bakın**, Settings → Billing and plans → Usage.

## Ölçüm (6 Kasım 2026'ya kadar başarılı koşular)

| Kalem | Süre | Sıklık | Dakika/gün |
|---|---|---|---|
| Zamanlanmış güncelleme (saatlik) | 10–17 dk (örnek: 10,5 dk; adım dökümü: pipeline 9,4 dk, checkout 25 sn, kalan ~1 dk) | ~22 | ~290 |
| Zamanlanmış güncelleme (günlük tam) | 9–28 dk | 1 | ~20 |
| Sağlık kontrolü | 40–60 sn | 24 | ~24 |
| PR CI (`Interaction checks`, tam `npm run build`) | ~48 dk | **her PR push'u** + her main push'u | değişken |

Zamanlanmış güncellemeler tek başına ayda ~9.000 dk eder (Pro kotasının 3 katı).
Taslak PR'lara günde onlarca push eden ajan oturumları PR CI'ını bundan da büyük yapabilir
(5 PR × 4–5 push × 48 dk ≈ 1.000 dk/gün).

## Bu değişiklikle yapılanlar

1. **PR CI kapısı** (`.github/workflows/interaction-checks.yml`, kural: `scripts/lib/ciGate.mjs`).
   `production` (48 dk) şunlarda **atlanır**: taslak PR; yalnızca `docs/`, `outputs/`, `editorial/`,
   `.github/`, `README.md`/`AGENTS.md` değiştiren PR (Vercel'in build atlama kuralıyla aynı tanım).
   **Her zaman çalışır**: `main`'e push, elle tetikleme (Run workflow), taslak olmayan PR'da kaynak/içerik
   değişikliği. Taslak "Ready for review" yapılınca CI koşar (`ready_for_review` tipi eklendi).
   Taslakta CI gerekirse: Actions → Interaction checks → Run workflow (dalı seçin).
   Atlanan iş "skipped" görünür; zorunlu kontrol olsa bile başarısız sayılmaz. Kapı hatada **çalışmayı**
   seçer (dosya listesi alınamazsa vb.). Kapı işi ~20–30 sn (yalnızca 3 dosya sparse-checkout).
2. **Gece zamanlaması**: `7 0-1,3,22-23` (ardışık saatler = fiilen saatlik) → `7 22,0`. Gece iki saatte
   bir (01:07 ve 03:07 TSİ; 05:00 TSİ günlük tam). Test yorumundaki 20.09.2026 "gece iki saatte bir" kararının
   gerçek uygulaması. En uzun boşluk 2 saat; izleyici 3 saatten sonra yalnızca **uyarı** verir.
3. **Koruma testi**: `scripts/test-workflow-cost.mjs` — kapı kuralı, iş akışı bağlantısı, günlük zamanlanmış
   koşu sayısı ≤ 21, iki koşu arası ≤ 2 saat.

## Tasarruf (tahmin; gerçek kullanım Billing → Usage'dan doğrulanmalı)

- Zamanlanmış güncelleme: günde 3 koşu × ~13 dk ≈ **−39 dk/gün (≈ −1.200 dk/ay, ≈ −13%)**.
- PR CI: taslak PR push'ları artık 0 dk. Yoğun günde yüzlerce–bin dakika; sürekli bir oran değil.
- **Yetmez**: değişiklikten sonra bile zamanlanmış güncellemeler ayda ~8.000 dk eder; tek başına Pro
  kotasını aşar. Sürdürülebilir çözüm ücretli dakika / harcama limiti **ya da** aşağıdaki seçeneklerden biri.

## Yapılmayan, seçenekler (davranışı değiştirdiği için sahibin kararı)

- **Gündüz saatliği 2 saatliğe** (18 → 9 koşu, ≈ −120 dk/gün): skor/haber tazeliği 2 saate düşer.
- **Maç penceresi kapısı**: `plan` adımına "±3 saatte maç yoksa saatlik koşuyu atla" eklemek en büyük
  tasarruf (gündüz koşularının çoğu), ama haber/ticker akışını da seyreltir ve izleyicinin tazelik
  eşikleriyle birlikte yeniden ayarlanmalı.
- **`npm run build` süresi** (48 dk): CI'ın asıl maliyeti; önbellek/artımlı üretim ayrı bir mühendislik işi.
- **Self-hosted runner**: özel depoda dakikayı sıfırlar, ama bakım ve güvenlik yükü getirir.
- Sağlık kontrolü (24 dk/gün) ve Vercel cron'ları bilerek dokunulmadı (uyarı kanalı).
