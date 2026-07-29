/**
 * ORTAM DEĞİŞKENİ TİPİ — asgari ambient bildirim.
 *
 * `tsc --noEmit` dört hata veriyordu: lib/providers/playerProvider.ts içinde
 * `process.env` okunuyor ama Node tipleri tanımlı değil (TS2591).
 *
 * Alışılmış çözüm `@types/node` kurmak. Bu depo BİLEREK bağımlılıksız —
 * package.json'da tek bir dependency yok, build yalnızca Node'un kendisiyle
 * çalışıyor. Tek bir tip hatası için ilk npm bağımlılığını eklemek, kurulum
 * yüzeyini ve tedarik zinciri riskini kalıcı olarak büyütürdü.
 *
 * Bu yüzden yalnızca GERÇEKTEN KULLANILAN yüzey bildiriliyor: `process.env`.
 * Node API'sinin tamamı değil; burada yazan her satır kodda karşılığı olan
 * bir şeydir. Bir gün gerçek bağımlılıklar gelirse bu dosya silinip
 * `@types/node` kurulabilir.
 */

declare const process: {
  readonly env: Record<string, string | undefined>;
};
