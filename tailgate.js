"use strict";
(() => {
  var game = bootGame();
  if (!game) return;
  var P = game.foodNote,
    D = game.items,
    F = new Set(D.map((e) => e.id));
  function A(e, t) {
    if (typeof e != "string") return null;
    let n = e
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return !n || n.length > t ? null : n;
  }
  function j(e, t = 160) {
    if (e == null || e === "") return "";
    if (typeof e != "string") return null;
    let n = e
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return n.length > t ? null : n;
  }
  function $(e) {
    return typeof e != "number" || !Number.isInteger(e) || e < 1 || e > 999
      ? null
      : e;
  }
  function R(e) {
    let t = typeof e == "number" ? e : typeof e == "string" ? Number(e) : NaN;
    if (!Number.isFinite(t)) return null;
    let n = Math.round(t * 100) / 100;
    return n < 0.01 || n > 5e3 ? null : n;
  }
  var pe = 300,
    fe = 80,
    ye = 300,
    he = 300;
  function v() {
    return new Date().toISOString();
  }
  function be(e, t) {
    return F.has(t) || e.customItems.some((n) => n.id === t);
  }
  function x(e, t) {
    let n = A(e, 40);
    return n
      ? { name: n }
      : { error: `Enter ${t}. Keep it under 40 characters.` };
  }
  function q(e) {
    let t = $(e);
    return t == null
      ? {
          error:
            "Enter how many you're bringing. Use a whole number from 1 to 999.",
        }
      : { qty: t };
  }
  function S(e) {
    let t = j(e);
    return t == null
      ? { error: "Keep the note under 160 characters, or leave it blank." }
      : { note: t };
  }
  function O(e, t) {
    switch (t.type) {
      case "add-signup":
        return ke(e, t);
      case "update-signup":
        return ve(e, t);
      case "delete-signup":
        return we(e, t.id);
      case "add-custom":
        return Ae(e, t);
      case "rename-custom":
        return Ce(e, t);
      case "delete-custom":
        return xe(e, t.id);
      case "add-donation":
        return Se(e, t);
      case "update-donation":
        return Ie(e, t);
      case "delete-donation":
        return Ee(e, t.id);
      case "add-attendee":
        return Me(e, t);
      case "update-attendee":
        return Le(e, t);
      case "delete-attendee":
        return Te(e, t.id);
      default:
        return { ok: !1, error: "That action is not supported." };
    }
  }
  function ke(e, t) {
    if (!be(e, t.itemId))
      return {
        ok: !1,
        error: "That item is not on the list anymore. Refresh and try again.",
      };
    if (e.signups.length >= pe)
      return {
        ok: !1,
        error: "The signup list is full. Text Amy and she'll make room.",
      };
    let n = x(t.name, "your name");
    if ("error" in n) return { ok: !1, error: n.error };
    let r = q(t.qty);
    if ("error" in r) return { ok: !1, error: r.error };
    let o = S(t.note);
    if ("error" in o) return { ok: !1, error: o.error };
    let a = v(),
      u = {
        id: crypto.randomUUID(),
        itemId: t.itemId,
        name: n.name,
        qty: r.qty,
        note: o.note,
        createdAt: a,
        updatedAt: a,
      };
    return { ok: !0, board: { ...e, signups: [...e.signups, u] } };
  }
  function ve(e, t) {
    if (!e.signups.find((u) => u.id === t.id))
      return { ok: !1, error: "That signup is no longer on the list." };
    let r = x(t.name, "your name");
    if ("error" in r) return { ok: !1, error: r.error };
    let o = q(t.qty);
    if ("error" in o) return { ok: !1, error: o.error };
    let a = S(t.note);
    return "error" in a
      ? { ok: !1, error: a.error }
      : {
          ok: !0,
          board: {
            ...e,
            signups: e.signups.map((u) =>
              u.id === t.id
                ? {
                    ...u,
                    name: r.name,
                    qty: o.qty,
                    note: a.note,
                    updatedAt: v(),
                  }
                : u,
            ),
          },
        };
  }
  function we(e, t) {
    return e.signups.some((n) => n.id === t)
      ? {
          ok: !0,
          board: { ...e, signups: e.signups.filter((n) => n.id !== t) },
        }
      : { ok: !1, error: "That signup is no longer on the list." };
  }
  function Ae(e, t) {
    if (e.customItems.length >= fe)
      return {
        ok: !1,
        error: "The extra-item list is full. Text Amy and she'll make room.",
      };
    let n = A(t.name, 60);
    if (!n)
      return {
        ok: !1,
        error: "Enter what you're bringing. Keep it under 60 characters.",
      };
    let r = A(t.unit, 30);
    if (!r)
      return { ok: !1, error: "Enter a unit, like bags, bottles, or packs." };
    let o = x(t.signerName, "your name");
    if ("error" in o) return { ok: !1, error: o.error };
    let a = q(t.qty);
    if ("error" in a) return { ok: !1, error: a.error };
    let u = S(t.note);
    if ("error" in u) return { ok: !1, error: u.error };
    if (t.category !== "food" && t.category !== "drink")
      return { ok: !1, error: "Pick food or drinks." };
    let l = v(),
      d = {
        id: crypto.randomUUID(),
        name: n,
        unit: r,
        category: t.category,
        createdAt: l,
      },
      g = {
        id: crypto.randomUUID(),
        itemId: d.id,
        name: o.name,
        qty: a.qty,
        note: u.note,
        createdAt: l,
        updatedAt: l,
      };
    return {
      ok: !0,
      board: {
        ...e,
        customItems: [...e.customItems, d],
        signups: [...e.signups, g],
      },
    };
  }
  function Ce(e, t) {
    if (!e.customItems.some((o) => o.id === t.id))
      return { ok: !1, error: "That item is no longer on the list." };
    let n = A(t.name, 60);
    if (!n) return { ok: !1, error: "Enter what the item is called." };
    let r = A(t.unit, 30);
    return r
      ? {
          ok: !0,
          board: {
            ...e,
            customItems: e.customItems.map((o) =>
              o.id === t.id ? { ...o, name: n, unit: r } : o,
            ),
          },
        }
      : { ok: !1, error: "Enter a unit, like bags, bottles, or packs." };
  }
  function xe(e, t) {
    return e.customItems.some((n) => n.id === t)
      ? {
          ok: !0,
          board: {
            ...e,
            customItems: e.customItems.filter((n) => n.id !== t),
            signups: e.signups.filter((n) => n.itemId !== t),
          },
        }
      : { ok: !1, error: "That item is no longer on the list." };
  }
  function Se(e, t) {
    if (e.donations.length >= ye)
      return {
        ok: !1,
        error: "The donation list is full. Text Amy and she'll make room.",
      };
    let n = Y(t.name, t.amount, t.note);
    if ("error" in n) return { ok: !1, error: n.error };
    let r = v(),
      o = {
        id: crypto.randomUUID(),
        name: n.name,
        amount: n.amount,
        note: n.note,
        createdAt: r,
        updatedAt: r,
      };
    return { ok: !0, board: { ...e, donations: [...e.donations, o] } };
  }
  function Ie(e, t) {
    if (!e.donations.some((r) => r.id === t.id))
      return { ok: !1, error: "That donation is no longer on the list." };
    let n = Y(t.name, t.amount, t.note);
    return "error" in n
      ? { ok: !1, error: n.error }
      : {
          ok: !0,
          board: {
            ...e,
            donations: e.donations.map((r) =>
              r.id === t.id
                ? {
                    ...r,
                    name: n.name,
                    amount: n.amount,
                    note: n.note,
                    updatedAt: v(),
                  }
                : r,
            ),
          },
        };
  }
  function Ee(e, t) {
    return e.donations.some((n) => n.id === t)
      ? {
          ok: !0,
          board: { ...e, donations: e.donations.filter((n) => n.id !== t) },
        }
      : { ok: !1, error: "That donation is no longer on the list." };
  }
  function Y(e, t, n) {
    let r = x(e, "your name");
    if ("error" in r) return r;
    let o = R(t);
    if (o == null)
      return { error: "Enter a dollar amount from $0.01 to $5,000." };
    let a = S(n);
    return "error" in a ? a : { name: r.name, amount: o, note: a.note };
  }
  function Ne(e) {
    let t = $(e);
    return t == null
      ? {
          error:
            "Enter the number of guests. Use a whole number from 1 to 999.",
        }
      : { guests: t };
  }
  function Me(e, t) {
    let n = e.attendees ?? [];
    if (n.length >= he)
      return {
        ok: !1,
        error: "The coming list is full. Text Amy and she'll make room.",
      };
    let r = K(t.name, t.guests, t.note);
    if ("error" in r) return { ok: !1, error: r.error };
    let o = v(),
      a = {
        id: crypto.randomUUID(),
        name: r.name,
        guests: r.guests,
        note: r.note,
        createdAt: o,
        updatedAt: o,
      };
    return { ok: !0, board: { ...e, attendees: [...n, a] } };
  }
  function Le(e, t) {
    let n = e.attendees ?? [];
    if (!n.some((o) => o.id === t.id))
      return { ok: !1, error: "That name is no longer on the list." };
    let r = K(t.name, t.guests, t.note);
    return "error" in r
      ? { ok: !1, error: r.error }
      : {
          ok: !0,
          board: {
            ...e,
            attendees: n.map((o) =>
              o.id === t.id
                ? {
                    ...o,
                    name: r.name,
                    guests: r.guests,
                    note: r.note,
                    updatedAt: v(),
                  }
                : o,
            ),
          },
        };
  }
  function Te(e, t) {
    let n = e.attendees ?? [];
    return n.some((r) => r.id === t)
      ? { ok: !0, board: { ...e, attendees: n.filter((r) => r.id !== t) } }
      : { ok: !1, error: "That name is no longer on the list." };
  }
  function K(e, t, n) {
    let r = x(e, "your name");
    if ("error" in r) return r;
    let o = Ne(t);
    if ("error" in o) return o;
    let a = S(n);
    return "error" in a ? a : { name: r.name, guests: o.guests, note: a.note };
  }
  var De = ["Amy", "Mike", "Katie", "Morgan", "Jackson", "Braden", "Tessa"];
  function _() {
    let e = Date.parse("2026-10-15T12:00:00.000Z");
    return De.map((t, n) => {
      let r = new Date(e + n * 1e3).toISOString();
      return {
        id: `seed-${t.toLowerCase()}`,
        name: t,
        guests: 1,
        note: "",
        createdAt: r,
        updatedAt: r,
      };
    });
  }
  function $e(e) {
    if (!e || typeof e != "object") return null;
    let t = e;
    return typeof t.id != "string" ||
      typeof t.itemId != "string" ||
      typeof t.name != "string" ||
      typeof t.qty != "number" ||
      typeof t.note != "string"
      ? null
      : t;
  }
  function qe(e) {
    if (!e || typeof e != "object") return null;
    let t = e;
    if (
      typeof t.id != "string" ||
      typeof t.name != "string" ||
      typeof t.unit != "string"
    )
      return null;
    let n =
      t.category === "food" || t.category === "drink" ? t.category : "drink";
    return { ...t, category: n };
  }
  function Be(e) {
    if (!e || typeof e != "object") return null;
    let t = e;
    return typeof t.id != "string" ||
      typeof t.name != "string" ||
      typeof t.amount != "number" ||
      typeof t.note != "string"
      ? null
      : {
          id: t.id,
          name: t.name,
          amount: t.amount,
          note: t.note,
          createdAt: typeof t.createdAt == "string" ? t.createdAt : "",
          updatedAt: typeof t.updatedAt == "string" ? t.updatedAt : "",
        };
  }
  function He(e) {
    if (!e || typeof e != "object") return null;
    let t = e;
    return typeof t.id != "string" ||
      typeof t.name != "string" ||
      typeof t.note != "string" ||
      typeof t.guests != "number" ||
      !Number.isInteger(t.guests) ||
      t.guests < 1
      ? null
      : t;
  }
  function B(e) {
    return !!e && typeof e == "object" && Array.isArray(e.attendees);
  }
  function G(e) {
    let t = e && typeof e == "object" ? e : {},
      n = B(e)
        ? (t.attendees ?? []).map(He).filter((r) => r !== null)
        : game.seedAttendees
          ? _()
          : [];
    return {
      revision:
        typeof t.revision == "number" && t.revision >= 0 ? t.revision : 0,
      signups: Array.isArray(t.signups)
        ? t.signups.map($e).filter((r) => r !== null)
        : [],
      customItems: Array.isArray(t.customItems)
        ? t.customItems.map(qe).filter((r) => r !== null)
        : [],
      donations: Array.isArray(t.donations)
        ? t.donations.map(Be).filter((r) => r !== null)
        : [],
      attendees: n,
    };
  }
  function C(e, t, n) {
    return `${e} ${t === n ? n : e === 1 ? t : n}`;
  }
  function Q(e, t, n, r) {
    let o = t === 1 ? n : r,
      a = e >= t;
    return `${e} of ${t} ${o} claimed${a ? " \u2014 all set" : ""}`;
  }
  function I(e) {
    let t = Math.round(e * 100) % 100 !== 0;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: t ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(e);
  }
  var E = {
    service: "Venmo",
    username: "Amy-Gleason-3",
    url: "https://venmo.com/u/Amy-Gleason-3",
  };
  var M = "fadcffb",
    ee = "vols-tailgate-name",
    te =
      game.id === "alabama"
        ? "vols-tailgate-mine"
        : "vols-tailgate-mine-" + game.id,
    ne = location.hostname === "json.extendsclass.com",
    Ue = ne ? `/bin/${M}` : `https://json.extendsclass.com/bin/${M}`,
    Pe = ne ? `/gui/bin/${M}` : `https://json.extendsclass.com/gui/bin/${M}`,
    s = {
      board: null,
      error: null,
      saving: !1,
      name: "",
      mine: [],
      editor: null,
      updated: null,
      listOpen: !1,
    },
    V = Promise.resolve();
  function re(e) {
    let t = V.then(e, e);
    return (
      (V = t.then(
        () => {},
        () => {},
      )),
      t
    );
  }
  function i(e, t, ...n) {
    let r = document.createElement(e);
    if (t)
      for (let [o, a] of Object.entries(t))
        o === "class" ? (r.className = a) : r.setAttribute(o, a);
    for (let o of n)
      o != null && r.append(o instanceof Node ? o : document.createTextNode(o));
    return r;
  }
  function y(e, t, n) {
    let r = i("button", { type: "button", class: t }, e);
    return (r.addEventListener("click", n), (r.disabled = s.saving), r);
  }
  function p(e, t, n) {
    return i(
      "label",
      { class: "field" },
      i("span", { class: "label" }, e),
      t,
      n ? i("span", { class: "hint" }, n) : null,
    );
  }
  function f(e, t) {
    let n = i("input", { class: "input", value: e });
    return (
      t.placeholder && (n.placeholder = t.placeholder),
      t.maxLength && (n.maxLength = Number(t.maxLength)),
      t.inputMode && (n.inputMode = t.inputMode),
      t.autocomplete && n.setAttribute("autocomplete", t.autocomplete),
      n
    );
  }
  function h(e) {
    return e
      ? i("p", { class: "form-error", role: "alert" }, e)
      : i("span", null);
  }
  function Fe() {
    try {
      let e = localStorage.getItem(te),
        t = e ? JSON.parse(e) : [];
      return Array.isArray(t) ? t.filter((n) => typeof n == "string") : [];
    } catch {
      return [];
    }
  }
  function J(e, t) {
    try {
      localStorage.setItem(e, t);
    } catch {}
  }
  async function oe(e) {
    if (game.telegraphPath === "G10T-tailgate-data-10-15" && game.id !== "alabama") {
      throw new Error("Refusing to write the Alabama list.");
    }
    if (game.id === "alabama" && game.telegraphPath !== "G10T-tailgate-data-10-15") {
      throw new Error("Alabama is wired to the wrong list.");
    }
    let n = new URLSearchParams({
        access_token:
          "efb35591d90ebe09b367cbaba05104b105b3a9e8ea4c7f6b1715032f73e5",
        title: game.telegraphTitle,
        content: JSON.stringify([
          { tag: "pre", children: [JSON.stringify(e)] },
        ]),
        return_content: "true",
      }),
      t = await fetch(
        "https://api.telegra.ph/editPage/" + game.telegraphPath,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: n.toString(),
        },
      );
    if (!t.ok) throw new Error("Could not save. Try again.");
    let r = await t.json();
    if (!r.ok) throw new Error("Could not save. Try again.");
  }
  async function ie(e) {
    let t = await fetch(
      `https://api.telegra.ph/getPage/${game.telegraphPath}?return_content=true&t=${Date.now()}`,
    );
    if (!t.ok)
      throw new Error(
        "Couldn't reach the signup list. Check your signal and try again.",
      );
    let n = await t.json();
    if (!n.ok || !n.result)
      throw new Error(
        "Couldn't reach the signup list. Check your signal and try again.",
      );
    let o =
        n.result.content &&
        n.result.content[0] &&
        n.result.content[0].children &&
        n.result.content[0].children[0],
      a = typeof o == "string" ? JSON.parse(o) : null;
    if (!a || typeof a != "object" || !Array.isArray(a.signups))
      throw new Error(
        "Couldn't reach the signup list. Check your signal and try again.",
      );
    return G(a);
  }
  function je(e, t, n) {
    let r = new Set([
        ...e.signups.map((a) => a.id),
        ...e.donations.map((a) => a.id),
        ...e.attendees.map((a) => a.id),
      ]),
      o = [
        ...t.signups.map((a) => a.id),
        ...t.donations.map((a) => a.id),
        ...t.attendees.map((a) => a.id),
      ].filter((a) => !r.has(a));
    (J(ee, n),
      (s.name = n),
      o.length !== 0 &&
        ((s.mine = [...new Set([...s.mine, ...o])]),
        J(te, JSON.stringify(s.mine))));
  }
  async function b(e, t) {
    ((s.saving = !0), m());
    try {
      let n = await re(async () => {
        let r = await ie(!1),
          o = O(r, e);
        if (!o.ok) throw new Error(o.error);
        let a = { ...o.board, revision: r.revision + 1 };
        return (await oe(a), { current: r, saved: a });
      });
      return (
        t && je(n.current, n.saved, t),
        (s.board = n.saved),
        (s.updated = new Date()),
        (s.error = null),
        (s.editor = null),
        null
      );
    } catch (n) {
      return n instanceof Error ? n.message : "Could not save. Try again.";
    } finally {
      ((s.saving = !1), m());
    }
  }
  function se(e) {
    return (s.board?.signups ?? [])
      .filter((t) => t.itemId === e)
      .sort((t, n) => t.createdAt.localeCompare(n.createdAt));
  }
  function H() {
    let e = [...(s.board?.customItems ?? [])].sort((t, n) =>
      t.createdAt.localeCompare(n.createdAt),
    );
    return [
      ...D.map((t) => ({ ...t, custom: !1 })),
      ...e.map((t) => ({
        id: t.id,
        name: t.name,
        singular: t.unit,
        plural: t.unit,
        target: null,
        hint: "Added by the group",
        countHint: "Use the same unit everyone else is using for this item.",
        section: t.category === "food" ? "food" : "drink",
        custom: !0,
      })),
    ];
  }
  function X(e) {
    return H()
      .filter((t) => t.section === e)
      .flatMap((t) => {
        let n = se(t.id).reduce((o, a) => o + a.qty, 0);
        if (t.target == null) return n === 0 ? [`${t.name}: a signup`] : [];
        let r = t.target - n;
        return r > 0 ? [`${t.name}: ${C(r, t.singular, t.plural)}`] : [];
      });
  }
  function U(e, t) {
    return i(
      "div",
      { class: "row-actions" },
      y("Edit", "btn ghost small", e),
      y("Remove", "btn ghost small", t),
    );
  }
  function L(e, t) {
    return i(
      "div",
      { class: "confirm" },
      i("p", { class: "confirm-title" }, e),
      y(s.saving ? "Saving\u2026" : "Yes, remove", "btn", () => {
        t();
      }),
      y("Cancel", "btn ghost", () => {
        ((s.editor = null), m());
      }),
    );
  }
  function ae(e) {
    let t = f(e.name, {
        placeholder: "Amy",
        maxLength: "40",
        autocomplete: "name",
      }),
      n = f(e.qty, { inputMode: "numeric" }),
      r = f(e.note, {
        placeholder: "Pineapple, or I'll drop it off Friday",
        maxLength: "160",
      }),
      o = i("div", null),
      a = i(
        "form",
        { class: "stack" },
        p("Your name", t),
        p(`How many ${e.unit}?`, n, e.countHint),
        p("Note (optional)", r),
        o,
        i(
          "button",
          { type: "submit", class: "btn" },
          s.saving ? "Saving\u2026" : e.submitLabel,
        ),
        e.onCancel ? y("Cancel", "btn ghost", e.onCancel) : null,
      );
    return (
      a.addEventListener("submit", async (u) => {
        u.preventDefault();
        let l = Number(n.value);
        if (!t.value.trim()) {
          o.replaceChildren(h("Enter your name."));
          return;
        }
        if (!Number.isInteger(l) || l < 1 || l > 999) {
          o.replaceChildren(
            h(
              "Enter how many you're bringing. Use a whole number from 1 to 999.",
            ),
          );
          return;
        }
        let d = await e.onSubmit({
          name: t.value.trim(),
          qty: l,
          note: r.value.trim(),
        });
        (o.replaceChildren(h(d)),
          !d && !e.onCancel && ((n.value = "1"), (r.value = "")));
      }),
      a
    );
  }
  function Re(e) {
    if (s.editor?.kind === "edit-attendee" && s.editor.id === e.id)
      return ue({
        name: e.name,
        guests: String(e.guests),
        note: e.note,
        submitLabel: "Save changes",
        onCancel: () => {
          ((s.editor = null), m());
        },
        onSubmit: (n) => b({ type: "update-attendee", id: e.id, ...n }, n.name),
      });
    if (s.editor?.kind === "remove-attendee" && s.editor.id === e.id)
      return L(`Remove ${e.name}?`, async () => {
        let n = await b({ type: "delete-attendee", id: e.id });
        n && alert(n);
      });
    let t = e.guests === 1 ? "1 guest" : `${e.guests} guests`;
    return i(
      "div",
      null,
      i("p", { class: "row-title" }, e.name),
      i("p", { class: "row-meta" }, t),
      e.note ? i("p", { class: "row-meta" }, e.note) : null,
      U(
        () => {
          ((s.editor = { kind: "edit-attendee", id: e.id }), m());
        },
        () => {
          ((s.editor = { kind: "remove-attendee", id: e.id }), m());
        },
      ),
    );
  }
  function ue(e) {
    let t = f(e.name, {
        placeholder: "Amy",
        maxLength: "40",
        autocomplete: "name",
      }),
      n = f(e.guests, { inputMode: "numeric" }),
      r = f(e.note, { maxLength: "160", placeholder: "Other names" }),
      o = i("div", null),
      a = i(
        "form",
        { class: "stack" },
        p("Your name", t),
        p(
          "How many guests?",
          n,
          "Include yourself. Enter 1 if it is just you. Use the note for other names.",
        ),
        p("Note (optional)", r),
        o,
        i(
          "button",
          { type: "submit", class: "btn" },
          s.saving ? "Saving\u2026" : e.submitLabel,
        ),
        e.onCancel ? y("Cancel", "btn ghost", e.onCancel) : null,
      );
    return (
      a.addEventListener("submit", async (u) => {
        u.preventDefault();
        let l = Number(n.value);
        if (!t.value.trim()) {
          o.replaceChildren(h("Enter your name."));
          return;
        }
        if (!Number.isInteger(l) || l < 1 || l > 999) {
          o.replaceChildren(
            h("Enter the number of guests. Use a whole number from 1 to 999."),
          );
          return;
        }
        let d = await e.onSubmit({
          name: t.value.trim(),
          guests: l,
          note: r.value.trim(),
        });
        (o.replaceChildren(h(d)),
          !d && !e.onCancel && ((n.value = "1"), (r.value = "")));
      }),
      a
    );
  }
  function Oe(e, t, n) {
    return s.editor?.kind === "edit-signup" && s.editor.id === e.id
      ? ae({
          name: e.name,
          qty: String(e.qty),
          note: e.note,
          unit: n,
          countHint: "Use a whole number from 1 to 999.",
          submitLabel: "Save changes",
          onCancel: () => {
            ((s.editor = null), m());
          },
          onSubmit: (r) => b({ type: "update-signup", id: e.id, ...r }, r.name),
        })
      : s.editor?.kind === "remove-signup" && s.editor.id === e.id
        ? L(`Remove ${e.name}, ${C(e.qty, t, n)}?`, async () => {
            let r = await b({ type: "delete-signup", id: e.id });
            r && alert(r);
          })
        : i(
            "div",
            { class: "signup" },
            i("p", { class: "row-title" }, `${e.name} \xB7 ${C(e.qty, t, n)}`),
            e.note ? i("p", { class: "row-meta" }, e.note) : null,
            U(
              () => {
                ((s.editor = { kind: "edit-signup", id: e.id }), m());
              },
              () => {
                ((s.editor = { kind: "remove-signup", id: e.id }), m());
              },
            ),
          );
  }
  function W(e) {
    let t = se(e.id),
      n = t.reduce((o, a) => o + a.qty, 0),
      r = [
        i(
          "div",
          { class: "item-head" },
          i("h3", null, e.name),
          e.custom
            ? y("Rename", "btn ghost small", () => {
                ((s.editor = { kind: "rename-item", id: e.id }), m());
              })
            : null,
        ),
      ];
    if (
      (e.hint && r.push(i("p", { class: "hint" }, e.hint)),
      e.target != null &&
        n < e.target &&
        r.push(
          i(
            "p",
            { class: "need" },
            `Still needed: ${C(e.target - n, e.singular, e.plural)}`,
          ),
        ),
      e.target != null)
    ) {
      let o = Math.min(100, Math.round((n / e.target) * 100)),
        a = i("div", { class: "bar" });
      (a.append(i("div", { class: "bar-fill", style: `width:${o}%` })),
        r.push(
          a,
          i("p", { class: "progress" }, Q(n, e.target, e.singular, e.plural)),
        ));
    } else
      r.push(
        i(
          "p",
          { class: "progress" },
          n === 0
            ? "Still needed: a signup."
            : `${C(n, e.singular, e.plural)} signed up`,
        ),
      );
    if (
      (e.target != null &&
        n >= e.target &&
        r.push(
          i(
            "p",
            { class: "hint" },
            "This is all set. You can still bring more.",
          ),
        ),
      s.editor?.kind === "rename-item" && s.editor.id === e.id)
    ) {
      let o = f(e.name, { maxLength: "40" }),
        a = f(e.singular, { maxLength: "24" }),
        u = i("div", null),
        l = i(
          "form",
          { class: "stack" },
          p("Item name", o),
          p("Unit", a, "This word shows on every signup for this item."),
          u,
          i("button", { type: "submit", class: "btn" }, "Save name"),
          y("Cancel", "btn ghost", () => {
            ((s.editor = null), m());
          }),
        );
      (l.addEventListener("submit", async (d) => {
        d.preventDefault();
        let g = await b({
          type: "rename-custom",
          id: e.id,
          name: o.value,
          unit: a.value,
        });
        u.replaceChildren(h(g));
      }),
        r.push(l));
    } else
      s.editor?.kind === "remove-item" && s.editor.id === e.id
        ? r.push(
            L(`Remove ${e.name} and every signup for it?`, async () => {
              let o = await b({ type: "delete-custom", id: e.id });
              o && alert(o);
            }),
          )
        : s.editor?.kind === "add-signup" && s.editor.id === e.id
          ? r.push(
              ae({
                name: s.name,
                qty: "1",
                note: "",
                unit: e.plural,
                countHint: e.countHint,
                submitLabel: "Sign me up",
                onCancel: () => {
                  ((s.editor = null), m());
                },
                onSubmit: (o) =>
                  b({ type: "add-signup", itemId: e.id, ...o }, o.name),
              }),
            )
          : (r.push(
              ...t.map((o) => Oe(o, e.singular, e.plural)),
              y("I'll bring this", "btn", () => {
                ((s.editor = { kind: "add-signup", id: e.id }), m());
              }),
            ),
            e.custom &&
              r.push(
                y("Remove this item", "btn ghost", () => {
                  ((s.editor = { kind: "remove-item", id: e.id }), m());
                }),
              ));
    return i("article", { class: "card", id: `item-${e.id}` }, ...r);
  }
  function Ye(e) {
    let t = f("", {
        placeholder: "Chips, a speaker, napkins",
        maxLength: "40",
      }),
      n = f("", { placeholder: "bags", maxLength: "24" }),
      r = f(s.name, {
        placeholder: "Amy",
        maxLength: "40",
        autocomplete: "name",
      }),
      o = f("1", { inputMode: "numeric" }),
      a = f("", { maxLength: "160" }),
      u = i("div", null),
      l = i(
        "form",
        { class: "stack" },
        p("What are you bringing?", t),
        p("Unit", n, "Use a plural word, like bags or bottles."),
        p("Your name", r),
        p("How many?", o),
        p("Note (optional)", a),
        u,
        i(
          "button",
          { type: "submit", class: "btn" },
          s.saving ? "Saving\u2026" : "Add it",
        ),
        y("Cancel", "btn ghost", () => {
          ((s.editor = null), m());
        }),
      );
    return (
      l.addEventListener("submit", async (d) => {
        d.preventDefault();
        let g = Number(o.value);
        if (!Number.isInteger(g) || g < 1 || g > 999) {
          u.replaceChildren(
            h(
              "Enter how many you're bringing. Use a whole number from 1 to 999.",
            ),
          );
          return;
        }
        let w = await b(
          {
            type: "add-custom",
            category: e,
            name: t.value,
            unit: n.value,
            signerName: r.value,
            qty: g,
            note: a.value,
          },
          r.value.trim(),
        );
        u.replaceChildren(h(w));
      }),
      l
    );
  }
  function Ke(e) {
    return s.editor?.kind === "edit-donation" && s.editor.id === e.id
      ? le({
          name: e.name,
          amount: String(e.amount),
          note: e.note,
          submitLabel: "Save changes",
          onCancel: () => {
            ((s.editor = null), m());
          },
          onSubmit: (t) =>
            b({ type: "update-donation", id: e.id, ...t }, t.name),
        })
      : s.editor?.kind === "remove-donation" && s.editor.id === e.id
        ? L(`Remove ${e.name}'s ${I(e.amount)} pledge?`, async () => {
            let t = await b({ type: "delete-donation", id: e.id });
            t && alert(t);
          })
        : i(
            "div",
            null,
            i("p", { class: "row-title" }, `${e.name} \xB7 ${I(e.amount)}`),
            e.note ? i("p", { class: "row-meta" }, e.note) : null,
            U(
              () => {
                ((s.editor = { kind: "edit-donation", id: e.id }), m());
              },
              () => {
                ((s.editor = { kind: "remove-donation", id: e.id }), m());
              },
            ),
          );
  }
  function le(e) {
    let t = f(e.name, {
        placeholder: "Amy",
        maxLength: "40",
        autocomplete: "name",
      }),
      n = f(e.amount, { placeholder: "20", inputMode: "decimal" }),
      r = f(e.note, { maxLength: "160" }),
      o = i("p", { class: "hint" }),
      a = i("div", null),
      u = () => {
        let d = Number(n.value);
        o.textContent =
          Number.isFinite(d) && d >= 0.01 && d <= 5e3
            ? `You'll be recorded for ${I(Math.round(d * 100) / 100)}.`
            : "";
      };
    (n.addEventListener("input", u), u());
    let l = i(
      "form",
      { class: "stack" },
      p("Your name", t),
      p("Amount in dollars", n),
      o,
      p("Note (optional)", r),
      a,
      i(
        "button",
        { type: "submit", class: "btn" },
        s.saving ? "Saving\u2026" : e.submitLabel,
      ),
      e.onCancel ? y("Cancel", "btn ghost", e.onCancel) : null,
    );
    return (
      l.addEventListener("submit", async (d) => {
        d.preventDefault();
        let g = Math.round(Number(n.value) * 100) / 100;
        if (!t.value.trim()) {
          a.replaceChildren(h("Enter your name so Amy knows who pledged."));
          return;
        }
        if (!Number.isFinite(g) || g < 0.01 || g > 5e3) {
          a.replaceChildren(h("Enter a dollar amount, like 20 or 15.50."));
          return;
        }
        let w = await e.onSubmit({
          name: t.value.trim(),
          amount: g,
          note: r.value.trim(),
        });
        (a.replaceChildren(h(w)),
          !w &&
            !e.onCancel &&
            ((n.value = ""), (r.value = ""), (o.textContent = "")));
      }),
      l
    );
  }
  function z(e) {
    return e.length === 0
      ? i("p", { class: "lead" }, "Nothing else is still needed.")
      : i(
          "div",
          null,
          i("p", { class: "need" }, "Still needed"),
          i("ul", { class: "needs" }, ...e.map((t) => i("li", null, t))),
        );
  }
  function foodIntro(text) {
    if (typeof text != "string" || text.indexOf("\n") === -1) {
      return i("p", { class: "lead" }, text);
    }
    var lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return i(
      "div",
      null,
      i("p", { class: "lead" }, lines[0]),
      i(
        "ul",
        { class: "needs" },
        ...lines.slice(1).map((line) => i("li", null, line)),
      ),
    );
  }
  function m() {
    let e = s.board,
      t = document.querySelector("#status"),
      n = document.querySelector("#alert"),
      r = document.querySelector("#coming"),
      o = document.querySelector("#food-body"),
      a = document.querySelector("#drinks-body"),
      u = document.querySelector("#donations-body");
    if (!t || !n || !r || !o || !a || !u) return;
    let l = s.updated
      ? ` \xB7 updated ${s.updated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
      : "";
    if (
      ((t.textContent = `Shared list${l}. It refreshes every few seconds.`),
      n.replaceChildren(),
      s.error &&
        n.append(
          i(
            "div",
            { class: "alert", role: "alert" },
            i("p", null, s.error),
            y("Try again", "btn", () => {
              N();
            }),
          ),
        ),
      !e)
    ) {
      (r.replaceChildren(
        i(
          "p",
          { class: "lead" },
          s.error ? "" : "Loading the signup list\u2026",
        ),
      ),
        o.replaceChildren(),
        a.replaceChildren(),
        u.replaceChildren());
      return;
    }
    let d = [...e.attendees].sort((c, k) =>
        c.createdAt.localeCompare(k.createdAt),
      ),
      g = d.reduce((c, k) => c + k.guests, 0),
      w =
        s.editor?.kind === "edit-attendee" ||
        s.editor?.kind === "remove-attendee";
    r.replaceChildren(
      (() => {
        let open = !!s.listOpen || w,
          totalBtn = i(
            "button",
            {
              type: "button",
              class: "total total-toggle",
              "aria-expanded": open ? "true" : "false",
              "aria-controls": "coming-list",
            },
            "Total coming: ",
            i("span", { class: "total-n" }, String(g)),
          ),
          btn = i(
            "button",
            {
              type: "button",
              class: "btn ghost",
              "aria-expanded": open ? "true" : "false",
            },
            open ? "Hide list" : "See list",
          );
        return (
          totalBtn.addEventListener("click", () => {
            ((s.listOpen = !open), m());
          }),
          (totalBtn.disabled = s.saving),
          btn.addEventListener("click", () => {
            ((s.listOpen = !open), m());
          }),
          (btn.disabled = s.saving),
          i(
            "div",
            null,
            totalBtn,
            btn,
            open
              ? d.length === 0
                ? i("p", { id: "coming-list", class: "hint" }, "Nobody has added their name yet.")
                : i(
                    "ul",
                    { class: "rows", id: "coming-list" },
                    ...d.map((c) => i("li", null, Re(c))),
                  )
              : null,
          )
        );
      })(),
      w
        ? i("span", null)
        : i(
            "div",
            { class: "stack" },
            i("h3", null, "RSVP so we know you're coming!"),
            ue({
              name: s.name,
              guests: "1",
              note: "",
              submitLabel: "Add me",
              onSubmit: (c) => b({ type: "add-attendee", ...c }, c.name),
            }),
          ),
    );
    let de = H().filter((c) => c.section === "food"),
      ce = H().filter((c) => c.section === "drink");
    (o.replaceChildren(
      foodIntro(P),
      ...de.map(W),
      Z(
        "food",
        "Add other food",
        "Bringing other food? Add it in your own words.",
      ),
    ),
      a.replaceChildren(
        z(X("drink")),
        i(
          "p",
          { class: "hint" },
          "Tap Edit or Remove on a row to change it. Please only change your own.",
        ),
        ...ce.map(W),
        Z(
          "drink",
          "Add a drink",
          "Bringing another drink? Add it in your own words.",
        ),
      ));
    let T = [...e.donations].sort((c, k) =>
        c.createdAt.localeCompare(k.createdAt),
      ),
      me = T.reduce((c, k) => c + k.amount, 0),
      ge =
        s.editor?.kind === "edit-donation" ||
        s.editor?.kind === "remove-donation";
    u.replaceChildren(
      i(
        "p",
        { class: "lead" },
        "Can't bring something? Chip in and we'll cover what's still needed.",
      ),
      E.url
        ? i(
            "div",
            null,
            i("a", { class: "btn link", href: E.url }, `Pay with ${E.service}`),
            i("p", { class: "center name" }, E.username),
            i(
              "p",
              { class: "hint" },
              "Your phone opens Venmo. Use the back button to come back, then record the amount below so everyone can see it.",
            ),
          )
        : i("span", null),
      i("p", { class: "kicker" }, "Pledged so far"),
      i("p", { class: "big" }, I(me)),
      T.length === 0
        ? i("p", { class: "hint" }, "No donations yet.")
        : i("ul", { class: "rows" }, ...T.map((c) => i("li", null, Ke(c)))),
      ge
        ? i("span", null)
        : i(
            "div",
            null,
            i("h3", null, "Record a donation"),
            le({
              name: s.name,
              amount: "",
              note: "",
              submitLabel: "Add donation",
              onSubmit: (c) => b({ type: "add-donation", ...c }, c.name),
            }),
          ),
    );
  }
  function Z(e, t, n) {
    let r = s.editor?.kind === "add-custom" && s.editor.category === e;
    return i(
      "div",
      { class: "card" },
      i("h3", null, t),
      i("p", { class: "hint" }, n),
      r
        ? Ye(e)
        : y(t, "btn", () => {
            ((s.editor = { kind: "add-custom", category: e }), m());
          }),
    );
  }
  async function N() {
    try {
      let n = await re(() => ie(!0));
      ((!s.board || n.revision >= s.board.revision) && (s.board = n),
        (s.updated = new Date()),
        (s.error = null));
    } catch (n) {
      s.error =
        n instanceof Error
          ? n.message
          : "Couldn't reach the signup list. Check your signal and try again.";
    }
    let e = document.activeElement,
      t = e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement;
    s.editor == null && !s.saving && !t && m();
  }

  function bootGame() {
    var games = window.TAILGATE_GAMES;
    var id = document.body && document.body.dataset.game;
    var found = games && id ? games[id] : null;
    if (!found) {
      document.body.append(
        document.createTextNode("This tailgate page is missing its game setup."),
      );
      return null;
    }
    if (found.id !== id) {
      document.body.append(
        document.createTextNode("This tailgate game is misconfigured."),
      );
      return null;
    }
    if (id === "alabama" && found.telegraphPath !== "G10T-tailgate-data-10-15") {
      document.body.append(
        document.createTextNode("Alabama is wired to the wrong list."),
      );
      return null;
    }
    if (id !== "alabama" && found.telegraphPath === "G10T-tailgate-data-10-15") {
      document.body.append(
        document.createTextNode("This game is pointed at the Alabama list."),
      );
      return null;
    }
    return found;
  }
  function locationNodes() {
    var asset = document.body.dataset.assetRoot || "";
    var loc = game.location;
    var title = i("p", { class: "lead loc-title" }, loc.title);
    if (loc.status === "confirm") {
      title.append(document.createTextNode(" "));
      title.append(i("span", { class: "spot-confirm" }, "confirm"));
    }
    var nodes = [title].concat(
      loc.lines.map((line) => i("p", { class: "lead" }, line)),
      [
        i(
          "a",
          { class: "btn maps", href: loc.mapsUrl, target: "_blank", rel: "noopener" },
          "Open in Maps",
        ),
      ],
      loc.notes.map((line) => i("p", { class: "lead" }, line)),
      [i("p", { class: "hint" }, loc.mapHint)],
    );
    var list = i("div", { class: "map-list" });
    loc.maps.forEach((map) => {
      var src = asset + map.src;
      var shot = i("button", {
        type: "button",
        class: "map-shot",
        "data-src": src,
        "data-alt": map.alt,
      });
      shot.append(
        i("img", { src: src, alt: map.alt, width: String(map.width), height: String(map.height) }),
        i("span", { class: "map-cap" }, map.caption),
      );
      list.append(shot);
    });
    nodes.push(list);
    return nodes;
  }
  function accSection(id, label, open, panelChildren) {
    var panel = i("div", { id: id, class: "acc-panel" });
    if (!open) panel.hidden = true;
    panelChildren.forEach((child) => panel.append(child));
    var toggle = i(
      "button",
      {
        type: "button",
        class: "acc-toggle",
        "aria-expanded": open ? "true" : "false",
        "aria-controls": id,
      },
      i("span", { class: "acc-label" }, label),
      i("span", { class: "acc-mark", "aria-hidden": "true" }, open ? "\u2212" : "+"),
    );
    var section = i("section", {
      class: open ? "acc open" : "acc",
      "data-section": id,
      id: "acc-" + id,
    });
    section.append(
      i("h2", { class: "acc-h" }, toggle),
      panel,
      i(
        "div",
        { class: "acc-foot" },
        i("button", { type: "button", class: "acc-link", "data-acc-close": "" }, "Close"),
        i("button", { type: "button", class: "acc-link", "data-acc-next": "" }, "Next section"),
      ),
    );
    return section;
  }
  function renderPage() {
    document.title = game.pageTitle;
    var meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.append(meta);
    }
    meta.setAttribute("content", game.description);
    var header = i("header");
    if (game.past && game.currentGame) {
      header.append(
        i(
          "div",
          { class: "past-banner" },
          "Past game",
          i("a", { href: game.currentGame.href }, game.currentGame.label),
        ),
      );
    }
    var brand = i("div", { style: "padding:16px 16px 20px" });
    brand.insertAdjacentHTML(
      "beforeend",
      '<svg viewBox="0 0 168 148" width="92" height="80" aria-hidden="true"><path fill="#FF8200" d="M8 6h152v40H104v94H64V46H8V6z"/></svg>',
    );
    brand.append(
      i("p", { class: "banner" }, game.banner),
      i("div", { class: "stripe", "aria-hidden": "true" }),
    );
    header.append(
      i("div", { class: "checkerboard", "aria-hidden": "true" }),
      brand,
      i("div", { class: "checkerboard", "aria-hidden": "true" }),
    );
    var main = i("main");
    main.append(i("p", { class: "date" }, game.date));
    if (game.kickoff) main.append(i("p", { class: "kickoff" }, "Kickoff: " + game.kickoff));
    main.append(i("h1", null, game.heading));
    if (game.locationPlacement === "top") {
      var top = i("div", { class: "location-top", id: "location" });
      top.append(i("p", { class: "kicker" }, "Location"));
      locationNodes().forEach((node) => top.append(node));
      main.append(top);
    }
    game.leads.forEach((lead) => main.append(i("p", { class: "lead" }, lead)));
    if (game.pastTailgates) {
      main.append(
        i(
          "p",
          { class: "site-link" },
          i("a", { href: game.pastTailgates.href }, game.pastTailgates.label),
        ),
      );
    }
    main.append(
      i("p", { class: "status", id: "status" }, "Shared list. It refreshes every few seconds."),
      i("div", { id: "alert" }),
    );
    var accordion = i("div", { class: "accordion", id: "sections" });
    var specs = [
      ["coming", "Who's coming", true, []],
      ["food", "Food list", false, [i("div", { id: "food-body" })]],
      ["drinks", "Drink list", false, [i("div", { id: "drinks-body" })]],
      ["donations", "Donations (optional)", false, [i("div", { id: "donations-body" })]],
    ];
    if (game.locationPlacement === "accordion") {
      specs.push(["location", "Directions", false, locationNodes()]);
    }
    specs.forEach((spec) => {
      accordion.append(accSection(spec[0], spec[1], spec[2], spec[3]));
    });
    var viewer = i("div", { id: "map-viewer", class: "map-viewer" });
    viewer.hidden = true;
    viewer.append(
      i("button", { type: "button", class: "btn map-close", id: "map-close" }, "Close"),
      i("img", { id: "map-full", alt: "" }),
    );
    main.append(accordion, viewer);
    document.body.prepend(header, main);
  }
  function initChrome() {
    var order = Array.prototype.map.call(
      document.querySelectorAll(".acc"),
      (acc) => acc.getAttribute("data-section"),
    );
    var viewer = document.getElementById("map-viewer");
    var full = document.getElementById("map-full");
    function closeMap() {
      if (!viewer) return;
      viewer.hidden = true;
      if (full) full.removeAttribute("src");
      document.body.style.overflow = "";
    }
    function openSection(id, scroll) {
      if (id !== "location") closeMap();
      document.querySelectorAll(".acc").forEach(function (acc) {
        var open = !!id && acc.getAttribute("data-section") === id;
        acc.classList.toggle("open", open);
        var button = acc.querySelector(".acc-toggle");
        var mark = acc.querySelector(".acc-mark");
        var panel = acc.querySelector(".acc-panel");
        if (button) button.setAttribute("aria-expanded", open ? "true" : "false");
        if (mark) mark.textContent = open ? "\u2212" : "+";
        if (panel) panel.hidden = !open;
      });
      if (scroll && id) {
        var target = document.getElementById("acc-" + id);
        if (target) target.scrollIntoView({ block: "start", behavior: "auto" });
      }
    }
    document.querySelectorAll(".acc-toggle").forEach(function (button) {
      button.addEventListener("click", function () {
        var acc = button.closest(".acc");
        var id = acc.getAttribute("data-section");
        var expanded = button.getAttribute("aria-expanded") === "true";
        openSection(expanded ? null : id, false);
      });
    });
    document.querySelectorAll("[data-acc-close]").forEach(function (link) {
      link.addEventListener("click", function () {
        var acc = link.closest(".acc");
        var id = acc.getAttribute("data-section");
        var next = order[order.indexOf(id) + 1];
        openSection(null, false);
        var target = document.getElementById(next ? "acc-" + next : "acc-" + id);
        if (target) target.scrollIntoView({ block: "start", behavior: "auto" });
      });
    });
    document.querySelectorAll("[data-acc-next]").forEach(function (link) {
      link.addEventListener("click", function () {
        var id = link.closest(".acc").getAttribute("data-section");
        var next = order[order.indexOf(id) + 1] || order[0];
        openSection(next, true);
      });
    });
    document.querySelectorAll(".map-shot").forEach(function (shot) {
      shot.addEventListener("click", function () {
        if (!viewer || !full) return;
        full.src = shot.getAttribute("data-src");
        full.alt = shot.getAttribute("data-alt") || "";
        viewer.hidden = false;
        viewer.scrollTop = 0;
        document.body.style.overflow = "hidden";
      });
    });
    var closer = document.getElementById("map-close");
    if (closer) closer.addEventListener("click", closeMap);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeMap();
    });
    var start = (location.hash || "").replace("#", "");
    if (order.indexOf(start) !== -1 && start !== "coming") openSection(start, false);
  }

  function _e() {
    ((s.name = localStorage.getItem(ee) ?? ""),
      (s.mine = Fe()),
      m(),
      N(),
      window.setInterval(() => {
        document.visibilityState === "visible" &&
          s.editor == null &&
          !s.saving &&
          N();
      }, 3e3),
      document.addEventListener("visibilitychange", () => {
        document.visibilityState === "visible" && N();
      }));
  }
  renderPage();
  initChrome();
  _e();
})();
