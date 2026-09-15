/* ÜRETİLMİŞ DOSYA — kaynak: services/matchHub.js. Elle düzenlemeyin;
   `node scripts/build-match-hub-client.mjs` ile yeniden üretilir. */
/**
 * MAÇ MERKEZİ ÇEKİRDEĞİ — TEK TANIM, İKİ ÇALIŞMA ORTAMI.
 * ----------------------------------------------------------------------------
 * `mac-detay.html` sayfasını "maç merkezi"ne çeviren bölümlerin KARARLARI
 * burada duruyor: hangi olay hangi türdür, hangi istatistik çizilebilir,
 * kadro sahaya nasıl dizilir, bu skorla puan durumu nasıl değişir, tahmin
 * gösterilebilir mi, maç hangi kanalda, hangi haber bu maça ait.
 *
 * Çizim YOK. Bu dosya DOM'a dokunmaz, `fetch` çağırmaz, `require` ile Node'a
 * özel bir şey istemez — böylece hem `scripts/test-match-hub.mjs` içinde
 * Node'da hem de tarayıcıda aynı kod koşar (UMD). Tarayıcıya giden kopya
 * `scripts/build-match-hub-client.mjs` tarafından bu dosyadan ÜRETİLİR;
 * elle yazılan ikinci bir kopya, testin doğruladığı kuralla okuyucunun
 * gördüğü ekranın zamanla ayrışması demekti.
 *
 * DEĞİŞMEYEN KURAL: EKSİK VERİ UYDURULMAZ.
 *   • Sağlayıcı yüzde vermediyse yüzde üretilmez — `null` döner, yüzey
 *     "yayımlanmadı" yazar.
 *   • Diziliş koordinatı yoksa saha görseli çizilmez; oyuncular liste olur.
 *     "4-4-2'dir herhâlde" diye bir varsayım yok.
 *   • Canlı kazanma olasılığı yalnızca `services/winProbability.js` soketine
 *     takılı GERÇEK bir kaynaktan gelir (bugün boş — bkz. o dosya).
 *   • Akış üzerindeki koşan skor, ancak olaylardan çıkan toplam sağlayıcının
 *     bildirdiği skorla TUTUYORSA yazılır; tutmuyorsa hiç yazılmaz.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FutbolRadarMatchHub = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ================================================================== */
  /* DURUM                                                              */
  /* ================================================================== */

  /** Oynanan maç. Skor tabelası canlı, yoklama hızlanır. */
  var LIVE_CODES = ["1H", "2H", "ET", "P", "LIVE", "IN_PLAY", "INT", "SUSP"];
  /** Oyunun durduğu ama maçın bitmediği hâller. */
  var HALFTIME_CODES = ["HT", "HALFTIME", "BT", "PAUSED"];
  /** Sonucu kesinleşmiş maç. Otomatik özet ekranı buradan açılır. */
  var FINISHED_CODES = ["FT", "AET", "PEN", "FINISHED", "AWARDED", "AWD", "WO"];
  /** Oynanmayan maç. Ne canlı ne bitmiş: puan durumuna da girmez. */
  var UNPLAYED_CODES = ["PST", "POSTPONED", "CANC", "CANCELLED", "ABD", "ABANDONED", "TBD"];

  function upper(value) {
    return String(value == null ? "" : value).trim().toUpperCase();
  }

  function statusCodeOf(match) {
    if (!match) return "";
    return upper(match.providerStatus || match.status);
  }

  /**
   * Maçın hangi evrede olduğu. Sayfanın TAMAMI bu tek karara bakar: sticky
   * panelin rengi, yoklama aralığı, tahmin merkezinin açılıp açılmaması ve
   * maç sonu özetine geçiş hep buradan okunur.
   *
   * @returns {"pre"|"live"|"halftime"|"post"|"unplayed"}
   */
  function phaseOf(match) {
    var code = statusCodeOf(match);
    if (!code) return "pre";
    if (UNPLAYED_CODES.indexOf(code) !== -1) return "unplayed";
    if (FINISHED_CODES.indexOf(code) !== -1) return "post";
    if (HALFTIME_CODES.indexOf(code) !== -1) return "halftime";
    if (LIVE_CODES.indexOf(code) !== -1) return "live";
    return "pre";
  }

  function isLivePhase(phase) {
    return phase === "live" || phase === "halftime";
  }

  /**
   * Ekrandaki dakika. Sağlayıcı dakika vermiyorsa BOŞ döner — kickoff'tan
   * geçen süreyi sayıp "herhâlde 67. dakikadır" demek, bir zaman iddiasını
   * uydurmak olurdu.
   */
  function minuteText(match) {
    if (!match) return null;
    var phase = phaseOf(match);
    if (!isLivePhase(phase)) return null;

    var minute = match.minute;
    if (minute !== null && minute !== undefined && String(minute).trim() !== "") {
      var raw = String(minute).trim();
      return /'$/.test(raw) ? raw : raw + "'";
    }

    if (typeof match.time === "string" && /^\d+(\s*\+\s*\d+)?'$/.test(match.time.trim())) {
      return match.time.trim().replace(/\s+/g, "");
    }

    return null;
  }

  /** Skor okunabilir mi? "0" geçerli bir skordur, `null` değildir. */
  function hasScore(match) {
    var score = (match && match.score) || {};
    return score.home !== null && score.home !== undefined &&
      score.away !== null && score.away !== undefined &&
      Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
  }

  function scoreText(match) {
    if (!hasScore(match)) return null;
    return Number(match.score.home) + " - " + Number(match.score.away);
  }

  function halftimeText(match) {
    var score = (match && match.score) || {};
    if (score.halftimeHome === null || score.halftimeHome === undefined) return null;
    if (score.halftimeAway === null || score.halftimeAway === undefined) return null;
    return Number(score.halftimeHome) + "-" + Number(score.halftimeAway);
  }

  /* ================================================================== */
  /* METİN YARDIMCILARI                                                 */
  /* ================================================================== */

  /** Türkçe duyarlı normalleştirme: aksan ve "ı/İ" farkı eşleşmeyi bozmasın. */
  function normalize(value) {
    return String(value == null ? "" : value)
      .replace(/İ/g, "i").replace(/I/g, "i").replace(/ı/g, "i")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().trim();
  }

  function teamNameOf(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return value.name || value.team || "";
  }

  function sideOf(detail, name) {
    var wanted = normalize(teamNameOf(name));
    if (!wanted) return null;
    if (normalize(detail && detail.homeTeam) === wanted) return "home";
    if (normalize(detail && detail.awayTeam) === wanted) return "away";
    return null;
  }

  /* ================================================================== */
  /* MAÇ AKIŞI                                                          */
  /* ================================================================== */

  var EVENT_LABELS = {
    goal: "Gol",
    "own-goal": "Kendi kalesine",
    penalty: "Penaltı golü",
    "penalty-missed": "Kaçan penaltı",
    yellow: "Sarı kart",
    red: "Kırmızı kart",
    "second-yellow": "İkinci sarıdan kırmızı",
    sub: "Oyuncu değişikliği",
    var: "VAR",
    whistle: "Hakem",
    note: "Kayıt"
  };

  /** Akışta vurgulanan, "önemli olay" sayılan türler. */
  var KEY_KINDS = ["goal", "own-goal", "penalty", "red", "second-yellow", "var"];

  /**
   * Olay türünü sınıflandırır.
   *
   * Sağlayıcı tür alanını serbest metin gönderiyor ("Goal"/"Gol"/"subst")
   * ve penaltı, kendi kalesine, VAR gibi ayrımlar çoğu kez yalnızca
   * açıklama metninde geçiyor. Bu yüzden iki alan birlikte okunur ve
   * SIRA ÖNEMLİDİR: "kendi kalesine" kaydı "gol" içerdiği için gol'den
   * önce, "ikinci sarı" kırmızıdan önce denetlenir.
   */
  function classifyEvent(event) {
    var haystack = normalize(
      String((event && event.type) || "") + " " + String((event && event.detail) || "")
    );
    if (!haystack) return "note";

    if (/\bvar\b/.test(haystack)) return "var";
    if (haystack.indexOf("kendi kalesine") !== -1 || haystack.indexOf("own goal") !== -1) return "own-goal";
    if (haystack.indexOf("ikinci sari") !== -1 || haystack.indexOf("second yellow") !== -1) return "second-yellow";
    if (haystack.indexOf("kirmizi") !== -1 || haystack.indexOf("red card") !== -1) return "red";
    if (haystack.indexOf("sari") !== -1 || haystack.indexOf("yellow") !== -1) return "yellow";
    if (haystack.indexOf("kacan penalti") !== -1 || haystack.indexOf("missed penalty") !== -1) return "penalty-missed";
    if (haystack.indexOf("penalti") !== -1 || haystack.indexOf("penalty") !== -1) {
      return haystack.indexOf("gol") !== -1 || haystack.indexOf("goal") !== -1 ? "penalty" : "penalty-missed";
    }
    if (haystack.indexOf("gol") !== -1 || haystack.indexOf("goal") !== -1) return "goal";
    if (haystack.indexOf("degisiklik") !== -1 || haystack.indexOf("oyuna girdi") !== -1 ||
      haystack.indexOf("subst") !== -1) return "sub";
    if (haystack.indexOf("mac sonu") !== -1 || haystack.indexOf("devre") !== -1 ||
      haystack.indexOf("half time") !== -1 || haystack.indexOf("full time") !== -1) return "whistle";
    return "note";
  }

  /** Skoru değiştiren olay türleri — koşan skor yalnızca bunları sayar. */
  function scoresGoal(kind) {
    return kind === "goal" || kind === "penalty" || kind === "own-goal";
  }

  function minuteNumber(time) {
    var raw = String(time == null ? "" : time).match(/(\d+)(?:\s*\+\s*(\d+))?/);
    if (!raw) return null;
    var base = Number(raw[1]);
    return raw[2] ? base + Number(raw[2]) / 100 : base;
  }

  function minuteLabel(time) {
    var raw = String(time == null ? "" : time).match(/(\d+)(?:\s*\+\s*(\d+))?/);
    if (!raw) return "";
    return raw[2] ? raw[1] + "+" + raw[2] + "'" : raw[1] + "'";
  }

  /**
   * Gol olayının hangi takımın hanesine yazıldığı.
   *
   * KENDİ KALESİNE GOLÜ TERSİNE YAZILIR. Sağlayıcı olayı golü ATAN oyuncunun
   * takımına iliştiriyor; skor ise RAKİBİN hanesine işliyor. Bu ayrım
   * yapılmazsa koşan skor doğrulama testinden geçemez ve akışta hiç
   * görünmez — yani hata sessizce bir özelliği kapatırdı.
   */
  function scoringSide(item) {
    if (!item || !item.side) return null;
    if (item.kind === "own-goal") return item.side === "home" ? "away" : "home";
    return item.side;
  }

  /**
   * Gol/kart/değişiklik kayıtlarını tek akışta, dakikaya göre sıralı verir.
   *
   * Canlı maçta EN YENİ olay `latest: true` taşır; yüzey onu vurgular.
   * Bitmiş maçta vurgu yoktur — "en yeni" kavramı orada anlamsızdır.
   */
  function buildTimeline(detail) {
    var items = [];
    var source = detail || {};

    (Array.isArray(source.events) ? source.events : []).forEach(function (event) {
      if (!event || (!event.type && !event.detail)) return;
      var teamName = teamNameOf(event.team);
      items.push({
        sort: minuteNumber(event.time),
        minute: minuteLabel(event.time),
        kind: classifyEvent(event),
        team: teamName,
        side: sideOf(source, teamName),
        text: String(event.detail || event.type || "").trim(),
        player: (event.player && (event.player.name || event.player)) || null,
        assist: (event.assist && (event.assist.name || event.assist)) || null
      });
    });

    (Array.isArray(source.substitutions) ? source.substitutions : []).forEach(function (sub) {
      if (!sub) return;
      var teamName = teamNameOf(sub.team);
      var parts = [];
      if (sub.in) parts.push(sub.in + " oyuna girdi");
      if (sub.out) parts.push(sub.out + " çıktı");
      if (sub.note) parts.push(sub.note);
      items.push({
        sort: minuteNumber(sub.time),
        minute: minuteLabel(sub.time),
        kind: "sub",
        team: teamName,
        side: sideOf(source, teamName),
        text: parts.join(" · ") || "Oyuncu değişikliği",
        playerIn: sub.in || null,
        playerOut: sub.out || null
      });
    });

    items.sort(function (left, right) {
      var a = left.sort === null ? 999 : left.sort;
      var b = right.sort === null ? 999 : right.sort;
      return a - b;
    });

    items.forEach(function (item, index) {
      item.order = index;
      item.label = EVENT_LABELS[item.kind] || EVENT_LABELS.note;
      item.key = KEY_KINDS.indexOf(item.kind) !== -1;
    });

    return attachRunningScore(items, detail);
  }

  /**
   * Akışa koşan skoru ekler — AMA YALNIZCA DOĞRULANABİLİYORSA.
   *
   * Olay listesi eksik gelebilir (sağlayıcı geç yayımlar, ilk yarı kayıtları
   * sonradan düşer). Eksik listeden toplanan skor "2-0"ken tabelada "3-1"
   * yazıyorsa, akıştaki her satır yanlış olur. Bu yüzden toplam önce
   * tabeladaki skorla karşılaştırılır; tutmuyorsa hiçbir satıra skor
   * yazılmaz. Yarım doğru bir skor, hiç skor olmamasından kötüdür.
   */
  function attachRunningScore(items, detail) {
    var home = 0;
    var away = 0;
    var tally = [];

    items.forEach(function (item) {
      if (!scoresGoal(item.kind)) {
        tally.push(null);
        return;
      }
      var side = scoringSide(item);
      if (!side) {
        // Takımı çözülemeyen gol, koşan skoru kilitler: sayamadığımız bir
        // golün ardından gelen her skor yanlış olurdu.
        tally.push(false);
        return;
      }
      if (side === "home") home += 1; else away += 1;
      tally.push(home + "-" + away);
    });

    var broken = tally.indexOf(false) !== -1;
    var reported = (detail && detail.score) || {};
    var matches = hasScore(detail) && Number(reported.home) === home && Number(reported.away) === away;

    if (broken || !matches) return items;

    items.forEach(function (item, index) {
      if (typeof tally[index] === "string") item.score = tally[index];
    });
    return items;
  }

  /**
   * Canlı maçta vurgulanacak olayın sırası. Bitmiş/başlamamış maçta `null`
   * döner — vurgu, "az önce oldu" demektir.
   */
  function latestEventIndex(items, detail) {
    if (!isLivePhase(phaseOf(detail))) return null;
    if (!Array.isArray(items) || !items.length) return null;
    return items[items.length - 1].order;
  }

  /* ================================================================== */
  /* İSTATİSTİK KARŞILAŞTIRMASI                                         */
  /* ================================================================== */

  /**
   * Görsel karşılaştırmada üstte duran ölçümler. Sağlayıcı bunlardan
   * hangilerini yayımladıysa o kadarı çizilir; listedeki bir ölçüm
   * gelmediyse satırı hiç açılmaz.
   */
  var PRIMARY_STATS = [
    "Topla oynama",
    "Toplam şut",
    "İsabetli şut",
    "Korner",
    "Faul",
    "Ofsayt",
    "Sarı kart",
    "Kırmızı kart",
    "Pas isabeti",
    "Gol beklentisi (xG)"
  ];

  /**
   * ÖLÇÜMÜN YÖNÜ: hangi taraf "iyi"?
   *
   * Sağlayıcı bu bilgiyi yalnızca bazı satırlarda gönderiyor
   * (`higherIsBetter`). Alan yoksa "yüksek olan iyidir" varsaymak somut
   * bir yanlış üretiyordu: 14 faul yapan ve sarı kart gören takım ekranda
   * ÜSTÜN taraf gibi yeşile boyanıyordu. Ölçüm adı da bilinmiyorsa hiçbir
   * taraf vurgulanmaz — yönü bilmediğimiz bir ölçümde "kim daha iyi"
   * demek, veriden çıkmayan bir yorum eklemek olurdu.
   */
  var HIGHER_IS_BETTER = [
    "topla oynama", "toplam sut", "isabetli sut", "ceza sahasi icinden sut", "korner",
    "kurtaris", "toplam pas", "isabetli pas", "pas isabeti", "gol beklentisi (xg)",
    "basarili dribling", "kazanilan ikili mucadele"
  ];
  var LOWER_IS_BETTER = [
    "faul", "sari kart", "kirmizi kart", "ofsayt", "isabetsiz sut", "kacan penalti",
    "hata", "engellenen sut"
  ];

  /** @returns {boolean|null} true: yüksek iyi, false: düşük iyi, null: bilinmiyor */
  function statDirection(item) {
    if (typeof item.higherIsBetter === "boolean") return item.higherIsBetter;
    var key = normalize(item.type);
    if (HIGHER_IS_BETTER.indexOf(key) !== -1) return true;
    if (LOWER_IS_BETTER.indexOf(key) !== -1) return false;
    return null;
  }

  function statNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    var number = typeof value === "number" ? value : Number(String(value).replace("%", "").replace(",", "."));
    return Number.isFinite(number) ? number : null;
  }

  /**
   * Bir istatistik satırının çubuk payı.
   *
   * Yüzdeyle gelen ölçümler (topla oynama, pas isabeti) zaten bir orandır;
   * onları toplam üzerinden yeniden oranlamak yanlış olurdu: %79 ve %21
   * toplamı 100 iken, %88 ve %84 pas isabetinin toplamı 172'dir ve çubuk
   * "yarı yarıya" gösterirdi. Bu yüzden yüzde birimli satırlarda pay
   * DEĞERİN KENDİSİDİR.
   */
  function statShare(home, away, unit) {
    if (String(unit || "").trim() === "%") {
      var total = home + away;
      // Toplamı 100 olan çift (topla oynama) doğrudan kendi payını taşır.
      if (Math.abs(total - 100) <= 1) return Math.round(home);
      return total > 0 ? Math.round((home / total) * 100) : 50;
    }
    var sum = home + away;
    return sum > 0 ? Math.round((home / sum) * 100) : 50;
  }

  function formatStat(value, decimals, unit) {
    var text = decimals ? Number(value).toFixed(decimals).replace(".", ",") : String(value);
    return text + (unit || "");
  }

  /**
   * Çizilebilir istatistik satırları. Değeri olmayan (null) ölçüm ELENİR:
   * "0" gerçek bir ölçümdür, "veri gelmedi" değildir.
   */
  function statRows(detail) {
    var stats = Array.isArray(detail && detail.statistics) ? detail.statistics : [];
    return stats.map(function (item) {
      if (!item) return null;
      var home = statNumber(item.home);
      var away = statNumber(item.away);
      if (home === null || away === null) return null;

      var unit = item.unit || "";
      var decimals = typeof item.decimals === "number" ? item.decimals : 0;
      var share = statShare(home, away, unit);
      var direction = statDirection(item);

      return {
        type: item.type || "",
        category: item.category || "Genel",
        home: home,
        away: away,
        homeText: formatStat(home, decimals, unit),
        awayText: formatStat(away, decimals, unit),
        unit: unit,
        decimals: decimals,
        homeShare: Math.max(0, Math.min(100, share)),
        awayShare: Math.max(0, Math.min(100, 100 - share)),
        higherIsBetter: direction,
        leader: (direction === null || home === away)
          ? null
          : ((home > away) === direction ? "home" : "away"),
        primary: PRIMARY_STATS.some(function (name) { return normalize(name) === normalize(item.type); })
      };
    }).filter(Boolean);
  }

  /** Öne çıkan ölçümler, PRIMARY_STATS sırasıyla. */
  function primaryStatRows(detail) {
    var rows = statRows(detail);
    return PRIMARY_STATS.map(function (name) {
      return rows.filter(function (row) { return normalize(row.type) === normalize(name); })[0];
    }).filter(Boolean);
  }

  function groupStatRows(rows) {
    var order = [];
    var groups = Object.create(null);
    (rows || []).forEach(function (row) {
      var key = row.category || "Genel";
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(row);
    });
    return order.map(function (key) { return { category: key, rows: groups[key] }; });
  }

  /* ================================================================== */
  /* KADROLAR VE DİZİLİŞ                                                */
  /* ================================================================== */

  /**
   * İsim listesi + ayrıntı listesini tek modele katlar.
   *
   * Sağlayıcı `players`/`substitutes` alanlarını geriye dönük uyumluluk
   * için düz isim listesi olarak tutuyor; forma numarası, mevki ve saha
   * koordinatı `startingDetails`/`substituteDetails` içinde geliyor
   * (bkz. services/providers/apiFootballProvider.js#normalizeFixtureLineups).
   * Ayrıntı yoksa oyuncu yine listelenir, yalnızca numarası/mevkisi boş
   * kalır — numara UYDURULMAZ.
   */
  function mergePlayers(names, details) {
    var list = Array.isArray(details) && details.length
      ? details.map(function (entry) {
        return {
          name: (entry && entry.name) || "",
          number: entry && entry.number !== undefined && entry.number !== null ? Number(entry.number) : null,
          position: (entry && entry.position) || null,
          grid: (entry && entry.grid) || null
        };
      })
      : (Array.isArray(names) ? names : []).map(function (name) {
        return { name: typeof name === "string" ? name : teamNameOf(name), number: null, position: null, grid: null };
      });

    return list.filter(function (entry) { return entry.name; });
  }

  /**
   * Bir maçın iki kadrosu.
   *
   * YEDEK ALANI İKİ ADLA GELİYOR. Sağlayıcı `substitutes` yazıyor, depodaki
   * küratörlü kayıtlar `bench`. Tek ada bakan bir okuma, sağlayıcıdan gelen
   * her maçta yedek kulübesini boş gösterirdi; ikisi de kabul edilir.
   */
  function lineupSides(detail) {
    var groups = Array.isArray(detail && detail.lineups) ? detail.lineups : [];
    var coaches = (detail && detail.coaches) || {};

    return groups.map(function (group) {
      if (!group) return null;
      var teamName = teamNameOf(group.team);
      var side = sideOf(detail, teamName);
      var starters = mergePlayers(group.players, group.startingDetails);
      var bench = mergePlayers(group.bench || group.substitutes, group.substituteDetails);

      return {
        side: side,
        team: teamName,
        formation: group.formation || null,
        coach: (side && coaches[side]) || group.coach || null,
        starters: starters,
        bench: bench,
        hasNumbers: starters.some(function (entry) { return entry.number !== null; }),
        pitch: formationRows(starters, group.formation)
      };
    }).filter(Boolean);
  }

  /**
   * Saha görseli için satırlar: kaleci en altta, forvet en üstte.
   *
   * İKİ KAYNAK, TEK KURAL — ya sağlayıcının `grid` koordinatı ("3:2" =
   * 3. sıra, 2. sütun) ya da diziliş metni ("4-2-3-1") + 11 oyuncunun
   * SIRASI. İkisi de yoksa `null` döner ve yüzey saha çizmez, düz liste
   * gösterir: oyuncuları tahmine dayalı bir sahaya yerleştirmek, okuyucuya
   * doğrulanmamış bir taktik iddiası sunmak olurdu.
   */
  function formationRows(starters, formation) {
    var players = Array.isArray(starters) ? starters.filter(function (p) { return p && p.name; }) : [];
    if (players.length < 7) return null;

    var gridded = players.filter(function (p) { return /^\d+\s*:\s*\d+$/.test(String(p.grid || "")); });
    if (gridded.length === players.length) {
      var rows = Object.create(null);
      var order = [];
      gridded.forEach(function (player) {
        var parts = String(player.grid).split(":");
        var row = Number(parts[0].trim());
        var col = Number(parts[1].trim());
        if (!rows[row]) { rows[row] = []; order.push(row); }
        rows[row].push({ player: player, col: col });
      });
      order.sort(function (a, b) { return a - b; });
      return order.map(function (row) {
        return rows[row].sort(function (a, b) { return a.col - b.col; }).map(function (entry) { return entry.player; });
      });
    }

    var shape = String(formation || "").trim();
    if (!/^\d+(-\d+)+$/.test(shape) || players.length !== 11) return null;

    var lines = shape.split("-").map(Number);
    if (lines.some(function (n) { return !Number.isFinite(n) || n <= 0; })) return null;
    var outfield = lines.reduce(function (total, n) { return total + n; }, 0);
    if (outfield !== 10) return null;

    var result = [[players[0]]];
    var cursor = 1;
    lines.forEach(function (count) {
      result.push(players.slice(cursor, cursor + count));
      cursor += count;
    });
    return result;
  }

  /* ================================================================== */
  /* PUAN DURUMU VE "BU SKORLA"                                         */
  /* ================================================================== */

  /**
   * Maçın tablosu hangi lige ait?
   *
   * Sunucudaki `services/standingsResolver.js` ile AYNI kural, tarayıcı
   * tarafı için: yarışma kimliği çözülemiyorsa tablo GÖSTERİLMEZ. Buradaki
   * en tehlikeli davranış "bilinmiyorsa Süper Lig bas" olurdu — LaLiga
   * maçının altında Süper Lig tablosu çıkardı.
   */
  function resolveStandingsScope(detail, store) {
    var table = store && typeof store === "object" ? store : {};
    var id = String((detail && detail.competitionId) || "").trim();

    if (id && table[id]) return entryScope(id, table[id]);

    // Kimlik yoksa lig ADI ile eşleşme denenir; yalnızca TAM eşleşme kabul
    // edilir, "içinde geçiyorsa" değil ("Süper Lig" ile "Süper Lig U19"
    // birbirine karışmasın).
    var wanted = normalize(detail && detail.league);
    if (!wanted) return { status: "unavailable", reason: "unknown-competition", competitionId: id || null };

    var hit = Object.keys(table).filter(function (key) {
      return normalize(table[key] && table[key].league) === wanted;
    })[0];

    if (!hit) return { status: "unavailable", reason: "unknown-competition", competitionId: id || null };
    return entryScope(hit, table[hit]);
  }

  function entryScope(id, entry) {
    var rows = entry && Array.isArray(entry.table) ? entry.table : [];
    if (!rows.length) {
      return { status: "unavailable", reason: "no-data", competitionId: id, league: (entry && entry.league) || null };
    }
    return {
      status: "ok",
      reason: null,
      competitionId: id,
      league: entry.league || null,
      season: entry.season || null,
      updatedAt: entry.updatedAt || null,
      table: rows
    };
  }

  /**
   * "BU SKORLA PUAN DURUMU".
   *
   * Resmî tablo yalnızca BİTMİŞ maçları sayar ve saatte bir senkronlanır.
   * Bu işlev, açık olan maçın sonucunu tabloya GEÇİCİ olarak bindirir ve
   * her satırın kaç sıra oynadığını döner. Aritmetiğin tek sahibi
   * `services/liveStandings.js`: aynı hesabı burada ikinci kez yazmak,
   * iki tablonun zamanla ayrışması demekti.
   *
   * Çekirdek yüklenmediyse (betik gelmediyse) resmî tablo olduğu gibi
   * döner ve `applied: false` yazar — yüzey "geçici sıralama" iddiasında
   * bulunmaz.
   */
  function projectStandings(scope, detail, core) {
    var official = (scope && scope.status === "ok" && Array.isArray(scope.table)) ? scope.table : [];
    if (!official.length) return { rows: [], applied: false, reason: (scope && scope.reason) || "no-data" };

    var phase = phaseOf(detail);
    if (!core || typeof core.applyLiveMatches !== "function") {
      return { rows: official, applied: false, reason: "core-missing" };
    }
    if (phase !== "live" && phase !== "halftime" && phase !== "post") {
      return { rows: official, applied: false, reason: "not-played" };
    }
    if (!hasScore(detail)) {
      return { rows: official, applied: false, reason: "no-score" };
    }

    var merged = core.applyLiveMatches(official, [detail], {
      leagueIds: [scope.competitionId, scope.league, detail && detail.league].filter(Boolean)
    });

    if (!merged || !merged.appliedMatchIds || !merged.appliedMatchIds.length) {
      return {
        rows: official,
        applied: false,
        reason: (merged && merged.skipped && merged.skipped[0] && merged.skipped[0].reason) || "not-applied"
      };
    }

    return { rows: merged.rows, applied: true, reason: null };
  }

  /**
   * Tablonun okunabilir bir dilimi: maçın iki takımı ve çevresi.
   *
   * 20 satırlık bir tablo maç sayfasında yerinde durmuyor; okuyucunun
   * aradığı şey "bu iki takım şimdi nerede". Dilim iki takımı da MUTLAKA
   * içerir; zirve satırı da bağlam için eklenir.
   */
  function focusRows(rows, detail, padding) {
    var list = Array.isArray(rows) ? rows : [];
    if (!list.length) return [];
    var span = Number.isFinite(padding) ? padding : 1;

    var wanted = [normalize(detail && detail.homeTeam), normalize(detail && detail.awayTeam)].filter(Boolean);
    var indexes = [];
    list.forEach(function (row, index) {
      var name = normalize(row && (row.team || row.name));
      if (wanted.indexOf(name) !== -1) indexes.push(index);
    });

    if (!indexes.length) return list.slice(0, 6);

    var keep = Object.create(null);
    keep[0] = true;
    indexes.forEach(function (index) {
      for (var offset = -span; offset <= span; offset += 1) {
        var position = index + offset;
        if (position >= 0 && position < list.length) keep[position] = true;
      }
    });

    return Object.keys(keep).map(Number).sort(function (a, b) { return a - b; })
      .map(function (index) {
        var row = list[index];
        var name = normalize(row && (row.team || row.name));
        return Object.assign({}, row, {
          focus: wanted.indexOf(name) !== -1,
          side: normalize(detail && detail.homeTeam) === name
            ? "home"
            : (normalize(detail && detail.awayTeam) === name ? "away" : null)
        });
      });
  }

  /* ================================================================== */
  /* TAHMİN MERKEZİ                                                     */
  /* ================================================================== */

  /**
   * Maç öncesi tahmin — YALNIZCA SUNUCUNUN ÇÖZDÜĞÜ KAYITTAN.
   *
   * `api/match-detail.js#attachProbability` üç kaynaklı zinciri çözüp
   * `detail.probability` alanına yazıyor; çözülemeyen maçta alan `null`
   * kalıyor. İstemci burada İKİNCİ bir karar vermez: kayıt yoksa tahmin
   * yoktur. Form/momentum'dan yüzde türetmek tam olarak yasaklanan şey.
   */
  function preMatchPrediction(detail) {
    var record = detail && detail.probability;
    if (!record) return null;

    var home = statNumber(record.home);
    var draw = statNumber(record.draw);
    var away = statNumber(record.away);
    if (home === null || draw === null || away === null) return null;

    var total = home + draw + away;
    if (!(total > 0)) return null;

    var percents = roundToHundred([
      (home / total) * 100,
      (draw / total) * 100,
      (away / total) * 100
    ]);

    return {
      home: percents[0],
      draw: percents[1],
      away: percents[2],
      source: record.source || null,
      title: record.title || "Maç öncesi tahmin",
      note: record.note || null,
      icon: record.icon || null,
      advice: record.advice || null,
      // VERİ TEMELİ DE GEÇER. FutbolRadar modeli, takım geçmişi olmadan
      // turnuvanın taban oranlarıyla da çalışabiliyor
      // (services/fixtureProbabilityModel.js → DATA_BASIS). O yüzdeyi
      // dayanağını söylemeden göstermek, okuyucunun ona takım
      // karşılaştırması diye bakmasına yol açar.
      dataBasis: record.dataBasis || null,
      basisNote: record.basisNote || null,
      predictedWinner: record.predictedWinner || null,
      calculatedAt: record.calculatedAt || null
    };
  }

  /**
   * Canlı kazanma olasılığı — SOKET BOŞSA HİÇBİR ŞEY.
   *
   * `services/winProbability.js` bilerek boş bir soket: depoda maç İÇİ
   * olasılık üretebilen doğrulanmış bir model yok. Maç öncesi yüzdeyi
   * 80. dakikada "canlı" diye göstermek, sayının gerçek ama iddianın
   * yalan olduğu bir durum yaratırdı. Sunucu gerçek bir kaynak takarsa
   * alan dolar ve bölüm kendiliğinden açılır.
   */
  function liveWinProbability(detail) {
    var record = detail && detail.liveWinProbability;
    if (!record) return null;
    var home = statNumber(record.home);
    var draw = statNumber(record.draw);
    var away = statNumber(record.away);
    if (home === null || draw === null || away === null) return null;
    if ([home, draw, away].some(function (value) { return value < 0 || value > 100; })) return null;
    if (Math.abs(home + draw + away - 100) > 1.5) return null;
    if (!record.source) return null;

    return {
      home: Math.round(home),
      draw: Math.round(draw),
      away: Math.round(away),
      source: record.source,
      asOf: record.asOf || null
    };
  }

  /** Yuvarlama sonrası toplam tam 100 olsun; sapma en büyük paya yazılır. */
  function roundToHundred(values) {
    var rounded = values.map(function (value) { return Math.round(value); });
    var drift = 100 - rounded.reduce(function (total, value) { return total + value; }, 0);
    if (drift !== 0) {
      var largest = 0;
      for (var index = 1; index < rounded.length; index += 1) {
        if (rounded[index] > rounded[largest]) largest = index;
      }
      rounded[largest] += drift;
    }
    return rounded;
  }

  /* ================================================================== */
  /* HANGİ KANALDA?                                                     */
  /* ================================================================== */

  /**
   * Yayın bilgisi.
   *
   * Kanal yoksa `state: "unannounced"` döner — yüzey "henüz açıklanmadı"
   * yazar. Bir yayıncı adı TAHMİN EDİLMEZ: "Süper Lig maçıysa beIN
   * Sports'tur" çıkarımı, yayın haklarının sezon içinde değiştiği bir
   * alanda okuyucuyu yanlış kanala gönderir.
   */
  function broadcastInfo(detail) {
    var raw = detail && detail.broadcast;
    var value = typeof raw === "string" ? raw : (raw && (raw.turkey || raw.tr)) || "";
    var text = String(value || "").trim();

    if (!text || normalize(text) === "aciklanmadi" || normalize(text) === "belirsiz") {
      return { state: "unannounced", channels: [], sourceUrl: null, verifiedAt: null };
    }

    var channels = text.split(/\s*[\/,&]\s*|\s+ve\s+/).map(function (part) {
      return part.trim();
    }).filter(Boolean);

    return {
      state: "known",
      channels: channels.length ? channels : [text],
      sourceUrl: (detail && detail.broadcastSourceUrl) || null,
      verifiedAt: (detail && detail.broadcastVerifiedAt) || null
    };
  }

  /* ================================================================== */
  /* İLİŞKİLİ HABERLER                                                  */
  /* ================================================================== */

  /** Haberin maça bağlanabilmesi için geçerli olduğu pencere. */
  var NEWS_WINDOW_BEFORE_MS = 10 * 24 * 60 * 60 * 1000;
  var NEWS_WINDOW_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

  function newsHaystack(item) {
    return normalize([
      item && item.title,
      item && item.summary,
      item && item.team,
      item && item.category,
      Array.isArray(item && item.tags) ? item.tags.join(" ") : ""
    ].filter(Boolean).join(" "));
  }

  /**
   * Maçla ilişkili haberler.
   *
   * BAĞ KURULAMAYAN HABER LİSTELENMEZ. Eşleşme ölçütü takım adının haber
   * metninde geçmesi; yalnızca lig adının geçmesi TEK BAŞINA yetmez —
   * "Süper Lig" diyen her haberi her Süper Lig maçının altına koymak,
   * ilişkili haber değil doldurma olurdu.
   */
  function relatedNews(detail, news, options) {
    var list = Array.isArray(news) ? news : (news && Array.isArray(news.items) ? news.items : []);
    if (!list.length || !detail) return [];

    var settings = options || {};
    var limit = Number.isFinite(settings.limit) ? settings.limit : 6;
    var kickoff = Date.parse((detail && detail.kickoff) || "");
    var home = normalize(detail.homeTeam);
    var away = normalize(detail.awayTeam);
    var league = normalize(detail.league);
    if (!home && !away) return [];

    var scored = [];
    list.forEach(function (item) {
      if (!item || !item.title) return;
      if (item.status && String(item.status).toLowerCase() === "draft") return;

      var haystack = newsHaystack(item);
      var hitsHome = Boolean(home) && haystack.indexOf(home) !== -1;
      var hitsAway = Boolean(away) && haystack.indexOf(away) !== -1;
      if (!hitsHome && !hitsAway) return;

      var published = Date.parse(item.publishedAt || "");
      if (Number.isFinite(kickoff) && Number.isFinite(published)) {
        var delta = published - kickoff;
        if (delta < -NEWS_WINDOW_BEFORE_MS || delta > NEWS_WINDOW_AFTER_MS) return;
      }

      var score = 0;
      if (hitsHome && hitsAway) score += 6;      // İki takımı da anan haber maçın kendisidir.
      else score += 3;
      if (league && haystack.indexOf(league) !== -1) score += 1;
      if (Number.isFinite(published)) score += 1;

      scored.push({
        score: score,
        publishedAt: item.publishedAt || null,
        publishedMs: Number.isFinite(published) ? published : 0,
        title: item.title,
        summary: item.summary || item.spot || null,
        slug: item.slug || null,
        url: item.url || null,
        sourceName: item.sourceName || null,
        both: hitsHome && hitsAway
      });
    });

    scored.sort(function (left, right) {
      if (right.score !== left.score) return right.score - left.score;
      return right.publishedMs - left.publishedMs;
    });

    return scored.slice(0, limit);
  }

  /* ================================================================== */
  /* MAÇ SONU ÖZETİ                                                     */
  /* ================================================================== */

  /**
   * Maç bitince açılan otomatik özet.
   *
   * Bitmemiş maçta `null` döner: "özet" bir SONUÇ iddiasıdır. Puan etkisi
   * yalnızca tablo çözülebildiyse yazılır; sonraki maçlar yalnızca gerçek
   * fikstür kaydı verildiyse listelenir.
   */
  function postMatchSummary(detail, extras) {
    if (phaseOf(detail) !== "post") return null;

    var context = extras || {};
    var timeline = Array.isArray(context.timeline) ? context.timeline : buildTimeline(detail);
    var keyEvents = timeline.filter(function (item) { return item.key; });

    return {
      finalScore: scoreText(detail),
      halftime: halftimeText(detail),
      winner: winnerOf(detail),
      keyEvents: keyEvents,
      goals: timeline.filter(function (item) { return scoresGoal(item.kind); }),
      cards: timeline.filter(function (item) {
        return item.kind === "red" || item.kind === "second-yellow" || item.kind === "yellow";
      }),
      pointsImpact: pointsImpact(detail, context.standings),
      nextMatches: nextMatches(detail, context.fixtures, context.now)
    };
  }

  function winnerOf(detail) {
    if (!hasScore(detail)) return null;
    var home = Number(detail.score.home);
    var away = Number(detail.score.away);
    if (home === away) return { side: "draw", team: null };
    return home > away
      ? { side: "home", team: detail.homeTeam }
      : { side: "away", team: detail.awayTeam };
  }

  /**
   * Maçın puan etkisi: her takım kaç puan aldı, tabloda nereye oturdu.
   *
   * Tablo çözülemediyse `null` döner — "3 puan aldı, 4. sıraya çıktı"
   * cümlesindeki ikinci yarı ölçüme dayanır, tahmine değil.
   */
  function pointsImpact(detail, projection) {
    if (!hasScore(detail)) return null;
    var home = Number(detail.score.home);
    var away = Number(detail.score.away);
    var gained = home === away ? [1, 1] : (home > away ? [3, 0] : [0, 3]);

    var result = {
      home: { team: detail.homeTeam, points: gained[0], rank: null, rankChange: null },
      away: { team: detail.awayTeam, points: gained[1], rank: null, rankChange: null },
      ranked: false
    };

    var rows = projection && Array.isArray(projection.rows) ? projection.rows : [];
    if (!projection || !projection.applied || !rows.length) return result;

    ["home", "away"].forEach(function (side) {
      var wanted = normalize(detail[side + "Team"]);
      var row = rows.filter(function (entry) { return normalize(entry && (entry.team || entry.name)) === wanted; })[0];
      if (!row) return;
      result[side].rank = row.rank !== undefined ? row.rank : null;
      result[side].rankChange = row.rankChange !== undefined ? row.rankChange : null;
      result.ranked = true;
    });

    return result;
  }

  /**
   * İki takımın bu maçtan SONRAKİ ilk maçları. Fikstür verilmediyse boş
   * döner; "muhtemelen hafta sonu oynar" diye bir kayıt üretilmez.
   */
  function nextMatches(detail, fixtures, now) {
    var list = Array.isArray(fixtures) ? fixtures : [];
    if (!list.length || !detail) return [];

    var after = Number.isFinite(now) ? now : Date.parse(detail.kickoff || "") || Date.now();
    var teams = [
      { side: "home", name: detail.homeTeam },
      { side: "away", name: detail.awayTeam }
    ];

    return teams.map(function (entry) {
      var wanted = normalize(entry.name);
      if (!wanted) return null;

      var candidates = list.filter(function (item) {
        if (!item || String(item.id || "") === String(detail.id || "")) return false;
        var kickoff = Date.parse(item.kickoff || "");
        if (!Number.isFinite(kickoff) || kickoff <= after) return false;
        return normalize(item.homeTeam) === wanted || normalize(item.awayTeam) === wanted;
      }).sort(function (left, right) {
        return Date.parse(left.kickoff) - Date.parse(right.kickoff);
      });

      var next = candidates[0];
      if (!next) return null;

      return {
        side: entry.side,
        team: entry.name,
        opponent: normalize(next.homeTeam) === wanted ? next.awayTeam : next.homeTeam,
        home: normalize(next.homeTeam) === wanted,
        kickoff: next.kickoff,
        league: next.league || null,
        id: next.id || null,
        analysisPage: next.analysisPage || null
      };
    }).filter(Boolean);
  }

  /* ================================================================== */
  /* PAYLAŞILABİLİR MAÇ KARTLARI                                        */
  /* ================================================================== */

  /**
   * Paylaşılabilir kart MODELLERİ — çizim ve indirme yüzeyde.
   *
   * SOSYAL PAYLAŞIM DÜĞMESİ VE KULLANICI YORUMU KAPSAM DIŞI (istenmedi).
   * Burada üretilen şey yalnızca kartın İÇERİĞİ: kart ancak dayandığı veri
   * gerçekten varsa açılır — ilk 11 kartı kadro yayımlanmadan, maç sonu
   * kartı maç bitmeden üretilmez.
   */
  function shareCards(detail, extras) {
    if (!detail) return [];
    var context = extras || {};
    var timeline = Array.isArray(context.timeline) ? context.timeline : buildTimeline(detail);
    var phase = phaseOf(detail);
    var cards = [];

    var sides = lineupSides(detail);
    if (sides.length) {
      cards.push({
        kind: "lineup",
        title: "İlk 11",
        subtitle: [detail.homeTeam, detail.awayTeam].filter(Boolean).join(" - "),
        meta: sides.map(function (group) {
          return { team: group.team, formation: group.formation, players: group.starters.slice(0, 11) };
        })
      });
    }

    var goals = timeline.filter(function (item) { return scoresGoal(item.kind); });
    if (goals.length) {
      var last = goals[goals.length - 1];
      cards.push({
        kind: "goal",
        title: last.kind === "own-goal" ? "Kendi kalesine" : "Gol",
        subtitle: [last.minute, last.team].filter(Boolean).join(" · "),
        meta: {
          minute: last.minute,
          team: last.team,
          text: last.text,
          score: last.score || scoreText(detail)
        }
      });
    }

    if (phase === "post" && hasScore(detail)) {
      cards.push({
        kind: "fulltime",
        title: "Maç sonucu",
        // Altyazı takımları söyler, skoru DEĞİL: skor kartın gövdesinde
        // zaten büyük punto duruyordu; ikisi aynı olunca kart "3-0 / 3-0"
        // diyor ve kimin oynadığını hiç söylemiyordu.
        subtitle: [detail.homeTeam, detail.awayTeam].filter(Boolean).join(" - "),
        meta: {
          home: detail.homeTeam,
          away: detail.awayTeam,
          score: scoreText(detail),
          halftime: halftimeText(detail),
          league: detail.league || null,
          goals: goals.map(function (item) {
            return { minute: item.minute, text: item.text, team: item.team };
          })
        }
      });
    }

    return cards;
  }

  /* ================================================================== */
  /* SEO                                                                */
  /* ================================================================== */

  function titleOf(detail) {
    return [detail && detail.homeTeam, detail && detail.awayTeam].filter(Boolean).join(" - ");
  }

  /**
   * Sayfanın başlığı ve açıklaması, maçın evresine göre.
   *
   * Aranan şey evreye göre değişiyor: maç öncesi "ne zaman, hangi kanalda",
   * maç sırasında "canlı skor", maç sonrası "maç sonucu, özet". Tek sabit
   * başlık bu üç niyetin hiçbirini tam karşılamıyordu.
   */
  function seoMeta(detail, options) {
    if (!detail) return null;
    var settings = options || {};
    var pair = titleOf(detail);
    if (!pair) return null;

    var phase = phaseOf(detail);
    var score = scoreText(detail);
    var league = detail.league ? String(detail.league) : "";
    var suffix = settings.brand || "FutbolRadar";

    if (phase === "post" && score) {
      return {
        title: pair + " maç sonucu " + score.replace(/\s/g, "") + " | Özet ve İstatistik | " + suffix,
        description: pair + " maçı " + score + " sona erdi. Goller, kartlar, oyuncu değişiklikleri, " +
          "maç istatistikleri, puan durumu etkisi ve maç sonu özeti " + suffix + "'da."
      };
    }

    if (isLivePhase(phase)) {
      var minute = minuteText(detail);
      return {
        title: pair + " CANLI" + (score ? " " + score.replace(/\s/g, "") : "") + " | Canlı Skor ve İstatistik | " + suffix,
        description: pair + " maçı canlı" + (minute ? " (" + minute + ")" : "") + ". Anlık skor, maç olayları, " +
          "canlı istatistikler, kadrolar ve puan durumuna etkisi " + suffix + "'da."
      };
    }

    return {
      title: pair + (league ? " " + league : "") + " maçı | Ne Zaman, Hangi Kanalda, Muhtemel 11 | " + suffix,
      description: pair + " maçı hakkında bilmen gereken her şey: başlama saati, yayın kanalı, muhtemel 11'ler, " +
        "puan durumu, form ve maç öncesi tahminler " + suffix + "'da."
    };
  }

  /**
   * SportsEvent yapılandırılmış verisi.
   *
   * Yalnızca KAYITLI alanlar yazılır: stadyum yoksa `location` hiç
   * eklenmez. Şemaya boş ya da uydurma bir alan yazmak, arama motoruna
   * doğrulanamayan bir veri bildirmek demektir.
   */
  function structuredData(detail, options) {
    if (!detail) return null;
    var pair = titleOf(detail);
    if (!pair || !detail.kickoff) return null;

    var settings = options || {};
    var phase = phaseOf(detail);
    var meta = seoMeta(detail, settings);

    var statusUrl = "https://schema.org/EventScheduled";
    if (phase === "unplayed") {
      statusUrl = statusCodeOf(detail).indexOf("CANC") === 0
        ? "https://schema.org/EventCancelled"
        : "https://schema.org/EventPostponed";
    }

    var node = {
      "@context": "https://schema.org",
      "@type": "SportsEvent",
      name: pair + (detail.league ? " - " + detail.league : ""),
      sport: "Football",
      startDate: detail.kickoff,
      eventStatus: statusUrl,
      eventAttendanceMode: "https://schema.org/OfflineEventAttendance",
      homeTeam: { "@type": "SportsTeam", name: detail.homeTeam },
      awayTeam: { "@type": "SportsTeam", name: detail.awayTeam },
      competitor: [
        { "@type": "SportsTeam", name: detail.homeTeam },
        { "@type": "SportsTeam", name: detail.awayTeam }
      ]
    };

    if (meta && meta.description) node.description = meta.description;
    if (settings.url) {
      node.url = settings.url;
      node["@id"] = settings.url + "#event";
    }
    if (detail.venue) {
      node.location = { "@type": "StadiumOrArena", name: detail.venue };
      if (detail.city) {
        node.location.address = { "@type": "PostalAddress", addressLocality: detail.city };
      }
    }
    if (detail.league) {
      node.superEvent = { "@type": "SportsEvent", name: detail.league };
    }

    var broadcast = broadcastInfo(detail);
    if (broadcast.state === "known") {
      node.broadcastOfEvent = broadcast.channels.map(function (channel) {
        return { "@type": "BroadcastService", name: channel };
      });
    }

    return node;
  }

  /* ================================================================== */

  return {
    EVENT_LABELS: EVENT_LABELS,
    FINISHED_CODES: FINISHED_CODES,
    HALFTIME_CODES: HALFTIME_CODES,
    KEY_KINDS: KEY_KINDS,
    LIVE_CODES: LIVE_CODES,
    PRIMARY_STATS: PRIMARY_STATS,
    UNPLAYED_CODES: UNPLAYED_CODES,
    broadcastInfo: broadcastInfo,
    buildTimeline: buildTimeline,
    classifyEvent: classifyEvent,
    focusRows: focusRows,
    formationRows: formationRows,
    groupStatRows: groupStatRows,
    halftimeText: halftimeText,
    hasScore: hasScore,
    isLivePhase: isLivePhase,
    latestEventIndex: latestEventIndex,
    lineupSides: lineupSides,
    liveWinProbability: liveWinProbability,
    minuteText: minuteText,
    nextMatches: nextMatches,
    normalize: normalize,
    phaseOf: phaseOf,
    pointsImpact: pointsImpact,
    postMatchSummary: postMatchSummary,
    preMatchPrediction: preMatchPrediction,
    primaryStatRows: primaryStatRows,
    projectStandings: projectStandings,
    relatedNews: relatedNews,
    resolveStandingsScope: resolveStandingsScope,
    scoreText: scoreText,
    scoresGoal: scoresGoal,
    scoringSide: scoringSide,
    seoMeta: seoMeta,
    shareCards: shareCards,
    sideOf: sideOf,
    statDirection: statDirection,
    statRows: statRows,
    statusCodeOf: statusCodeOf,
    structuredData: structuredData,
    winnerOf: winnerOf
  };
});
