/**
 * Toplu sağlayıcı çağrıları için devre kesici + süre bütçesi.
 *
 * SORUN. fixture-calendar adımı 18 takım × 2 uç noktayı sırayla çekiyor ve her
 * istek 12 sn zaman aşımı + 2 yeniden deneme taşıyor. Sağlayıcı yavaş ya da
 * kapalıyken tek bir koşu ~26 dakika sürebilecek iken adım 8 dakikada
 * zaman aşımına uğruyor, o ana dek toplananların hepsi atılıyor ve koşucu
 * dakikaları boşa harcanıyor (16.10.2026 tam güncellemesi: 480 sn, 0 kayıt).
 *
 * ÇÖZÜM. Art arda N başarısız istekten sonra ya da toplam süre bütçesi
 * dolduğunda döngü temiz biçimde durur; o ana dek toplanan veri korunur ve
 * çağıran taraf nedeni raporlar. Sınırsız yeniden deneme yok.
 */
export function createRequestBreaker({maxConsecutiveFailures = 4, budgetMs = 5 * 60 * 1000, now = Date.now} = {}) {
  const startedAt = now();
  let consecutive = 0;
  let total = 0;
  return {
    record(ok) {
      if (ok) consecutive = 0; else { consecutive += 1; total += 1; }
    },
    stopReason() {
      if (consecutive >= maxConsecutiveFailures) return `${consecutive} consecutive request failures (provider unavailable)`;
      if (now() - startedAt >= budgetMs) return `time budget of ${Math.round(budgetMs / 1000)}s exhausted`;
      return null;
    },
    get failures() { return total; },
  };
}

/** Yeniden denemeye değer hata mı? 4xx (429 hariç) kalıcıdır; tekrar denemek kota yakar. */
export function isRetryableRequestError(error) {
  const status = Number(error?.status);
  if (Number.isFinite(status) && status > 0) return status === 429 || status >= 500;
  return true; // ağ hatası / zaman aşımı
}
