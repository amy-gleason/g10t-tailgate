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
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".webm": "video/webm" };
const gamesSource = readFileSync(join(root, "games.js"), "utf8");
const prodApi = gamesSource.match(/mediaApi: "(https:[^"]+)"/)[1];
const prodHost = new URL(prodApi).host;
const files = { files: [{ id: "sample-tent", name: "tent-setup.png", contentType: "image/png", bytes: 120, createdAt: "2026-11-07T18:00:00.000Z", uploadedBy: "Sample guest", preview: "image" }] };
const posts = { posts: [{ id: "sample-post", name: "Sample guest", text: "Homecoming was loud.", createdAt: "2026-11-07T19:00:00.000Z", replies: [] }] };

function serve(state) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/v1/")) {
      const body = url.pathname.includes("/posts") ? posts : files;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
      return;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
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
      response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
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

test("the switcher lists next and past games, and a past game hides posting", { timeout: 90000 }, async () => {
  const state = { localApi: "", leaks: [] };
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
      const host = new URL(request.url()).hostname;
      if (host === prodHost || request.url().includes("workers.dev")) {
        state.leaks.push(request.url());
        request.abort();
        return;
      }
      if (request.url().includes("telegra.ph")) {
        request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, result: { content: [{ children: [JSON.stringify({ revision: 1, signups: [], attendees: [{ id: "a", name: "Sample", guests: 1, note: "", createdAt: "2026-11-07T15:00:00.000Z" }], donations: [], customItems: [] })] }] } }),
        });
        return;
      }
      request.continue();
    });
    await page.goto(state.localApi + "/kentucky/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#game-switch");
    assert.match(await page.$eval("#game-switch", (node) => node.textContent), /Kentucky/);
    await page.click("#game-switch");
    await page.waitForSelector("#game-sheet:not([hidden])");
    const sheet = await page.$eval("#game-sheet", (node) => node.innerText);
    assert.match(sheet, /NEXT UP/);
    assert.match(sheet, /PAST GAMES/);
    assert.match(sheet, /LSU/);
    assert.match(sheet, /Kentucky/);
    assert.match(sheet, /Alabama|Eviction|Hate Week/);
    const narrowSheet = await axe(page);
    assert.deepEqual(narrowSheet, [], JSON.stringify(narrowSheet));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#game-sheet[hidden]");
    await page.waitForFunction(() => {
      const form = document.querySelector("#photos-body form");
      return form && form.hidden;
    });
    const prompts = await page.$$eval("button", (nodes) => nodes
      .filter((node) => node.getClientRects().length && /Upload|Send message|Add me|I'll bring|Reply/.test(node.textContent))
      .map((node) => node.textContent.trim()));
    assert.deepEqual(prompts, []);
    assert.match(await page.$eval(".archive-banner", (node) => node.textContent), /This game is over/);
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const wide = await axe(page);
    assert.deepEqual(wide, [], JSON.stringify(wide));
    assert.deepEqual(state.leaks, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
