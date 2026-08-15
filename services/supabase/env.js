/**
 * SUPABASE KİMLİK BİLGİSİ — TEK OKUMA NOKTASI.
 *
 * Bu mantık önce anket oy deposunun içinde yazılmıştı ve orada doğruydu;
 * ikinci bir tüketici (veri katmanı) gelince kopyalanacaktı. Kopyalanan
 * kimlik bilgisi mantığının bilinen sonu şu: bir gün biri yeni bir
 * değişken adını yalnızca bir kopyaya ekler ve iki yüzey aynı ortamda
 * farklı cevap verir — biri "bağlı", diğeri "yapılandırılmamış" der.
 *
 * Bu yüzden adlar, rol okuma ve teşhis metni burada; hem
 * `services/homePollVoteStore.js` hem `services/supabase/client.js`
 * buradan okuyor.
 *
 * ANAHTARIN KENDİSİ HİÇBİR FONKSİYONDAN DÖNMEZ. Dışarı yalnızca "hangi
 * ad dolu", "rolü ne" ve "neden çalışmıyor" bilgisi çıkar. Değeri
 * döndüren tek yer `serviceKey()` ve o da yalnızca istek başlığına
 * konmak üzere bu paketin içinde kullanılır.
 */

const REST_URL_ENV_NAMES = ["SUPABASE_URL", "HOME_POLL_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"];

const SERVICE_KEY_ENV_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "HOME_POLL_SUPABASE_KEY"
];

/** IP karması için gizli tuz. Yoksa IP katmanı çalışmaz. */
const IP_SALT_ENV_NAMES = ["HOME_POLL_IP_SALT", "SUPABASE_IP_SALT"];

/**
 * ANON ANAHTARI KABUL EDİLMEZ — VE BU BİR TERCİH DEĞİL, ŞEMANIN SONUCU.
 *
 * Bütün tablolarda RLS açık ve `anon` rolüne politika tanımlı değil;
 * yerel PostgreSQL'de doğrulandı: anon okuma 0 satır, anon yazma "new row
 * violates row-level security policy". Anon anahtarını kabul etmek, her
 * yazmanın çalışma zamanında sessizce reddedilmesi demek olurdu.
 *
 * Adlar yine de TANINIYOR — kabul etmek için değil, TEŞHİS için: yalnızca
 * anon anahtarı tanımlıysa sistem "yapılandırılmamış" demek yerine
 * sorunun ne olduğunu söyleyebiliyor.
 */
const ANON_KEY_ENV_NAMES = ["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

function firstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function restUrl() {
  return firstEnv(REST_URL_ENV_NAMES).replace(/\/+$/, "");
}

function serviceKey() {
  return firstEnv(SERVICE_KEY_ENV_NAMES);
}

function ipSalt() {
  return firstEnv(IP_SALT_ENV_NAMES);
}

function anonKey() {
  return firstEnv(ANON_KEY_ENV_NAMES);
}

/**
 * Supabase anahtarları JWT'dir ve yük kısmında bir `role` iddiası taşır
 * ("anon" ya da "service_role"). Yalnızca BU iddia okunur — imza
 * doğrulanmaz, çünkü amaç güvenlik kararı vermek değil, operatöre yanlış
 * anahtarı yapıştırdığını söylemek.
 */
function keyRole(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return "";
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
    return String(payload && payload.role ? payload.role : "").trim();
  } catch (error) {
    return "";
  }
}

/** Kimlik bilgisi tam mı? Değilse Supabase'e hiç istek gönderilmez. */
function isConfigured() {
  return Boolean(restUrl() && serviceKey());
}

/**
 * NEDEN YAPILANDIRILMAMIŞ? — operatöre dönen teşhis.
 *
 * Genel bir "yapılandırılmamış" mesajı, yanlış İSİM ile yanlış ANAHTAR
 * TÜRÜNÜ ayırt etmiyordu ve ikisi de aynı sessiz boşluğa çıkıyordu.
 * Dönen dize yalnızca DURUMU anlatır; anahtar hiçbir koşulda yazılmaz.
 */
function configurationHint() {
  const url = restUrl();
  const key = serviceKey();
  const anon = anonKey();

  if (url && key) {
    return keyRole(key) === "anon"
      ? "servis anahtari yerine anon anahtari tanimli; RLS anon rolune izin vermiyor, service_role gerekiyor"
      : "";
  }
  if (!url && !key && !anon) {
    // HİÇBİRİ YOKSA İKİ AYRI SEBEP VAR: değişkenler bu projeye/ortama hiç
    // eklenmemiş, ya da eklenmiş ama TANIMADIĞIMIZ bir adla. Ortamdaki
    // "supabase" geçen değişkenlerin SAYISI bunu ayırır. Yalnızca SAYI
    // yazılır — ad da değer de yazılmaz.
    const seen = Object.keys(process.env).filter((name) => /supabase/i.test(name)).length;
    return seen
      ? `SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanimli degil; ortamda "supabase" gecen ${seen} degisken var — adlar bekleneni tutmuyor`
      : "SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanimli degil; ortamda \"supabase\" gecen hicbir degisken yok — degiskenler bu projeye/ortama ulasmamis";
  }
  if (!url) return "SUPABASE_URL tanimli degil";
  if (anon && !key) {
    return "yalnizca SUPABASE_ANON_KEY tanimli; RLS anon rolune izin vermiyor, SUPABASE_SERVICE_ROLE_KEY gerekiyor";
  }
  return "SUPABASE_SERVICE_ROLE_KEY tanimli degil";
}

module.exports = {
  ANON_KEY_ENV_NAMES,
  IP_SALT_ENV_NAMES,
  REST_URL_ENV_NAMES,
  SERVICE_KEY_ENV_NAMES,
  anonKey,
  configurationHint,
  ipSalt,
  isConfigured,
  keyRole,
  restUrl,
  serviceKey
};
