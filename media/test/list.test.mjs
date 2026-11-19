import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const TOKEN = "unit-test-token";
const PATHS = {
  lsu: "G10T-tailgate-LSU-11-08",
  kentucky: "G10T-tailgate-Kentucky-10-26",
  alabama: "G10T-tailgate-data-10-15",
};

function emptyBoard() {
  return { revision: 2, signups: [], customItems: [], donations: [], attendees: [] };
}

function pageFor(data) {
  return { ok: true, result: { content: [{ children: [JSON.stringify(data)] }] } };
}

function worker(overrides = {}, initial = {}) {
  const calls = [];
  const store = {
    lsu: emptyBoard(),
    kentucky: emptyBoard(),
    alabama: { revision: 1, signups: [], customItems: [], donations: [] },
    ...initial,
  };
  const mf = new Miniflare({
    modules: true,
    scriptPath: new URL("../src/index.js", import.meta.url).pathname,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    r2Buckets: ["MEDIA"],
    compatibilityDate: "2026-03-01",
    bindings: { TELEGRAPH_TOKEN: TOKEN, OWNER_TOKEN: "owner-test", ...overrides },
    outboundService(request) {
      const url = new URL(request.url);
      const game = Object.keys(PATHS).find((id) => url.pathname.endsWith("/" + PATHS[id]));
      return request.text().then((body) => {
        calls.push({ method: request.method, path: url.pathname, game, body });
        if (!game) return new Response("missing", { status: 404 });
        if (url.pathname.startsWith("/getPage/")) return Response.json(pageFor(store[game]));
        if (url.pathname.startsWith("/editPage/")) {
          const params = new URLSearchParams(body);
          if (params.get("access_token") !== TOKEN) return Response.json({ ok: false });
          if (params.get("title") == null) return Response.json({ ok: false });
          const content = JSON.parse(params.get("content"));
          store[game] = JSON.parse(content[0].children[0]);
          return Response.json({ ok: true, result: {} });
        }
        return new Response("missing", { status: 404 });
      });
    },
  });
  return { mf, calls, store };
}

async function post(mf, path, body, headers = {}) {
  const response = await mf.dispatchFetch("http://unit.test" + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://amy-gleason.github.io", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json() : await response.text();
  return { status: response.status, payload };
}

test("rsvp, bring, and donation writes stay on that game's list", async () => {
  const { mf, calls, store } = worker();
  try {
    const added = await post(mf, "/v1/lsu/rsvp", { op: "add", name: "Jordan", guests: 2, note: "Gate B" });
    assert.equal(added.status, 200);
    assert.equal(added.payload.board.attendees.length, 1);
    assert.equal(added.payload.board.attendees[0].name, "Jordan");
    assert.equal(added.payload.board.attendees[0].guests, 2);
    assert.equal(added.payload.board.revision, 3);
    assert.deepEqual(added.payload.added, [added.payload.board.attendees[0].id]);
    assert.equal(store.kentucky.revision, 2);
    assert.ok(calls.filter((call) => call.method === "POST").every((call) => call.game === "lsu"));
    assert.ok(calls.some((call) => call.path === "/editPage/" + PATHS.lsu));
    assert.ok(!calls.some((call) => call.path.includes(PATHS.kentucky) || call.path.includes(PATHS.alabama)));

    const bring = await post(mf, "/v1/kentucky/bring", { op: "add", itemId: "water", name: "Riley", qty: 1, note: "" });
    assert.equal(bring.status, 200);
    assert.equal(bring.payload.board.signups[0].itemId, "water");
    assert.equal(store.lsu.signups.length, 0);
    assert.ok(calls.filter((call) => call.path.includes(PATHS.kentucky) && call.method === "POST").length >= 1);

    const wrongItem = await post(mf, "/v1/alabama/bring", { op: "add", itemId: "golf-balls", name: "Riley", qty: 1, note: "" });
    assert.equal(wrongItem.status, 400);
    const alabama = await post(mf, "/v1/alabama/rsvp", { op: "add", name: "Riley", guests: 1, note: "" });
    assert.equal(alabama.status, 200);
    assert.equal(alabama.payload.board.attendees.length, 8);
    assert.equal(alabama.payload.board.attendees[0].id, "seed-amy");
    assert.equal(store.lsu.attendees.length, 1);
  } finally {
    await mf.dispose();
  }
});

test("writes reject unknown games, bad fields, overwrites, and a missing token", async () => {
  const { mf, calls } = worker();
  try {
    const unknown = await post(mf, "/v1/florida/rsvp", { op: "add", name: "Jordan", guests: 1, note: "" });
    assert.equal(unknown.status, 404);
    const files = await mf.dispatchFetch("http://unit.test/v1/alabama/files");
    assert.equal(files.status, 404);
    const overwrite = await post(mf, "/v1/lsu/rsvp", { op: "add", name: "Jordan", guests: 1, note: "", board: { signups: [] } });
    assert.equal(overwrite.status, 400);
    const longNote = await post(mf, "/v1/lsu/rsvp", { op: "add", name: "Jordan", guests: 1, note: "x".repeat(161) });
    assert.equal(longNote.status, 400);
    const guests = await post(mf, "/v1/lsu/rsvp", { op: "add", name: "Jordan", guests: 0, note: "" });
    assert.equal(guests.status, 400);
    const amount = await post(mf, "/v1/lsu/donations", { op: "add", name: "Jordan", amount: 5000.01, note: "" });
    assert.equal(amount.status, 400);
    const huge = await post(mf, "/v1/lsu/rsvp", "x".repeat(4097));
    assert.equal(huge.status, 413);
    assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  } finally {
    await mf.dispose();
  }
});

test("a list edit does not require the owner token, and one row is all that changes", async () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  const { mf } = worker({}, {
    lsu: {
      revision: 4,
      signups: [],
      customItems: [],
      donations: [
        { id: first, name: "Jordan", amount: 20, note: "", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" },
        { id: second, name: "Riley", amount: 15, note: "cash", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" },
      ],
      attendees: [],
    },
  });
  try {
    const updated = await post(mf, "/v1/lsu/donations", { op: "update", id: first, name: "Jordan", amount: 25, note: "" });
    assert.equal(updated.status, 200);
    assert.equal(updated.payload.board.donations[0].amount, 25);
    assert.equal(updated.payload.board.donations[1].amount, 15);
    assert.equal(updated.payload.board.donations[1].note, "cash");
    const removed = await post(mf, "/v1/lsu/donations", { op: "delete", id: first });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.payload.board.donations.map((row) => row.id), [second]);
  } finally {
    await mf.dispose();
  }
});

test("the route refuses to save when the list token is not configured", async () => {
  const { mf, calls } = worker({ TELEGRAPH_TOKEN: "" });
  try {
    const saved = await post(mf, "/v1/lsu/rsvp", { op: "add", name: "Jordan", guests: 1, note: "" });
    assert.equal(saved.status, 503);
    assert.equal(calls.length, 0);
    assert.equal(JSON.stringify(saved.payload).includes(TOKEN), false);
  } finally {
    await mf.dispose();
  }
});

test("a burst of list writes is limited without a new binding", async () => {
  const { mf } = worker();
  try {
    const statuses = [];
    for (let index = 0; index < 31; index += 1) {
      const result = await post(mf, "/v1/lsu/rsvp", { op: "add", name: "Jordan", guests: 1, note: "" });
      statuses.push(result.status);
    }
    assert.equal(statuses.filter((status) => status === 200).length, 30);
    assert.equal(statuses[30], 429);
  } finally {
    await mf.dispose();
  }
});
