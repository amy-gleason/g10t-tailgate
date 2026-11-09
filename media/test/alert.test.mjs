import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";

const PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 57, 126, 117, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);
const AMY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

function worker(bindings) {
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
  const response = await mf.dispatchFetch(`http://unit.test${path}`, { method: options.method || "GET", headers, body });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json() : null;
  return { status: response.status, payload };
}

function upload(mf, name, { id = AMY, displayName = "Amy", game = "lsu" } = {}) {
  const headers = {
    "x-guest-pin": game === "kentucky" ? "pin-kentucky" : "pin-lsu",
    "x-guest-name": displayName,
    "x-file-name": name,
    "content-type": "image/png",
  };
  if (id) headers["x-uploader-id"] = id;
  return call(mf, `/v1/${game}/files`, { method: "POST", headers, body: PNG });
}

function listen() {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      hits.push({ authorization: req.headers.authorization || "", body });
      const ok = hits.length > 1;
      res.writeHead(ok ? 200 : 500);
      res.end(ok ? "ok" : "no");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, hits, url: `http://127.0.0.1:${server.address().port}/alert` }));
  });
}

test("200 stored files still block the next upload before a second alert", async () => {
  const mock = await listen();
  const mf = worker({ MAX_GAME_FILES: "200", BULK_UPLOAD_ALERT_URL: mock.url, BULK_UPLOAD_ALERT_TOKEN: "test-token" });
  try {
    for (let index = 0; index < 199; index += 1) {
      const result = await upload(mf, `n-${index}.png`);
      assert.equal(result.status, 201);
    }
    assert.equal(mock.hits.length, 0);
    const missed = await upload(mf, "not-a-photo.txt", { displayName: "Amy" });
    assert.equal(missed.status, 415);
    assert.equal(mock.hits.length, 0);
    const reached = await upload(mf, "n-200.png");
    assert.equal(reached.status, 201);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].authorization, "Bearer test-token");
    assert.deepEqual(Object.keys(mock.hits[0].body).sort(), ["count", "displayName", "eventId", "game", "occurredAt"]);
    assert.equal(mock.hits[0].body.game, "lsu");
    assert.equal(mock.hits[0].body.displayName, "Amy");
    assert.equal(mock.hits[0].body.count, 200);
    assert.match(mock.hits[0].body.eventId, /^[0-9a-f-]{36}$/);
    assert.equal(Number.isNaN(Date.parse(mock.hits[0].body.occurredAt)), false);
    assert.equal(JSON.stringify(mock.hits[0].body).includes("uploader"), false);
    const full = await upload(mf, "n-201.png");
    assert.equal(full.status, 413);
    assert.equal(full.payload.error, "This game's storage is full.");
    assert.equal(mock.hits.length, 1);
  } finally {
    await mf.dispose();
    await new Promise((resolve) => mock.server.close(resolve));
  }
});

test("a failed alert is retried with the same event and then stops", async () => {
  const mock = await listen();
  const mf = worker({ MAX_GAME_FILES: "210", BULK_UPLOAD_ALERT_URL: mock.url, BULK_UPLOAD_ALERT_TOKEN: "test-token" });
  try {
    for (let index = 0; index < 200; index += 1) assert.equal((await upload(mf, `a-${index}.png`)).status, 201);
    assert.equal(mock.hits.length, 1);
    const again = await upload(mf, "a-200.png");
    assert.equal(again.status, 201);
    assert.equal(mock.hits.length, 2);
    assert.equal(mock.hits[1].body.eventId, mock.hits[0].body.eventId);
    assert.equal(mock.hits[1].body.count, 200);
    const quiet = await upload(mf, "a-201.png");
    assert.equal(quiet.status, 201);
    assert.equal(mock.hits.length, 2);
  } finally {
    await mf.dispose();
    await new Promise((resolve) => mock.server.close(resolve));
  }
});

test("another uploader resets the streak and an unknown upload is not attributed", async () => {
  const mock = await listen();
  const mf = worker({ MAX_GAME_FILES: "250", BULK_UPLOAD_ALERT_URL: mock.url, BULK_UPLOAD_ALERT_TOKEN: "test-token" });
  try {
    for (let index = 0; index < 199; index += 1) assert.equal((await upload(mf, `s-${index}.png`)).status, 201);
    assert.equal((await upload(mf, "other.png", { id: OTHER, displayName: "Someone else" })).status, 201);
    assert.equal((await upload(mf, "after.png")).status, 201);
    assert.equal(mock.hits.length, 0);
    assert.equal((await upload(mf, "blank-id.png", { id: "" })).status, 201);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mf.dispose();
    await new Promise((resolve) => mock.server.close(resolve));
  }
});

test("missing alert credentials do not block an upload or send a notice", async () => {
  const mock = await listen();
  const mf = worker({ BULK_UPLOAD_ALERT_URL: mock.url, MAX_GAME_FILES: "10" });
  try {
    for (let index = 0; index < 8; index += 1) assert.equal((await upload(mf, `old-${index}.png`, { id: "" })).status, 201);
    assert.equal((await upload(mf, "room-1.png")).status, 201);
    assert.equal((await upload(mf, "room-2.png")).status, 201);
    const stopped = await upload(mf, "room-3.png");
    assert.equal(stopped.status, 413);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mf.dispose();
    await new Promise((resolve) => mock.server.close(resolve));
  }
});
