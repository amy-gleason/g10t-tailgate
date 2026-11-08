import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 57, 126, 117, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

function worker(overrides = {}) {
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
      ...overrides,
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
  const response = await mf.dispatchFetch(`http://unit.test${path}`, { method: options.method || "GET", headers, body });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return { status: response.status, payload, headers: response.headers };
}

test("guest pin, type, size, isolation, preview, and owner delete", async () => {
  const mf = worker();
  try { await runFiles(mf); } finally { await mf.dispose(); }
});

async function runFiles(mf) {
  const denied = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-kentucky" } });
  assert.equal(denied.status, 401);
  const unknown = await call(mf, "/v1/alabama/files", { headers: { "x-guest-pin": "pin-lsu" } });
  assert.equal(unknown.status, 404);

  const upload = await call(mf, "/v1/lsu/files", {
    method: "POST",
    headers: {
      "x-guest-pin": "pin-lsu",
      "x-guest-name": "Local test",
      "x-file-name": "local-test.png",
      "content-type": "image/png",
    },
    body: PNG,
  });
  assert.equal(upload.status, 201);
  assert.equal(upload.payload.preview, "image");

  const heic = await call(mf, "/v1/lsu/files", {
    method: "POST",
    headers: {
      "x-guest-pin": "pin-lsu",
      "x-guest-name": "Local test",
      "x-file-name": "local-test.heic",
      "content-type": "image/heic",
    },
    body: Uint8Array.from([1, 2, 3, 4]),
  });
  assert.equal(heic.status, 201);
  assert.equal(heic.payload.preview, "none");

  const mov = await call(mf, "/v1/kentucky/files", {
    method: "POST",
    headers: {
      "x-guest-pin": "pin-kentucky",
      "x-guest-name": "Local test",
      "x-file-name": "local-test.mov",
      "content-type": "video/quicktime",
    },
    body: Uint8Array.from([0, 0, 0, 8]),
  });
  assert.equal(mov.status, 201);
  assert.equal(mov.payload.preview, "none");

  const lsuFiles = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
  assert.equal(lsuFiles.payload.files.length, 2);
  assert.ok(lsuFiles.payload.files.every((file) => file.uploadedBy === "Local test"));
  const kyFiles = await call(mf, "/v1/kentucky/files", { headers: { "x-guest-pin": "pin-kentucky" } });
  assert.equal(kyFiles.payload.files.length, 1);
  assert.equal(kyFiles.payload.files[0].name, "local-test.mov");

  const original = await call(mf, `/v1/lsu/files/${heic.payload.id}`, { headers: { "x-guest-pin": "pin-lsu" } });
  assert.equal(original.status, 200);
  assert.match(original.headers.get("content-disposition"), /attachment/);
  assert.deepEqual(Array.from(original.payload), [1, 2, 3, 4]);

  const mismatch = await call(mf, "/v1/lsu/files", {
    method: "POST",
    headers: {
      "x-guest-pin": "pin-lsu",
      "x-guest-name": "Local test",
      "x-file-name": "notes.txt",
      "content-type": "text/plain",
    },
    body: Uint8Array.from([65]),
  });
  assert.equal(mismatch.status, 415);

  const guestDelete = await call(mf, `/v1/lsu/files/${upload.payload.id}`, { method: "DELETE", headers: { "x-guest-pin": "pin-lsu" } });
  assert.equal(guestDelete.status, 401);
  const ownerDelete = await call(mf, `/v1/lsu/files/${upload.payload.id}`, {
    method: "DELETE",
    headers: { "x-guest-pin": "pin-lsu", "x-owner-token": "owner-test" },
  });
  assert.equal(ownerDelete.status, 200);
}

test("posts, replies, concurrency, plain text, and owner removal", async () => {
  const mf = worker();
  try { await runPosts(mf); } finally { await mf.dispose(); }
});

async function runPosts(mf) {
  const created = await call(mf, "/v1/lsu/posts", {
    method: "POST",
    headers: { "x-guest-pin": "pin-lsu" },
    body: { name: "Local test", text: "<script>alert(1)</script> hello" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.post.text, "<script>alert(1)</script> hello");
  const id = created.payload.post.id;
  const [first, second] = await Promise.all([
    call(mf, `/v1/lsu/posts/${id}`, { method: "POST", headers: { "x-guest-pin": "pin-lsu" }, body: { name: "Local test", text: "reply one" } }),
    call(mf, `/v1/lsu/posts/${id}`, { method: "POST", headers: { "x-guest-pin": "pin-lsu" }, body: { name: "Local test", text: "reply two" } }),
  ]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const listed = await call(mf, "/v1/lsu/posts", { headers: { "x-guest-pin": "pin-lsu" } });
  assert.equal(listed.payload.posts.length, 1);
  assert.deepEqual(listed.payload.posts[0].replies.map((reply) => reply.text).sort(), ["reply one", "reply two"]);
  const hidden = await call(mf, "/v1/kentucky/posts", { headers: { "x-guest-pin": "pin-kentucky" } });
  assert.equal(hidden.payload.posts.length, 0);
  const replyId = listed.payload.posts[0].replies[0].id;
  const removedReply = await call(mf, `/v1/lsu/posts/${id}/replies/${replyId}`, {
    method: "DELETE",
    headers: { "x-guest-pin": "pin-lsu", "x-owner-token": "owner-test" },
  });
  assert.equal(removedReply.status, 200);
  assert.equal(removedReply.payload.post.replies.length, 1);
  const removed = await call(mf, `/v1/lsu/posts/${id}`, {
    method: "DELETE",
    headers: { "x-guest-pin": "pin-lsu", "x-owner-token": "wrong" },
  });
  assert.equal(removed.status, 401);
}

test("oversized upload is rejected from the declared size", async () => {
  const mf = worker({ MAX_PHOTO_BYTES: "8" });
  try {
    const huge = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: {
        "x-guest-pin": "pin-lsu",
        "x-guest-name": "Local test",
        "x-file-name": "big.png",
        "content-type": "image/png",
      },
      body: PNG,
    });
    assert.equal(huge.status, 413);
  } finally { await mf.dispose(); }
});

test("kill switch and missing pin fail closed", async () => {
  const off = worker({ UPLOADS_ENABLED: "false", POSTS_ENABLED: "false" });
  try {
  const upload = await call(off, "/v1/lsu/files", {
    method: "POST",
    headers: { "x-guest-pin": "pin-lsu", "x-guest-name": "Local test", "x-file-name": "a.png", "content-type": "image/png" },
    body: PNG,
  });
  assert.equal(upload.status, 403);
  const post = await call(off, "/v1/lsu/posts", { method: "POST", headers: { "x-guest-pin": "pin-lsu" }, body: { name: "Local test", text: "nope" } });
  assert.equal(post.status, 403);
  } finally { await off.dispose(); }
  const unset = worker({ GUEST_PIN_LSU: "" });
  try {
    const closed = await call(unset, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(closed.status, 503);
  } finally { await unset.dispose(); }
});
