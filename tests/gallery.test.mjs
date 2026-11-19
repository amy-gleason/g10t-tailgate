import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const puppeteer = require("/tmp/pw/node_modules/puppeteer-core");
const axeSource = readFileSync("/tmp/pw/node_modules/axe-core/axe.min.js", "utf8");
const root = new URL("..", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png" };
const gamesSource = readFileSync(join(root, "games.js"), "utf8");
const prodApi = gamesSource.match(/mediaApi: "(https:[^"]+)"/)[1];
const prodHost = new URL(prodApi).host;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const files = [
  { id: "clip", name: "clip.webm", contentType: "video/webm", bytes: 1200, createdAt: "2026-11-21T16:00:00.000Z", uploadedBy: "Sample guest", preview: "video" },
];
for (let i = 0; i < 16; i += 1) {
  files.push({
    id: "pic-" + i,
    name: "pic-" + i + ".png",
    contentType: "image/png",
    bytes: 80,
    createdAt: "2026-11-21T15:00:00.000Z",
    uploadedBy: "Sample guest",
    preview: "image",
  });
}
const emptyBoard = JSON.stringify({
  ok: true,
  result: { content: [{ tag: "pre", children: [JSON.stringify({ revision: 1, signups: [], attendees: [], donations: [], customItems: [] })] }] },
});

function serve(state) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "v1") {
      if (parts[2] === "files" && parts.length === 3) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ files }));
        return;
      }
      if (parts[2] === "files" && parts.length === 4) {
        state.bodies.push(parts[3]);
        response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        response.end(PNG);
        return;
      }
      if (parts[2] === "posts") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ posts: [] }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not found." }));
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
      if (file.endsWith("/games.js") || file.endsWith("games.js")) {
        const text = body.toString("utf8").split(prodApi).join(state.localApi);
        if (text.includes(prodHost)) throw new Error("media host was not rewritten");
        body = Buffer.from(text);
      }
      response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function axe(page) {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations
      .filter((item) => item.impact === "serious" || item.impact === "critical")
      .map((item) => ({ id: item.id, impact: item.impact, targets: item.nodes.slice(0, 3).map((node) => node.target.join(" ")) }));
  });
}

function waitFor(state, id) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (state.bodies.includes(id)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > 4000) {
        clearInterval(timer);
        reject(new Error("timed out waiting for " + id));
      }
    }, 40);
  });
}

test("gallery previews load near the screen and are not downloaded twice", { timeout: 90000 }, async () => {
  const state = { bodies: [], localApi: "" };
  const server = await serve(state);
  state.localApi = "http://127.0.0.1:" + server.address().port;
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--host-resolver-rules=MAP " + prodHost + " 127.0.0.1"],
  });
  const leaks = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      const host = new URL(url).hostname;
      if (host === prodHost || url.includes("workers.dev")) {
        leaks.push(url);
        request.abort();
        return;
      }
      if (url.includes("telegra.ph")) {
        request.respond({ status: 200, contentType: "application/json", body: emptyBoard });
        return;
      }
      if (url.includes("api.weather.gov")) {
        request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ properties: { periods: [] } }) });
        return;
      }
      request.continue();
    });
    await page.evaluateOnNewDocument(() => localStorage.setItem("tailgate-media-pin-lsu", "sample-guest-lsu"));
    await page.goto(state.localApi + "/#photos", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".photo-grid");
    await page.evaluate(() => document.querySelector(".photo-grid").scrollIntoView({ block: "start" }));
    await waitFor(state, "pic-0");
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(state.bodies.includes("clip"), false);
    assert.equal(state.bodies.includes("pic-15"), false);
    assert.ok(state.bodies.length < 16, state.bodies.join(","));
    const frame = await page.$eval(".shot-frame", (node) => getComputedStyle(node).aspectRatio);
    assert.equal(frame, "4 / 3");
    const size = await page.$eval(".photo-grid img", (node) => ({ width: node.getAttribute("width"), height: node.getAttribute("height"), alt: node.alt }));
    assert.equal(size.width, "4");
    assert.equal(size.height, "3");
    assert.match(size.alt, /^Photo from /);
    const columns = await page.$eval(".photo-grid", (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    assert.equal(columns, 2);

    const seen = state.bodies.filter((id) => id === "pic-0").length;
    await page.click('[aria-label="Open photo from Sample guest, pic-0.png"]');
    await page.waitForSelector("#viewer:not([hidden]) img");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(state.bodies.filter((id) => id === "pic-0").length, seen);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector(".viewer-count").textContent.includes("pic-1.png"));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#viewer[hidden]");

    await page.click('[aria-label="Open photo from Sample guest, pic-0.png"]');
    await page.waitForSelector("#viewer:not([hidden])");
    const beforeSwipe = await page.$eval(".viewer-count", (node) => node.textContent);
    await page.evaluate(() => {
      const stage = document.querySelector(".viewer-stage");
      function fire(type, x) {
        const touch = new Touch({ identifier: 1, target: stage, clientX: x, clientY: 180, radiusX: 2, radiusY: 2, rotationAngle: 0, force: 0.5 });
        stage.dispatchEvent(new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === "touchend" ? [] : [touch],
          changedTouches: [touch],
        }));
      }
      fire("touchstart", 300);
      fire("touchend", 40);
    });
    await page.waitForFunction((previous) => document.querySelector(".viewer-count").textContent !== previous, {}, beforeSwipe);
    await page.keyboard.press("Escape");

    await page.evaluate(() => document.querySelector('[data-file-id="pic-15"]').scrollIntoView({ block: "center" }));
    await waitFor(state, "pic-15");
    assert.equal(state.bodies.includes("clip"), false);

    const narrowAxe = await axe(page);
    assert.deepEqual(narrowAxe, [], JSON.stringify(narrowAxe));
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const wide = await page.$eval(".photo-grid", (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    assert.equal(wide, 4);
    const wideAxe = await axe(page);
    assert.deepEqual(wideAxe, [], JSON.stringify(wideAxe));
    assert.deepEqual(leaks, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
