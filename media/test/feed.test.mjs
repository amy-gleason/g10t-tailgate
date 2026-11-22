import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 57, 126, 117, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

function worker() {
  return new Miniflare({
    modules: true,
    scriptPath: new URL("../src/index.js", import.meta.url).pathname,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    r2Buckets: ["MEDIA"],
    compatibilityDate: "2026-03-01",
    bindings: {
      OWNER_TOKEN: "owner-test",
      UPLOADS_ENABLED: "true",
      POSTS_ENABLED: "true",
    },
  });
}

async function call(mf, path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && !(body instanceof Uint8Array) && typeof body !== "string") {
    body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  if (body instanceof Uint8Array && !headers.has("content-length")) headers.set("content-length", String(body.byteLength));
  const response = await mf.dispatchFetch("http://unit.test" + path, { method: options.method || "GET", headers, body });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return { status: response.status, payload };
}

test("old media stays unchanged, and a caption or attachment is optional", async () => {
  const mf = worker();
  try {
    const plain = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: { "x-guest-name": "Jordan", "x-file-name": "plain.png", "content-type": "image/png" },
      body: PNG,
    });
    assert.equal(plain.status, 201);
    const captioned = await call(mf, "/v1/lsu/files?caption=" + encodeURIComponent("Cooler by the tent"), {
      method: "POST",
      headers: { "x-guest-name": "Jordan", "x-file-name": "cooler.png", "content-type": "image/png" },
      body: PNG,
    });
    assert.equal(captioned.status, 201);
    const listed = await call(mf, "/v1/lsu/files");
    const oldFile = listed.payload.files.find((file) => file.id === plain.payload.id);
    const nextFile = listed.payload.files.find((file) => file.id === captioned.payload.id);
    assert.equal(Object.hasOwn(oldFile, "caption"), false);
    assert.equal(nextFile.caption, "Cooler by the tent");
    const tooLong = await call(mf, "/v1/lsu/files?caption=" + encodeURIComponent("x".repeat(201)), {
      method: "POST",
      headers: { "x-guest-name": "Jordan", "x-file-name": "long.png", "content-type": "image/png" },
      body: PNG,
    });
    assert.equal(tooLong.status, 400);
    const withMedia = await call(mf, "/v1/lsu/posts", {
      method: "POST",
      body: { name: "Jordan", text: "See the cooler.", attachments: [captioned.payload.id] },
    });
    assert.equal(withMedia.status, 201);
    assert.deepEqual(withMedia.payload.post.attachments, [captioned.payload.id]);
    const bare = await call(mf, "/v1/lsu/posts", {
      method: "POST",
      body: { name: "Jordan", text: "No photo on this one." },
    });
    assert.equal(bare.status, 201);
    assert.equal(Object.hasOwn(bare.payload.post, "attachments"), false);
    const many = [];
    for (let index = 0; index < 9; index += 1) many.push(captioned.payload.id);
    const tooMany = await call(mf, "/v1/lsu/posts", {
      method: "POST",
      body: { name: "Jordan", text: "Too many.", attachments: many },
    });
    assert.equal(tooMany.status, 400);
  } finally {
    await mf.dispose();
  }
});
