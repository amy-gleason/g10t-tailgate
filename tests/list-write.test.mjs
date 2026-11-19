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
const client = readFileSync(join(root, "tailgate.js"), "utf8");

function serve(state) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/v1/lsu/rsvp") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      state.writes.push(Buffer.concat(chunks).toString("utf8"));
      const saved = {
        ok: true,
        added: ["row-1"],
        board: {
          revision: 2,
          signups: [],
          customItems: [],
          donations: [],
          attendees: [{ id: "row-1", name: "Jordan", guests: 1, note: "", createdAt: "2026-11-21T18:00:00.000Z", updatedAt: "2026-11-21T18:00:00.000Z" }],
        },
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(saved));
      return;
    }
    if (url.pathname.startsWith("/v1/")) {
      const body = url.pathname.includes("/posts") ? { posts: [] } : { files: [] };
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

test("the page saves an RSVP through the local list route", { timeout: 90000 }, async () => {
  assert.equal(client.includes("access_token"), false);
  assert.equal(client.includes("editPage"), false);
  const state = { localApi: "", writes: [], leaks: [], edits: 0 };
  const server = await serve(state);
  state.localApi = "http://127.0.0.1:" + server.address().port;
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--host-resolver-rules=MAP " + prodHost + " 127.0.0.1"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      const host = new URL(url).hostname;
      if (host === prodHost || url.includes("workers.dev")) {
        state.leaks.push("blocked");
        request.abort();
        return;
      }
      if (url.includes("editPage") || url.includes("access_token")) state.edits += 1;
      if (url.includes("telegra.ph")) {
        request.respond({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ ok: true, result: { content: [{ children: [JSON.stringify({ revision: 1, signups: [], attendees: [], donations: [], customItems: [] })] }] } }),
        });
        return;
      }
      request.continue();
    });
    await page.goto(state.localApi + "/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#coming button[type=submit]");
    const wide = await axe(page);
    assert.deepEqual(wide, [], JSON.stringify(wide));
    await page.focus("#coming input");
    await page.keyboard.type("Jordan");
    await page.click("#coming button[type=submit]");
    await page.waitForFunction(() => document.body.innerText.includes("Total coming: 1"));
    assert.equal(state.writes.length, 1);
    const sent = JSON.parse(state.writes[0]);
    assert.deepEqual(sent, { op: "add", name: "Jordan", guests: 1, note: "" });
    assert.equal(state.edits, 0);
    assert.deepEqual(state.leaks, []);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const narrow = await axe(page);
    assert.deepEqual(narrow, [], JSON.stringify(narrow));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
