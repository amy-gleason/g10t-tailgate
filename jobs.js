/* Phone navigation for the four guest jobs. Desktop keeps the section list. */
(function () {
  var gameId = document.body && document.body.dataset.game;
  var game = (window.TAILGATE_GAMES || {})[gameId];
  var main = document.querySelector("main");
  if (!game || !main) return;

  var jobs = [
    { id: "game", label: "Game", mark: "⌂" },
    { id: "rsvp", label: "RSVP", mark: "🙋" },
    { id: "bring", label: "Bring", mark: "🧺" },
  ];
  if (game.media) {
    jobs.push({ id: "photos", label: "Photos", mark: "📷" });
    jobs.push({ id: "messages", label: "Messages", mark: "💬" });
  }

  var sectionsFor = {
    game: [],
    rsvp: ["coming"],
    bring: ["food", "other", "drinks", "donations"],
    photos: ["photos"],
    messages: ["posts"],
  };
  var fromHash = {
    coming: "rsvp",
    food: "bring",
    drinks: "bring",
    donations: "bring",
    other: "bring",
    photos: "photos",
    posts: "messages",
  };

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
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(child));
    }
    return node;
  }

  var cards = el("div", { class: "job-cards", id: "job-cards" });
  [
    ["rsvp", "I'm coming", "🙋", "job-count-rsvp", "Who's coming", true],
    ["bring", "Bring something", "🧺", "job-count-bring", "Food, drinks, and more", false],
    ["photos", "Photos & videos", "📷", "job-count-photos", "See what was shared", false],
    ["messages", "Messages", "💬", "job-count-messages", "Notes for this game", false],
  ].forEach(function (item) {
    if ((item[0] === "photos" || item[0] === "messages") && !game.media) return;
    var count = el("span", { id: item[3] }, item[4]);
    var card = el("button", {
      type: "button",
      class: item[5] ? "job-card hot" : "job-card",
      "data-job-card": item[0],
    }, el("span", { class: "job-mark", "aria-hidden": "true" }, item[2]), el("b", null, item[1]), count);
    card.addEventListener("click", function () { select(item[0], true); });
    cards.append(card);
  });
  var heading = main.querySelector("h1");
  if (heading && heading.nextSibling) main.insertBefore(cards, heading.nextSibling);
  else main.insertBefore(cards, main.firstChild);

  var tabs = [];
  var tablist = el("div", { class: "job-tabs", role: "tablist", "aria-label": "Game sections" });
  jobs.forEach(function (job, index) {
    var tab = el("button", {
      type: "button",
      class: "job-tab",
      role: "tab",
      id: "job-tab-" + job.id,
      "data-job-tab": job.id,
      "aria-selected": "false",
      tabindex: "-1",
    }, el("span", { class: "job-mark", "aria-hidden": "true" }, job.mark), el("span", null, job.label));
    tab.addEventListener("click", function () { select(job.id, false); });
    tab.addEventListener("keydown", function (event) {
      var nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % jobs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index + jobs.length - 1) % jobs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = jobs.length - 1;
      if (nextIndex == null) return;
      event.preventDefault();
      select(jobs[nextIndex].id, false);
      tabs[nextIndex].focus();
    });
    tabs.push(tab);
    tablist.append(tab);
  });
  document.body.append(tablist);

  var current = "game";
  function phoneOn() {
    return window.matchMedia("(max-width: 899px)").matches;
  }
  function showPanels(ids) {
    document.querySelectorAll(".acc").forEach(function (acc) {
      var id = acc.getAttribute("data-section");
      var open = ids.indexOf(id) !== -1;
      var panel = acc.querySelector(".acc-panel");
      if (!panel) return;
      if (open) panel.hidden = false;
    });
  }
  function select(job, focusTab) {
    if (!sectionsFor[job]) job = "game";
    current = job;
    document.body.dataset.job = job;
    document.body.classList.toggle("phone-jobs", phoneOn());
    if (!phoneOn()) document.body.removeAttribute("data-job");
    tabs.forEach(function (tab) {
      var on = tab.getAttribute("data-job-tab") === job;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      if (on && focusTab) tab.focus();
    });
    showPanels(sectionsFor[job] || []);
    paintCounts();
  }
  function paintCounts() {
    var total = document.querySelector(".total-n");
    var coming = document.getElementById("job-count-rsvp");
    if (coming && total && total.textContent) coming.textContent = total.textContent + " people so far";
    var photos = document.querySelectorAll("#photos-body .photo-grid > article, #photos-body .gallery > article").length;
    var photoCount = document.getElementById("job-count-photos");
    if (photoCount) photoCount.textContent = photos ? photos + " shared" : "See what was shared";
    var posts = document.querySelectorAll("#posts-body .post").length;
    var messageCount = document.getElementById("job-count-messages");
    if (messageCount) messageCount.textContent = posts ? posts + " posted" : "Notes for this game";
  }
  var labelFor = { lsu: "LSU", kentucky: "Kentucky", alabama: "Alabama" };
  var monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function whenParts(date) {
    var match = String(date || "").match(/([A-Za-z]+)\s+(\d{1,2})/);
    if (!match || monthNames.indexOf(match[1]) === -1) return { mon: "", day: "" };
    return { mon: match[1].slice(0, 3), day: match[2] };
  }
  function gameLink(id) {
    var label = labelFor[id];
    var links = game.gamesMenu || [];
    for (var i = 0; i < links.length; i++) if (links[i].label === label) return links[i];
    return { href: "./", label: label || id };
  }
  var here = whenParts(game.date);
  var switchLabel = (labelFor[gameId] || "Games") + (here.day ? " · " + here.mon + " " + here.day : "");
  var opener = el("button", {
    type: "button",
    class: "game-switch",
    id: "game-switch",
    "aria-haspopup": "dialog",
    "aria-controls": "game-sheet",
  }, switchLabel);
  main.insertBefore(opener, main.firstChild);
  var oldNav = document.querySelector(".game-nav");
  if (oldNav) oldNav.hidden = true;

  var sheetList = el("div");
  function addGroup(title, list) {
    if (!list.length) return;
    sheetList.append(el("p", { class: "game-kicker" }, title));
    var ul = el("ul", { class: "game-list" });
    list.forEach(function (entry) {
      var parts = whenParts(entry.date);
      var dateMark = el("span", { class: "game-date" }, el("span", null, parts.mon.toUpperCase()), el("b", null, parts.day || ""));
      var link = el("a", { href: entry.href }, dateMark, el("span", null, el("b", null, entry.title), el("span", { class: "game-sub" }, entry.detail)));
      if (entry.current) link.setAttribute("aria-current", "page");
      ul.append(el("li", null, link));
    });
    sheetList.append(ul);
  }
  var upcoming = [];
  var past = [];
  Object.keys(window.TAILGATE_GAMES).forEach(function (id) {
    var item = window.TAILGATE_GAMES[id];
    var link = gameLink(id);
    var row = {
      id: id,
      date: item.date,
      href: link.href,
      current: id === gameId,
      title: item.banner || labelFor[id] || id,
      detail: item.past ? "Past game" : "Next up",
    };
    if (item.past) past.push(row);
    else upcoming.push(row);
  });
  addGroup("Next up", upcoming);
  addGroup("Past games", past);
  var closeGames = el("button", { type: "button", class: "btn ghost", id: "game-sheet-close" }, "Close");
  var sheet = el("div", {
    id: "game-sheet",
    class: "game-sheet",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "game-sheet-title",
    hidden: "",
  }, el("div", { class: "game-sheet-panel" },
    el("div", { class: "game-sheet-bar" }, el("h2", { id: "game-sheet-title" }, "Games"), closeGames),
    sheetList
  ));
  document.body.append(sheet);
  function closeSheet() {
    sheet.hidden = true;
    document.body.style.overflow = "";
    opener.focus();
  }
  function openSheet() {
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    closeGames.focus();
  }
  if (document.getElementById("owner-entry")) {
    var ownerJump = el("button", { type: "button", class: "btn ghost", id: "game-sheet-owner" }, "Owner sign-in");
    ownerJump.addEventListener("click", function () {
      closeSheet();
      var owner = document.getElementById("owner-entry");
      if (owner) owner.click();
    });
    sheet.querySelector(".game-sheet-panel").append(el("p", { class: "game-kicker" }, "Hosting?"), ownerJump);
  }
  opener.addEventListener("click", openSheet);
  closeGames.addEventListener("click", closeSheet);
  sheet.addEventListener("click", function (event) { if (event.target === sheet) closeSheet(); });
  sheet.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
    }
  });

  if (game.past) {
    document.body.classList.add("past-game");
    var nextId = Object.keys(window.TAILGATE_GAMES).filter(function (id) { return !window.TAILGATE_GAMES[id].past; })[0];
    var next = nextId ? window.TAILGATE_GAMES[nextId] : null;
    var banner = el("p", { class: "archive-banner", role: "status" }, "This game is over.");
    if (next) {
      banner.append(document.createTextNode(" "));
      banner.append(el("a", { href: gameLink(nextId).href }, "Go to " + (labelFor[nextId] || next.banner)));
    }
    main.insertBefore(banner, main.firstChild);
    var photosAcc = document.querySelector('.acc[data-section="photos"]');
    if (photosAcc && !photosAcc.querySelector(".past-photos-title")) {
      photosAcc.insertBefore(el("h2", { class: "past-photos-title" }, "Photos & videos"), photosAcc.firstChild);
    }
    var prompt = /^(I['’]ll bring|Add me|Sign me up|Add it|Add donation|Upload|Send message|Reply|Edit|Remove|Yes, remove)/;
    function hush(root) {
      root.querySelectorAll("form").forEach(function (form) { form.hidden = true; });
      root.querySelectorAll("button").forEach(function (button) {
        if (button.closest(".job-tabs, .job-cards, .game-sheet, .viewer, .manage, .modal")) return;
        if (prompt.test((button.textContent || "").trim())) button.hidden = true;
      });
    }
    hush(main);
    if (window.MutationObserver) {
      new MutationObserver(function () { hush(main); }).observe(main, { childList: true, subtree: true });
    }
  }

  var start = fromHash[(location.hash || "").replace("#", "")] || "game";
  select(start, false);
  window.addEventListener("hashchange", function () {
    var next = fromHash[(location.hash || "").replace("#", "")];
    if (next) select(next, false);
  });
  var phoneQuery = window.matchMedia("(max-width: 899px)");
  if (phoneQuery.addEventListener) phoneQuery.addEventListener("change", function () { select(current, false); });
  window.setInterval(paintCounts, 1500);
  paintCounts();
})();
