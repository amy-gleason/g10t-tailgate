import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const puppeteer = require("/tmp/pw/node_modules/puppeteer-core");
const root = new URL("..", import.meta.url).pathname;
const artifacts = "/opt/cursor/artifacts";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png" };
const GUEST_LSU = "sample-guest-lsu";
const GUEST_NEXT = "sample-guest-next";
const GUEST_SESSION = "sample-guest-session";
const OWNER = "sample-owner-key";
const LSU_KEY = "tailgate-media-pin-lsu";
const KY_KEY = "tailgate-media-pin-kentucky";
const OWNER_KEY = "tailgate-owner-key-lsu";

const gamesSource = readFileSync(join(root, "games.js"), "utf8");
const prodApi = gamesSource.match(/mediaApi: "(https:[^"]+)"/)[1];
const prodHost = new URL(prodApi).host;
const emptyBoard = JSON.stringify({
  ok: true,
  result: {
    content: [{
      tag: "pre",
      children: [JSON.stringify({ revision: 1, signups: [], attendees: [], donations: [], customItems: [] })],
    }],
  },
});

function clientSource() {
  return readFileSync(join(root, "media-client.js"), "utf8");
}

test("guest storage stays separate from the owner key", () => {
  const client = clientSource();
  assert.match(client, /localStorage\.setItem\(pinKey/);
  assert.match(client, /sessionStorage\.setItem\(ownerKey/);
  assert.doesNotMatch(client, /localStorage\.setItem\(ownerKey/);
  assert.doesNotMatch(client, /localStorage\.setItem\(\s*["']tailgate-owner/);
  assert.doesNotMatch(client, /Forget code on this device/);
  assert.doesNotMatch(client, /Signed in as guest/);
  assert.match(client, /class: "btn ghost"/);
  assert.doesNotMatch(client, /local-test-pin/);
  assert.doesNotMatch(client, /workers\.dev/);
  assert.equal(client.includes(prodHost), false);
});

function serve(state) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/v1/")) {
      const posts = url.pathname.includes("/posts");
      const decided = state.mode;
      if (posts) state.postsSeen += 1;
      const seen = state.postsSeen;
      state.apiHits += 1;
      state.guestPins.push(request.headers["x-guest-pin"] || "");
      state.ownerTokens.push(request.headers["x-owner-token"] || "");
      if (posts && seen === 1 && state.delayFirstPosts) {
        await new Promise((resolve) => setTimeout(resolve, state.delayFirstPosts));
      }
      const status = decided === "reject" ? 401 : 200;
      const payload = status === 401 ? { error: "Unauthorized" } : (posts ? { posts: [] } : { files: [] });
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(payload));
      return;
    }
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = join(root, rel);
    if (!file.startsWith(root)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      let body = await readFile(file);
      if (file.endsWith("/games.js")) {
        const text = body.toString("utf8").split(prodApi).join(state.localApi);
        if (text.includes(prodHost)) throw new Error("media host was not rewritten");
        body = Buffer.from(text);
      }
      response.writeHead(200, {
        "content-type": types[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function reset(state) {
  state.mode = "ok";
  state.delayFirstPosts = 0;
  state.postsSeen = 0;
  state.apiHits = 0;
  state.guestPins = [];
  state.ownerTokens = [];
}

async function openBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--host-resolver-rules=MAP ${prodHost} 127.0.0.1`,
    ],
  });
}

async function newPage(browser, state) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    const host = new URL(url).hostname;
    if (host === prodHost || url.includes("workers.dev")) {
      state.leaks += 1;
      request.abort();
      return;
    }
    if (url.includes("telegra.ph")) {
      request.respond({ status: 200, contentType: "application/json", body: emptyBoard });
      return;
    }
    if (url.includes("api.weather.gov")) {
      request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ properties: { periods: [] } }),
      });
      return;
    }
    if (host === "127.0.0.1" || host === "localhost") {
      request.continue();
      return;
    }
    state.unexpected.push(url);
    request.abort();
  });
  return page;
}

async function storageOf(page) {
  return page.evaluate(() => {
    const dump = (store) => {
      const out = {};
      try {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          out[key] = store.getItem(key);
        }
      } catch (error) {
        out.__error = String(error && error.message || error);
      }
      return out;
    };
    return { local: dump(localStorage), session: dump(sessionStorage) };
  });
}

function assertOwnerStaysOutOfLocal(storage) {
  for (const [key, value] of Object.entries(storage.local)) {
    assert.equal(key.includes("owner"), false);
    assert.equal(String(value).includes(OWNER), false);
  }
}

async function shot(page, name) {
  const section = await page.$('[data-section="photos"]');
  await section.screenshot({ path: join(artifacts, name) });
}

test("remembered guest code is per game, forgettable, and dropped when rejected", { timeout: 90000 }, async () => {
  const state = { leaks: 0, unexpected: [] };
  reset(state);
  const server = await serve(state);
  state.localApi = "http://127.0.0.1:" + server.address().port;
  const base = state.localApi + "/";
  const browser = await openBrowser();
  try {
    const page = await newPage(browser, state);
    await page.goto(base + "#photos", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#photos-body input[placeholder="Guest code"]');
    const api = await page.evaluate(() => window.TAILGATE_GAMES.lsu.mediaApi);
    assert.equal(api, state.localApi);
    assert.equal(state.apiHits, 0);
    assert.equal(state.leaks, 0);
    await shot(page, "guest-code-first-visit.png");

    await page.type('#photos-body input[placeholder="Guest code"]', GUEST_LSU);
    await page.click('#photos-body button[type="submit"]');
    await page.waitForFunction(() => document.body.innerText.includes("Photos and videos for this game"));
    const remembered = await storageOf(page);
    assert.equal(remembered.local[LSU_KEY], GUEST_LSU);
    assert.equal(remembered.local[KY_KEY], undefined);
    assert.equal(remembered.session[OWNER_KEY], undefined);
    assertOwnerStaysOutOfLocal(remembered);
    assert.deepEqual(state.ownerTokens, ["", ""]);
    assert.equal(await page.$("#forget-code"), null);
    assert.equal(await page.$("#guest-chip"), null);
    await shot(page, "guest-code-remembered.png");

    await page.evaluate(() => {
      const orig = localStorage.setItem.bind(localStorage);
      window.__localKeys = [];
      localStorage.setItem = (key, value) => {
        window.__localKeys.push(String(key));
        return orig(key, value);
      };
    });
    await page.click("#owner-entry");
    await page.waitForSelector("#owner-key-dialog:not([hidden]) #owner-key-input");
    await page.type("#owner-key-input", OWNER);
    await page.click("#owner-key-dialog button[type=submit]");
    await page.waitForFunction(() => document.body.innerText.includes("Owner key saved on this phone"));
    await page.click("#owner-key-close");
    await page.waitForSelector("#owner-key-dialog[hidden]");
    const afterOwner = await storageOf(page);
    assert.equal(afterOwner.session[OWNER_KEY], OWNER);
    assert.equal(afterOwner.local[OWNER_KEY], undefined);
    assert.equal(afterOwner.local[LSU_KEY], GUEST_LSU);
    assertOwnerStaysOutOfLocal(afterOwner);
    const localKeys = await page.evaluate(() => window.__localKeys);
    assert.ok(!localKeys.some((key) => key.includes("owner")));
    const ownerVisible = await page.evaluate((owner) => document.body.innerText.includes(owner), OWNER);
    assert.equal(ownerVisible, false);

    await page.evaluate((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }, LSU_KEY);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('#photos-body input[placeholder="Guest code"]');
    const forgotten = await storageOf(page);
    assert.equal(forgotten.local[LSU_KEY], undefined);
    assert.equal(forgotten.session[LSU_KEY], undefined);
    assert.equal(forgotten.session[OWNER_KEY], OWNER);
    assertOwnerStaysOutOfLocal(forgotten);
    await shot(page, "guest-code-forget.png");

    const hitsBeforeReject = state.apiHits;
    state.mode = "reject";
    await page.type('#photos-body input[placeholder="Guest code"]', GUEST_NEXT);
    await page.click('#photos-body button[type="submit"]');
    await page.waitForSelector("#photos-body .form-error");
    const rejectedText = await page.$eval("#photos-body .form-error", (node) => node.textContent);
    assert.equal(rejectedText, "That guest code was not accepted.");
    const rejected = await storageOf(page);
    assert.equal(rejected.local[LSU_KEY], undefined);
    assert.equal(rejected.session[LSU_KEY], undefined);
    assert.equal(rejected.session[OWNER_KEY], OWNER);
    assert.equal(state.apiHits, hitsBeforeReject + 2);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(state.apiHits, hitsBeforeReject + 2);
    await shot(page, "guest-code-rejected.png");
    assert.equal(state.leaks, 0);

    await page.goto(base + "kentucky/index.html#photos", { waitUntil: "domcontentloaded" });
    await page.evaluate((key, value) => localStorage.setItem(key, value), LSU_KEY, GUEST_LSU);
    const hitsBeforeKentucky = state.apiHits;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('#photos-body input[placeholder="Guest code"]');
    const kentucky = await storageOf(page);
    assert.equal(kentucky.local[LSU_KEY], GUEST_LSU);
    assert.equal(kentucky.local[KY_KEY], undefined);
    assert.equal(kentucky.local[OWNER_KEY], undefined);
    assert.equal(kentucky.session[OWNER_KEY], OWNER);
    assert.equal(kentucky.session["tailgate-owner-key-kentucky"], undefined);
    assert.equal(state.apiHits, hitsBeforeKentucky);
    const kentuckyGate = await page.$eval("#photos-body", (node) => node.innerText);
    assert.equal(kentuckyGate.includes("Forget code on this device"), false);
    assert.equal(kentuckyGate.includes("Enter the guest code"), true);

    await page.close();

    reset(state);
    state.mode = "reject";
    state.delayFirstPosts = 1200;
    const askContext = await browser.createBrowserContext();
    const ask = await newPage(askContext, state);
    await ask.evaluateOnNewDocument((key, value) => localStorage.setItem(key, value), LSU_KEY, GUEST_LSU);
    await ask.goto(base + "#photos", { waitUntil: "domcontentloaded" });
    const askedAt = Date.now();
    await ask.waitForSelector("#photos-body .form-error");
    assert.ok(Date.now() - askedAt < 800);
    await ask.type('#photos-body input[placeholder="Guest code"]', "x");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const kept = await ask.$eval('#photos-body input[placeholder="Guest code"]', (node) => node.value);
    assert.equal(kept, "x");
    assert.equal(state.apiHits, 2);
    await askContext.close();

    reset(state);
    state.mode = "reject";
    state.delayFirstPosts = 1200;
    const staleContext = await browser.createBrowserContext();
    const stale = await newPage(staleContext, state);
    await stale.evaluateOnNewDocument((key, value) => localStorage.setItem(key, value), LSU_KEY, GUEST_LSU);
    await stale.goto(base + "#photos", { waitUntil: "domcontentloaded" });
    await stale.waitForSelector("#photos-body .form-error");
    state.mode = "ok";
    await stale.type('#photos-body input[placeholder="Guest code"]', GUEST_NEXT);
    await stale.click('#photos-body button[type="submit"]');
    await stale.waitForFunction(() => document.body.innerText.includes("Photos and videos for this game"));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const stillThere = await stale.evaluate(() => document.body.innerText.includes("Photos and videos for this game"));
    const afterStale = await storageOf(stale);
    assert.equal(stillThere, true);
    assert.equal(afterStale.local[LSU_KEY], GUEST_NEXT);
    await staleContext.close();

    reset(state);
    const pickupContext = await browser.createBrowserContext();
    const pickup = await newPage(pickupContext, state);
    await pickup.evaluateOnNewDocument((key, value) => sessionStorage.setItem(key, value), LSU_KEY, GUEST_SESSION);
    await pickup.goto(base + "#photos", { waitUntil: "domcontentloaded" });
    await pickup.waitForFunction(() => document.body.innerText.includes("Photos and videos for this game"));
    const picked = await storageOf(pickup);
    assert.equal(picked.local[LSU_KEY], GUEST_SESSION);
    assert.equal(picked.session[LSU_KEY], GUEST_SESSION);
    assert.equal(state.guestPins.includes(GUEST_SESSION), true);
    await pickupContext.close();

    reset(state);
    const blockedContext = await browser.createBrowserContext();
    const blocked = await newPage(blockedContext, state);
    await blocked.evaluateOnNewDocument((key, value) => {
      const local = window.localStorage;
      const proto = Storage.prototype;
      const origGet = proto.getItem;
      const origSet = proto.setItem;
      const origRemove = proto.removeItem;
      proto.getItem = function (name) {
        if (this === local) throw new Error("blocked");
        return origGet.call(this, name);
      };
      proto.setItem = function (name, stored) {
        if (this === local) throw new Error("blocked");
        return origSet.call(this, name, stored);
      };
      proto.removeItem = function (name) {
        if (this === local) throw new Error("blocked");
        return origRemove.call(this, name);
      };
      sessionStorage.setItem(key, value);
    }, LSU_KEY, GUEST_SESSION);
    await blocked.goto(base + "#photos", { waitUntil: "domcontentloaded" });
    await blocked.waitForFunction(() => document.body.innerText.includes("Photos and videos for this game"));
    const localBlocked = await blocked.evaluate(() => {
      try { localStorage.setItem("probe", "1"); return false; } catch (error) { return true; }
    });
    assert.equal(localBlocked, true);
    assert.equal(state.guestPins.includes(GUEST_SESSION), true);
    assert.ok(state.ownerTokens.every((token) => token === ""));
    await blockedContext.close();

    assert.equal(state.leaks, 0);
    assert.deepEqual(state.unexpected, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
