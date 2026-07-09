/* ============================================================
   STELLAR FRONTIER — persistence
   Saving and loading the run: the localStorage autosave (saveGame/
   loadGame), the Captain's Log narrative-dossier export for handing
   to an LLM (playerArchetype/buildJournalText/downloadJournal), the
   portable save-file export/import as a downloadable .json a captain
   owns (buildSaveText/parseSaveText/exportSave/importSave), and the
   load-boundary sanitizer (sanitizeLoadedState) every loaded save
   passes through before anything in it can reach the DOM.
   newGame(), init(), and the rest of the game shell (tab disclosure,
   version check, help/changelog UI) stay in game.js — this file is
   purely the read/write side of game state.

   Loaded after renderFleetFortunes.js, before game.js. S, currentOffice,
   fmt, netWorth, pollutionOf, reserveFrac, toast and init() still live
   in other files/game.js at this point in the split — safe, since
   every function here is only CALLED later (by a player action or
   game.js's init(), once every script has finished loading), same
   pattern as every prior slice.
   ============================================================ */

"use strict";

const SAVE_KEY = "stellar-frontier-save-v2";
/* ---- Captain's Log: export a narrative dossier for an LLM ---- */
function playerArchetype() {
  const P = S.pirate || {}, nCol = Object.keys(S.colonies || {}).length;
  if (S.legacyTitle) return S.legacyTitle;
  if (S.office >= 2 || (S.orgs && S.orgs.party)) return "Politician";
  if ((P.raids || 0) >= 8 || (P.plundered || 0) >= 20000) return "Pirate";
  if (nCol >= 1) return "Colonial Founder";
  const visited = Object.keys(S.visited || {}).length;
  if (visited >= 8) return "Explorer";
  return "Free Trader";
}
function buildJournalText() {
  const L = [];
  const arche = playerArchetype();
  L.push(`# Captain's Log — ${arche}`);
  L.push(`*S.S. Wanderer · Cycle ${S.turn}*`);
  L.push("");
  L.push("> A chronicle of one captain's passage through the sector. Hand this");
  L.push("> dossier to an AI (e.g. Anthropic's Claude) with the prompt at the end");
  L.push("> to spin it into a biography or a novel.");
  L.push("");

  // A self-contained primer so an AI with no knowledge of this game can write faithfully
  L.push("## The Universe (a primer for the storyteller)");
  L.push("*This is an invented science-fiction setting; everything you need is below.*");
  L.push("");
  L.push("**The setting.** A single contested star sector on the frontier of known space, generations after the great expansion. A scatter of worlds — garden capitals, ice moons, mining hells, gas giants, ancient ruins and untamed frontiers — strung along fuel-hungry jump lanes, with no single power fully in control. The protagonist commands a lone starship, the *S.S. Wanderer*, and rises by any mix of trade, exploration, colonization, politics and outright piracy.");
  L.push("");
  L.push("**The five powers.** The Core Authority (lawful inner-world government), the Mining Guild (ore and heavy industry), the Agri-Combine (food and fair trade), the Tech Syndicate (electronics, research and discreet dealings) and the Frontier Coalition (the free, smuggler-friendly rim). The captain's standing with each is listed under *The Powers*.");
  L.push("");
  L.push("**Time & money.** Time is measured in *cycles*; every dated entry below is a cycle. Money is *credits* (cr).");
  L.push("");
  L.push("**The economy.** Worlds trade commodities along a production chain: raw materials (ore, ice, biomass, gas, crystals, radioactives, spice, relics) are refined (metals, energy, fuel, chemicals, medicine) and built into components (alloys, electronics) and finished goods (consumer goods, machinery, weapons, luxuries, antimatter). Prices float with local supply, demand, industry and law, and big deals move the market.");
  L.push("");
  L.push("**Resources & ecology.** Deposits are finite: mining drains a world's reserves and its yields fall, so over-exploitation makes goods scarce and dear; left alone, worlds slowly recover. Industry breeds *pollution*, and the sector's aggregate pollution drives a *climate stress* that withers farms everywhere — a constant pressure to settle fresh worlds rather than bleed the old ones dry.");
  L.push("");
  L.push("**Crises.** Disasters strike worlds — earthquakes, volcanic eruptions, plagues, industrial accidents, civil unrest, famines, mine collapses — disrupting them and spiking the prices of what they suddenly need. A captain may bring relief and earn a people's gratitude, or profiteer from their desperation.");
  L.push("");
  L.push("**Terms used in the chronicle.**");
  L.push("- *Reputation*: standing with a faction (allied → friendly → neutral → resentful → hostile).");
  L.push("- *Influence* (political capital); *Popularity* & *Legitimacy* (a politician's public support and lawful mandate); *Heat* (official scrutiny that invites investigation); *Office* (rank won by election, appointment or force, from Councillor up to Consul).");
  L.push("- *Wanted* (how hard the law hunts you); *Dread* (how feared you are as a pirate); *Haven* (a hidden pirate base); *Letter of marque* (a licence to raid a faction's rivals legally).");
  L.push("- *Colony* (a world you settle and grow — population, happiness, industry); *Reserves* (a deposit's remaining stock); *Pollution / Climate* (the ecological harm left behind).");
  L.push("");

  // The setting
  L.push("## The Sector");
  PLANETS.filter(isActive).forEach(p => {
    const deps = Object.keys(p.deposits || {}).map(c => `${COM[c].name} ${Math.round(reserveFrac(p.id, c) * 100)}%`).join(", ") || "none";
    const law = p.enforce > 0.7 ? "strict law" : p.enforce < 0.25 ? "lawless" : "patrolled";
    const tags = [];
    if (S.colonies && S.colonies[p.id]) tags.push(`YOUR COLONY (pop ${Math.round(S.colonies[p.id].pop)}k)`);
    if (S.crises && S.crises[p.id]) tags.push(`in crisis: ${CRISES[S.crises[p.id].type].name}`);
    const poll = pollutionOf(p.id);
    if (poll >= 25) tags.push(`${poll >= 60 ? "heavily polluted" : "polluted"}`);
    L.push(`- **${p.name}** (${p.tag}; ${FACTIONS[p.faction].name}; ${law}) — deposits: ${deps}.${tags.length ? " " + tags.join("; ") + "." : ""}`);
  });
  L.push("");

  // The powers
  L.push("## The Powers (factions & your standing)");
  Object.keys(FACTIONS).forEach(f => {
    const r = Math.round(S.rep[f] || 0);
    const word = r >= 50 ? "allied" : r >= 20 ? "friendly" : r <= -50 ? "hostile" : r <= -20 ? "resentful" : "neutral";
    L.push(`- ${FACTIONS[f].name}: ${word} (${r}). ${FACTIONS[f].desc}`);
  });
  L.push("");

  // Where the captain stands
  L.push("## The Captain, at Cycle " + S.turn);
  L.push(`- Path: **${arche}**${S.legacyTitle ? ` — legend earned: *${S.legacyTitle}*` : ""}`);
  L.push(`- Wealth: ${fmt(S.res.credits)} cr on hand · net worth ${fmt(netWorth())} cr`);
  if (S.office && typeof currentOffice === "function" && currentOffice()) L.push(`- Office: ${currentOffice().name} (popularity ${Math.round(S.pol.popularity)}, legitimacy ${Math.round(S.pol.legitimacy)})`);
  const P = S.pirate || {};
  if ((P.raids || 0) > 0 || (P.dread || 0) > 0) L.push(`- Outlaw record: ${P.raids} raids, ${fmt(P.plundered)} cr plundered, Wanted ${P.wanted}, Dread ${P.dread}${S.haven ? `, haven at ${PLANETS.find(p => p.id === S.haven.planet).name}` : ""}`);
  const cols = Object.keys(S.colonies || {});
  if (cols.length) L.push(`- Colonies founded: ${cols.map(id => PLANETS.find(p => p.id === id).name).join(", ")}`);
  const techn = Object.keys(S.techs || {}).filter(t => S.techs[t]).length;
  L.push(`- Voyages: ${S.stats.jumps} jumps · ${S.stats.trades} trades · ${techn} technologies · sector climate stress ${Math.round(S.climate || 0)}`);
  L.push("");

  // The chronicle
  L.push("## The Chronicle");
  const j = S.journal || [];
  if (!j.length) L.push("*(No entries yet — the voyage has only just begun.)*");
  else j.forEach(e => L.push(`- **Cycle ${e.turn}.** ${e.text}`));
  L.push("");

  // The ask
  L.push("---");
  L.push("## Prompt for your AI storyteller");
  L.push("```");
  L.push(`You are a science-fiction novelist. Using the captain's log above —`);
  L.push(`the sector, the factions, the captain's standing, and the chronicle of`);
  L.push(`events — write the biography of this ${arche.toLowerCase()} of the stars.`);
  L.push(`Stay faithful to the recorded events, names and worlds; invent the`);
  L.push(`inner life, dialogue and texture around them. Give it a title.`);
  L.push("```");
  return L.join("\n");
}
function downloadJournal() {
  const text = buildJournalText();
  if (typeof document === "undefined" || !document.body || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    if (typeof toast === "function") toast("Journal export unavailable here.", "bad");
    return text;
  }
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `captains-log-cycle-${S.turn}.md`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (typeof toast === "function") toast("Captain's log downloaded.", "good");
  return text;
}
/* ============================================================
   SAVE / LOAD TO DISK — the autosave lives in localStorage (one slot, tied to
   this browser). These let a captain export the run to a .json file they own:
   a backup, a way to move between machines/browsers, or to keep many saves.
   Importing replaces the autosave and reloads so init() normalises cleanly.
   ============================================================ */
const SAVE_FILE_TAG = "stellar-frontier-save";
function buildSaveText() {
  // a small envelope so the file is self-describing and future-proof
  return JSON.stringify({
    game: SAVE_FILE_TAG,
    version: SAVE_VERSION,
    exported: new Date().toISOString(),
    cycle: S.turn,
    credits: S.res && S.res.credits,
    state: S,
  }, null, 2);
}
function looksLikeState(o) {
  return !!o && typeof o === "object" && o.res && typeof o.res === "object"
    && o.location !== undefined && o.upgrades && typeof o.upgrades === "object";
}
function parseSaveText(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "Not a valid save file (could not read JSON)." }; }
  // accept our envelope, or a bare state object (forgiving)
  const state = data && data.state !== undefined ? data.state : data;
  if (data && data.game && data.game !== SAVE_FILE_TAG) return { ok: false, error: "This file is not a Stellar Frontier save." };
  if (!looksLikeState(state)) return { ok: false, error: "This file doesn't contain a valid Stellar Frontier save." };
  return { ok: true, state: state };
}
function exportSave() {
  if (typeof saveGame === "function") saveGame();   // capture the very latest state
  const text = buildSaveText();
  if (typeof document === "undefined" || !document.body || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    if (typeof toast === "function") toast("Save export unavailable here.", "bad");
    return text;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${SAVE_FILE_TAG}-cycle-${S.turn}-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (typeof toast === "function") toast("Game saved to disk.", "good");
  return text;
}
// testable core: validate text, sanitize, persist to the autosave slot. Returns {ok,error}.
function importSaveText(text) {
  const res = parseSaveText(text);
  if (!res.ok) return res;
  const clean = sanitizeLoadedState(res.state);   // loadGame() sanitizes too — this just keeps the stored blob clean
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(clean)); }
  catch (e) { return { ok: false, error: "Could not write the save to this browser." }; }
  return { ok: true, state: clean };
}
function importSave() {
  if (typeof document === "undefined" || !document.createElement || typeof FileReader === "undefined") {
    if (typeof toast === "function") toast("Save import unavailable here.", "bad");
    return;
  }
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json,.json"; input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = importSaveText(String(reader.result || ""));
      if (!res.ok) { if (typeof toast === "function") toast(res.error || "Import failed.", "bad"); input.remove(); return; }
      if (typeof confirm === "function" && !confirm("Load this save? It will replace your current game (cycle " + (res.state.turn != null ? res.state.turn : "?") + "). The page will reload.")) { input.remove(); return; }
      if (typeof toast === "function") toast("Save loaded — reloading…", "good");
      if (typeof location !== "undefined" && location.reload) location.reload();
    };
    reader.onerror = () => { if (typeof toast === "function") toast("Could not read that file.", "bad"); };
    reader.readAsText(file);
  });
  if (document.body) document.body.appendChild(input);
  input.click();
}
/* ============================================================
   LOAD-BOUNDARY SANITIZING — a save file is the one input the game accepts
   from outside (players share them), and much of what's inside ends up in
   innerHTML or interpolated into onclick="fn('${id}')" attributes. Everything
   read from the autosave slot passes through sanitizeLoadedState() first:
   - log entries keep only the markup the game itself writes (<b>, <i>,
     <span class="…">) — every other tag (scripts, images, handlers) is
     stripped — and their type must be one of the game's own log classes;
   - journal entries stay plain text (jot() already writes them that way; it's
     enforced here so a crafted file can't smuggle tags into the dossier);
   - every other string VALUE anywhere in the state loses the characters that
     could break out of markup or a handler-string argument (< > " ' `), and
     an object KEY containing one drops its whole entry — keys become the
     '${id}' onclick arguments, and no legitimate save has such keys.
   A healthy save passes through byte-identical (see test/sanitize.test.js).
   ============================================================ */
const LOG_TYPES = ["", "good", "bad", "event"];
const UNSAFE_CHARS = /[<>"'`]/;
function sanitizeRichText(html) {
  return String(html).replace(/<[^>]*>?/g, tag => {
    const m = /^<(\/?)(b|i|span)(?:\s+class="([\w -]*)")?\s*>$/i.exec(tag);
    if (!m) return "";
    const name = m[2].toLowerCase();
    return m[1] ? `</${name}>` : (m[3] != null ? `<${name} class="${m[3]}">` : `<${name}>`);
  });
}
function sanitizePlainText(text) { return String(text).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
function stripUnsafeStrings(node, seen) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  for (const k of Object.keys(node)) {
    if (UNSAFE_CHARS.test(k)) { delete node[k]; continue; }
    const v = node[k];
    if (typeof v === "string") { if (UNSAFE_CHARS.test(v)) node[k] = v.replace(/[<>"'`]/g, ""); }
    else stripUnsafeStrings(v, seen);
  }
}
function sanitizeLoadedState(s) {
  if (!s || typeof s !== "object") return s;
  s.log = (Array.isArray(s.log) ? s.log : []).filter(e => e && typeof e === "object").map(e => ({
    msg: sanitizeRichText(e.msg == null ? "" : e.msg),
    type: LOG_TYPES.includes(e.type) ? e.type : "",
    turn: Number.isFinite(e.turn) ? e.turn : 0,
  }));
  s.journal = (Array.isArray(s.journal) ? s.journal : []).filter(e => e && typeof e === "object").map(e => ({
    turn: Number.isFinite(e.turn) ? e.turn : 0,
    cat: sanitizePlainText(e.cat == null ? "" : e.cat).replace(/[<>"'`]/g, ""),
    text: sanitizePlainText(e.text == null ? "" : e.text),   // never rendered as HTML (download-only), so quotes stay
  }));
  stripUnsafeStrings(s, new Set([s.log, s.journal]));   // rich/plain handling above already covered these two
  return s;
}
let _saveIndicatorTimer = null;
function flashSaveIndicator() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("saveIndicator");
  if (!el) return;
  el.classList.add("show");
  clearTimeout(_saveIndicatorTimer);
  _saveIndicatorTimer = setTimeout(() => el.classList.remove("show"), 1500);
}
let _autosaveFailing = false;   // warn once per failure streak, not on every action
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(S));
    _autosaveFailing = false;
    flashSaveIndicator();
  } catch (e) {
    if (_autosaveFailing) return;
    _autosaveFailing = true;
    if (typeof console !== "undefined" && console.warn) console.warn("Autosave failed:", e);
    if (typeof toast === "function") toast("⚠️ Autosave failed — this browser couldn't store the game. Use 💾 Save to keep your progress.", "bad");
  }
}
const RECOVERY_KEY = SAVE_KEY + "-recovery";
function loadGame() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!looksLikeState(parsed)) throw new Error("not a game state");
    S = sanitizeLoadedState(parsed);
    return true;
  } catch (e) {
    // An unreadable autosave would otherwise be overwritten by the fresh game's
    // first autosave — keep the blob so the run stays recoverable by hand.
    try { localStorage.setItem(RECOVERY_KEY, raw); } catch (e2) {}
    if (typeof console !== "undefined" && console.warn) console.warn(`Could not read the autosave — a copy was kept under "${RECOVERY_KEY}".`, e);
    if (typeof toast === "function") toast("⚠️ Your saved game couldn't be read, so a fresh one is starting. The old save was preserved for recovery.", "bad");
    return false;
  }
}
