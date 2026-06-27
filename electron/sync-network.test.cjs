const test = require("node:test");
const assert = require("node:assert");
const { isPrivateHost, pickPort } = require("./sync-network.cjs");

test("isPrivateHost accepts RFC1918 addresses", () => {
  assert.strictEqual(isPrivateHost("192.168.1.5"), true);
  assert.strictEqual(isPrivateHost("10.0.0.1"), true);
  assert.strictEqual(isPrivateHost("172.16.0.1"), true);
  assert.strictEqual(isPrivateHost("172.31.255.255"), true);
});

test("isPrivateHost rejects public addresses", () => {
  assert.strictEqual(isPrivateHost("8.8.8.8"), false);
  assert.strictEqual(isPrivateHost("172.32.0.1"), false); // outside the private 172.16/12 range
  assert.strictEqual(isPrivateHost("203.0.113.5"), false);
});

test("isPrivateHost accepts loopback", () => {
  assert.strictEqual(isPrivateHost("127.0.0.1"), true);
});

test("isPrivateHost accepts IPv6 loopback and link-local", () => {
  assert.strictEqual(isPrivateHost("::1"), true);
  assert.strictEqual(isPrivateHost("fe80::1"), true);
});

test("isPrivateHost rejects hostnames (non-IP)", () => {
  assert.strictEqual(isPrivateHost("example.com"), false);
});

test("pickPort returns a free port in the configured range", async () => {
  const port = await pickPort({ start: 43200, end: 43210 });
  assert.ok(port >= 43200 && port <= 43210);
});

test("pickPort throws when the whole range is occupied", async () => {
  // Occupy the entire small range with listeners, then assert pickPort rejects.
  const net = require("node:net");
  const servers = [];
  for (let p = 43900; p <= 43902; p++) {
    const s = net.createServer();
    await new Promise((resolve) => s.listen(p, "0.0.0.0", resolve));
    servers.push(s);
  }
  await assert.rejects(() => pickPort({ start: 43900, end: 43902 }));
  for (const s of servers) s.close();
});
