// AXIS TOOL – הפאנל
import { QUESTION_BANK, RECOMMENDED_BY_TYPE } from "./questions.js";
import {
  TYPES, setLabelLang, readSelection, markSelection, unmarkSelection,
  connectSelection, addQuestion, analyzeBoard, previewText, focusItem,
} from "./axis.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------- הודעות ----------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

async function run(fn) {
  try { await fn(); }
  catch (e) { console.error(e); toast("משהו לא הצליח: " + (e?.message || e)); }
  finally { refreshSelection(); }
}

// ---------- לשוניות ----------
$$(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === b));
    $$(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + b.dataset.tab));
    if (b.dataset.tab === "where") renderReport();
  })
);

// ---------- שפת תוויות ----------
let lang = "he";
try { lang = localStorage.getItem("axis-lang") || "he"; } catch {}
function applyLang() {
  setLabelLang(lang);
  $("#lang").textContent = "תוויות: " + (lang === "he" ? "עברית" : "English");
}
$("#lang").addEventListener("click", () => {
  lang = lang === "he" ? "en" : "he";
  try { localStorage.setItem("axis-lang", lang); } catch {}
  applyLang();
  toast("תוויות חדשות ייכתבו ב" + (lang === "he" ? "עברית" : "אנגלית"));
});
applyLang();

// ---------- מצב הבחירה ----------
let selectedType = null;

async function refreshSelection() {
  const { elements, loose, count } = await readSelection();
  const status = $("#status");
  selectedType = elements.length === 1 && !loose.length ? elements[0].meta.type : null;

  if (!count) status.innerHTML = "בחרו פריטים על הלוח";
  else if (elements.length && !loose.length)
    status.innerHTML = elements.length === 1
      ? `נבחר: <b>${TYPES[elements[0].meta.type].he}</b>`
      : `נבחרו <b>${elements.length}</b> אלמנטים מסומנים`;
  else if (!elements.length) status.innerHTML = `נבחרו <b>${loose.length}</b> פריטים לא מסומנים`;
  else status.innerHTML = `נבחרו <b>${elements.length}</b> מסומנים ו-<b>${loose.length}</b> לא מסומנים`;

  $$(".type").forEach((b) => b.classList.toggle("current", b.dataset.type === selectedType));
  $("#connect").disabled = elements.length !== 2;
  $("#unmark").disabled = elements.length === 0;

  const anchor = elements[0];
  $("#q-hint").textContent = anchor
    ? `לחיצה על שאלה יוצרת כרטיס שאלה משמאל ל"${TYPES[anchor.meta.type].he}" שנבחר/ה, ומחברת אותו בחץ.`
    : "לחיצה על שאלה יוצרת כרטיס שאלה במרכז המסך. כדי לחבר אותה לאלמנט, בחרו אותו קודם.";
  renderCategories();
}

// ---------- סימון ----------
$$(".type").forEach((b) =>
  b.addEventListener("click", () =>
    run(async () => {
      const n = await markSelection(b.dataset.type);
      toast(n ? `סומן כ${TYPES[b.dataset.type].he}` : "קודם בחרו פריטים על הלוח");
    })
  )
);
$("#connect").addEventListener("click", () =>
  run(async () => toast((await connectSelection()) ? "חוברו בחץ" : "בחרו בדיוק שני אלמנטים מסומנים"))
);
$("#unmark").addEventListener("click", () =>
  run(async () => {
    const n = await unmarkSelection();
    toast(n ? "הסימון הוסר. הפריטים נשארו במקומם" : "לא נבחר אלמנט מסומן");
  })
);

// ---------- שאלות מנחות ----------
function renderCategories() {
  const rec = RECOMMENDED_BY_TYPE[selectedType] || [];
  const open = new Set($$("details.cat[open]").map((d) => d.dataset.id));
  const ordered = [
    ...QUESTION_BANK.filter((c) => rec.includes(c.id)),
    ...QUESTION_BANK.filter((c) => !rec.includes(c.id)),
  ];
  const box = $("#categories");
  box.innerHTML = "";
  for (const cat of ordered) {
    const d = document.createElement("details");
    d.className = "cat" + (rec.includes(cat.id) ? " rec" : "");
    d.dataset.id = cat.id;
    if (open.has(cat.id)) d.open = true;
    d.innerHTML = `<summary>${cat.title}<span class="n">${cat.questions.length}</span></summary>`;
    for (const q of cat.questions) {
      const b = document.createElement("button");
      b.className = "q";
      b.textContent = q;
      b.addEventListener("click", () =>
        run(async () => { await addQuestion(q, cat.id); toast("השאלה נוספה ללוח"); })
      );
      d.appendChild(b);
    }
    box.appendChild(d);
  }
}

$("#own-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#own-q").value.trim();
  if (!v) return;
  run(async () => { await addQuestion(v, null); $("#own-q").value = ""; toast("השאלה נוספה ללוח"); });
});

// ---------- איפה אני? ----------
$("#refresh").addEventListener("click", () => renderReport());

async function renderReport() {
  const box = $("#report");
  box.innerHTML = `<p class="hint">קורא את הלוח…</p>`;
  let r;
  try { r = await analyzeBoard(); }
  catch (e) { box.innerHTML = `<p class="hint">לא הצלחתי לקרוא את הלוח.</p>`; return; }

  if (!r.total) {
    box.innerHTML = `<p class="hint">עדיין אין אלמנטים מסומנים על הלוח. התחילו בלשונית "סימון".</p>`;
    return;
  }

  box.className = "report";
  box.innerHTML = "";

  const counts = document.createElement("div");
  counts.className = "counts";
  for (const [t, def] of Object.entries(TYPES)) {
    counts.insertAdjacentHTML(
      "beforeend",
      `<div class="count" style="background:${def.fill};border-color:${def.border}"><b>${r.counts[t]}</b>${def.he}</div>`
    );
  }
  box.appendChild(counts);

  addGapList(box, "שאלות שעדיין אין להן תוכן", r.openQuestions, "לכל השאלות יש תוכן.");
  addGapList(box, "תוכן שעדיין לא הוביל לתובנה", r.contentNoInsight, "כל התוכן מחובר לתובנה.");
  if (r.isolated.length) addGapList(box, "אלמנטים לא מחוברים", r.isolated, "");

  const used = document.createElement("div");
  used.innerHTML = `<h3>סוגי חשיבה בשאלות המנחות</h3>`;
  const p = document.createElement("p");
  p.className = "cats-used";
  for (const c of QUESTION_BANK) {
    const n = r.categories[c.id] || 0;
    p.insertAdjacentHTML("beforeend", `<span class="${n ? "" : "zero"}">${c.title} · ${n}</span>`);
  }
  used.appendChild(p);
  box.appendChild(used);
}

function addGapList(box, title, list, okText) {
  const sec = document.createElement("div");
  sec.innerHTML = `<h3>${title} (${list.length})</h3>`;
  if (!list.length) {
    sec.insertAdjacentHTML("beforeend", `<p class="ok">${okText}</p>`);
  } else {
    const ul = document.createElement("div");
    ul.className = "gap-list";
    for (const el of list) {
      const b = document.createElement("button");
      b.textContent = previewText(el.item, el.type);
      b.title = "הצג על הלוח";
      b.addEventListener("click", () => focusItem(el.item));
      ul.appendChild(b);
    }
    sec.appendChild(ul);
  }
  box.appendChild(sec);
}

// ---------- התחלה ----------
miro.board.ui.on("selection:update", () => refreshSelection());
refreshSelection();
