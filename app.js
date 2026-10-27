"use strict";
/* Phennova portfolio. Static site; edits are committed to GitHub from the browser.
   Auth: a fine-grained GitHub token (this repo only) is stored AES-GCM-encrypted in data/auth.json, key derived from
   your password with PBKDF2. Without the password nobody can save changes. */
const $ = (s, r = document) => r.querySelector(s);
const app0 = $("#app"), dlg = $("#dlg"), bar = $("#editbar");
const app = new Proxy(app0, { get(t, k) { if (k === "append") return (...a) => t.append(...a.filter((x) => x != null)); if (k === "replaceChildren") return (...a) => t.replaceChildren(...a); const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } });
const enc = new TextEncoder(), dec = new TextDecoder();
const B = {
  to: (u8) => { let s = ""; u8.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); },
  from: (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
};
const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);

let site = null, auth = null, token = null, editing = false;
const repoInfo = (() => {
  const host = location.hostname, parts = location.pathname.split("/").filter(Boolean);
  const owner = host.endsWith(".github.io") ? host.split(".")[0] : "Phennova";
  const repo = host.endsWith(".github.io") && parts[0] && !parts[0].includes(".") ? parts[0] : "portfolio";
  return { owner: owner[0].toUpperCase() + owner.slice(1), repo, branch: "main" };
})();
const previews = {}; // path -> dataURL for freshly uploaded images (Pages needs ~1 min to publish)

/* ---------- crypto ---------- */
async function deriveKey(pw, salt) {
  const km = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, km,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptToken(pw, tok) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveKey(pw, salt), enc.encode(tok));
  return { v: 1, salt: B.to(salt), iv: B.to(iv), ct: B.to(new Uint8Array(ct)) };
}
async function decryptToken(pw, a) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: B.from(a.iv) }, await deriveKey(pw, B.from(a.salt)), B.from(a.ct));
  return dec.decode(pt);
}

/* ---------- GitHub API ---------- */
const api = (path, opt = {}) => fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/${path}`, {
  ...opt, headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(opt.headers || {}) },
});
async function putFile(path, b64, message) {
  const g = await api(`contents/${path}?ref=${repoInfo.branch}`);
  const sha = g.ok ? (await g.json()).sha : undefined;
  const r = await api(`contents/${path}`, { method: "PUT", body: JSON.stringify({ message, content: b64, branch: repoInfo.branch, sha }) });
  if (!r.ok) throw new Error(`GitHub said ${r.status}: ${(await r.json().catch(() => ({}))).message || ""}`);
}
const toB64 = (str) => B.to(enc.encode(str));
async function saveSite(msg) {
  setStatus("Saving…");
  try { await putFile("data/site.json", toB64(JSON.stringify(site, null, 2) + "\n"), msg); setStatus("Saved. Live in about a minute."); }
  catch (e) { setStatus("Save failed: " + e.message); alert("Save failed: " + e.message); }
}
function setStatus(t) { $("#status").textContent = t; }

/* ---------- data ---------- */
async function load() {
  let r = null;
  if (token) { // fresh copy straight from the API while editing
    const g = await api(`contents/data/site.json?ref=${repoInfo.branch}`);
    if (g.ok) { site = JSON.parse(dec.decode(B.from((await g.json()).content.replace(/\n/g, "")))); return; }
  }
  r = await fetch("data/site.json?" + Date.now());
  site = await r.json();
}
async function loadAuth() {
  try { const r = await fetch("data/auth.json?" + Date.now()); auth = r.ok ? await r.json() : null; } catch { auth = null; }
}

/* ---------- helpers ---------- */
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((k) => k != null && e.append(k.nodeType ? k : document.createTextNode(k)));
  return e;
}
const imgSrc = (p) => previews[p] || p;
const fmt = (d) => { try { return new Date(d + "T00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return d; } };
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "");

/* ---------- views ---------- */
function render() {
  const route = location.hash.replace(/^#\/?/, "");
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === (route.startsWith("timeline") ? "timeline" : route.startsWith("p/") ? "" : "home")));
  $("#lockBtn").textContent = editing ? "Lock" : "Edit";
  renderBar();
  app.replaceChildren();
  if (route === "timeline") return viewTimeline();
  if (route.startsWith("p/")) return viewProject(route.slice(2));
  viewHome();
}
function viewHome() {
  app.append(h("section", { class: "hero" }, h("h1", {}, site.name), site.tagline ? h("p", { class: "sub" }, site.tagline) : null, site.bio ? h("p", { style: "margin-top:10px" }, site.bio) : null));
  const projects = [...site.projects].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const wrap = h("div", { class: site.layout || "list" });
  projects.forEach((p) => wrap.append(card(p)));
  if (!projects.length && editing) wrap.append(h("p", { class: "note" }, "No projects yet. Use “+ Add project” above."));
  app.append(wrap);
  const recent = site.projects.flatMap((p) => (p.timeline || []).map((e) => ({ ...e, p }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  if (recent.length) app.append(h("div", { class: "lab" }, "RECENT"), timelineEl(recent, true));
}
function card(p) {
  const c = h("article", { class: "card", tabindex: 0, onclick: () => (location.hash = "#/p/" + p.id), onkeydown: (e) => e.key === "Enter" && (location.hash = "#/p/" + p.id) },
    p.image ? h("img", { src: imgSrc(p.image), alt: "", loading: "lazy" }) : null,
    h("div", { class: "b" }, h("h3", {}, p.title), h("p", {}, p.summary), h("div", { class: "meta" }, fmt(p.date))));
  return c;
}
function viewProject(id) {
  const p = site.projects.find((x) => x.id === id);
  if (!p) return app.append(h("p", {}, "Project not found. ", h("a", { href: "#/" }, "Back")));
  const tl = [...(p.timeline || [])].sort((a, b) => b.date.localeCompare(a.date));
  app.append(h("p", {}, h("a", { href: "#/", class: "note" }, "← All projects")),
    h("h1", { style: "margin:6px 0" }, p.title), h("div", { class: "meta" }, fmt(p.date)),
    p.image ? h("img", { class: "hero-img", src: imgSrc(p.image), alt: p.title }) : null,
    h("p", { style: "white-space:pre-wrap" }, p.description || p.summary),
    p.link && safeUrl(p.link) ? h("p", {}, h("a", { href: p.link, target: "_blank", rel: "noopener" }, "View project ↗")) : null,
    h("div", {}, (p.tags || []).map((t) => h("span", { class: "tag" }, t))),
    editing ? h("div", { class: "row" }, h("button", { onclick: () => editProject(p) }, "Edit project"), h("button", { class: "ghost", onclick: () => editEntry(p) }, "+ Timeline entry")) : null,
    h("h2", { style: "margin-top:36px;font-size:1.1rem" }, "Timeline"),
    tl.length ? timelineEl(tl.map((e) => ({ ...e, p })), false) : h("p", { class: "note" }, "No timeline entries yet."));
}
function timelineEl(items, showProject) {
  return h("div", { class: "tl" }, items.map((e) => h("div", { class: "it " + e.type },
    h("div", { class: "meta" }, fmt(e.date), " · ", e.type === "milestone" ? "milestone" : "update"),
    e.type === "milestone" ? h("strong", {}, e.text) : h("div", {}, e.text),
    showProject ? h("a", { class: "proj", href: "#/p/" + e.p.id }, e.p.title) : null,
    editing ? h("div", {}, h("button", { class: "ghost", style: "padding:1px 8px;font-size:.75rem;margin-top:4px", onclick: () => editEntry(e.p, e) }, "edit")) : null)));
}
function viewTimeline() {
  const all = site.projects.flatMap((p) => (p.timeline || []).map((e) => ({ ...e, p }))).sort((a, b) => b.date.localeCompare(a.date));
  app.append(h("h1", { style: "font-weight:600" }, "Timeline"), all.length ? timelineEl(all, true) : h("p", { class: "note" }, "Nothing here yet."));
}

/* ---------- edit bar ---------- */
function renderBar() {
  bar.hidden = !editing; bar.replaceChildren();
  if (!editing) return;
  const sel = h("select", { style: "width:auto", onchange: async () => { site.layout = sel.value; render(); await saveSite("Change layout"); } },
    ["grid", "list", "minimal"].map((l) => h("option", { value: l, selected: site.layout === l }, "Layout: " + l)));
  bar.append(h("span", { class: "note" }, "Editing"), sel, h("button", { onclick: () => editProject() }, "+ Add project"),
    h("button", { class: "ghost", onclick: editProfile }, "Edit profile"));
}

/* ---------- dialogs ---------- */
function openDialog(...kids) { dlg.replaceChildren(...kids.filter((x) => x != null)); if (!dlg.open) dlg.showModal(); }
const field = (label, el) => h("div", {}, h("label", {}, label), el);
const close = () => dlg.close();

function editProfile() {
  const n = h("input", { value: site.name }), t = h("input", { value: site.tagline }), b = h("textarea", {}, site.bio);
  openDialog(h("h2", { style: "margin-top:0" }, "Profile"), field("Name", n), field("Tagline", t), field("Bio", b),
    h("div", { class: "row" }, h("button", { onclick: async () => { Object.assign(site, { name: n.value, tagline: t.value, bio: b.value }); close(); render(); await saveSite("Update profile"); } }, "Save"),
      h("button", { class: "ghost", onclick: close }, "Cancel")));
}

function editProject(p) {
  const isNew = !p; p = p || { id: uid(), title: "", summary: "", description: "", link: "", tags: [], date: today(), image: "", timeline: [] };
  const f = { title: h("input", { value: p.title }), summary: h("input", { value: p.summary }), description: h("textarea", {}, p.description),
    link: h("input", { value: p.link, placeholder: "https://…" }), tags: h("input", { value: (p.tags || []).join(", ") }), date: h("input", { type: "date", value: p.date }) };
  let newImg = null;
  const file = h("input", { type: "file", accept: "image/*", onchange: async () => { newImg = await shrink(file.files[0]); prev.src = newImg; prev.hidden = false; } });
  const prev = h("img", { class: "hero-img", src: p.image ? imgSrc(p.image) : "", hidden: !p.image, style: "max-height:180px;object-fit:cover" });
  const err = h("div", { class: "err" });
  openDialog(h("h2", { style: "margin-top:0" }, isNew ? "Add project" : "Edit project"), field("Title", f.title), field("Short summary", f.summary),
    field("Description", f.description), field("Link (optional)", f.link), field("Tags (comma separated)", f.tags), field("Date", f.date),
    field("Image", file), prev, err,
    h("div", { class: "row" }, h("button", { onclick: async () => {
      if (!f.title.value.trim()) { err.textContent = "Title is required."; return; }
      Object.assign(p, { title: f.title.value.trim(), summary: f.summary.value, description: f.description.value, link: f.link.value.trim(),
        tags: f.tags.value.split(",").map((s) => s.trim()).filter(Boolean), date: f.date.value || today() });
      try {
        if (newImg) { const path = `images/${p.id}-${Date.now().toString(36)}.jpg`; setStatus("Uploading image…"); await putFile(path, newImg.split(",")[1], "Add image"); previews[path] = newImg; p.image = path; }
      } catch (e) { err.textContent = "Image upload failed: " + e.message; return; }
      if (isNew) site.projects.push(p);
      close(); render(); await saveSite((isNew ? "Add project: " : "Update project: ") + p.title);
    } }, "Save"), h("button", { class: "ghost", onclick: close }, "Cancel"), h("span", { class: "sp" }),
      isNew ? null : h("button", { class: "danger", onclick: async () => { if (!confirm("Delete this project and its timeline?")) return; site.projects = site.projects.filter((x) => x !== p); close(); location.hash = "#/"; render(); await saveSite("Delete project: " + p.title); } }, "Delete")));
}

function editEntry(p, e) {
  const isNew = !e; e = e || { id: uid(), date: today(), type: "update", text: "" };
  const type = h("select", {}, ["update", "milestone"].map((t) => h("option", { value: t, selected: e.type === t }, t)));
  const date = h("input", { type: "date", value: e.date }), text = h("textarea", {}, e.text);
  openDialog(h("h2", { style: "margin-top:0" }, (isNew ? "Add" : "Edit") + " timeline entry · " + p.title), field("Type", type), field("Date", date), field("Text", text),
    h("div", { class: "row" }, h("button", { onclick: async () => {
      if (!text.value.trim()) return;
      Object.assign(e, { type: type.value, date: date.value || today(), text: text.value.trim() });
      p.timeline = p.timeline || []; if (isNew) p.timeline.push(e);
      close(); render(); await saveSite("Timeline: " + p.title);
    } }, "Save"), h("button", { class: "ghost", onclick: close }, "Cancel"), h("span", { class: "sp" }),
      isNew ? null : h("button", { class: "danger", onclick: async () => { p.timeline = p.timeline.filter((x) => x !== e); close(); render(); await saveSite("Timeline: remove entry"); } }, "Delete")));
}

function shrink(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.85)); };
    img.onerror = () => rej(new Error("Could not read image")); img.src = url;
  });
}

/* ---------- lock / unlock / setup ---------- */
function unlockDialog() {
  const pw = h("input", { type: "password", autocomplete: "current-password" }), err = h("div", { class: "err" });
  const go = async () => {
    err.textContent = "Checking…";
    try { token = await decryptToken(pw.value, auth); } catch { err.textContent = "Wrong password."; return; }
    const who = await api("");
    if (!who.ok) { token = null; err.textContent = "The stored token no longer works (expired or revoked). Run setup again."; return; }
    editing = true; close(); await load(); render();
  };
  pw.addEventListener("keydown", (e) => e.key === "Enter" && go());
  openDialog(h("h2", { style: "margin-top:0" }, "Unlock editing"), field("Password", pw), err,
    h("div", { class: "row" }, h("button", { onclick: go }, "Unlock"), h("button", { class: "ghost", onclick: close }, "Cancel"), h("span", { class: "sp" }),
      h("button", { class: "ghost", onclick: setupDialog }, "Reset setup")));
  pw.focus();
}
function setupDialog() {
  const tok = h("input", { type: "password", placeholder: "github_pat_…", autocomplete: "off" }), p1 = h("input", { type: "password", autocomplete: "new-password" }),
    p2 = h("input", { type: "password", autocomplete: "new-password" }), err = h("div", { class: "err" });
  openDialog(h("h2", { style: "margin-top:0" }, "Set up editing"),
    h("p", { class: "note" }, `1. On GitHub: Settings → Developer settings → Fine-grained tokens → Generate. Repository access: only "${repoInfo.owner}/${repoInfo.repo}". Permission: Contents = Read and write. Pick a long expiry.`),
    h("p", { class: "note" }, "2. Paste it below with a password you choose (12+ characters). The token is encrypted in your browser and only the encrypted form is saved to the repo. I never see either."),
    field("Fine-grained token", tok), field("New password", p1), field("Repeat password", p2), err,
    h("div", { class: "row" }, h("button", { onclick: async () => {
      if (p1.value.length < 12) { err.textContent = "Use at least 12 characters."; return; }
      if (p1.value !== p2.value) { err.textContent = "Passwords differ."; return; }
      token = tok.value.trim(); err.textContent = "Checking token…";
      const chk = await api("");
      if (!chk.ok) { token = null; err.textContent = "GitHub rejected the token (needs access to this repo)."; return; }
      try { const blob = await encryptToken(p1.value, token); await putFile("data/auth.json", toB64(JSON.stringify(blob) + "\n"), "Set up editing"); auth = blob; }
      catch (e) { token = null; err.textContent = "Could not save: " + e.message; return; }
      editing = true; close(); await load(); render(); setStatus("Editing unlocked.");
    } }, "Save and unlock"), h("button", { class: "ghost", onclick: close }, "Cancel")));
}
$("#lockBtn").addEventListener("click", () => {
  if (editing) { editing = false; token = null; render(); return; }
  auth ? unlockDialog() : setupDialog();
});

/* ---------- boot ---------- */
async function selfTest() {
  const a = await encryptToken("correct horse battery", "tok123");
  const ok = (await decryptToken("correct horse battery", a)) === "tok123";
  let bad = false; try { await decryptToken("wrong", a); } catch { bad = true; }
  document.body.prepend(h("h1", {}, `SELFTEST ${ok && bad ? "PASS" : "FAIL"}`));
}
(async () => {
  await Promise.all([load(), loadAuth()]);
  window.addEventListener("hashchange", render);
  render();
  if (location.search.includes("selftest")) await selfTest();
})().catch((e) => { app.textContent = "Failed to load: " + e.message; });
