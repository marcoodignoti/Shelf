// Advertises the sync server on the local network as _shelf-sync._tcp so a
// phone on the same Wi-Fi can discover "Shelf on Marco's MacBook" without
// typing an IP address. bonjourService is injectable for testing.
function createMdnsAdvertiser({ bonjourModule, name, port, txt }) {
  const real = bonjourModule || require("bonjour-service");
  const Bonjour = real.Bonjour || real;
  let bonjour = null;
  let service = null;

  function start() {
    if (service) return; // idempotent
    bonjour = new Bonjour();
    service = bonjour.publish({
      name,
      type: "shelf-sync",
      protocol: "tcp",
      port,
      txt: txt || {},
    });
  }

  function stop() {
    if (service) {
      service.stop();
      service = null;
    }
    if (bonjour) {
      bonjour.destroy();
      bonjour = null;
    }
  }

  return { start, stop };
}

module.exports = { createMdnsAdvertiser };
