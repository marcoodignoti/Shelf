const test = require("node:test");
const assert = require("node:assert");
const { createMdnsAdvertiser, buildAdvertisement, matchesServiceQuery, SERVICE_TYPE, SERVICE_PROTOCOL, LOCAL_SUFFIX } = require("./sync-mdns.cjs");

function mockDgram() {
  const events = {};
  let bindCallback = null;
  let closed = false;
  let boundSocket = null;
  const socket = {
    on: (event, handler) => { events[event] = handler; },
    bind: (port, cb) => { bindCallback = cb; boundSocket = socket; },
    setMulticastTTL: () => {},
    addMembership: () => {},
    dropMembership: () => {},
    close: () => { closed = true; },
    send: (buf, offset, length, port, addr) => {},
  };
  return { socket, events, get bindCallback() { return bindCallback; }, get closed() { return closed; }, get boundSocket() { return boundSocket; } };
}

test("buildAdvertisement produces valid DNS header with flags and record count", () => {
  const buf = buildAdvertisement({ name: "Shelf", port: 43201, txt: { v: "1" }, host: "192.168.1.5" });
  assert.ok(buf instanceof Buffer);
  assert.ok(buf.length > 40);
  // Header: id=0, flags=0x8400 (response authoritative)
  assert.strictEqual(buf.readUInt16BE(0), 0);
  assert.strictEqual(buf.readUInt16BE(2), 0x8400);
  // ANCOUNT should be > 0
  const ancount = buf.readUInt16BE(6);
  assert.ok(ancount >= 3, `expected at least 3 answers, got ${ancount}`);
});

test("buildAdvertisement includes PTR type in first answer", () => {
  const buf = buildAdvertisement({ name: "Shelf", port: 43201, txt: { v: "1" }, host: "192.168.1.5" });
  const headerLen = 12;
  // Skip name (starts at offset 12, variable) then 2 bytes type, 2 bytes class, 4 bytes TTL, 2 bytes rdlength, rdata
  // For PTR, the name is `_shelf-sync._tcp.local`
  const serviceNameBuf = Buffer.from(`\x0b_${SERVICE_TYPE}\x04_${SERVICE_PROTOCOL}\x05${LOCAL_SUFFIX}\x00`, "utf8");
  const firstAnswer = buf.slice(headerLen, headerLen + serviceNameBuf.length);
  assert.deepStrictEqual(firstAnswer, serviceNameBuf);
  const typeOffset = headerLen + serviceNameBuf.length;
  assert.strictEqual(buf.readUInt16BE(typeOffset), 12); // TYPE_PTR
});

test("buildAdvertisement encodes the TXT record correctly", () => {
  const buf = buildAdvertisement({ name: "Mine", port: 43202, txt: { v: "2" }, host: "10.0.0.1" });
  const bufStr = buf.toString("hex");
  // The TXT record RData should contain "v=2"
  assert.ok(bufStr.includes("763d32"), "expected TXT v=2 in hex");
});

test("createMdnsAdvertiser start/stop with mock dgram", async () => {
  const mock = mockDgram();
  const adv = createMdnsAdvertiser({
    name: "Test",
    port: 43203,
    txt: { v: "1" },
    host: "192.168.1.1",
    dgramImpl: { createSocket: () => mock.socket },
  });
  adv.start();
  assert.ok(mock.bindCallback, "bind callback should be set");
  assert.ok(!mock.closed, "socket should not close on start");
  // Simulate bind
  mock.bindCallback();
  adv.stop();
  assert.ok(mock.closed, "socket should close on stop");
});

test("no-op stop before start", () => {
  const adv = createMdnsAdvertiser({ name: "x", port: 1 });
  adv.stop();
});

test("matchesServiceQuery returns true for a valid PTR query", () => {
  const labels = [`_${SERVICE_TYPE}`, `_${SERVICE_PROTOCOL}`, LOCAL_SUFFIX];
  const name = labels.join(".");
  const queryBuf = Buffer.concat([
    Buffer.from([0x00, 0x01]), // id=1
    Buffer.from([0x00, 0x00]), // flags: standard query
    Buffer.from([0x00, 0x01]), // QDCOUNT=1
    Buffer.from([0x00, 0x00]), // ANCOUNT=0
    Buffer.from([0x00, 0x00]), // NSCOUNT=0
    Buffer.from([0x00, 0x00]), // ARCOUNT=0
    Buffer.from(`\x0b_${SERVICE_TYPE}\x04_${SERVICE_PROTOCOL}\x05${LOCAL_SUFFIX}\x00`),
    Buffer.from([0x00, 0x0c]), // TYPE_PTR (12)
    Buffer.from([0x00, 0x01]), // CLASS_IN (1)
  ]);
  assert.strictEqual(matchesServiceQuery(queryBuf), true);
});

test("matchesServiceQuery returns false for non-matching query", () => {
  const queryBuf = Buffer.concat([
    Buffer.from([0x00, 0x02]), // id=2
    Buffer.from([0x00, 0x00]),
    Buffer.from([0x00, 0x01]),
    Buffer.from([0x00, 0x00]),
    Buffer.from([0x00, 0x00]),
    Buffer.from([0x00, 0x00]),
    Buffer.from("\x05_http\x04_tcp\x05local\x00"),
    Buffer.from([0x00, 0x0c]),
    Buffer.from([0x00, 0x01]),
  ]);
  assert.strictEqual(matchesServiceQuery(queryBuf), false);
});

test("matchesServiceQuery returns false for response packets", () => {
  const labels = [`_${SERVICE_TYPE}`, `_${SERVICE_PROTOCOL}`, LOCAL_SUFFIX];
  const queryBuf = Buffer.concat([
    Buffer.from([0x00, 0x03]),
    Buffer.from([0x84, 0x00]), // flags: response
    Buffer.from([0x00, 0x01]),
    Buffer.from([0x00, 0x00]),
    Buffer.from([0x00, 0x00]),
    Buffer.from([0x00, 0x00]),
    Buffer.from(`\x0b_${SERVICE_TYPE}\x04_${SERVICE_PROTOCOL}\x05${LOCAL_SUFFIX}\x00`),
    Buffer.from([0x00, 0x0c]),
    Buffer.from([0x00, 0x01]),
  ]);
  assert.strictEqual(matchesServiceQuery(queryBuf), false);
});