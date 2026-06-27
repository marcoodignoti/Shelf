const net = require("node:net");

function ipv4ToLong(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inRange(ip, base, mask) {
  return (ipv4ToLong(ip) & mask) === (base & mask);
}

const RFC1918 = [
  { base: ipv4ToLong("10.0.0.0"), mask: 0xff000000 }, // 10.0.0.0/8
  { base: ipv4ToLong("172.16.0.0"), mask: 0xfff00000 }, // 172.16.0.0/12 (172.16 – 172.31)
  { base: ipv4ToLong("192.168.0.0"), mask: 0xffff0000 }, // 192.168.0.0/16
];

// True for loopback, link-local IPv6, and RFC1918 private IPv4 ranges. Used to
// gate which interfaces the sync server is allowed to advertise on, so the
// desktop never accidentally exposes Shelf on a public interface.
function isPrivateHost(host) {
  if (host === "127.0.0.1" || host === "localhost") return true;
  if (host === "::1") return true; // IPv6 loopback
  if (host.startsWith("fe80")) return true; // IPv6 link-local
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false; // not an IPv4 literal (e.g. hostname)
  const value = ipv4ToLong(host);
  return RFC1918.some((range) => (value & range.mask) === (range.base & range.mask));
}

// Finds the first free TCP port in [start, end] inclusive. Rejects if none free.
function pickPort({ start, end }) {
  return new Promise((resolve, reject) => {
    function tryAt(port) {
      if (port > end) return reject(new Error(`no free port in ${start}-${end}`));
      const srv = net.createServer();
      srv.unref();
      srv.on("error", () => tryAt(port + 1));
      srv.listen(port, "0.0.0.0", () => {
        const chosen = srv.address().port;
        srv.close(() => resolve(chosen));
      });
    }
    tryAt(start);
  });
}

module.exports = { isPrivateHost, pickPort };
