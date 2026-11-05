/**
 * Bu derleme bir Vercel Deploy Hook ile mi tetiklendi?
 *
 * Vercel, Ignored Build Step'e bunu söyleyen bir sistem değişkeni VERMİYOR
 * (bkz. community.vercel.com/t/environment-variable-for-deploy-hooks/6155).
 * Güvenilir tek sinyal dağıtımın kendi meta verisidir: hook ile açılan
 * dağıtımlarda `meta.deployHookId` dolu gelir. Bunu okumak için Vercel API'ye
 * salt-okunur bir token gerekir:
 *
 *   BUILD_DECISION_VERCEL_TOKEN  (isteğe bağlı, Build ortamında; yalnız okuma)
 *   VERCEL_DEPLOYMENT_ID         (Vercel sistem değişkeni, derlemede mevcut)
 *   VERCEL_TEAM_ID / BUILD_DECISION_VERCEL_TEAM_ID (ekip projesiyse)
 *
 * Token yoksa ya da API cevap vermezse `null` döner ve buildDecision eski
 * kurallarına (aynı commit = yeniden derle) devam eder. Asla hata fırlatmaz.
 *
 * Elle zorlamak için: FUTBOLRADAR_FORCE_BUILD=1 (ör. Vercel'de "Redeploy"
 * öncesi geçici olarak) → her zaman derle.
 */
export async function deployHookTrigger(env = process.env, fetcher = globalThis.fetch, timeoutMs = 5000) {
  const token = String(env.BUILD_DECISION_VERCEL_TOKEN || "").trim();
  const id = String(env.VERCEL_DEPLOYMENT_ID || "").trim();
  if (!token || !id || typeof fetcher !== "function") return null;
  const team = String(env.BUILD_DECISION_VERCEL_TEAM_ID || env.VERCEL_TEAM_ID || "").trim();
  const url = `https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}${team ? `?teamId=${encodeURIComponent(team)}` : ""}`;
  try {
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!res || !res.ok) return null;
    const body = await res.json();
    const meta = (body && body.meta) || {};
    return Boolean(meta.deployHookId || meta.deployHookName);
  } catch {
    return null;
  }
}
