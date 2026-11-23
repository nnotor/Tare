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
  scriptIntegrity: "sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F",
  worker: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
  core: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0",
  lang: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int"
};
const onlineCache = new Map();
let onlineNext = 0, clip = null, insightRange = 30, contributor = "kcal", ocrLoad = null, photoUrls = [], confirmPhoto = "";

/* Safe backup restore */
const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const isDateKey = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const safeNumber = (v, min, max, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, min, max) : fallback; };
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
  return { id: uid(), name: String(e?.name ?? "Food").slice(0, 100), serv: String(e?.serv || "1 serving").slice(0, 50), qty: safeNumber(e?.qty, .01, 1000, 1), meal: MEALS.includes(e?.meal) ? e.meal : "Snacks", kcal: safeNumber(e?.kcal, 0, 50000), p: safeNumber(e?.p, 0, 5000), c: safeNumber(e?.c, 0, 5000), f: safeNumber(e?.f, 0, 5000), ...(n ? { n } : {}) };
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
  clip = null; editing = null; servState = null; onlineCache.clear(); productCache.clear(); onlineNext = 0; confirmPhoto = "";
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
  <div class="full form" id="trackTargetRow" ${on ? "" : "hidden"}><label>Calories<input id="tk" name="kcal" type="number" min="1" max="8000" value="${esc(m.kcal)}" ${on ? "" : "disabled"}></label><label>Protein (g)<input id="tp" name="p" type="number" min="0" max="500" value="${esc(m.p)}" ${on ? "" : "disabled"}></label><label>Carbs (g)<input id="tc" name="c" type="number" min="0" max="1000" value="${esc(m.c)}" ${on ? "" : "disabled"}></label><label>Fat (g)<input id="tf" name="f" type="number" min="0" max="400" value="${esc(m.f)}" ${on ? "" : "disabled"}></label></div>
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
  <div class="full form" id="manualRow" ${mode === "manual" ? "" : "hidden"}><label>Calories<input id="mk" name="mk" type="number" min="800" max="8000" value="${m.kcal}" ${mode === "manual" ? "" : "disabled"}></label><label>Protein (g)<input id="mp" name="mp" type="number" min="0" max="500" value="${m.p}" ${mode === "manual" ? "" : "disabled"}></label><label>Carbs (g)<input id="mc" name="mc" type="number" min="0" max="1000" value="${m.c}" ${mode === "manual" ? "" : "disabled"}></label><label>Fat (g)<input id="mf" name="mf" type="number" min="0" max="400" value="${m.f}" ${mode === "manual" ? "" : "disabled"}></label></div>
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
function scoreFood(name, words, whole) {
  const lower = String(name).toLowerCase(), tokens = searchTokens(name);
  let score = lower.startsWith(whole) ? 100 : 0;
  for (const word of words) {
    if (tokens[0]?.startsWith(word)) score += 45;
    else if (tokens.some(t => t.startsWith(word))) score += 30;
    else if (lower.includes(word)) score += 12;
    else {
      const max = word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0;
      if (!max || !tokens.some(t => editDistance(word, t, max) <= max || editDistance(word, t.slice(0, word.length), max) <= max)) return null;
      score += 4;
    }
  }
  return score - Math.min(lower.length, 40) / 10;
}
function rankFoods(query) {
  const whole = query.trim().toLowerCase(), words = searchTokens(whole);
  if (!words.length) return [];
  const usual = smartFoods(M.meal, 60), boost = new Map(usual.map((f, i) => [f.name, 26 - Math.min(i, 20)])), seen = new Set(), ranked = [];
  for (const food of [...S.custom, ...usual, ...FOODS]) {
    const plain = `n:${food.name}|${food.serv}`, key = food.barcode ? `b:${food.barcode}` : plain;
    if (seen.has(key)) continue;
    seen.add(key); seen.add(plain);
    const base = scoreFood(food.name, words, whole);
    if (base != null) ranked.push({ food, score: base + (boost.get(food.name) || 0) + (S.custom.includes(food) ? 8 : 0) });
  }
  return ranked.sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name)).slice(0, 30).map(x => x.food);
}
const foodKey = f => f.barcode ? `b:${f.barcode}` : `n:${f.name}|${f.serv}`;
function highlightName(name) {
  const text = String(name), lower = text.toLowerCase(), marks = new Array(text.length).fill(false);
  for (const word of searchTokens(M?.q || "")) {
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
      return [b.kcal, b.p, b.c, b.f].some(v => v == null) ? null : { name: info.name, serv: b.label, kcal: b.kcal, p: num(b.p), c: num(b.c), f: num(b.f), n: b.n, online: true };
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
  return `<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn small" id="onlineBtn" data-pro="online" ${M.onlineBusy ? "disabled" : ""}>Search online</button></div><p class="muted" id="onlineMsg" role="status" style="margin:0;font-size:13px" ${M.onlineMsg ? "" : "hidden"}>${esc(M.onlineMsg || "")}</p>`;
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
  const value = v => g.kcal ? v : "";
  $("#dlg").innerHTML = `<div class="dlgwrap"><div class="dlghead"><div class="mealhead"><h2>Macro goals</h2><button class="icon" data-act="close" aria-label="Close">×</button></div></div><div class="dlgbody"><form class="form" data-form="goals">
  <label class="full">Protein (g)<input id="gp" name="p" type="number" inputmode="numeric" min="0" max="500" step="1" required value="${value(g.p)}"></label>
  <label class="full">Carbs (g)<input id="gc" name="c" type="number" inputmode="numeric" min="0" max="1000" step="1" required value="${value(g.c)}"></label>
  <label class="full">Fat (g)<input id="gf" name="f" type="number" inputmode="numeric" min="0" max="400" step="1" required value="${value(g.f)}"></label>
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
function entryRow(e) {
  return `<div class="entry"><button class="entrymain" data-pro="editentry" data-id="${esc(e.id)}" aria-label="Edit ${esc(e.name)}"><b>${esc(e.name)}</b><small>${e.qty !== 1 ? esc(e.qty) + " × " : ""}${esc(e.serv)} · ${Math.round(e.p)}P ${Math.round(e.c)}C ${Math.round(e.f)}F</small></button><span class="entrykcal">${fmt(e.kcal)}</span><button class="iconbtn quiet" data-pro="copyentry" data-id="${esc(e.id)}" aria-label="Copy ${esc(e.name)}">${ICONS.copy}</button><button class="iconbtn quiet" data-act="remove" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">${ICONS.close}</button></div>`;
}
function flatFoodCard(x) {
  const foods = x.foods, sum = k => foods.reduce((a, e) => a + e[k], 0), meal = mealForNow();
  const paste = clip && clip.type !== "day" ? `<div class="mealtools"><button class="link" data-pro="pasteflat">Paste ${clip.items.length === 1 ? "food" : clip.items.length + " foods"}</button></div>` : "";
  return `<section class="card mealcard"><div class="mealtitle"><div><h3>Food</h3><p>${foods.length ? `${fmt(sum("kcal"))} kcal · ${Math.round(sum("p"))}P ${Math.round(sum("c"))}C ${Math.round(sum("f"))}F` : "Nothing logged"}</p></div><div class="mealactions"><button class="iconbtn soft" data-act="add" data-meal="${meal}" data-tab="scan" aria-label="Scan food">${ICONS.scan}</button><button class="iconbtn add" data-act="add" data-meal="${meal}" aria-label="Add food">${ICONS.plus}</button></div></div>${foods.map(entryRow).join("")}${paste}</section>`;
}
function logLayoutCard() {
  return `<section class="card stack"><h2>Log layout</h2><label style="display:flex;align-items:center;gap:10px"><input id="hideMeals" type="checkbox" ${mealsOff() ? "checked" : ""}>Use one food list instead of meals</label><p class="muted" style="margin:0;font-size:13px">Breakfast, Lunch, Dinner, and Snacks will be hidden. Turn this off anytime to bring them back with your foods still sorted.</p></section>`;
}
function logView() {
  const t = totals(cursor), g = dayPlan(cursor), left = g.kcal - t.kcal, x = peek(cursor), canCopy = !x.foods.length && peek(add(cursor, -1)).foods.length;
  const weekStart = add(cursor, -parse(cursor).getDay()), week = Array.from({ length: 7 }, (_, i) => add(weekStart, i));
  const r = 52, len = 2 * Math.PI * r, pct = g.kcal ? Math.min(1, t.kcal / g.kcal) : 0, hasWeight = weights(cursor).length > 0;
  const tools = dayTools(canCopy);
  return `<div class="today-head"><h1>${esc(long(cursor))}</h1><div class="weeknav"><button class="iconbtn" data-act="day" data-n="-7" aria-label="Previous week">${ICONS.back}</button><button class="iconbtn" data-act="day" data-n="7" aria-label="Next week" ${cursor >= today() ? "disabled" : ""}>${ICONS.next}</button></div></div>
  <div class="weekstrip">${week.map(dayChip).join("")}</div>
  <div class="dash"><div class="dash-side"><section class="card hero" aria-label="Daily totals">
    <button class="btn small herogoals" data-pro="goals">${g.kcal ? "Edit goals" : "Set goals"}</button>
    <div class="ringbox"><svg viewBox="0 0 120 120" role="img" aria-label="${fmt(t.kcal)} calories eaten"><circle class="ringtrack" cx="60" cy="60" r="${r}"/>${pct ? `<circle class="ringfill ${left < 0 ? "over" : ""}" cx="60" cy="60" r="${r}" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${(len * (1 - pct)).toFixed(1)}"/>` : ""}</svg><div class="ringtext"><b>${fmt(g.kcal ? Math.abs(left) : t.kcal)}</b><span>${!g.kcal ? "calories eaten" : left >= 0 ? "calories left" : "calories over"}</span></div></div>
    ${g.kcal ? `<div class="calstats"><div><b>${fmt(t.kcal)}</b><span>Eaten</span></div><div><b>${fmt(g.kcal)}</b><span>${esc(dayLabel(cursor))}</span></div></div>` : ""}
    <div class="macros">${macroColumn("Protein", t.p, g.p, "--protein")}${macroColumn("Carbs", t.c, g.c, "--carbs")}${macroColumn("Fat", t.f, g.f, "--fat")}</div>
  </section>
  <section class="card weighcard"><form class="weigh" data-form="weight"><div><b>Weight</b><span>${hasWeight ? `Trend ${toUser(latestTrend(cursor)).toFixed(1)} ${unit()}` : `Log in ${unit()}`}</span></div><input id="w" name="w" type="number" inputmode="decimal" step="0.1" min="20" max="1000" aria-label="Weight in ${unit()}" value="${x.w ? toUser(x.w).toFixed(1) : ""}" placeholder="0.0"><button class="btn small">Save</button></form></section>${microsCard(x)}</div>
  <div class="dash-log">${tools ? `<div class="daytools">${tools}</div>` : ""}
  ${mealsOff() ? flatFoodCard(x) : MEALS.map(m => {
    const es = x.foods.filter(e => e.meal === m), sum = k => es.reduce((a, e) => a + e[k], 0);
    return `<section class="card mealcard"><div class="mealtitle"><div><h3>${m}</h3><p>${es.length ? `${fmt(sum("kcal"))} kcal · ${Math.round(sum("p"))}P ${Math.round(sum("c"))}C ${Math.round(sum("f"))}F` : "Nothing logged"}</p></div><div class="mealactions"><button class="iconbtn soft" data-act="add" data-meal="${m}" data-tab="scan" aria-label="Scan food for ${m}">${ICONS.scan}</button><button class="iconbtn add" data-act="add" data-meal="${m}" aria-label="Add food to ${m}">${ICONS.plus}</button></div></div>
    ${es.map(entryRow).join("")}${mealTools(m, es)}</section>`;
  }).join("")}
  ${coachingOff() ? "" : `<label class="card skipcard"><input id="skip" type="checkbox" data-change="skip" ${x.skip ? "checked" : ""}>Leave this incomplete day out of my expenditure estimate</label>`}</div></div>`;
}

/* Edit logged foods */
let editing = null;
function openEdit(id) {
  const e = peek(cursor).foods.find(x => x.id === id);
  if (!e) return;
  const q = e.qty > 0 ? e.qty : 1, per = x => +(num(x) / q).toFixed(2);
  M = { meal: e.meal, tab: "edit", q: "", sel: null, scan: { state: "idle" } };
  editing = { id, date: cursor, perN: e.n ? scaleN(e.n, 1 / q) : undefined, confirmDelete: false };
  $("#dlg").innerHTML = `<div class="dlgwrap"><div class="dlghead"><div class="mealhead"><h2>Edit food</h2><button class="icon" data-act="close" aria-label="Close">×</button></div></div><div class="dlgbody"><form class="form" data-form="editentry">
  <label class="full">Name<input id="ename" name="name" required maxlength="100" value="${esc(e.name)}"></label>
  <label ${mealsOff() ? "hidden" : ""}>Meal<select id="emeal" name="meal">${MEALS.map(m => opt(m, m, e.meal)).join("")}</select></label>
  <label class="${mealsOff() ? "full" : ""}">Date<input id="edate" name="date" type="date" required max="${today()}" value="${esc(cursor)}"></label>
  <label>Serving<input id="cserv" name="serv" required maxlength="50" value="${esc(e.serv)}"></label>
  <label>Servings eaten<input id="eqty" name="qty" type="number" min="0.01" step="any" inputmode="decimal" required value="${q}"></label>
  <label>Calories per serving<input id="ck" name="kcal" type="number" min="0" step="any" inputmode="decimal" required value="${per(e.kcal)}"></label>
  <label>Protein (g)<input id="cp" name="p" type="number" min="0" step="any" inputmode="decimal" required value="${per(e.p)}"></label>
  <label>Carbs (g)<input id="cc" name="c" type="number" min="0" step="any" inputmode="decimal" required value="${per(e.c)}"></label>
  <label>Fat (g)<input id="cf" name="f" type="number" min="0" step="any" inputmode="decimal" required value="${per(e.f)}"></label>
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
  const e = from.foods[index], perN = scaledMicros(editing.perN), next = { ...e, name: name.slice(0, 100), serv: String(d.get("serv")).trim().slice(0, 50), qty, meal: MEALS.includes(d.get("meal")) ? d.get("meal") : e.meal, kcal: Math.round(num(d.get("kcal")) * qty), p: +(num(d.get("p")) * qty).toFixed(1), c: +(num(d.get("c")) * qty).toFixed(1), f: +(num(d.get("f")) * qty).toFixed(1) };
  if (perN) next.n = scaleN(perN, qty); else delete next.n;
  if (date === editing.date) from.foods[index] = next;
  else { from.foods.splice(index, 1); day(date).foods.push(next); }
  touch(date);
  const moved = date !== editing.date ? `Moved to ${short(date)}` : "";
  editing = null;
  $("#dlg").close();
  render();
  if (moved) setSave(moved);
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
  return `<section class="card"><div class="datebar"><button class="icon" data-act="day" data-n="-1" aria-label="Previous day">‹</button><h2>${esc(long(cursor))}</h2><button class="icon" data-act="day" data-n="1" aria-label="Next day" ${cursor >= today() ? "disabled" : ""}>›</button></div></section>
  <div class="grid2"><form class="card form" data-form="track"><h2 class="full">Body measurements</h2>
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
  const last35 = Array.from({ length: 35 }, (_, i) => add(today(), i - 34)), logs28 = Array.from({ length: 28 }, (_, i) => add(today(), -i)), logPct = Math.round(logs28.filter(logged).length / 28 * 100), weighPct = Math.round(logs28.filter(weighed).length / 28 * 100);
  const keys = [["kcal", "Calories", "kcal"], ["p", "Protein", "g"], ["c", "Carbs", "g"], ["f", "Fat", "g"], ...MICROS.map(m => [m.k, m.label, m.u])], cur = keys.find(k => k[0] === contributor) || keys[0], top = contributors(days, cur[0]), eta = goalEta();
  const micro = MICROS.map(m => { const vals = foods.filter(e => e.n?.[m.k] != null), sum = vals.reduce((a, e) => a + e.n[m.k], 0); return { ...m, avg: days.length ? sum / days.length : 0, count: vals.length }; });
  return `<div class="seg" style="justify-self:start" role="group" aria-label="Insight range">${[[7, "7 days"], [30, "30 days"], [90, "90 days"], ["all", "All"]].map(r => `<button data-pro="irange" data-r="${r[0]}" aria-pressed="${insightRange === r[0]}">${r[1]}</button>`).join("")}</div>
  <section class="card stats"><div class="stat"><span>Logging streak</span><b>${streak(logged)}</b><span>days</span></div><div class="stat"><span>Weigh-in streak</span><b>${streak(weighed)}</b><span>days</span></div><div class="stat"><span>Food logged</span><b>${logPct}%</b><span>last 28 days</span></div><div class="stat"><span>Weighed in</span><b>${weighPct}%</b><span>last 28 days</span></div></section>
  ${eta ? `<section class="card"><h2>Goal</h2><p class="muted" style="margin:6px 0 0">${esc(eta)}</p></section>` : ""}
  <div class="grid2"><section class="card stack"><h2>Consistency</h2><div class="heat" role="img" aria-label="Logging and weigh-in consistency for the last 35 days">${last35.map(d => `<i title="${esc(short(d))}" class="${logged(d) && weighed(d) ? "both" : logged(d) ? "log" : weighed(d) ? "wgh" : ""}"></i>`).join("")}</div><div class="legend"><span><i class="key both"></i>Food and weight</span><span><i class="key log"></i>Food</span><span><i class="key wgh"></i>Weight</span></div></section>
  <section class="card stack"><h2>Nutrition averages</h2><div style="overflow-x:auto"><table class="tbl"><thead><tr><th></th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr></thead><tbody>${ave.map(([l, a]) => `<tr><th>${l}</th>${a ? `<td>${fmt(a.kcal)}</td><td>${Math.round(a.p)}</td><td>${Math.round(a.c)}</td><td>${Math.round(a.f)}</td>` : `<td colspan="4" class="muted">No logged days</td>`}</tr>`).join("")}</tbody></table></div></section>
  ${mealsOff() ? "" : `<section class="card stack"><h2>Nutrient timing</h2>${MEALS.map((m, i) => { const pct = mealK[i] / allK * 100; return `<div><div class="mealhead"><span>${m}</span><span class="mono">${Math.round(pct)}%</span></div><div class="bar"><i style="width:${pct}%;background:var(--accent)"></i></div></div>`; }).join("")}</section>`}
  <section class="card stack"><div class="mealhead"><h2>Top contributors</h2><select id="contrib" aria-label="Nutrient" style="width:auto;max-width:55%">${keys.map(k => opt(k[0], k[1], contributor)).join("")}</select></div>${top.length ? top.map(t => `<div><div class="mealhead"><span style="min-width:0;overflow-wrap:anywhere">${esc(t.name)}</span><span class="mono">${Math.round(t.pct)}%</span></div><div class="bar"><i style="width:${t.pct}%;background:var(--protein)"></i></div></div>`).join("") : `<p class="muted" style="margin:0">No logged foods have this nutrient yet.</p>`}</section></div>
  <section class="card stack"><h2>Micronutrients</h2><p class="muted" style="margin:0;font-size:13px">Daily average from foods with this data. Scanned products, labels, and recipes can include it. Most built-in foods do not, so true intake may be higher.</p><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Nutrient</th><th>Average</th><th>Daily value</th><th>Foods with data</th></tr></thead><tbody>${micro.map(m => `<tr><th>${m.label}</th><td>${m.count ? `${m.avg >= 10 ? Math.round(m.avg) : m.avg.toFixed(1)} ${m.u}` : "–"}</td><td>${m.count ? Math.round(m.avg / m.dv * 100) + "%" : "–"}</td><td>${m.count}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* Events */
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-pro]"); if (!b) return;
  const a = b.dataset.pro;
  if (a === "online") searchOnline();
  if (a === "irange") { insightRange = b.dataset.r === "all" ? "all" : +b.dataset.r; render(); }
  if (a === "goday" && b.dataset.d <= today()) { cursor = b.dataset.d; render(); }
  if (a === "microtoggle") { microsExpanded = !microsExpanded; render(); }
  if (a === "goals") openGoals();
  if (a === "goalscoach") { const p = S.profile; p.mode = p.lastCoachMode || "coached"; p.plan = targets(); touch(); $("#dlg").close(); render(); }
  if (a === "goalsclear") { S.profile.useTargets = false; S.profile.plan = trackingPlan(); touch(); $("#dlg").close(); render(); }
  if (a === "editentry") openEdit(b.dataset.id);
  if (a === "editdel" && editing) {
    if (!editing.confirmDelete) { editing.confirmDelete = true; b.textContent = "Confirm delete"; return; }
    const x = day(editing.date); x.foods = x.foods.filter(e => e.id !== editing.id); touch(editing.date); editing = null; $("#dlg").close(); render();
  }
  if (a === "copyentry") { const e = peek(cursor).foods.find(x => x.id === b.dataset.id); if (e) { clip = { type: "food", items: [copyItem(e)] }; setSave("Food copied"); render(); } }
  if (a === "copymeal") { clip = { type: "meal", items: peek(cursor).foods.filter(e => e.meal === b.dataset.meal).map(copyItem) }; setSave("Meal copied"); render(); }
  if (a === "copyday") { clip = { type: "day", items: peek(cursor).foods.map(copyItem) }; setSave("Day copied"); render(); }
  if (a === "pastemeal" && clip) { const x = day(cursor); clip.items.forEach(e => x.foods.push({ ...e, id: uid(), meal: b.dataset.meal })); touch(cursor); render(); }
  if (a === "pasteflat" && clip) { const x = day(cursor); clip.items.forEach(e => x.foods.push({ ...e, id: uid() })); touch(cursor); render(); }
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
  if (t.id === "rq") { M.recipe.q = t.value; const pos = t.selectionStart; renderDlg(); const n = $("#rq"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }
});
document.addEventListener("keydown", ev => {
  if (ev.target.id !== "q" || ev.key !== "Enter" || ev.isComposing) return;
  ev.preventDefault();
  const first = $("#res [data-act=pick]");
  if (first && M?.q.trim()) first.click(); else ev.target.blur();
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.id === "servUnit") { changeServingUnit(t); refreshFormMicros(); }
  if (t.id === "hideMeals") { S.profile.hideMeals = t.checked; touch(); }
  if (t.id === "coachSwitch") syncCoachFields();
  if (t.id === "useTargets") { const row = $("#trackTargetRow"); row.hidden = !t.checked; row.querySelectorAll("input").forEach(i => { i.disabled = !t.checked; }); }
  if (t.id === "pmode") { const row = $("#manualRow"), manual = t.value === "manual"; $("#nudgeRow").hidden = t.value !== "collab"; row.hidden = !manual; row.querySelectorAll("input").forEach(i => { i.disabled = !manual; }); }
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
