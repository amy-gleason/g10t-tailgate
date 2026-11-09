"use strict";
(function () {
  var gameId = document.body && document.body.dataset.game;
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

  var pinKey = "tailgate-media-pin-" + gameId;
  var ownerKey = "tailgate-owner-key-" + gameId;
  var ownerMemory = "";
  var pin = "";
  try { pin = sessionStorage.getItem(pinKey) || ""; } catch (error) { pin = ""; }
  try { ownerMemory = sessionStorage.getItem(ownerKey) || ""; } catch (error) { ownerMemory = ""; }

  function guestHeaders(extra) {
    var headers = { "x-guest-pin": pin };
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

  function gate(errorText) {
    var input = el("input", { class: "input", type: "password", autocomplete: "off", placeholder: "Guest code" });
    var error = el("div");
    if (errorText) error.append(el("p", { class: "form-error", role: "alert" }, errorText));
    var form = el("form", { class: "stack" },
      el("p", { class: "lead" }, "Enter the guest code to see photos, videos, and messages for this game."),
      el("label", { class: "field" }, el("span", { class: "label" }, "Guest code"), input),
      error,
      el("button", { type: "submit", class: "btn" }, "Continue")
    );
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      pin = input.value.trim();
      try { sessionStorage.setItem(pinKey, pin); } catch (err) {}
      loadAll();
    });
    photos.replaceChildren(form);
    posts.replaceChildren(note("Enter the guest code under Photos & videos to open messages."));
  }

  var batchHost = null;

  function uploadFiles(files, name) {
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
        xhr.open("POST", api + "/v1/" + gameId + "/files");
        xhr.setRequestHeader("content-type", typeFor(item.file));
        xhr.setRequestHeader("x-file-name", item.file.name);
        xhr.setRequestHeader("x-guest-name", name);
        xhr.setRequestHeader("x-guest-pin", pin);
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
    return run(items, batchId, batchSize);
  }

  function fileCard(file) {
    var card = el("article", { class: file.preview === "none" ? "file-tile" : "shot" });
    var meta = el("div", { class: "file-tile" },
      el("p", { class: "row-title" }, file.name),
      el("p", { class: "row-meta" }, [file.uploadedBy, when(file.createdAt), sizeLabel(file.bytes)].filter(Boolean).join(" · "))
    );
    var download = el("button", { type: "button", class: "btn" }, "Download original");
    download.addEventListener("click", function () {
      fetch(api + "/v1/" + gameId + "/files/" + file.id, { headers: guestHeaders() })
        .then(function (response) { if (!response.ok) throw new Error("download"); return response.blob(); })
        .then(function (blob) {
          var link = el("a", { href: URL.createObjectURL(blob), download: file.name });
          link.click();
        })
        .catch(function () { meta.append(note("Could not download that file.")); });
    });
    meta.append(download);
    if (ownerToken()) {
      var removeFile = el("button", { type: "button", class: "btn ghost" }, "Remove file");
      removeFile.addEventListener("click", function () {
        fetch(api + "/v1/" + gameId + "/files/" + file.id, { method: "DELETE", headers: guestHeaders({ "x-owner-token": ownerToken() }) })
          .then(function (response) { if (response.ok) loadFiles(); });
      });
      meta.append(removeFile);
    }
    if (file.preview === "none") {
      meta.prepend(note("This browser can't preview this file. The original is unchanged."));
      card.append(meta);
      return card;
    }
    fetch(api + "/v1/" + gameId + "/files/" + file.id + "?inline=1", { headers: guestHeaders() })
      .then(function (response) { if (!response.ok) throw new Error("preview"); return response.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var view = file.preview === "video" ? el("video", { controls: "", src: url }) : el("img", { src: url, alt: file.name });
        card.prepend(view);
      })
      .catch(function () { meta.prepend(note("Preview failed. The original can still be downloaded.")); });
    card.append(meta);
    return card;
  }

  function renderFiles(data) {
    var name = el("input", { class: "input", maxLength: "40", autocomplete: "name", placeholder: "Your name" });
    var picker = el("input", { class: "file-input", type: "file", multiple: "", accept: "image/*,video/*,.heic,.heif,.mov" });
    var list = el("div", { class: "gallery" });
    (data.files || []).forEach(function (file) { list.append(fileCard(file)); });
    var batchError = el("p", { class: "field-error", role: "alert" });
    batchError.hidden = true;
    var form = el("form", { class: "stack" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Your name"), name),
      el("label", { class: "field" }, el("span", { class: "label" }, "Photos and videos"), picker),
      batchError,
      el("button", { type: "submit", class: "btn" }, "Upload")
    );
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!name.value.trim() || !picker.files.length) return;
      if (picker.files.length > 50) {
        batchError.hidden = false;
        batchError.textContent = "Choose 50 files or fewer at a time.";
        return;
      }
      batchError.hidden = true;
      batchError.textContent = "";
      uploadFiles(Array.from(picker.files), name.value.trim());
      picker.value = "";
    });
    photos.replaceChildren();
    photos.append(
      el("p", { class: "lead" }, "Photos and videos for this game stay separate from the other games."),
      form
    );
    if (batchHost) photos.append(batchHost);
    photos.append(list, ownerTools());
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
    var name = el("input", { class: "input", maxLength: "40", placeholder: "Your name" });
    var text = messageBox("Reply");
    var error = el("div");
    var button = el("button", { type: "submit", class: "btn" }, "Reply");
    var form = el("form", { class: "stack" }, name, text, error, button);
    name.addEventListener("keydown", function (event) {
      if (event.key === "Enter") event.preventDefault();
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (text.value.length > REPLY_LIMIT) {
        error.replaceChildren(el("p", { class: "form-error" }, tooLong("reply", text.value, REPLY_LIMIT)));
        return;
      }
      fetch(api + "/v1/" + gameId + "/posts/" + post.id, {
        method: "POST",
        headers: guestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: name.value, text: text.value }),
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

  function renderPosts(data) {
    var name = el("input", { class: "input", maxLength: "40", placeholder: "Your name", autocomplete: "name" });
    var text = messageBox("Write a message");
    var error = el("div");
    var form = el("form", { class: "stack" },
      el("p", { class: "lead" }, "Messages and replies for this game. This is a board, not a live chat."),
      el("label", { class: "field" }, el("span", { class: "label" }, "Your name"), name),
      el("label", { class: "field" }, el("span", { class: "label" }, "Message"), text),
      error,
      el("button", { type: "submit", class: "btn" }, "Send message")
    );
    name.addEventListener("keydown", function (event) {
      if (event.key === "Enter") event.preventDefault();
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (text.value.length > POST_LIMIT) {
        error.replaceChildren(el("p", { class: "form-error" }, tooLong("message", text.value, POST_LIMIT)));
        return;
      }
      fetch(api + "/v1/" + gameId + "/posts", {
        method: "POST",
        headers: guestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: name.value, text: text.value }),
      }).then(function (response) { return response.json().then(function (payload) { return { ok: response.ok, payload: payload }; }); })
        .then(function (result) {
          if (!result.ok) { error.replaceChildren(el("p", { class: "form-error" }, result.payload.error || "Could not send that message.")); return; }
          text.value = "";
          fitMessage(text);
          loadPosts();
        });
    });
    var list = el("div", { class: "post-list" });
    (data.posts || []).forEach(function (post) {
      var block = el("article", { class: "post" },
        el("p", { class: "row-title" }, post.name),
        el("p", { class: "hint" }, when(post.createdAt)),
        messageBody(post.text)
      );
      (post.replies || []).forEach(function (reply) {
        var replyBlock = el("div", { class: "reply" },
          el("p", { class: "row-title" }, reply.name),
          el("p", { class: "hint" }, when(reply.createdAt)),
          messageBody(reply.text)
        );
        if (ownerToken()) {
          var removeReply = el("button", { type: "button", class: "btn ghost" }, "Remove reply");
          removeReply.addEventListener("click", function () {
            fetch(api + "/v1/" + gameId + "/posts/" + post.id + "/replies/" + reply.id, {
              method: "DELETE",
              headers: guestHeaders({ "x-owner-token": ownerToken() }),
            }).then(function (response) { if (response.ok) loadPosts(); });
          });
          replyBlock.append(removeReply);
        }
        block.append(replyBlock);
      });
      block.append(replyForm(post));
      if (ownerToken()) {
        var remove = el("button", { type: "button", class: "btn ghost" }, "Remove message");
        remove.addEventListener("click", function () {
          fetch(api + "/v1/" + gameId + "/posts/" + post.id, { method: "DELETE", headers: guestHeaders({ "x-owner-token": ownerToken() }) })
            .then(function (response) { if (response.ok) loadPosts(); });
        });
        block.append(remove);
      }
      list.append(block);
    });
    var refresh = el("button", { type: "button", class: "btn ghost" }, "Refresh");
    refresh.addEventListener("click", loadPosts);
    posts.replaceChildren(form, refresh, list, ownerTools());
  }

  function ownerTools() {
    var input = el("input", {
      class: "input",
      type: "password",
      autocomplete: "off",
      autocapitalize: "off",
      autocorrect: "off",
      spellcheck: "false",
      placeholder: "Owner key",
    });
    var saved = el("p", { class: "hint", role: "status" });
    var form = el("form", { class: "stack" },
      el("p", { class: "hint" }, "Owner key removes messages or files. Guests do not get this."),
      input,
      el("button", { type: "submit", class: "btn ghost" }, "Save owner key on this phone"),
      saved
    );
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var next = input.value.trim();
      if (!next) return;
      saveOwnerToken(next);
      input.value = "";
      saved.textContent = "Owner key saved on this phone";
    });
    var details = el("details", null, el("summary", null, "Owner tools"), form);
    var move = moveControls();
    if (move) details.append(move);
    return details;
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
        .then(function (body) { show(body); go.hidden = false; })
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
    return fetch(api + "/v1/" + gameId + "/files", { headers: guestHeaders() }).then(function (response) {
      return response.json().then(function (payload) { return { status: response.status, payload: payload }; });
    }).then(function (result) {
      if (result.status === 401) { gate("That guest code was not accepted."); return; }
      if (result.status === 503) { photos.replaceChildren(note("Photos and videos aren't available yet. Sharing stays off until storage is turned on.")); return; }
      if (result.status !== 200) { photos.replaceChildren(note(result.payload.error || "Could not load photos.")); return; }
      renderFiles(result.payload);
    }).catch(function () { photos.replaceChildren(note("Photos and videos aren't available yet.")); });
  }
  function loadPosts() {
    return fetch(api + "/v1/" + gameId + "/posts", { headers: guestHeaders() }).then(function (response) {
      return response.json().then(function (payload) { return { status: response.status, payload: payload }; });
    }).then(function (result) {
      if (result.status === 401) { gate("That guest code was not accepted."); return; }
      if (result.status === 503) { posts.replaceChildren(note("Messages aren't available yet. The board stays off until storage is turned on.")); return; }
      if (result.status !== 200) { posts.replaceChildren(note(result.payload.error || "Could not load messages.")); return; }
      renderPosts(result.payload);
    }).catch(function () { posts.replaceChildren(note("Messages aren't available yet.")); });
  }
  function loadAll() { return Promise.all([loadFiles(), loadPosts()]); }
  if (!pin) gate("");
  else loadAll();
})();
