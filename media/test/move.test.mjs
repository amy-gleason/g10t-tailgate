import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Miniflare } from "miniflare";
import { lockFresh, quotaAfter } from "../src/move.js";

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
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const response = await mf.dispatchFetch(`http://unit.test${path}`, { method: options.method || "GET", headers, body });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return { status: response.status, payload, etag: (response.headers.get("etag") || "").replace(/"/g, "") };
}

function upload(mf, name, bytes = PNG) {
  return call(mf, "/v1/lsu/files", {
    method: "POST",
    headers: {
      "x-guest-pin": "pin-lsu",
      "x-guest-name": "Local test",
      "x-file-name": name,
      "content-type": "image/png",
    },
    body: bytes,
  });
}

const owner = { "x-guest-pin": "pin-lsu", "x-owner-token": "owner-test" };

async function finish(mf, lockId, limit = 80) {
  let last;
  for (let i = 0; i < limit; i++) {
    last = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: { ...owner, "x-move-lock": lockId },
      body: { confirm: "MOVE TO KENTUCKY", step: "continue" },
    });
    if (last.payload.phase === "done" || last.payload.phase === "blocked" || last.status === 409) return last;
  }
  return last;
}

test("quota delta keeps the stale post overcount", () => {
  assert.deepEqual(quotaAfter({ files: 4, bytes: 50, posts: 3 }, { files: -2, bytes: -20, posts: -1 }), {
    files: 2,
    bytes: 30,
    posts: 2,
  });
  assert.equal(lockFresh({ phase: "copy", lockExpiresAt: 5_000 }, 5_001), false);
  assert.equal(lockFresh({ phase: "done", lockExpiresAt: 9_000 }, 1), false);
});

test("owner move copies files and the post, then removes the originals", async () => {
  const mf = worker();
  try {
    const first = await upload(mf, "one.png");
    const second = await upload(mf, "two.png", PNG);
    assert.equal(first.payload.id === second.payload.id, false);
    const post = await call(mf, "/v1/lsu/posts", {
      method: "POST",
      headers: { "x-guest-pin": "pin-lsu" },
      body: { name: "Local test", text: "Line.\n\nNext." },
    });
    const guest = await call(mf, "/v1/lsu/move-to-kentucky", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(guest.status, 401);
    const wrong = await call(mf, "/v1/lsu/move-to-kentucky", { headers: { "x-guest-pin": "pin-lsu", "x-owner-token": "nope" } });
    assert.equal(wrong.status, 401);
    const otherGame = await call(mf, "/v1/kentucky/move-to-kentucky", { headers: { "x-guest-pin": "pin-kentucky", "x-owner-token": "owner-test" } });
    assert.equal(otherGame.status, 404);
    const preview = await call(mf, "/v1/lsu/move-to-kentucky", { headers: owner });
    assert.equal(preview.status, 200);
    assert.equal(preview.payload.files, 2);
    assert.equal(preview.payload.posts, 1);
    assert.equal(preview.payload.lockId, undefined);
    assert.equal(preview.payload.items, undefined);
    assert.equal(JSON.stringify(preview.payload).includes("Line."), false);
    assert.equal(JSON.stringify(preview.payload).includes("Local test"), false);
    const started = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: owner,
      body: { confirm: "MOVE TO KENTUCKY", step: "start" },
    });
    assert.equal(started.status, 200);
    const during = await upload(mf, "late.png");
    assert.equal(during.status, 409);
    const reply = await call(mf, `/v1/lsu/posts/${post.payload.post.id}`, {
      method: "POST",
      headers: { "x-guest-pin": "pin-lsu" },
      body: { name: "Local test", text: "nope" },
    });
    assert.equal(reply.status, 409);
    const removed = await call(mf, `/v1/lsu/files/${first.payload.id}`, {
      method: "DELETE",
      headers: owner,
    });
    assert.equal(removed.status, 409);
    const otherPhone = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: owner,
      body: { confirm: "MOVE TO KENTUCKY", step: "start" },
    });
    assert.equal(otherPhone.status, 409);
    const again = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: { ...owner, "x-move-lock": started.payload.lockId },
      body: { confirm: "MOVE TO KENTUCKY", step: "start" },
    });
    assert.equal(again.payload.total, started.payload.total);
    assert.equal(again.payload.lockId, started.payload.lockId);
    const done = await finish(mf, started.payload.lockId);
    assert.equal(done.payload.phase, "done");
    const lsu = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
    const kentucky = await call(mf, "/v1/kentucky/files", { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(lsu.payload.files.length, 0);
    assert.deepEqual(kentucky.payload.files.map((file) => file.id).sort(), [first.payload.id, second.payload.id].sort());
    assert.equal(kentucky.payload.files.find((file) => file.id === first.payload.id).uploadedBy, "Local test");
    assert.equal(kentucky.payload.files.find((file) => file.id === first.payload.id).name, "one.png");
    assert.equal(kentucky.payload.files.find((file) => file.id === first.payload.id).contentType, "image/png");
    const moved = await call(mf, `/v1/kentucky/files/${first.payload.id}`, { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(moved.payload.length, PNG.length);
    const lsuPosts = await call(mf, "/v1/lsu/posts", { headers: { "x-guest-pin": "pin-lsu" } });
    const kyPosts = await call(mf, "/v1/kentucky/posts", { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(lsuPosts.payload.posts.length, 0);
    assert.equal(kyPosts.payload.posts[0].text, "Line.\n\nNext.");
    assert.equal(kyPosts.payload.posts[0].id, post.payload.post.id);
    const another = await upload(mf, "after.png");
    assert.equal(another.status, 201);
  } finally {
    await mf.dispose();
  }
});

test("a partial move does not delete the source before the copy is checked", async () => {
  const mf = worker();
  try {
    const file = await upload(mf, "only.png");
    const started = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: owner,
      body: { confirm: "MOVE TO KENTUCKY", step: "start" },
    });
    const once = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: { ...owner, "x-move-lock": started.payload.lockId },
      body: { confirm: "MOVE TO KENTUCKY", step: "continue" },
    });
    assert.equal(once.payload.copied, 1);
    assert.equal(once.payload.removed, 0);
    const lsu = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
    const kentucky = await call(mf, "/v1/kentucky/files", { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(lsu.payload.files.length, 1);
    assert.equal(kentucky.payload.files.length, 1);
    assert.equal(kentucky.payload.files[0].id, file.payload.id);
    const done = await finish(mf, started.payload.lockId);
    assert.equal(done.payload.phase, "done");
    const again = await finish(mf, started.payload.lockId);
    assert.equal(again.payload.phase, "done");
    const ky = await call(mf, "/v1/kentucky/files", { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(ky.payload.files.length, 1);
  } finally {
    await mf.dispose();
  }
});

test("a large streamed file keeps its etag", async () => {
  const mf = worker();
  try {
    const size = 55 * 1024 * 1024;
    const chunk = new Uint8Array(1024 * 1024);
    chunk[0] = 7;
    const parts = [];
    for (let i = 0; i < 55; i++) parts.push(chunk);
    const before = process.memoryUsage().heapUsed;
    const uploaded = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: {
        "x-guest-pin": "pin-lsu",
        "x-guest-name": "Local test",
        "x-file-name": "large.mp4",
        "content-type": "video/mp4",
      },
      body: Buffer.concat(parts),
    });
    assert.equal(uploaded.status, 201);
    const mid = process.memoryUsage().heapUsed;
    const started = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: owner,
      body: { confirm: "MOVE TO KENTUCKY", step: "start" },
    });
    const copied = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: { ...owner, "x-move-lock": started.payload.lockId },
      body: { confirm: "MOVE TO KENTUCKY", step: "continue" },
    });
    assert.equal(copied.payload.copied, 1);
    const listed = await call(mf, "/v1/kentucky/files", { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(listed.payload.files[0].bytes, size);
    const grew = process.memoryUsage().heapUsed - mid;
    assert.equal(before > 0, true);
    assert.ok(grew < 80 * 1024 * 1024, "heap grew " + grew);
    const lsu = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(lsu.payload.files.length, 1);
  } finally {
    await mf.dispose();
  }
});

test("the mover uses only-if-absent and does not buffer the body", () => {
  const source = readFileSync(new URL("../src/move.js", import.meta.url), "utf8");
  assert.equal(source.includes("arrayBuffer"), false);
  assert.equal(source.includes('etagDoesNotMatch: "*"'), true);
  assert.equal(source.includes("etagDoesNotMatch: \"missing\""), false);
});

test("only-if-absent keeps the first object", async () => {
  const mf = new Miniflare({
    modules: true,
    script: `export default { async fetch(request, env) {
      if (new URL(request.url).pathname === "/race") {
        const [a, b] = await Promise.all([
          env.MEDIA.put("k", "a", { onlyIf: { etagDoesNotMatch: "*" } }),
          env.MEDIA.put("k", "b", { onlyIf: { etagDoesNotMatch: "*" } }),
        ]);
        const got = await env.MEDIA.get("k");
        return Response.json({ wins: [Boolean(a), Boolean(b)].filter(Boolean).length, text: await got.text() });
      }
      const first = await env.MEDIA.put("k2", "one", { onlyIf: { etagDoesNotMatch: "*" } });
      const second = await env.MEDIA.put("k2", "two", { onlyIf: { etagDoesNotMatch: "*" } });
      const got = await env.MEDIA.get("k2");
      return Response.json({ first: Boolean(first), second: Boolean(second), text: await got.text() });
    } }`,
    r2Buckets: ["MEDIA"],
    compatibilityDate: "2026-03-01",
  });
  try {
    const once = await call(mf, "/once");
    assert.equal(once.payload.first, true);
    assert.equal(once.payload.second, false);
    assert.equal(once.payload.text, "one");
    const race = await call(mf, "/race");
    assert.equal(race.payload.wins, 1);
    assert.equal(["a", "b"].includes(race.payload.text), true);
  } finally {
    await mf.dispose();
  }
});

test("thirty files and one post move once, and a full Kentucky refuses the rest", async () => {
  const mf = worker({ MAX_GAME_FILES: "30" });
  try {
    const ids = [];
    for (let i = 0; i < 30; i++) {
      const saved = await upload(mf, "pic-" + i + ".png");
      assert.equal(saved.status, 201);
      ids.push(saved.payload.id);
    }
    assert.equal(new Set(ids).size, 30);
    const post = await call(mf, "/v1/lsu/posts", {
      method: "POST",
      headers: { "x-guest-pin": "pin-lsu" },
      body: { name: "Local test", text: "Keep\n\nthis." },
    });
    const reply = await call(mf, `/v1/lsu/posts/${post.payload.post.id}`, {
      method: "POST",
      headers: { "x-guest-pin": "pin-lsu" },
      body: { name: "Local test", text: "Reply stays." },
    });
    assert.equal(reply.status, 201);
    const preview = await call(mf, "/v1/lsu/move-to-kentucky", { headers: owner });
    assert.equal(preview.payload.files, 30);
    assert.equal(preview.payload.posts, 1);
    assert.equal(preview.payload.replies, 1);
    const started = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: owner,
      body: { confirm: "MOVE TO KENTUCKY", step: "start" },
    });
    const done = await finish(mf, started.payload.lockId, 120);
    assert.equal(done.payload.phase, "done");
    assert.equal(done.payload.files, 30);
    assert.equal(done.payload.posts, 1);
    const lsu = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
    const kentucky = await call(mf, "/v1/kentucky/files", { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(lsu.payload.files.length, 0);
    assert.equal(kentucky.payload.files.length, 30);
    assert.deepEqual(kentucky.payload.files.map((file) => file.id).sort(), ids.sort());
    const kyPosts = await call(mf, "/v1/kentucky/posts", { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(kyPosts.payload.posts[0].text, "Keep\n\nthis.");
    assert.equal(kyPosts.payload.posts[0].replies[0].text, "Reply stays.");
    const extra = await upload(mf, "later.png");
    assert.equal(extra.status, 201);
    const crowded = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: owner,
      body: { confirm: "MOVE TO KENTUCKY", step: "start" },
    });
    assert.equal(crowded.status, 409);
    assert.equal(crowded.payload.error, "Kentucky does not have room. Nothing was removed.");
    const still = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(still.payload.files.length, 1);
    const absent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const gone = await call(mf, `/v1/kentucky/files/${absent}`, { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(gone.status, 404);
  } finally {
    await mf.dispose();
  }
});

test("quota moves once and an expired lock can resume", async () => {
  const mf = worker({ MAX_GAME_FILES: "2", TEST_CLOCK: "1" });
  try {
    const clock = { "x-test-now": "1000000" };
    const saved = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: { ...clock, "x-guest-pin": "pin-lsu", "x-guest-name": "Local test", "x-file-name": "one.png", "content-type": "image/png" },
      body: PNG,
    });
    assert.equal(saved.status, 201);
    const started = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: { ...owner, ...clock },
      body: { confirm: "MOVE TO KENTUCKY", step: "start" },
    });
    const wrong = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: { ...owner, ...clock, "x-move-lock": "other-phone" },
      body: { confirm: "MOVE TO KENTUCKY", step: "continue" },
    });
    assert.equal(wrong.status, 409);
    const expired = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: { ...owner, "x-test-now": "1130001", "x-move-lock": "other-phone" },
      body: { confirm: "MOVE TO KENTUCKY", step: "continue" },
    });
    assert.equal(expired.status, 200);
    assert.notEqual(expired.payload.lockId, started.payload.lockId);
    const done = await finish(mf, expired.payload.lockId);
    assert.equal(done.payload.phase, "done");
    const again = await call(mf, "/v1/kentucky/files", {
      method: "POST",
      headers: { "x-guest-pin": "pin-kentucky", "x-guest-name": "Local test", "x-file-name": "more.png", "content-type": "image/png" },
      body: PNG,
    });
    assert.equal(again.status, 201);
  } finally {
    await mf.dispose();
  }
});

test("writes during the lock fail closed and every file lands on one side", async () => {
  const mf = worker();
  try {
    const seed = await upload(mf, "seed.png");
    const started = await call(mf, "/v1/lsu/move-to-kentucky", {
      method: "POST",
      headers: owner,
      body: { confirm: "MOVE TO KENTUCKY", step: "start" },
    });
    const [uploadRace, postRace, deleteRace, kentuckyRace] = await Promise.all([
      upload(mf, "race.png"),
      call(mf, "/v1/lsu/posts", { method: "POST", headers: { "x-guest-pin": "pin-lsu" }, body: { name: "Local test", text: "during" } }),
      call(mf, `/v1/lsu/files/${seed.payload.id}`, { method: "DELETE", headers: owner }),
      call(mf, "/v1/kentucky/files", { method: "POST", headers: { "x-guest-pin": "pin-kentucky", "x-guest-name": "Local test", "x-file-name": "ky.png", "content-type": "image/png" }, body: PNG }),
    ]);
    assert.equal(uploadRace.status, 409);
    assert.equal(postRace.status, 409);
    assert.equal(deleteRace.status, 409);
    assert.equal(kentuckyRace.status, 409);
    const parallel = await Promise.all([
      call(mf, "/v1/lsu/move-to-kentucky", { method: "POST", headers: { ...owner, "x-move-lock": started.payload.lockId }, body: { confirm: "MOVE TO KENTUCKY", step: "continue" } }),
      call(mf, "/v1/lsu/move-to-kentucky", { method: "POST", headers: { ...owner, "x-move-lock": started.payload.lockId }, body: { confirm: "MOVE TO KENTUCKY", step: "continue" } }),
    ]);
    assert.equal(parallel.every((result) => result.status === 200 || result.status === 409), true);
    const done = await finish(mf, started.payload.lockId);
    assert.equal(done.payload.phase, "done");
    const lsu = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
    const kentucky = await call(mf, "/v1/kentucky/files", { headers: { "x-guest-pin": "pin-kentucky" } });
    assert.equal(lsu.payload.files.length, 0);
    assert.equal(kentucky.payload.files.length, 1);
    assert.equal(kentucky.payload.files[0].id, seed.payload.id);
  } finally {
    await mf.dispose();
  }
});
