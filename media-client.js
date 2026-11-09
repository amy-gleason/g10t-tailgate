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
  var pin = "";
  try { pin = sessionStorage.getItem(pinKey) || ""; } catch (error) { pin = ""; }

  function guestHeaders(extra) {
    var headers = { "x-guest-pin": pin };
    Object.keys(extra || {}).forEach(function (key) { headers[key] = extra[key]; });
    return headers;
  }
  function ownerToken() {
    try { return sessionStorage.getItem(ownerKey) || ""; } catch (error) { return ""; }
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

  function mediaType(file) {
    return String(file.contentType || "").split(";")[0].trim().toLowerCase();
  }
  function videoType(file) {
    var type = mediaType(file);
    if (type === "video/mp4" || type === "video/webm" || type === "video/quicktime") return type;
    return file.preview === "video" ? "video/mp4" : "";
  }
  function downloadOriginal(file, target) {
    fetch(api + "/v1/" + gameId + "/files/" + file.id, { headers: guestHeaders() })
      .then(function (response) { if (!response.ok) throw new Error("download"); return response.blob(); })
      .then(function (blob) {
        var link = el("a", { href: URL.createObjectURL(blob), download: file.name });
        link.click();
      })
      .catch(function () { target.append(note("Could not download that file.")); });
  }
  var viewerFiles = [];
  var viewerIndex = 0;
  var viewerReturn = null;
  var viewer = null;
  function showViewer(index, returnTo) {
    viewerIndex = index;
    viewerReturn = returnTo || document.activeElement;
    if (!viewer) viewer = buildViewer();
    paintViewer();
    viewer.hidden = false;
    viewer.querySelector(".viewer-close").focus();
  }
  function closeViewer() {
    if (!viewer) return;
    viewer.hidden = true;
    if (viewerReturn && viewerReturn.focus) viewerReturn.focus();
  }
  function paintViewer() {
    var file = viewerFiles[viewerIndex];
    var stage = viewer.querySelector(".viewer-stage");
    var label = viewer.querySelector(".viewer-count");
    label.textContent = (viewerIndex + 1) + " of " + viewerFiles.length;
    viewer.querySelector(".viewer-prev").disabled = viewerIndex === 0;
    viewer.querySelector(".viewer-next").disabled = viewerIndex === viewerFiles.length - 1;
    stage.replaceChildren(note("Loading…"));
    var kind = videoType(file);
    fetch(api + "/v1/" + gameId + "/files/" + file.id + (kind ? "" : "?inline=1"), { headers: guestHeaders() })
      .then(function (response) { if (!response.ok) throw new Error("preview"); return response.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        if (kind) {
          var video = el("video", { controls: "", playsinline: "", preload: "metadata" });
          video.setAttribute("playsinline", "");
          video.addEventListener("error", function () {
            stage.replaceChildren(note("This browser could not play this video. You can download it instead."));
          });
          stage.replaceChildren(video);
          video.src = url;
          return;
        }
        var image = el("img", { src: url, alt: file.name });
        stage.replaceChildren(image);
      })
      .catch(function () { stage.replaceChildren(note("Preview failed. The original can still be downloaded.")); });
  }
  function buildViewer() {
    var stage = el("div", { class: "viewer-stage" });
    var count = el("p", { class: "viewer-count" });
    var prev = el("button", { type: "button", class: "viewer-nav viewer-prev" }, "Previous");
    var next = el("button", { type: "button", class: "viewer-nav viewer-next" }, "Next");
    var close = el("button", { type: "button", class: "viewer-close" }, "Close");
    var download = el("button", { type: "button", class: "viewer-nav" }, "Download original");
    prev.addEventListener("click", function () { if (viewerIndex > 0) { viewerIndex -= 1; paintViewer(); } });
    next.addEventListener("click", function () { if (viewerIndex < viewerFiles.length - 1) { viewerIndex += 1; paintViewer(); } });
    close.addEventListener("click", closeViewer);
    download.addEventListener("click", function () { downloadOriginal(viewerFiles[viewerIndex], stage); });
    var root = el("div", { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": "Photo viewer", hidden: "" });
    var bar = el("div", { class: "viewer-bar" }, close, count, download);
    var nav = el("div", { class: "viewer-bar" }, prev, next);
    root.append(bar, stage, nav);
    var startX = 0;
    stage.addEventListener("touchstart", function (event) { startX = event.changedTouches[0].clientX; }, { passive: true });
    stage.addEventListener("touchend", function (event) {
      var delta = event.changedTouches[0].clientX - startX;
      if (delta > 40 && viewerIndex > 0) { viewerIndex -= 1; paintViewer(); }
      if (delta < -40 && viewerIndex < viewerFiles.length - 1) { viewerIndex += 1; paintViewer(); }
    });
    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.stopPropagation(); closeViewer(); }
      if (event.key === "ArrowLeft" && viewerIndex > 0) { viewerIndex -= 1; paintViewer(); }
      if (event.key === "ArrowRight" && viewerIndex < viewerFiles.length - 1) { viewerIndex += 1; paintViewer(); }
    });
    document.body.append(root);
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || root.hidden) return;
      event.stopPropagation();
      closeViewer();
    });
    return root;
  }
  function fileCard(file) {
    var playable = Boolean(videoType(file));
    var image = file.preview === "image";
    var card = el("article", { class: image || playable ? "shot" : "file-tile" });
    var meta = el("div", { class: "file-tile" },
      el("p", { class: "row-title" }, file.name),
      el("p", { class: "row-meta" }, [file.uploadedBy, when(file.createdAt), sizeLabel(file.bytes)].filter(Boolean).join(" · "))
    );
    var download = el("button", { type: "button", class: "btn" }, "Download original");
    download.addEventListener("click", function () { downloadOriginal(file, meta); });
    meta.append(download);
    if (ownerToken()) {
      var removeFile = el("button", { type: "button", class: "btn ghost" }, "Remove file");
      removeFile.addEventListener("click", function () {
        fetch(api + "/v1/" + gameId + "/files/" + file.id, { method: "DELETE", headers: guestHeaders({ "x-owner-token": ownerToken() }) })
          .then(function () { loadFiles(); });
      });
      meta.append(removeFile);
    }
    if (!image && !playable) {
      meta.prepend(note("This browser can't preview this file. The original is unchanged."));
      card.append(meta);
      return card;
    }
    var open = el("button", { type: "button", class: "shot-open", "aria-label": "Open " + file.name });
    open.addEventListener("click", function () {
      viewerFiles = viewerSource();
      var index = 0;
      viewerFiles.forEach(function (item, itemIndex) { if (item.id === file.id) index = itemIndex; });
      showViewer(index, open);
    });
    card.append(open, meta);
    var holder = el("div");
    fetch(api + "/v1/" + gameId + "/files/" + file.id + (playable ? "" : "?inline=1"), { headers: guestHeaders() })
      .then(function (response) { if (!response.ok) throw new Error("preview"); return response.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        if (playable) {
          var video = el("video", { controls: "", playsinline: "", preload: "metadata" });
          video.setAttribute("playsinline", "");
          video.addEventListener("error", function () {
            holder.replaceChildren(note("This browser could not play this video. You can download it instead."));
          });
          holder.replaceChildren(video);
          video.src = url;
          return;
        }
        var img = el("img", { src: url, alt: file.name });
        open.replaceChildren(img);
      })
      .catch(function () {
        var message = note("Preview failed. The original can still be downloaded.");
        if (playable) holder.replaceChildren(message);
        else meta.prepend(message);
      });
    if (playable) card.insertBefore(holder, meta);
    return card;
  }
  var galleryFiles = [];
  function viewerSource() { return galleryFiles.filter(function (file) { return file.preview === "image" || videoType(file); }); }

  function renderFiles(data) {
    var name = el("input", { class: "input", maxLength: "40", autocomplete: "name", placeholder: "Your name", "aria-required": "true", "aria-describedby": "upload-name-error" });
    var nameError = el("p", { class: "field-error", id: "upload-name-error", role: "alert" });
    nameError.hidden = true;
    var picker = el("input", { class: "file-input", type: "file", multiple: "", accept: "image/*,video/*,.heic,.heif,.mov" });
    galleryFiles = data.files || [];
    var list = el("div", { class: "gallery" });
    galleryFiles.forEach(function (file) { list.append(fileCard(file)); });
    function showNameError() {
      name.setAttribute("aria-invalid", "true");
      nameError.hidden = false;
      nameError.textContent = "Name is required";
      name.focus();
      name.scrollIntoView({ block: "center" });
    }
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
      batchError,
      el("button", { type: "submit", class: "btn" }, "Upload")
    );
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!name.value.trim()) {
        showNameError();
        return;
      }
      if (!picker.files.length) return;
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
    photos.append(list);
  }

  function replyForm(post) {
    var name = el("input", { class: "input", maxLength: "40", placeholder: "Your name" });
    var text = el("input", { class: "input", maxLength: "1000", placeholder: "Reply" });
    var error = el("div");
    var form = el("form", { class: "stack" }, name, text, error, el("button", { type: "submit", class: "btn" }, "Reply"));
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      fetch(api + "/v1/" + gameId + "/posts/" + post.id, {
        method: "POST",
        headers: guestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: name.value, text: text.value }),
      }).then(function (response) { return response.json().then(function (payload) { return { ok: response.ok, payload: payload }; }); })
        .then(function (result) {
          if (!result.ok) { error.replaceChildren(el("p", { class: "form-error" }, result.payload.error || "Could not reply.")); return; }
          loadPosts();
        });
    });
    return form;
  }

  function renderPosts(data) {
    var name = el("input", { class: "input", maxLength: "40", placeholder: "Your name", autocomplete: "name" });
    var text = el("input", { class: "input", maxLength: "1000", placeholder: "Write a message" });
    var error = el("div");
    var form = el("form", { class: "stack" },
      el("p", { class: "lead" }, "Messages and replies for this game. This is a board, not a live chat."),
      el("label", { class: "field" }, el("span", { class: "label" }, "Your name"), name),
      el("label", { class: "field" }, el("span", { class: "label" }, "Message"), text),
      error,
      el("button", { type: "submit", class: "btn" }, "Send message")
    );
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      fetch(api + "/v1/" + gameId + "/posts", {
        method: "POST",
        headers: guestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: name.value, text: text.value }),
      }).then(function (response) { return response.json().then(function (payload) { return { ok: response.ok, payload: payload }; }); })
        .then(function (result) {
          if (!result.ok) { error.replaceChildren(el("p", { class: "form-error" }, result.payload.error || "Could not send that message.")); return; }
          text.value = "";
          loadPosts();
        });
    });
    var list = el("div", { class: "post-list" });
    (data.posts || []).forEach(function (post) {
      var block = el("article", { class: "post" },
        el("p", { class: "row-title" }, post.name),
        el("p", { class: "hint" }, when(post.createdAt)),
        el("p", { class: "lead" }, post.text)
      );
      (post.replies || []).forEach(function (reply) {
        var replyBlock = el("div", { class: "reply" },
          el("p", { class: "row-title" }, reply.name),
          el("p", { class: "hint" }, when(reply.createdAt)),
          el("p", {}, reply.text)
        );
        if (ownerToken()) {
          var removeReply = el("button", { type: "button", class: "btn ghost" }, "Remove reply");
          removeReply.addEventListener("click", function () {
            fetch(api + "/v1/" + gameId + "/posts/" + post.id + "/replies/" + reply.id, {
              method: "DELETE",
              headers: guestHeaders({ "x-owner-token": ownerToken() }),
            }).then(function () { loadPosts(); });
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
            .then(function () { loadPosts(); });
        });
        block.append(remove);
      }
      list.append(block);
    });
    var refresh = el("button", { type: "button", class: "btn ghost" }, "Refresh");
    refresh.addEventListener("click", loadPosts);
    posts.replaceChildren(form, refresh, list);
  }

  function setupOwnerDialog() {
    var input = el("input", { class: "input", type: "password", autocomplete: "off", id: "owner-key-input" });
    var status = el("p", { class: "hint", role: "status" });
    var form = el("form", { class: "stack" },
      el("p", { class: "hint" }, "The owner key removes files or messages. A guest code cannot do that."),
      el("label", { class: "field" }, el("span", { class: "label" }, "Owner key"), input),
      status,
      el("button", { type: "submit", class: "btn" }, "Save owner key on this phone")
    );
    var close = el("button", { type: "button", class: "btn ghost" }, "Close");
    var panel = el("div", { class: "owner-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "owner-dialog-title" },
      el("h2", { id: "owner-dialog-title" }, "Owner tools"),
      form,
      close
    );
    var dialog = el("div", { id: "owner-dialog", class: "owner-dialog", hidden: "" }, panel);
    function closeDialog() {
      dialog.hidden = true;
      var opener = document.getElementById("owner-menu-button");
      if (opener) opener.focus();
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = input.value.trim();
      try {
        if (value) sessionStorage.setItem(ownerKey, value);
        else sessionStorage.removeItem(ownerKey);
      } catch (err) {}
      input.value = "";
      status.textContent = value ? "Owner key saved on this phone." : "Owner key cleared on this phone.";
      loadAll();
    });
    close.addEventListener("click", closeDialog);
    dialog.addEventListener("click", function (event) { if (event.target === dialog) closeDialog(); });
    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.stopPropagation(); closeDialog(); }
    });
    document.body.append(dialog);
    document.addEventListener("tailgate-owner-tools", function () {
      input.value = "";
      status.textContent = ownerToken() ? "An owner key is already saved on this phone." : "";
      dialog.hidden = false;
      input.focus();
    });
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
  setupOwnerDialog();
  if (!pin) gate("");
  else loadAll();
})();
