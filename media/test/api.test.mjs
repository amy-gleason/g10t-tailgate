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

function batchHeaders(id, size, name) {
  return {
    "x-guest-pin": "pin-lsu",
    "x-guest-name": "Local test",
    "x-file-name": name,
    "content-type": "image/png",
    "x-batch-id": id,
    "x-batch-size": String(size),
  };
}

test("a batch accepts 50 and the next file, not a 10 minute window", async () => {
  const mf = worker();
  try {
    const legacy = [];
    for (let index = 0; index < 9; index += 1) {
      const result = await call(mf, "/v1/lsu/files", {
        method: "POST",
        headers: {
          "x-guest-pin": "pin-lsu",
          "x-guest-name": "Local test",
          "x-file-name": `legacy-${index}.png`,
          "content-type": "image/png",
        },
        body: PNG,
      });
      legacy.push(result.status);
    }
    assert.deepEqual(legacy, [201, 201, 201, 201, 201, 201, 201, 201, 201]);

    const tooMany = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: batchHeaders("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", 51, "too-many.png"),
      body: PNG,
    });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.payload.error, "Choose 50 files or fewer at a time.");

    const first = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const accepted = [];
    for (let index = 0; index < 2; index += 1) {
      accepted.push(await call(mf, "/v1/lsu/files", {
        method: "POST",
        headers: batchHeaders(first, 2, `batch-a-${index}.png`),
        body: PNG,
      }));
    }
    assert.deepEqual(accepted.map((result) => result.status), [201, 201]);
    const overflow = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: batchHeaders(first, 2, "batch-a-extra.png"),
      body: PNG,
    });
    assert.equal(overflow.status, 400);
    assert.equal(overflow.payload.error, "That batch is already full. Retry only the files that did not upload.");

    const second = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: batchHeaders("cccccccc-cccc-4ccc-8ccc-ccccccccccc1", 1, "batch-b.png"),
      body: PNG,
    });
    assert.equal(second.status, 201);

    const fifty = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
    for (let index = 0; index < 50; index += 1) {
      const result = await call(mf, "/v1/kentucky/files", {
        method: "POST",
        headers: {
          "x-guest-pin": "pin-kentucky",
          "x-guest-name": "Local test",
          "x-file-name": `fifty-${index}.png`,
          "content-type": "image/png",
          "x-batch-id": fifty,
          "x-batch-size": "50",
        },
        body: PNG,
      });
      assert.equal(result.status, 201, `file ${index} status ${result.status}`);
    }
    const fiftyFirst = await call(mf, "/v1/kentucky/files", {
      method: "POST",
      headers: {
        "x-guest-pin": "pin-kentucky",
        "x-guest-name": "Local test",
        "x-file-name": "fifty-extra.png",
        "content-type": "image/png",
        "x-batch-id": fifty,
        "x-batch-size": "50",
      },
      body: PNG,
    });
    assert.equal(fiftyFirst.status, 400);
    const fiftyNext = await call(mf, "/v1/kentucky/files", {
      method: "POST",
      headers: {
        "x-guest-pin": "pin-kentucky",
        "x-guest-name": "Local test",
        "x-file-name": "fifty-new-batch.png",
        "content-type": "image/png",
        "x-batch-id": "ffffffff-ffff-4fff-8fff-fffffffffff1",
        "x-batch-size": "1",
      },
      body: PNG,
    });
    assert.equal(fiftyNext.status, 201);

    const listed = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(listed.payload.files.length, 12);
  } finally {
    await mf.dispose();
  }
});

test("game file quota and message rate limit stay in place", async () => {
  const mf = worker({ MAX_GAME_FILES: "2" });
  try {
    const first = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: batchHeaders("dddddddd-dddd-4ddd-8ddd-ddddddddddd1", 1, "quota-1.png"),
      body: PNG,
    });
    const second = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: batchHeaders("dddddddd-dddd-4ddd-8ddd-ddddddddddd2", 1, "quota-2.png"),
      body: PNG,
    });
    const third = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: batchHeaders("dddddddd-dddd-4ddd-8ddd-ddddddddddd3", 1, "quota-3.png"),
      body: PNG,
    });
    assert.deepEqual([first.status, second.status, third.status], [201, 201, 413]);
    assert.equal(third.payload.error, "This game's storage is full.");

    const statuses = [];
    for (let index = 0; index < 13; index += 1) {
      const result = await call(mf, "/v1/lsu/posts", {
        method: "POST",
        headers: { "x-guest-pin": "pin-lsu" },
        body: { name: "Local test", text: `message ${index}` },
      });
      statuses.push(result.status);
      if (index === 12) assert.equal(result.payload.error, "Too many messages. Wait a few minutes.");
    }
    assert.equal(statuses.filter((status) => status === 201).length, 12);
    assert.equal(statuses[12], 429);
  } finally {
    await mf.dispose();
  }
});

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

test("file quota is enforced across concurrent uploads and released on delete", async () => {
  const mf = worker({ MAX_GAME_FILES: "3" });
  try {
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: {
        "x-guest-pin": "pin-lsu",
        "x-guest-name": "Local test",
        "x-file-name": `local-test-${index}.png`,
        "content-type": "image/png",
      },
      body: PNG,
    })));
    const saved = results.filter((result) => result.status === 201);
    assert.equal(saved.length, 3);
    const listed = await call(mf, "/v1/lsu/files", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(listed.payload.files.length, 3);
    const removed = await call(mf, `/v1/lsu/files/${saved[0].payload.id}`, {
      method: "DELETE",
      headers: { "x-guest-pin": "pin-lsu", "x-owner-token": "owner-test" },
    });
    assert.equal(removed.status, 200);
    const again = await call(mf, "/v1/lsu/files", {
      method: "POST",
      headers: {
        "x-guest-pin": "pin-lsu",
        "x-guest-name": "Local test",
        "x-file-name": "local-test-after.png",
        "content-type": "image/png",
      },
      body: PNG,
    });
    assert.equal(again.status, 201);
    const escaped = await call(mf, "/v1/lsu/files/not-a-uuid", { headers: { "x-guest-pin": "pin-lsu" } });
    assert.equal(escaped.status, 404);
  } finally { await mf.dispose(); }
});

test("health and cors do not leak secrets or allow other sites", async () => {
  const mf = worker();
  try {
    const health = await call(mf, "/health");
    assert.equal(health.status, 200);
    assert.equal(health.payload.ok, true);
    assert.equal(health.payload.games.lsu, true);
    assert.equal(health.payload.owner, true);
    assert.equal(JSON.stringify(health.payload).includes("pin-lsu"), false);
    const open = await call(mf, "/health", { headers: { origin: "https://amy-gleason.github.io" } });
    assert.equal(open.headers.get("access-control-allow-origin"), "https://amy-gleason.github.io");
    const local = await call(mf, "/health", { headers: { origin: "http://127.0.0.1:8765" } });
    assert.equal(local.headers.get("access-control-allow-origin"), "http://127.0.0.1:8765");
    const blocked = await call(mf, "/health", { headers: { origin: "https://evil.example" } });
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
    const missing = await call(mf, "/v1/lsu/files");
    assert.equal(missing.status, 401);
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
