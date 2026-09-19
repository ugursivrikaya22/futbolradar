/* ÜRETİLMİŞ DOSYA — kaynak: services/matchCenterPlus.js. Elle düzenlemeyin;
   `node scripts/build-match-center-plus-client.mjs` ile yeniden üretilir. */
/**
 * MAÇ MERKEZİ ZENGİNLEŞTİRME ÇEKİRDEĞİ — TEK TANIM, İKİ ÇALIŞMA ORTAMI.
 * ----------------------------------------------------------------------------
 * `mac/<slug>` ve `en/match/<slug>` sayfalarını "FutbolRadar Maç Merkezi"ne
 * çeviren YENİ bölümlerin KARARLARI burada duruyor:
 *
 *   • saha üzerinde ilk 11 (diziliş satırları)
 *   • oyuncu maç puanları ve "Maçın Oyuncusu"
 *   • xG (takım bazında ve — veri varsa — dakika dakika)
 *   • şut haritası
 *   • yarı yarıya ayrılmış maç zaman çizgisi
 *   • genişletilmiş takım istatistikleri
 *   • ısı haritaları
 *   • ölçülmüş istatistikten üretilen otomatik maç yorumu
 *
 * Çizim YOK: bu dosya DOM'a dokunmaz, `fetch` çağırmaz, Node'a özel bir şey
 * istemez (UMD). Böylece `scripts/test-match-center-plus.mjs` içinde Node'da
 * ve tarayıcıda AYNI kod koşar. Tarayıcı kopyası
 * `scripts/build-match-center-plus-client.mjs` ile bu dosyadan ÜRETİLİR —
 * eşi: `services/matchHub.js` → `match-hub-core.js`.
 *
 * DEĞİŞMEYEN KURAL: EKSİK VERİ UYDURULMAZ.
 *   • Sağlayıcı maç puanı vermediyse puan HESAPLANMAZ; bölüm hiç açılmaz.
 *     "Maçın Oyuncusu" ancak GERÇEK derecelerden çıkar.
 *   • xG yoksa xG kutusu yoktur. Anlamsız değer (negatif, 25'ten büyük)
 *     ölçüm sayılmaz ve elenir.
 *   • Şut koordinatı yoksa şut haritası çizilmez — "ortalama bir yere"
 *     nokta konmaz.
 *   • Isı haritası verisi yoksa bölüm gizlenir.
 *   • Otomatik yorum yalnızca ÖLÇÜLMÜŞ sayılardan cümle kurar; sayı yoksa
 *     cümle de yoktur.
 *   • `null`/`undefined`/`NaN` hiçbir yüzeye sızmaz: her değer
 *     `measured()` kapısından geçer.
 *
 * DİZİLİŞ VE İSTATİSTİK ÇEKİRDEĞİ YENİDEN YAZILMADI. `services/matchHub.js`
 * bu iki kararı (saha satırları, çizilebilir istatistik satırı) zaten
 * veriyor ve testleri var. Bağımlılık enjeksiyonla kuruluyor
 * (`attachHub`), çünkü üretilen tarayıcı kopyasında `require` yolu yok.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FutbolRadarMatchCenterPlus = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ================================================================== */
  /* 0. ORTAK YARDIMCILAR                                               */
  /* ================================================================== */

  /** `services/matchHub.js` API'si; `attachHub` ile takılır. */
  var hub = null;

  function attachHub(value) {
    hub = value && typeof value === "object" ? value : null;
    return hub;
  }

  function normalize(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ı/g, "i")
      .replace(/İ/g, "i")
      .trim()
      .toLowerCase();
  }

  /**
   * ÖLÇÜLMÜŞ SAYI KAPISI.
   *
   * `Number(null) === 0` olduğu için ham `Number.isFinite` yetmez:
   * sağlayıcının "ölçmedim" dediği alan sıfır olarak yüzeye çıkardı.
   * Boş dize, `null`, `undefined` ve `NaN` burada elenir.
   */
  function measured(value) {
    if (value === null || value === undefined || value === "") return null;
    var parsed = typeof value === "number" ? value : Number(String(value).replace("%", "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Yüzeye basılabilir mi? `null`, `undefined`, `NaN`, boş dize: hayır. */
  function isDisplayable(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "number") return Number.isFinite(value);
    var text = String(value).trim();
    if (!text) return false;
    return !/^(null|undefined|nan)$/i.test(text);
  }

  function teamNameOf(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    return String(value.name || "").trim();
  }

  /**
   * Oyuncu adı eşleştirme: "E. Huuhtanen" ↔ "Eetu Huuhtanen".
   *
   * Sağlayıcı AYNI maçta iki farklı yazım gönderiyor: diziliş listesi kısa
   * ad ("O. Çevikkan"), oyuncu istatistiği tam ad ("Onuralp Çevikkan").
   * Tam dize karşılaştırması bu yüzden HİÇBİR oyuncuyu eşleştiremiyordu ve
   * puanlar sahaya hiç oturmazdı.
   *
   * Kural: SOYADI aynı olacak; ilk harf ikisinde de varsa o da tutacak.
   * Yalnızca soyadı üzerinden eşleşmeye izin vermek, aynı soyadlı iki
   * oyuncuda yanlış puan basardı — bu yüzden ilk harf bilgisi varsa
   * bağlayıcıdır.
   */
  function nameParts(value) {
    var tokens = normalize(value).replace(/\./g, " ").split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    return { first: tokens[0], last: tokens[tokens.length - 1], tokens: tokens };
  }

  function samePlayer(left, right) {
    var a = nameParts(left);
    var b = nameParts(right);
    if (!a || !b) return false;
    if (a.tokens.join(" ") === b.tokens.join(" ")) return true;
    if (a.last !== b.last) return false;
    // Tek kelimelik adlarda (takma ad: "Fabinho") soyadı eşleşmesi yeterli.
    if (a.tokens.length === 1 || b.tokens.length === 1) return true;
    return a.first.charAt(0) === b.first.charAt(0);
  }

  /* ================================================================== */
  /* 1. DURUM — "CANLI MAÇTA BAŞLAMADI YAZMASIN"                        */
  /* ================================================================== */

  var LIVE_CODES = ["1H", "2H", "LIVE", "IN_PLAY", "INT", "SUSP"];
  var HALFTIME_CODES = ["HT", "HALFTIME", "BT", "PAUSED"];
  var EXTRA_CODES = ["ET", "AET_LIVE"];
  var PENALTY_CODES = ["P", "PEN_LIVE"];
  var FINISHED_CODES = ["FT", "AET", "PEN", "FINISHED", "AWARDED", "AWD", "WO"];
  var UNPLAYED_CODES = ["PST", "POSTPONED", "CANC", "CANCELLED", "ABD", "ABANDONED", "TBD"];

  /**
   * Maçın evresi: `scheduled | first-half | halftime | second-half |
   * extra-time | penalties | finished | unplayed`.
   *
   * SKOR KAPISI BURADA DA GEÇERLİ: sağlayıcı "canlı" deyip skor
   * göndermiyorsa evre "scheduled" kalır. Skorsuz bir canlı iddiası,
   * okuyucuya oynanmakta olan bir maçın varlığını bildirip sayısını
   * saklamaktır.
   */
  function phaseOf(detail) {
    var code = String((detail && (detail.providerStatus || detail.status)) || "").trim().toUpperCase();
    if (!code) return "scheduled";
    if (UNPLAYED_CODES.indexOf(code) !== -1) return "unplayed";
    if (FINISHED_CODES.indexOf(code) !== -1) return "finished";

    var score = detail && detail.score;
    var hasScore = !!score && measured(score.home) !== null && measured(score.away) !== null;
    if (!hasScore) return "scheduled";

    if (HALFTIME_CODES.indexOf(code) !== -1) return "halftime";
    if (PENALTY_CODES.indexOf(code) !== -1) return "penalties";
    if (EXTRA_CODES.indexOf(code) !== -1) return "extra-time";
    if (LIVE_CODES.indexOf(code) !== -1) {
      if (code === "1H") return "first-half";
      if (code === "2H") return "second-half";
      var minute = measured(detail.minute);
      if (minute !== null) return minute <= 45 ? "first-half" : "second-half";
      return "second-half";
    }
    return "scheduled";
  }

  function isLivePhase(phase) {
    return ["first-half", "halftime", "second-half", "extra-time", "penalties"].indexOf(phase) !== -1;
  }

  /* ================================================================== */
  /* 2. METİNLER — TÜRKÇE / İNGİLİZCE                                   */
  /* ================================================================== */

  var STR = {
    tr: {
      phase: {
        scheduled: "Başlamadı",
        "first-half": "İlk yarı",
        halftime: "Devre arası",
        "second-half": "İkinci yarı",
        "extra-time": "Uzatma",
        penalties: "Penaltılar",
        finished: "Bitti",
        unplayed: "Oynanmadı"
      },
      half: { first: "İlk yarı", second: "İkinci yarı", extra: "Uzatma", penalties: "Penaltılar" },
      event: {
        goal: "Gol",
        "own-goal": "Kendi kalesine",
        penalty: "Penaltı golü",
        "missed-penalty": "Kaçan penaltı",
        yellow: "Sarı kart",
        red: "Kırmızı kart",
        "yellow-red": "İkinci sarıdan kırmızı",
        sub: "Oyuncu değişikliği",
        var: "VAR",
        note: "Maç olayı"
      },
      assist: "Asist",
      on: "giriyor",
      off: "çıkıyor",
      shot: { goal: "Gol", on: "Kaleyi bulan şut", off: "Dışarı giden şut", blocked: "Bloklanan şut" },
      xg: "Gol beklentisi (xG)",
      rating: "Maç puanı",
      motm: "FutbolRadar Maçın Oyuncusu",
      possession: "Topla oynama",
      shots: "şut",
      onTarget: "isabetli şut",
      corners: "korner",
      boxEntries: "ceza sahasına giriş",
      commentary: {
        possession: function (team, value) { return team + " topla %" + value + " oynadı."; },
        shots: function (team, total, on) {
          return on === null
            ? team + " maç boyunca " + total + " şut çekti."
            : team + " " + total + " şut çekti, bunların " + on + " tanesi kaleyi buldu.";
        },
        xg: function (home, homeXg, away, awayXg) {
          return "Gol beklentisi (xG) " + home + " için " + homeXg + ", " + away + " için " + awayXg + ".";
        },
        xgOver: function (team, goals, xg) {
          return team + " " + xg + " xG üretip " + goals + " gol buldu; beklentinin üzerinde bir isabet.";
        },
        xgUnder: function (team, goals, xg) {
          return team + " " + xg + " xG üretmesine rağmen " + goals + " golde kaldı.";
        },
        corners: function (team, value) { return team + " " + value + " korner kullandı."; },
        passes: function (team, total, accuracy) { return team + " " + total + " pas denedi ve %" + accuracy + " isabet tutturdu."; },
        cards: function (team, yellow, red) {
          return red > 0
            ? team + " " + yellow + " sarı ve " + red + " kırmızı kart gördü."
            : team + " " + yellow + " sarı kart gördü.";
        },
        bigChances: function (team, value) { return team + " " + value + " büyük fırsat yakaladı."; },
        motm: function (name, rating) { return name + " " + rating + " maç puanıyla sahanın en yüksek notunu aldı."; }
      }
    },
    en: {
      phase: {
        scheduled: "Not started",
        "first-half": "First half",
        halftime: "Half time",
        "second-half": "Second half",
        "extra-time": "Extra time",
        penalties: "Penalties",
        finished: "Full time",
        unplayed: "Not played"
      },
      half: { first: "First half", second: "Second half", extra: "Extra time", penalties: "Penalties" },
      event: {
        goal: "Goal",
        "own-goal": "Own goal",
        penalty: "Penalty goal",
        "missed-penalty": "Missed penalty",
        yellow: "Yellow card",
        red: "Red card",
        "yellow-red": "Second yellow",
        sub: "Substitution",
        var: "VAR",
        note: "Match event"
      },
      assist: "Assist",
      on: "on",
      off: "off",
      shot: { goal: "Goal", on: "Shot on target", off: "Shot off target", blocked: "Blocked shot" },
      xg: "Expected goals (xG)",
      rating: "Match rating",
      motm: "FutbolRadar Player of the Match",
      possession: "Possession",
      shots: "shots",
      onTarget: "shots on target",
      corners: "corners",
      boxEntries: "penalty box entries",
      commentary: {
        possession: function (team, value) { return team + " held " + value + "% of the ball."; },
        shots: function (team, total, on) {
          return on === null
            ? team + " took " + total + " shots."
            : team + " took " + total + " shots, " + on + " of them on target.";
        },
        xg: function (home, homeXg, away, awayXg) {
          return "Expected goals (xG): " + home + " " + homeXg + ", " + away + " " + awayXg + ".";
        },
        xgOver: function (team, goals, xg) {
          return team + " scored " + goals + " from " + xg + " xG — above expectation.";
        },
        xgUnder: function (team, goals, xg) {
          return team + " created " + xg + " xG but scored only " + goals + ".";
        },
        corners: function (team, value) { return team + " won " + value + " corners."; },
        passes: function (team, total, accuracy) { return team + " attempted " + total + " passes at " + accuracy + "% accuracy."; },
        cards: function (team, yellow, red) {
          return red > 0
            ? team + " picked up " + yellow + " yellow and " + red + " red cards."
            : team + " picked up " + yellow + " yellow cards.";
        },
        bigChances: function (team, value) { return team + " created " + value + " big chances."; },
        motm: function (name, rating) { return name + " earned the highest match rating on the pitch with " + rating + "."; }
      }
    }
  };

  function textFor(locale) {
    return STR[String(locale || "").toLowerCase() === "en" ? "en" : "tr"];
  }

  /**
   * İSTATİSTİK ADI SÖZLÜĞÜ. Sağlayıcı yanıtı kanonik TÜRKÇE ada çevrilerek
   * saklanıyor (bkz. services/statNormalization.js); İNGİLİZCE sayfada o
   * Türkçe adın basılması "İngilizce sayfada Türkçe metin" demekti.
   */
  var STAT_EN = {
    "topla oynama": "Possession",
    "toplam sut": "Total shots",
    "isabetli sut": "Shots on target",
    "isabetsiz sut": "Shots off target",
    "engellenen sut": "Blocked shots",
    "ceza sahasi icinden sut": "Shots inside box",
    "ceza sahasi disindan sut": "Shots outside box",
    "buyuk firsat": "Big chances",
    "buyuk firsatlar": "Big chances",
    "kacirilan buyuk firsat": "Big chances missed",
    korner: "Corners",
    ofsayt: "Offsides",
    faul: "Fouls",
    "sari kart": "Yellow cards",
    "kirmizi kart": "Red cards",
    "toplam pas": "Total passes",
    "isabetli pas": "Accurate passes",
    "pas isabeti": "Pass accuracy",
    "ceza sahasina giris": "Penalty box entries",
    kurtaris: "Saves",
    "gol beklentisi (xg)": "Expected goals (xG)",
    "basarili dribling": "Successful dribbles",
    "kazanilan ikili mucadele": "Duels won",
    hata: "Errors",
    "kacan penalti": "Missed penalties"
  };

  var CATEGORY_EN = {
    genel: "General",
    hucum: "Attack",
    savunma: "Defence",
    pas: "Passing",
    disiplin: "Discipline",
    beklenti: "Expected"
  };

  function statLabel(type, locale) {
    if (String(locale || "").toLowerCase() !== "en") return String(type || "");
    return STAT_EN[normalize(type)] || String(type || "");
  }

  function categoryLabel(category, locale) {
    if (String(locale || "").toLowerCase() !== "en") return String(category || "");
    return CATEGORY_EN[normalize(category)] || String(category || "");
  }

  /* ================================================================== */
  /* 3. SAHA ÜZERİNDE İLK 11                                            */
  /* ================================================================== */

  /**
   * Sağlayıcı oyuncu kimliği → resmî görsel adresi.
   *
   * Kimlik YOKSA adres de yok: uydurma bir kimlikten kurulan adres 404
   * döner ve kartta kırık görsel bırakırdı. Yüzey, adres yokken baş
   * harflere düşer.
   */
  function playerPhoto(providerPlayerId) {
    var id = String(providerPlayerId == null ? "" : providerPlayerId).trim();
    if (!/^\d+$/.test(id)) return null;
    return "https://media.api-sports.io/football/players/" + id + ".png";
  }

  /**
   * Maç bazında oyuncu istatistiği sicili — ad eşleştirmesi için hazır.
   * `detail.players` sağlayıcının `/fixtures/players` yanıtından geliyor
   * (bkz. apiFootballProvider#normalizeFixturePlayers).
   */
  function playerStatIndex(detail) {
    var rows = Array.isArray(detail && detail.players) ? detail.players : [];
    return rows.filter(function (row) { return row && row.name; }).map(function (row) {
      return {
        name: String(row.name),
        team: teamNameOf(row.team),
        providerPlayerId: row.providerPlayerId || null,
        rating: measured(row.providerRating !== undefined ? row.providerRating : row.matchRating),
        ratingSource: row.ratingSource || row.source || null,
        minutes: measured(row.minutes),
        goals: measured(row.goals),
        assists: measured(row.assists),
        shots: measured(row.shots),
        shotsOnTarget: measured(row.shotsOnTarget),
        passes: measured(row.passes),
        passAccuracy: measured(row.passAccuracy),
        keyPasses: measured(row.keyPasses),
        tackles: measured(row.tackles),
        duelsWon: measured(row.duelsWon),
        saves: measured(row.saves),
        yellowCards: measured(row.yellowCards),
        redCards: measured(row.redCards),
        position: isDisplayable(row.position) ? String(row.position) : null,
        heatmap: Array.isArray(row.heatmap) ? row.heatmap : null
      };
    });
  }

  function findStatRow(index, name, team) {
    var sameTeam = index.filter(function (row) { return !team || !row.team || normalize(row.team) === normalize(team); });
    var pool = sameTeam.length ? sameTeam : index;
    for (var i = 0; i < pool.length; i += 1) {
      if (samePlayer(pool[i].name, name)) return pool[i];
    }
    return null;
  }

  /** Sağlayıcının mevki kodu → okunabilir etiket. Kod yoksa etiket de yok. */
  var POSITION_LABEL = {
    tr: { G: "Kaleci", D: "Defans", M: "Orta saha", F: "Forvet" },
    en: { G: "Goalkeeper", D: "Defender", M: "Midfielder", F: "Forward" }
  };

  function positionLabel(code, locale) {
    var key = String(code || "").trim().toUpperCase().charAt(0);
    var table = POSITION_LABEL[String(locale || "").toLowerCase() === "en" ? "en" : "tr"];
    return table[key] || (isDisplayable(code) ? String(code) : null);
  }

  /**
   * SAHA ÜZERİNDE İLK 11 + OYUNCU KARTI VERİSİ.
   *
   * Saha satırları `services/matchHub.js#lineupSides` kararına dayanır:
   * ya sağlayıcının `grid` koordinatı ya da diziliş metni + 11 oyuncunun
   * sırası. İkisi de yoksa o takım için `pitch` `null` gelir ve yüzey
   * SAHA ÇİZMEZ — düz liste (mevcut bölüm) yerinde kalır. Oyuncuyu tahmini
   * bir yere koymak, doğrulanmamış bir taktik iddiası olurdu.
   *
   * @returns {{home: object|null, away: object|null, hasPitch: boolean}|null}
   */
  function pitchLineups(detail, options) {
    if (!hub || typeof hub.lineupSides !== "function") return null;
    var locale = (options && options.locale) || "tr";
    var sides;
    try {
      sides = hub.lineupSides(detail) || [];
    } catch (error) {
      return null;
    }
    if (!sides.length) return null;

    var index = playerStatIndex(detail);

    var decorate = function (group) {
      if (!group) return null;
      var withStats = function (entry, starter) {
        var stat = findStatRow(index, entry.name, group.team);
        return {
          name: entry.name,
          number: entry.number !== null && entry.number !== undefined ? entry.number : (stat && stat.number) || null,
          position: positionLabel(entry.position || (stat && stat.position), locale),
          positionCode: entry.position || (stat && stat.position) || null,
          grid: entry.grid || null,
          starter: !!starter,
          photo: playerPhoto(stat && stat.providerPlayerId),
          rating: stat ? stat.rating : null,
          minutes: stat ? stat.minutes : null,
          goals: stat ? stat.goals : null,
          assists: stat ? stat.assists : null,
          stat: stat
        };
      };
      var starters = (group.starters || []).map(function (entry) { return withStats(entry, true); });
      var bench = (group.bench || []).map(function (entry) { return withStats(entry, false); });
      var pitch = Array.isArray(group.pitch) && group.pitch.length
        ? group.pitch.map(function (line) {
          return line.map(function (entry) {
            return starters.filter(function (row) { return row.name === entry.name; })[0] || withStats(entry, true);
          });
        })
        : null;
      return {
        side: group.side || null,
        team: group.team,
        formation: isDisplayable(group.formation) ? String(group.formation) : null,
        coach: isDisplayable(group.coach) ? String(group.coach) : null,
        starters: starters,
        bench: bench,
        pitch: pitch
      };
    };

    var home = decorate(sides.filter(function (group) { return group.side === "home"; })[0] || sides[0]);
    var away = decorate(sides.filter(function (group) { return group.side === "away"; })[0] || (sides[1] !== home ? sides[1] : null));
    if (!home && !away) return null;
    return { home: home, away: away, hasPitch: !!((home && home.pitch) || (away && away.pitch)) };
  }

  /* ================================================================== */
  /* 4. OYUNCU PUANLARI VE MAÇIN OYUNCUSU                               */
  /* ================================================================== */

  /**
   * GERÇEK BİR MAÇ PUANI MI?
   *
   * Sağlayıcı, oyuna HİÇ GİRMEMİŞ yedeklere de bir derece alanı yazıyor ve
   * değeri `0` geliyor. Bu bir performans notu DEĞİL, "ölçüm yok"un sayıya
   * dönüşmüş hâli: oynamamış bir futbolcuyu ekrana "0.0" ile basmak ona
   * sıfır not verildiğini söylemek olurdu — ve puan tablosunun yarısı
   * sahaya çıkmamış isimlerle dolardı.
   *
   * 0 DAKİKA ile "dakika bildirilmedi" (null) AYRI tutulur: ikincisinde
   * oyuncu elenmez, çünkü oynamadığını değil, sağlayıcının süreyi
   * vermediğini biliyoruz. Ölçek dışı (10 üstü) bir değer de ölçüm
   * değildir.
   */
  function isRealRating(rating, minutes) {
    if (rating === null || rating === undefined) return false;
    if (!(rating > 0) || rating > 10) return false;
    if (minutes !== null && minutes !== undefined && minutes <= 0) return false;
    return true;
  }

  /**
   * Anlamlı bir puan tablosu için ALT SINIR.
   *
   * Sağlayıcı maçın ilk dakikalarında yalnızca birkaç oyuncuya derece
   * yazıyor. Üç isimlik bir "oyuncu puanları" tablosu, okuyucuya maçın
   * tamamının notlandığı izlenimini verirdi.
   */
  var MIN_RATED_PLAYERS = 6;

  /** Maçın oyuncusu ilanı için gereken asgari kapsama. */
  var MIN_RATED_FOR_MOTM = 10;

  function ratingSort(left, right) {
    if (right.rating !== left.rating) return right.rating - left.rating;
    var leftGoals = (left.goals || 0) + (left.assists || 0);
    var rightGoals = (right.goals || 0) + (right.assists || 0);
    if (rightGoals !== leftGoals) return rightGoals - leftGoals;
    return (right.minutes || 0) - (left.minutes || 0);
  }

  /**
   * CANLI OYUNCU PUANLARI — YALNIZCA SAĞLAYICININ ÖLÇTÜĞÜ DERECE.
   *
   * FutbolRadar bir maç derecesi ÜRETMEZ. `providerRating` yoksa oyuncu
   * puansız listelenir (kartta puan rozeti çıkmaz), hiçbir oyuncuda derece
   * yoksa bölüm hiç açılmaz.
   *
   * @returns {{home: object, away: object, rated: number, source: string|null}|null}
   */
  function playerRatings(detail, options) {
    var locale = (options && options.locale) || "tr";
    var lineups = pitchLineups(detail, { locale: locale });
    var index = playerStatIndex(detail);
    var rated = index.filter(function (row) { return isRealRating(row.rating, row.minutes); });
    if (rated.length < MIN_RATED_PLAYERS) return null;

    var source = (rated[0] && rated[0].ratingSource) || null;

    // Diziliş varsa oyuncular ilk 11 / yedek diye ayrılır; yoksa sicilin
    // kendisi takıma göre bölünür (diziliş gelmemiş ama puan gelmiş maç).
    var buildSide = function (group, teamName) {
      var rows;
      if (group) {
        rows = group.starters.concat(group.bench)
          .filter(function (entry) { return isRealRating(entry.rating, entry.minutes); })
          .map(function (entry) {
            return {
              name: entry.name,
              number: entry.number,
              position: entry.position,
              photo: entry.photo,
              starter: entry.starter,
              rating: entry.rating,
              minutes: entry.minutes,
              goals: entry.goals,
              assists: entry.assists,
              team: group.team
            };
          });
      } else {
        rows = rated.filter(function (row) { return teamName && normalize(row.team) === normalize(teamName); })
          .map(function (row) {
            return {
              name: row.name,
              number: null,
              position: positionLabel(row.position, locale),
              photo: playerPhoto(row.providerPlayerId),
              starter: null,
              rating: row.rating,
              minutes: row.minutes,
              goals: row.goals,
              assists: row.assists,
              team: row.team
            };
          });
      }
      if (!rows.length) return null;
      return {
        team: (group && group.team) || teamName || "",
        players: rows.sort(ratingSort)
      };
    };

    var homeName = teamNameOf(detail && (detail.homeTeam || (detail.teams && detail.teams.home)));
    var awayName = teamNameOf(detail && (detail.awayTeam || (detail.teams && detail.teams.away)));
    var home = buildSide(lineups && lineups.home, homeName);
    var away = buildSide(lineups && lineups.away, awayName);
    if (!home && !away) return null;

    return { home: home, away: away, rated: rated.length, source: source };
  }

  /**
   * FUTBOLRADAR MAÇIN OYUNCUSU — en yüksek SAĞLAYICI derecesi.
   *
   * Kapsama eşiğinin altında ilan edilmez: maçın 12 oyuncusuna derece
   * yazılmışken "maçın oyuncusu" demek, notlanmamış 10 oyuncuyu yarıştan
   * habersiz elemek olurdu. Beraberlikte gol+asist, sonra süre belirler.
   */
  function manOfTheMatch(detail, options) {
    var ratings = playerRatings(detail, options);
    if (!ratings || ratings.rated < MIN_RATED_FOR_MOTM) return null;
    var pool = [];
    if (ratings.home) pool = pool.concat(ratings.home.players);
    if (ratings.away) pool = pool.concat(ratings.away.players);
    if (!pool.length) return null;
    var best = pool.slice().sort(ratingSort)[0];
    if (!best || best.rating === null) return null;
    // İkinci en iyiyle AYNI puandaysa tek bir "maçın oyuncusu" ilan
    // edilemez; eşitlik gerçek ve onu kırmak uydurma olurdu.
    var tied = pool.filter(function (row) { return row.rating === best.rating; });
    if (tied.length > 1) {
      tied = tied.sort(ratingSort);
      if (ratingSort(tied[0], tied[1]) === 0) return null;
      best = tied[0];
    }
    return best;
  }

  /* ================================================================== */
  /* 5. xG                                                              */
  /* ================================================================== */

  var XG_ALIASES = ["gol beklentisi (xg)", "gol beklentisi", "expected goals", "expected_goals", "xg"];

  /**
   * Takım bazında xG.
   *
   * ANLAMSIZ DEĞER ELENİR: negatif xG ya da 25'in üzerinde bir xG ölçüm
   * değil, bozuk bir alandır ("-3.5" gibi). Böyle bir satır geldiğinde
   * bölüm hiç açılmaz; yanlış sayı basmaktansa hiç basmamak doğrudur.
   */
  function expectedGoals(detail) {
    var stats = Array.isArray(detail && detail.statistics) ? detail.statistics : [];
    var row = null;
    for (var i = 0; i < stats.length; i += 1) {
      if (stats[i] && XG_ALIASES.indexOf(normalize(stats[i].type)) !== -1) { row = stats[i]; break; }
    }

    var home = row ? measured(row.home) : null;
    var away = row ? measured(row.away) : null;
    var source = "provider";

    // ŞUT BAZINDA xG'DEN TAKIM TOPLAMI.
    //
    // Sağlayıcı takım toplamını göndermediği maçlarda (çoğu) elimizde yine
    // de ŞUT BAZINDA ölçülmüş xG olabiliyor. Takım xG'si zaten tanımı
    // gereği o şutların toplamıdır — burada hesaplanan yeni bir tahmin
    // değil, ölçülmüş değerlerin toplanmasıdır. Uydurma olurdu ki: xG'si
    // OLMAYAN şutlara bir değer atamak. Bu yüzden toplam, ancak şutların
    // TAMAMI xG taşıyorsa kurulur; bir şutun bile ölçümü eksikse toplam
    // gerçeğin altında kalır ve hiç gösterilmez.
    if (home === null || away === null) {
      var shots = shotMap(detail);
      if (!shots || !shots.length) return null;
      if (shots.some(function (shot) { return shot.xg === null; })) return null;
      var totals = { home: 0, away: 0 };
      shots.forEach(function (shot) { totals[shot.side] += shot.xg; });
      home = Math.round(totals.home * 100) / 100;
      away = Math.round(totals.away * 100) / 100;
      source = "shots";
    }

    if (home === null || away === null) return null;
    if (home < 0 || away < 0 || home > 25 || away > 25) return null;
    return {
      home: home,
      away: away,
      homeText: home.toFixed(2),
      awayText: away.toFixed(2),
      source: source,
      leader: home === away ? null : home > away ? "home" : "away"
    };
  }

  /**
   * DAKİKA DAKİKA xG EĞRİSİ.
   *
   * Yalnızca ŞUT BAZINDA xG geldiğinde çizilebilir: kümülatif eğri, her
   * şutun kendi xG'sinin zaman içinde toplanmasıdır. Sağlayıcı yalnızca
   * takım toplamı gönderiyorsa eğri ÜRETİLMEZ — toplamı dakikalara
   * bölüştürmek, olmayan bir veriden grafik çizmek olurdu.
   *
   * @returns {{home: Array, away: Array, goals: Array, max: number}|null}
   */
  function xgTimeline(detail) {
    var shots = shotMap(detail);
    if (!shots || !shots.length) return null;
    var withXg = shots.filter(function (shot) { return shot.xg !== null && shot.minute !== null; });
    if (withXg.length < 4) return null;

    var series = { home: [{ minute: 0, value: 0 }], away: [{ minute: 0, value: 0 }] };
    var totals = { home: 0, away: 0 };
    withXg.slice().sort(function (a, b) { return a.minute - b.minute; }).forEach(function (shot) {
      if (shot.side !== "home" && shot.side !== "away") return;
      totals[shot.side] = Math.round((totals[shot.side] + shot.xg) * 1000) / 1000;
      series[shot.side].push({ minute: shot.minute, value: totals[shot.side], goal: shot.outcome === "goal", player: shot.player });
    });
    if (series.home.length < 2 && series.away.length < 2) return null;

    var goals = withXg.filter(function (shot) { return shot.outcome === "goal"; }).map(function (shot) {
      return { minute: shot.minute, side: shot.side, player: shot.player };
    });
    var max = Math.max(totals.home, totals.away, 0.5);
    return { home: series.home, away: series.away, goals: goals, max: max };
  }

  /* ================================================================== */
  /* 6. ŞUT HARİTASI                                                    */
  /* ================================================================== */

  var SHOT_OUTCOMES = {
    goal: "goal",
    gol: "goal",
    scored: "goal",
    "on target": "on",
    ontarget: "on",
    on: "on",
    saved: "on",
    "kaleyi bulan": "on",
    "isabetli": "on",
    off: "off",
    "off target": "off",
    missed: "off",
    miss: "off",
    "disari": "off",
    post: "off",
    blocked: "blocked",
    block: "blocked",
    "bloklanan": "blocked"
  };

  /**
   * ŞUT HARİTASI — KOORDİNAT ŞART.
   *
   * Sağlayıcı şut koordinatı göndermiyorsa harita ÇİZİLMEZ (`null`).
   * Koordinatsız bir şut listesini sahaya "yaklaşık" yerleştirmek, her
   * noktası uydurma bir grafik üretmek olurdu. Alan geldiği gün bu işlev
   * kendiliğinden dolar ve bölüm tek satır değişiklik olmadan açılır.
   *
   * Beklenen kayıt: `{x, y, outcome|result, minute, player, team, assist, xg}`
   * — `x`/`y` 0-100 aralığında, kendi kalesinden rakip kaleye doğru.
   */
  function shotMap(detail) {
    var raw = Array.isArray(detail && detail.shots) ? detail.shots
      : Array.isArray(detail && detail.shotMap) ? detail.shotMap : null;
    if (!raw || !raw.length) return null;

    var homeName = teamNameOf(detail && detail.homeTeam);
    var awayName = teamNameOf(detail && detail.awayTeam);

    var rows = raw.map(function (shot) {
      if (!shot) return null;
      var x = measured(shot.x);
      var y = measured(shot.y);
      if (x === null || y === null) return null;
      if (x < 0 || x > 100 || y < 0 || y > 100) return null;
      var outcome = SHOT_OUTCOMES[normalize(shot.outcome || shot.result || shot.type)] || null;
      if (!outcome) return null;
      var team = teamNameOf(shot.team);
      var side = shot.side === "home" || shot.side === "away" ? shot.side
        : team && normalize(team) === normalize(homeName) ? "home"
          : team && normalize(team) === normalize(awayName) ? "away" : null;
      if (!side) return null;
      var xg = measured(shot.xg !== undefined ? shot.xg : shot.expectedGoals);
      if (xg !== null && (xg < 0 || xg > 1)) xg = null;
      var minute = measured(String(shot.minute == null ? "" : shot.minute).replace(/'+$/, "").split("+")[0]);
      return {
        x: x,
        y: y,
        side: side,
        team: team,
        outcome: outcome,
        minute: minute,
        player: isDisplayable(shot.player) ? String(shot.player) : null,
        assist: isDisplayable(shot.assist) ? String(shot.assist) : null,
        xg: xg,
        xgText: xg === null ? null : xg.toFixed(2)
      };
    }).filter(Boolean);

    return rows.length ? rows : null;
  }

  /* ================================================================== */
  /* 7. ISI HARİTALARI                                                  */
  /* ================================================================== */

  /**
   * ISI HARİTASI — SAĞLAYICI DESTEKLİYORSA.
   *
   * `detail.players[].heatmap` bir nokta bulutu olarak gelmeli
   * (`[{x, y, value?}]`). Gelmiyorsa `null` döner ve bölüm gizlenir;
   * dokunuş sayısından ısı haritası TÜRETİLMEZ.
   */
  function heatmaps(detail, options) {
    var locale = (options && options.locale) || "tr";
    var index = playerStatIndex(detail);
    var rows = index.filter(function (row) {
      return Array.isArray(row.heatmap) && row.heatmap.length >= 5;
    }).map(function (row) {
      var points = row.heatmap.map(function (point) {
        var x = measured(point && point.x);
        var y = measured(point && point.y);
        if (x === null || y === null || x < 0 || x > 100 || y < 0 || y > 100) return null;
        var value = measured(point.value);
        return { x: x, y: y, value: value === null ? 1 : Math.max(0, Math.min(1, value)) };
      }).filter(Boolean);
      if (points.length < 5) return null;
      return {
        name: row.name,
        team: row.team,
        position: positionLabel(row.position, locale),
        photo: playerPhoto(row.providerPlayerId),
        rating: row.rating,
        points: points
      };
    }).filter(Boolean);

    return rows.length ? rows : null;
  }

  /* ================================================================== */
  /* 8. GELİŞMİŞ MAÇ ZAMAN ÇİZGİSİ                                      */
  /* ================================================================== */

  function minuteNumber(time) {
    var found = String(time == null ? "" : time).match(/(\d+)(?:\s*\+\s*(\d+))?/);
    if (!found) return null;
    return Number(found[1]) + (found[2] ? Number(found[2]) / 100 : 0);
  }

  function minuteText(time) {
    var raw = String(time == null ? "" : time).replace(/'+$/, "").trim();
    if (!raw) return "";
    return raw + "'";
  }

  function classify(event) {
    var type = normalize(event && event.type);
    var detailKey = normalize(event && event.detail);
    if (type === "goal" || type === "gol") {
      if (detailKey.indexOf("own") !== -1 || detailKey.indexOf("kendi kale") !== -1) return "own-goal";
      if (detailKey.indexOf("missed") !== -1 || detailKey.indexOf("kacan") !== -1) return "missed-penalty";
      if (detailKey.indexOf("penalty") !== -1 || detailKey.indexOf("penalti") !== -1) return "penalty";
      return "goal";
    }
    if (type === "card" || type.indexOf("kart") !== -1) {
      if (detailKey.indexOf("second yellow") !== -1 || detailKey.indexOf("ikinci sari") !== -1) return "yellow-red";
      if (detailKey.indexOf("red") !== -1 || detailKey.indexOf("kirmizi") !== -1) return "red";
      return "yellow";
    }
    if (type === "subst" || type.indexOf("degisik") !== -1 || type.indexOf("substitution") !== -1) return "sub";
    if (type === "var" || detailKey.indexOf("var") === 0) return "var";
    return "note";
  }

  function sideOf(detail, teamName) {
    var key = normalize(teamName);
    if (!key) return null;
    var home = normalize(teamNameOf(detail && detail.homeTeam));
    var away = normalize(teamNameOf(detail && detail.awayTeam));
    if (key === home || (home && (home.indexOf(key) === 0 || key.indexOf(home) === 0))) return "home";
    if (key === away || (away && (away.indexOf(key) === 0 || key.indexOf(away) === 0))) return "away";
    return null;
  }

  /**
   * OLAY AKIŞI — YARI YARIYA, KRONOLOJİK, KOŞAN SKORLU.
   *
   * Sağlayıcı olayları tek düz liste olarak gönderiyor. Okuyucunun aradığı
   * ise "ilk yarıda ne oldu, ikinci yarıda ne oldu" ayrımı; bu yüzden akış
   * dakikaya göre dört bölüme ayrılır (ilk yarı ≤45, ikinci yarı ≤90,
   * uzatma ≤120, penaltılar).
   *
   * KOŞAN SKOR YALNIZCA DOĞRULANABİLİYORSA yazılır: olaylardan toplanan
   * skor tabeladaki skorla tutmuyorsa (eksik yayımlanmış olay akışı) hiçbir
   * satıra skor konmaz. Yarım doğru bir skor, hiç skor olmamasından kötüdür.
   */
  function timeline(detail, options) {
    var locale = (options && options.locale) || "tr";
    var text = textFor(locale);
    var items = [];

    (Array.isArray(detail && detail.events) ? detail.events : []).forEach(function (event) {
      if (!event || (!event.type && !event.detail)) return;
      var team = teamNameOf(event.team);
      var kind = classify(event);
      // Sağlayıcı oyuncu ve asisti tek bir metne katlıyor ("Oyuncu · Asist: X").
      var parts = String(event.value || "").split(" · ").map(function (part) { return part.trim(); }).filter(Boolean);
      var detailKey = normalize(event.detail);
      var player = (event.player && (event.player.name || event.player)) ||
        (parts.length && !/^(asist|assist):/i.test(parts[0]) && normalize(parts[0]) !== detailKey ? parts[0] : "");
      var assistPart = parts.filter(function (part) { return /^(asist|assist):/i.test(part); })[0];
      var assist = (event.assist && (event.assist.name || event.assist)) ||
        (assistPart ? assistPart.replace(/^(asist|assist):\s*/i, "") : "");

      items.push({
        sort: minuteNumber(event.time),
        minute: minuteText(event.time),
        kind: kind,
        label: text.event[kind] || text.event.note,
        team: team,
        side: sideOf(detail, team),
        player: isDisplayable(player) ? String(player) : null,
        assist: kind === "sub" ? null : (isDisplayable(assist) ? String(assist) : null),
        playerIn: kind === "sub" ? (isDisplayable(player) ? String(player) : null) : null,
        playerOut: kind === "sub" ? (isDisplayable(assist) ? String(assist) : null) : null,
        note: isDisplayable(event.detail) ? String(event.detail) : null
      });
    });

    (Array.isArray(detail && detail.substitutions) ? detail.substitutions : []).forEach(function (sub) {
      if (!sub || (!sub.in && !sub.out)) return;
      var team = teamNameOf(sub.team);
      items.push({
        sort: minuteNumber(sub.time),
        minute: minuteText(sub.time),
        kind: "sub",
        label: text.event.sub,
        team: team,
        side: sideOf(detail, team),
        player: null,
        assist: null,
        playerIn: isDisplayable(sub.in) ? String(sub.in) : null,
        playerOut: isDisplayable(sub.out) ? String(sub.out) : null,
        note: isDisplayable(sub.note) ? String(sub.note) : null
      });
    });

    if (!items.length) return null;

    items.sort(function (left, right) {
      var a = left.sort === null ? 999 : left.sort;
      var b = right.sort === null ? 999 : right.sort;
      return a - b;
    });

    attachRunningScore(items, detail);

    var buckets = [
      { key: "first", label: text.half.first, items: [] },
      { key: "second", label: text.half.second, items: [] },
      { key: "extra", label: text.half.extra, items: [] },
      { key: "penalties", label: text.half.penalties, items: [] }
    ];
    items.forEach(function (item) {
      var minute = item.sort === null ? 999 : item.sort;
      if (minute <= 45.99) buckets[0].items.push(item);
      else if (minute <= 90.99) buckets[1].items.push(item);
      else if (minute <= 120.99) buckets[2].items.push(item);
      else buckets[3].items.push(item);
    });

    var groups = buckets.filter(function (bucket) { return bucket.items.length; });
    return groups.length ? groups : null;
  }

  function attachRunningScore(items, detail) {
    var home = 0;
    var away = 0;
    var pending = [];
    items.forEach(function (item) {
      if (item.kind === "goal" || item.kind === "penalty") {
        if (item.side === "home") home += 1;
        else if (item.side === "away") away += 1;
        else { pending.push(item); return; }
      } else if (item.kind === "own-goal") {
        if (item.side === "home") away += 1;
        else if (item.side === "away") home += 1;
        else { pending.push(item); return; }
      } else {
        return;
      }
      pending.push(item);
      item.scoreHome = home;
      item.scoreAway = away;
    });

    var score = detail && detail.score;
    var finalHome = measured(score && score.home);
    var finalAway = measured(score && score.away);
    // Olay akışı eksikse koşan skor sessizce yanlış olurdu; tutmuyorsa
    // hiçbir satırda skor gösterilmez.
    if (finalHome === null || finalAway === null || finalHome !== home || finalAway !== away) {
      pending.forEach(function (item) { delete item.scoreHome; delete item.scoreAway; });
    }
  }

  /* ================================================================== */
  /* 9. GENİŞLETİLMİŞ TAKIM İSTATİSTİKLERİ                              */
  /* ================================================================== */

  /** Okuyucunun aradığı sıra; listede olmayan ölçüm sonda, kendi sırasında. */
  var STAT_ORDER = [
    "topla oynama", "toplam sut", "isabetli sut", "isabetsiz sut", "engellenen sut",
    "buyuk firsat", "buyuk firsatlar", "ceza sahasina giris", "korner", "ofsayt", "faul",
    "sari kart", "kirmizi kart", "toplam pas", "isabetli pas", "pas isabeti",
    "kurtaris", "gol beklentisi (xg)"
  ];

  /**
   * ÇİZİLEBİLİR İSTATİSTİK SATIRLARI — `matchHub.statRows` kararıyla.
   *
   * Değeri olmayan ölçüm ELENİR ("0" gerçek bir ölçümdür, "veri gelmedi"
   * değildir); çubuk payı ve "hangi taraf iyi" yönü matchHub'da tanımlı.
   * Buradaki ek iş, istenen sıralama ve İNGİLİZCE etiket.
   */
  function statPanel(detail, options) {
    if (!hub || typeof hub.statRows !== "function") return null;
    var locale = (options && options.locale) || "tr";
    var rows;
    try {
      rows = hub.statRows(detail) || [];
    } catch (error) {
      return null;
    }
    if (!rows.length) return null;

    var decorated = rows.map(function (row, index) {
      var key = normalize(row.type);
      var wanted = STAT_ORDER.indexOf(key);
      return {
        key: key,
        type: row.type,
        label: statLabel(row.type, locale),
        category: categoryLabel(row.category, locale),
        home: row.home,
        away: row.away,
        homeText: row.homeText,
        awayText: row.awayText,
        homeShare: row.homeShare,
        awayShare: row.awayShare,
        leader: row.leader,
        unit: row.unit,
        order: wanted === -1 ? STAT_ORDER.length + index : wanted
      };
    }).filter(function (row) { return isDisplayable(row.homeText) && isDisplayable(row.awayText); });

    if (!decorated.length) return null;
    return decorated.sort(function (left, right) { return left.order - right.order; });
  }

  /* ================================================================== */
  /* 10. FUTBOLRADAR MAÇ ANALİZİ (OTOMATİK YORUM)                       */
  /* ================================================================== */

  function statValue(detail, aliases, side) {
    var stats = Array.isArray(detail && detail.statistics) ? detail.statistics : [];
    for (var i = 0; i < stats.length; i += 1) {
      if (stats[i] && aliases.indexOf(normalize(stats[i].type)) !== -1) return measured(stats[i][side]);
    }
    return null;
  }

  /**
   * FUTBOLRADAR MAÇ ANALİZİ.
   *
   * Her cümle ÖLÇÜLMÜŞ bir sayıdan doğar; sayı yoksa cümle de yoktur.
   * Yorum, "yeterli veri" eşiğinin altında hiç üretilmez: iki cümlelik bir
   * "analiz", analiz değil süstür.
   *
   * @returns {{sentences: string[], basis: string[]}|null}
   */
  function commentary(detail, options) {
    var locale = (options && options.locale) || "tr";
    var text = textFor(locale);
    var phrase = text.commentary;
    var homeName = teamNameOf(detail && detail.homeTeam);
    var awayName = teamNameOf(detail && detail.awayTeam);
    if (!homeName || !awayName) return null;

    var phase = phaseOf(detail);
    if (phase === "scheduled" || phase === "unplayed") return null;

    var sentences = [];
    var basis = [];
    var sides = [{ key: "home", name: homeName }, { key: "away", name: awayName }];

    // Topla oynama — tek cümlede üstün taraf.
    var possessionHome = statValue(detail, ["topla oynama", "ball possession", "possession"], "home");
    var possessionAway = statValue(detail, ["topla oynama", "ball possession", "possession"], "away");
    if (possessionHome !== null && possessionAway !== null && possessionHome >= 0 && possessionHome <= 100) {
      var leader = possessionHome >= possessionAway ? { name: homeName, value: Math.round(possessionHome) } : { name: awayName, value: Math.round(possessionAway) };
      sentences.push(phrase.possession(leader.name, leader.value));
      basis.push("possession");
    }

    sides.forEach(function (side) {
      var total = statValue(detail, ["toplam sut", "total shots"], side.key);
      var on = statValue(detail, ["isabetli sut", "shots on goal", "shots on target"], side.key);
      if (total !== null && total >= 0) {
        sentences.push(phrase.shots(side.name, total, on !== null && on >= 0 ? on : null));
        basis.push("shots:" + side.key);
      }
    });

    var xg = expectedGoals(detail);
    if (xg) {
      sentences.push(phrase.xg(homeName, xg.homeText, awayName, xg.awayText));
      basis.push("xg");
      var score = detail && detail.score;
      sides.forEach(function (side) {
        var goals = measured(score && score[side.key]);
        var value = xg[side.key];
        if (goals === null) return;
        if (goals - value >= 1) { sentences.push(phrase.xgOver(side.name, goals, value.toFixed(2))); basis.push("xg-diff:" + side.key); }
        else if (value - goals >= 1) { sentences.push(phrase.xgUnder(side.name, goals, value.toFixed(2))); basis.push("xg-diff:" + side.key); }
      });
    }

    sides.forEach(function (side) {
      var big = statValue(detail, ["buyuk firsat", "buyuk firsatlar", "big chances"], side.key);
      if (big !== null && big > 0) { sentences.push(phrase.bigChances(side.name, big)); basis.push("big-chances:" + side.key); }
    });

    sides.forEach(function (side) {
      var corners = statValue(detail, ["korner", "corner kicks", "corners"], side.key);
      if (corners !== null && corners > 0) { sentences.push(phrase.corners(side.name, corners)); basis.push("corners:" + side.key); }
    });

    sides.forEach(function (side) {
      var passes = statValue(detail, ["toplam pas", "total passes"], side.key);
      var accuracy = statValue(detail, ["pas isabeti", "passes %", "pass accuracy"], side.key);
      if (passes !== null && accuracy !== null && accuracy >= 0 && accuracy <= 100) {
        sentences.push(phrase.passes(side.name, passes, Math.round(accuracy)));
        basis.push("passing:" + side.key);
      }
    });

    sides.forEach(function (side) {
      var yellow = statValue(detail, ["sari kart", "yellow cards"], side.key);
      var red = statValue(detail, ["kirmizi kart", "red cards"], side.key);
      if (yellow !== null && yellow > 0) { sentences.push(phrase.cards(side.name, yellow, red === null ? 0 : red)); basis.push("cards:" + side.key); }
    });

    var motm = manOfTheMatch(detail, { locale: locale });
    if (motm) { sentences.push(phrase.motm(motm.name, motm.rating.toFixed(1))); basis.push("motm"); }

    // YETERLİ VERİ YOKSA YORUM ÜRETİLMEZ.
    if (sentences.length < 3) return null;
    return { sentences: sentences, basis: basis };
  }

  /* ================================================================== */
  /* 11. DIŞA AÇILAN YÜZEY                                              */
  /* ================================================================== */

  return {
    attachHub: attachHub,
    commentary: commentary,
    expectedGoals: expectedGoals,
    heatmaps: heatmaps,
    isDisplayable: isDisplayable,
    isRealRating: isRealRating,
    isLivePhase: isLivePhase,
    manOfTheMatch: manOfTheMatch,
    measured: measured,
    phaseOf: phaseOf,
    pitchLineups: pitchLineups,
    playerPhoto: playerPhoto,
    playerRatings: playerRatings,
    playerStatIndex: playerStatIndex,
    positionLabel: positionLabel,
    samePlayer: samePlayer,
    shotMap: shotMap,
    statLabel: statLabel,
    statPanel: statPanel,
    textFor: textFor,
    timeline: timeline,
    xgTimeline: xgTimeline
  };
});
