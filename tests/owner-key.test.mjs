import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const puppeteer = require("/tmp/pw/node_modules/puppeteer-core");
const root = new URL("..", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-guest-pin, x-owner-token, x-move-lock",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function serve() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const file = join(root, path === "/" ? "index.html" : path.replace(/^\/+/, ""));
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function openPage(browser, base, capture) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("workers.dev")) {
      capture.worker += 1;
      if (request.method() === "OPTIONS") {
        request.respond({ status: 204, headers: cors });
        return;
      }
      if (url.includes("/v1/lsu/move-to-kentucky")) {
        capture.moves.push({ method: request.method(), token: request.headers()["x-owner-token"] || "" });
        request.respond({
          status: 200,
          contentType: "application/json",
          headers: cors,
          body: JSON.stringify({ from: "lsu", to: "kentucky", files: 1, bytes: 10, posts: 0, replies: 0, phase: "ready", copied: 0, removed: 0, total: 0, note: "Originals are removed only after the copies are checked.", error: "" }),
        });
        return;
      }
      if (url.includes("/files") && request.method() === "GET") capture.lists += 1;
      const body = url.includes("/posts") ? { posts: [] } : { files: [] };
      request.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
      return;
    }
    if (request.method() === "POST") {
      request.abort();
      return;
    }
    request.continue();
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.click('[data-section="photos"] .acc-toggle');
  await page.waitForSelector("#photos-body input");
  await page.type("#photos-body input", "local-only");
  await page.click("#photos-body button");
  await page.waitForSelector("#photos-body details summary");
  await page.click("#photos-body details summary");
  return page;
}

test("owner key stays in memory and is sent without a re-render", async () => {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--host-resolver-rules=MAP g10t-tailgate-media.g10t-tailgate.workers.dev 127.0.0.1"],
  });
  const capture = { worker: 0, lists: 0, moves: [] };
  try {
    const empty = await openPage(browser, base, capture);
    const before = capture.moves.length;
    await empty.click("#photos-body .move-panel button");
    const prompt = await empty.$eval("#photos-body .move-panel [role=status]", (node) => node.textContent);
    assert.equal(prompt, "Enter and save your owner key first");
    assert.equal(capture.moves.length, before);
    await empty.close();

    const page = await openPage(browser, base, capture);
    await page.evaluate(() => {
      Storage.prototype.setItem = function () { throw new Error("storage blocked"); };
    });
    const marked = await page.evaluate(() => {
      const details = document.querySelector("#photos-body details");
      details.dataset.stay = "photos-owner";
      const input = details.querySelector("input");
      return {
        type: input.type,
        autocapitalize: input.getAttribute("autocapitalize"),
        autocorrect: input.getAttribute("autocorrect"),
        spellcheck: input.getAttribute("spellcheck"),
      };
    });
    assert.equal(marked.type, "password");
    assert.equal(marked.autocapitalize, "off");
    assert.equal(marked.autocorrect, "off");
    assert.equal(marked.spellcheck, "false");
    const listsBefore = capture.lists;
    await page.type("#photos-body details input", "  Exact Key  ");
    await page.click("#photos-body details button");
    const afterSave = await page.evaluate(() => {
      const details = document.querySelector("#photos-body details[data-stay=photos-owner]");
      return {
        connected: Boolean(details && details.isConnected),
        open: Boolean(details && details.open),
        status: details ? details.querySelector("[role=status]").textContent : "",
        shown: document.body.innerText.includes("Exact Key"),
      };
    });
    assert.equal(afterSave.connected, true);
    assert.equal(afterSave.open, true);
    assert.equal(afterSave.status, "Owner key saved on this phone");
    assert.equal(afterSave.shown, false);
    assert.equal(capture.lists, listsBefore);
    await page.click("#photos-body .move-panel button");
    await page.evaluate(() => document.querySelector('[data-section="posts"]').scrollIntoView({ block: "center" }));
    await page.click('[data-section="posts"] .acc-toggle');
    await page.waitForSelector("#posts-body details summary");
    await page.evaluate(() => document.querySelector("#posts-body details").scrollIntoView({ block: "center" }));
    await page.click("#posts-body details summary");
    await page.click("#posts-body .move-panel button");
    assert.deepEqual(capture.moves.map((item) => item.token), ["Exact Key", "Exact Key"]);
    assert.ok(capture.worker > 0);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
