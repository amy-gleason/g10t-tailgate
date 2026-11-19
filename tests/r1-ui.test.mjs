import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readFileSync } from "node:fs";
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
    const file = join(root, path === "/" ? "index.html" : path.replace(/^\/+/, ""));
    readFile(file, (error, body) => {
      if (error) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
      response.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function axe(page, context) {
  await page.evaluate(axeSource);
  return page.evaluate(async (target) => {
    const result = await window.axe.run(target || document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((item) => ({
      id: item.id,
      impact: item.impact,
      help: item.help,
      targets: item.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    }));
  }, context);
}

function serious(violations) {
  return violations.filter((item) => item.impact === "serious" || item.impact === "critical");
}

test("viewer, manage, and delete confirmation stay on the preview stub", async () => {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port + "/preview/index.html";
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const blocked = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("workers.dev") || url.includes("telegra.ph")) blocked.push(url);
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.click('[data-section="photos"] .acc-toggle');
    await page.waitForFunction(() => document.getElementById("photos-body").innerText.includes("tent-setup.png"));
    assert.equal(blocked.length, 0);
    assert.equal(await page.$("#photos-body details"), null);
    assert.equal(await page.$("#posts-body details"), null);

    const opener = '[aria-label="Open photo from Sample guest, tent-setup.png"]';
    await page.click(opener);
    await page.waitForSelector("#viewer:not([hidden])");
    const closeBox = await page.$eval(".viewer-close", (node) => {
      const rect = node.getBoundingClientRect();
      return { text: node.textContent, width: rect.width, height: rect.height };
    });
    assert.equal(closeBox.text, "Close");
    assert.ok(closeBox.width >= 44 && closeBox.height >= 44);
    await page.keyboard.press("ArrowRight");
    const stepped = await page.$eval(".viewer-count", (node) => node.textContent);
    assert.match(stepped, /2 of 3, rocky-top\.webm/);
    await page.keyboard.press("ArrowLeft");
    assert.match(await page.$eval(".viewer-count", (node) => node.textContent), /1 of 3, tent-setup\.png/);
    const viewerAxe = serious(await axe(page, "#viewer"));
    assert.deepEqual(viewerAxe, [], JSON.stringify(viewerAxe));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#viewer[hidden]");
    const returned = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("aria-label"));
    assert.equal(returned, "Open photo from Sample guest, tent-setup.png");

    await page.click("#owner-entry");
    await page.waitForSelector("#owner-key-input");
    await page.type("#owner-key-input", "preview");
    await page.click("#owner-key-dialog button[type=submit]");
    assert.equal(await page.$eval("#owner-key-status", (node) => node.textContent), "Owner key saved on this phone");
    await page.click("#owner-open-manage");
    await page.waitForSelector("#manage-dialog:not([hidden])");
    assert.match(await page.$eval("#manage-title", (node) => node.textContent), /Manage LSU/);
    assert.match(await page.$eval("#manage-dialog", (node) => node.innerText), /tent-setup\.png/);
    assert.match(await page.$eval("#manage-dialog", (node) => node.innerText), /Tent is up on the lawn/);
    const manageAxe = serious(await axe(page, "#manage-dialog"));
    assert.deepEqual(manageAxe, [], JSON.stringify(manageAxe));

    await page.click('[aria-label="Delete Photo tent-setup.png"]');
    await page.waitForSelector("#delete-dialog:not([hidden])");
    assert.match(await page.$eval("#delete-title", (node) => node.textContent), /Delete this photo/);
    const deleteAxe = serious(await axe(page, "#delete-dialog"));
    assert.deepEqual(deleteAxe, [], JSON.stringify(deleteAxe));
    await page.click("#delete-dialog .btn.ghost");
    await page.waitForSelector("#delete-dialog[hidden]");
    assert.match(await page.$eval("#manage-dialog", (node) => node.innerText), /tent-setup\.png/);

    await page.click('[aria-label="Delete Photo tent-setup.png"]');
    await page.click("#delete-dialog .btn.danger");
    await page.waitForFunction(() => !document.getElementById("manage-dialog").innerText.includes("tent-setup.png"));
    assert.equal(blocked.length, 0);
    assert.equal(await page.evaluate(() => document.body.innerText.includes("preview") && !document.body.innerText.includes("workers.dev")), true);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
