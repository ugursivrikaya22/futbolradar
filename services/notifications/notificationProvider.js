const REQUIRED_METHODS = Object.freeze(["subscribe", "unsubscribe", "send"]);

function assertNotificationProvider(provider) {
  const missing = REQUIRED_METHODS.filter((method) => !provider || typeof provider[method] !== "function");
  if (missing.length) throw new TypeError(`NotificationProvider eksik metotlar: ${missing.join(", ")}`);
  return provider;
}

function normalizeSubscription(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    subscriberId: String(source.subscriberId || ""),
    channel: String(source.channel || "web-push"),
    teamId: source.teamId || null,
    competitionId: source.competitionId || null,
    notificationType: source.notificationType || "match-start",
    enabled: source.enabled !== false,
    createdAt: source.createdAt || new Date().toISOString()
  };
}

module.exports = { REQUIRED_METHODS, assertNotificationProvider, normalizeSubscription };
