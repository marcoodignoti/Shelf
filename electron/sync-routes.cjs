const { assertSafeInvokeArgs } = require("./backend-helpers.cjs");

function parsePath(url) {
  const [pathname, search] = url.split("?");
  const query = {};
  if (search) {
    for (const part of search.split("&")) {
      const [k, v] = part.split("=");
      if (k) query[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
    }
  }
  return { pathname, query };
}

// Maps REST requests to the existing backend.invoke(command, args) layer — no
// new database code. Pairing is the only unauthenticated route; every other
// route requires a valid device token (Bearer header).
function createRouteResolver({ backend, devices, pairing }) {
  async function requireDevice(authToken) {
    if (!authToken) return null;
    const device = devices.lookupByToken(authToken);
    if (!device) return null;
    devices.touchLastSeen(device.device_id);
    return device;
  }

  async function resolve({ method, path, headers, body, authToken }) {
    const { pathname, query } = parsePath(path);

    // Pairing is the only unauthenticated route.
    if (method === "POST" && pathname === "/pair") {
      if (!pairing) return { status: 501, body: { error: "pairing disabled" } };
      const { token, name, platform } = body || {};
      if (!token || !name || !platform) {
        return { status: 400, body: { error: "token, name, platform required" } };
      }
      let result;
      try {
        result = pairing.consumePairing({ token, name, platform });
      } catch (err) {
        return { status: 401, body: { error: err.message } };
      }
      const registered = devices.registerDevice({ name, platform, token: result.deviceToken });
      return { status: 200, body: { deviceToken: result.deviceToken, deviceId: registered.device_id } };
    }

    // Everything else requires a valid device token.
    const device = await requireDevice(authToken);
    if (!device) return { status: 401, body: { error: "unauthorized" } };

    try {
      if (method === "GET" && pathname === "/pages") {
        const pages = await backend.invoke("list_pages", {});
        const { since } = query;
        if (since && typeof since === "string") {
          const filtered = pages.filter((page) => page.updated_at > since);
          return { status: 200, body: filtered };
        }
        return { status: 200, body: pages };
      }
      if (method === "GET" && pathname.startsWith("/pages/")) {
        const id = decodeURIComponent(pathname.slice("/pages/".length));
        const page = await backend.invoke("get_page", { id });
        if (!page) return { status: 404, body: { error: "not found" } };
        return { status: 200, body: page };
      }
      if (method === "PUT" && pathname.startsWith("/pages/")) {
        const id = decodeURIComponent(pathname.slice("/pages/".length));
        const updates = body && typeof body === "object" ? body : {};
        const updatedAt = new Date().toISOString();
        assertSafeInvokeArgs("update_page", { id, updates, updatedAt });
        await backend.invoke("update_page", { id, updates, updatedAt });
        return { status: 204, body: null };
      }
      if (method === "POST" && pathname === "/pages") {
        const { id, title, parentId } = body || {};
        if (!id) return { status: 400, body: { error: "id required" } };
        const createdAt = new Date().toISOString();
        await backend.invoke("create_page", { id, title, parentId, createdAt });
        return { status: 201, body: { id } };
      }
      if (method === "DELETE" && pathname.startsWith("/pages/")) {
        const id = decodeURIComponent(pathname.slice("/pages/".length));
        await backend.invoke("delete_page", { id });
        return { status: 204, body: null };
      }
      return { status: 404, body: { error: "not found" } };
    } catch (err) {
      return { status: 500, body: { error: String(err.message || err) } };
    }
  }

  return { resolve };
}

module.exports = { createRouteResolver };
