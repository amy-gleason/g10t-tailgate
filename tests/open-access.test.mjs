import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { openSection } from "./open-section.mjs";

const require = createRequire(import.meta.url);
const puppeteer = require("/tmp/pw/node_modules/puppeteer-core");
const axeSource = readFileSync("/tmp/pw/node_modules/axe-core/axe.min.js", "utf8");
const root = new URL("..", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".webm": "video/webm" };
const gamesSource = readFileSync(join(root, "games.js"), "utf8");
const prodApi = gamesSource.match(/mediaApi: "(https:[^"]+)"/)[1];
const prodHost = new URL(prodApi).host;

test("the page no longer stores or sends a guest code", () => {
  const client = readFileSync(join(root, "media-client.js"), "utf8");
  const worker = readFileSync(join(root, "media/src/index.js"), "utf8");
  assert.match(client, /tailgate-media-pin-/);
  assert.match(client, /localStorage\.removeItem\(key\)/);
  assert.match(client, /sessionStorage\.setItem\(ownerKey/);
  assert.doesNotMatch(client, /x-guest-pin/);
  assert.doesNotMatch(client, /Forget code on this device/);
  assert.doesNotMatch(client, /Enter the guest code/);
  assert.doesNotMatch(client, /localStorage\.setItem\(ownerKey/);
  assert.doesNotMatch(worker, /Guest code was not accepted/);
  assert.match(worker, /function authorizedOwner/);
  assert.match(worker, /Owner key was not accepted/);
});

function serve(state) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/v1/")) {
      state.pins.push(request.headers["x-guest-pin"] || "");
      state.paths.push(url.pathname);
      const posts = url.pathname.includes("/posts");
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(posts ? { posts: [] } : { files: [] }));
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
      if (file.endsWith("games.js")) {
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
      .map((item) => ({
        id: item.id,
        impact: item.impact,
        targets: item.nodes.slice(0, 3).map((node) => node.target.join(" ")),
      }));
  });
}

test("a game page loads photos and messages with no guest code", { timeout: 90000 }, async () => {
  const state = { pins: [], paths: [], localApi: "", leaks: [] };
  const server = await serve(state);
  state.localApi = "http://127.0.0.1:" + server.address().port;
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--host-resolver-rules=MAP " + prodHost + " 127.0.0.1"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      const host = new URL(url).hostname;
      if (host === prodHost || url.includes("workers.dev")) {
        state.leaks.push(url);
        request.abort();
        return;
      }
      if (url.includes("telegra.ph")) {
        request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, result: { content: [{ children: [JSON.stringify({ revision: 1, signups: [], attendees: [], donations: [], customItems: [] })] }] } }),
        });
        return;
      }
      if (url.includes("api.weather.gov")) {
        request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ properties: { periods: [] } }) });
        return;
      }
      request.continue();
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem("tailgate-media-pin-lsu", "old-lsu-code");
      localStorage.setItem("tailgate-media-pin-kentucky", "old-kentucky-code");
      localStorage.setItem("vols-tailgate-name", "Riley");
    });
    await page.goto(state.localApi + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const photos = document.getElementById("photos-body");
      return photos && photos.textContent.includes("Photos and videos for this game");
    });
    await openSection(page, "photos");
    await page.waitForSelector("#photos-body .file-input");
    const photos = await page.$eval("#photos-body", (node) => node.innerText);
    assert.equal(photos.includes("Enter the guest code"), false);
    assert.equal(photos.includes("Forget code"), false);
    assert.equal(photos.includes("Guest code"), false);
    assert.equal(await page.$("#photos-body input[placeholder='Guest code']"), null);
    await openSection(page, "posts");
    await page.waitForFunction(() => document.body.innerText.includes("Send message"));
    const stored = await page.evaluate(() => ({
      lsu: localStorage.getItem("tailgate-media-pin-lsu"),
      kentucky: localStorage.getItem("tailgate-media-pin-kentucky"),
      name: localStorage.getItem("vols-tailgate-name"),
      owner: Object.keys(localStorage).some((key) => key.includes("owner")),
    }));
    assert.equal(stored.lsu, null);
    assert.equal(stored.kentucky, null);
    assert.equal(stored.name, "Riley");
    assert.equal(stored.owner, false);
    assert.ok(state.paths.some((path) => path.includes("/files")));
    assert.ok(state.paths.some((path) => path.includes("/posts")));
    assert.ok(state.pins.every((pin) => pin === ""));
    assert.deepEqual(state.leaks, []);

    const narrow = await axe(page);
    assert.deepEqual(narrow, [], JSON.stringify(narrow));
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await openSection(page, "photos");
    const wide = await axe(page);
    assert.deepEqual(wide, [], JSON.stringify(wide));

    const preview = await browser.newPage();
    await preview.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    preview.on("request", (request) => {
      if (request.url().includes("workers.dev")) state.leaks.push(request.url());
    });
    await preview.goto(state.localApi + "/preview/index.html", { waitUntil: "domcontentloaded" });
    await preview.waitForFunction(() => {
      const photos = document.getElementById("photos-body");
      return photos && photos.textContent.includes("tent-setup.png");
    });
    const sample = await preview.evaluate(() => document.body.textContent);
    assert.equal(sample.includes("Enter the guest code"), false);
    assert.equal(sample.includes("Forget code"), false);
    assert.match(sample, /Tent is up on the lawn/);
    const previewAxe = await axe(preview);
    assert.deepEqual(previewAxe, [], JSON.stringify(previewAxe));
    await preview.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await openSection(preview, "photos");
    await preview.waitForSelector("#photos-body .shot-open, #photos-body .file-tile");
    const previewWide = await axe(preview);
    assert.deepEqual(previewWide, [], JSON.stringify(previewWide));
    assert.deepEqual(state.leaks, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
