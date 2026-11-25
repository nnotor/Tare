/* Tare feature module: coaching programs, recipes, label scanning, tracking, and insights. */
window.TARE_FEATURES_BUILD = "15";
// A page from an older release cannot safely run this code, so reload it into the matching version.
if (window.TARE_BUILD !== window.TARE_FEATURES_BUILD && !window.repairTareBuild) {
  try {
    const key = "tare-build-repair", tries = Number(sessionStorage.getItem(key) || 0);
    if (tries < 2) {
      sessionStorage.setItem(key, String(tries + 1));
      const reload = () => location.reload(), worker = navigator.serviceWorker;
      if (worker) worker.getRegistration().then(r => r && r.update()).catch(() => {}).finally(() => setTimeout(reload, 700));
      else reload();
    }
  } catch (e) {}
}
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
  scriptIntegrity: "sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F",
  worker: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
  core: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0",
  lang: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int"
};
let clip = null, insightRange = 30, contributor = "kcal", ocrLoad = null, photoUrls = [], confirmPhoto = "";

/* Safe backup restore */
const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const isDateKey = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const safeNumber = (v, min, max, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, min, max) : fallback; };
const isClock = v => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const safeWeek = w => Array.isArray(w) && w.length === 7 ? w.map(x => oneOf(x, Object.keys(DAY_TYPES), "normal")) : undefined;
function cleanPlan(plan) {
  const x = plan && typeof plan === "object" ? plan : {};
  return { kcal: Math.round(safeNumber(x.kcal, 0, 10000)), p: Math.round(safeNumber(x.p, 0, 1000)), c: Math.round(safeNumber(x.c, 0, 2000)), f: Math.round(safeNumber(x.f, 0, 1000)), setOn: isDateKey(x.setOn) ? x.setOn : today(), floored: x.floored === true };
}
function cleanProfile(raw) {
  const x = raw && typeof raw === "object" ? raw : {}, modes = ["coached", "collab", "manual", "off"], out = {
    unit: oneOf(x.unit, ["lb", "kg"], "lb"), sex: oneOf(x.sex, ["m", "f"], "m"),
    activity: oneOf(Number(x.activity), [1.2, 1.375, 1.55, 1.725, 1.9], 1.55), goal: oneOf(Number(x.goal), [-1, -.75, -.5, -.25, 0, .25, .5], -.5), protein: oneOf(Number(x.protein), [1.6, 1.8, 2.2], 1.8),
    plan: cleanPlan(x.plan), nudge: safeNumber(x.nudge, -300, 300), diet: oneOf(x.diet, ["balanced", "lowcarb", "keto", "carb"], "balanced"), useTargets: x.useTargets === true, hideMeals: x.hideMeals === true
  };
  if (Number(x.age) > 0) out.age = safeNumber(x.age, 1, 120);
  if (Number(x.heightCm) > 0) out.heightCm = safeNumber(x.heightCm, 20, 300);
  if (modes.includes(x.mode)) out.mode = x.mode;
  if (modes.includes(x.lastMode)) out.lastMode = x.lastMode;
  if (modes.includes(x.lastCoachMode)) out.lastCoachMode = x.lastCoachMode;
  if (Number(x.startKg) > 0) out.startKg = safeNumber(x.startKg, 10, 700);
  if (Number(x.goalKg) > 0) out.goalKg = safeNumber(x.goalKg, 10, 700);
  if (x.manual) { const { setOn, floored, ...manual } = cleanPlan(x.manual); out.manual = manual; }
  const week = safeWeek(x.week); if (week) out.week = week;
  if (isDateKey(x.lastBackup)) out.lastBackup = x.lastBackup;
  if (x.hideFasting === true) out.hideFasting = true;
  const fasting = cleanFasting(x.fasting); if (fasting) out.fasting = fasting;
  if (Array.isArray(x.planHistory)) out.planHistory = x.planHistory.filter(h => h && (h.from === "0000-00-00" || isDateKey(h.from))).slice(-400).map(h => { const { kcal, p, c, f } = cleanPlan(h); return { from: h.from, kcal, p, c, f, week: safeWeek(h.week) || null }; });
  return out;
}
function cleanCustom(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(f => f && typeof f === "object" && String(f.name || "").trim()).slice(0, 300).map(f => {
    const n = cleanN(f.n), barcode = String(f.barcode || "").replace(/\D/g, "").slice(0, 14);
    return { name: String(f.name).trim().slice(0, 100), serv: String(f.serv || "1 serving").slice(0, 50), kcal: safeNumber(f.kcal, 0, 10000), p: safeNumber(f.p, 0, 1000), c: safeNumber(f.c, 0, 2000), f: safeNumber(f.f, 0, 1000), ...(barcode ? { barcode } : {}), ...(f.recipe === true ? { recipe: true } : {}), ...(n ? { n } : {}) };
  });
}
function cleanEntry(e) {
  const n = cleanN(e && e.n);
  return { id: uid(), ...(isClock(e?.t) ? { t: e.t } : {}), name: String(e?.name ?? "Food").slice(0, 100), serv: String(e?.serv || "1 serving").slice(0, 50), qty: safeNumber(e?.qty, .01, 1000, 1), meal: MEALS.includes(e?.meal) ? e.meal : "Snacks", kcal: safeNumber(e?.kcal, 0, 50000), p: safeNumber(e?.p, 0, 5000), c: safeNumber(e?.c, 0, 5000), f: safeNumber(e?.f, 0, 5000), ...(n ? { n } : {}) };
}
function restoreBackup(x) {
  if (!x || typeof x !== "object" || !x.profile?.plan || !x.days || typeof x.days !== "object" || Array.isArray(x.days)) throw new Error("backup");
  const days = {};
  for (const [k, v] of Object.entries(x.days)) {
    if (!isDateKey(k) || !v || !Array.isArray(v.foods)) continue;
    days[k] = { ...(Number(v.w) > 0 ? { w: safeNumber(v.w, 10, 700) } : {}), ...(v.skip === true ? { skip: true } : {}), ...cleanDayExtras(v), foods: v.foods.slice(0, 500).map(cleanEntry) };
  }
  const wasDemo = S.demo;
  S = { demo: false, profile: cleanProfile(x.profile), days: wasDemo ? days : { ...S.days, ...days }, custom: Array.isArray(x.custom) ? cleanCustom(x.custom) : wasDemo ? [] : S.custom };
  clearSessionData();
  cursor = today();
  touchAll();
  render();
}
function clearSessionData() {
  clearUndo(); clip = null; editing = null; servState = null; productCache.clear(); confirmPhoto = "";
  photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls = [];
  if (!$("#dlg")?.open) M = null;
}

/* Keep Log on the current day after the app resumes */
let watchedDay = "";
function syncToday() {
  const now = today();
  if (now === watchedDay) return;
  if (cursor === watchedDay) cursor = now;
  watchedDay = now;
  if (!$("#dlg")?.open) render();
}
function startDayWatch() {
  watchedDay = today();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncToday(); });
  addEventListener("focus", syncToday);
  addEventListener("pageshow", syncToday);
  setInterval(() => { if (!document.hidden) syncToday(); }, 30000);
}

/* Targets stay attached to the dates they were used */
function syncPlanHistory() {
  const p = S.profile; if (S.demo || !p?.plan) return;
  const h = p.planHistory || (p.planHistory = []), week = p.mode === "off" ? null : safeWeek(p.week) || null, entry = { kcal: p.plan.kcal, p: p.plan.p, c: p.plan.c, f: p.plan.f, week };
  const same = a => a && a.kcal === entry.kcal && a.p === entry.p && a.c === entry.c && a.f === entry.f && JSON.stringify(a.week || null) === JSON.stringify(week);
  if (!h.length) { h.push({ from: "0000-00-00", ...entry }); return; }
  if (same(h[h.length - 1])) return;
  const from = today();
  if (h[h.length - 1].from === from) h[h.length - 1] = { from, ...entry };
  else h.push({ from, ...entry });
}
function planForDate(date) {
  const p = S.profile, current = { ...p.plan, week: p.mode === "off" ? null : p.week };
  if (date >= today() || !p.planHistory?.length) return current;
  let found = null;
  for (const h of p.planHistory) if (h.from <= date) found = h;
  return found ? { ...p.plan, kcal: found.kcal, p: found.p, c: found.c, f: found.f, week: found.week } : current;
}

/* Tracking-only mode */
const coachingOff = () => S.profile?.mode === "off";
function trackingPlan() {
  const p = S.profile;
  if (p.useTargets && p.manual) return { ...p.manual, setOn: today(), floored: false };
  return { kcal: 0, p: 0, c: 0, f: 0, setOn: today(), floored: false };
}
function syncCoachFields() {
  const sw = $("#coachSwitch"); if (!sw) return;
  const off = sw.value === "off";
  document.querySelectorAll(".coachOnly").forEach(el => { el.hidden = off; el.querySelectorAll("input,select").forEach(i => { i.disabled = off; }); });
  const w = $("#kg"); if (w) { w.required = !off; w.placeholder = off ? "Optional" : ""; }
}
function targetsPanel(g, e, setupMode) {
  const off = !setupMode && coachingOff();
  if (off && !g.kcal) return `<section class="label"><h2>Tracking</h2><div class="cal"><div><b style="font:800 16px var(--display)">Coaching</b></div><b style="font-size:30px">Off</b></div><p class="muted" style="margin:9px 0 0;font-size:13px">Tare is recording calories and macros without daily targets. Add targets on this screen if you want them.</p></section>`;
  return `<section class="label"><h2>Targets</h2><div class="cal"><div><b style="font:800 16px var(--display)">Calories</b></div><b>${fmt(g.kcal)}</b></div><div class="row"><b>Protein</b><span class="mono">${g.p} g</span></div><div class="row"><b>Carbs</b><span class="mono">${g.c} g</span></div><div class="row"><b>Fat</b><span class="mono">${g.f} g</span></div>${off ? "" : `<div class="row"><span>Expenditure</span><span class="mono">${fmt(e.tdee)} kcal</span></div>`}<p class="muted" style="margin:9px 0 0;font-size:13px">${off ? "Your own targets. Coaching is off, so Tare will not change them." : `Set ${esc(short(g.setOn))}. ${g.floored ? "Held at the minimum calorie floor. Consider a slower rate." : "Check-ins run every 7 days."}`}</p></section>`;
}
function trackingTargets() {
  const p = S.profile, m = p.manual || { kcal: "", p: "", c: "", f: "" }, on = !!p.useTargets;
  return `<form class="card form" data-form="tracktargets"><h2 class="full">Daily targets</h2><label class="full" style="display:flex;align-items:center;gap:8px"><input id="useTargets" name="use" type="checkbox" style="width:auto" ${on ? "checked" : ""}>Show my own calorie and macro targets</label>
  <div class="full form" id="trackTargetRow" ${on ? "" : "hidden"}><label class="half">Calories<input id="tk" name="kcal" type="number" min="1" max="8000" value="${esc(m.kcal)}" ${on ? "" : "disabled"}></label><label class="half">Protein (g)<input id="tp" name="p" type="number" min="0" max="500" value="${esc(m.p)}" ${on ? "" : "disabled"}></label><label class="half">Carbs (g)<input id="tc" name="c" type="number" min="0" max="1000" value="${esc(m.c)}" ${on ? "" : "disabled"}></label><label class="half">Fat (g)<input id="tf" name="f" type="number" min="0" max="400" value="${esc(m.f)}" ${on ? "" : "disabled"}></label></div>
  <p class="err full" id="trackErr" hidden></p><div class="full"><button class="btn primary">Save targets</button></div></form>`;
}

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
  const { week, ...g } = planForDate(date);
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
  if (p.mode === "off" || !p.goalKg) return "";
  const now = latestTrend(), gap = p.goalKg - now, e = estimate();
  if (Math.abs(gap) < .25) return "You are at your goal weight.";
  const perWeek = e.conf >= .3 ? e.rate * 7 : p.goal / 100 * now;
  if (!perWeek || Math.sign(perWeek) !== Math.sign(gap)) return `${toUser(Math.abs(gap)).toFixed(1)} ${unit()} to go. Your current trend is not moving toward this goal.`;
  const weeks = gap / perWeek, date = add(today(), Math.round(weeks * 7));
  return `${toUser(Math.abs(gap)).toFixed(1)} ${unit()} to go. Estimated arrival: ${parse(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.`;
}
function planExtras() {
  if (coachingOff()) return trackingTargets();
  const p = S.profile, m = p.manual || p.plan, week = p.week || Array(7).fill("normal"), mode = p.mode || "coached", eta = goalEta();
  return `<form class="card form" data-form="coach"><h2 class="full">Macro program</h2>
  <label>Coaching mode<select id="pmode" name="mode">${opt("coached", "Coached", mode)}${opt("collab", "Collaborative", mode)}${opt("manual", "Manual", mode)}</select></label>
  <label>Diet style<select id="pdiet" name="diet">${opt("balanced", "Balanced", p.diet || "balanced")}${opt("lowcarb", "Low-carb", p.diet)}${opt("keto", "Keto", p.diet)}${opt("carb", "Carb-focused", p.diet)}</select></label>
  <label class="full">Goal weight (${unit()}, optional)<input id="pgoal" name="goalWeight" type="number" inputmode="decimal" step="0.1" min="20" max="1000" value="${p.goalKg ? toUser(p.goalKg).toFixed(1) : ""}"></label>
  ${eta ? `<p class="muted full" style="margin:0">${esc(eta)}</p>` : ""}
  <label class="full" id="nudgeRow" ${mode === "collab" ? "" : "hidden"}>Adjust coach's calories (-300 to +300)<input id="pnudge" name="nudge" type="number" step="10" min="-300" max="300" value="${num(p.nudge)}"></label>
  <div class="full form" id="manualRow" ${mode === "manual" ? "" : "hidden"}><label class="half">Calories<input id="mk" name="mk" type="number" min="800" max="8000" value="${m.kcal}" ${mode === "manual" ? "" : "disabled"}></label><label class="half">Protein (g)<input id="mp" name="mp" type="number" min="0" max="500" value="${m.p}" ${mode === "manual" ? "" : "disabled"}></label><label class="half">Carbs (g)<input id="mc" name="mc" type="number" min="0" max="1000" value="${m.c}" ${mode === "manual" ? "" : "disabled"}></label><label class="half">Fat (g)<input id="mf" name="mf" type="number" min="0" max="400" value="${m.f}" ${mode === "manual" ? "" : "disabled"}></label></div>
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
  if (v.period) o.period = true;
  if (v.m && typeof v.m === "object") { const m = {}; for (const [k] of MEASURES) if (num(v.m[k]) > 0) m[k] = clamp(num(v.m[k]), 1, 400); if (Object.keys(m).length) o.m = m; }
  return o;
}
/* Autocomplete search */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}
const searchTokens = text => String(text).toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);
// Plural and singular forms share a stem, so "eggs" finds "Egg, large" and "blueberry" finds "Blueberries".
function stemWord(w) {
  if (w.length < 4) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "i";
  if (w.endsWith("ie")) return w.slice(0, -2) + "i";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "i";
  if (/(oes|ches|shes|xes|sses|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !/(ss|us)$/.test(w)) return w.slice(0, -1);
  return w;
}
function searchQuery(text) {
  const whole = String(text || "").trim().toLowerCase(), words = searchTokens(whole), stems = words.map(stemWord);
  return { whole, words, stems, phrase: stems.join(" ") };
}
function fuzzyHit(word, tokens) {
  const max = word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0;
  return !!max && tokens.some(t => editDistance(word, t, max) <= max || editDistance(word, t.slice(0, word.length), max) <= max);
}
// Whole words beat prefixes, and a match on the first word of a name beats one later in it.
function matchScore(lower, tokens, stems, joined, q, fuzzy) {
  let score = lower.startsWith(q.whole) || joined.startsWith(q.phrase) ? 40 : 0;
  for (let i = 0; i < q.words.length; i++) {
    const w = q.words[i], st = q.stems[i];
    if (tokens[0] === w || stems[0] === st) score += 70;
    else if (tokens[0]?.startsWith(w)) score += 45;
    else if (tokens.includes(w) || stems.includes(st)) score += 35;
    else if (tokens.some(t => t.startsWith(w))) score += 25;
    else if (lower.includes(w)) score += 10;
    else if (fuzzy && fuzzyHit(w, tokens)) score += 4;
    else return null;
  }
  return score;
}
function scoreFood(name, q) {
  const lower = String(name).toLowerCase(), tokens = searchTokens(lower), stems = tokens.map(stemWord);
  const score = matchScore(lower, tokens, stems, stems.join(" "), q, true);
  return score == null ? null : score - Math.min(lower.length, 40) / 10;
}
function rankFoods(query) {
  const q = searchQuery(query);
  if (!q.words.length) return [];
  const usual = smartFoods(M.meal, 60), boost = new Map(usual.map((f, i) => [f.name, 26 - Math.min(i, 20)])), seen = new Set(), ranked = [];
  for (const food of [...S.custom, ...usual.filter(f => !foodDbNames.has(f.name)), ...FOODS]) {
    const plain = `n:${food.name}|${food.serv}`, key = food.barcode ? `b:${food.barcode}` : plain;
    if (seen.has(key)) continue;
    seen.add(key); seen.add(plain);
    const base = scoreFood(food.name, q);
    // Saved foods and Tare's everyday list come with sensible servings, so they edge out similar USDA rows.
    if (base != null) ranked.push({ food, score: base + (boost.get(food.name) || 0) + (S.custom.includes(food) ? 8 : FOODS.includes(food) ? 12 : 0) });
  }
  for (const { entry, score } of searchFoodDb(q)) {
    const food = dbFood(entry), key = `n:${food.name}|${food.serv}`;
    if (!seen.has(key)) { seen.add(key); ranked.push({ food, score: score + (boost.get(food.name) || 0) }); }
  }
  return ranked.sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name)).slice(0, 30).map(x => x.food);
}
const foodKey = f => f.barcode ? `b:${f.barcode}` : `n:${f.name}|${f.serv}`;
function highlightName(name, query = M?.q) {
  const text = String(name), lower = text.toLowerCase(), marks = new Array(text.length).fill(false);
  for (const typed of searchTokens(query || "")) {
    const stem = stemWord(typed), word = lower.includes(typed) || !lower.includes(stem) ? typed : stem;
    const at = lower.search(new RegExp(`(^|[^a-z0-9%])${word.replace(/[%]/g, "\\$&")}`));
    const start = at < 0 ? lower.indexOf(word) : at + (/[a-z0-9%]/.test(lower[at]) ? 0 : 1);
    if (start >= 0) marks.fill(true, start, start + word.length);
  }
  let out = "", open = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] !== open) { out += marks[i] ? "<mark>" : "</mark>"; open = marks[i]; }
    out += esc(text[i]);
  }
  return out + (open ? "</mark>" : "");
}
function smartFoods(meal, limit = 10) {
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
  return [...score.values()].sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.f);
}
/* On-device USDA food database. Searches never leave the phone. */
let foodDb = null, foodDbNames = new Map(), foodDbLoad = null, foodDbFailed = false;
function dbFood(entry) {
  if (entry.food) return entry.food;
  const r = entry.row, n = {};
  MICROS.forEach((m, i) => { const v = r[7 + i]; if (v != null) n[m.k] = v; });
  return entry.food = { name: r[0], serv: "100 g", kcal: r[1], p: r[2], c: r[3], f: r[4], ...(Object.keys(n).length ? { n } : {}), db: true, portion: r[5] || "", portionGrams: r[6] || 0 };
}
function foodDbMessage() {
  if (foodDb) return `${fmt(foodDb.length)} USDA foods are saved on this phone.`;
  return foodDbFailed ? "The food database is not saved yet. Connect once, then reopen Tare." : "Loading the food database.";
}
function refreshFoodSearch() {
  const status = $("#foodDbStatus"), results = $("#res");
  if (status) status.textContent = foodDbMessage();
  if (results && M?.tab === "search") results.innerHTML = resultsHTML();
}
function loadFoodDb() {
  if (foodDb) return Promise.resolve(foodDb);
  return foodDbLoad || (foodDbLoad = fetch("foods.json").then(r => { if (!r.ok) throw new Error("food database"); return r.json(); }).then(data => {
    if (!Array.isArray(data.foods)) throw new Error("food database");
    foodDb = data.foods.map(row => { const tokens = searchTokens(row[0]), stems = tokens.map(stemWord); return { row, lower: String(row[0]).toLowerCase(), tokens, stems, joined: stems.join(" "), food: null }; });
    foodDbNames = new Map(foodDb.map(e => [e.row[0], e]));
    foodDbFailed = false;
    refreshFoodSearch();
    return foodDb;
  }).catch(e => { foodDbLoad = null; foodDbFailed = true; refreshFoodSearch(); throw e; }));
}
// Everyday versions of foods appear before less common USDA variations.
const COMMON_DB_FOODS = new Set(["rice, white, long-grain, regular, enriched, cooked", "rice, brown, long-grain, cooked (includes foods for usda's food distribution program)", "egg, whole, raw, fresh", "egg, whole, cooked, hard-boiled", "chicken, broilers or fryers, breast, meat only, cooked, roasted", "fish, salmon, atlantic, farmed, cooked, dry heat", "sweet potato, cooked, baked in skin, flesh, without salt", "potatoes, baked, flesh and skin, without salt", "milk, whole, 3.25% milkfat, with added vitamin d", "milk, reduced fat, fluid, 2% milkfat, with added vitamin a and vitamin d", "oil, olive, salad or cooking", "butter, salted", "bread, white, commercially prepared (includes soft bread crumbs)", "bread, whole-wheat, commercially prepared", "pasta, cooked, enriched, without added salt", "beef, ground, 90% lean meat / 10% fat, patty, cooked, broiled", "beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled", "apples, gala, with skin, raw", "oranges, raw, all commercial varieties", "avocados, raw, all commercial varieties", "broccoli, cooked, boiled, drained, without salt", "spinach, raw", "tomatoes, red, ripe, raw, year round average", "peanut butter, smooth style, without salt", "yogurt, greek, plain, nonfat", "bananas, raw"]);
const PROCESSED_FOOD = /\b(dehydrated|powder|dry mix|mix|meatless|imitation|substitute|formulated|babyfood|concentrate|frozen mixture)\b/;
const RESTAURANT_FOOD = /\b(restaurant|fast foods?|mcdonald'?s|burger king|kfc|wendy'?s|subway|taco bell|pizza hut|domino'?s|papa john'?s|denny'?s|applebee'?s|popeyes|chick-fil-a|carl'?s jr|dairy queen|starbucks|panera)\b/;
const BRAND_NAME = /\b(?!USDA)[A-Z][A-Z'&-]{3,}/;
function quickFoodScore(entry, q) {
  return matchScore(entry.lower, entry.tokens, entry.stems, entry.joined, q, false);
}
function adjustFoodScore(entry, score, q) {
  const commas = (entry.lower.match(/,/g) || []).length, odd = entry.lower.match(PROCESSED_FOOD);
  let out = score - Math.min(entry.lower.length, 60) / 10 - commas * 1.2 + (/\braw\b/.test(entry.lower) ? 6 : 0);
  // The everyday version wins only when its main word is what was searched, so "sal" does not surface salted butter.
  if (COMMON_DB_FOODS.has(entry.lower) && (entry.tokens[0]?.startsWith(q.words[0]) || entry.stems[0] === q.stems[0])) out += 130;
  if (RESTAURANT_FOOD.test(entry.lower) && !RESTAURANT_FOOD.test(q.whole)) out -= 10;
  if (BRAND_NAME.test(entry.row[0])) out -= 10;
  if (odd && !q.whole.includes(odd[1])) out -= 8;
  return out;
}
function searchFoodDb(q) {
  if (!foodDb) return [];
  let found = [];
  for (const entry of foodDb) { const score = quickFoodScore(entry, q); if (score != null) found.push({ entry, score: adjustFoodScore(entry, score, q) }); }
  if (found.length < 6 && q.words.some(w => w.length >= 4)) {
    const have = new Set(found.map(x => x.entry));
    for (const entry of foodDb) { if (have.has(entry)) continue; const score = matchScore(entry.lower, entry.tokens, entry.stems, entry.joined, q, true); if (score != null) found.push({ entry, score: adjustFoodScore(entry, score, q) - 10 }); }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 40);
}
function dbChooserHTML(f) {
  return `<div class="dbamount"><label>Amount<input id="qty" type="number" inputmode="decimal" min="0.01" step="any" value="100"></label><label>Unit<select id="qtyUnit"><option value="g">grams</option><option value="oz">ounces</option>${f.portion && f.portionGrams ? `<option value="portion">${esc(f.portion)} (${f.portionGrams} g)</option>` : ""}</select></label></div><div class="chooser dbchoice"><span><b>${esc(f.name)}</b><br><span class="muted mono" id="qtyInfo"></span></span><button class="btn primary" data-act="addsel">Add</button></div><div id="microInfo"></div>`;
}
function dbGrams() {
  const amount = num($("#qty")?.value), unitName = $("#qtyUnit")?.value;
  return unitName === "oz" ? amount * SERVING_UNITS.oz : unitName === "portion" ? amount * M.sel.portionGrams : amount;
}
function updateDbAmount() {
  const f = M.sel, factor = Math.max(0, dbGrams()) / 100, el = $("#qtyInfo");
  if (el) el.textContent = `${fmt(f.kcal * factor)} kcal · ${Math.round(f.p * factor)}P ${Math.round(f.c * factor)}C ${Math.round(f.f * factor)}F`;
  setMicroPanel("#microInfo", f.n, factor);
}
function addDbFood() {
  const f = M.sel, grams = dbGrams(), amount = num($("#qty").value), unitName = $("#qtyUnit").value;
  if (!(grams > 0)) return false;
  const factor = grams / 100, shown = +amount.toFixed(2), serv = unitName === "portion" ? `${shown} × ${f.portion} (${+grams.toFixed(1)} g)` : `${shown} ${unitName}`;
  addEntry({ name: f.name, serv, kcal: f.kcal * factor, p: f.p * factor, c: f.c * factor, f: f.f * factor, ...(f.n ? { n: scaleN(f.n, factor) } : {}) }, 1);
  return true;
}
function searchTools() {
  return `<p class="muted" id="foodDbStatus" role="status" style="margin:0;font-size:13px">${esc(foodDbMessage())}</p>`;
}

/* Nutrition label scanner */
function loadOCR() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return ocrLoad || (ocrLoad = new Promise((res, rej) => { const s = document.createElement("script"); s.src = OCR.script; s.integrity = OCR.scriptIntegrity; s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer"; s.onload = () => res(window.Tesseract); s.onerror = () => { ocrLoad = null; s.remove(); rej(new Error("ocr")); }; document.head.append(s); }));
}
function parseLabel(raw) {
  const text = String(raw || "").replace(/[|]/g, " ").replace(/\r/g, ""), lines = text.split("\n");
  const fix = s => { const v = String(s).replace(/[Oo]/g, "0").replace(/[lI]/g, "1"); return Number(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v) ? v.replace(/,/g, "") : v.replace(/,/g, ".")); };
  const grab = (re, line = false) => { for (const l of line ? lines : [text]) { const m = l.match(re); if (m) { const v = fix(m[1]); if (Number.isFinite(v)) return v; } } return null; };
  const unitFix = (v, u) => v == null ? null : /^mcg|^ug|^µg/i.test(u || "") ? v / 1000 : /^g/i.test(u || "") ? v * 1000 : v;
  const mg = re => { const m = text.match(re); return m ? unitFix(fix(m[1]), m[2]) : null; };
  const out = {
    serv: (text.match(/serving size[:\s]*([^\n]{1,32})/i)?.[1] || "1 serving").trim(),
    kcal: grab(/calories(?!\s*from)[^\d\n]{0,12}(\d{1,3},\d{3}|[\dOo]{1,4})/i, true) ?? grab(/energy[^\n]*?([\d]{1,4})\s*kcal/i, true),
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
/* Serving amount scaling */
const SERVING_UNITS = { g: 1, ml: 1, oz: 28.3495 };
let servState = null;
function parseServing(text) {
  const hits = [...String(text || "").matchAll(/(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)\s*(kg|grams?|g|ml|l|oz)\b/gi)].map(m => {
    const raw = m[1], v = Number(/^\d{1,3}(,\d{3})+/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", ".")), u = m[2].toLowerCase();
    if (u === "kg") return { amt: v * 1000, unit: "g" };
    if (u === "l") return { amt: v * 1000, unit: "ml" };
    return { amt: v, unit: u.startsWith("g") ? "g" : u };
  }).filter(x => x.amt > 0);
  return hits.find(x => x.unit !== "oz") || hits[0] || null;
}
const servIds = () => $("#sserv") ? { s: "#sserv", k: "#sk", p: "#sp", c: "#sc", f: "#sf" } : $("#cserv") ? { s: "#cserv", k: "#ck", p: "#cp", c: "#cc", f: "#cf" } : null;
const servGrams = () => { const a = num($("#servAmt")?.value), u = $("#servUnit")?.value; return a > 0 && SERVING_UNITS[u] ? a * SERVING_UNITS[u] : 0; };
const roundAmount = v => String(+Number(v).toFixed(2));
function readServingBase() { const x = servState.ids; servState.base = { g: servState.curG || servGrams(), k: num($(x.k).value), p: num($(x.p).value), c: num($(x.c).value), f: num($(x.f).value) }; }
function initServing() {
  const ids = servIds();
  if (!ids) { servState = null; return; }
  const text = $(ids.s);
  if (!$("#servAmt")) {
    text.type = "hidden";
    const row = document.createElement("span");
    row.className = "servrow";
    row.innerHTML = `<input id="servAmt" type="number" inputmode="decimal" min="0" step="any" placeholder="Amount" aria-label="Serving amount"><select id="servUnit" aria-label="Serving unit"><option value="g">g</option><option value="ml">ml</option><option value="oz">oz</option></select>`;
    text.after(row);
    for (const key of ["k", "p", "c", "f"]) $(ids[key]).dataset.servMacro = "1";
  }
  const parsed = parseServing(text.value);
  $("#servAmt").value = parsed ? roundAmount(parsed.amt) : "";
  $("#servUnit").value = parsed?.unit || "g";
  const startG = parsed ? parsed.amt * SERVING_UNITS[parsed.unit] : 0;
  servState = { ids, origG: startG, curG: startG, base: null };
  readServingBase();
  mountFormMicros();
}
function applyServingAmount() {
  if (!servState) return;
  const g = servGrams(), x = servState.ids;
  if (!(g > 0)) return;
  servState.curG = g;
  $(x.s).value = `${roundAmount($("#servAmt").value)} ${$("#servUnit").value}`;
  if (!servState.origG) servState.origG = g;
  if (!servState.base.g) { servState.base.g = g; return; }
  const factor = g / servState.base.g, b = servState.base, filled = id => $(id).value !== "";
  if (filled(x.k)) $(x.k).value = Math.round(b.k * factor);
  for (const key of ["p", "c", "f"]) if (filled(x[key])) $(x[key]).value = +(b[key] * factor).toFixed(1);
}
function changeServingUnit(el) {
  if (!servState) return;
  const amt = $("#servAmt");
  if (servState.curG > 0 && amt.value !== "") {
    amt.value = roundAmount(servState.curG / SERVING_UNITS[el.value]);
    $(servState.ids.s).value = `${amt.value} ${el.value}`;
  }
}
function scaledMicros(n) {
  if (!n) return n;
  return servState?.origG > 0 && servState.curG > 0 ? scaleN(n, servState.curG / servState.origG) : n;
}
function afterDlg() {
  fillLabelPrefill();
  initServing();
}
function fillLabelPrefill() {
  if (M?.tab !== "custom" || !M.prefill) return;
  const f = M.prefill, set = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
  set("#cserv", String(f.serv).slice(0, 40)); set("#ck", f.kcal); set("#cp", f.p); set("#cc", f.c); set("#cf", f.f);
  const form = $("[data-form=custom]");
  if (form && !$("#labelNote")) { const note = document.createElement("p"); note.id = "labelNote"; note.className = "warn full"; note.style.margin = "0"; note.textContent = "Read from your photo. Check every value against the label, then name the food."; form.prepend(note); }
  $("#cname")?.focus();
}

/* Recipes */
function recipeTotals(r) { const t = { kcal: 0, p: 0, c: 0, f: 0, n: {} }; for (const i of r.items) { for (const k of ["kcal", "p", "c", "f"]) t[k] += i.food[k] * i.qty; if (i.food.n) for (const k in i.food.n) t.n[k] = (t.n[k] || 0) + i.food.n[k] * i.qty; } return t; }
function recipeResults(r) {
  const q = r.q.trim(), found = q ? rankFoods(q).filter(f => !f.recipe).slice(0, 8) : [];
  M.recipeFound = found;
  return found.length ? `<div class="results">${found.map((f, i) => `<button type="button" class="result" data-pro="ringadd" data-i="${i}"><span class="fooditem">${foodIcon(f.name)}<span><b>${highlightName(f.name, q)}</b><small>${esc(f.serv)}</small></span></span><span class="mono">${fmt(f.kcal)}</span></button>`).join("")}</div>` : "";
}
function recipeBody() {
  const r = M.recipe || (M.recipe = { name: "", servings: 4, q: "", items: [] }), t = recipeTotals(r), s = Math.max(.1, num(r.servings, 1));
  return `<div class="form recipehead"><label>Recipe name<input id="rname" maxlength="70" value="${esc(r.name)}" placeholder="Turkey chili"></label><label>Servings made<input id="rserv" type="number" inputmode="decimal" min="0.5" step="0.5" value="${esc(r.servings)}"></label></div>
  <input id="rq" type="search" placeholder="Add an ingredient" aria-label="Add an ingredient" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" value="${esc(r.q)}">
  <div id="rRes">${recipeResults(r)}</div>
  ${r.items.length ? `<div class="stack" style="gap:6px">${r.items.map((it, i) => `<div class="chooser" style="grid-template-columns:76px minmax(0,1fr) auto"><input aria-label="Amount of ${esc(it.food.name)}" data-ring="${i}" type="number" inputmode="decimal" min="0.05" step="any" value="${it.qty}"><span><b>${esc(it.food.name)}</b><br><small class="muted">${it.food.db ? "× 100 g" : esc(it.food.serv)}</small></span><button type="button" class="iconbtn quiet" data-pro="ringdel" data-i="${i}" aria-label="Remove ${esc(it.food.name)}">${ICONS.close}</button></div>`).join("")}</div><p class="mono muted" id="rTotal" style="margin:0">Per serving: ${fmt(t.kcal / s)} kcal · ${Math.round(t.p / s)}P ${Math.round(t.c / s)}C ${Math.round(t.f / s)}F</p><p class="err" id="rErr" hidden></p><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" data-pro="rsave" data-add="1">Save and add 1 serving</button><button type="button" class="btn" data-pro="rsave">Save recipe</button></div>` : `<p class="muted" style="margin:0">Search above to add your first ingredient.</p>`}`;
}
function saveRecipe(addIt) {
  const r = M.recipe, name = String(r.name).trim(), s = num(r.servings), err = $("#rErr");
  if (!name || !(s > 0)) { if (err) { err.textContent = "Add a recipe name and a serving count."; err.hidden = false; } return; }
  const t = recipeTotals(r), n = {}; for (const k in t.n) n[k] = +(t.n[k] / s).toFixed(2);
  const food = { name: name.slice(0, 80), serv: "1 serving", kcal: Math.round(t.kcal / s), p: +(t.p / s).toFixed(1), c: +(t.c / s).toFixed(1), f: +(t.f / s).toFixed(1), recipe: true, ...(Object.keys(n).length ? { n } : {}) };
  S.custom = [food, ...S.custom.filter(c => c.barcode || c.name !== food.name)].slice(0, 300); touch();
  if (addIt) addEntry(food, 1);
  $("#dlg").close(); render();
}

/* Micronutrient details */
const MICRO_LIMITS = new Set(["sugar", "satfat", "sodium", "chol"]);
const microAmount = (v, m) => `${v >= 100 ? fmt(v) : v >= 10 ? Math.round(v) : +v.toFixed(1)} ${m.u}`;
function microRows(values, onlyKeys) {
  return MICROS.filter(m => !onlyKeys || onlyKeys.includes(m.k)).map(m => {
    const v = values[m.k], has = v != null, pct = has ? v / m.dv * 100 : 0, over = MICRO_LIMITS.has(m.k) && pct > 100;
    return `<div class="microrow"><span>${m.label}</span><b>${has ? microAmount(v, m) : "–"}</b><em>${has ? Math.round(pct) + "%" : ""}</em><div class="bar"><i style="width:${clamp(pct, 0, 100)}%;background:var(${over ? "--bad" : MICRO_LIMITS.has(m.k) ? "--fat" : "--carbs"})"></i></div></div>`;
  }).join("");
}
function setMicroPanel(selector, n, factor = 1) {
  const host = $(selector); if (!host) return;
  const open = !!host.querySelector("details")?.open, values = n ? scaleN(n, factor) : {}, count = Object.keys(values).length;
  host.innerHTML = count
    ? `<details class="micropanel" ${open ? "open" : ""}><summary>Micronutrients <span>${count} listed</span></summary><div class="microlist">${microRows(values, MICROS.filter(m => values[m.k] != null).map(m => m.k))}</div><p>Percentages use FDA Daily Values.</p></details>`
    : `<p class="micronone">No micronutrient data for this food.</p>`;
}
function currentFormMicros() {
  if ($("#editTotal")) return editing?.perN;
  if ($("#sserv")) { const foods = M?.scan?.food?.bases || [], id = $("#sbasis")?.value; return (foods.find(b => b.id === id) || foods[0])?.n; }
  return M?.prefill?.n;
}
function refreshFormMicros() {
  if (!$("#formMicro")) return;
  const q = num(($("#sqty") || $("#eqty"))?.value, 1) || 1;
  setMicroPanel("#formMicro", scaledMicros(currentFormMicros()), q);
}
function mountFormMicros() {
  if (!$("#sserv") && !$("#editTotal") && !M?.prefill) return;
  if (!$("#formMicro")) {
    const before = $("#scanWarn") || $("#editTotal") || $("[data-form=custom] .full:last-child");
    if (!before) return;
    const host = document.createElement("div"); host.id = "formMicro"; host.className = "full"; before.before(host);
  }
  refreshFormMicros();
}
let microsExpanded = false;
function microsCard(x) {
  const foods = x.foods || [], withData = foods.filter(e => e.n && Object.keys(e.n).length).length, totals = {};
  for (const e of foods) for (const k in e.n || {}) totals[k] = (totals[k] || 0) + num(e.n[k]);
  const keys = microsExpanded ? null : ["fiber", "sugar", "satfat", "sodium"];
  const note = !foods.length ? "Log food to see micronutrients." : !withData ? "None of today's foods include micronutrient data. Scanned products and labels usually do." : withData < foods.length ? `Based on ${withData} of ${foods.length} foods, so true totals may be higher.` : `Based on all ${foods.length} foods.`;
  return `<section class="card microcard"><div class="mealtitle"><h3>Micronutrients</h3><button class="link" data-pro="microtoggle" aria-expanded="${microsExpanded}">${microsExpanded ? "Show less" : "Show all"}</button></div><div class="microlist">${microRows(totals, keys)}</div><p class="micronote">${esc(note)}</p></section>`;
}

/* Manual macro goals */
function openGoals() {
  const p = S.profile, g = p.plan || {}, off = coachingOff(), manual = p.mode === "manual";
  M = { meal: "Goals", tab: "goals", q: "", sel: null, scan: { state: "idle" } };
  $("#dlg").setAttribute("aria-label", "Macro goals");
  const value = v => g.kcal ? v : "";
  $("#dlg").innerHTML = `<div class="dlgwrap"><div class="dlghead"><div class="mealhead"><h2>Macro goals</h2></div>${closeButton()}</div><div class="dlgbody"><form class="form" data-form="goals">
  <div class="full trio"><label>Protein (g)<input id="gp" name="p" type="number" inputmode="numeric" min="0" max="500" step="1" required value="${value(g.p)}"></label>
  <label>Carbs (g)<input id="gc" name="c" type="number" inputmode="numeric" min="0" max="1000" step="1" required value="${value(g.c)}"></label>
  <label>Fat (g)<input id="gf" name="f" type="number" inputmode="numeric" min="0" max="400" step="1" required value="${value(g.f)}"></label></div>
  <div class="goaltotal full"><span>Daily calories</span><b id="gKcal">0</b></div>
  ${off || manual ? "" : `<p class="warn full" style="margin:0">Saving switches coaching to Manual, so weekly check-ins will stop changing your targets. You can return to the coach here anytime.</p>`}
  <p class="err full" id="goalErr" hidden></p>
  <div class="full" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary">Save goals</button>${manual ? `<button type="button" class="btn" data-pro="goalscoach">Use coach targets</button>` : ""}${off && p.useTargets ? `<button type="button" class="btn danger" data-pro="goalsclear">Remove goals</button>` : ""}</div></form></div></div>`;
  $("#dlg").showModal();
  updateGoalTotal();
}
const goalCalories = () => Math.round(num($("#gp")?.value) * 4 + num($("#gc")?.value) * 4 + num($("#gf")?.value) * 9);
function updateGoalTotal() { const el = $("#gKcal"); if (el) el.textContent = fmt(goalCalories()); }
function saveGoals(d) {
  const p = S.profile, manual = { p: Math.round(num(d.get("p"))), c: Math.round(num(d.get("c"))), f: Math.round(num(d.get("f"))) };
  manual.kcal = manual.p * 4 + manual.c * 4 + manual.f * 9;
  if (manual.kcal < 800) { const err = $("#goalErr"); err.textContent = "These goals add up to under 800 calories. Raise at least one macro."; err.hidden = false; return; }
  p.manual = manual;
  if (coachingOff()) { p.useTargets = true; p.plan = trackingPlan(); }
  else { if (p.mode !== "manual") p.lastCoachMode = p.mode || "coached"; p.mode = "manual"; p.plan = targets(); }
  touch(); $("#dlg").close(); render();
}

/* Log dashboard */
const svgIcon = body => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICONS = {
  back: svgIcon('<path d="m15 18-6-6 6-6"/>'),
  next: svgIcon('<path d="m9 18 6-6-6-6"/>'),
  plus: svgIcon('<path d="M12 5v14M5 12h14"/>'),
  scan: svgIcon('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M8 8v8M12 8v8M16 8v8"/>'),
  copy: svgIcon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4V6a2 2 0 0 1 2-2h9v1"/>'),
  close: svgIcon('<path d="M18 6 6 18M6 6l12 12"/>')
};
// Back, forward, and close are round buttons kept on the right edge of the screen.
const closeButton = () => `<button type="button" class="edgebtn dlgclose" data-act="close" aria-label="Close">${ICONS.close}</button>`;
function dateHeader(step, unitLabel) {
  const isToday = cursor === today();
  return `<div class="today-head"><div class="titlebox"><h1>${esc(long(cursor))}</h1>${isToday ? "" : `<button type="button" class="link backtoday" data-pro="gotoday">Back to today</button>`}</div><div class="weeknav"><button type="button" class="edgebtn" data-act="day" data-n="${-step}" aria-label="Previous ${unitLabel}">${ICONS.back}</button><button type="button" class="edgebtn" data-act="day" data-n="${step}" aria-label="Next ${unitLabel}" ${isToday ? "disabled" : ""}>${ICONS.next}</button></div></div>`;
}
function dayChip(d) {
  const g = dayPlan(d), kcal = totals(d).kcal, r = 13, len = 2 * Math.PI * r, pct = g.kcal ? Math.min(1, kcal / g.kcal) : kcal > 0 ? 1 : 0, over = g.kcal && kcal > g.kcal * 1.05, date = parse(d), future = d > today();
  return `<button class="daychip" data-pro="goday" data-d="${d}" ${d === cursor ? 'aria-current="date"' : ""} ${future ? "disabled" : ""} aria-label="${esc(date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}"><span>${DAY_NAMES[date.getDay()].slice(0, 1)}</span><span class="daywrap"><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="${r}" fill="none" stroke="var(--raised)" stroke-width="3"/>${pct ? `<circle cx="16" cy="16" r="${r}" fill="none" stroke="var(${over ? "--bad" : "--ink"})" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(pct * len).toFixed(1)} ${len.toFixed(1)}"/>` : ""}</svg><b>${date.getDate()}</b></span></button>`;
}
function macroColumn(name, value, goal, color) {
  const pct = goal ? clamp(value / goal * 100, 0, 100) : 0;
  return `<div class="macrocol"><span>${name}</span><b>${Math.round(value)}<small>${goal ? ` / ${goal} g` : " g"}</small></b>${goal ? `<div class="bar"><i style="width:${pct}%;background:var(${color})"></i></div>` : ""}</div>`;
}
const mealsOff = () => S.profile?.hideMeals === true;
function mealForNow() { const h = new Date().getHours(); return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 21 ? "Dinner" : "Snacks"; }
const byTime = list => list.slice().sort((a, b) => (a.t || "").localeCompare(b.t || ""));
function entryRow(e) {
  return `<div class="entry"><button class="entrymain" data-pro="editentry" data-id="${esc(e.id)}" aria-label="Edit ${esc(e.name)}"><span class="fooditem">${foodIcon(e.name)}<span><b>${esc(e.name)}</b><small>${e.t ? esc(clockLabel(e.t)) + " · " : ""}${e.qty !== 1 ? esc(e.qty) + " × " : ""}${esc(e.serv)} · ${Math.round(e.p)}P ${Math.round(e.c)}C ${Math.round(e.f)}F</small></span></span></button><span class="entrykcal">${fmt(e.kcal)}</span><button class="iconbtn quiet" data-pro="copyentry" data-id="${esc(e.id)}" aria-label="Copy ${esc(e.name)}">${ICONS.copy}</button><button class="iconbtn quiet" data-act="remove" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">${ICONS.close}</button></div>`;
}
function flatFoodCard(x) {
  const foods = x.foods, sum = k => foods.reduce((a, e) => a + e[k], 0), meal = mealForNow();
  const paste = clip && clip.type !== "day" ? `<div class="mealtools"><button class="link" data-pro="pasteflat">Paste ${clip.items.length === 1 ? "food" : clip.items.length + " foods"}</button></div>` : "";
  return `<section class="card mealcard"><div class="mealtitle"><div><h3>Food</h3><p>${foods.length ? `${fmt(sum("kcal"))} kcal · ${Math.round(sum("p"))}P ${Math.round(sum("c"))}C ${Math.round(sum("f"))}F` : "Nothing logged"}</p></div><div class="mealactions"><button class="iconbtn soft" data-act="add" data-meal="${meal}" data-tab="scan" aria-label="Scan food">${ICONS.scan}</button><button class="iconbtn add" data-act="add" data-meal="${meal}" aria-label="Add food">${ICONS.plus}</button></div></div>${byTime(foods).map(entryRow).join("")}${paste}</section>`;
}
function logLayoutCard() {
  return `<section class="card stack"><h2>Log layout</h2><label style="display:flex;align-items:center;gap:10px"><input id="hideMeals" type="checkbox" ${mealsOff() ? "checked" : ""}>Use one food list instead of meals</label><p class="muted" style="margin:0;font-size:13px">Breakfast, Lunch, Dinner, and Snacks will be hidden. Turn this off anytime to bring them back with your foods still sorted.</p><label style="display:flex;align-items:center;gap:10px"><input id="showFasting" type="checkbox" ${fastingOn() ? "checked" : ""}>Show the fasting timer on Log</label></section>`;
}
function logView() {
  const t = totals(cursor), g = dayPlan(cursor), left = g.kcal - t.kcal, x = peek(cursor), canCopy = !x.foods.length && peek(add(cursor, -1)).foods.length;
  const weekStart = add(cursor, -parse(cursor).getDay()), week = Array.from({ length: 7 }, (_, i) => add(weekStart, i));
  const r = 52, len = 2 * Math.PI * r, pct = g.kcal ? Math.min(1, t.kcal / g.kcal) : 0, hasWeight = weights(cursor).length > 0;
  const tools = dayTools(canCopy);
  return `${dateHeader(7, "week")}
  <div class="weekstrip">${week.map(dayChip).join("")}</div>
  <div class="dash"><div class="dash-side"><section class="card hero" aria-label="Daily totals">
    <button class="btn small herogoals" data-pro="goals">${g.kcal ? "Edit goals" : "Set goals"}</button>
    <div class="ringbox"><svg viewBox="0 0 120 120" role="img" aria-label="${fmt(t.kcal)} calories eaten"><circle class="ringtrack" cx="60" cy="60" r="${r}"/>${pct ? `<circle class="ringfill ${left < 0 ? "over" : ""}" cx="60" cy="60" r="${r}" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${(len * (1 - pct)).toFixed(1)}"/>` : ""}</svg><div class="ringtext"><b>${fmt(g.kcal ? Math.abs(left) : t.kcal)}</b><span>${!g.kcal ? "calories eaten" : left >= 0 ? "calories left" : "calories over"}</span></div></div>
    ${g.kcal ? `<div class="calstats"><div><b>${fmt(t.kcal)}</b><span>Eaten</span></div><div><b>${fmt(g.kcal)}</b><span>${esc(dayLabel(cursor))}</span></div></div>` : ""}
    <div class="macros">${macroColumn("Protein", t.p, g.p, "--protein")}${macroColumn("Carbs", t.c, g.c, "--carbs")}${macroColumn("Fat", t.f, g.f, "--fat")}</div>
  </section>
  <section class="card weighcard"><form class="weigh" data-form="weight"><div><b>Weight</b><span>${hasWeight ? `Trend ${toUser(latestTrend(cursor)).toFixed(1)} ${unit()}` : `Log in ${unit()}`}</span></div><input id="w" name="w" type="number" inputmode="decimal" step="0.1" min="20" max="1000" aria-label="Weight in ${unit()}" value="${x.w ? toUser(x.w).toFixed(1) : ""}" placeholder="0.0"><button class="btn small">Save</button></form></section>${fastingOn() ? fastCard() : ""}${microsCard(x)}</div>
  <div class="dash-log">${tools ? `<div class="daytools">${tools}</div>` : ""}
  ${mealsOff() ? flatFoodCard(x) : MEALS.map(m => {
    const es = x.foods.filter(e => e.meal === m), sum = k => es.reduce((a, e) => a + e[k], 0);
    return `<section class="card mealcard"><div class="mealtitle"><div><h3>${m}</h3><p>${es.length ? `${fmt(sum("kcal"))} kcal · ${Math.round(sum("p"))}P ${Math.round(sum("c"))}C ${Math.round(sum("f"))}F` : "Nothing logged"}</p></div><div class="mealactions"><button class="iconbtn soft" data-act="add" data-meal="${m}" data-tab="scan" aria-label="Scan food for ${m}">${ICONS.scan}</button><button class="iconbtn add" data-act="add" data-meal="${m}" aria-label="Add food to ${m}">${ICONS.plus}</button></div></div>
    ${byTime(es).map(entryRow).join("")}${mealTools(m, es)}</section>`;
  }).join("")}
  ${coachingOff() ? "" : `<label class="card skipcard"><input id="skip" type="checkbox" data-change="skip" ${x.skip ? "checked" : ""}>Leave this incomplete day out of my expenditure estimate</label>`}</div></div>`;
}

/* Edit logged foods */
let editing = null;
function openEdit(id) {
  const e = peek(cursor).foods.find(x => x.id === id);
  if (!e) return;
  // Per-serving values are rounded for reading. Unchanged fields keep the exact logged totals when saved.
  const q = e.qty > 0 ? e.qty : 1, per = x => +(num(x) / q).toFixed(1), shown = { qty: q, kcal: String(Math.round(num(e.kcal) / q)), p: String(per(e.p)), c: String(per(e.c)), f: String(per(e.f)) };
  M = { meal: e.meal, tab: "edit", q: "", sel: null, scan: { state: "idle" } };
  editing = { id, date: cursor, perN: e.n ? scaleN(e.n, 1 / q) : undefined, confirmDelete: false, shown };
  $("#dlg").setAttribute("aria-label", "Edit food");
  $("#dlg").innerHTML = `<div class="dlgwrap"><div class="dlghead"><div class="mealhead"><h2>Edit food</h2></div>${closeButton()}</div><div class="dlgbody"><form class="form" data-form="editentry">
  <label class="full">Name<input id="ename" name="name" required maxlength="100" value="${esc(e.name)}"></label>
  <label class="half" ${mealsOff() ? "hidden" : ""}>Meal<select id="emeal" name="meal">${MEALS.map(m => opt(m, m, e.meal)).join("")}</select></label>
  <label class="half">Date<input id="edate" name="date" type="date" required max="${today()}" value="${esc(cursor)}"></label>
  <label class="${mealsOff() ? "half" : "full"}">Time<input id="etime" name="time" type="time" value="${esc(e.t || "")}"></label>
  <label class="half">Serving<input id="cserv" name="serv" required maxlength="50" value="${esc(e.serv)}"></label>
  <label class="half">Servings eaten<input id="eqty" name="qty" type="number" min="0.01" step="any" inputmode="decimal" required value="${q}"></label>
  <label class="half">Calories per serving<input id="ck" name="kcal" type="number" min="0" step="any" inputmode="decimal" required value="${shown.kcal}"></label>
  <label class="half">Protein (g)<input id="cp" name="p" type="number" min="0" step="any" inputmode="decimal" required value="${shown.p}"></label>
  <label class="half">Carbs (g)<input id="cc" name="c" type="number" min="0" step="any" inputmode="decimal" required value="${shown.c}"></label>
  <label class="half">Fat (g)<input id="cf" name="f" type="number" min="0" step="any" inputmode="decimal" required value="${shown.f}"></label>
  <p class="mono muted full" id="editTotal" style="margin:0"></p><p class="err full" id="editErr" hidden></p>
  <div class="full" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary">Save changes</button><button type="button" class="btn danger" id="editDelete" data-pro="editdel">Delete food</button></div></form></div></div>`;
  $("#dlg").showModal();
  initServing();
  updateEditTotal();
}
function updateEditTotal() {
  const el = $("#editTotal"); if (!el) return;
  const q = num($("#eqty").value), v = id => num($(id).value) * q;
  el.textContent = `Total: ${fmt(v("#ck"))} kcal · ${Math.round(v("#cp"))}P ${Math.round(v("#cc"))}C ${Math.round(v("#cf"))}F`;
}
function saveEdit(d) {
  const err = $("#editErr"), fail = text => { err.textContent = text; err.hidden = false; };
  const from = peek(editing.date), index = from.foods.findIndex(x => x.id === editing.id), date = String(d.get("date")), qty = num(d.get("qty")), name = String(d.get("name")).trim();
  if (index < 0) return fail("This food is no longer in your log.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return fail("Choose today or a past date.");
  if (!(qty > 0) || !name) return fail("Enter a name and a serving count.");
  const e = from.foods[index], perN = scaledMicros(editing.perN), same = k => qty === editing.shown?.qty && String(d.get(k)) === editing.shown[k];
  const total = (k, round) => same(k) ? e[k] : round(num(d.get(k)) * qty), tenth = v => +v.toFixed(1);
  const next = { ...e, name: name.slice(0, 100), serv: String(d.get("serv")).trim().slice(0, 50), qty, meal: MEALS.includes(d.get("meal")) ? d.get("meal") : e.meal, kcal: total("kcal", Math.round), p: total("p", tenth), c: total("c", tenth), f: total("f", tenth) };
  if (perN) next.n = scaleN(perN, qty); else delete next.n;
  const time = String(d.get("time") || ""); if (isClock(time)) next.t = time; else delete next.t;
  if (date === editing.date) from.foods[index] = next;
  else { from.foods.splice(index, 1); day(date).foods.push(next); }
  touch(date);
  const moved = date !== editing.date ? `Moved to ${short(date)}` : "";
  editing = null;
  $("#dlg").close();
  render();
  if (moved) setSave(moved);
}

/* Undo deleted foods */
const UNDO_MS = 10000;
let undoStack = [], undoTimer = null;
function showUndo() {
  const bar = $("#toast"); if (!bar) return;
  clearTimeout(undoTimer);
  const last = undoStack[undoStack.length - 1];
  if (!last) { bar.hidden = true; bar.replaceChildren(); return; }
  const text = document.createElement("span"), button = document.createElement("button");
  text.textContent = undoStack.length > 1 ? `Removed ${last.entry.name} (${undoStack.length} to undo)` : `Removed ${last.entry.name}`;
  button.type = "button"; button.dataset.pro = "undo"; button.textContent = "Undo";
  bar.replaceChildren(text, button);
  bar.hidden = false;
  undoTimer = setTimeout(clearUndo, UNDO_MS);
}
function clearUndo() { undoStack = []; clearTimeout(undoTimer); const bar = $("#toast"); if (bar) { bar.hidden = true; bar.replaceChildren(); } }
function removeEntry(date, id) {
  const x = day(date), index = x.foods.findIndex(e => e.id === id);
  if (index < 0) return;
  const [entry] = x.foods.splice(index, 1);
  undoStack.push({ date, index, entry });
  touch(date);
  render();
  showUndo();
}
function undoRemove() {
  const item = undoStack.pop(); if (!item) return;
  const x = day(item.date);
  x.foods.splice(Math.min(item.index, x.foods.length), 0, item.entry);
  cursor = item.date;
  touch(item.date);
  render();
  showUndo();
}

/* Copy and paste */
const copyItem = e => { const { id, ...rest } = e; return rest; };
function dayTools(canCopy) {
  const has = peek(cursor).foods.length;
  const b = [];
  if (canCopy) b.push(`<button class="btn small" data-act="copyday">Copy previous day</button>`);
  if (has) b.push(`<button class="btn small" data-pro="copyday">Copy day</button>`);
  if (clip?.type === "day") b.push(`<button class="btn small primary" data-pro="pasteday">Paste day (${clip.items.length})</button>`);
  return b.join("");
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
  return `${dateHeader(1, "day")}
  <div class="grid2"><form class="card form" data-form="track"><h2 class="full">Body measurements</h2>
  ${MEASURES.map(([k, l]) => { const prev = latestMeasure(k, cursor), delta = m[k] && prev ? lenUser(m[k] - prev.v) : null; return `<label class="half">${l} (${lenUnit()})${delta != null && Math.abs(delta) >= .05 ? ` <span class="muted" style="font-weight:400">${signed(delta, 1)}</span>` : ""}<input id="tm-${k}" name="m-${k}" type="number" inputmode="decimal" step="0.1" min="1" max="400" value="${m[k] ? lenUser(m[k]).toFixed(1) : ""}"></label>`; }).join("")}
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
    grid.innerHTML = items.map(p => { const url = URL.createObjectURL(p.blob); photoUrls.push(url); return `<figure><img src="${url}" alt="Progress photo from ${esc(short(p.date))}"><figcaption><span>${esc(short(p.date))}</span>${confirmPhoto === p.id ? `<button class="link danger" data-pro="delphotoyes" data-id="${esc(p.id)}">Delete</button>` : `<button type="button" class="iconbtn quiet" data-pro="delphoto" data-id="${esc(p.id)}" aria-label="Remove photo">${ICONS.close}</button>`}</figcaption></figure>`; }).join("");
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
  const heatStart = add(today(), -parse(today()).getDay() - 28), last35 = Array.from({ length: 35 }, (_, i) => add(heatStart, i)), logs28 = Array.from({ length: 28 }, (_, i) => add(today(), -i)), logPct = Math.round(logs28.filter(logged).length / 28 * 100), weighPct = Math.round(logs28.filter(weighed).length / 28 * 100);
  const keys = [["kcal", "Calories", "kcal"], ["p", "Protein", "g"], ["c", "Carbs", "g"], ["f", "Fat", "g"], ...MICROS.map(m => [m.k, m.label, m.u])], cur = keys.find(k => k[0] === contributor) || keys[0], top = contributors(days, cur[0]), eta = goalEta();
  const micro = MICROS.map(m => { const vals = foods.filter(e => e.n?.[m.k] != null), sum = vals.reduce((a, e) => a + e.n[m.k], 0); return { ...m, avg: days.length ? sum / days.length : 0, count: vals.length }; });
  return `<div class="seg" style="justify-self:start" role="group" aria-label="Insight range">${[[7, "7 days"], [30, "30 days"], [90, "90 days"], ["all", "All"]].map(r => `<button data-pro="irange" data-r="${r[0]}" aria-pressed="${insightRange === r[0]}">${r[1]}</button>`).join("")}</div>
  <section class="card stats"><div class="stat"><span>Logging streak</span><b>${streak(logged)}</b><span>days</span></div><div class="stat"><span>Weigh-in streak</span><b>${streak(weighed)}</b><span>days</span></div><div class="stat"><span>Food logged</span><b>${logPct}%</b><span>last 28 days</span></div><div class="stat"><span>Weighed in</span><b>${weighPct}%</b><span>last 28 days</span></div></section>
  ${eta ? `<section class="card"><h2>Goal</h2><p class="muted" style="margin:6px 0 0">${esc(eta)}</p></section>` : ""}
  <div class="grid2"><section class="card stack"><h2>Consistency</h2><div class="heat heathead" aria-hidden="true">${DAY_NAMES.map(n => `<b>${n[0]}</b>`).join("")}</div><div class="heat" role="img" aria-label="Logging and weigh-in consistency for the last five weeks">${last35.map(d => `<i title="${esc(short(d))}" class="${d > today() ? "future" : logged(d) && weighed(d) ? "both" : logged(d) ? "log" : weighed(d) ? "wgh" : ""}${d === today() ? " today" : ""}"></i>`).join("")}</div><div class="legend"><span><i class="key both"></i>Food and weight</span><span><i class="key log"></i>Food</span><span><i class="key wgh"></i>Weight</span></div></section>
  <section class="card stack"><h2>Nutrition averages</h2><div style="overflow-x:auto"><table class="tbl"><thead><tr><th></th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr></thead><tbody>${ave.map(([l, a]) => `<tr><th>${l}</th>${a ? `<td>${fmt(a.kcal)}</td><td>${Math.round(a.p)}</td><td>${Math.round(a.c)}</td><td>${Math.round(a.f)}</td>` : `<td colspan="4" class="muted">No logged days</td>`}</tr>`).join("")}</tbody></table></div></section>
  ${mealsOff() ? "" : `<section class="card stack"><h2>Nutrient timing</h2>${MEALS.map((m, i) => { const pct = mealK[i] / allK * 100; return `<div><div class="mealhead"><span>${m}</span><span class="mono">${Math.round(pct)}%</span></div><div class="bar"><i style="width:${pct}%;background:var(--accent)"></i></div></div>`; }).join("")}</section>`}
  <section class="card stack"><div class="mealhead"><h2>Top contributors</h2><select id="contrib" aria-label="Nutrient" style="width:auto;max-width:55%">${keys.map(k => opt(k[0], k[1], contributor)).join("")}</select></div>${top.length ? top.map(t => `<div><div class="mealhead"><span style="min-width:0;overflow-wrap:anywhere">${esc(t.name)}</span><span class="mono">${Math.round(t.pct)}%</span></div><div class="bar"><i style="width:${t.pct}%;background:var(--protein)"></i></div></div>`).join("") : `<p class="muted" style="margin:0">No logged foods have this nutrient yet.</p>`}</section></div>
  ${richCard()}
  <section class="card stack"><h2>Micronutrients</h2><p class="muted" style="margin:0;font-size:13px">Daily average from foods with this data. Scanned products, labels, and recipes can include it. Most built-in foods do not, so true intake may be higher.</p><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Nutrient</th><th>Daily avg</th><th>% DV</th><th>Foods</th></tr></thead><tbody>${micro.map(m => `<tr><th>${m.label}</th><td>${m.count ? `${m.avg >= 10 ? Math.round(m.avg) : m.avg.toFixed(1)} ${m.u}` : "–"}</td><td>${m.count ? Math.round(m.avg / m.dv * 100) + "%" : "–"}</td><td>${m.count}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* Events */
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-pro]"); if (!b) return;
  const a = b.dataset.pro;
  if (a === "irange") { insightRange = b.dataset.r === "all" ? "all" : +b.dataset.r; render(); }
  if (a === "goday" && b.dataset.d <= today()) { cursor = b.dataset.d; render(); }
  if (a === "gotoday") { cursor = today(); render(); }
  if (a === "microtoggle") { microsExpanded = !microsExpanded; render(); }
  if (a === "goals") openGoals();
  if (a === "goalscoach") { const p = S.profile; p.mode = p.lastCoachMode || "coached"; p.plan = targets(); touch(); $("#dlg").close(); render(); }
  if (a === "goalsclear") { S.profile.useTargets = false; S.profile.plan = trackingPlan(); touch(); $("#dlg").close(); render(); }
  if (a === "editentry") openEdit(b.dataset.id);
  if (a === "editdel" && editing) {
    if (!editing.confirmDelete) { editing.confirmDelete = true; b.textContent = "Confirm delete"; return; }
    const { date, id } = editing; editing = null; $("#dlg").close(); removeEntry(date, id);
  }
  if (a === "undo") undoRemove();
  if (a === "copyentry") { const e = peek(cursor).foods.find(x => x.id === b.dataset.id); if (e) { clip = { type: "food", items: [copyItem(e)] }; setSave("Food copied"); render(); } }
  if (a === "copymeal") { clip = { type: "meal", items: peek(cursor).foods.filter(e => e.meal === b.dataset.meal).map(copyItem) }; setSave("Meal copied"); render(); }
  if (a === "copyday") { clip = { type: "day", items: peek(cursor).foods.map(copyItem) }; setSave("Day copied"); render(); }
  if (a === "pastemeal" && clip) { const x = day(cursor); clip.items.forEach(e => { const { t, ...rest } = e; x.foods.push({ ...rest, id: uid(), ...entryTime(cursor), meal: b.dataset.meal }); }); touch(cursor); render(); }
  if (a === "pasteflat" && clip) { const x = day(cursor); clip.items.forEach(e => { const { t, ...rest } = e; x.foods.push({ ...rest, id: uid(), ...(clip.type === "day" ? (t ? { t } : {}) : entryTime(cursor)) }); }); touch(cursor); render(); }
  if (a === "pasteday" && clip) { const x = day(cursor); clip.items.forEach(e => x.foods.push({ ...e, id: uid() })); touch(cursor); render(); }
  if (a === "ringadd") { const f = M.recipeFound[+b.dataset.i]; M.recipe.items.push({ food: f, qty: 1 }); M.recipe.q = ""; renderDlg(); $("#rq")?.focus(); }
  if (a === "ringdel") { M.recipe.items.splice(+b.dataset.i, 1); renderDlg(); }
  if (a === "rsave") saveRecipe(!!b.dataset.add);
  if (a === "faststart") startFast(b.dataset.from === "meal");
  if (a === "faststop") endFast();
  if (a === "fastdel") { const f = S.profile.fasting; if (f?.log) { f.log = f.log.filter(x => String(x.s) !== b.dataset.s); touch(); render(); } }
  if (a === "csvfoods") exportFoodsCsv();
  if (a === "csvdays") exportDaysCsv();
  if (a === "csvfasts") exportFastsCsv();
  if (a === "richbasis") { richBasis = b.dataset.b; refreshRich(); }
  if (a === "richadd") addRichFood(+b.dataset.i);
  if (a === "delphoto") { confirmPhoto = b.dataset.id; showPhotos(); }
  if (a === "delphotoyes") { const id = b.dataset.id; confirmPhoto = ""; photoTx("readwrite", s => s.delete(id)).then(showPhotos).catch(showPhotos); }
});
document.addEventListener("input", ev => {
  const t = ev.target;
  if (t.id === "kg") t.dataset.edited = "1";
  if (t.id === "servAmt") applyServingAmount();
  if (t.dataset.servMacro && servState) readServingBase();
  if ($("#editTotal")) updateEditTotal();
  if ($("#formMicro")) refreshFormMicros();
  if ($("#gKcal")) updateGoalTotal();
  if (!M?.recipe) return;
  if (t.id === "rname") M.recipe.name = t.value;
  if (t.id === "rserv" || t.dataset.ring != null) {
    if (t.id === "rserv") M.recipe.servings = t.value; else M.recipe.items[+t.dataset.ring].qty = Math.max(0, num(t.value));
    const el = $("#rTotal"), x = recipeTotals(M.recipe), s = Math.max(.1, num(M.recipe.servings, 1)); if (el) el.textContent = `Per serving: ${fmt(x.kcal / s)} kcal · ${Math.round(x.p / s)}P ${Math.round(x.c / s)}C ${Math.round(x.f / s)}F`;
  }
  if (t.id === "rq") { M.recipe.q = t.value; const box = $("#rRes"); if (box) box.innerHTML = recipeResults(M.recipe); }
});
document.addEventListener("keydown", ev => {
  if (ev.target.id !== "q" || ev.key !== "Enter" || ev.isComposing) return;
  ev.preventDefault();
  const first = $("#res [data-act=pick]");
  if (first && M?.q.trim()) first.click(); else ev.target.blur();
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.id === "qtyUnit") { $("#qty").value = t.value === "g" ? 100 : t.value === "oz" ? 3.5 : 1; updateDbAmount(); }
  if (t.id === "servUnit") { changeServingUnit(t); refreshFormMicros(); }
  if (t.id === "hideMeals") { S.profile.hideMeals = t.checked; touch(); }
  if (t.id === "coachSwitch") syncCoachFields();
  if (t.id === "useTargets") { const row = $("#trackTargetRow"); row.hidden = !t.checked; row.querySelectorAll("input").forEach(i => { i.disabled = !t.checked; }); }
  if (t.id === "pmode") { const row = $("#manualRow"), manual = t.value === "manual"; $("#nudgeRow").hidden = t.value !== "collab"; row.hidden = !manual; row.querySelectorAll("input").forEach(i => { i.disabled = !manual; }); }
  if (t.id === "contrib") { contributor = t.value; render(); }
  if (t.id === "richKey") { richKey = t.value; refreshRich(); }
  if (t.id === "showFasting") { S.profile.hideFasting = !t.checked; if (t.checked) delete S.profile.hideFasting; touch(); }
  if (t.id === "fastGoal") { fastingData().goal = oneOf(Number(t.value), FAST_GOALS, 16); touch(); refreshFastCard(); }
  if (t.id === "fastStartAt") setFastStart(t.value);
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
  if (t === "editentry" && editing) saveEdit(d);
  if (t === "goals") saveGoals(d);
  if (t === "tracktargets") {
    const p = S.profile, use = !!d.get("use"), err = $("#trackErr");
    if (use) {
      const manual = { kcal: Math.round(num(d.get("kcal"))), p: Math.round(num(d.get("p"))), c: Math.round(num(d.get("c"))), f: Math.round(num(d.get("f"))) };
      if (!(manual.kcal > 0)) { err.textContent = "Enter a calorie target, or turn daily targets off."; err.hidden = false; return; }
      p.manual = manual;
    }
    p.useTargets = use; p.plan = trackingPlan(); touch(); render();
  }
  if (t === "track") {
    const x = day(cursor), m = {};
    for (const [k] of MEASURES) { const v = num(d.get("m-" + k)); if (v > 0) m[k] = +lenStore(v).toFixed(2); }
    if (Object.keys(m).length) x.m = m; else delete x.m;
    touch(cursor); render();
  }
});

/* Entry times */
const pad2 = n => String(n).padStart(2, "0");
// Only foods logged for today get the current time. Back-filled days have no real time to record.
const entryTime = date => date === today() ? { t: clockNow() } : {};
function clockNow() { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function clockLabel(t) { const [h, m] = t.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
const entryMs = (date, t) => { const [h, m] = t.split(":").map(Number), d = parse(date); d.setHours(h, m, 0, 0); return d.getTime(); };

/* Fasting timer */
const FAST_GOALS = [12, 13, 14, 16, 18, 20, 24, 36];
const HOUR = 36e5;
function cleanFasting(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const now = Date.now(), okTime = v => Number.isFinite(Number(v)) && Number(v) > 946684800000 && Number(v) <= now + 6e4;
  const out = { goal: oneOf(Number(raw.goal), FAST_GOALS, 16) };
  if (okTime(raw.start)) out.start = Number(raw.start);
  if (Array.isArray(raw.log)) out.log = raw.log.filter(f => f && okTime(f.s) && okTime(f.e) && Number(f.e) > Number(f.s) && Number(f.e) - Number(f.s) < 14 * 24 * HOUR).slice(-300).map(f => ({ s: Number(f.s), e: Number(f.e) }));
  return out;
}
const fastingOn = () => !!S.profile && S.profile.hideFasting !== true;
function fastingData() { const p = S.profile; return p.fasting || (p.fasting = { goal: 16, log: [] }); }
function duration(ms) { const mins = Math.max(0, Math.floor(ms / 6e4)), h = Math.floor(mins / 60), m = mins % 60; return h ? `${h}h ${pad2(m)}m` : `${m}m`; }
function whenLabel(ms) { const d = new Date(ms), key = iso(d), time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); return key === today() ? time : `${long(key)} ${time}`; }
function localInput(ms) { const d = new Date(ms); return `${iso(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
// The most recent timed food that is not in the future marks the end of the last meal.
function lastMealMs() {
  const now = Date.now(); let best = 0;
  for (const d of [today(), add(today(), -1), add(today(), -2)]) for (const e of peek(d).foods) if (e.t) { const ms = entryMs(d, e.t); if (ms <= now && ms > best) best = ms; }
  return best || null;
}
function fastCard() {
  const f = S.profile.fasting || { goal: 16, log: [] }, now = Date.now(), goal = f.goal || 16, recent = (f.log || []).slice().sort((a, b) => b.e - a.e).slice(0, 3);
  const goalSelect = short => `<select id="fastGoal" aria-label="Fasting goal">${FAST_GOALS.map(h => opt(h, short ? `${h} hours` : `${h} hour goal`, goal)).join("")}</select>`;
  const history = recent.length ? `<div class="fastlog">${recent.map(x => `<div><span>${esc(duration(x.e - x.s))}</span><span class="muted">ended ${esc(whenLabel(x.e))}</span><button class="iconbtn quiet" data-pro="fastdel" data-s="${x.s}" aria-label="Remove this fast">${ICONS.close}</button></div>`).join("")}</div>` : "";
  if (f.start) {
    const ran = now - f.start, pct = clamp(ran / (goal * HOUR) * 100, 0, 100), done = ran >= goal * HOUR;
    return `<section class="card fastcard" id="fastCard"><div class="mealtitle"><div><h3>Fasting</h3><p>${done ? "Goal reached" : `${esc(duration(goal * HOUR - ran))} to go`}</p></div><button class="btn small primary" data-pro="faststop">End fast</button></div>
    <div class="fasttime"><b>${esc(duration(ran))}</b><span class="fastof"><span class="muted">of</span>${goalSelect(true)}</span></div><div class="bar"><i style="width:${pct}%;background:var(${done ? "--carbs" : "--ink"})"></i></div>
    <div class="fastrow"><label class="faststart">Started<input id="fastStartAt" type="datetime-local" max="${localInput(now)}" value="${localInput(f.start)}"></label></div>${history}</section>`;
  }
  const last = lastMealMs();
  return `<section class="card fastcard" id="fastCard"><div class="mealtitle"><div><h3>Fasting</h3><p>${!last ? "Not fasting" : now - last < 6e4 ? "Last food just now" : `Last food ${esc(duration(now - last))} ago`}</p></div><button class="btn small" data-pro="faststart">Start now</button></div>
  <div class="fastrow">${last && now - last >= 10 * 6e4 ? `<button class="btn small" data-pro="faststart" data-from="meal">Start from last food</button>` : ""}${goalSelect(false)}</div>${history}</section>`;
}
function refreshFastCard() { const el = $("#fastCard"); if (el && !$("#fastStartAt:focus") && !$("#fastGoal:focus")) el.outerHTML = fastCard(); }
function startFast(fromMeal) { const f = fastingData(); f.start = fromMeal && lastMealMs() || Date.now(); touch(); render(); }
function endFast() {
  const f = fastingData(); if (!f.start) return;
  const e = Date.now(), ran = e - f.start, kept = ran >= 6e4;
  if (kept) (f.log || (f.log = [])).push({ s: f.start, e });
  f.log = (f.log || []).sort((a, b) => a.s - b.s).slice(-300); delete f.start; touch(); render();
  setSave(kept ? `Fast saved: ${duration(ran)}` : "Fast was under a minute, so it was not saved");
}
function setFastStart(value) {
  const ms = new Date(value).getTime(), f = fastingData();
  if (!Number.isFinite(ms) || ms > Date.now() || Date.now() - ms > 7 * 24 * HOUR) { setSave("Choose a start time within the last 7 days."); refreshFastCard(); return; }
  f.start = ms; touch(); refreshFastCard();
}
setInterval(() => { if (!document.hidden && view === "log") refreshFastCard(); }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && view === "log") refreshFastCard(); });

/* Spreadsheet export */
// Text that starts like a formula is prefixed so spreadsheet apps show it instead of running it.
function csvCell(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(+v.toFixed(2)) : "";
  let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function saveCsv(name, rows) {
  const text = "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n", file = new File([text], name, { type: "text/csv" });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e?.name === "AbortError") return; }
  const url = URL.createObjectURL(file), a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const loggedDays = () => Object.keys(S.days).filter(d => peek(d).foods.length || peek(d).w).sort();
function exportFoodsCsv() {
  const rows = [["Date", "Time", "Meal", "Food", "Serving", "Servings", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)", ...MICROS.map(m => `${m.label} (${m.u})`)]];
  for (const d of loggedDays()) {
    const foods = peek(d).foods.slice().sort((a, b) => (a.t || "99") .localeCompare(b.t || "99"));
    for (const e of foods) rows.push([d, e.t || "", mealsOff() ? "" : e.meal, e.name, e.serv, e.qty, e.kcal, e.p, e.c, e.f, ...MICROS.map(m => e.n?.[m.k] ?? "")]);
  }
  saveCsv(`tare-food-log-${today()}.csv`, rows);
}
function exportDaysCsv() {
  const T = trendMap(), u = unit(), rows = [["Date", `Weight (${u})`, `Trend weight (${u})`, "Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Calorie target", "Protein target (g)", "Carb target (g)", "Fat target (g)", "Foods logged", "Left out of estimate", ...MEASURES.map(([, l]) => `${l} (${lenUnit()})`), "Period"]];
  for (const d of loggedDays()) {
    const x = peek(d), t = totals(d), g = dayPlan(d);
    rows.push([d, x.w ? toUser(x.w) : "", T[d] ? toUser(T[d]) : "", x.foods.length ? t.kcal : "", x.foods.length ? t.p : "", x.foods.length ? t.c : "", x.foods.length ? t.f : "", g.kcal || "", g.kcal ? g.p : "", g.kcal ? g.c : "", g.kcal ? g.f : "", x.foods.length, x.skip ? "yes" : "", ...MEASURES.map(([k]) => x.m?.[k] ? lenUser(x.m[k]) : ""), x.period ? "yes" : ""]);
  }
  saveCsv(`tare-daily-totals-${today()}.csv`, rows);
}
function exportFastsCsv() {
  const stamp = ms => { const d = new Date(ms); return `${iso(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const rows = [["Start", "End", "Hours"], ...(S.profile.fasting?.log || []).map(f => [stamp(f.s), stamp(f.e), (f.e - f.s) / HOUR])];
  saveCsv(`tare-fasts-${today()}.csv`, rows);
}

/* Foods high in a nutrient, from the on-device USDA foods */
const RICH = [["p", "Protein", "g", 50], ...MICROS.filter(m => !MICRO_LIMITS.has(m.k)).map(m => [m.k, m.label, m.u, m.dv])];
let richKey = "fiber", richBasis = "kcal", richList = [];
// Seasonings, powders, and baby foods top these lists without being things people eat by the portion.
// Ingredients, by-products, fortified drinks, and brand-name products are left out so the list shows everyday whole foods.
const RICH_SKIP = /^(spices|seasoning|leavening|baking|babyfood|infant formula|gelatin|yeast|vital wheat|desserts, rennin|gums|formulated bar|beverages)|\b(powder|dehydrated|freeze-dried|dried|dry|crude|isolate|concentrate|flour|defatted|meal|meat extender|by-products|mature seeds, raw|with (added |high )?vitamin|spleen|lungs?|tablets|supplement|extract|peel|substitute|instant|fortified|breakfast type|pokeberry|sisymbrium|seaweed|mustard spinach|chrysanthemum|cloud ears)\b/;
const branded = name => /\b[A-Z][A-Z'&-]{3,}\b/.test(name);
function richValue(row, key) { const i = key === "p" ? 2 : 7 + MICROS.findIndex(m => m.k === key); return row[i]; }
function richFoods() {
  if (!foodDb) return [];
  const found = [], dv = (RICH.find(n => n[0] === richKey) || RICH[0])[3];
  for (const entry of foodDb) {
    const r = entry.row, v = richValue(r, richKey);
    if (!(v > 0) || RICH_SKIP.test(entry.lower) || branded(r[0])) continue;
    if (richBasis === "kcal" && !(r[1] >= 20)) continue;
    // A normal portion has to give a real share of the day, which drops herbs, sauces, and garnishes.
    if (v * (r[6] > 0 ? r[6] : 100) / 100 < dv * .1) continue;
    found.push({ entry, score: richBasis === "kcal" ? v / r[1] * 100 : v });
  }
  found.sort((a, b) => b.score - a.score);
  // Keep one version of each food so the list is not ten cuts of the same fish.
  const seen = new Set(), groups = new Map(), out = [];
  for (const x of found) {
    const parts = x.entry.lower.split(",").map(t => t.trim()), key = parts.slice(0, 2).join(","), group = parts[0];
    if (seen.has(key) || (groups.get(group) || 0) >= 2) continue;
    seen.add(key); groups.set(group, (groups.get(group) || 0) + 1); out.push(x);
    if (out.length >= 15) break;
  }
  return out;
}
function richRows() {
  const meta = RICH.find(n => n[0] === richKey) || RICH[0], [, label, u, dv] = meta;
  if (!foodDb) { loadFoodDb().then(() => { if (view === "insights") refreshRich(); }).catch(() => {}); return `<p class="muted" style="margin:0">${esc(foodDbMessage())}</p>`; }
  richList = richFoods();
  if (!richList.length) return `<p class="muted" style="margin:0">No foods found.</p>`;
  const amount = v => `${v >= 100 ? fmt(v) : v >= 10 ? Math.round(v) : +v.toFixed(1)} ${u}`;
  return richList.map((x, i) => {
    const r = x.entry.row, v = richValue(r, richKey), g = r[6] > 0 ? r[6] : 100, perPortion = v * g / 100, portion = r[6] > 0 ? `${r[5]} (${+g.toFixed(0)} g)` : "100 g";
    const basis = richBasis === "kcal" ? `${amount(x.score)} per 100 kcal` : `${amount(v)} per 100 g`;
    return `<button type="button" class="result richrow" data-pro="richadd" data-i="${i}"><span class="fooditem">${foodIcon(r[0])}<span><b>${esc(r[0])}</b><small>${esc(basis)} · ${esc(amount(perPortion))} in ${esc(portion)}, ${Math.round(perPortion / dv * 100)}% DV</small></span></span><span class="addhint" aria-hidden="true">${ICONS.plus}</span></button>`;
  }).join("") + `<p class="muted" style="margin:8px 0 0;font-size:12px">${label} values come from the USDA foods saved on this phone. Tap a food to log it.</p>`;
}
function richCard() {
  return `<section class="card stack"><div class="mealhead"><h2>Foods high in</h2><select id="richKey" aria-label="Nutrient" style="width:auto;max-width:55%">${RICH.map(n => opt(n[0], n[1], richKey)).join("")}</select></div>
  <div class="seg" style="justify-self:start" role="group" aria-label="Compare by">${[["kcal", "Per calorie"], ["g", "Per 100 g"]].map(([k, l]) => `<button type="button" data-pro="richbasis" data-b="${k}" aria-pressed="${richBasis === k}">${l}</button>`).join("")}</div>
  <div class="results" id="richList">${richRows()}</div></section>`;
}
function refreshRich() {
  const list = $("#richList"); if (!list) return;
  list.innerHTML = richRows();
  document.querySelectorAll("[data-pro=richbasis]").forEach(b => b.setAttribute("aria-pressed", b.dataset.b === richBasis));
}
function addRichFood(i) {
  const x = richList[i]; if (!x) return;
  openAdd(mealForNow(), "search");
  M.q = x.entry.row[0]; M.sel = dbFood(x.entry); renderDlg();
  const q = $("#qty"); if (q) { q.focus(); q.select(); }
}

/* Food icons */
const FOOD_ICONS = {
  plantmilk: '<path d="M8 3h8v3l2 3v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V9l2-3z"/><path d="M6 9h12"/><path d="M12 13c-1.5 1-1.5 3 0 4 1.5-1 1.5-3 0-4z"/>',
  alcohol: '<path d="M8 3h8l-.5 5a3.5 3.5 0 0 1-7 0z"/><path d="M12 12v8M8.5 20h7"/>',
  coffee: '<path d="M5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M17 10.5h1a2.5 2.5 0 0 1 0 5h-1.3"/><path d="M9 3.5v2.5M13 3.5v2.5"/>',
  icecream: '<path d="M8 11l4 10 4-10"/><path d="M7 11a5 5 0 0 1 10 0z"/>',
  dairy: '<path d="M8 3h8v3l2 3v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V9l2-3z"/><path d="M6 9h12M8 6h8"/>',
  bar: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7.5 8v8M16.5 8v8"/>',
  pizza: '<path d="M12 21 3.5 6.5c5.5-2.7 11.5-2.7 17 0z"/><path d="M5 9c4.5-2 9.5-2 14 0"/><circle cx="12" cy="12.5" r="1"/><circle cx="9.5" cy="10.5" r=".8"/><circle cx="14.5" cy="10.5" r=".8"/>',
  burger: '<path d="M4 11a8 6 0 0 1 16 0z"/><path d="M3.5 14.5h17"/><path d="M5 17.5h14a1.5 1.5 0 0 1-1.5 2.5h-11A1.5 1.5 0 0 1 5 17.5z"/>',
  soup: '<path d="M3 11h18a9 8 0 0 1-18 0z"/><path d="M9 3.5c-1 1.5 1 2.5 0 4.5M14 3.5c-1 1.5 1 2.5 0 4.5"/>',
  bread: '<path d="M6 11a3.5 3.5 0 0 1 0-7h12a3.5 3.5 0 0 1 0 7v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"/>',
  sweets: '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="9.5" r=".9"/><circle cx="14.5" cy="9" r=".9"/><circle cx="14" cy="14.5" r=".9"/><circle cx="9.5" cy="15" r=".9"/>',
  egg: '<path d="M12 3c3.5 0 6.5 5.5 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.5 8.5 3 12 3z"/>',
  cheese: '<path d="M3 18v-6.5L15 6l6 5.5V18z"/><path d="M3 11.5h18"/><circle cx="8" cy="15" r="1"/><circle cx="15" cy="14.5" r="1.3"/>',
  nut: '<path d="M12 3c4 3 6 7 5 11s-4 6-5 7c-1-1-4-3-5-7s1-8 5-11z"/><path d="M12 8v9"/>',
  fat: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  sauce: '<path d="M10 2.5h4V6l3 4v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V10l3-4z"/><path d="M7 13h10"/>',
  drink: '<path d="M6 7h12l-1.5 13.5h-9z"/><path d="M13 7l2-4h3"/>',
  fish: '<path d="M5 12c3-4 6-5 9-5s5.5 2 7 5c-1.5 3-4 5-7 5s-6-1-9-5z"/><path d="M5 12 2 8.5v7z"/><circle cx="16.5" cy="11" r=".8"/>',
  poultry: '<ellipse cx="14.5" cy="9.5" rx="5.5" ry="4.8" transform="rotate(-45 14.5 9.5)"/><path d="M10.6 13.4 6.5 17.5"/><circle cx="5" cy="17.2" r="1.6"/><circle cx="6.8" cy="19" r="1.6"/>',
  meat: '<path d="M4.5 13C4 8 8 4 13 4s8 3 7.5 7.5S16 20 11 20c-3.5 0-6-3-6.5-7z"/><circle cx="13.5" cy="10" r="2.2"/>',
  greenveg: '<path d="M5 19C5 10.5 10 5 20 4c0 10-5.5 15-15 15z"/><path d="M5 19l8-8"/>',
  legume: '<path d="M4 19C6 10 12 5 20 5c-1 8.5-6.5 14-16 14z"/><circle cx="9" cy="14.5" r="1.4"/><circle cx="12.5" cy="11.3" r="1.4"/><circle cx="16" cy="8.4" r="1.2"/>',
  grain: '<path d="M12 21V7"/><path d="M12 7c-1.8-.9-2.6-2.6-2.6-4.6 1.8.3 2.6 2.1 2.6 4.6zM12 7c1.8-.9 2.6-2.6 2.6-4.6-1.8.3-2.6 2.1-2.6 4.6z"/><path d="M12 12c-2.4 0-3.9-1.3-4.4-3.4 2.3 0 3.9 1.3 4.4 3.4zM12 12c2.4 0 3.9-1.3 4.4-3.4-2.3 0-3.9 1.3-4.4 3.4zM12 16.5c-2.4 0-3.9-1.3-4.4-3.4 2.3 0 3.9 1.3 4.4 3.4zM12 16.5c2.4 0 3.9-1.3 4.4-3.4-2.3 0-3.9 1.3-4.4 3.4z"/>',
  fruit: '<path d="M12 7.5c-1.5-1-4-1.5-5.5 0C4 10 5 15.5 7.5 18.5c1.5 2 3 2 4.5 1 1.5 1 3 1 4.5-1C19 15.5 20 10 17.5 7.5c-1.5-1.5-4-1-5.5 0z"/><path d="M12 7.5c0-2 1-3.5 2.5-4.5"/>',
  veg: '<path d="M14.5 9.5 4.6 19.4c-.5.5.1 1 .6.6l9.8-9.9"/><path d="M14.5 9.5c1.6-1.6 3.6-1.4 4.6-.4s1.2 3-.4 4.6l-3.5 3.5"/><path d="M15.5 8.5 17 4M15.5 8.5 20 7"/>',
  plate: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>'
};
// Categories are listed in priority order. The keyword that appears first in the name wins, so "Oats, whey and banana" shows grain.
const FOOD_KINDS = [
  ["plantmilk", /\b(almond|soy|oat|rice|coconut|cashew|pea) (milk|beverage)/],
  ["alcohol", /\b(beer|wine|vodka|whiske?y|rum|gin|tequila|liqueur|alcoholic|cocktail|margarita|sake|brandy|cider)\b/],
  ["coffee", /\b(coffee|espresso|latte|cappuccino|americano|mocha|tea|chai)\b/],
  ["icecream", /ice cream|frozen yogurt|frozen novelt|gelato|sorbet|sherbet|popsicle/],
  ["dairy", /\b(whey|casein|protein (powder|shake)|shake)\b/],
  ["bar", /\bbars?\b/],
  ["pizza", /pizza/],
  ["burger", /cheeseburger|hamburger|burger|sandwich|burrito|taco|hot dog|fast foods?|nuggets|french fries|fries\b|mcdonald|burger king|kfc|wendy|subway|restaurant|wrap\b|quesadilla|nachos/],
  ["soup", /\b(soup|stew|chowder|broth|chili|ramen|pho)\b/],
  ["bread", /english muffin|bagel|bread|toast|\bbuns?\b|\brolls?\b|tortilla|pita|croissant|biscuit|crackers?|naan|waffle|pancake|french toast/],
  ["sweets", /chocolate|cand(y|ies)|cookie|cake|brownie|donut|doughnut|\bpie\b|pastry|muffin|\bsugars?\b|honey|syrup|\bjam\b|jelly|dessert|pudding|gumm|marshmallow|frosting|sweet roll|danish|candied/],
  ["egg", /\beggs?\b|omelet|frittata/],
  ["cheese", /cheese|parmesan|mozzarella|cheddar|feta|ricotta|brie|gouda/],
  ["nut", /peanut|almond|walnut|cashew|pecan|pistachio|hazelnut|macadamia|\bnuts?\b|seeds?\b|chia|flax|tahini|trail mix/],
  ["fat", /olive oil|\boils?\b|mayonnaise|margarine|\blard\b|shortening|dressing|\bghee\b|\bbutter\b/],
  ["dairy", /\bmilk|yogh?urt|kefir|\bcream\b|creamer|skyr/],
  ["sauce", /ketchup|mustard(?! greens)|sauce|salsa|gravy|relish|vinegar|condiment|dip\b/],
  ["drink", /\w+ juice|juice|\bsoda\b|\bcola\b|lemonade|smoothie|\bwater\b|drink|carbonated|kombucha/],
  ["fish", /fish|salmon|tuna|\bcod\b|tilapia|trout|shrimp|prawn|crab|lobster|sardine|anchov|mackerel|halibut|scallop|\bclams?\b|oyster|mussel|crustacean|mollus|seafood|sushi|pollock|catfish|bass\b/],
  ["poultry", /chicken|turkey|\bduck|goose|poultry|quail|ostrich|\bemu\b|pheasant/],
  ["meat", /beef|steak|pork|\bham\b|bacon|lamb|veal|sausage|salami|pepperoni|jerky|venison|bison|game meat|\bmeat|brisket|\bribs?\b|frankfurter|bologna|\bdeli\b|chorizo|prosciutto/],
  ["greenveg", /mustard greens|collards?|green beans|snap beans|string beans|lettuce|spinach|kale|\bsalad|greens|chard|arugula|cabbage|broccoli|brussels|celery|asparagus|herbs?\b|basil|parsley|cilantro|spices?\b/],
  ["legume", /\bbeans?\b|lentil|chickpea|hummus|\btofu\b|tempeh|edamame|\bpeas?\b|soybean|\bsoy\b|falafel/],
  ["grain", /\boats?\b|oatmeal|\brice\b|pasta|noodle|spaghetti|macaroni|quinoa|cereal|granola|flakes|barley|wheat|flour|couscous|bulgur|grits|popcorn|millet|buckwheat|pretzel|\bbran\b|muesli/],
  ["fruit", /apple|banana|orange|berr(y|ies)|grape|melon|pineapple|mango|peach|pear|plum|cherr|kiwi|lemon|lime|apricot|\bfigs?\b|\bdates?\b|raisin|avocado|papaya|pomegranate|tangerine|nectarine|coconut|fruit|clementine|guava|lychee|persimmon|acerola/],
  ["veg", /carrot|pepper|tomato|cucumber|onion|mushroom|\bcorn\b|potato|squash|zucchini|cauliflower|eggplant|beet|radish|garlic|vegetable|okra|artichoke|leek|pumpkin|\byams?\b|turnip|parsnip|olive|pickle|sprouts/]
];
const foodKindCache = new Map();
function foodKind(name) {
  const lower = String(name || "").toLowerCase();
  if (foodKindCache.has(lower)) return foodKindCache.get(lower);
  let best = "plate", at = Infinity;
  for (const [kind, re] of FOOD_KINDS) { const i = lower.search(re); if (i >= 0 && i < at) { best = kind; at = i; } }
  if (foodKindCache.size > 4000) foodKindCache.clear();
  foodKindCache.set(lower, best);
  return best;
}
const foodIcon = name => `<span class="foodicon" aria-hidden="true"><svg viewBox="0 0 24 24">${FOOD_ICONS[foodKind(name)]}</svg></span>`;
