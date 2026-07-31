/**
 * TELEGRAM BİLDİRİMİ — taslak köşe yazısı haber verir.
 *
 * NEDEN VAR. "Radar Yorumu" yazıları taslak olarak üretiliyor ve yayına elle
 * alınıyor. Elle alınan bir karar, kimsenin haberi olmayan bir taslak
 * klasöründe unutulur. Bildirim o boşluğu kapatır: taslak doğduğu anda
 * editöre gider.
 *
 * SIR YÖNETİMİ. Bot jetonu ve sohbet kimliği ORTAM DEĞİŞKENİNDEN okunur,
 * asla depoya yazılmaz ve ASLA GÜNLÜĞE BASILMAZ. Bu modül jetonun
 * varlığını/yokluğunu bildirir, değerini değil.
 *
 *   TELEGRAM_BOT_TOKEN   BotFather'dan alınan jeton
 *   TELEGRAM_CHAT_ID     mesajın gideceği sohbet
 *
 * ANAHTAR YOKSA SESSİZ NO-OP DEĞİL. Yapılandırma eksikse bu açıkça
 * söylenir ve çıkış kodu 0 kalır — eksik kurulum bir çökme değildir, ama
 * "bildirim gitti" sanılmamalı.
 *
 * BİLDİRİM VERİYİ DEĞİŞTİRMEZ. Gönderim başarısız olsa bile taslak
 * üretilmiş olur; bildirim bir yan etkidir, akışın koşulu değil.
 */

const TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const CHAT_ENV = "TELEGRAM_CHAT_ID";

/** Mesajın sonunda görünecek eylem çağrısı. */
const CALL_TO_ACTION = "İncele, uygunsa yayınla";

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

/**
 * Yapılandırma durumu. DEĞER DÖNDÜRMEZ — yalnızca varlık bilgisi.
 *
 * @returns {{ready: boolean, missing: string[]}}
 */
function telegramConfig(env) {
  const source = env || process.env;
  const missing = [];

  if (!text(source[TOKEN_ENV])) missing.push(TOKEN_ENV);
  if (!text(source[CHAT_ENV])) missing.push(CHAT_ENV);

  return { ready: missing.length === 0, missing };
}

/** Telegram MarkdownV2 kaçışı. Kaçırılmayan bir karakter mesajı düşürür. */
function escapeMarkdown(value) {
  return text(value).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (character) => `\\${character}`);
}

/**
 * Taslak bildirimi metni.
 *
 * Mesaj üç bilgiyi taşır (başlık, kategori, yazar) ve ne yapılacağını söyler.
 * Yazının GÖVDESİ gönderilmez: taslak metni henüz gözden geçirilmemiştir ve
 * sohbete düşen uzun bir taslak, yayımlanmış gibi dolaşmaya başlayabilir.
 *
 * @param {Object} column `presentColumn` çıktısı.
 * @returns {{text: string, parseMode: string}}
 */
function draftMessage(column) {
  const lines = [
    "*Yeni Radar Yorumu taslağı*",
    "",
    `*Başlık:* ${escapeMarkdown(column.title)}`,
    `*Kategori:* ${escapeMarkdown(column.categoryLabel || column.category)}`,
    `*Yazar:* ${escapeMarkdown(column.author)}`
  ];

  if (column.date) {
    lines.push(`*Tarih:* ${escapeMarkdown(String(column.date).slice(0, 10))}`);
  }

  lines.push("", escapeMarkdown(CALL_TO_ACTION));

  return { text: lines.join("\n"), parseMode: "MarkdownV2" };
}

/**
 * Mesajı gönderir.
 *
 * @param {Object} message `draftMessage` çıktısı.
 * @param {Object} [options] `env`, `fetchImpl` (test için), `dryRun`.
 * @returns {Promise<{sent: boolean, reason?: string, status?: number}>}
 *   ASLA fırlatmaz: bildirim bir yan etki, akışın koşulu değil. Taslak
 *   üretimi bildirim yüzünden düşmemeli.
 */
async function sendTelegramMessage(message, options = {}) {
  const env = options.env || process.env;
  const config = telegramConfig(env);

  if (!config.ready) {
    return {
      sent: false,
      reason: `Telegram yapılandırması eksik: ${config.missing.join(", ")}`
    };
  }

  if (options.dryRun) {
    return { sent: false, reason: "kuru koşu — mesaj gönderilmedi" };
  }

  const send = options.fetchImpl || globalThis.fetch;
  if (typeof send !== "function") {
    return { sent: false, reason: "fetch kullanılamıyor" };
  }

  // Jeton YALNIZCA burada, adres içinde kullanılır. Hata mesajlarına
  // adresin kendisi hiç konmaz; konsaydı jeton günlüğe düşerdi.
  const url = `https://api.telegram.org/bot${text(env[TOKEN_ENV])}/sendMessage`;

  try {
    const response = await send(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: text(env[CHAT_ENV]),
        text: message.text,
        parse_mode: message.parseMode,
        disable_web_page_preview: true
      })
    });

    if (!response || !response.ok) {
      const status = response ? response.status : 0;
      return { sent: false, status, reason: `Telegram ${status} döndü` };
    }

    return { sent: true, status: response.status };
  } catch (error) {
    // Hata metni sızıntı taşıyabilir; yalnızca sınıfı bildiriliyor.
    return { sent: false, reason: `gönderim hatası: ${error && error.name ? error.name : "bilinmeyen"}` };
  }
}

module.exports = {
  CALL_TO_ACTION,
  CHAT_ENV,
  TOKEN_ENV,
  draftMessage,
  escapeMarkdown,
  sendTelegramMessage,
  telegramConfig
};
