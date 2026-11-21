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

function serve() {
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const rel = path === "/" ? "preview/index.html" : path.replace(/^\/+/, "");
    const file = join(root, rel);
    readFile(file).then((body) => {
      response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
      response.end(body);
    }).catch(() => {
      response.writeHead(404);
      response.end();
    });
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

test("phone tabs reach the four jobs and stay out of the way on a wide screen", { timeout: 90000 }, async () => {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port + "/preview/index.html";
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tablist"]');
    const tabs = await page.$$eval('[role="tab"]', (nodes) => nodes.map((node) => ({
      label: node.textContent.replace(/\s+/g, " ").trim(),
      selected: node.getAttribute("aria-selected"),
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
    })));
    assert.deepEqual(tabs.map((tab) => tab.label.replace(/^[^A-Za-z]+/, "")), ["Game", "RSVP", "Bring", "Gallery", "Feed"]);
    assert.equal(tabs[0].selected, "true");
    tabs.forEach((tab) => {
      assert.ok(tab.width >= 44 && tab.height >= 44, JSON.stringify(tab));
    });
    const motion = await page.$eval(".job-tab", (node) => getComputedStyle(node).transitionDuration);
    assert.ok(motion === "0s" || motion === "0ms" || motion === "none", motion);
    await page.focus('[data-job-tab="game"]');
    await page.keyboard.press("ArrowRight");
    const selected = await page.$eval('[role="tab"][aria-selected="true"]', (node) => node.getAttribute("data-job-tab"));
    assert.equal(selected, "rsvp");
    assert.match(await page.$eval("#coming", (node) => getComputedStyle(node).display), /block|flex/);
    await page.click('[data-job-tab="photos"]');
    await page.waitForSelector("#photos-body .file-input");
    const narrow = await axe(page);
    assert.deepEqual(narrow, [], JSON.stringify(narrow));

    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const desktopTabs = await page.$eval(".job-tabs", (node) => getComputedStyle(node).display);
    assert.equal(desktopTabs, "none");
    const toggle = await page.$eval(".acc-toggle", (node) => getComputedStyle(node).display);
    assert.notEqual(toggle, "none");
    const wide = await axe(page);
    assert.deepEqual(wide, [], JSON.stringify(wide));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
