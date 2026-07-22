const { normalizeSubscription } = require("./notificationProvider");

function disabledError() {
  const error = new Error("Bildirim sağlayıcısı production ortamında etkin değil.");
  error.code = "NOTIFICATION_PROVIDER_DISABLED";
  return error;
}

module.exports = {
  name: "disabled-dev-provider",
  async subscribe(input) {
    return { ok: false, subscription: normalizeSubscription(input), error: disabledError().code };
  },
  async unsubscribe() {
    return { ok: false, error: disabledError().code };
  },
  async send() {
    throw disabledError();
  }
};
