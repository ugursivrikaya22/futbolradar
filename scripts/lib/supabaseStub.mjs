/**
 * SAHTE SUPABASE — TESTLER İÇİN.
 *
 * Üyelik akışı iki uzak servise dayanıyor: GoTrue (`/auth/v1/*`) ve
 * PostgREST (`/rest/v1/*`). Testin gerçek bir Supabase projesine
 * bağlanması, testi ağa ve bir sırra bağımlı kılardı — CI'da
 * çalışmayan, "bazen kırmızı" bir test. Bu sunucu ikisinin de
 * konuştuğu HTTP sözleşmesini bellekte taklit eder.
 *
 * TAKLİT EDİLEN DAVRANIŞ GERÇEĞE SADIK OLMALI: kayıt aynı e-postayla
 * ikinci kez denendiğinde GoTrue'nun döndürdüğü hata kodu
 * (`user_already_exists`) burada da döner, çünkü test tam olarak o
 * kodun doğru mesaja çevrildiğini doğruluyor.
 */
import http from "node:http";
import crypto from "node:crypto";

/** `role` iddiası taşıyan sahte JWT — env.keyRole() bunu okur. */
export function fakeServiceKey(role = "service_role") {
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ role })}.signature`;
}

function matchFilter(row, key, expression) {
  const separator = String(expression).indexOf(".");
  const operator = separator > 0 ? expression.slice(0, separator) : "eq";
  const value = separator > 0 ? expression.slice(separator + 1) : expression;

  if (operator === "is" && value === "null") return row[key] === null || row[key] === undefined;
  if (operator === "in") {
    const list = value.replace(/^\(|\)$/g, "").split(",");
    return list.includes(String(row[key]));
  }
  return String(row[key]) === String(value);
}

export function createSupabaseStub() {
  /** Tablolar: ad → satır dizisi. */
  const tables = new Map();
  /** GoTrue kullanıcıları: e-posta → kayıt. */
  const users = new Map();
  const sessions = new Map();
  const state = { tables, users, sessions, signupRequiresConfirmation: false, requests: [] };

  const table = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };

  function issueSession(user) {
    const accessToken = crypto.randomUUID();
    const refreshToken = crypto.randomUUID();
    sessions.set(refreshToken, user.id);
    sessions.set(accessToken, user.id);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      token_type: "bearer",
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.metadata || {},
        email_confirmed_at: new Date().toISOString()
      }
    };
  }

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const url = new URL(req.url, "http://localhost");
      const body = raw ? JSON.parse(raw) : {};
      const send = (status, payload) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(payload === undefined ? "" : JSON.stringify(payload));
      };
      state.requests.push(`${req.method} ${url.pathname}`);

      // ---------------- GoTrue ----------------
      if (url.pathname === "/auth/v1/signup") {
        const email = String(body.email || "").toLowerCase();
        if (users.has(email)) {
          return send(400, { error_code: "user_already_exists", msg: "User already registered" });
        }
        const user = { id: crypto.randomUUID(), email, password: body.password, metadata: body.data || {} };
        users.set(email, user);
        if (state.signupRequiresConfirmation) {
          return send(200, { id: user.id, email, user_metadata: user.metadata, confirmed_at: null });
        }
        return send(200, issueSession(user));
      }

      if (url.pathname === "/auth/v1/token") {
        const grant = url.searchParams.get("grant_type");
        if (grant === "password") {
          const user = users.get(String(body.email || "").toLowerCase());
          if (!user || user.password !== body.password) {
            return send(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
          }
          return send(200, issueSession(user));
        }
        if (grant === "refresh_token") {
          const userId = sessions.get(body.refresh_token);
          if (!userId) return send(400, { msg: "Invalid Refresh Token" });
          const user = [...users.values()].find((item) => item.id === userId);
          return send(200, issueSession(user));
        }
        if (grant === "pkce") {
          const user = state.pkceUser;
          if (!user) return send(400, { msg: "invalid code" });
          return send(200, issueSession(user));
        }
        return send(400, { msg: "unsupported grant" });
      }

      if (url.pathname === "/auth/v1/logout") {
        return send(204);
      }

      if (url.pathname === "/auth/v1/user") {
        const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        const userId = sessions.get(token);
        if (!userId) return send(401, { msg: "invalid token" });
        const user = [...users.values()].find((item) => item.id === userId);
        return send(200, { id: user.id, email: user.email, user_metadata: user.metadata });
      }

      // ---------------- PostgREST ----------------
      if (url.pathname.startsWith("/rest/v1/")) {
        const name = url.pathname.replace("/rest/v1/", "");
        const rows = table(name);
        const filters = [...url.searchParams.entries()].filter(([key]) => !["select", "order", "limit", "on_conflict"].includes(key));
        const matches = (row) => filters.every(([key, expression]) => matchFilter(row, key, expression));

        if (req.method === "GET") {
          let found = rows.filter(matches);
          const order = url.searchParams.get("order");
          if (order) {
            const [field, direction] = order.split(".");
            found = found.slice().sort((a, b) => {
              const left = String(a[field] || "");
              const right = String(b[field] || "");
              return direction === "desc" ? right.localeCompare(left) : left.localeCompare(right);
            });
          }
          const limit = Number(url.searchParams.get("limit"));
          return send(200, limit > 0 ? found.slice(0, limit) : found);
        }

        if (req.method === "POST") {
          const conflict = String(url.searchParams.get("on_conflict") || "").split(",").filter(Boolean);
          const incoming = Array.isArray(body) ? body : [body];
          for (const row of incoming) {
            const existing = conflict.length
              ? rows.find((candidate) => conflict.every((key) => String(candidate[key]) === String(row[key])))
              : null;
            if (existing) {
              Object.assign(existing, row);
            } else {
              rows.push({ id: rows.length + 1, ...row });
            }
          }
          return send(201, []);
        }

        if (req.method === "PATCH") {
          for (const row of rows.filter(matches)) Object.assign(row, body);
          return send(204);
        }

        if (req.method === "DELETE") {
          const keep = rows.filter((row) => !matches(row));
          tables.set(name, keep);
          return send(204);
        }
      }

      return send(404, { msg: "not found" });
    });
  });

  return {
    state,
    table,
    listen: () => new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
    }),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
