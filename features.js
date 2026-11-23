/* Tare feature module: coaching programs, recipes, label scanning, tracking, and insights. */
const MICROS = [
  { k: "fiber", off: "fiber", label: "Fiber", u: "g", x: 1, dv: 28 },
  { k: "sugar", off: "sugars", label: "Sugar", u: "g", x: 1, dv: 50 },
  { k: "satfat", off: "saturated-fat", label: "Saturated fat", u: "g", x: 1, dv: 20 },
  { k: "sodium", off: "sodium", label: "Sodium", u: "mg", x: 1000, dv: 2300 },
  { k: "chol", off: "cholesterol", label: "Cholesterol", u: "mg", x: 1000, dv: 300 },
  { k: "potassium", off: "potassium", label: "Potassium", u: "mg", x: 1000, dv: 4700 },
  { k: "calcium", off: "calcium", label: "Calcium", u: "mg", x: 1000, dv: 1300 },
  { k: "iron", off: "iron", label: "Iron", u: "mg", x: 1000, dv: 18 },
  { k: "vitc", off: "vitamin-c", label: "Vitamin C", u: "mg", x: 1000, dv: 90 },
  { k: "vitd", off: "vitamin-d", label: "Vitamin D", u: "mcg", x: 1000000, dv: 20 }
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_TYPES = { normal: ["Normal", 1], high: ["High", 1.15], low: ["Low", .85], fast: ["Fasting", .3] };
const MEASURES = [["waist", "Waist"], ["chest", "Chest"], ["hips", "Hips"], ["arm", "Arm"], ["thigh", "Thigh"]];
const OCR = {
  script: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  worker: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
  core: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0",
  lang: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int"
};
const onlineCache = new Map();
let onlineNext = 0, clip = null, insightRange = 30, contributor = "kcal", ocrLoad = null, photoUrls = [], confirmPhoto = "";

/* Programs and day targets */
function applyDiet(t, kg) {
  const p = S.profile;
  if (p.mode === "manual" && p.manual) return { ...p.manual, setOn: today(), floored: false };
  const floor = p.sex === "f" ? 1200 : 1500;
  let kcal = t.kcal;
  if (p.mode === "collab") kcal += clamp(num(p.nudge), -300, 300);
  const floored = t.floored || kcal < floor;
  kcal = Math.round(Math.max(kcal, floor) / 10) * 10;
  const pr = t.p, left = g => Math.round((kcal - pr * 4 - g) / 9);
  let c = t.c, f = t.f;
  if (p.diet === "lowcarb") { c = Math.round(kcal * .2 / 4); f = left(c * 4); }
  else if (p.diet === "keto") { c = 30; f = left(120); }
  else if (p.diet === "carb") { f = Math.round(.6 * kg); c = Math.round((kcal - pr * 4 - f * 9) / 4); }
  else c = Math.round((kcal - pr * 4 - f * 9) / 4);
  if (f < 0) f = 0;
  if (c < 0) c = 0;
  return { kcal, p: pr, c, f, setOn: t.setOn, floored };
}
function dayPlan(date) {
  const p = S.profile, g = p.plan, week = p.week;
  if (!week || week.every(x => x === "normal")) return { ...g, type: "normal" };
  const mult = t => (DAY_TYPES[t] || DAY_TYPES.normal)[1], sum = week.reduce((a, t) => a + mult(t), 0);
  const type = week[parse(date).getDay()], kcal = Math.max(500, Math.round(g.kcal * mult(type) * 7 / sum / 10) * 10);
  const pr = type === "fast" ? Math.min(g.p, Math.round(kcal * .4 / 4)) : g.p;
  let f = type === "fast" ? Math.round(kcal * .3 / 9) : g.f, c = Math.round((kcal - pr * 4 - f * 9) / 4);
  if (c < 0) { c = 0; f = Math.max(0, Math.round((kcal - pr * 4) / 9)); }
  return { ...g, kcal, p: pr, c, f, type };
}
const dayLabel = date => { const t = dayPlan(date).type; return t === "normal" ? "Target" : `${DAY_TYPES[t][0]} day target`; };
function goalEta() {
  const p = S.profile;
  if (!p.goalKg) return "";
  const now = latestTrend(), gap = p.goalKg - now, e = estimate();
  if (Math.abs(gap) < .25) return "You are at your goal weight.";
  const perWeek = e.conf >= .3 ? e.rate * 7 : p.goal / 100 * now;
  if (!perWeek || Math.sign(perWeek) !== Math.sign(gap)) return `${toUser(Math.abs(gap)).toFixed(1)} ${unit()} to go. Your current trend is not moving toward this goal.`;
  const weeks = gap / perWeek, date = add(today(), Math.round(weeks * 7));
  return `${toUser(Math.abs(gap)).toFixed(1)} ${unit()} to go. Estimated arrival: ${parse(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.`;
}
function planExtras() {
  const p = S.profile, m = p.manual || p.plan, week = p.week || Array(7).fill("normal"), mode = p.mode || "coached", eta = goalEta();
  return `<form class="card form" data-form="coach"><h2 class="full">Macro program</h2>
  <label>Coaching mode<select id="pmode" name="mode">${opt("coached", "Coached", mode)}${opt("collab", "Collaborative", mode)}${opt("manual", "Manual", mode)}</select></label>
  <label>Diet style<select id="pdiet" name="diet">${opt("balanced", "Balanced", p.diet || "balanced")}${opt("lowcarb", "Low-carb", p.diet)}${opt("keto", "Keto", p.diet)}${opt("carb", "Carb-focused", p.diet)}</select></label>
  <label class="full">Goal weight (${unit()}, optional)<input id="pgoal" name="goalWeight" type="number" inputmode="decimal" step="0.1" min="20" max="1000" value="${p.goalKg ? toUser(p.goalKg).toFixed(1) : ""}"></label>
  ${eta ? `<p class="muted full" style="margin:0">${esc(eta)}</p>` : ""}
  <label class="full" id="nudgeRow" ${mode === "collab" ? "" : "hidden"}>Adjust coach's calories (-300 to +300)<input id="pnudge" name="nudge" type="number" step="10" min="-300" max="300" value="${num(p.nudge)}"></label>
  <div class="full form" id="manualRow" ${mode === "manual" ? "" : "hidden"}><label>Calories<input id="mk" name="mk" type="number" min="800" max="8000" value="${m.kcal}"></label><label>Protein (g)<input id="mp" name="mp" type="number" min="0" max="500" value="${m.p}"></label><label>Carbs (g)<input id="mc" name="mc" type="number" min="0" max="1000" value="${m.c}"></label><label>Fat (g)<input id="mf" name="mf" type="number" min="0" max="400" value="${m.f}"></label></div>
  <div class="full"><b style="font-size:13px">Weekly day types</b><div class="weekgrid">${DAY_NAMES.map((d, i) => `<label>${d}<select id="wk${i}" name="wk${i}">${Object.entries(DAY_TYPES).map(([k, v]) => opt(k, v[0], week[i])).join("")}</select></label>`).join("")}</div><p class="muted" style="margin:6px 0 0;font-size:13px">High, low, and fasting days keep your weekly calorie average the same. Tare allows up to 2 fasting days per week.</p></div>
  <p class="err full" id="coachErr" hidden></p><div class="full"><button class="btn primary">Save program</button></div></form>`;
}

/* Food data */
function microsFrom(n, suffix, qty) {
  const out = {};
  for (const m of MICROS) {
    let v = n[m.off + suffix];
    if ((v === "" || v == null) && suffix === "_serving" && qty > 0) { const h = n[m.off + "_100g"]; if (h !== "" && h != null) v = Number(h) * qty / 100; }
    if (v !== "" && v != null && Number.isFinite(Number(v))) out[m.k] = +(Number(v) * m.x).toFixed(2);
  }
  return Object.keys(out).length ? out : undefined;
}
function scaleN(n, q) { const o = {}; for (const k in n) o[k] = +(num(n[k]) * q).toFixed(2); return o; }
function cleanN(n) { if (!n || typeof n !== "object") return undefined; const o = {}; for (const m of MICROS) if (Number.isFinite(Number(n[m.k])) && n[m.k] != null) o[m.k] = clamp(Number(n[m.k]), 0, 1000000); return Object.keys(o).length ? o : undefined; }
function cleanDayExtras(v) {
  const o = {};
  if (num(v.steps) > 0) o.steps = Math.round(clamp(num(v.steps), 0, 200000));
  if (v.period) o.period = true;
  if (v.m && typeof v.m === "object") { const m = {}; for (const [k] of MEASURES) if (num(v.m[k]) > 0) m[k] = clamp(num(v.m[k]), 1, 400); if (Object.keys(m).length) o.m = m; }
  return o;
}
function smartFoods(meal) {
  const score = new Map(), now = today();
  for (const d of Object.keys(S.days)) {
    const age = between(d, now);
    if (age < 0 || age > 120) continue;
    for (const e of S.days[d].foods || []) {
      if (!e.qty) continue;
      const hit = score.get(e.name) || { s: 0, f: { name: e.name, serv: e.serv, kcal: e.kcal / e.qty, p: e.p / e.qty, c: e.c / e.qty, f: e.f / e.qty, ...(e.n ? { n: scaleN(e.n, 1 / e.qty) } : {}) } };
      hit.s += (e.meal === meal ? 3 : 1) * Math.exp(-age / 21);
      score.set(e.name, hit);
    }
  }
  return [...score.values()].sort((a, b) => b.s - a.s).slice(0, 10).map(x => x.f);
}
async function searchOnline() {
  const q = M.q.trim();
  if (q.length < 2) { M.onlineMsg = "Type at least 2 letters first."; refreshResults(); return; }
  const cacheKey = q.toLowerCase();
  if (onlineCache.has(cacheKey)) { M.online = onlineCache.get(cacheKey); M.onlineMsg = M.online.length ? "Online results are crowd-sourced. Compare them with the label." : "No online results found."; refreshResults(); return; }
  const wait = Math.ceil((onlineNext - Date.now()) / 1000);
  if (wait > 0) { M.onlineMsg = `Open Food Facts limits searches. Try again in ${wait} seconds.`; refreshResults(); return; }
  onlineNext = Date.now() + 7000;
  M.onlineBusy = true; M.onlineMsg = "Searching Open Food Facts."; refreshResults();
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000), asked = q;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q.slice(0, 80))}&search_simple=1&action=process&json=1&page_size=12&fields=code,product_name,brands,serving_size,serving_quantity,nutriments`, { signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error("search");
    const j = await r.json();
    const list = (j.products || []).filter(x => x.product_name).map(x => {
      const info = parseProduct(x, String(x.code || "")), b = info.bases[0];
      return b.kcal == null ? null : { name: info.name, serv: b.label, kcal: b.kcal, p: num(b.p), c: num(b.c), f: num(b.f), n: b.n, online: true };
    }).filter(Boolean);
    onlineCache.set(cacheKey, list);
    if (!M || M.q.trim() !== asked) return;
    M.online = list;
    M.onlineMsg = list.length ? "Online results are crowd-sourced. Compare them with the label." : "No online results found.";
  } catch (e) { onlineNext = Date.now() + 60000; if (M) M.onlineMsg = "Open Food Facts is busy or you are offline. Try again in a minute. Built-in foods and saved barcodes still work."; }
  finally { clearTimeout(timer); if (M) { M.onlineBusy = false; refreshResults(); } }
}
function refreshResults() { const r = $("#res"), m = $("#onlineMsg"), b = $("#onlineBtn"); if (r) r.innerHTML = resultsHTML(); if (m) { m.textContent = M.onlineMsg || ""; m.hidden = !M.onlineMsg; } if (b) b.disabled = !!M.onlineBusy; }
function searchTools() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  return `<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn small" id="onlineBtn" data-pro="online" ${M.onlineBusy ? "disabled" : ""}>Search online</button>${Speech ? `<button type="button" class="btn small" data-pro="speak">Speak</button>` : ""}</div><p class="muted" id="onlineMsg" role="status" style="margin:0;font-size:13px" ${M.onlineMsg ? "" : "hidden"}>${esc(M.onlineMsg || "")}</p>`;
}
function startSpeech() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) return;
  const rec = new Speech();
  rec.lang = navigator.language || "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
  M.onlineMsg = "Listening. Say a food name."; refreshResults();
  rec.onresult = ev => { const q = $("#q"); if (!q) return; q.value = ev.results[0][0].transcript.replace(/[.?!]$/, ""); q.dispatchEvent(new Event("input", { bubbles: true })); M.onlineMsg = ""; refreshResults(); };
  rec.onerror = () => { M.onlineMsg = "Speech is not available here. Use the microphone on your keyboard instead."; refreshResults(); };
  rec.onend = () => { if (M?.onlineMsg === "Listening. Say a food name.") { M.onlineMsg = ""; refreshResults(); } };
  try { rec.start(); } catch (e) { M.onlineMsg = "Speech could not start. Use the microphone on your keyboard instead."; refreshResults(); }
}

/* Nutrition label scanner */
function loadOCR() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return ocrLoad || (ocrLoad = new Promise((res, rej) => { const s = document.createElement("script"); s.src = OCR.script; s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer"; s.onload = () => res(window.Tesseract); s.onerror = () => { ocrLoad = null; s.remove(); rej(new Error("ocr")); }; document.head.append(s); }));
}
function parseLabel(raw) {
  const text = String(raw || "").replace(/[|]/g, " ").replace(/\r/g, ""), lines = text.split("\n");
  const fix = s => Number(String(s).replace(/[Oo]/g, "0").replace(/[lI]/g, "1").replace(/,/g, "."));
  const grab = (re, line = false) => { for (const l of line ? lines : [text]) { const m = l.match(re); if (m) { const v = fix(m[1]); if (Number.isFinite(v)) return v; } } return null; };
  const unitFix = (v, u) => v == null ? null : /^mcg|^ug|^µg/i.test(u || "") ? v / 1000 : /^g/i.test(u || "") ? v * 1000 : v;
  const mg = re => { const m = text.match(re); return m ? unitFix(fix(m[1]), m[2]) : null; };
  const out = {
    serv: (text.match(/serving size[:\s]*([^\n]{1,32})/i)?.[1] || "1 serving").trim(),
    kcal: grab(/calories(?!\s*from)[^\d\n]{0,12}([\dOo]{1,4})/i, true) ?? grab(/energy[^\n]*?([\d]{1,4})\s*kcal/i, true),
    f: grab(/total\s*fat[^\d\n]{0,6}([\dOolI]+(?:[.,]\d+)?)\s*g/i, true) ?? grab(/^\s*fat[^\d\n]{0,6}([\dOolI]+(?:[.,]\d+)?)\s*g/im, true),
    c: grab(/(?:total\s*)?carb[a-z.]*[^\d\n]{0,6}([\dOolI]+(?:[.,]\d+)?)\s*g/i, true),
    p: grab(/protein[^\d\n]{0,6}([\dOolI]+(?:[.,]\d+)?)\s*g/i, true)
  };
  const n = {
    fiber: grab(/fib(?:er|re)[^\d\n]{0,6}([\dOolI]+(?:[.,]\d+)?)\s*g/i, true),
    sugar: grab(/(?:total\s*)?sugars?[^\d\n]{0,6}([\dOolI]+(?:[.,]\d+)?)\s*g/i, true),
    satfat: grab(/sat(?:urated)?\.?\s*fat[^\d\n]{0,6}([\dOolI]+(?:[.,]\d+)?)\s*g/i, true),
    sodium: mg(/sodium[^\d\n]{0,6}([\d,.]+)\s*(mg|g)/i),
    chol: mg(/cholest[a-z.]*[^\d\n]{0,6}([\d,.]+)\s*(mg|g)/i),
    potassium: mg(/potassium[^\d\n]{0,6}([\d,.]+)\s*(mg|g)/i),
    calcium: mg(/calcium[^\d\n]{0,6}([\d,.]+)\s*(mg|g)/i),
    iron: mg(/iron[^\d\n]{0,6}([\d,.]+)\s*(mg|g)/i)
  };
  const vd = text.match(/vitamin\s*d[^\d\n]{0,6}([\d.]+)\s*(mcg|ug|µg)/i);
  if (vd) n.vitd = Number(vd[1]);
  for (const k in n) if (n[k] == null) delete n[k];
  out.n = Object.keys(n).length ? n : undefined;
  return out;
}
function labelBody() {
  const s = M.label || {};
  return `<p class="muted" style="margin:0">Take a straight, well-lit photo of the Nutrition Facts panel. Tare reads it on this phone and lets you review every value.</p><div><label class="btn primary filebtn" for="labelPhoto">Take label photo</label><input id="labelPhoto" type="file" accept="image/*" capture="environment" hidden></div>${s.msg ? `<p class="${s.err ? "err" : "muted"}" role="status" style="margin:0">${esc(s.msg)}</p>` : ""}`;
}
async function readLabel(file) {
  M.label = { msg: "Preparing the label reader. The first use downloads about 15 MB." }; renderDlg();
  let worker;
  try {
    const T = await loadOCR();
    worker = await T.createWorker("eng", 1, { workerPath: OCR.worker, corePath: OCR.core, langPath: OCR.lang, logger: l => { const el = $("#dlg [role=status]"); if (el && l.status === "recognizing text") el.textContent = `Reading the label: ${Math.round(l.progress * 100)}%`; } });
    const bitmap = await shrinkImage(file, 1800), { data } = await worker.recognize(bitmap), parsed = parseLabel(data.text);
    if (!M) return;
    if (parsed.kcal == null && parsed.p == null && parsed.c == null && parsed.f == null) { M.label = { err: true, msg: "Tare could not find nutrition values. Retake it straight on with less glare." }; renderDlg(); return; }
    M.prefill = parsed; M.label = null; M.tab = "custom"; renderDlg();
  } catch (e) { if (M) { M.label = { err: true, msg: "The label reader could not run. Connect to the internet once, then try again." }; renderDlg(); } }
  finally { try { await worker?.terminate(); } catch (e) {} }
}
function shrinkImage(file, max) {
  return new Promise((res, rej) => { const url = URL.createObjectURL(file), img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c); }; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("image")); }; img.src = url; });
}
function afterDlg() {
  if (M?.tab !== "custom" || !M.prefill) return;
  const f = M.prefill, set = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
  set("#cserv", String(f.serv).slice(0, 40)); set("#ck", f.kcal); set("#cp", f.p); set("#cc", f.c); set("#cf", f.f);
  const form = $("[data-form=custom]");
  if (form && !$("#labelNote")) { const note = document.createElement("p"); note.id = "labelNote"; note.className = "warn full"; note.style.margin = "0"; note.textContent = "Read from your photo. Check every value against the label, then name the food."; form.prepend(note); }
  $("#cname")?.focus();
}

/* Recipes */
function recipeTotals(r) { const t = { kcal: 0, p: 0, c: 0, f: 0, n: {} }; for (const i of r.items) { for (const k of ["kcal", "p", "c", "f"]) t[k] += i.food[k] * i.qty; if (i.food.n) for (const k in i.food.n) t.n[k] = (t.n[k] || 0) + i.food.n[k] * i.qty; } return t; }
function recipeBody() {
  const r = M.recipe || (M.recipe = { name: "", servings: 4, q: "", items: [] }), t = recipeTotals(r), s = Math.max(.1, num(r.servings, 1)), q = r.q.trim().toLowerCase(), found = q ? [...S.custom.filter(f => !f.recipe), ...FOODS].filter(f => q.split(/\s+/).every(w => f.name.toLowerCase().includes(w))).slice(0, 8) : [];
  M.recipeFound = found;
  return `<div class="form"><label>Recipe name<input id="rname" maxlength="70" value="${esc(r.name)}" placeholder="Turkey chili"></label><label>Servings made<input id="rserv" type="number" min="0.5" step="0.5" value="${esc(r.servings)}"></label></div>
  <input id="rq" type="search" placeholder="Add an ingredient" aria-label="Add an ingredient" value="${esc(r.q)}">
  ${found.length ? `<div class="results">${found.map((f, i) => `<button type="button" class="result" data-pro="ringadd" data-i="${i}"><span><b>${esc(f.name)}</b><small>${esc(f.serv)}</small></span><span class="mono">${fmt(f.kcal)}</span></button>`).join("")}</div>` : ""}
  ${r.items.length ? `<div class="stack" style="gap:6px">${r.items.map((it, i) => `<div class="chooser" style="grid-template-columns:76px minmax(0,1fr) auto"><input aria-label="Amount of ${esc(it.food.name)}" data-ring="${i}" type="number" min="0.05" step="any" value="${it.qty}"><span><b>${esc(it.food.name)}</b><br><small class="muted">${esc(it.food.serv)}</small></span><button type="button" class="icon" data-pro="ringdel" data-i="${i}" aria-label="Remove ${esc(it.food.name)}">×</button></div>`).join("")}</div><p class="mono muted" id="rTotal" style="margin:0">Per serving: ${fmt(t.kcal / s)} kcal · ${Math.round(t.p / s)}P ${Math.round(t.c / s)}C ${Math.round(t.f / s)}F</p><p class="err" id="rErr" hidden></p><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" data-pro="rsave" data-add="1">Save and add 1 serving</button><button type="button" class="btn" data-pro="rsave">Save recipe</button></div>` : `<p class="muted" style="margin:0">Search above to add your first ingredient.</p>`}`;
}
function saveRecipe(addIt) {
  const r = M.recipe, name = String(r.name).trim(), s = num(r.servings), err = $("#rErr");
  if (!name || !(s > 0)) { if (err) { err.textContent = "Add a recipe name and a serving count."; err.hidden = false; } return; }
  const t = recipeTotals(r), n = {}; for (const k in t.n) n[k] = +(t.n[k] / s).toFixed(2);
  const food = { name: name.slice(0, 80), serv: "1 serving", kcal: Math.round(t.kcal / s), p: +(t.p / s).toFixed(1), c: +(t.c / s).toFixed(1), f: +(t.f / s).toFixed(1), recipe: true, ...(Object.keys(n).length ? { n } : {}) };
  S.custom = [food, ...S.custom.filter(c => c.name !== food.name)].slice(0, 300); touch();
  if (addIt) addEntry(food, 1);
  $("#dlg").close(); render();
}

/* Copy and paste */
const copyItem = e => { const { id, ...rest } = e; return rest; };
function dayTools(canCopy) {
  const has = peek(cursor).foods.length;
  const b = [];
  if (canCopy) b.push(`<button class="btn small" data-act="copyday">Copy previous day</button>`);
  if (has) b.push(`<button class="btn small" data-pro="copyday">Copy day</button>`);
  if (clip?.type === "day") b.push(`<button class="btn small primary" data-pro="pasteday">Paste day (${clip.items.length})</button>`);
  return b.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:10px">${b.join("")}</div>` : "";
}
function mealTools(m, es) {
  const b = [];
  if (es.length) b.push(`<button class="link" data-pro="copymeal" data-meal="${m}">Copy meal</button>`);
  if (clip && clip.type !== "day") b.push(`<button class="link" data-pro="pastemeal" data-meal="${m}">Paste ${clip.items.length === 1 ? "food" : clip.items.length + " foods"}</button>`);
  return b.length ? `<div class="mealtools">${b.join("")}</div>` : "";
}

/* Tracking */
const lenUser = cm => unit() === "kg" ? cm : cm / 2.54, lenStore = v => unit() === "kg" ? v : v * 2.54, lenUnit = () => unit() === "kg" ? "cm" : "in";
function latestMeasure(k, before) { const ds = Object.keys(S.days).filter(d => S.days[d].m?.[k] && (!before || d < before)).sort(); return ds.length ? { d: ds[ds.length - 1], v: S.days[ds[ds.length - 1]].m[k] } : null; }
function cycleInfo() {
  const days = Object.keys(S.days).filter(d => S.days[d].period).sort(), starts = days.filter(d => !S.days[add(d, -1)]?.period);
  if (!starts.length) return "Mark period days to see your cycle length and next estimate.";
  const gaps = starts.slice(1).map((d, i) => between(starts[i], d)).filter(g => g >= 15 && g <= 60), last = starts[starts.length - 1];
  if (!gaps.length) return `Last period started ${short(last)}. Log another cycle to see an estimate.`;
  const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  return `Average cycle: ${avg} days. Next period estimate: ${short(add(last, avg))}. This is not a method of birth control.`;
}
function trackView() {
  const x = peek(cursor), m = x.m || {};
  return `<section class="card"><div class="datebar"><button class="icon" data-act="day" data-n="-1" aria-label="Previous day">‹</button><h2>${esc(long(cursor))}</h2><button class="icon" data-act="day" data-n="1" aria-label="Next day" ${cursor >= today() ? "disabled" : ""}>›</button></div></section>
  <div class="grid2"><form class="card form" data-form="track"><h2 class="full">Steps and body</h2><label class="full">Steps<input id="tsteps" name="steps" type="number" inputmode="numeric" min="0" max="200000" value="${x.steps || ""}" placeholder="Enter steps"></label>
  ${MEASURES.map(([k, l]) => { const prev = latestMeasure(k, cursor), delta = m[k] && prev ? lenUser(m[k] - prev.v) : null; return `<label>${l} (${lenUnit()})${delta != null ? ` <span class="muted" style="font-weight:400">${delta > 0 ? "+" : ""}${delta.toFixed(1)}</span>` : ""}<input id="tm-${k}" name="m-${k}" type="number" inputmode="decimal" step="0.1" min="1" max="400" value="${m[k] ? lenUser(m[k]).toFixed(1) : ""}"></label>`; }).join("")}
  <div class="full"><button class="btn primary">Save</button></div></form>
  <section class="card stack"><h2>Period</h2><label style="display:flex;align-items:center;gap:8px"><input id="tperiod" data-pro-change="period" type="checkbox" style="width:auto" ${x.period ? "checked" : ""}>Period on this day</label><p class="muted" style="margin:0">${esc(cycleInfo())}</p></section></div>
  <section class="card stack"><div class="mealhead"><h2>Progress photos</h2><label class="btn small filebtn" for="progressPhoto">Add photo</label><input id="progressPhoto" type="file" accept="image/*" hidden></div><p class="muted" style="margin:0;font-size:13px">Photos stay on this device and are not included in backup files.</p><div class="photogrid" id="photoGrid"><p class="muted" style="margin:0">Loading photos.</p></div></section>`;
}
function openPhotos() { return new Promise((res, rej) => { const r = indexedDB.open("tare-photos", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function photoTx(mode, fn) { const db = await openPhotos(); return new Promise((res, rej) => { const tx = db.transaction("photos", mode), req = fn(tx.objectStore("photos")); tx.oncomplete = () => { db.close(); res(req?.result); }; tx.onerror = () => { db.close(); rej(tx.error); }; tx.onabort = () => { db.close(); rej(tx.error); }; }); }
async function showPhotos() {
  const grid = $("#photoGrid"); if (!grid) return;
  try {
    const items = (await photoTx("readonly", s => s.getAll()) || []).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    if (!$("#photoGrid")) return;
    photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls = [];
    if (!items.length) { grid.innerHTML = `<p class="muted" style="margin:0">Add your first photo to compare progress over time.</p>`; return; }
    grid.innerHTML = items.map(p => { const url = URL.createObjectURL(p.blob); photoUrls.push(url); return `<figure><img src="${url}" alt="Progress photo from ${esc(short(p.date))}"><figcaption><span>${esc(short(p.date))}</span>${confirmPhoto === p.id ? `<button class="link danger" data-pro="delphotoyes" data-id="${esc(p.id)}">Delete</button>` : `<button class="icon" data-pro="delphoto" data-id="${esc(p.id)}" aria-label="Remove photo">×</button>`}</figcaption></figure>`; }).join("");
  } catch (e) { grid.innerHTML = `<p class="err">Photos are not available in this browser mode.</p>`; }
}
async function addPhoto(file) {
  if (S.demo) { const g = $("#photoGrid"); if (g) g.innerHTML = `<p class="err">Set up your plan before adding a photo.</p>`; return; }
  try {
    const c = await shrinkImage(file, 1400), blob = await new Promise(r => c.toBlob(r, "image/jpeg", .82));
    await photoTx("readwrite", s => s.put({ id: uid(), date: cursor, blob }));
    showPhotos();
  } catch (e) { const g = $("#photoGrid"); if (g) g.innerHTML = `<p class="err">That photo could not be saved. Your phone may be low on storage.</p>`; }
}

/* Insights */
function streak(test) { let d = today(), n = 0; if (!test(d)) d = add(d, -1); while (test(d)) { n++; d = add(d, -1); } return n; }
const logged = d => (peek(d).foods || []).length > 0, weighed = d => peek(d).w > 0;
function rangeDays(n) { const keys = Object.keys(S.days).filter(logged).sort(); if (n === "all") return keys; const start = add(today(), -(n - 1)); return keys.filter(d => d >= start); }
function averages(days) { if (!days.length) return null; const t = days.reduce((a, d) => { const x = totals(d); return { kcal: a.kcal + x.kcal, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f }; }, { kcal: 0, p: 0, c: 0, f: 0 }), n = days.length; return { kcal: t.kcal / n, p: t.p / n, c: t.c / n, f: t.f / n, n }; }
function contributors(days, key) {
  const m = new Map();
  for (const d of days) for (const e of S.days[d].foods) { const v = ["kcal", "p", "c", "f"].includes(key) ? e[key] : num(e.n?.[key]); if (v > 0) m.set(e.name, (m.get(e.name) || 0) + v); }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, v]) => ({ name, v, pct: total ? v / total * 100 : 0 }));
}
function insightsView() {
  const days = rangeDays(insightRange), ave = [["7 days", averages(rangeDays(7))], ["30 days", averages(rangeDays(30))], ["All time", averages(rangeDays("all"))]], foods = days.flatMap(d => S.days[d].foods), mealK = MEALS.map(m => foods.filter(e => e.meal === m).reduce((a, e) => a + e.kcal, 0)), allK = mealK.reduce((a, b) => a + b, 0) || 1;
  const last35 = Array.from({ length: 35 }, (_, i) => add(today(), i - 34)), logs28 = Array.from({ length: 28 }, (_, i) => add(today(), -i)), logPct = Math.round(logs28.filter(logged).length / 28 * 100), weighPct = Math.round(logs28.filter(weighed).length / 28 * 100), stepDays = logs28.map(d => peek(d).steps).filter(Boolean), stepAvg = stepDays.length ? stepDays.reduce((a, b) => a + b, 0) / stepDays.length : 0;
  const keys = [["kcal", "Calories", "kcal"], ["p", "Protein", "g"], ["c", "Carbs", "g"], ["f", "Fat", "g"], ...MICROS.map(m => [m.k, m.label, m.u])], cur = keys.find(k => k[0] === contributor) || keys[0], top = contributors(days, cur[0]), eta = goalEta();
  const micro = MICROS.map(m => { const vals = foods.filter(e => e.n?.[m.k] != null), sum = vals.reduce((a, e) => a + e.n[m.k], 0); return { ...m, avg: days.length ? sum / days.length : 0, count: vals.length }; });
  return `<div class="seg" style="justify-self:start" role="group" aria-label="Insight range">${[[7, "7 days"], [30, "30 days"], [90, "90 days"], ["all", "All"]].map(r => `<button data-pro="irange" data-r="${r[0]}" aria-pressed="${insightRange === r[0]}">${r[1]}</button>`).join("")}</div>
  <section class="card stats"><div class="stat"><span>Logging streak</span><b>${streak(logged)}</b><span>days</span></div><div class="stat"><span>Weigh-in streak</span><b>${streak(weighed)}</b><span>days</span></div><div class="stat"><span>Logged, 28 days</span><b>${logPct}%</b><span>Weighed ${weighPct}%</span></div><div class="stat"><span>Average steps</span><b>${stepAvg ? fmt(stepAvg) : "–"}</b><span>${stepDays.length} days</span></div></section>
  ${eta ? `<section class="card"><h2>Goal</h2><p class="muted" style="margin:6px 0 0">${esc(eta)}</p></section>` : ""}
  <div class="grid2"><section class="card stack"><h2>Consistency</h2><div class="heat" role="img" aria-label="Logging and weigh-in consistency for the last 35 days">${last35.map(d => `<i title="${esc(short(d))}" class="${logged(d) && weighed(d) ? "both" : logged(d) ? "log" : weighed(d) ? "wgh" : ""}"></i>`).join("")}</div><div class="legend"><span><i class="key both"></i>Food and weight</span><span><i class="key log"></i>Food</span><span><i class="key wgh"></i>Weight</span></div></section>
  <section class="card stack"><h2>Nutrition averages</h2><div style="overflow-x:auto"><table class="tbl"><thead><tr><th></th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr></thead><tbody>${ave.map(([l, a]) => `<tr><th>${l}</th>${a ? `<td>${fmt(a.kcal)}</td><td>${Math.round(a.p)}</td><td>${Math.round(a.c)}</td><td>${Math.round(a.f)}</td>` : `<td colspan="4" class="muted">No logged days</td>`}</tr>`).join("")}</tbody></table></div></section>
  <section class="card stack"><h2>Nutrient timing</h2>${MEALS.map((m, i) => { const pct = mealK[i] / allK * 100; return `<div><div class="mealhead"><span>${m}</span><span class="mono">${Math.round(pct)}%</span></div><div class="bar"><i style="width:${pct}%;background:var(--accent)"></i></div></div>`; }).join("")}</section>
  <section class="card stack"><div class="mealhead"><h2>Top contributors</h2><select id="contrib" aria-label="Nutrient" style="width:auto;max-width:55%">${keys.map(k => opt(k[0], k[1], contributor)).join("")}</select></div>${top.length ? top.map(t => `<div><div class="mealhead"><span style="min-width:0;overflow-wrap:anywhere">${esc(t.name)}</span><span class="mono">${Math.round(t.pct)}%</span></div><div class="bar"><i style="width:${t.pct}%;background:var(--protein)"></i></div></div>`).join("") : `<p class="muted" style="margin:0">No logged foods have this nutrient yet.</p>`}</section></div>
  <section class="card stack"><h2>Micronutrients</h2><p class="muted" style="margin:0;font-size:13px">Daily average from foods with this data. Scanned products, labels, and recipes can include it. Most built-in foods do not, so true intake may be higher.</p><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Nutrient</th><th>Average</th><th>Daily value</th><th>Foods with data</th></tr></thead><tbody>${micro.map(m => `<tr><th>${m.label}</th><td>${m.count ? `${m.avg >= 10 ? Math.round(m.avg) : m.avg.toFixed(1)} ${m.u}` : "–"}</td><td>${m.count ? Math.round(m.avg / m.dv * 100) + "%" : "–"}</td><td>${m.count}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* Events */
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-pro]"); if (!b) return;
  const a = b.dataset.pro;
  if (a === "online") searchOnline();
  if (a === "speak") startSpeech();
  if (a === "irange") { insightRange = b.dataset.r === "all" ? "all" : +b.dataset.r; render(); }
  if (a === "copyentry") { const e = peek(cursor).foods.find(x => x.id === b.dataset.id); if (e) { clip = { type: "food", items: [copyItem(e)] }; setSave("Food copied"); render(); } }
  if (a === "copymeal") { clip = { type: "meal", items: peek(cursor).foods.filter(e => e.meal === b.dataset.meal).map(copyItem) }; setSave("Meal copied"); render(); }
  if (a === "copyday") { clip = { type: "day", items: peek(cursor).foods.map(copyItem) }; setSave("Day copied"); render(); }
  if (a === "pastemeal" && clip) { const x = day(cursor); clip.items.forEach(e => x.foods.push({ ...e, id: uid(), meal: b.dataset.meal })); touch(cursor); render(); }
  if (a === "pasteday" && clip) { const x = day(cursor); clip.items.forEach(e => x.foods.push({ ...e, id: uid() })); touch(cursor); render(); }
  if (a === "ringadd") { const f = M.recipeFound[+b.dataset.i]; M.recipe.items.push({ food: f, qty: 1 }); M.recipe.q = ""; renderDlg(); $("#rq")?.focus(); }
  if (a === "ringdel") { M.recipe.items.splice(+b.dataset.i, 1); renderDlg(); }
  if (a === "rsave") saveRecipe(!!b.dataset.add);
  if (a === "delphoto") { confirmPhoto = b.dataset.id; showPhotos(); }
  if (a === "delphotoyes") { const id = b.dataset.id; confirmPhoto = ""; photoTx("readwrite", s => s.delete(id)).then(showPhotos).catch(showPhotos); }
});
document.addEventListener("input", ev => {
  const t = ev.target;
  if (t.id === "q" && M) { M.online = null; M.onlineMsg = ""; refreshResults(); }
  if (!M?.recipe) return;
  if (t.id === "rname") M.recipe.name = t.value;
  if (t.id === "rserv" || t.dataset.ring != null) {
    if (t.id === "rserv") M.recipe.servings = t.value; else M.recipe.items[+t.dataset.ring].qty = Math.max(0, num(t.value));
    const el = $("#rTotal"), x = recipeTotals(M.recipe), s = Math.max(.1, num(M.recipe.servings, 1)); if (el) el.textContent = `Per serving: ${fmt(x.kcal / s)} kcal · ${Math.round(x.p / s)}P ${Math.round(x.c / s)}C ${Math.round(x.f / s)}F`;
  }
  if (t.id === "rq") { M.recipe.q = t.value; const pos = t.selectionStart; renderDlg(); const n = $("#rq"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.id === "pmode") { $("#nudgeRow").hidden = t.value !== "collab"; $("#manualRow").hidden = t.value !== "manual"; }
  if (t.id === "contrib") { contributor = t.value; render(); }
  if (t.dataset.proChange === "period") { const x = day(cursor); if (t.checked) x.period = true; else delete x.period; touch(cursor); render(); }
  if (t.id === "labelPhoto" && t.files[0]) readLabel(t.files[0]);
  if (t.id === "progressPhoto" && t.files[0]) { addPhoto(t.files[0]); t.value = ""; }
});
document.addEventListener("submit", ev => {
  const f = ev.target, t = f.dataset.form, d = new FormData(f);
  if (t === "coach") {
    const p = S.profile, week = DAY_NAMES.map((_, i) => d.get("wk" + i)), err = $("#coachErr");
    if (week.filter(x => x === "fast").length > 2) { err.textContent = "Choose no more than 2 fasting days per week."; err.hidden = false; return; }
    const mode = d.get("mode"), goalW = num(d.get("goalWeight"));
    if (mode === "manual") { const manual = { kcal: Math.round(num(d.get("mk"))), p: Math.round(num(d.get("mp"))), c: Math.round(num(d.get("mc"))), f: Math.round(num(d.get("mf"))) }; if (manual.kcal < 800) { err.textContent = "Enter at least 800 calories for a manual target."; err.hidden = false; return; } p.manual = manual; }
    p.mode = mode; p.diet = d.get("diet"); p.nudge = clamp(num(d.get("nudge")), -300, 300); p.week = week;
    if (goalW > 0) p.goalKg = +fromUser(goalW).toFixed(3); else delete p.goalKg;
    p.plan = targets(); touch(); render();
  }
  if (t === "track") {
    const x = day(cursor), steps = num(d.get("steps")), m = {};
    if (steps > 0) x.steps = Math.round(steps); else delete x.steps;
    for (const [k] of MEASURES) { const v = num(d.get("m-" + k)); if (v > 0) m[k] = +lenStore(v).toFixed(2); }
    if (Object.keys(m).length) x.m = m; else delete x.m;
    touch(cursor); render();
  }
});
