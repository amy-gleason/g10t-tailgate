"use strict";
(function () {
  var gameId = document.body && document.body.dataset.game;
  var preview = Boolean(document.body && document.body.dataset.preview === "1");
  var game = (window.TAILGATE_GAMES || {})[gameId];
  var photos = document.getElementById("photos-body");
  var posts = document.getElementById("posts-body");
  if (!game || !game.media || !photos || !posts) return;

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "class") node.className = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null) continue;
      node.append(child instanceof Node ? child : document.createTextNode(child));
    }
    return node;
  }
  function note(text) {
    return el("p", { class: "hint" }, text);
  }
  function mediaBase() {
    if (preview) return "https://preview.invalid";
    if (game.mediaApi) return String(game.mediaApi).replace(/\/$/, "");
    var host = location.hostname;
    if (host !== "127.0.0.1" && host !== "localhost") return "";
    var query = new URLSearchParams(location.search).get("media") || "";
    return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(query) ? query.replace(/\/$/, "") : "";
  }
  var api = mediaBase();
  if (!api) {
    photos.replaceChildren(note("Photos and videos aren't available yet. Sharing stays off until storage is turned on."));
    posts.replaceChildren(note("Messages aren't available yet. The board stays off until storage is turned on."));
    return;
  }

  var ownerKey = "tailgate-owner-key-" + gameId + (preview ? "-preview" : "");
  var ownerMemory = "";
  var loadRound = 0;
  function clearStoredGuestCodes() {
    try {
      var drop = [];
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i) || "";
        if (key.indexOf("tailgate-media-pin-") === 0) drop.push(key);
      }
      drop.forEach(function (key) {
        try { localStorage.removeItem(key); } catch (err) {}
      });
    } catch (err) {}
  }
  clearStoredGuestCodes();
  try { ownerMemory = sessionStorage.getItem(ownerKey) || ""; } catch (error) { ownerMemory = ""; }
  var guestNameKey = "vols-tailgate-name";
  var syncSession = function () {};
  function readGuestName() {
    try { return String(localStorage.getItem(guestNameKey) || "").slice(0, 40); } catch (error) { return ""; }
  }
  function writeGuestName(value, source) {
    var next = String(value || "").trim().slice(0, 40);
    try { localStorage.setItem(guestNameKey, next); } catch (err) {}
    var fields = document.querySelectorAll("[data-guest-name]");
    for (var i = 0; i < fields.length; i++) {
      var node = fields[i];
      if (node === source) continue;
      if (node.value !== next) node.value = next;
    }
    try { window.dispatchEvent(new CustomEvent("tailgate-guest-name", { detail: next })); } catch (err) {}
  }
  function bindGuestName(input) {
    input.setAttribute("data-guest-name", "");
    if (!input.value) input.value = readGuestName();
    input.addEventListener("input", function () { writeGuestName(input.value, input); });
    input.addEventListener("blur", function () {
      var next = input.value.trim().slice(0, 40);
      if (input.value !== next) input.value = next;
    });
    return input;
  }

  function guestHeaders(extra) {
    var headers = {};
    Object.keys(extra || {}).forEach(function (key) { headers[key] = extra[key]; });
    return headers;
  }
  function ownerToken() {
    if (ownerMemory) return ownerMemory;
    try { return sessionStorage.getItem(ownerKey) || ""; } catch (error) { return ""; }
  }
  function saveOwnerToken(value) {
    ownerMemory = value;
    try { sessionStorage.setItem(ownerKey, value); } catch (err) {}
  }
  function sizeLabel(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }
  function when(iso) {
    var date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function typeFor(file) {
    if (file.type) return file.type;
    var match = /\.([a-z0-9]+)$/i.exec(file.name || "");
    var ext = match ? match[1].toLowerCase() : "";
    return {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
      heic: "image/heic", heif: "image/heif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    }[ext] || "application/octet-stream";
  }

  var batchHost = null;

  function uploadFiles(files, name, caption) {
    var batchId = crypto.randomUUID();
    var batchSize = files.length;
    if (!batchHost) batchHost = el("div", { class: "batch" });
    var summary = el("p", { class: "batch-summary", role: "status" });
    var rows = el("div", { class: "gallery" });
    var retry = el("button", { type: "button", class: "btn" }, "Retry files that did not upload");
    retry.hidden = true;
    batchHost.replaceChildren(summary, rows, retry);
    if (!batchHost.isConnected && photos) photos.append(batchHost);
    var items = Array.from(files).map(function (file) {
      var meter = el("span");
      var status = el("p", { class: "hint" }, "Waiting…");
      var row = el("div", { class: "file-tile" }, el("p", { class: "row-title" }, file.name), el("div", { class: "meter" }, meter), status);
      rows.append(row);
      return { file: file, meter: meter, status: status, state: "pending", error: "" };
    });
    function paint() {
      var uploaded = items.filter(function (item) { return item.state === "uploaded"; }).length;
      var failed = items.filter(function (item) { return item.state === "failed"; });
      var pending = items.filter(function (item) { return item.state === "pending" || item.state === "uploading"; }).length;
      var text = "Uploaded " + uploaded + " of " + items.length + ".";
      if (pending) text += " " + pending + " still going.";
      if (failed.length) text += " " + failed.length + " not uploaded.";
      summary.textContent = text;
      retry.hidden = !failed.length || pending > 0;
      retry.textContent = "Retry " + failed.length + (failed.length === 1 ? " file that did not upload" : " files that did not upload");
    }
    function send(item) {
      item.state = "uploading";
      item.status.textContent = "Uploading…";
      paint();
      return new Promise(function (resolve) {
        var xhr = new XMLHttpRequest();
        var target = api + "/v1/" + gameId + "/files";
        if (caption) target += "?caption=" + encodeURIComponent(caption);
        xhr.open("POST", target);
        xhr.setRequestHeader("content-type", typeFor(item.file));
        xhr.setRequestHeader("x-file-name", item.file.name);
        xhr.setRequestHeader("x-guest-name", name);
        xhr.setRequestHeader("x-batch-id", batchId);
        xhr.setRequestHeader("x-batch-size", String(batchSize));
        xhr.upload.onprogress = function (event) {
          if (!event.lengthComputable) return;
          item.meter.style.width = Math.round(event.loaded / event.total * 100) + "%";
          item.status.textContent = "Uploading " + Math.round(event.loaded / event.total * 100) + "%";
        };
        xhr.onload = function () {
          var payload = {};
          try { payload = JSON.parse(xhr.responseText); } catch (err) {}
          if (xhr.status >= 200 && xhr.status < 300) {
            item.state = "uploaded";
            item.id = payload.id || "";
            item.error = "";
            item.status.textContent = "Uploaded";
          } else {
            item.state = "failed";
            item.error = payload.error || "Could not upload that file.";
            item.status.textContent = "Not uploaded. " + item.error;
          }
          paint();
          resolve();
        };
        xhr.onerror = function () {
          item.state = "failed";
          item.error = "Could not upload that file.";
          item.status.textContent = "Not uploaded. " + item.error;
          paint();
          resolve();
        };
        xhr.send(item.file);
      });
    }
    function pool(list) {
      var cursor = 0;
      var active = 0;
      return new Promise(function (resolve) {
        function pump() {
          if (cursor >= list.length && active === 0) { resolve(); return; }
          while (active < 4 && cursor < list.length) {
            var item = list[cursor];
            cursor += 1;
            active += 1;
            send(item).then(function () { active -= 1; pump(); });
          }
        }
        if (!list.length) resolve();
        else pump();
      });
    }
    function run(list, id, size) {
      batchId = id;
      batchSize = size;
      return pool(list).then(function () { paint(); return loadFiles(); });
    }
    retry.addEventListener("click", function () {
      var failed = items.filter(function (item) { return item.state === "failed"; });
      if (!failed.length) return;
      failed.forEach(function (item) { item.state = "pending"; item.error = ""; item.status.textContent = "Waiting…"; item.meter.style.width = "0"; });
      paint();
      run(failed, crypto.randomUUID(), failed.length);
    });
    paint();
    return run(items, batchId, batchSize).then(function () {
      return items.filter(function (item) { return item.state === "uploaded" && item.id; }).map(function (item) { return item.id; });
    });
  }

  function mediaType(file) {
    return String(file.contentType || "").split(";")[0].trim().toLowerCase();
  }
  function videoType(file) {
    var type = mediaType(file);
    if (type === "video/mp4" || type === "video/webm" || type === "video/quicktime") return type;
    return file.preview === "video" ? "video/mp4" : "";
  }
  function metaLine(file) {
    return [file.uploadedBy, when(file.createdAt), sizeLabel(file.bytes)].filter(Boolean).join(" · ");
  }
  function mediaAlt(file) {
    var caption = String(file.caption || "").replace(/\s+/g, " ").trim();
    if (caption) return caption.slice(0, 200);
    var who = String(file.uploadedBy || "").trim();
    var kind = videoType(file) ? "Video" : (file.preview === "image" ? "Photo" : "File");
    if (who) return kind + " from " + who;
    return file.name || kind;
  }
  function openLabel(file) {
    var caption = String(file.caption || "").trim();
    var base;
    if (caption) base = "Open " + mediaAlt(file);
    else {
      var who = String(file.uploadedBy || "").trim();
      var kind = videoType(file) ? "video" : (file.preview === "image" ? "photo" : "file");
      base = who ? "Open " + kind + " from " + who : "Open " + (file.name || kind);
    }
    var name = String(file.name || "").trim();
    if (name && base.indexOf(name) === -1) return base + ", " + name;
    return base;
  }
  var objectUrls = Object.create(null);
  var objectLoads = Object.create(null);
  var viewerHolding = "";
  var tileJobs = new WeakMap();
  var tileObserver = null;
  function fileBytes(file, inline) {
    var id = file.id;
    if (objectUrls[id]) return Promise.resolve(objectUrls[id]);
    if (objectLoads[id]) return objectLoads[id];
    objectLoads[id] = fetch(api + "/v1/" + gameId + "/files/" + id + (inline ? "?inline=1" : ""), { headers: guestHeaders() })
      .then(function (response) {
        if (!response.ok) throw new Error("preview");
        return response.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        objectUrls[id] = url;
        delete objectLoads[id];
        return url;
      }, function (error) {
        delete objectLoads[id];
        throw error;
      });
    return objectLoads[id];
  }
  function dropFileBytes(id) {
    if (!id || id === viewerHolding) return;
    var url = objectUrls[id];
    if (!url) return;
    URL.revokeObjectURL(url);
    delete objectUrls[id];
  }
  function ensureTileObserver() {
    if (tileObserver) return tileObserver;
    if (typeof IntersectionObserver !== "function") {
      tileObserver = {
        observe: function (card) {
          var job = tileJobs.get(card);
          if (job) job.start();
        },
        unobserve: function () {},
        disconnect: function () {},
      };
      return tileObserver;
    }
    tileObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var job = tileJobs.get(entry.target);
        if (!job) return;
        if (entry.isIntersecting) job.start();
        else job.stop();
      });
    }, { root: null, rootMargin: "300px 0px", threshold: 0.01 });
    return tileObserver;
  }
  function releaseOffscreen(id) {
    if (!id || id === viewerHolding) return;
    var card = document.querySelector('[data-file-id="' + String(id).replace(/"/g, "") + '"]');
    if (!card) {
      dropFileBytes(id);
      return;
    }
    var rect = card.getBoundingClientRect();
    var near = rect.width > 0 && rect.bottom > -300 && rect.top < window.innerHeight + 300;
    var job = tileJobs.get(card);
    if (!near && job) job.stop();
    else if (!near) dropFileBytes(id);
  }
  function clearTileCache() {
    if (tileObserver && tileObserver.disconnect) tileObserver.disconnect();
    Object.keys(objectUrls).forEach(function (id) { dropFileBytes(id); });
  }
  function downloadOriginal(file, target) {
    fetch(api + "/v1/" + gameId + "/files/" + file.id, { headers: guestHeaders() })
      .then(function (response) { if (!response.ok) throw new Error("download"); return response.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var link = el("a", { href: url, download: file.name });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      })
      .catch(function () { target.append(note("Could not download that file.")); });
  }
  function fileCard(file) {
    var playable = Boolean(videoType(file));
    var image = file.preview === "image";
    var card = el("article", { class: image || playable ? "shot" : "file-tile" });
    var meta = el("div", { class: "file-tile" },
      file.caption ? el("p", { class: "message-body" }, String(file.caption)) : null,
      el("p", { class: "row-title" }, file.name),
      el("p", { class: "row-meta" }, metaLine(file))
    );
    var download = el("button", { type: "button", class: "btn" }, "Download original");
    download.addEventListener("click", function () { downloadOriginal(file, meta); });
    meta.append(download);
    if (!image && !playable) {
      meta.prepend(note("This browser can't preview this file. The original is unchanged."));
      card.append(meta);
      return card;
    }
    card.setAttribute("data-file-id", file.id);
    var frame = el("span", { class: playable ? "shot-frame shot-play" : "shot-frame" }, playable ? "Play" : "");
    var open = el("button", {
      type: "button",
      class: "shot-open",
      "aria-label": openLabel(file),
    }, frame);
    open.addEventListener("click", function () { showViewer(file.id, open); });
    card.append(open, meta);
    if (playable) return card;
    var started = false;
    function start() {
      if (started) return;
      started = true;
      fileBytes(file, true).then(function (url) {
        if (!started || !card.isConnected) {
          dropFileBytes(file.id);
          return;
        }
        frame.replaceChildren(el("img", {
          src: url,
          alt: mediaAlt(file),
          width: "4",
          height: "3",
          loading: "lazy",
          decoding: "async",
        }));
      }).catch(function () {
        started = false;
        if (!card.isConnected) return;
        meta.prepend(note("Preview failed. The original can still be downloaded."));
      });
    }
    function stop() {
      if (viewerHolding === file.id) return;
      started = false;
      frame.replaceChildren();
      dropFileBytes(file.id);
    }
    tileJobs.set(card, { start: start, stop: stop });
    ensureTileObserver().observe(card);
    return card;
  }

  var galleryFiles = [];
  var messagePosts = [];
  var showViewer = function () {};
  function viewerSource() {
    return galleryFiles.filter(function (file) { return file.preview === "image" || videoType(file); });
  }
  function renderFiles(data) {
    clearTileCache();
    galleryFiles = data.files || [];
    var name = bindGuestName(el("input", {
      class: "input",
      maxLength: "40",
      autocomplete: "name",
      placeholder: "Your name",
      "aria-required": "true",
      "aria-describedby": "upload-name-error",
    }));
    var nameError = el("p", { class: "field-error", id: "upload-name-error", role: "alert" });
    nameError.hidden = true;
    var picker = el("input", { class: "file-input", type: "file", multiple: "", accept: "image/*,video/*,.heic,.heif,.mov" });
    var caption = messageBox("Optional caption");
    caption.maxLength = 200;
    caption.id = "gallery-caption";
    var list = el("div", { class: "photo-grid" });
    galleryFiles.forEach(function (file) { list.append(fileCard(file)); });
    name.addEventListener("input", function () {
      if (!name.value.trim()) return;
      name.removeAttribute("aria-invalid");
      nameError.hidden = true;
      nameError.textContent = "";
    });
    var batchError = el("p", { class: "field-error", role: "alert" });
    batchError.hidden = true;
    var form = el("form", { class: "stack" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Your name (required)"), name, nameError),
      el("label", { class: "field" }, el("span", { class: "label" }, "Photos and videos"), picker),
      el("label", { class: "field" }, el("span", { class: "label" }, "Caption (optional)"), caption),
      batchError,
      el("button", { type: "submit", class: "btn" }, "Upload")
    );
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!name.value.trim()) {
        name.setAttribute("aria-invalid", "true");
        nameError.hidden = false;
        nameError.textContent = "Name is required";
        name.focus();
        return;
      }
      if (!picker.files.length) return;
      if (picker.files.length > 50) {
        batchError.hidden = false;
        batchError.textContent = "Choose 50 files or fewer at a time.";
        return;
      }
      if (caption.value.length > 200) {
        batchError.hidden = false;
        batchError.textContent = "Keep the caption under 200 characters.";
        return;
      }
      batchError.hidden = true;
      batchError.textContent = "";
      uploadFiles(Array.from(picker.files), name.value.trim(), caption.value.trim()).then(function () {
        caption.value = "";
        loadPosts();
      });
      picker.value = "";
    });
    photos.replaceChildren();
    photos.append(
      el("p", { class: "lead" }, "Photos and videos for this game stay in this gallery. A caption is optional, and the upload also shows in the feed."),
      form
    );
    if (batchHost) photos.append(batchHost);
    photos.append(list);
    paintFeed();
    refreshManage();
    syncSession();
  }

  var POST_LIMIT = 5000;
  var REPLY_LIMIT = 1000;
  function fitMessage(box) {
    box.style.height = "auto";
    box.style.height = box.scrollHeight + "px";
  }
  function messageBox(placeholder) {
    var box = el("textarea", { class: "input message-box", rows: "4", placeholder: placeholder });
    box.addEventListener("input", function () { fitMessage(box); });
    return box;
  }
  function messageBody(text) {
    return el("p", { class: "message-body" }, text);
  }
  function tooLong(kind, value, limit) {
    return "This " + kind + " is " + value.length + " characters. The limit is " + limit + ", so it was not sent.";
  }
  function replyForm(post) {
    var nameErrorId = "reply-name-" + post.id;
    var name = bindGuestName(el("input", {
      class: "input",
      maxLength: "40",
      autocomplete: "name",
      placeholder: "Your name",
      "aria-required": "true",
      "aria-describedby": nameErrorId,
    }));
    var nameError = el("p", { class: "field-error", id: nameErrorId, role: "alert" });
    nameError.hidden = true;
    var text = messageBox("Reply");
    var error = el("div");
    var button = el("button", { type: "submit", class: "btn" }, "Reply");
    var form = el("form", { class: "stack" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Your name"), name, nameError),
      el("label", { class: "field" }, el("span", { class: "label" }, "Reply"), text),
      error,
      button
    );
    name.addEventListener("keydown", function (event) {
      if (event.key === "Enter") event.preventDefault();
    });
    name.addEventListener("input", function () {
      if (!name.value.trim()) return;
      name.removeAttribute("aria-invalid");
      nameError.hidden = true;
      nameError.textContent = "";
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!name.value.trim()) {
        name.setAttribute("aria-invalid", "true");
        nameError.hidden = false;
        nameError.textContent = "Name is required";
        name.focus();
        return;
      }
      if (text.value.length > REPLY_LIMIT) {
        error.replaceChildren(el("p", { class: "form-error" }, tooLong("reply", text.value, REPLY_LIMIT)));
        return;
      }
      fetch(api + "/v1/" + gameId + "/posts/" + post.id, {
        method: "POST",
        headers: guestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: name.value.trim(), text: text.value }),
      }).then(function (response) { return response.json().then(function (payload) { return { ok: response.ok, payload: payload }; }); })
        .then(function (result) {
          if (!result.ok) { error.replaceChildren(el("p", { class: "form-error" }, result.payload.error || "Could not reply.")); return; }
          text.value = "";
          fitMessage(text);
          loadPosts();
        });
    });
    return form;
  }

  function fileMap() {
    var map = Object.create(null);
    galleryFiles.forEach(function (file) { map[file.id] = file; });
    return map;
  }
  function feedShot(file) {
    var playable = Boolean(videoType(file));
    var image = file.preview === "image";
    var frame = el("span", { class: playable ? "shot-frame shot-play" : "shot-frame" }, playable ? "Play" : "");
    var open = el("button", { type: "button", class: "shot-open", "aria-label": openLabel(file) }, frame);
    var wrap = el("div", { class: "feed-shot", "data-file-id": file.id }, open);
    open.addEventListener("click", function () { showViewer(file.id, open); });
    if (!image) return wrap;
    var started = false;
    function start() {
      if (started) return;
      started = true;
      fileBytes(file, true).then(function (url) {
        if (!started || !wrap.isConnected) {
          dropFileBytes(file.id);
          return;
        }
        frame.replaceChildren(el("img", { src: url, alt: mediaAlt(file), width: "4", height: "3" }));
      }).catch(function () { started = false; });
    }
    function stop() {
      if (viewerHolding === file.id) return;
      started = false;
      frame.replaceChildren();
      dropFileBytes(file.id);
    }
    tileJobs.set(wrap, { start: start, stop: stop });
    ensureTileObserver().observe(wrap);
    return wrap;
  }
  function postArticle(post, known) {
    var block = el("article", { class: "post" },
      el("p", { class: "row-title" }, post.name),
      el("p", { class: "hint" }, when(post.createdAt)),
      messageBody(post.text)
    );
    (post.attachments || []).forEach(function (id) {
      if (known[id]) block.append(feedShot(known[id]));
    });
    (post.replies || []).forEach(function (reply) {
      block.append(el("div", { class: "reply" },
        el("p", { class: "row-title" }, reply.name),
        el("p", { class: "hint" }, when(reply.createdAt)),
        messageBody(reply.text)
      ));
    });
    block.append(replyForm(post));
    return block;
  }
  function paintFeed() {
    var list = document.getElementById("feed-list");
    if (!list) return;
    var known = fileMap();
    var used = Object.create(null);
    messagePosts.forEach(function (post) {
      (post.attachments || []).forEach(function (id) { used[id] = true; });
    });
    var rows = [];
    messagePosts.forEach(function (post) {
      rows.push({ at: post.createdAt || "", node: postArticle(post, known) });
    });
    galleryFiles.forEach(function (file) {
      if (used[file.id]) return;
      var block = el("article", { class: "post feed-media" },
        el("p", { class: "row-title" }, file.uploadedBy || file.name || "Shared"),
        el("p", { class: "hint" }, when(file.createdAt)),
        file.caption ? messageBody(file.caption) : null,
        feedShot(file)
      );
      rows.push({ at: file.createdAt || "", node: block });
    });
    rows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    list.replaceChildren.apply(list, rows.map(function (row) { return row.node; }));
  }
  function renderPosts(data) {
    messagePosts = data.posts || [];
    var name = bindGuestName(el("input", {
      class: "input",
      maxLength: "40",
      placeholder: "Your name",
      autocomplete: "name",
      "aria-required": "true",
      "aria-describedby": "message-name-error",
    }));
    var nameError = el("p", { class: "field-error", id: "message-name-error", role: "alert" });
    nameError.hidden = true;
    var text = messageBox("Write a message");
    var picker = el("input", { class: "file-input", id: "feed-files", type: "file", multiple: "", accept: "image/*,video/*,.heic,.heif,.mov" });
    var error = el("div");
    var form = el("form", { class: "stack", id: "feed-form" },
      el("p", { class: "lead" }, "The feed shows messages, photos, and videos, newest first."),
      el("label", { class: "field" }, el("span", { class: "label" }, "Your name"), name, nameError),
      el("label", { class: "field" }, el("span", { class: "label" }, "Message"), text),
      el("label", { class: "field" }, el("span", { class: "label" }, "Photos or videos (optional)"), picker),
      error,
      el("button", { type: "submit", class: "btn" }, "Send message")
    );
    name.addEventListener("keydown", function (event) {
      if (event.key === "Enter") event.preventDefault();
    });
    name.addEventListener("input", function () {
      if (!name.value.trim()) return;
      name.removeAttribute("aria-invalid");
      nameError.hidden = true;
      nameError.textContent = "";
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!name.value.trim()) {
        name.setAttribute("aria-invalid", "true");
        nameError.hidden = false;
        nameError.textContent = "Name is required";
        name.focus();
        return;
      }
      if (text.value.length > POST_LIMIT) {
        error.replaceChildren(el("p", { class: "form-error" }, tooLong("message", text.value, POST_LIMIT)));
        return;
      }
      if (!text.value.trim()) {
        error.replaceChildren(el("p", { class: "form-error" }, "Enter a message. Add photos or videos if you want them on this post."));
        return;
      }
      var chosen = Array.from(picker.files || []);
      if (chosen.length > 8) {
        error.replaceChildren(el("p", { class: "form-error" }, "Choose 8 photos or videos or fewer."));
        return;
      }
      var sending = chosen.length
        ? uploadFiles(chosen, name.value.trim(), "").then(function (ids) {
          if (ids.length !== chosen.length) throw new Error("Could not upload every file.");
          return ids;
        })
        : Promise.resolve([]);
      sending.then(function (ids) {
        var body = { name: name.value.trim(), text: text.value };
        if (ids.length) body.attachments = ids;
        return fetch(api + "/v1/" + gameId + "/posts", {
          method: "POST",
          headers: guestHeaders({ "content-type": "application/json" }),
          body: JSON.stringify(body),
        }).then(function (response) { return response.json().then(function (payload) { return { ok: response.ok, payload: payload }; }); });
      }).then(function (result) {
        if (!result.ok) { error.replaceChildren(el("p", { class: "form-error" }, result.payload.error || "Could not send that message.")); return; }
        text.value = "";
        fitMessage(text);
        picker.value = "";
        loadPosts();
        if (chosen.length) loadFiles();
      }).catch(function (err) {
        error.replaceChildren(el("p", { class: "form-error" }, err && err.message ? err.message : "Could not send that message."));
      });
    });
    var list = el("div", { class: "post-list", id: "feed-list" });
    var refresh = el("button", { type: "button", class: "btn ghost" }, "Refresh");
    refresh.addEventListener("click", function () { loadPosts(); loadFiles(); });
    posts.replaceChildren(form, refresh, list);
    paintFeed();
    refreshManage();
    syncSession();
  }

  var refreshManage = function () {};

  function setupChrome() {
    var entry = el("button", { type: "button", id: "owner-entry", class: "owner-entry", "aria-haspopup": "dialog" }, "Owner");
    var foot = el("footer", { class: "site-foot" }, el("p", null, "Hosting this tailgate?"));
    var main = document.querySelector("main");
    if (main) main.append(foot);
    else document.body.append(foot);
    foot.append(entry);
    if (preview && !document.querySelector(".preview-banner")) {
      document.body.prepend(el(
        "p",
        { class: "preview-banner", role: "note" },
        "Preview only. These photos and messages are samples, not the live tailgate. Choose Owner and type any word to open Manage. That word stays in this preview and is not a real owner key."
      ));
    }

    var signOut = el("button", { type: "button", class: "btn ghost", id: "owner-sign-out" }, "Sign out");
    var ownerChip = el("div", { class: "session-chip", id: "owner-chip" }, el("p", { id: "owner-chip-text" }, "Signed in as owner"), signOut);
    var sessionBar = el("div", { id: "session-bar", class: "session-bar", role: "region", "aria-label": "Sign-in" }, ownerChip);
    sessionBar.hidden = true;
    ownerChip.hidden = true;
    var main = document.querySelector("main");
    if (main) main.insertBefore(sessionBar, main.firstChild);
    signOut.addEventListener("click", function () {
      ownerMemory = "";
      try { sessionStorage.removeItem(ownerKey); } catch (err) {}
      var manage = document.getElementById("manage-dialog");
      var key = document.getElementById("owner-key-dialog");
      if (manage) closeDialog(manage);
      if (key) closeDialog(key);
      syncEntry();
    });
    syncSession = function () {
      var showOwner = !!ownerToken();
      ownerChip.hidden = !showOwner;
      sessionBar.hidden = !showOwner;
    };

    var dialogReturn = new WeakMap();
    var dialogStack = [];
    function focusable(root) {
      return Array.prototype.filter.call(
        root.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), video, [tabindex]"),
        function (node) {
          if (node.getAttribute("tabindex") === "-1") return false;
          var style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
        }
      );
    }
    function trapTab(event, root) {
      var items = focusable(root);
      if (!items.length) { event.preventDefault(); return; }
      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    function syncInert() {
      var top = null;
      dialogStack.forEach(function (node) { if (node && !node.hidden) top = node; });
      Array.prototype.forEach.call(document.body.children, function (node) {
        if (!top || node === top) node.removeAttribute("inert");
        else node.setAttribute("inert", "");
      });
      document.body.style.overflow = top ? "hidden" : "";
    }
    function pushDialog(dialog) {
      dialogStack = dialogStack.filter(function (item) { return item !== dialog; });
      dialogStack.push(dialog);
    }
    function openDialog(dialog, focusNode) {
      dialogReturn.set(dialog, document.activeElement);
      dialog.hidden = false;
      pushDialog(dialog);
      syncInert();
      if (focusNode && focusNode.focus) focusNode.focus();
    }
    function closeDialog(dialog, focusNode) {
      if (!dialog || dialog.hidden) return;
      dialog.hidden = true;
      dialogStack = dialogStack.filter(function (item) { return item !== dialog; });
      syncInert();
      var back = focusNode || dialogReturn.get(dialog);
      if (back && back.focus && document.contains(back)) back.focus();
      else if (document.contains(entry)) entry.focus();
    }
    function onDialogKeys(dialog, onEscape) {
      dialog.addEventListener("keydown", function (event) {
        if (dialog.hidden) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onEscape();
          return;
        }
        if (event.key === "Tab") trapTab(event, dialog);
      });
    }

    var viewerFiles = [];
    var viewerIndex = 0;
    var viewerReturn = null;
    var viewer = null;
    var paintToken = 0;
    showViewer = function (fileId, returnTo) {
      viewerFiles = viewerSource();
      if (!viewerFiles.length) return;
      viewerIndex = 0;
      viewerFiles.forEach(function (item, itemIndex) { if (item.id === fileId) viewerIndex = itemIndex; });
      viewerReturn = returnTo || document.activeElement;
      if (!viewer) viewer = buildViewer();
      paintViewer();
      viewer.hidden = false;
      pushDialog(viewer);
      syncInert();
      var closer = viewer.querySelector(".viewer-close");
      if (closer) closer.focus();
    }
    function closeViewer() {
      if (!viewer || viewer.hidden) return;
      viewer.hidden = true;
      dialogStack = dialogStack.filter(function (item) { return item !== viewer; });
      syncInert();
      var previous = viewerHolding;
      viewerHolding = "";
      releaseOffscreen(previous);
      if (viewerReturn && viewerReturn.focus && document.contains(viewerReturn)) viewerReturn.focus();
      else if (document.contains(entry)) entry.focus();
    }
    function stepViewer(delta) {
      var next = viewerIndex + delta;
      if (next < 0 || next >= viewerFiles.length) return;
      viewerIndex = next;
      paintViewer();
    }
    function paintViewer() {
      var file = viewerFiles[viewerIndex];
      if (!viewer || !file) return;
      var token = ++paintToken;
      var stage = viewer.querySelector(".viewer-media");
      var count = viewer.querySelector(".viewer-count");
      var title = viewer.querySelector("#viewer-title");
      var byline = viewer.querySelector(".byline");
      count.textContent = (viewerIndex + 1) + " of " + viewerFiles.length + ", " + (file.name || "file");
      title.textContent = file.name || "File";
      var bits = [file.uploadedBy, when(file.createdAt), file.bytes ? sizeLabel(file.bytes) : "", file.contentType || ""].filter(Boolean);
      byline.textContent = bits.length ? bits.join(" · ") : "No other details are stored for this file yet.";
      var caption = viewer.querySelector(".viewer-caption");
      if (caption) caption.textContent = mediaAlt(file);
      viewer.querySelectorAll(".viewer-prev").forEach(function (button) { button.disabled = viewerIndex === 0; });
      viewer.querySelectorAll(".viewer-next").forEach(function (button) { button.disabled = viewerIndex === viewerFiles.length - 1; });
      stage.replaceChildren(el("p", { class: "viewer-note" }, "Loading…"));
      var previousHold = viewerHolding;
      viewerHolding = file.id;
      if (previousHold && previousHold !== file.id) releaseOffscreen(previousHold);
      var kind = videoType(file);
      fileBytes(file, !kind)
        .then(function (url) {
          if (token !== paintToken) return;
          if (kind) {
            var video = el("video", { controls: "", playsinline: "", preload: "metadata" });
            video.playsInline = true;
            video.muted = true;
            video.setAttribute("playsinline", "");
            video.addEventListener("error", function () {
              if (token !== paintToken) return;
              stage.replaceChildren(el("p", { class: "viewer-note" }, "This browser could not play this video. You can download it instead."));
            });
            stage.replaceChildren(video);
            video.src = url;
            return;
          }
          stage.replaceChildren(el("img", { src: url, alt: mediaAlt(file) }));
        })
        .catch(function () {
          if (token !== paintToken) return;
          stage.replaceChildren(el("p", { class: "viewer-note" }, "Preview failed. The original can still be downloaded."));
        });
    }
    function buildViewer() {
      var stage = el("div", { class: "viewer-stage" });
      var count = el("p", { class: "viewer-count", "aria-live": "polite" });
      var close = el("button", { type: "button", class: "vbtn viewer-close" }, "Close");
      close.setAttribute("aria-label", "Close viewer");
      var download = el("button", { type: "button", class: "vbtn viewer-download" }, "Download");
      download.setAttribute("aria-label", "Download original");
      var prev = el("button", { type: "button", class: "vbtn viewer-prev" }, "Previous");
      var next = el("button", { type: "button", class: "vbtn viewer-next" }, "Next");
      var prevSide = el("button", { type: "button", class: "vbtn vside prev viewer-prev" }, "Previous");
      var nextSide = el("button", { type: "button", class: "vbtn vside next viewer-next" }, "Next");
      prev.setAttribute("aria-label", "Previous photo");
      next.setAttribute("aria-label", "Next photo");
      prevSide.setAttribute("aria-label", "Previous photo");
      nextSide.setAttribute("aria-label", "Next photo");
      var title = el("h2", { id: "viewer-title" });
      var byline = el("p", { class: "byline" });
      var caption = el("p", { class: "viewer-caption" });
      var panel = el("div", { class: "viewer-panel" }, title, byline, caption, el("p", { class: "hint" }, "A saved caption shows here. Otherwise this is the file name and who shared it."));
      function go(delta) { return function () { stepViewer(delta); }; }
      prev.addEventListener("click", go(-1));
      prevSide.addEventListener("click", go(-1));
      next.addEventListener("click", go(1));
      nextSide.addEventListener("click", go(1));
      close.addEventListener("click", closeViewer);
      download.addEventListener("click", function () { downloadOriginal(viewerFiles[viewerIndex], stage); });
      var media = el("div", { class: "viewer-media" });
      stage.append(prevSide, nextSide, media);
      var root = el("div", {
        id: "viewer",
        class: "viewer",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "viewer-title",
        hidden: "",
      });
      root.append(
        el("div", { class: "viewer-bar" }, close, count, download),
        el("div", { class: "viewer-body" }, stage, panel),
        el("div", { class: "viewer-nav" }, prev, next)
      );
      var startX = 0;
      stage.addEventListener("touchstart", function (event) {
        if (!event.changedTouches || !event.changedTouches.length) return;
        startX = event.changedTouches[0].clientX;
      }, { passive: true });
      stage.addEventListener("touchend", function (event) {
        if (!event.changedTouches || !event.changedTouches.length) return;
        var delta = event.changedTouches[0].clientX - startX;
        if (delta > 40) stepViewer(-1);
        if (delta < -40) stepViewer(1);
      }, { passive: true });
      root.addEventListener("keydown", function (event) {
        if (root.hidden) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeViewer();
          return;
        }
        if (event.key === "ArrowLeft") { event.preventDefault(); stepViewer(-1); }
        if (event.key === "ArrowRight") { event.preventDefault(); stepViewer(1); }
        if (event.key === "Tab") trapTab(event, root);
      });
      document.body.append(root);
      return root;
    }

    var manageDialog = null;
    var modList = null;
    var modEmpty = null;
    var modFilter = "all";
    var filterButtons = {};
    var confirmDialog = null;
    var confirmTitle = null;
    var confirmBody = null;
    var confirmError = null;
    var confirmGo = null;
    var confirmCancel = null;
    var pendingDelete = null;
    var manageTitle = null;

    function gameLabel() {
      if (gameId === "lsu") return "LSU";
      if (gameId === "kentucky") return "Kentucky";
      if (gameId === "alabama") return "Alabama";
      return gameId;
    }
    function ownerDelete(url) {
      return fetch(url, { method: "DELETE", headers: guestHeaders({ "x-owner-token": ownerToken() }) })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (payload) {
            return { ok: response.ok, payload: payload };
          });
        });
    }
    function moderationItems() {
      var items = [];
      galleryFiles.forEach(function (file) {
        var kind = videoType(file) ? "Video" : (file.preview === "image" ? "Photo" : "File");
        items.push({
          group: "files",
          kind: kind,
          title: file.name || "File",
          meta: [metaLine(file), file.contentType || ""].filter(Boolean).join(" · "),
          at: file.createdAt || "",
          detail: (file.name || "This file") + " will be removed from this game. This can't be undone from the page.",
          run: function () { return ownerDelete(api + "/v1/" + gameId + "/files/" + file.id); },
        });
      });
      messagePosts.forEach(function (post) {
        items.push({
          group: "messages",
          kind: "Message",
          title: post.name || "Message",
          excerpt: post.text || "",
          meta: when(post.createdAt),
          at: post.createdAt || "",
          detail: "The message from " + (post.name || "this person") + " will be removed, including its replies. This can't be undone from the page.",
          run: function () { return ownerDelete(api + "/v1/" + gameId + "/posts/" + post.id); },
        });
        (post.replies || []).forEach(function (reply) {
          items.push({
            group: "messages",
            kind: "Reply",
            title: reply.name || "Reply",
            excerpt: reply.text || "",
            meta: "Reply under " + (post.name || "a message") + (when(reply.createdAt) ? " · " + when(reply.createdAt) : ""),
            at: reply.createdAt || "",
            detail: "The reply from " + (reply.name || "this person") + " will be removed. This can't be undone from the page.",
            run: function () { return ownerDelete(api + "/v1/" + gameId + "/posts/" + post.id + "/replies/" + reply.id); },
          });
        });
      });
      items.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
      return items;
    }
    function paintModeration() {
      if (!modList) return;
      var items = moderationItems().filter(function (item) {
        return modFilter === "all" || item.group === modFilter;
      });
      var counts = { all: moderationItems().length, files: 0, messages: 0 };
      moderationItems().forEach(function (item) { counts[item.group] += 1; });
      filterButtons.all.textContent = "All " + counts.all;
      filterButtons.files.textContent = "Photos & videos " + counts.files;
      filterButtons.messages.textContent = "Messages " + counts.messages;
      Object.keys(filterButtons).forEach(function (key) {
        filterButtons[key].setAttribute("aria-pressed", key === modFilter ? "true" : "false");
      });
      modList.replaceChildren();
      items.forEach(function (item) {
        var del = el("button", { type: "button", class: "btn danger inline" }, "Delete…");
        del.setAttribute("aria-label", "Delete " + item.kind + " " + item.title);
        del.addEventListener("click", function () { askDelete(item, del); });
        var text = el("div");
        text.append(el("p", { class: "row-title" }, el("span", { class: "pill" }, item.kind), " " + item.title));
        if (item.excerpt) text.append(el("p", { class: "mod-excerpt" }, item.excerpt));
        if (item.meta) text.append(el("p", { class: "row-meta" }, item.meta));
        modList.append(el("li", { class: "mod-row" }, text, el("div", { class: "mod-actions" }, del)));
      });
      modEmpty.hidden = items.length > 0;
      modEmpty.textContent = counts.all ? "Nothing in this list." : "Nothing to review yet.";
    }
    function askDelete(item, source) {
      pendingDelete = item;
      confirmTitle.textContent = "Delete this " + item.kind.toLowerCase() + "?";
      confirmBody.textContent = item.detail;
      confirmError.textContent = "";
      openDialog(confirmDialog, confirmCancel);
      dialogReturn.set(confirmDialog, source);
    }
    function group(title, children) {
      var box = el("div", { class: "setgroup" }, el("h3", null, title));
      for (var i = 0; i < children.length; i++) box.append(children[i]);
      return box;
    }
    function buildManage() {
      var back = el("button", { type: "button", class: "manage-back" }, "Back to the " + gameLabel() + " page");
      manageTitle = el("h1", { id: "manage-title", tabindex: "-1" }, "Manage " + gameLabel());
      var modTab = el("button", { type: "button", id: "manage-tab-moderation" }, "Moderation");
      var setTab = el("button", { type: "button", id: "manage-tab-settings" }, "Settings");
      modList = el("ul", { class: "mod-list" });
      modEmpty = el("p", { class: "hint" }, "Nothing to review yet.");
      filterButtons = {
        all: el("button", { type: "button", class: "lchip", "aria-pressed": "true" }, "All"),
        files: el("button", { type: "button", class: "lchip", "aria-pressed": "false" }, "Photos & videos"),
        messages: el("button", { type: "button", class: "lchip", "aria-pressed": "false" }, "Messages"),
      };
      Object.keys(filterButtons).forEach(function (key) {
        filterButtons[key].addEventListener("click", function () {
          modFilter = key;
          paintModeration();
        });
      });
      var modPanel = el("div", { id: "manage-moderation" },
        el("p", { class: "hint" }, "Newest first. Delete asks once more, then removes the item. Hiding and comments are not part of this update."),
        el("div", { class: "chip-row", role: "group", "aria-label": "Show" }, filterButtons.all, filterButtons.files, filterButtons.messages),
        modList,
        modEmpty
      );
      var details = el("dl");
      [["Title", game.heading || ""], ["Date", game.date || ""], ["Kickoff", game.kickoff || "TBD"]].forEach(function (pair) {
        details.append(el("dt", null, pair[0]), el("dd", null, pair[1]));
      });
      var weatherBits = [el("p", { class: "hint" }, gameId === "lsu"
        ? "The National Weather Service card is on this page. It fills in when the game date is inside the forecast. This panel can't turn it off."
        : "The weather card is only on the LSU page.")];
      if (game.weather && /^https:\/\/(?:forecast|www)\.weather\.gov\//.test(game.weather.sourceUrl || "")) {
        weatherBits.push(el("p", null, el("a", { href: game.weather.sourceUrl, rel: "noopener noreferrer" }, (game.weather.sourceName || "National Weather Service") + " forecast")));
      }
      var replaceKey = el("button", { type: "button", class: "btn ghost inline", id: "manage-replace-key" }, "Replace owner key");
      var setPanel = el("div", { id: "manage-settings", hidden: "" }, el("div", { class: "manage-grid" },
        el("div", null,
          group("Game details", [details, el("p", { class: "hint" }, "Title, date, and kickoff are part of this page. This panel can't change them.")]),
          group("Weather card", weatherBits),
          group("Sharing", [el("p", { class: "hint" }, "Uploads and messages follow the site switches. This panel can't turn them off, and it can't change storage limits.")])
        ),
        el("div", null,
          group("This phone", [
            el("p", { class: "hint", id: "manage-owner-status", role: "status" }, "Owner key saved on this phone"),
            replaceKey,
          ]),
          rareTools()
        )
      ));
      manageDialog = el("div", {
        id: "manage-dialog",
        class: "manage",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "manage-title",
        hidden: "",
      }, el("div", { class: "manage-in" }, back, manageTitle, el("div", { class: "manage-tabs", role: "group", "aria-label": "Manage sections" }, modTab, setTab), modPanel, setPanel));
      function showTab(name) {
        var moderation = name !== "settings";
        modPanel.hidden = !moderation;
        setPanel.hidden = moderation;
        if (moderation) modTab.setAttribute("aria-current", "page");
        else modTab.removeAttribute("aria-current");
        if (!moderation) setTab.setAttribute("aria-current", "page");
        else setTab.removeAttribute("aria-current");
        if (moderation) paintModeration();
      }
      back.addEventListener("click", function () { closeDialog(manageDialog); });
      modTab.addEventListener("click", function () { showTab("moderation"); });
      setTab.addEventListener("click", function () { showTab("settings"); });
      replaceKey.addEventListener("click", openKeyDialog);
      onDialogKeys(manageDialog, function () { closeDialog(manageDialog); });
      document.body.append(manageDialog);
      showTab("moderation");
    }
    function rareTools() {
      var move = moveControls();
      if (!move) return el("div");
      var details = el("details", { class: "setgroup" }, el("summary", null, "Rare tools"));
      details.append(
        el("p", { class: "hint" }, "Move LSU photos, videos, and messages to Kentucky. Review shows whether that move is already finished. Originals are removed only after each copy is checked."),
        move
      );
      return details;
    }
    function openManagePanel() {
      if (!ownerToken()) {
        openKeyDialog();
        return;
      }
      if (!manageDialog) buildManage();
      paintModeration();
      var status = document.getElementById("manage-owner-status");
      if (status) status.textContent = "Owner key saved on this phone";
      openDialog(manageDialog, manageTitle);
    }

    confirmTitle = el("h2", { id: "delete-title" });
    confirmBody = el("p", null, "");
    confirmError = el("p", { class: "field-error", role: "alert" });
    confirmCancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
    confirmGo = el("button", { type: "button", class: "btn danger" }, "Delete");
    var confirmPanel = el("div", { class: "modal-panel" }, confirmTitle, confirmBody, confirmError, confirmCancel, confirmGo);
    confirmDialog = el("div", {
      id: "delete-dialog",
      class: "modal confirm-dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "delete-title",
      hidden: "",
    }, confirmPanel);
    confirmCancel.addEventListener("click", function () { closeDialog(confirmDialog); });
    confirmGo.addEventListener("click", function () {
      if (!pendingDelete) return;
      confirmGo.disabled = true;
      pendingDelete.run().then(function (result) {
        confirmGo.disabled = false;
        if (!result.ok) {
          confirmError.textContent = (result.payload && result.payload.error) || "Could not delete that.";
          return;
        }
        pendingDelete = null;
        closeDialog(confirmDialog, manageTitle);
        return loadAll();
      }).catch(function () {
        confirmGo.disabled = false;
        confirmError.textContent = "Could not delete that.";
      });
    });
    confirmDialog.addEventListener("click", function (event) {
      if (event.target === confirmDialog) closeDialog(confirmDialog);
    });
    onDialogKeys(confirmDialog, function () { closeDialog(confirmDialog); });
    document.body.append(confirmDialog);

    var keyInput = el("input", {
      class: "input",
      type: "password",
      id: "owner-key-input",
      autocomplete: "off",
      autocapitalize: "off",
      autocorrect: "off",
      spellcheck: "false",
    });
    var keyStatus = el("p", { class: "hint", id: "owner-key-status", role: "status" });
    var keyForm = el("form", { class: "stack" },
      el("p", { class: "hint" }, "The owner key removes files or messages. Guests cannot do that."),
      el("label", { class: "field" }, el("span", { class: "label" }, "Owner key"), keyInput),
      keyStatus,
      el("button", { type: "submit", class: "btn" }, "Save owner key on this phone")
    );
    var openManageBtn = el("button", { type: "button", class: "btn", id: "owner-open-manage" }, "Open Manage");
    openManageBtn.hidden = true;
    var keyClose = el("button", { type: "button", class: "btn ghost", id: "owner-key-close" }, "Close");
    var keyPanel = el("div", { class: "modal-panel" }, el("h2", { id: "owner-dialog-title" }, "Owner key"), keyForm, openManageBtn, keyClose);
    var keyDialog = el("div", {
      id: "owner-key-dialog",
      class: "modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "owner-dialog-title",
      hidden: "",
    }, keyPanel);
    function syncEntry() {
      var on = Boolean(ownerToken());
      entry.textContent = on ? "Manage" : "Owner";
      entry.setAttribute("aria-label", on ? "Manage this game" : "Enter the owner key");
      entry.setAttribute("aria-controls", on ? "manage-dialog" : "owner-key-dialog");
      syncSession();
    }
    function openKeyDialog() {
      keyInput.value = "";
      if (ownerToken()) {
        keyStatus.textContent = "An owner key is already saved on this phone.";
        openManageBtn.hidden = false;
      }
      openDialog(keyDialog, keyInput);
    }
    keyForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var next = keyInput.value.trim();
      if (!next) return;
      // Keep the key in memory and do not reload photos or messages. A reload closed the tools and dropped a key the phone could not store.
      saveOwnerToken(next);
      keyInput.value = "";
      keyStatus.textContent = "Owner key saved on this phone";
      openManageBtn.hidden = false;
      syncEntry();
    });
    openManageBtn.addEventListener("click", function () {
      keyDialog.hidden = true;
      dialogStack = dialogStack.filter(function (item) { return item !== keyDialog; });
      openManagePanel();
      dialogReturn.set(manageDialog, entry);
    });
    keyClose.addEventListener("click", function () { closeDialog(keyDialog); });
    keyDialog.addEventListener("click", function (event) {
      if (event.target === keyDialog) closeDialog(keyDialog);
    });
    onDialogKeys(keyDialog, function () { closeDialog(keyDialog); });
    document.body.append(keyDialog);
    entry.addEventListener("click", function () {
      if (ownerToken()) openManagePanel();
      else openKeyDialog();
    });
    syncEntry();
    refreshManage = function () {
      if (manageDialog && !manageDialog.hidden) paintModeration();
    };
  }

  function moveControls() {
    if (gameId !== "lsu") return null;
    var status = el("p", { class: "hint", role: "status" });
    var review = el("button", { type: "button", class: "btn ghost" }, "Review move to Kentucky");
    var go = el("button", { type: "button", class: "btn" }, "Move to Kentucky");
    go.hidden = true;
    function extra() {
      var headers = { "x-owner-token": ownerToken() };
      try {
        var lock = sessionStorage.getItem("tailgate-move-lock-lsu") || "";
        if (lock) headers["x-move-lock"] = lock;
      } catch (err) {}
      return headers;
    }
    function show(body) {
      if (!body) { status.textContent = "Could not review the move."; return; }
      if (body.phase === "done") {
        status.textContent = "Move finished. " + body.files + " files and " + body.posts + " messages are on Kentucky.";
        go.hidden = true;
        return;
      }
      if (body.error && body.files == null) {
        status.textContent = body.error;
        return;
      }
      var moving = body.phase === "copy" || body.phase === "delete";
      go.textContent = moving ? "Continue move" : "Move to Kentucky";
      var text = "From LSU to Kentucky: " + body.files + " files, " + body.bytes + " bytes, " + body.posts + " messages, " + body.replies + " replies. " + (body.note || "");
      if (body.total) text += " " + body.copied + " copied and " + body.removed + " originals removed, of " + body.total + ".";
      if (body.error) text += " " + body.error;
      status.textContent = text;
    }
    function remember(body) {
      if (!body || !body.lockId) return;
      try { sessionStorage.setItem("tailgate-move-lock-lsu", body.lockId); } catch (err) {}
    }
    function requireOwner() {
      if (ownerToken()) return true;
      status.textContent = "Enter and save your owner key first";
      return false;
    }
    review.addEventListener("click", function () {
      if (!requireOwner()) return;
      fetch(api + "/v1/lsu/move-to-kentucky", { headers: guestHeaders(extra()) })
        .then(function (response) { return response.json(); })
        .then(function (body) {
          show(body);
          if (body && body.phase !== "done" && !(body.error && body.files == null)) go.hidden = false;
        })
        .catch(function () { status.textContent = "Could not review the move."; });
    });
    function run(step) {
      fetch(api + "/v1/lsu/move-to-kentucky", {
        method: "POST",
        headers: guestHeaders(Object.assign({ "content-type": "application/json" }, extra())),
        body: JSON.stringify({ confirm: "MOVE TO KENTUCKY", step: step }),
      }).then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
        .then(function (result) {
          remember(result.body);
          show(result.body);
          if (result.ok && result.body.phase !== "done") return run("continue");
          go.disabled = false;
        })
        .catch(function () {
          go.disabled = false;
          status.textContent = "The move paused. Review it again and continue. Originals stay until the copies are checked.";
        });
    }
    go.addEventListener("click", function () {
      if (!requireOwner()) return;
      var question = "Move the LSU photos, videos, and messages to Kentucky? Originals are removed only after each copy is checked.";
      if (!window.confirm(question)) return;
      go.disabled = true;
      run("start");
    });
    return el("div", { class: "move-panel" },
      el("p", { class: "hint" }, "Move the existing LSU photos, videos, and messages to Kentucky."),
      review, status, go);
  }

  function loadFiles() {
    var round = loadRound;
    return fetch(api + "/v1/" + gameId + "/files", { headers: guestHeaders() }).then(function (response) {
      return response.json().then(function (payload) { return { status: response.status, payload: payload }; });
    }).then(function (result) {
      if (round !== loadRound) return;
      if (result.status === 503) { photos.replaceChildren(note("Photos and videos aren't available yet. Sharing stays off until storage is turned on.")); return; }
      if (result.status !== 200) { photos.replaceChildren(note(result.payload.error || "Could not load photos.")); return; }
      renderFiles(result.payload);
    }).catch(function () {
      if (round !== loadRound) return;
      photos.replaceChildren(note("Photos and videos aren't available yet."));
    });
  }
  function loadPosts() {
    var round = loadRound;
    return fetch(api + "/v1/" + gameId + "/posts", { headers: guestHeaders() }).then(function (response) {
      return response.json().then(function (payload) { return { status: response.status, payload: payload }; });
    }).then(function (result) {
      if (round !== loadRound) return;
      if (result.status === 503) { posts.replaceChildren(note("Messages aren't available yet. The board stays off until storage is turned on.")); return; }
      if (result.status !== 200) { posts.replaceChildren(note(result.payload.error || "Could not load messages.")); return; }
      renderPosts(result.payload);
    }).catch(function () {
      if (round !== loadRound) return;
      posts.replaceChildren(note("Messages aren't available yet."));
    });
  }
  function loadAll() {
    loadRound += 1;
    return Promise.all([loadFiles(), loadPosts()]);
  }
  setupChrome();
  loadAll();
})();
