import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 57, 126, 117, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

function worker(bindings = {}) {
  return new Miniflare({
    modules: true,
    scriptPath: new URL("../src/index.js", import.meta.url).pathname,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    r2Buckets: ["MEDIA"],
    compatibilityDate: "2026-03-01",
    bindings: {
      GUEST_PIN_LSU: "pin-lsu",
      GUEST_PIN_KENTUCKY: "pin-kentucky",
      OWNER_TOKEN: "owner-test",
      UPLOADS_ENABLED: "true",
      POSTS_ENABLED: "true",
      ...bindings,
    },
  });
}

async function call(mf, path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body instanceof Uint8Array && !headers.has("content-length")) headers.set("content-length", String(body.byteLength));
  if (body && !(body instanceof Uint8Array) && typeof body !== "string") {
    body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  const response = await mf.dispatchFetch(`http://unit.test${path}`, { method: options.method || "GET", headers, body });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return { status: response.status, payload };
}

test("Alabama stays closed until its own guest secret is set", async () => {
  const mf = worker();
  try {
    const closed = await call(mf, "/v1/alabama/files", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(closed.status, 503);
    assert.equal(closed.payload.error, "Sharing is not configured.");
    assert.equal(JSON.stringify(closed.payload).includes("pin-lsu"), false);
    const health = await call(mf, "/health");
    assert.equal(health.payload.games.alabama, false);
    assert.equal(JSON.stringify(health.payload).includes("pin-alabama"), false);
  } finally {
    await mf.dispose();
  }
});

test("Alabama photos and messages stay in their own namespace", async () => {
  const mf = worker({ GUEST_PIN_ALABAMA: "pin-alabama" });
  try {
    const wrong = await call(mf, "/v1/alabama/files", { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(wrong.status, 401);
    const otherWay = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-alabama" } });
    assert.equal(otherWay.status, 401);
    const upload = await call(mf, "/v1/alabama/files", {
      method: "POST",
      headers: {
        "x-guest-pin": "pin-alabama",
        "x-guest-name": "Local test",
        "x-file-name": "alabama-only.png",
        "content-type": "image/png",
      },
      body: PNG,
    });
    assert.equal(upload.status, 201);
    assert.match(upload.payload.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const alabama = await call(mf, "/v1/alabama/files", { headers: { "x-guest-pin": "pin-alabama" } });
    assert.equal(alabama.payload.files.length, 1);
    assert.equal(alabama.payload.files[0].name, "alabama-only.png");
    const lsu = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
    const kentucky = await call(mf, "/v1/kentucky/files", { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(lsu.payload.files.length, 0);
    assert.equal(kentucky.payload.files.length, 0);
    const crossed = await call(mf, `/v1/lsu/files/${upload.payload.id}`, { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(crossed.status, 404);
    const own = await call(mf, `/v1/alabama/files/${upload.payload.id}`, { headers: { "x-guest-pin": "pin-alabama" } });
    assert.equal(own.status, 200);
    assert.equal(own.payload.length, PNG.length);

    const text = "Alabama line.\n\nSecond line y'all.";
    const post = await call(mf, "/v1/alabama/posts", {
      method: "POST",
      headers: { "x-guest-pin": "pin-alabama" },
      body: { name: "Local test", text },
    });
    assert.equal(post.status, 201);
    assert.equal(post.payload.post.text, text);
    const reply = await call(mf, `/v1/alabama/posts/${post.payload.post.id}`, {
      method: "POST",
      headers: { "x-guest-pin": "pin-alabama" },
      body: { name: "Local test", text: "c".repeat(1000) },
    });
    assert.equal(reply.status, 201);
    assert.equal(reply.payload.post.replies[0].text.length, 1000);
    const replyOver = await call(mf, `/v1/alabama/posts/${post.payload.post.id}`, {
      method: "POST",
      headers: { "x-guest-pin": "pin-alabama" },
      body: { name: "Local test", text: "c".repeat(1001) },
    });
    assert.equal(replyOver.status, 400);
    const atLimit = await call(mf, "/v1/alabama/posts", {
      method: "POST",
      headers: { "x-guest-pin": "pin-alabama" },
      body: { name: "Local test", text: "b".repeat(5000) },
    });
    assert.equal(atLimit.status, 201);
    const over = await call(mf, "/v1/alabama/posts", {
      method: "POST",
      headers: { "x-guest-pin": "pin-alabama" },
      body: { name: "Local test", text: "a".repeat(5001) },
    });
    assert.equal(over.status, 400);
    assert.equal(over.payload.error, "That message is longer than 5000 characters.");
    const lsuPosts = await call(mf, "/v1/lsu/posts", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(lsuPosts.payload.posts.length, 0);
    const guestDelete = await call(mf, `/v1/alabama/files/${upload.payload.id}`, {
      method: "DELETE",
      headers: { "x-guest-pin": "pin-alabama" },
    });
    assert.equal(guestDelete.status, 401);
  } finally {
    await mf.dispose();
  }
});
