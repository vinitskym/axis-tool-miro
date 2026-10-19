// AXIS TOOL – לוגיקת הלוח
// ------------------------------------------------------------
// עיקרון: "סימון במקום יצירה".
// פריטים שכבר נמצאים על הלוח לא זזים ולא מוחלפים. סימון יוצר מאחוריהם
// "משטח" (shape) בצבע של הסוג, עם תווית למעלה, ומקבץ את המשטח והפריטים לקבוצה.
// המשטח הוא "אלמנט AXIS": עליו נשמר המידע (metadata) ואליו מתחברים החצים.
// האפליקציה לא שומרת מצב פנימי – בכל פעולה היא קוראת את המבנה מהלוח עצמו.

export const TYPES = {
  start:    { he: "נקודת מוצא", en: "Starting Point", fill: "#FFFFFF", border: "#9AA0A6" },
  question: { he: "שאלה",       en: "Question",       fill: "#C9ECFA", border: "#4BA9D6" },
  content:  { he: "תוכן",       en: "Content",        fill: "#FFF3A6", border: "#E0B800" },
  insight:  { he: "תובנה",      en: "Insight",        fill: "#E2F4C9", border: "#7DB443" },
};

const META_KEY = "axis";        // נשמר על המשטח: { v, type, category }
const OWNER_KEY = "axisMat";    // נשמר על פריטים מסומנים: מזהה המשטח שלהם
const PAD = 40;                 // שוליים סביב הפריטים המסומנים
const LABEL_SPACE = 50;         // מקום לתווית בראש המשטח
const CARD_W = 320;             // גודל כרטיס שאלה חדש
const CARD_H = 200;
const GAP = 120;                // מרווח בין אלמנטים

let labelLang = "he";
export function setLabelLang(lang) { labelLang = lang === "en" ? "en" : "he"; }

// ---------- עזרים ----------

function labelHtml(type) {
  return `<p><strong>${TYPES[type][labelLang]}</strong></p>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// מידע על פריטים נשמר בשני מקומות: על הפריט עצמו (metadata),
// וגם ברשימת גיבוי ברמת הלוח (appData) – כי בחלק מסוגי הפריטים
// (למשל פתקים ותמונות) Miro לא תמיד שומרת metadata.
const REG_KEY = "axisReg";
let regCache = null;
let regTime = 0;

async function loadReg() {
  if (regCache && Date.now() - regTime < 800) return regCache;
  try { regCache = (await miro.board.getAppData(REG_KEY)) || {}; } catch { regCache = {}; }
  regTime = Date.now();
  return regCache;
}

function isEmpty(v) {
  return v === undefined || v === null || (typeof v === "object" && !Object.keys(v).length);
}

async function safeGetMeta(item, key) {
  let v;
  try { v = await item.getMetadata(key); } catch {}
  if (!isEmpty(v)) return v;
  const reg = await loadReg();
  return reg[item.id]?.[key];
}

async function safeSetMeta(item, key, value) {
  try { await item.setMetadata(key, value); } catch { /* סוגי פריטים מסוימים לא תומכים */ }
  try {
    regCache = null;
    const reg = await loadReg();
    reg[item.id] = { ...(reg[item.id] || {}), [key]: value };
    await miro.board.setAppData(REG_KEY, reg);
    regCache = reg;
    regTime = Date.now();
  } catch {}
}

// מיקום מוחלט של פריט (פריטים בתוך frame נמדדים יחסית לפינת ה-frame)
async function absBox(item) {
  let { x, y } = item;
  if (item.parentId && item.relativeTo === "parent_top_left") {
    try {
      const parent = await miro.board.getById(item.parentId);
      x = parent.x - parent.width / 2 + x;
      y = parent.y - parent.height / 2 + y;
    } catch { /* נשאר כפי שהוא */ }
  }
  const w = item.width || 0;
  const h = item.height || 0;
  return { left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
}

// אם הפריט הוא משטח AXIS – מחזיר את המידע שלו
async function axisMetaOf(item) {
  if (!item || item.type !== "shape") return null;
  const m = await safeGetMeta(item, META_KEY);
  return m && TYPES[m.type] ? m : null;
}

// ---------- קריאת הבחירה ----------

// מפרק את הבחירה לשני סוגים: אלמנטי AXIS קיימים, ופריטים רגילים שעוד לא סומנו
export async function readSelection() {
  const raw = await miro.board.getSelection();
  // קבוצה שנבחרה – מפרקים לפריטים שבתוכה
  const sel = [];
  for (const item of raw) {
    if (item.type === "group") {
      try { sel.push(...(await item.getItems())); } catch {}
    } else sel.push(item);
  }
  const elements = new Map();
  const loose = [];

  for (const item of sel) {
    if (item.type === "connector") continue;

    const meta = await axisMetaOf(item);
    if (meta) { elements.set(item.id, { mat: item, meta }); continue; }

    const ownerId = await safeGetMeta(item, OWNER_KEY);
    if (ownerId) {
      try {
        const mat = await miro.board.getById(ownerId);
        const m = await axisMetaOf(mat);
        if (m) { elements.set(mat.id, { mat, meta: m }); continue; }
      } catch { /* המשטח נמחק – מתייחסים לפריט כלא מסומן */ }
    }

    // גיבוי נוסף: אם הפריט בקבוצה שיש בה משטח AXIS – הוא שייך אליו
    if (item.groupId) {
      try {
        const g = await miro.board.getById(item.groupId);
        let found = null;
        for (const other of await g.getItems()) {
          const m = await axisMetaOf(other);
          if (m) { found = { mat: other, meta: m }; break; }
        }
        if (found) { elements.set(found.mat.id, found); continue; }
      } catch {}
    }
    loose.push(item);
  }
  return { elements: [...elements.values()], loose, count: sel.length };
}

// ---------- פעולות ----------

// סימון: פריטים לא מסומנים מקבלים משטח משותף; אלמנטים קיימים מחליפים סוג
export async function markSelection(type) {
  const { elements, loose } = await readSelection();
  let changed = 0;

  for (const el of elements) { await retype(el.mat, el.meta, type); changed++; }

  if (loose.length) {
    await wrapItems(loose, type);
    changed++;
  }
  return changed;
}

async function retype(mat, meta, type) {
  mat.style.fillColor = TYPES[type].fill;
  mat.style.borderColor = TYPES[type].border;
  // מחליפים רק את שורת התווית הראשונה, ושומרים טקסט שהמשתמש כתב
  const rest = (mat.content || "").replace(/^\s*<p>.*?<\/p>/, "");
  mat.content = labelHtml(type) + rest;
  await mat.sync();
  await safeSetMeta(mat, META_KEY, { ...meta, type });
}

async function wrapItems(items, type) {
  const boxes = await Promise.all(items.map(absBox));
  const left = Math.min(...boxes.map((b) => b.left)) - PAD;
  const right = Math.max(...boxes.map((b) => b.right)) + PAD;
  const top = Math.min(...boxes.map((b) => b.top)) - PAD - LABEL_SPACE;
  const bottom = Math.max(...boxes.map((b) => b.bottom)) + PAD;

  const mat = await createMat(type, {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    width: right - left,
    height: bottom - top,
  });

  // המשטח מאחורי הפריטים
  try { await miro.board.sendToBack(mat); } catch {}

  // אם הפריטים יושבים בתוך frame – גם המשטח נכנס אליו
  const parentId = items[0].parentId;
  if (parentId && items.every((i) => i.parentId === parentId)) {
    try { const frame = await miro.board.getById(parentId); await frame.add(mat); } catch {}
  }

  for (const it of items) await safeSetMeta(it, OWNER_KEY, mat.id);

  // קבוצה: כשמזיזים את האלמנט, הכול זז יחד
  try { await miro.board.group({ items: [mat, ...items] }); } catch {}
  return mat;
}

async function createMat(type, geom, extraHtml = "", category = null) {
  const mat = await miro.board.createShape({
    shape: "round_rectangle",
    content: labelHtml(type) + extraHtml,
    ...geom,
    style: {
      fillColor: TYPES[type].fill,
      fillOpacity: 1,
      borderColor: TYPES[type].border,
      borderWidth: 2,
      borderOpacity: 1,
      textAlign: "right",
      textAlignVertical: "top",
      fontSize: 18,
      color: "#1a1a1a",
    },
  });
  await safeSetMeta(mat, META_KEY, { v: 1, type, category });
  return mat;
}

// הסרת סימון: המשטח נמחק, הפריטים נשארים בדיוק במקום
export async function unmarkSelection() {
  const { elements } = await readSelection();
  for (const { mat } of elements) {
    if (mat.groupId) {
      try { const g = await miro.board.getById(mat.groupId); await g.ungroup(); } catch {}
    }
    await miro.board.remove(mat);
  }
  return elements.length;
}

// חיבור שני אלמנטים בחץ. כיוון הקריאה מימין לשמאל: החץ יוצא מהאלמנט הימני
export async function connectSelection() {
  const { elements } = await readSelection();
  if (elements.length !== 2) return false;
  const [a, b] = elements.map((e) => e.mat).sort((p, q) => q.x - p.x);
  await connect(a, b);
  return true;
}

async function connect(from, to) {
  return miro.board.createConnector({
    shape: "elbowed",
    start: { item: from.id, snapTo: "left" },
    end: { item: to.id, snapTo: "right" },
    style: { strokeColor: "#3c3c3c", strokeWidth: 2, endStrokeCap: "arrow" },
  });
}

// יצירת כרטיס שאלה: משמאל לאלמנט שנבחר ומחובר אליו, או במרכז המסך אם לא נבחר כלום
export async function addQuestion(text, category = null) {
  const { elements } = await readSelection();
  const anchor = elements[0]?.mat || null;
  const html = `<p>${escapeHtml(text)}</p>`;

  let x, y;
  if (anchor) {
    // כמה חצים כבר יוצאים מהאלמנט? כל שאלה נוספת יורדת שורה
    const outgoing = (await miro.board.get({ type: "connector" }))
      .filter((c) => c.start?.item === anchor.id).length;
    x = anchor.x - anchor.width / 2 - GAP - CARD_W / 2;
    y = anchor.y + outgoing * (CARD_H + GAP / 2);
  } else {
    const vp = await miro.board.viewport.get();
    x = vp.x + vp.width / 2;
    y = vp.y + vp.height / 2;
  }

  const card = await createMat("question", { x, y, width: CARD_W, height: CARD_H }, html, category);
  if (anchor) await connect(anchor, card);
  return card;
}

// ---------- "איפה אני?" ----------

// קורא את כל אלמנטי AXIS והחיבורים ביניהם, ומחזיר תמונת מצב
export async function analyzeBoard() {
  const shapes = await miro.board.get({ type: "shape" });
  const metas = await Promise.all(shapes.map(axisMetaOf));
  const els = new Map();
  shapes.forEach((s, i) => { if (metas[i]) els.set(s.id, { item: s, ...metas[i], links: new Set() }); });

  const connectors = await miro.board.get({ type: "connector" });
  for (const c of connectors) {
    const a = els.get(c.start?.item);
    const b = els.get(c.end?.item);
    if (a && b) { a.links.add(c.end.item); b.links.add(c.start.item); }
  }

  const linkedTypes = (el) => new Set([...el.links].map((id) => els.get(id).type));
  const all = [...els.values()];

  const counts = Object.fromEntries(Object.keys(TYPES).map((t) => [t, 0]));
  const categories = {};
  for (const el of all) {
    counts[el.type]++;
    if (el.category) categories[el.category] = (categories[el.category] || 0) + 1;
  }

  return {
    total: all.length,
    counts,
    categories,
    openQuestions: all.filter((e) => e.type === "question" && !linkedTypes(e).has("content")),
    contentNoInsight: all.filter((e) => e.type === "content" && !linkedTypes(e).has("insight")),
    isolated: all.filter((e) => e.type !== "start" && e.links.size === 0),
  };
}

// טקסט קצר שמייצג אלמנט ברשימות (בלי התווית)
export function previewText(item, type) {
  const div = document.createElement("div");
  div.innerHTML = (item.content || "").replace(/^\s*<p>.*?<\/p>/, "");
  const t = div.textContent.trim();
  return t ? (t.length > 60 ? t.slice(0, 60) + "…" : t) : `${TYPES[type]?.he || ""} מסומן – לחצו להצגה על הלוח`;
}

export async function focusItem(item) {
  try { await miro.board.viewport.zoomTo(item); } catch {}
  try { await miro.board.deselect(); await miro.board.select({ id: item.id }); } catch {}
}
