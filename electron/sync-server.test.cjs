const test = require("node:test");
const assert = require("node:assert");
const https = require("node:https");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  runSyncDeviceMigration,
  SYNC_DEVICE_TOKEN_BYTES,
} = require("./backend-helpers.cjs");
const { generateToken } = require("./sync-tokens.cjs");
const { createSyncDeviceStore } = require("./sync-devices.cjs");
const { createPairingController } = require("./sync-pairing.cjs");
const { createRouteResolver } = require("./sync-routes.cjs");
const { createSyncServer } = require("./sync-server.cjs");

function tempConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shelf-sync-"));
}

function makeStack() {
  const configDir = tempConfigDir();
  const db = new DatabaseSync(":memory:");
  runSyncDeviceMigration(db);
  const pages = new Map();
  const backend = {
    invoke: async (command, args) => {
      if (command === "list_pages") return [...pages.values()];
      if (command === "get_page") return pages.get(args.id) ?? null;
      if (command === "update_page") {
        const p = pages.get(args.id);
        pages.set(args.id, { ...p, ...args.updates, updated_at: args.updatedAt });
        return;
      }
      if (command === "create_page") {
        pages.set(args.id, { id: args.id, title: args.title });
        return;
      }
      if (command === "delete_page") {
        const p = pages.get(args.id);
        if (p) pages.set(args.id, { ...p, is_deleted: 1 });
        return;
      }
      return undefined;
    },
  };
  const devices = createSyncDeviceStore(db);
  const pairing = createPairingController({
    port: 0,
    hostCandidates: ["127.0.0.1"],
    certFingerprint: "",
  });
  const resolver = createRouteResolver({ backend, devices, pairing });
  return { configDir, db, devices, pairing, resolver, pages };
}

function request(server, { method, path, body, token }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        agent: false, // avoid TLS session reuse across test runs (each server has a distinct cert)
        method,
        hostname: "127.0.0.1",
        port: server.port,
        path,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        rejectUnauthorized: false, // self-signed test cert
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("e2e: list_pages is 401 without token, 200 with a registered device token", async () => {
  const stack = makeStack();
  const server = createSyncServer({
    configDir: stack.configDir,
    resolver: stack.resolver,
    portRange: { start: 43200, end: 43299 },
  });
  await server.start();
  try {
    const unauth = await request(server, { method: "GET", path: "/pages" });
    assert.strictEqual(unauth.status, 401);

    const token = generateToken(SYNC_DEVICE_TOKEN_BYTES);
    stack.devices.registerDevice({ name: "iPhone", platform: "ios", token });
    const auth = await request(server, { method: "GET", path: "/pages", token });
    assert.strictEqual(auth.status, 200);
    assert.ok(Array.isArray(auth.body));
  } finally {
    await server.stop();
    fs.rmSync(stack.configDir, { recursive: true, force: true });
  }
});

test("e2e: PUT a page then GET it back", async () => {
  const stack = makeStack();
  const server = createSyncServer({
    configDir: stack.configDir,
    resolver: stack.resolver,
    portRange: { start: 43200, end: 43299 },
  });
  await server.start();
  try {
    const token = generateToken(SYNC_DEVICE_TOKEN_BYTES);
    stack.devices.registerDevice({ name: "iPhone", platform: "ios", token });
    const put = await request(server, {
      method: "PUT",
      path: "/pages/p1",
      body: { title: "Hello", content: "world" },
      token,
    });
    assert.strictEqual(put.status, 204);
    const get = await request(server, { method: "GET", path: "/pages/p1", token });
    assert.strictEqual(get.status, 200);
    assert.strictEqual(get.body.title, "Hello");
  } finally {
    await server.stop();
    fs.rmSync(stack.configDir, { recursive: true, force: true });
  }
});

test("e2e: a revoked device token is rejected", async () => {
  const stack = makeStack();
  const server = createSyncServer({
    configDir: stack.configDir,
    resolver: stack.resolver,
    portRange: { start: 43200, end: 43299 },
  });
  await server.start();
  try {
    const token = generateToken(SYNC_DEVICE_TOKEN_BYTES);
    const dev = stack.devices.registerDevice({ name: "iPhone", platform: "ios", token });
    stack.devices.revokeDevice(dev.device_id);
    const res = await request(server, { method: "GET", path: "/pages", token });
    assert.strictEqual(res.status, 401);
  } finally {
    await server.stop();
    fs.rmSync(stack.configDir, { recursive: true, force: true });
  }
});

test("e2e: server start/stop is idempotent", async () => {
  const stack = makeStack();
  const server = createSyncServer({
    configDir: stack.configDir,
    resolver: stack.resolver,
    portRange: { start: 43200, end: 43299 },
  });
  await server.start();
  await server.stop();
  await server.stop(); // no throw on double stop
  fs.rmSync(stack.configDir, { recursive: true, force: true });
});
