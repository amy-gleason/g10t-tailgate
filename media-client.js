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

  function uploadFiles(files, name, list) {
    Array.from(files).forEach(function (file) {
      var meter = el("span");
      var row = el("div", { class: "file-tile" }, el("p", { class: "row-title" }, file.name), el("div", { class: "meter" }, meter), el("p", { class: "hint" }, "Waiting…"));
      list.prepend(row);
      var xhr = new XMLHttpRequest();
      xhr.open("POST", api + "/v1/" + gameId + "/files");
      xhr.setRequestHeader("content-type", typeFor(file));
      xhr.setRequestHeader("x-file-name", file.name);
      xhr.setRequestHeader("x-guest-name", name);
      xhr.setRequestHeader("x-guest-pin", pin);
      xhr.upload.onprogress = function (event) {
        if (!event.lengthComputable) return;
        meter.style.width = Math.round(event.loaded / event.total * 100) + "%";
        row.lastChild.textContent = "Uploading " + Math.round(event.loaded / event.total * 100) + "%";
      };
      xhr.onload = function () {
        var payload = {};
        try { payload = JSON.parse(xhr.responseText); } catch (err) {}
        if (xhr.status >= 200 && xhr.status < 300) {
          row.lastChild.textContent = "Uploaded";
          loadFiles();
        } else {
          row.lastChild.textContent = payload.error || "Could not upload that file.";
        }
      };
      xhr.onerror = function () { row.lastChild.textContent = "Could not upload that file."; };
      xhr.send(file);
    });
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
    var form = el("form", { class: "stack" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Your name"), name),
      el("label", { class: "field" }, el("span", { class: "label" }, "Photos and videos"), picker),
      el("button", { type: "submit", class: "btn" }, "Upload")
    );
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!name.value.trim() || !picker.files.length) return;
      uploadFiles(picker.files, name.value.trim(), list);
      picker.value = "";
    });
    photos.replaceChildren(
      el("p", { class: "lead" }, "Photos and videos for this game stay separate from the other games."),
      form,
      list,
      ownerTools(function () { return loadFiles(); })
    );
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
        block.append(el("div", { class: "reply" },
          el("p", { class: "row-title" }, reply.name),
          el("p", { class: "hint" }, when(reply.createdAt)),
          el("p", {}, reply.text)
        ));
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
    posts.replaceChildren(form, refresh, list, ownerTools(loadPosts));
  }

  function ownerTools(after) {
    var input = el("input", { class: "input", type: "password", autocomplete: "off", placeholder: "Owner key" });
    input.value = ownerToken();
    var form = el("form", { class: "stack" },
      el("p", { class: "hint" }, "Owner key removes messages or files. Guests do not get this."),
      input,
      el("button", { type: "submit", class: "btn ghost" }, "Save owner key on this phone")
    );
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      try { sessionStorage.setItem(ownerKey, input.value.trim()); } catch (err) {}
      if (after) after();
    });
    return el("details", null, el("summary", null, "Owner tools"), form);
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
