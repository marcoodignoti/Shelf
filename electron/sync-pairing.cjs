const { generateToken } = require("./sync-tokens.cjs");
const {
  SYNC_PAIRING_TOKEN_BYTES,
  SYNC_PAIRING_TOKEN_TTL_MS,
  SYNC_PIN_DIGITS,
  SYNC_DEVICE_TOKEN_BYTES,
} = require("./backend-helpers.cjs");

// Issues short-lived pairing tokens that a phone exchanges (once, before TTL)
// for a long-lived device token. The controller itself is DB-free: it returns
// the device token, and the caller (sync-server wiring) is responsible for
// registering it with the device store so the hash is persisted.
function createPairingController({ port, hostCandidates, certFingerprint, ttlMs }) {
  const ttl = ttlMs ?? SYNC_PAIRING_TOKEN_TTL_MS;
  const sessions = new Map(); // pairingToken -> { pin, host, expiresAt, consumed }

  function pickHost() {
    return hostCandidates && hostCandidates.length ? hostCandidates[0] : "127.0.0.1";
  }

  function startPairing() {
    const pairingToken = generateToken(SYNC_PAIRING_TOKEN_BYTES);
    const pin = String(Math.floor(Math.random() * 10 ** SYNC_PIN_DIGITS)).padStart(SYNC_PIN_DIGITS, "0");
    const host = pickHost();
    const expiresAt = Date.now() + ttl;
    sessions.set(pairingToken, { pin, host, expiresAt, consumed: false });
    const qrPayload = `https://${host}:${port}/pair?token=${pairingToken}`;
    return { pairingToken, pin, qrPayload, expiresAt };
  }

  function consumePairing({ token, name, platform }) {
    const session = sessions.get(token);
    if (!session || session.consumed) throw new Error("invalid or expired pairing token");
    if (Date.now() > session.expiresAt) {
      sessions.delete(token);
      throw new Error("expired pairing token");
    }
    session.consumed = true;
    sessions.delete(token);
    const deviceToken = generateToken(SYNC_DEVICE_TOKEN_BYTES);
    return { deviceToken };
  }

  function currentSession() {
    // For the UI to poll the QR/PIN while a pairing is pending.
    const entry = [...sessions.entries()].find(([, s]) => !s.consumed && Date.now() <= s.expiresAt);
    if (!entry) return null;
    const [token, s] = entry;
    return {
      pairingToken: token,
      pin: s.pin,
      qrPayload: `https://${s.host}:${port}/pair?token=${token}`,
      expiresAt: s.expiresAt,
    };
  }

  function cancel() {
    sessions.clear();
  }

  return { startPairing, consumePairing, currentSession, cancel };
}

module.exports = { createPairingController };
