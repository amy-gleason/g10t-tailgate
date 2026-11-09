import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

function worker() {
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
    },
  });
}

async function call(mf, path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && typeof body !== "string") {
    body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  const response = await mf.dispatchFetch(`http://unit.test${path}`, { method: options.method || "GET", headers, body });
  const payload = await response.json();
  return { status: response.status, payload };
}

test("message text keeps paragraphs and rejects text over 1000 characters", async () => {
  const mf = worker();
  try {
    const text = "Line one.\n\nLine three has an apostrophe: y'all \u2019 and a mark \u{1F44D}.\n<script>alert(1)</script>";
    const created = await call(mf, "/v1/lsu/posts", {
      method: "POST",
      headers: { "x-guest-pin": "pin-lsu" },
      body: { name: "Local test", text },
    });
    assert.equal(created.status, 201);
    assert.equal(created.payload.post.text, text);
    const reply = await call(mf, `/v1/lsu/posts/${created.payload.post.id}`, {
      method: "POST",
      headers: { "x-guest-pin": "pin-lsu" },
      body: { name: "Local test", text: "Reply line.\n\nSecond line." },
    });
    assert.equal(reply.status, 201);
    assert.equal(reply.payload.post.replies[0].text, "Reply line.\n\nSecond line.");
    const listed = await call(mf, "/v1/lsu/posts", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(listed.payload.posts[0].text, text);
    const tooLong = "a".repeat(1001);
    const rejected = await call(mf, "/v1/lsu/posts", {
      method: "POST",
      headers: { "x-guest-pin": "pin-lsu" },
      body: { name: "Local test", text: tooLong },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.payload.error, "That message is longer than 1000 characters.");
    const after = await call(mf, "/v1/lsu/posts", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(after.payload.posts.length, 1);
    assert.equal(after.payload.posts[0].text.includes("a".repeat(1001)), false);
    const collapsedName = await call(mf, "/v1/kentucky/posts", {
      method: "POST",
      headers: { "x-guest-pin": "pin-kentucky" },
      body: { name: "Amy\nG", text: "ok" },
    });
    assert.equal(collapsedName.status, 201);
    assert.equal(collapsedName.payload.post.name, "Amy G");
  } finally {
    await mf.dispose();
  }
});
