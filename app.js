// ============================================================
// Flashcards — single-file vanilla app
// ============================================================

const STORE_KEY = "flashcards.v1";
const DAY = 24 * 60 * 60 * 1000;

// ---------- storage ----------
function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { decks: [] };
    const parsed = JSON.parse(raw);
    if (!parsed.decks) parsed.decks = [];
    return parsed;
  } catch {
    return { decks: [] };
  }
}
function saveStore(s) {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}
let store = loadStore();

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function newDeck(name = "", cards = []) {
  return {
    id: uid(),
    name,
    cards: cards.map(c => ({ f: c.f || "", b: c.b || "" })),
    srs: {}, // cardId -> {ease, interval, due, reps}
    created: Date.now(),
  };
}

function ensureCardIds(deck) {
  // Cards keyed by index for simplicity; SRS state lives in srs[idx]
  // but as cards get added/removed indices shift — we use stable ids.
  for (const c of deck.cards) {
    if (!c.id) c.id = uid();
  }
  // Drop stale SRS entries
  const valid = new Set(deck.cards.map(c => c.id));
  for (const k of Object.keys(deck.srs)) {
    if (!valid.has(k)) delete deck.srs[k];
  }
}

function getDeck(id) {
  return store.decks.find(d => d.id === id);
}

function persist() { saveStore(store); }

// ---------- text cleanup (LaTeX-style escapes) ----------
// Common backslash escapes that show up in copied academic text:
// \% \$ \& \_ \# \{ \} \~ \^
function cleanDisplay(s) {
  if (!s) return "";
  return String(s).replace(/\\([%$&_#{}~^])/g, "$1");
}

// ---------- interval formatting ----------
function formatInterval(ms) {
  if (ms < 60 * 60 * 1000) return Math.max(1, Math.round(ms / 60000)) + "m";
  if (ms < DAY) return Math.max(1, Math.round(ms / (60 * 60 * 1000))) + "h";
  const days = ms / DAY;
  if (days < 30) return Math.max(1, Math.round(days)) + "d";
  if (days < 365) return Math.round(days / 30) + "mo";
  return Math.round(days / 365) + "y";
}

// ---------- SRS (SM-2 lite) ----------
function defaultSrs() {
  return { ease: 2.5, interval: 0, due: 0, reps: 0 };
}
function rateCard(srs, rating, now = Date.now()) {
  const s = { ...defaultSrs(), ...srs };
  if (rating === "again") {
    s.reps = 0;
    s.interval = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.due = now + 10 * 60 * 1000; // 10 min
  } else if (rating === "hard") {
    s.interval = Math.max(1, (s.interval || 1) * 1.2);
    s.ease = Math.max(1.3, s.ease - 0.15);
    s.reps += 1;
    s.due = now + s.interval * DAY;
  } else if (rating === "good") {
    if (s.reps === 0) s.interval = 1;
    else if (s.reps === 1) s.interval = 3;
    else s.interval = Math.max(1, s.interval * s.ease);
    s.reps += 1;
    s.due = now + s.interval * DAY;
  } else if (rating === "easy") {
    if (s.reps === 0) s.interval = 3;
    else s.interval = Math.max(1, s.interval * s.ease * 1.3);
    s.ease += 0.15;
    s.reps += 1;
    s.due = now + s.interval * DAY;
  }
  return s;
}

function previewInterval(srs, rating, now = Date.now()) {
  const next = rateCard(srs, rating, now);
  return formatInterval(Math.max(0, next.due - now));
}

function dueCards(deck, now = Date.now()) {
  return deck.cards.filter(c => {
    const s = deck.srs[c.id];
    if (!s || s.due === 0) return true; // never seen → due
    return s.due <= now;
  });
}

// ---------- CSV / text parsing ----------
function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.map(line => {
    // Try in order: tab, |, comma
    let parts;
    if (line.includes("\t")) parts = line.split("\t");
    else if (line.includes(" | ") || line.includes("|")) parts = line.split(/\s*\|\s*/);
    else if (line.includes(",")) parts = splitCsvLine(line);
    else parts = [line, ""];
    const f = (parts[0] || "").trim();
    const b = (parts.slice(1).join(" ") || "").trim();
    return { f, b };
  }).filter(c => c.f);
}
function splitCsvLine(line) {
  // Minimal CSV-aware split (handles quoted fields with commas)
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// ---------- URL share (compress + base64url) ----------
async function encodeDeck(deck) {
  const payload = {
    n: deck.name,
    c: deck.cards.map(c => [c.f, c.b]),
  };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let out;
  if ("CompressionStream" in window) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    out = new Uint8Array(buf);
  } else {
    out = bytes;
  }
  return toBase64Url(out);
}
async function decodeDeck(hash) {
  const bytes = fromBase64Url(hash);
  let json;
  try {
    if ("DecompressionStream" in window) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      const buf = await new Response(stream).arrayBuffer();
      json = new TextDecoder().decode(buf);
    } else {
      json = new TextDecoder().decode(bytes);
    }
  } catch {
    json = new TextDecoder().decode(bytes);
  }
  const obj = JSON.parse(json);
  const deck = newDeck(obj.n || "Imported deck", (obj.c || []).map(([f, b]) => ({ f, b })));
  ensureCardIds(deck);
  return deck;
}
function toBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------- file reading ----------
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

// ---------- sample decks ----------
const SAMPLES = [
  {
    name: "World Capitals",
    cards: [
      ["France", "Paris"], ["Japan", "Tokyo"], ["Egypt", "Cairo"],
      ["Australia", "Canberra"], ["Brazil", "Brasília"], ["Canada", "Ottawa"],
      ["South Korea", "Seoul"], ["Kenya", "Nairobi"], ["Argentina", "Buenos Aires"],
      ["Norway", "Oslo"], ["Thailand", "Bangkok"], ["Turkey", "Ankara"],
    ],
  },
  {
    name: "Spanish — Greetings & Basics",
    cards: [
      ["hello", "hola"], ["good morning", "buenos días"], ["good night", "buenas noches"],
      ["thank you", "gracias"], ["you're welcome", "de nada"], ["please", "por favor"],
      ["yes / no", "sí / no"], ["how are you?", "¿cómo estás?"],
      ["I'm sorry", "lo siento"], ["see you later", "hasta luego"],
    ],
  },
  {
    name: "SI Prefixes",
    cards: [
      ["kilo (k)", "10^3"], ["mega (M)", "10^6"], ["giga (G)", "10^9"],
      ["tera (T)", "10^12"], ["milli (m)", "10^-3"], ["micro (μ)", "10^-6"],
      ["nano (n)", "10^-9"], ["pico (p)", "10^-12"],
    ],
  },
];
function makeSampleDeck(sample) {
  const d = newDeck(sample.name, sample.cards.map(([f, b]) => ({ f, b })));
  ensureCardIds(d);
  return d;
}

// ---------- routing ----------
function go(route) {
  history.pushState(null, "", "#" + route);
  render();
}
function currentRoute() {
  return location.hash.replace(/^#/, "") || "home";
}

window.addEventListener("popstate", render);
window.addEventListener("hashchange", render);

// ---------- views ----------
const viewEl = document.getElementById("view");

function tpl(id) {
  return document.getElementById(id).content.cloneNode(true);
}

function render() {
  const r = currentRoute();
  if (r.startsWith("d=")) return renderImport(r.slice(2));
  if (r.startsWith("edit/")) return renderEdit(r.slice(5));
  if (r.startsWith("study/")) return renderStudy(r.slice(6));
  if (r.startsWith("study-once/")) return renderStudyOnce(r.slice(11));
  renderHome();
}

// ---------- home ----------
function renderHome() {
  viewEl.innerHTML = "";
  const node = tpl("tpl-home");
  viewEl.appendChild(node);
  const list = document.getElementById("deckList");

  if (!store.decks.length) {
    list.innerHTML = `<div class="empty-state">No decks yet. Tap <strong>New deck</strong> to make one, or paste a shared link.</div>`;
  } else {
    for (const d of store.decks) {
      const due = dueCards(d).length;
      const row = document.createElement("div");
      row.className = "deck-row";
      row.innerHTML = `
        <div class="deck-row-main">
          <h3></h3>
          <p class="meta"></p>
        </div>
        <div class="due-badge ${due ? "" : "zero"}">${due ? due + " due" : "0 due"}</div>
      `;
      row.querySelector("h3").textContent = d.name || "Untitled deck";
      row.querySelector(".meta").textContent = `${d.cards.length} card${d.cards.length === 1 ? "" : "s"}`;
      row.addEventListener("click", () => go("edit/" + d.id));
      list.appendChild(row);
    }
  }

  viewEl.querySelector('[data-action="new"]').onclick = () => {
    const d = newDeck("");
    store.decks.unshift(d);
    persist();
    go("edit/" + d.id);
  };
  viewEl.querySelector('[data-action="import"]').onclick = () => {
    openModal({
      title: "Import from CSV / text",
      body: `<p style="color:var(--ink-soft);font-size:14px;margin:0 0 8px;">One card per line. Front and back separated by tab, comma, or <code>|</code>.</p>
             <textarea id="modalCsv" placeholder="capital of France | Paris&#10;largest planet | Jupiter"></textarea>
             <p style="font-size:13px;color:var(--ink-faint);margin:10px 0 0;">Deck name (optional)</p>
             <input type="text" id="modalCsvName" placeholder="My new deck" />`,
      actions: [
        { label: "Cancel", onClick: closeModal },
        { label: "Create deck", primary: true, onClick: () => {
            const text = document.getElementById("modalCsv").value;
            const name = document.getElementById("modalCsvName").value.trim() || "New deck";
            const cards = parseCSV(text);
            if (!cards.length) { toast("No cards found"); return; }
            const d = newDeck(name, cards);
            ensureCardIds(d);
            store.decks.unshift(d);
            persist();
            closeModal();
            go("edit/" + d.id);
        }},
      ],
    });
  };
  // Sample decks
  const sampleList = document.getElementById("sampleList");
  for (const s of SAMPLES) {
    const row = document.createElement("div");
    row.className = "deck-row";
    row.innerHTML = `
      <div class="deck-row-main">
        <h3></h3>
        <p class="meta"></p>
      </div>
      <div class="due-badge zero">+ Add</div>
    `;
    row.querySelector("h3").textContent = s.name;
    row.querySelector(".meta").textContent = `${s.cards.length} cards · sample`;
    row.addEventListener("click", () => {
      const d = makeSampleDeck(s);
      store.decks.unshift(d);
      persist();
      go("edit/" + d.id);
    });
    sampleList.appendChild(row);
  }

  // File upload
  const fileInput = document.getElementById("homeFile");
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const cards = parseCSV(text);
      if (!cards.length) { toast("No cards found in file"); return; }
      const name = file.name.replace(/\.(csv|tsv|txt)$/i, "");
      const d = newDeck(name, cards);
      ensureCardIds(d);
      store.decks.unshift(d);
      persist();
      go("edit/" + d.id);
    } catch (err) {
      toast("Couldn't read file");
    } finally {
      fileInput.value = "";
    }
  });

  viewEl.querySelector('[data-action="ai"]').onclick = () => {
    const promptText = `Make me 20 flashcards on [TOPIC].
Output format: one card per line.
Put the question (front) and answer (back) on the same line, separated by " | " (space-pipe-space).
No numbering, no headers, no markdown, no extra commentary.

Example output:
What is photosynthesis? | The process by which plants convert sunlight into chemical energy.
Define mitochondria | Organelles in cells that produce ATP energy.
Year the US Constitution was signed | 1787`;
    openModal({
      title: "Make cards with AI",
      body: `<p style="color:var(--ink-soft);font-size:14px;margin:0 0 10px;">
               Paste this prompt into <strong>ChatGPT</strong>, <strong>Claude</strong>, <strong>Gemini</strong>, or any AI chatbot.
               Replace <code>[TOPIC]</code> with what you want to study.
             </p>
             <textarea id="aiPrompt" readonly style="min-height:160px;font-family:ui-monospace,Menlo,monospace;font-size:13px;"></textarea>
             <ol style="color:var(--ink-soft);font-size:13px;line-height:1.7;margin:12px 0 0;padding-left:20px;">
               <li>Copy the prompt above and send it to your AI.</li>
               <li>Copy the AI's reply.</li>
               <li>Come back here and click <strong>Paste CSV</strong> — or save the reply as a <code>.txt</code> file and use <strong>Upload file</strong>.</li>
             </ol>`,
      actions: [
        { label: "Close", onClick: closeModal },
        { label: "Copy prompt", primary: true, onClick: async () => {
            try { await navigator.clipboard.writeText(promptText); toast("Prompt copied"); }
            catch { toast("Copy failed — select and copy manually"); }
        }},
      ],
      onShow: () => { document.getElementById("aiPrompt").value = promptText; },
    });
  };

  viewEl.querySelector('[data-action="paste"]').onclick = () => {
    openModal({
      title: "Paste a shared link",
      body: `<p style="color:var(--ink-soft);font-size:14px;margin:0 0 8px;">Paste a flashcards link from a classmate.</p>
             <input type="text" id="modalLink" placeholder="https://...#d=..." />`,
      actions: [
        { label: "Cancel", onClick: closeModal },
        { label: "Open deck", primary: true, onClick: () => {
            const v = document.getElementById("modalLink").value.trim();
            const m = v.match(/#d=([A-Za-z0-9\-_]+)/);
            if (!m) { toast("Couldn't read that link"); return; }
            closeModal();
            go("d=" + m[1]);
        }},
      ],
    });
  };
}

// ---------- edit ----------
function renderEdit(id) {
  const deck = getDeck(id);
  if (!deck) { go("home"); return; }
  ensureCardIds(deck);

  viewEl.innerHTML = "";
  viewEl.appendChild(tpl("tpl-edit"));

  const nameInput = document.getElementById("deckName");
  nameInput.value = deck.name;
  nameInput.addEventListener("input", () => { deck.name = nameInput.value; persist(); });

  const meta = document.getElementById("deckMeta");
  function updateMeta() {
    const due = dueCards(deck).length;
    meta.textContent = `${deck.cards.length} card${deck.cards.length === 1 ? "" : "s"} · ${due} due now`;
  }
  updateMeta();

  const editor = document.getElementById("cardEditor");
  function renderCards() {
    editor.innerHTML = "";
    deck.cards.forEach((card, idx) => {
      const row = document.createElement("div");
      row.className = "card-pair";
      row.innerHTML = `
        <textarea class="front" rows="1" placeholder="Front"></textarea>
        <textarea class="back" rows="1" placeholder="Back"></textarea>
        <button class="remove" aria-label="Remove card">×</button>
      `;
      const fEl = row.querySelector(".front");
      const bEl = row.querySelector(".back");
      fEl.value = card.f;
      bEl.value = card.b;
      const autosize = (el) => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
      requestAnimationFrame(() => { autosize(fEl); autosize(bEl); });
      fEl.addEventListener("input", () => { card.f = fEl.value; autosize(fEl); persist(); });
      bEl.addEventListener("input", () => { card.b = bEl.value; autosize(bEl); persist(); });
      row.querySelector(".remove").addEventListener("click", () => {
        deck.cards.splice(idx, 1);
        delete deck.srs[card.id];
        persist();
        renderCards();
        updateMeta();
      });
      editor.appendChild(row);
    });
    if (!deck.cards.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No cards yet. Add one below, or import from CSV.";
      editor.appendChild(empty);
    }
  }
  renderCards();

  viewEl.querySelector('[data-action="addCard"]').onclick = () => {
    const c = { id: uid(), f: "", b: "" };
    deck.cards.push(c);
    persist();
    renderCards();
    updateMeta();
    // focus the new front input
    const lastFront = editor.querySelectorAll(".front");
    if (lastFront.length) lastFront[lastFront.length - 1].focus();
  };

  viewEl.querySelector('[data-action="study"]').onclick = () => {
    if (!deck.cards.length) { toast("Add some cards first"); return; }
    go("study/" + deck.id);
  };

  viewEl.querySelector('[data-action="share"]').onclick = async () => {
    if (!deck.cards.length) { toast("Add cards before sharing"); return; }
    const encoded = await encodeDeck(deck);
    const url = `${location.origin}${location.pathname}#d=${encoded}`;
    openModal({
      title: "Share this deck",
      body: `<p style="color:var(--ink-soft);font-size:14px;margin:0 0 8px;">Anyone with this link can open the deck. The cards live inside the URL — no server needed.</p>
             <textarea id="modalShare" readonly></textarea>
             <p style="font-size:12px;color:var(--ink-faint);margin:8px 0 0;">Length: ${url.length.toLocaleString()} characters${url.length > 6000 ? " — some chat apps may truncate very long links." : ""}</p>`,
      actions: [
        { label: "Close", onClick: closeModal },
        { label: "Shorten", onClick: async () => {
            const ta = document.getElementById("modalShare");
            const long = ta.value;
            ta.disabled = true;
            try {
              const r = await fetch("https://is.gd/create.php?format=simple&url=" + encodeURIComponent(long));
              const text = (await r.text()).trim();
              if (!r.ok || !text.startsWith("http")) throw new Error(text || "shortener failed");
              ta.value = text;
              toast("Shortened to " + text.length + " chars");
            } catch (e) {
              toast("Couldn't shorten — paste into tinyurl.com instead");
            } finally {
              ta.disabled = false;
            }
        }},
        { label: "Copy link", primary: true, onClick: async () => {
            const ta = document.getElementById("modalShare");
            try { await navigator.clipboard.writeText(ta.value); toast("Link copied"); }
            catch { toast("Copy failed — select and copy manually"); }
        }},
      ],
      onShow: () => { document.getElementById("modalShare").value = url; },
    });
  };

  viewEl.querySelector('[data-action="csvAppend"]').onclick = () => {
    const text = document.getElementById("csvInput").value;
    const cards = parseCSV(text);
    if (!cards.length) { toast("No cards found"); return; }
    for (const c of cards) deck.cards.push({ id: uid(), f: c.f, b: c.b });
    document.getElementById("csvInput").value = "";
    persist();
    renderCards();
    updateMeta();
    toast(`Added ${cards.length} card${cards.length === 1 ? "" : "s"}`);
  };
  const editFile = document.getElementById("editFile");
  editFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const csv = document.getElementById("csvInput");
      csv.value = csv.value ? csv.value + "\n" + text : text;
      toast(`Loaded ${file.name} into the text box`);
    } catch {
      toast("Couldn't read file");
    } finally {
      editFile.value = "";
    }
  });

  viewEl.querySelector('[data-action="csvReplace"]').onclick = () => {
    const text = document.getElementById("csvInput").value;
    const cards = parseCSV(text);
    if (!cards.length) { toast("No cards found"); return; }
    if (!confirm(`Replace all ${deck.cards.length} card(s) with ${cards.length} new card(s)?`)) return;
    deck.cards = cards.map(c => ({ id: uid(), f: c.f, b: c.b }));
    deck.srs = {};
    document.getElementById("csvInput").value = "";
    persist();
    renderCards();
    updateMeta();
  };

  viewEl.querySelector('[data-action="delete"]').onclick = () => {
    if (!confirm(`Delete deck "${deck.name || "Untitled"}"? This cannot be undone.`)) return;
    store.decks = store.decks.filter(d => d.id !== deck.id);
    persist();
    go("home");
  };
}

// ---------- study (with SRS persistence) ----------
function renderStudy(id) {
  const deck = getDeck(id);
  if (!deck) { go("home"); return; }
  ensureCardIds(deck);
  runStudySession(deck, /*persistSrs=*/true, /*backRoute=*/"edit/" + deck.id);
}

// study a deck imported from URL without saving — SRS is in-memory only
let _ephemeralDeck = null;
function renderStudyOnce(id) {
  if (!_ephemeralDeck || _ephemeralDeck._tempId !== id) { go("home"); return; }
  runStudySession(_ephemeralDeck, /*persistSrs=*/false, /*backRoute=*/"home");
}

function runStudySession(deck, persistSrs, backRoute) {
  viewEl.innerHTML = "";
  viewEl.appendChild(tpl("tpl-study"));

  // Build session queue: all due cards (or all cards if none due, treat as study-all)
  let queue = dueCards(deck);
  if (!queue.length) queue = [...deck.cards];
  // Shuffle for variety
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }

  const total = queue.length;
  let answered = 0;
  let againCount = 0;
  const stats = { again: 0, hard: 0, good: 0, easy: 0 };

  const cardEl = document.getElementById("flashcard");
  const frontEl = document.getElementById("cardFront");
  const backEl = document.getElementById("cardBack");
  const hintEl = document.getElementById("cardHint");
  const rateRow = document.getElementById("rateRow");
  const progress = document.getElementById("progressBar");
  const statsEl = document.getElementById("studyStats");
  const donePanel = document.getElementById("donePanel");
  const doneSummary = document.getElementById("doneSummary");

  let flipped = false;
  let current = null;

  function showNext() {
    if (!queue.length) return finish();
    current = queue.shift();
    flipped = false;
    frontEl.textContent = cleanDisplay(current.f) || "(empty front)";
    backEl.textContent = cleanDisplay(current.b) || "(empty back)";
    backEl.hidden = true;
    hintEl.style.display = "";
    rateRow.hidden = true;
    progress.style.width = `${(answered / total) * 100}%`;
    statsEl.textContent = `${answered} / ${total}`;
  }
  function flip() {
    if (flipped) return;
    flipped = true;
    backEl.hidden = false;
    hintEl.style.display = "none";
    rateRow.hidden = false;
    // Fill next-interval previews per rating
    const srs = deck.srs[current.id];
    for (const r of ["again", "hard", "good", "easy"]) {
      const sub = rateRow.querySelector(`[data-interval="${r}"]`);
      if (sub) sub.textContent = previewInterval(srs, r);
    }
  }
  function rate(label) {
    if (!flipped) return;
    stats[label]++;
    if (label === "again") {
      againCount++;
      // Re-show this card later in the session
      queue.push(current);
    }
    const prev = deck.srs[current.id];
    const next = rateCard(prev, label);
    deck.srs[current.id] = next;
    if (persistSrs) persist();
    answered++;
    showNext();
  }
  function finish() {
    cardEl.hidden = true;
    rateRow.hidden = true;
    progress.style.width = "100%";
    statsEl.textContent = `${total} reviewed`;
    donePanel.hidden = false;
    const lines = [];
    lines.push(`${total} card${total === 1 ? "" : "s"} reviewed.`);
    if (stats.again) lines.push(`${stats.again} marked Again.`);
    doneSummary.textContent = lines.join(" ");
  }

  cardEl.addEventListener("click", flip);
  cardEl.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); }
  });
  document.addEventListener("keydown", keyHandler);
  function keyHandler(e) {
    if (currentRoute().startsWith("study") === false) {
      document.removeEventListener("keydown", keyHandler);
      return;
    }
    if (!flipped) return;
    if (e.key === "1") rate("again");
    else if (e.key === "2") rate("hard");
    else if (e.key === "3") rate("good");
    else if (e.key === "4") rate("easy");
  }

  rateRow.querySelectorAll(".rate").forEach(btn => {
    btn.addEventListener("click", () => rate(btn.dataset.rate));
  });

  donePanel.querySelector('[data-action="restart"]').onclick = () => runStudySession(deck, persistSrs, backRoute);
  donePanel.querySelector('[data-action="back"]').onclick = () => go(backRoute);

  // Top nav: exit + help
  viewEl.querySelector('[data-action="exit"]').onclick = () => go(backRoute);
  viewEl.querySelector('[data-action="help"]').onclick = () => {
    openModal({
      title: "How rating works",
      body: `<p style="margin:0 0 10px;color:var(--ink-soft);font-size:14px;">After you flip a card, choose how well you remembered. This sets when you'll see the card again (spaced repetition).</p>
             <ul style="margin:0;padding-left:18px;color:var(--ink-soft);font-size:14px;line-height:1.7;">
               <li><strong style="color:var(--bad);">Again</strong> — forgot. See it shortly.</li>
               <li><strong style="color:var(--warn);">Hard</strong> — recalled with effort. Short interval.</li>
               <li><strong style="color:var(--good);">Good</strong> — recalled normally. Standard interval.</li>
               <li><strong style="color:var(--easy);">Easy</strong> — knew it instantly. Long interval.</li>
             </ul>
             <p style="margin:12px 0 0;color:var(--ink-faint);font-size:13px;">Keyboard: 1 / 2 / 3 / 4 · Space to flip.</p>`,
      actions: [{ label: "Got it", primary: true, onClick: closeModal }],
    });
  };

  showNext();
}

// ---------- import (from URL hash #d=...) ----------
async function renderImport(encoded) {
  viewEl.innerHTML = "";
  viewEl.appendChild(tpl("tpl-import"));
  const previewEl = document.getElementById("importPreview");

  let deck;
  try {
    deck = await decodeDeck(encoded);
  } catch (e) {
    previewEl.textContent = "Couldn't read this link. It may be corrupted or incomplete.";
    viewEl.querySelector('[data-action="save"]').disabled = true;
    viewEl.querySelector('[data-action="studyOnce"]').disabled = true;
    viewEl.querySelector('[data-action="cancel"]').onclick = () => go("home");
    return;
  }

  previewEl.innerHTML = `<strong>${escapeHtml(cleanDisplay(deck.name) || "Untitled deck")}</strong> — ${deck.cards.length} card${deck.cards.length === 1 ? "" : "s"}.`;

  viewEl.querySelector('[data-action="save"]').onclick = () => {
    store.decks.unshift(deck);
    persist();
    go("edit/" + deck.id);
  };
  viewEl.querySelector('[data-action="studyOnce"]').onclick = () => {
    deck._tempId = uid();
    _ephemeralDeck = deck;
    go("study-once/" + deck._tempId);
  };
  viewEl.querySelector('[data-action="cancel"]').onclick = () => go("home");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// ---------- modal ----------
function openModal({ title, body, actions, onShow }) {
  const modal = document.getElementById("modal");
  document.getElementById("modalTitle").textContent = title || "";
  document.getElementById("modalBody").innerHTML = body || "";
  const actEl = document.getElementById("modalActions");
  actEl.innerHTML = "";
  (actions || []).forEach(a => {
    const b = document.createElement("button");
    b.className = "btn" + (a.primary ? " primary" : "");
    b.textContent = a.label;
    b.onclick = a.onClick;
    actEl.appendChild(b);
  });
  modal.hidden = false;
  modal.querySelector("[data-close]").onclick = closeModal;
  if (onShow) onShow();
}
function closeModal() {
  document.getElementById("modal").hidden = true;
}

// ---------- toast ----------
let toastTimer = null;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------- topbar ----------
document.getElementById("homeBtn").addEventListener("click", () => go("home"));

// ---------- boot ----------
render();
