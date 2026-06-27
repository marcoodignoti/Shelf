const test = require("node:test");
const assert = require("node:assert");
const { createMdnsAdvertiser } = require("./sync-mdns.cjs");

// Inject a fake bonjour module so the test does not touch the real network.
function mockBonjour() {
  const published = [];
  const destroyed = [];
  function FakeBonjour() {}
  FakeBonjour.prototype.publish = function (opts) {
    published.push(opts);
    const service = { stop: () => destroyed.push(opts) };
    return service;
  };
  FakeBonjour.prototype.destroy = function () {};
  return { published, destroyed, Bonjour: FakeBonjour };
}

test("start advertises _shelf-sync._tcp with port and name, stop tears it down", () => {
  const mock = mockBonjour();
  const adv = createMdnsAdvertiser({
    bonjourModule: mock,
    name: "Shelf on Marco's MacBook",
    port: 43201,
    txt: { v: "0.5.0" },
  });
  adv.start();
  assert.strictEqual(mock.published.length, 1);
  assert.strictEqual(mock.published[0].type, "shelf-sync");
  assert.strictEqual(mock.published[0].protocol, "tcp");
  assert.strictEqual(mock.published[0].port, 43201);
  assert.strictEqual(mock.published[0].name, "Shelf on Marco's MacBook");
  adv.stop();
  assert.strictEqual(mock.destroyed.length, 1);
});

test("start without calling is a no-op; double start does not re-publish", () => {
  const mock = mockBonjour();
  const adv = createMdnsAdvertiser({ bonjourModule: mock, name: "x", port: 1 });
  adv.stop(); // nothing started — no throw
  adv.start();
  adv.start(); // idempotent — no second publish
  assert.strictEqual(mock.published.length, 1);
  adv.stop();
});

test("defaults to the real bonjour-service module when none injected", () => {
  // Just verify it constructs without throwing; we do not assert on the real
  // network. The advertiser is lazy — nothing is published until start().
  const adv = createMdnsAdvertiser({ name: "x", port: 1 });
  assert.ok(adv);
  assert.strictEqual(typeof adv.start, "function");
  assert.strictEqual(typeof adv.stop, "function");
});
