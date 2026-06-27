// Advertises the sync server on the local network as _shelf-sync._tcp so a
// phone on the same Wi-Fi can discover "Shelf on Marco's MacBook" without
// typing an IP address. Uses node:dgram directly (no third-party mDNS
// dependency) so the Electron main stays self-contained and ships in the asar.
//
// The DNS-SD packet builder is exported as `buildAdvertisement` so the wire
// format is unit-tested without needing a live multicast socket.

const dgram = require("node:dgram");
const os = require("node:os");

const MDNS_ADDRESS = "224.0.0.251";
const MDNS_PORT = 5353;
const SERVICE_TYPE = "shelf-sync";
const SERVICE_PROTOCOL = "tcp";
const LOCAL_SUFFIX = "local";
const TTL = 4500;
const DEFAULT_TTL = 120;
const ANNOUNCE_INTERVAL_MS = 60_000;

const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;
const CLASS_IN = 1;
const CLASS_IN_FLUSH = 0x8001; // cache-flush bit set for mDNS records on .local
const FLAGS_RESPONSE_AUTHORITATIVE = 0x8400;

function writeUint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}
function writeUint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}
function writeUint8(value) {
  return Buffer.from([value]);
}

function encodeName(labels) {
  const parts = [];
  for (const label of labels) {
    const bytes = Buffer.from(label, "utf8");
    if (bytes.length > 63) throw new Error(`mDNS label too long: ${label}`);
    parts.push(writeUint8(bytes.length), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function rdataRecord(nameLabels, type, rdata) {
  // For mDNS on .local we set the cache-flush bit so stale peers drop the old record.
  return Buffer.concat([
    encodeName(nameLabels),
    writeUint16(type),
    writeUint16(CLASS_IN_FLUSH),
    writeUint32(TTL),
    writeUint16(rdata.length),
    rdata,
  ]);
}

function txtRdata(entries) {
  const parts = [];
  for (const [key, value] of Object.entries(entries || {})) {
    const entry = `${key}=${value}`;
    const bytes = Buffer.from(entry, "utf8");
    if (bytes.length > 255) throw new Error(`mDNS TXT entry too long: ${entry}`);
    parts.push(writeUint8(bytes.length), bytes);
  }
  if (parts.length === 0) parts.push(writeUint8(0));
  return Buffer.concat(parts);
}

function aRdata(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`invalid IPv4 for mDNS A record: ${ip}`);
  }
  return Buffer.from(parts);
}

function srvRdata(port, targetLabels) {
  return Buffer.concat([
    writeUint16(0), // priority
    writeUint16(0), // weight
    writeUint16(port),
    encodeName(targetLabels),
  ]);
}

// Pure packet builder: no sockets, no side effects.
// Returns a Buffer containing a DNS-SD response packet advertising this host.
function buildAdvertisement({ name, port, txt, host }) {
  const instanceLabels = [name, `_${SERVICE_TYPE}`, `_${SERVICE_PROTOCOL}`, LOCAL_SUFFIX];
  const serviceLabels = [`_${SERVICE_TYPE}`, `_${SERVICE_PROTOCOL}`, LOCAL_SUFFIX];
  const hostLabels = host ? [host, LOCAL_SUFFIX] : [os.hostname(), LOCAL_SUFFIX];

  const answers = [
    rdataRecord(serviceLabels, TYPE_PTR, encodeName(instanceLabels)),
    rdataRecord(instanceLabels, TYPE_SRV, srvRdata(port, hostLabels)),
    rdataRecord(instanceLabels, TYPE_TXT, txtRdata(txt)),
  ];
  if (host) {
    const hostIps = privateIpv4s();
    for (const ip of hostIps) {
      answers.push(rdataRecord(hostLabels, TYPE_A, aRdata(ip)));
    }
  }

  const header = Buffer.concat([
    writeUint16(0),
    writeUint16(FLAGS_RESPONSE_AUTHORITATIVE),
    writeUint16(0),
    writeUint16(answers.length),
    writeUint16(0),
    writeUint16(0),
  ]);
  return Buffer.concat([header, ...answers]);
}

function privateIpv4s() {
  const results = [];
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const iface of list || []) {
      if (!iface.internal && iface.family === "IPv4") {
        results.push(iface.address);
      }
    }
  }
  return results;
}

// Returns true if the incoming buffer is a query asking for our service PTR,
// i.e. contains a question for _shelf-sync._tcp.local of type PTR.
function matchesServiceQuery(buffer) {
  if (buffer.length < 12) return false;
  const id = buffer.readUInt16BE(0);
  if (id === 0) return false;
  const flags = buffer.readUInt16BE(2);
  const isResponse = (flags & 0x8000) !== 0;
  if (isResponse) return false;
  const qdcount = buffer.readUInt16BE(4);
  if (qdcount === 0) return false;
  const serviceLabels = [`_${SERVICE_TYPE}`, `_${SERVICE_PROTOCOL}`, LOCAL_SUFFIX];
  let offset = 12;
  outer: for (let i = 0; i < qdcount; i++) {
    const labels = [];
    while (offset < buffer.length) {
      const len = buffer[offset];
      offset += 1;
      // Compression pointer: not valid in questions but tolerate.
      if (len === 0) break;
      if ((len & 0xc0) === 0xc0) return false;
      if (offset + len > buffer.length) return false;
      labels.push(buffer.toString("utf8", offset, offset + len));
      offset += len;
    }
    if (offset + 4 > buffer.length) return false;
    const type = buffer.readUInt16BE(offset);
    offset += 4;
    if (type === TYPE_PTR && labels.join(".").toLowerCase() === serviceLabels.join(".").toLowerCase()) {
      return true;
    }
  }
  return false;
}

function createMdnsAdvertiser({ name, port, txt, host, dgramImpl, sendImpl }) {
  const dgramLib = dgramImpl || dgram;
  let socket = null;
  let intervalHandle = null;
  let stopped = false;

  function sendOnce() {
    if (!socket || stopped) return;
    const packet = buildAdvertisement({ name, port, txt, host });
    const sender = sendImpl || ((buf) => socket.send(buf, 0, buf.length, MDNS_PORT, MDNS_ADDRESS));
    try {
      sender(packet);
    } catch {
      // Ignore transient send failures; mDNS is best-effort.
    }
  }

  function start() {
    if (socket) return;
    stopped = false;
    socket = dgramLib.createSocket({ type: "udp4", reuseAddr: true });
    socket.on("error", () => {
      // Silent: mDNS is best-effort; never crash the main on advertisement errors.
    });
    socket.on("message", (message) => {
      if (matchesServiceQuery(message)) sendOnce();
    });
    socket.bind(MDNS_PORT, () => {
      try {
        socket.setMulticastTTL(255);
        socket.addMembership(MDNS_ADDRESS);
      } catch {
        // Ignore membership errors (e.g. missing interface) — still send announces.
      }
      sendOnce();
      // Periodic re-announce keeps the record fresh for late joiners.
      intervalHandle = setInterval(sendOnce, ANNOUNCE_INTERVAL_MS).unref();
    });
  }

  function stop() {
    stopped = true;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (socket) {
      try {
        socket.dropMembership(MDNS_ADDRESS);
      } catch {
        // No-op: socket may already be closed or membership never set.
      }
      socket.close();
      socket = null;
    }
  }

  return { start, stop };
}

module.exports = {
  createMdnsAdvertiser,
  buildAdvertisement,
  matchesServiceQuery,
  SERVICE_TYPE,
  SERVICE_PROTOCOL,
  LOCAL_SUFFIX,
};