// The public v1 key returns only one home fixture per endpoint. A successful
// limited feed is an incremental supplement, not a complete window snapshot.
export function calendarCoverage({ publicKey, failures, previousCount, incomingCount }) {
  if (!incomingCount) return { safe: false, mode: 'empty' };
  if (publicKey) return { safe: failures === 0, mode: 'limited-home-fixtures' };
  return { safe: !(previousCount >= 6 && incomingCount < previousCount * 0.5), mode: 'provider-window' };
}
