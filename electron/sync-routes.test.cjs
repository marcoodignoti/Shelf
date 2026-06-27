const test = require("node:test");
const assert = require("node:assert");
const { createRouteResolver } = require("./sync-routes.cjs");

function makeResolver() {
  const calls = [];
  const backend = {
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "list_pages") return [{ id: "p1", title: "Page One" }];
      if (command === "get_page") return { id: args.id, title: "got" };
      if (command === "create_page") return { id: args.id, title: args.title };
      return undefined;
    },
  };
  const devices = {
    lookupByToken: (t) => (t === "good" ? { device_id: "dev:1" } : null),
    registerDevice: ({ name, platform, token }) => ({ device_id: "dev:x", name, platform }),
    touchLastSeen: () => {},
  };
  return { resolver: createRouteResolver({ backend, devices }), calls };
}

test("GET /pages maps to list_pages", async () => {
  const { resolver, calls } = makeResolver();
  const res = await resolver.resolve({ method: "GET", path: "/pages", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, [{ id: "p1", title: "Page One" }]);
  assert.strictEqual(calls[0].command, "list_pages");
});

test("GET /pages?since= filters pages by updated_at", async () => {
  const backend = {
    invoke: async (command) => {
      if (command === "list_pages") {
        return [
          { id: "old", title: "Old", updated_at: "2025-01-01T00:00:00Z" },
          { id: "recent", title: "Recent", updated_at: "2026-06-01T00:00:00Z" },
          { id: "missing", title: "No Date" },
        ];
      }
      return null;
    },
  };
  const devices = { lookupByToken: () => ({ device_id: "dev:1" }), touchLastSeen: () => {} };
  const resolver = createRouteResolver({ backend, devices });
  // Pages updated after the cursor.
  const res = await resolver.resolve({ method: "GET", path: "/pages?since=2026-01-01T00:00:00Z", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 200);
  const ids = res.body.map((p) => p.id);
  assert.ok(ids.includes("recent"));
  assert.ok(!ids.includes("old"));
  assert.ok(!ids.includes("missing"), "pages without updated_at cannot be newer than the cursor");
});

test("GET /pages without since returns all pages", async () => {
  const backend = {
    invoke: async (command) => {
      if (command === "list_pages") {
        return [
          { id: "p1", updated_at: "2025-01-01T00:00:00Z" },
          { id: "p2", updated_at: "2026-01-01T00:00:00Z" },
        ];
      }
      return null;
    },
  };
  const devices = { lookupByToken: () => ({ device_id: "dev:1" }), touchLastSeen: () => {} };
  const resolver = createRouteResolver({ backend, devices });
  const res = await resolver.resolve({ method: "GET", path: "/pages", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.length, 2);
});

test("GET /pages/:id maps to get_page", async () => {
  const { resolver, calls } = makeResolver();
  const res = await resolver.resolve({ method: "GET", path: "/pages/p1", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(calls[0].command, "get_page");
  assert.strictEqual(calls[0].args.id, "p1");
});

test("GET unknown page returns 404", async () => {
  const backend = { invoke: async () => null };
  const devices = { lookupByToken: () => ({ device_id: "dev:1" }), touchLastSeen: () => {} };
  const resolver = createRouteResolver({ backend, devices });
  const res = await resolver.resolve({ method: "GET", path: "/pages/missing", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 404);
});

test("PUT /pages/:id maps to update_page with id + updates + updatedAt", async () => {
  const { resolver, calls } = makeResolver();
  const res = await resolver.resolve({
    method: "PUT",
    path: "/pages/p1",
    headers: {},
    body: { title: "New", content: "xyz" },
    authToken: "good",
  });
  assert.strictEqual(res.status, 204);
  assert.strictEqual(calls[0].command, "update_page");
  assert.strictEqual(calls[0].args.id, "p1");
  assert.deepStrictEqual(calls[0].args.updates.title, "New");
  assert.ok(calls[0].args.updatedAt);
});

test("POST /pages maps to create_page", async () => {
  const { resolver, calls } = makeResolver();
  const res = await resolver.resolve({
    method: "POST",
    path: "/pages",
    headers: {},
    body: { id: "new1", title: "Created" },
    authToken: "good",
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(calls[0].command, "create_page");
  assert.strictEqual(calls[0].args.id, "new1");
});

test("POST /pages without id is 400", async () => {
  const { resolver } = makeResolver();
  const res = await resolver.resolve({ method: "POST", path: "/pages", headers: {}, body: {}, authToken: "good" });
  assert.strictEqual(res.status, 400);
});

test("DELETE /pages/:id maps to delete_page", async () => {
  const { resolver, calls } = makeResolver();
  const res = await resolver.resolve({ method: "DELETE", path: "/pages/p1", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 204);
  assert.strictEqual(calls[0].command, "delete_page");
});

test("unauthenticated request is 401", async () => {
  const { resolver } = makeResolver();
  const res = await resolver.resolve({ method: "GET", path: "/pages", headers: {}, body: null, authToken: null });
  assert.strictEqual(res.status, 401);
});

test("unknown path is 404", async () => {
  const { resolver } = makeResolver();
  const res = await resolver.resolve({ method: "GET", path: "/nope", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 404);
});

test("POST /pair is unauthenticated and consumes the pairing token", async () => {
  let paired = null;
  const backend = { invoke: async () => undefined };
  const devices = {
    lookupByToken: () => null,
    registerDevice: ({ name, platform, token }) => (paired = { name, platform, token }),
    touchLastSeen: () => {},
  };
  const pairing = { consumePairing: ({ token, name, platform }) => ({ deviceToken: "dt-" + token }) };
  const resolver = createRouteResolver({ backend, devices, pairing });
  const res = await resolver.resolve({
    method: "POST",
    path: "/pair",
    headers: {},
    body: { token: "pair-token", name: "iPhone", platform: "ios" },
    authToken: null,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.deviceToken, "dt-pair-token");
  assert.deepStrictEqual(paired.name, "iPhone");
});

test("POST /pair with missing fields is 400", async () => {
  const resolver = createRouteResolver({
    backend: { invoke: async () => undefined },
    devices: { lookupByToken: () => null, registerDevice: () => ({}), touchLastSeen: () => {} },
    pairing: { consumePairing: () => ({ deviceToken: "x" }) },
  });
  const res = await resolver.resolve({ method: "POST", path: "/pair", headers: {}, body: { token: "x" }, authToken: null });
  assert.strictEqual(res.status, 400);
});
