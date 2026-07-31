/**
 * İSTEK BÜTÇESİ — günlük kotayı koruyan sayaç.
 *
 * SORUN. API-Football ücretsiz paketi günde 100 istek veriyor ve
 * `getMatchDetail` maç başına DÖRT uç noktaya gidiyordu (lineups, events,
 * statistics, predictions). Oyuncu istatistiği bağlandıktan sonra bitmiş
 * maçlarda BEŞ oldu. Yani 20 maçlık bir geri doldurma koşusu tek başına
 * günlük kotanın tamamını tüketebilir — ve kota bittiğinde sağlayıcı 429
 * döndürmeye başlar, yalnızca o koşu değil canlı skor da durur.
 *
 * ÇÖZÜM. Koşu başına harcanan istek sayılır ve GÜVENLİ EŞİK aşılmadan
 * durulur. Eşik kotanın tamamı değil: canlı skor yoklaması ve sağlık
 * kontrolü için pay bırakılır. Sınıra dayanan bir koşu hata vermez —
 * kaldığı yeri raporlar ve sonraki koşuda devam edilir.
 *
 * Bu modül SAYAR, istek göndermez. Sağlayıcıdan bağımsız olması bilerek:
 * hem betikler hem sağlayıcı katmanı aynı sayacı paylaşabilir ve sayaç
 * testte gerçek ağ olmadan doğrulanabilir.
 */

/** Ücretsiz paketin günlük istek hakkı. */
const DAILY_QUOTA = 100;

/**
 * Tek koşunun harcayabileceği en yüksek istek sayısı.
 *
 * Kotanın tamamı değil: canlı skor döngüsü (5 dakikada bir) ve sağlık
 * kontrolü gün boyunca istek harcıyor. Bir geri doldurma koşusunun kotayı
 * sonuna kadar tüketmesi, o gün canlı skorun çalışmaması demek olurdu.
 */
const SAFE_RUN_LIMIT = 60;

/** Bu sayıya inildiğinde koşu durur; kalan hak diğer işlere bırakılır. */
const RESERVE_FOR_LIVE = 25;

/**
 * `getMatchDetail` bitmiş bir maç için kaç uç noktaya gidiyor?
 * lineups + events + statistics + predictions + players
 */
const REQUESTS_PER_FINISHED_MATCH = 5;

class RequestBudget {
  /**
   * @param {{limit?: number, quota?: number, reserve?: number, spent?: number}} [options]
   */
  constructor(options) {
    const settings = options || {};
    this.quota = Number.isFinite(settings.quota) ? settings.quota : DAILY_QUOTA;
    this.reserve = Number.isFinite(settings.reserve) ? settings.reserve : RESERVE_FOR_LIVE;
    this.limit = Number.isFinite(settings.limit) ? settings.limit : SAFE_RUN_LIMIT;
    this.spent = Number.isFinite(settings.spent) ? settings.spent : 0;
    this.perUnit = Number.isFinite(settings.perUnit) ? settings.perUnit : REQUESTS_PER_FINISHED_MATCH;
    this.stopReason = null;
    this.byEndpoint = Object.create(null);
  }

  /** Koşuda harcanabilecek en yüksek istek sayısı (rezerv düşülmüş). */
  get ceiling() {
    return Math.max(0, Math.min(this.limit, this.quota - this.reserve));
  }

  get remaining() {
    return Math.max(0, this.ceiling - this.spent);
  }

  /**
   * Bir birim daha (bir maç) işlenebilir mi? Maç başına düşen istek sayısı
   * kadar yer kalmalı — yarım işlenmiş bir maç, hem kotayı harcayıp hem
   * eksik veri bırakır.
   */
  canAfford(units) {
    const cost = (Number.isFinite(units) ? units : 1) * this.perUnit;
    return this.spent + cost <= this.ceiling;
  }

  /** Harcamayı kaydeder. Uç nokta adı verilirse dağılım da tutulur. */
  spend(count, endpoint) {
    const amount = Number.isFinite(count) ? count : 1;
    this.spent += amount;
    if (endpoint) {
      this.byEndpoint[endpoint] = (this.byEndpoint[endpoint] || 0) + amount;
    }
    return this.spent;
  }

  /** Bütçe bitti mi? Bittiyse sebebi kaydeder. */
  exhausted() {
    if (this.remaining <= 0) {
      this.stopReason = this.stopReason ||
        `güvenli eşiğe ulaşıldı (${this.spent}/${this.ceiling} istek; ${this.reserve} istek canlı skor için ayrıldı)`;
      return true;
    }
    return false;
  }

  summary() {
    return {
      quota: this.quota,
      reserve: this.reserve,
      ceiling: this.ceiling,
      spent: this.spent,
      remaining: this.remaining,
      perUnit: this.perUnit,
      byEndpoint: { ...this.byEndpoint },
      stopReason: this.stopReason
    };
  }
}

function createRequestBudget(options) {
  return new RequestBudget(options);
}

module.exports = {
  DAILY_QUOTA,
  REQUESTS_PER_FINISHED_MATCH,
  RESERVE_FOR_LIVE,
  RequestBudget,
  SAFE_RUN_LIMIT,
  createRequestBudget
};
