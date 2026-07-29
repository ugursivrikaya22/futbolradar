/**
 * TARAYICI İSTEMCİSİ — yalnızca anon anahtar, yalnızca okuma.
 *
 * BU DOSYA BUGÜN SİTEDE KULLANILMIYOR ve bu bilinçli bir durum. FutbolRadar
 * statik HTML + `/api/*` uçlarıyla çalışıyor; tarayıcı veritabanına doğrudan
 * gitmiyor. Sayfaların ihtiyacı olan her şey zaten ön render ile gömülü ya da
 * kendi API ucundan geliyor.
 *
 * Dosya yine de var, çünkü doğru yapılmış bir tarayıcı istemcisi ileride
 * gerekebilir ve o gün aceleyle yazılmamalı. Sözleşmesi baştan dar:
 *
 *   • YALNIZCA anon anahtar. Servis anahtarına erişimi yok; config.js zaten
 *     tarayıcıda okunmasını engelliyor.
 *   • YALNIZCA okuma. Yazma yüzeyi hiç açılmadı — tarayıcıdan yazma, RLS
 *     politikaları kusursuz olsa bile gereksiz bir saldırı yüzeyi.
 *   • Anahtar KODA GÖMÜLMEZ. Çağıran taraf değeri kendisi verir; bu dosya
 *     process.env okumaz, çünkü tarayıcıda process yoktur ve okuyor gibi
 *     yapmak derleme zamanı gömme alışkanlığını davet ederdi.
 *
 * ANON ANAHTARIN SIZMASI FELAKET DEĞİLDİR: RLS politikaları onu yalnızca
 * herkese açık veriyi okumaya yetkili tutar (supabase/migrations/0005).
 * Ama bu, dikkatsizlik için bir izin değil — yalnızca risk ölçeğinin
 * servis anahtarından bambaşka olduğunun kaydı.
 */

const { createClient } = require("./restClient.js");

/**
 * Tarayıcı için salt okunur istemci.
 *
 * @param {{url: string, anonKey: string, timeoutMs?: number}} options
 *   Değerler ÇAĞIRAN tarafından verilir; bu dosya ortam değişkeni okumaz.
 * @returns {{ready: boolean, select: Function, rpc: Function}}
 */
function createBrowserClient(options = {}) {
  const url = String(options.url || "");
  const anonKey = String(options.anonKey || "");

  // Servis anahtarı biçimi buraya geçirilmişse çağıran taraf hata yapıyor.
  // Sessizce çalışmak, o hatayı üretime taşırdı.
  if (/^sb_secret_/.test(anonKey)) {
    throw new Error(
      "Tarayıcı istemcisine servis (secret) anahtarı verildi. Bu anahtar RLS'i " +
      "baypas eder ve istemci tarafına hiçbir koşulda konulamaz."
    );
  }

  const client = createClient({
    url,
    key: anonKey,
    role: "anon",
    timeoutMs: options.timeoutMs
  });

  return {
    ready: client.ready,

    /** Salt okunur seçim. Yazma yüzeyi bilerek açılmadı. */
    select(table, params) {
      return client.from(table).select(params);
    },

    /** Saklı yordam — yalnızca okuma amaçlı olanlar için. */
    rpc(name, args) {
      return client.rpc(name, args);
    }
  };
}

module.exports = { createBrowserClient };
