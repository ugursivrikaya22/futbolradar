"use strict";

/**
 * ANKET → SUPABASE SATIRLARI (polls / poll_options).
 *
 * `data/home-polls.json` metinleri iki dilli nesne olarak tutar:
 * `question: { tr, en }`. Eski alım bu nesneyi doğrudan `normalize.text`
 * içine veriyordu; `String({...})` "[object Object]" döndüğü için
 * question_tr / subtitle_tr bu dizeyle yazılıyor, *_en ise (olmayan
 * `questionEn` alanından) null kalıyordu. Burada her dil ayrı çıkarılır;
 * eski düz dize + `questionEn` biçimi de desteklenir.
 *
 * Seçenekler `optionSource` ("super-lig-teams", "match-outcome") ile
 * ÇALIŞMA ANINDA türetilir; kayıtta `options` dizisi yoktur. Eski alım
 * yalnızca `poll.options`'a baktığı için bu anketlere hiç seçenek yazmıyordu.
 * Türetme sitedeki ile aynı yoldan (`validatePoll`) yapılır.
 *
 * Yalnızca dosyadaki anketler için satır üretilir; dosyada olmayan
 * (ör. elle açılmış) anketlere dokunulmaz — alım upsert yapar, silmez.
 */

const normalize = require("./normalize");
const { validatePoll, localized, hasLocale } = require("../homePoll");

function localeText(field, fallback, locale) {
  if (field && typeof field === "object") {
    return hasLocale(field, locale) ? normalize.text(localized(field, locale)) : null;
  }
  if (locale === "tr") return normalize.text(field);
  return normalize.text(fallback);
}

function pollRowsFrom(raw, sources = {}) {
  // team_id `teams(id)`'ye yabancı anahtar: ad → teams.json kimliği.
  // Bilinmeyen kulüpte null (yabancı anahtar hatası yerine).
  const teamList = Array.isArray(sources.teams) ? sources.teams
    : (sources.teams && Array.isArray(sources.teams.teams) ? sources.teams.teams : []);
  const teamIds = new Map();
  for (const team of teamList) {
    const row = team && normalize.team(team, "internal");
    if (row) teamIds.set(row.name, row.id);
  }
  const entries = Array.isArray(raw) ? raw : ((raw && (raw.polls || raw.items)) || []);
  const polls = [];
  const options = [];

  for (const entry of entries) {
    const poll = (entry && entry.poll) || entry;
    if (!poll) continue;
    const id = normalize.text(poll.id);
    if (!id || !poll.startsAt || !poll.endsAt) continue;

    const pollRow = {
      id,
      kind: normalize.text(poll.type) || "champion",
      question_tr: localeText(poll.question, null, "tr"),
      question_en: localeText(poll.question, poll.questionEn, "en"),
      subtitle_tr: localeText(poll.subtitle, null, "tr"),
      subtitle_en: localeText(poll.subtitle, poll.subtitleEn, "en"),
      starts_at: normalize.isoStamp(poll.startsAt),
      ends_at: normalize.isoStamp(poll.endsAt)
    };
    if (!pollRow.question_tr || !pollRow.starts_at || !pollRow.ends_at) continue;
    polls.push(pollRow);

    const verdict = validatePoll(poll, sources);
    const resolved = verdict.valid ? verdict.poll.options : [];
    resolved.forEach((option, index) => {
      const row = {
        poll_id: id,
        option_id: normalize.text(option.id),
        label_tr: localeText(option.label, null, "tr"),
        label_en: localeText(option.label, option.labelEn, "en"),
        team_id: option.team ? (teamIds.get(normalize.text(option.team)) || null) : null,
        sort_order: index
      };
      if (row.option_id && row.label_tr) options.push(row);
    });
  }

  return { polls, options };
}

module.exports = { pollRowsFrom };
