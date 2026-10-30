// Gebruik: node test/run.js [pad-naar-App.js]
const path = require("path");
const fs = require("fs");
const env = require("./env");
const { speech } = env;
const React = require("react");
const esbuild = require("esbuild");
const RTL = require("@testing-library/react");
const { render, screen, fireEvent, cleanup, act } = RTL;
// De tijdschaal in env.js maakt app-timers >= 1 s twintig keer korter. De wachttijden van de test zelf mogen
// daar NIET door korter worden: ze worden hier terug x20 gedaan, zodat ze echt (standaard) 1 s of de opgegeven tijd duren.
const waitFor = (fn, o) => RTL.waitFor(fn, { ...o, timeout: ((o && o.timeout) || 1000) * 20 });

const APP_PATH = path.resolve(process.argv[2] || path.join(__dirname, "..", "src", "App.js"));
const BUILD_DIR = path.join(__dirname, ".build-" + process.pid);   // eigen map per proces: parallel draaien kan dan niet botsen
process.on("exit", () => { try { fs.rmSync(BUILD_DIR, { recursive: true, force: true }); } catch (e) {} });
fs.mkdirSync(BUILD_DIR, { recursive: true });

// ---- bundelen: App.js ongewijzigd + onderaan een export van interne helpers (enkel voor de test) ----
const src = fs.readFileSync(APP_PATH, "utf8");
const FOOTER = `
export const __T = { APP_VERSIE, ALL_QUIZ_QUESTIONS, SAFARI_MISSIES, friendlyErrorMessage, shuffleOptions,
  pickNextMissionIndex, normGift, giftTekst, giftInfo, cleanForSpeech, voiceScore, GIFT_NA_CONTACT, quizText,
  resultText, stemOpties, pickOption, shuffleArray, getMissieList, FALLBACK_KEYS, DEVELOPER_OVERRIDE_PIN, LS_KEYS,
  isPaddenstoel, makeBackup, parseBackup, mergeHistory, bouwAlbum, albumBadge, buildScanQuiz, klasseCanon, saveHistory,
  loadStats, updateStats, EET_WAARSCHUWING, PADDENSTOEL_WAARSCHUWING, ErrorBoundary, cleanEntry, asText, SAFARI_SEIZOEN, huidigSeizoen, SEIZOEN_NAAM, gevaarWaarschuwingen, GEVAAR_SOORTEN,
  normGezond, gezondheidToestand, herfstNotitie, GEZOND_UITLEG,
  giftControle, problemenInTekst, latijnUit, vergelijkBronnen, bouwPlantControles, bouwDierControles, cleanControles, BEKENDE_GIFTIG,
  loadDiag, logDiag, makeDiagExport, DIAG_KEY, diagVoorScan, plantNetZiekteItems, plantNetFoutTekst, scherpteScore };
`;
const entry = path.join(BUILD_DIR, "entry.js");
fs.writeFileSync(entry, src + "\n" + FOOTER);
const outFile = path.join(BUILD_DIR, "app.cjs");
esbuild.buildSync({
  entryPoints: [entry], bundle: true, outfile: outFile, format: "cjs", platform: "node",
  external: ["react", "react-dom"], loader: { ".js": "jsx" }, jsx: "transform", logLevel: "error",
});

function fresh() {
  cleanup();
  localStorage.clear();
  speech.voices = []; speech.spoken.length = 0; speech.cancelCount = 0; speech.silent = 0;
  global.__net.calls.length = 0; global.__net.handler = null;
  global.__cam.mode = "ok"; global.__cam.caps = { zoom: { min: 1, max: 5, step: 0.1 }, torch: true };
  global.__cam.applied.length = 0; global.__cam.stopped = 0; global.__cam.getUserMediaCalls.length = 0;
  global.__imageCapture.enabled = true; global.__imageCapture.calls = 0;
  global.__canvas.draws.length = 0; global.__canvas.dataUrlCalls.length = 0; global.__canvas.scherpOf = null; delete window.createImageBitmap;
  global.__downloads.length = 0; global.__lastBlob = null;
  global.__img.fail = false; global.__img.width = 3000; global.__img.height = 2000;
  window.confirm = () => true;
  delete require.cache[require.resolve(outFile)];
  const mod = require(outFile);
  return { App: mod.default, T: mod.__T };
}

// ---- mini-testkader ----
let checks = 0, failed = [];
const results = [];
const consoleErrors = new Map();
const origErr = console.error;
console.error = (...a) => {
  const m = String(a[0]).slice(0, 140);
  consoleErrors.set(m, (consoleErrors.get(m) || 0) + 1);
};
function ok(cond, label) {
  checks++;
  if (!cond) { failed.push(label); console.log("   ✗ " + label); }
}
function eq(a, b, label) { ok(a === b, `${label} (kreeg ${JSON.stringify(a)}, verwacht ${JSON.stringify(b)})`); }
const tests = [];
function test(name, kind, fn) { tests.push({ name, kind, fn }); }

const body = () => document.body.textContent;
const hasText = (re) => (re instanceof RegExp ? re.test(body()) : body().includes(re));
const waitText = (re, timeout = 3000) => waitFor(() => { if (!hasText(re)) throw new Error("tekst ontbreekt: " + re); }, { timeout });
const btn = (re) => screen.getAllByRole("button").find((b) => (re instanceof RegExp ? re.test(b.textContent) : b.textContent.includes(re)));
const click = (re) => { const b = btn(re); if (!b) throw new Error("knop niet gevonden: " + re); fireEvent.click(b); };
const gemOk = (obj) => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });
const isGemini = (u) => u.includes("workers.dev/gemini");
const geminiCalls = () => global.__net.calls.filter((c) => isGemini(c.url)).length;
function uploadFile(which) {
  const inputs = document.querySelectorAll('input[type="file"]');
  const f = new File(["x"], "foto.png", { type: "image/png" });
  fireEvent.change(inputs[which], { target: { files: [f] } });
}
const PLANT = {
  name: "Madeliefje", light: "Veel zon", soil: "Losse tuingrond", freq: "1x per week", amount: "Een glas water", tip: "Houd het vochtig",
  gezond: true, ziekte: "", oorzaak: "", oplossing: "",
  giftig: { mens: "licht", dier: "sterk", delen: "bladeren", symptomen: "Braken", omgang: "Draag handschoenen" },
};
const ANIMAL = {
  name: "Rode vos", scientificName: "Vulpes vulpes", klasse: "Zoogdier", familie: "Hondachtigen", leefgebied: "Bos", leeftijd: "2 jaar",
  weetje: "Vossen zien goed in het donker.", gezond: false, gezondheidsopmerking: "Lijkt kreupel.", verzorgingstip: "Houd afstand.",
};
const setKeys = (o) => {
  if (o.gemini) localStorage.setItem("plantscanner_gemini_key", o.gemini);
  if (o.plantId) localStorage.setItem("plantscanner_plantid_key", o.plantId);
  if (o.plantNet) localStorage.setItem("plantscanner_plantnet_key", o.plantNet);
};
const STRICT = !!process.env.STRICT;   // STRICT=1: zoals in jullie index.js (React.StrictMode)
const mount = (App) => render(React.createElement(STRICT ? React.StrictMode : React.Fragment, null, React.createElement(App)));
const setKids = () => click(/🧒 Uit/);

// =====================================================================================
// A. DATA EN BEVEILIGING (statisch)
// =====================================================================================
test("A1 versie en data-aantallen", "controle", () => {
  const { T } = fresh();
  eq(T.APP_VERSIE, "ontwikkel · v10.5", "APP_VERSIE");
  eq(T.ALL_QUIZ_QUESTIONS.length, 174, "aantal quizvragen (147 + 27 nieuwe)");
  const per = { 1: 0, 2: 0, 3: 0 };
  T.ALL_QUIZ_QUESTIONS.forEach((q) => { per[q.niveau] = (per[q.niveau] || 0) + 1; });
  ok(per[1] > 0 && per[2] > 0 && per[3] > 0, "alle 3 niveaus hebben vragen " + JSON.stringify(per));
  eq(per[1] + per[2] + per[3], 174, "niveaus samen = 174");
  eq(per[1] + "/" + per[2] + "/" + per[3], "66/56/52", "oude niveaus onveranderd, niveau 3 van 25 naar 52");
  const bad = T.ALL_QUIZ_QUESTIONS.filter((q) => !q.q || !Array.isArray(q.opts) || q.opts.length < 2 || !(q.correct >= 0 && q.correct < q.opts.length));
  eq(bad.length, 0, "alle vragen hebben tekst, opties en geldig juist-antwoord");
  eq(new Set(T.ALL_QUIZ_QUESTIONS.map((q) => q.q)).size, 174, "geen dubbele vraagteksten");
  const zonderWeetje = T.ALL_QUIZ_QUESTIONS.filter((q) => !q.weetje || q.weetje.length < 15 || q.weetje.length > 260);
  eq(zonderWeetje.length, 0, "elke vraag heeft een weetje (15-260 tekens)");
  const dubbeleOpts = T.ALL_QUIZ_QUESTIONS.filter((q) => new Set(q.opts).size !== q.opts.length);
  eq(dubbeleOpts.length, 0, "geen vraag met twee identieke antwoordopties");
  eq(Object.keys(T.SAFARI_MISSIES).join(","), "bos,park,dierentuin", "safari-gebieden");
  eq(T.SAFARI_MISSIES.bos.length, 30, "missies bos");
  eq(T.SAFARI_MISSIES.park.length, 25, "missies park");
  eq(T.SAFARI_MISSIES.dierentuin.length, 27, "missies dierentuin");
  console.log(`   (niveaus: ${JSON.stringify(per)})`);
});

test("A2 sleutels en pincodes (ongewijzigd)", "controle", () => {
  const { T } = fresh();
  ok(Object.values(T.FALLBACK_KEYS).every((v) => v === ""), "FALLBACK_KEYS zijn allemaal leeg");
  eq(T.DEVELOPER_OVERRIDE_PIN, "112233", "noodcode ongewijzigd (bewuste keuze)");
  ok(!/AIza[0-9A-Za-z_-]{30,}/.test(src), "geen Google-API-sleutel in de broncode");
  ok(!/\bsk-[A-Za-z0-9]{20,}/.test(src), "geen sk- sleutel in de broncode");
  ok(src.includes('|| "1234"'), "standaardpincode 1234 ongewijzigd");
  ok(src.includes("summer-snowflake-d2dc.yoericeulemans.workers.dev"), "Worker-URL aanwezig");
  ok(!/generativelanguage\.googleapis\.com/.test(src), "geen directe Google-URL (alles via Worker)");
});


test("A3 statische analyse: geen niet-gedefinieerde namen of dubbele definities", "controle", () => {
  const { execFileSync } = require("child_process");
  let uitvoer = "", gelukt = true;
  try {
    // eslint wordt gezocht naast dit bestand (tests/node_modules), zodat het ook werkt als het project zelf ook een eslint heeft
    const eslintDir = path.dirname(require.resolve("eslint/package.json", { paths: [__dirname] }));
    const eslintJs = path.join(eslintDir, "bin", "eslint.js");
    uitvoer = execFileSync(process.execPath, [eslintJs, "--no-eslintrc", "-c", path.join(__dirname, "eslintrc.json"), "--resolve-plugins-relative-to", path.resolve(eslintDir, "..", ".."), "--ext", ".js", APP_PATH], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "MODULE_NOT_FOUND") { console.log("   (eslint niet geinstalleerd: statische analyse overgeslagen)"); return; }
    gelukt = false; uitvoer = String(e.stdout || "") + String(e.stderr || "");
  }
  ok(gelukt, "eslint vond problemen:\n" + uitvoer.split("\n").filter((l) => /error/.test(l)).slice(0, 6).join("\n"));
});

// =====================================================================================
// B. LOSSE FUNCTIES
// =====================================================================================
test("B1 foutmeldingen voor kinderen", "controle", () => {
  const { T } = fresh();
  const f = T.friendlyErrorMessage;
  eq(f(""), "", "lege fout");
  ok(f("Gemini API-sleutel ontbreekt.").includes("ontbreekt een instelling"), "sleutel ontbreekt");
  ok(f("Plant niet herkend: API Fout (429): quota PerDay").includes("voor vandaag genoeg"), "dagelijks limiet");
  ok(f("API Fout (503): high demand").includes("even moe"), "503 -> even moe");
  ok(f("API Fout (429): rate_limit").includes("even moe"), "429 -> even moe");
  ok(f("Gemini niet bereikbaar: Failed to fetch").includes("Geen internetverbinding"), "geen netwerk");
  ok(f("Dier niet herkend: iets").includes("ik zie hier geen plant of dier"), "niet herkend");
  ok(f("onbekende rare fout").includes("Er ging iets mis"), "standaardmelding");
});

test("B2 quizhulp: husselen en missies", "controle", () => {
  const { T } = fresh();
  const q = { q: "x", opts: ["a", "b", "c", "d"], correct: 2 };
  let allOk = true, changed = false;
  for (let i = 0; i < 300; i++) {
    const r = T.shuffleOptions(q);
    if (r.opts[r.correct] !== "c" || [...r.opts].sort().join() !== "a,b,c,d") allOk = false;
    if (r.opts.join() !== q.opts.join()) changed = true;
  }
  ok(allOk, "juiste antwoord blijft juist na husselen (300x)");
  ok(changed, "volgorde verandert echt");
  const vast = { q: "y", opts: ["a", "b", "Geen van beide"], correct: 0 };
  ok(T.shuffleOptions(vast) === vast, "opties met 'geen van beide' blijven vast");
  const lijst = ["m1", "m2", "m3", "m4", "m5"];
  const eerste = []; let prev = -1;
  for (let i = 0; i < 5; i++) { prev = T.pickNextMissionIndex(lijst, prev, "t1"); eerste.push(prev); }
  eq(new Set(eerste).size, 5, "5 missies na elkaar zijn allemaal verschillend (geen herhaling)");
  let consecutive = false; prev = -1;
  for (let i = 0; i < 200; i++) { const n = T.pickNextMissionIndex(lijst, prev, "t2"); if (n === prev) consecutive = true; prev = n; }
  ok(!consecutive, "nooit twee keer dezelfde missie na elkaar (200x)");
  eq(T.pickNextMissionIndex(["enige"], -1, "t3"), 0, "lijst van 1 geeft 0");
  eq(T.pickNextMissionIndex([], -1, "t4"), 0, "lege lijst geeft 0");
});

test("B3 giftigheid en voorlezen-tekst", "controle", () => {
  const { T } = fresh();
  eq(T.normGift(null), null, "geen data -> null");
  eq(T.normGift({ mens: "RARE", dier: "Sterk" }).mens, "onbekend", "onbekend niveau -> onbekend");
  eq(T.normGift({ mens: "RARE", dier: "Sterk" }).dier, "sterk", "hoofdletters genormaliseerd");
  const gevaar = T.giftTekst(T.normGift({ mens: "matig", dier: "sterk", symptomen: "braken", omgang: "handschoenen" }), false);
  const onbekend = T.giftTekst(T.normGift({ mens: "onbekend", dier: "niet" }), false);
  const veilig = T.giftTekst(T.normGift({ mens: "niet", dier: "niet" }), false);
  ok(gevaar.includes("070 245 245") && gevaar.includes("112"), "gevaar: Antigifcentrum + 112");
  ok(onbekend.includes("070 245 245"), "onbekend: Antigifcentrum");
  ok(veilig.includes("070 245 245"), "veilig: Antigifcentrum");
  ok(T.giftTekst(null, true).includes("volwassene"), "kindermodus: vraag aan volwassene");
  ok(T.giftTekst(T.normGift({ mens: "niet", dier: "niet" }), false).includes("niet 100 procent zeker"), "disclaimer aanwezig");
  ok(["kapot", 5, [], { mens: {}, dier: [] }, { mens: "sterk" }, { mens: "RARE", dier: null }].every((x) => { try { return typeof T.giftTekst(x, true) === "string" && T.giftTekst(x, false).includes("070 245 245"); } catch (e) { return false; } }), "giftTekst crasht niet op kapotte gegevens en noemt altijd het Antigifcentrum");
  eq(T.giftInfo(T.normGift({ mens: "licht", dier: "niet" })).gevaar, true, "licht giftig telt als gevaar");
  eq(T.giftInfo(T.normGift({ mens: "niet", dier: "niet" })).gevaar, false, "niet giftig is geen gevaar");
  eq(T.cleanForSpeech("Hallo 🌱 wereld 🎉!"), "Hallo wereld !", "emoji's uit gesproken tekst");
  const nlM = { name: "Microsoft Maarten Online (Natural)", lang: "nl-NL", voiceURI: "x" };
  const nlV = { name: "Ellen", lang: "nl-BE", voiceURI: "y" };
  ok(T.voiceScore(nlM) > T.voiceScore(nlV), "mannenstem scoort hoger dan vrouwenstem");
  eq(T.voiceScore({ name: "US", lang: "en-US" }), -999, "niet-Nederlandse stem uitgesloten");
});

// =====================================================================================
// C. SCHERMEN EN KNOPPEN
// =====================================================================================
test("C1 startscherm", "controle", () => {
  const { App } = fresh(); mount(App);
  ok(hasText("v: ontwikkel · v10.5"), "versienummer onder de titel");
  for (const l of ["Scan Plant (Camera)", "Scan Dier (Camera)", "Upload Plant", "Upload Dier", "Geschiedenis (0)", "Instellingen"]) ok(hasText(l), "knop: " + l);
  ok(!hasText("Natuur Safari") && !hasText("Natuur Quiz"), "safari/quiz verborgen zonder kindermodus");
  const bar = btn("Instellingen").parentElement;
  eq(bar.style.flexWrap, "wrap", "knoppenbalk wrapt");
});

test("C2 kindermodus", "controle", () => {
  const { App } = fresh(); mount(App);
  setKids();
  ok(hasText("🧒 Aan"), "kindermodus aan");
  ok(hasText("Start Natuur Safari") && hasText("Start Natuur Quiz"), "safari en quiz verschijnen");
  eq(localStorage.getItem("plantscanner_kids_mode"), "1", "kindermodus bewaard");
});

test("C3 instellingen: pincode, sleutels, eigen missies", "controle", async () => {
  const { App } = fresh(); mount(App);
  click("Instellingen");
  ok(hasText("Instellingen vergrendeld"), "pincode-scherm");
  const pin = document.querySelector('input[type="password"]');
  fireEvent.change(pin, { target: { value: "0000" } }); click("Ontgrendel");
  ok(hasText("Onjuiste PIN-code"), "foute pincode geweigerd");
  fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: "1234" } }); click("Ontgrendel");
  ok(hasText("🏫 Leerkracht Missies"), "standaardpincode 1234 opent instellingen");
  const inputs = [...document.querySelectorAll("input")];
  eq(inputs.length, 6, "6 invoervelden in instellingen");
  fireEvent.change(inputs[0], { target: { value: "Zoek een eikel" } }); click("➕");
  ok(hasText("Zoek een eikel"), "eigen missie toegevoegd");
  const inputs2 = [...document.querySelectorAll("input")];
  fireEvent.change(inputs2[4], { target: { value: "TESTSLEUTEL" } });
  click("Alles Opslaan");
  ok(hasText("Scan Plant"), "terug op startscherm na opslaan");
  eq(localStorage.getItem("plantscanner_gemini_key"), "TESTSLEUTEL", "Gemini-sleutel in localStorage");
  ok(localStorage.getItem("plantscanner_custom_missions_v3").includes("Zoek een eikel"), "eigen missie bewaard");
  // noodcode in een nieuwe sessie
  const { App: App2 } = fresh(); mount(App2);
  click("Instellingen");
  fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: "112233" } }); click("Ontgrendel");
  ok(hasText("🏫 Leerkracht Missies"), "noodcode 112233 werkt");
});

test("C4 voorlezen, tempo en stem (telefoon zonder Nederlandse stemmen)", "controle", async () => {
  const { App } = fresh(); mount(App);
  click(/🔇 Uit/);
  ok(hasText("🔊 Aan"), "voorlezen aan");
  ok(speech.spoken.some((u) => u.text.includes("Voorlezen staat aan")), "bevestiging uitgesproken");
  ok(hasText("🐇 Normaal"), "tempo-knop zichtbaar");
  ok(hasText("🗣️ Stem 1/2"), "zonder nl-stemmen: Stem 1/2 (zoals op jouw telefoon)");
  eq(speech.spoken[0].lang, "nl-BE", "systeemstem nl-BE");
  eq(speech.spoken[0].voice, null, "geen stem afgedwongen");
  eq(speech.spoken[0].pitch, 0.8, "toon 0,8");
  eq(speech.spoken[0].rate, 0.9, "tempo normaal 0,9");
  click("Stem 1/2");
  ok(hasText("Stem 2/2"), "stem wisselt naar 2/2");
  ok(hasText("Versie: ontwikkel · v10.5"), "stem-uitleg toont versie");
  eq(speech.spoken[speech.spoken.length - 1].lang, "nl-NL", "tweede stem = nl-NL");
  click("🐇 Normaal");
  ok(hasText("🐢 Traag"), "tempo wisselt naar traag");
  eq(localStorage.getItem("natuurscanner_voorleestempo"), "langzaam", "tempo bewaard");
  eq(speech.spoken[speech.spoken.length - 1].rate, 0.7, "traag = 0,7");
  click("🔊 Aan");
  ok(hasText("🔇 Uit") && !hasText("Stem 2/"), "voorlezen uit, tempo- en stemknop verdwijnen");
  eq(localStorage.getItem("natuurscanner_voorlezen"), "0", "voorlezen-keuze bewaard");
});

test("C4b voorlezen herstelt zichzelf als de telefoon stil blijft", "controle", async () => {
  const { App } = fresh(); mount(App);
  speech.silent = 1; // eerste poging blijft stil, zoals op een telefoon die de stem weigert
  click(/🔇 Uit/);
  await waitFor(() => { if (speech.spoken.length < 2) throw new Error("geen tweede poging"); });
  eq(speech.spoken[0].lang, "nl-BE", "eerste poging: systeemstem nl-BE");
  eq(speech.spoken[1].lang, "nl-NL", "tweede poging: andere taalvariant nl-NL");
  eq(speech.spoken[1].voice, null, "tweede poging dwingt geen stem af");
  const aantal = speech.spoken.length;
  await new Promise((r) => setTimeout(r, 400));
  eq(speech.spoken.length, aantal, "geen eindeloze herpogingen na een geslaagde tweede poging");
  // alles blijft stil: maximaal 3 pogingen, dan stoppen
  speech.spoken.length = 0; speech.silent = 99;
  click("Stem 1/2");
  await new Promise((r) => setTimeout(r, 600));
  const eerste = speech.spoken.filter((u) => u.text.startsWith("Stem 2 van")).length;
  ok(eerste === 3, "precies 3 pogingen als het toestel nooit iets laat horen (nu " + eerste + ")");
  ok(hasText("Laatste stemfout"), "uitleg bij de Stem-knop meldt de stemfout");
});

test("C4c hulptekst verschijnt vanzelf als het voorlezen echt niet lukt", "controle", async () => {
  const { App } = fresh(); mount(App);
  speech.silent = 99;
  click(/🔇 Uit/);
  await waitFor(() => { if (!hasText("Hoor je niets?")) throw new Error("nog geen hulptekst"); });
  ok(hasText("Tekst-naar-spraak"), "hulptekst noemt Tekst-naar-spraak");
  ok(hasText("Galaxy Store"), "hulptekst noemt het bijwerken van de spraakmotor");
  speech.silent = 0;
});

test("C4d geen hulptekst als het voorlezen wel werkt", "controle", async () => {
  const { App } = fresh(); mount(App);
  speech.silent = 0;
  click(/🔇 Uit/);
  await new Promise((r) => setTimeout(r, 700));
  ok(!hasText("Hoor je niets?"), "geen hulptekst bij werkend voorlezen");
});

test("C4e instellingen bevatten hulp bij voorlezen", "controle", async () => {
  const { App } = fresh(); mount(App);
  await unlockSettings();
  ok(hasText("🔊 Werkt het voorlezen niet?"), "hulpkaart in instellingen");
  ok(hasText("Luister naar voorbeeld"), "hulpkaart legt de test van het toestel uit");
});

test("C5 stemkeuze met mannelijke Nederlandse stem", "controle", async () => {
  const { App, T } = fresh();
  speech.voices = [
    { name: "Ellen", lang: "nl-BE", voiceURI: "ellen" },
    { name: "Microsoft Maarten Online (Natural)", lang: "nl-NL", voiceURI: "maarten" },
    { name: "Google US English", lang: "en-US", voiceURI: "us" },
  ];
  mount(App);
  click(/🔇 Uit/);
  ok(hasText("Stem 1/4"), "2 nl-stemmen + 2 systeemstemmen = 4 opties");
  const u = speech.spoken.find((x) => x.text.includes("Voorlezen staat aan"));
  ok(u && u.voice && /Maarten/.test(u.voice.name), "mannenstem wordt afgedwongen als eerste keuze");
});

// ----- quiz -----
function shownQuestion(T) {
  const hits = T.ALL_QUIZ_QUESTIONS.filter((q) => body().includes(q.q));
  hits.sort((a, b) => b.q.length - a.q.length);
  return hits[0];
}
async function volgende() {
  await waitFor(() => { if (!btn(/Volgende vraag|Resultaat/)) throw new Error("volgende-knop ontbreekt"); });
  click(/Volgende vraag|Resultaat/);
}
async function playQuiz(T, niveauLabel, mode) {
  click("Start Natuur Quiz");
  click(niveauLabel);
  const shown = [];
  for (let i = 0; i < 10; i++) {
    await waitText(`Vraag ${i + 1} / 10`);
    const q = shownQuestion(T);
    shown.push(q.q);
    const good = q.opts[q.correct];
    const target = mode === "juist" ? good : q.opts.find((o) => o !== good);
    const b = screen.getAllByRole("button").find((x) => x.textContent.trim() === target);
    fireEvent.click(b);
    await waitText("Wist je dat");
    await volgende();
  }
  return shown;
}
test("C6 quiz: 10/10 geeft diploma, vragen komen uit gekozen niveau", "scan", async () => {
  const { App, T } = fresh(); mount(App); setKids();
  const shown = await playQuiz(T, "Makkelijk", "juist");
  await waitText("GEFELICITEERD", 4000);
  ok(true, "diploma na 10/10");
  eq(shown.length, 10, "10 vragen gesteld");
  ok(shown.every((q) => T.ALL_QUIZ_QUESTIONS.find((x) => x.q === q).niveau === 1), "alle vragen van niveau 1");
  eq(new Set(shown).size, 10, "10 verschillende vragen");
  const st = JSON.parse(localStorage.getItem("natuurscanner_stats"));
  ok(st.quizzen === 1 && st.diplomas === 1 && st.besteProcent === 100, "statistieken bewaard: 1 quiz, 1 diploma, beste 100% " + JSON.stringify(st));
  click("Verder Spelen"); ok(hasText("Scan Plant"), "terug naar start");
});
test("C7 quiz: alles fout -> resultaat 0/10 en 'nog een keer' zonder herhaling", "scan", async () => {
  const { App, T } = fresh(); mount(App); setKids();
  const eerste = await playQuiz(T, "Moeilijk", "fout");
  await waitFor(() => { if (!btn("Nog een keer")) throw new Error("nog geen resultaatscherm"); }, { timeout: 4000 });
  ok(hasText("🏆"), "resultaatscherm bereikt");
  ok(/(^|[^\d])0 \/ 10/.test(body().replace("Vraag 10 / 10", "")), "score 0 / 10");
  click("Nog een keer");
  const tweede = [];
  for (let i = 0; i < 10; i++) {
    await waitText(`Vraag ${i + 1} / 10`);
    const q = shownQuestion(T); tweede.push(q.q);
    fireEvent.click(screen.getAllByRole("button").find((x) => x.textContent.trim() === q.opts[q.correct]));
    await waitText("Wist je dat"); await volgende();
  }
  ok(!tweede.some((q) => eerste.includes(q)), "tweede ronde bevat geen vragen uit de eerste (geen herhaling)");
  const seen = JSON.parse(localStorage.getItem("natuurscanner_seen_quiz"));
  eq(seen.length, 20, "20 gestelde vragen onthouden in localStorage");
});
test("C8 quiz: weetje, voorlezen, geen automatische doorgang", "scan", async () => {
  const { App, T } = fresh(); localStorage.setItem("natuurscanner_voorlezen", "1"); mount(App); setKids();
  click("Start Natuur Quiz"); click("Gemengd");
  await waitText("Vraag 1 / 10");
  await waitFor(() => { if (!speech.spoken.some((u) => u.text.includes("Antwoord A:"))) throw new Error("niet voorgelezen"); });
  ok(true, "vraag met 'Antwoord A:' voorgelezen");
  ok(!hasText("Wist je dat"), "vóór het antwoord nog geen weetje");
  const q = shownQuestion(T);
  fireEvent.click(screen.getAllByRole("button").find((x) => x.textContent.trim() === q.opts[q.correct]));
  await waitText("Wist je dat");
  ok(hasText(q.weetje), "het weetje bij precies deze vraag wordt getoond");
  ok(hasText("✅ Goed zo!"), "feedback juist");
  const eersteZin = q.weetje.split(/(?<=[.!?])\s/)[0];
  await waitFor(() => { if (!speech.spoken.some((u) => u.text.includes("Goed zo")) || !speech.spoken.some((u) => u.text.includes("Wist je dat")) || !speech.spoken.some((u) => u.text.includes(eersteZin))) throw new Error("geen feedback+weetje"); });
  ok(true, "feedback én weetje worden voorgelezen (in zinnen opgedeeld)");
  await new Promise((r) => setTimeout(r, 500));   // 10 s in echte tijd: er mag niets vanzelf gebeuren
  ok(hasText("Vraag 1 / 10"), "geen automatische doorgang: kind bepaalt zelf wanneer verder");
  click("Volgende vraag"); await waitText("Vraag 2 / 10"); ok(true, "volgende vraag na klik");
});
test("C8b quiz: fout antwoord, laatste vraag en 'Stoppen' na antwoord", "scan", async () => {
  const { App, T } = fresh(); mount(App); setKids();
  click("Start Natuur Quiz"); click("Gemengd");
  await waitText("Vraag 1 / 10");
  const q = shownQuestion(T);
  fireEvent.click(screen.getAllByRole("button").find((x) => x.textContent.trim() === q.opts.find((o, i) => i !== q.correct && true) && x.textContent.trim() !== q.opts[q.correct]));
  await waitText("Helaas"); ok(hasText(q.weetje), "ook bij een fout antwoord verschijnt het weetje");
  // stoppen ná een antwoord mag geen schermwissel meer veroorzaken (oud gedrag: timer sloeg later toch toe)
  click("Stoppen"); ok(hasText("Scan Plant"), "terug naar het menu");
  await new Promise((r) => setTimeout(r, 400));
  ok(hasText("Scan Plant") && !hasText("GEFELICITEERD") && !hasText("Vraag "), "na stoppen blijft het menu staan");
  // laatste vraag: knop heet 'Resultaat'
  click("Start Natuur Quiz"); click("Makkelijk");
  for (let i = 0; i < 9; i++) { await waitText(`Vraag ${i + 1} / 10`); const k = shownQuestion(T); fireEvent.click(screen.getAllByRole("button").find((x) => x.textContent.trim() === k.opts[k.correct])); await volgende(); }
  await waitText("Vraag 10 / 10"); const k = shownQuestion(T);
  fireEvent.click(screen.getAllByRole("button").find((x) => x.textContent.trim() === k.opts[k.correct]));
  await waitFor(() => { if (!btn("🏁 Resultaat")) throw new Error("geen resultaatknop"); });
  ok(true, "laatste vraag toont '🏁 Resultaat'");
  click("🏁 Resultaat"); await waitText("GEFELICITEERD", 3000); ok(true, "10/10 geeft diploma");
});

// ----- safari -----
test("C9 safari: gebied, missie, andere missie, geen herhaling", "controle", async () => {
  const { App, T } = fresh(); mount(App); setKids();
  click("Start Natuur Safari");
  ok(hasText("Kies je missiegebied"), "gebiedkeuze");
  for (const g of ["bos", "park", "dierentuin"]) ok(btn(g), "gebied-knop " + g);
  click("bos");
  const huidige = () => T.SAFARI_MISSIES.bos.find((m) => body().includes(m));
  const m1 = huidige();
  ok(!!m1, "een missie uit 'bos' wordt getoond");
  ok(hasText("0 Sterren"), "start met 0 sterren");
  const gezien = new Set([m1]); let vorige = m1, zelfde = false;
  for (let i = 0; i < 12; i++) { click("Andere missie"); const m = huidige(); if (m === vorige) zelfde = true; gezien.add(m); vorige = m; }
  ok(!zelfde, "nooit dezelfde missie twee keer na elkaar");
  ok(gezien.size >= 10, "12x doorklikken geeft minstens 10 verschillende missies (" + gezien.size + ")");
});
test("C10 safari: foto-controle (gevonden / niet gevonden / geen sleutel)", "scan", async () => {
  // gevonden
  let { App, T } = fresh(); setKeys({ gemini: "K" }); mount(App); setKids();
  global.__net.handler = (u) => gemOk({ gevonden: true, uitleg: "Goed gezien!" });
  click("Start Natuur Safari"); click("park"); click("Scan & Controleer");
  await waitFor(() => { if (!document.querySelector("video")) throw new Error("camera niet open"); });
  const shutter = screen.getAllByRole("button").find((b) => b.textContent === "" );
  fireEvent.click(shutter);
  await waitText("🎉 Goed gezien!");
  ok(hasText("1 Sterren"), "ster erbij na 'gevonden'");
  eq(global.__imageCapture.calls, 1, "ImageCapture gebruikt voor de foto");
  eq(JSON.parse(localStorage.getItem("natuurscanner_stats")).sterren, 1, "ster blijvend bewaard in statistieken");
  // niet gevonden
  ({ App, T } = fresh()); setKeys({ gemini: "K" }); mount(App); setKids();
  global.__net.handler = () => gemOk({ gevonden: false, uitleg: "Zoek verder." });
  click("Start Natuur Safari"); click("park"); click("Scan & Controleer");
  await waitFor(() => { if (!document.querySelector("video")) throw new Error("camera"); });
  fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === ""));
  await waitText("🤔 Zoek verder.");
  ok(hasText("0 Sterren"), "geen ster bij 'niet gevonden'");
  // geen sleutel
  ({ App, T } = fresh()); mount(App); setKids();
  click("Start Natuur Safari"); click("park"); click("Scan & Controleer");
  await waitFor(() => { if (!document.querySelector("video")) throw new Error("camera"); });
  fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === ""));
  await waitText("Safari Missie");
  ok(hasText("0 Sterren"), "zonder sleutel: terug naar safari, 0 sterren, geen crash");
  eq(geminiCalls(), 0, "zonder sleutel geen netwerkaanroep");
});

// ----- scans via upload -----
test("D1 plantscan via Gemini: resultaat, giftigheid, geschiedenis", "scan", async () => {
  const { App } = fresh(); setKeys({ gemini: "K" }); mount(App);
  global.__net.handler = () => gemOk(PLANT);
  uploadFile(0);
  await waitText("Madeliefje");
  ok(hasText("Gemini AI · AI-schatting, controleer altijd") && !hasText("100% zekerheid"), "Gemini toont geen verzonnen 100% meer maar 'AI-schatting'");
  ok(hasText("Niet opeten") && hasText("Eet nooit planten, bessen of paddenstoelen"), "vaste eetwaarschuwing bij planten");
  ok(hasText("Veel zon") && hasText("Losse tuingrond"), "verzorging getoond");
  ok(hasText("Giftigheid") && hasText("Huisdieren (kat/hond)"), "giftigheidskaart voor mens en huisdier");
  ok(hasText("070 245 245") && hasText("Na contact: wat doe je?"), "vaste raad + Antigifcentrum");
  ok(hasText("Draag handschoenen") && hasText("Braken"), "omgangstips en klachten");
  ok(hasText("lijkt gezond") || hasText("Lijkt gezond") || hasText("Gezondheid"), "gezondheidscheck zichtbaar");
  eq(geminiCalls(), 1, "precies 1 Gemini-aanroep");
  const call = global.__net.calls.find((c) => isGemini(c.url));
  ok(call.url.includes("api-key=K"), "sleutel via query naar Worker");
  ok(JSON.parse(call.opts.body).base64 === "RESIZED", "foto werd verkleind vóór verzending");
  eq(global.__canvas.dataUrlCalls[0][2], 1280, "breedte verkleind tot 1280");
  eq(global.__canvas.dataUrlCalls.length, 2, "tweede verkleining: miniatuur voor de geschiedenis");
  eq(global.__canvas.dataUrlCalls[1][2] + "@" + global.__canvas.dataUrlCalls[1][1], "640@0.72", "miniatuur 640 px, kwaliteit 0,72");
  const hist = JSON.parse(localStorage.getItem("plantscanner_history"));
  eq(hist.length, 1, "scan in geschiedenis bewaard");
  eq(hist[0].score, null, "opgeslagen zekerheid van Gemini is null (geen verzonnen 100)");
  click("Terug"); ok(hasText("Geschiedenis (1)"), "teller toont 1");
});
test("D2 plantscan: bronnen-volgorde (Plant.id > PlantNet > Gemini)", "scan", async () => {
  let r = fresh(); setKeys({ gemini: "K", plantId: "P", plantNet: "N" }); mount(r.App);
  global.__net.handler = (u) => {
    if (isGemini(u)) return gemOk(PLANT);
    if (u.includes("plant.id")) return { status: 200, json: { result: { classification: { suggestions: [{ name: "Bellis perennis", probability: 0.93 }] } } } };
    if (u.includes("plantnet")) return { status: 200, json: { results: [{ species: { scientificNameWithoutAuthor: "Bellis netus" }, score: 0.8 }] } };
    return { status: 404 };
  };
  uploadFile(0); await waitText("Bellis perennis");
  ok(hasText("Plant.id · 93% zekerheid"), "Plant.id wint als alle bronnen werken");
  ok(hasText("Veel zon"), "verzorging komt nog steeds van Gemini");
  r = fresh(); setKeys({ plantNet: "N" }); mount(r.App);
  global.__net.handler = (u) => u.includes("plantnet") ? { status: 200, json: { results: [{ species: { scientificNameWithoutAuthor: "Bellis netus" }, score: 0.8 }] } } : { status: 404 };
  uploadFile(0); await waitText("Bellis netus");
  ok(hasText("PlantNet · 80% zekerheid"), "PlantNet werkt als enige sleutel (vangnet bestaat al in de code)");
  eq(geminiCalls(), 0, "zonder Gemini-sleutel geen Gemini-aanroep");
  r = fresh(); setKeys({ gemini: "K", plantNet: "N" }); mount(r.App);
  global.__net.handler = (u) => isGemini(u) ? { status: 429, text: "RESOURCE_EXHAUSTED quota PerDay" } : { status: 200, json: { results: [{ species: { scientificNameWithoutAuthor: "Bellis netus" }, score: 0.8 }] } };
  uploadFile(0); await waitText("Bellis netus");
  ok(hasText("PlantNet"), "Gemini-daglimiet + PlantNet-sleutel: scan lukt toch");
  eq(geminiCalls(), 1, "daglimiet wordt niet herprobeerd");
});
test("N1 PlantNet-ziektecheck: knop, drempel, geen automatische aanvraag", "scan", async () => {
  const r = fresh(); setKeys({ gemini: "K", plantNet: "N" }); localStorage.setItem("plantscanner_ziekte_plantnet", "1"); mount(r.App);
  let calls = 0, lastUrl = "", lastForm = null;
  global.__net.handler = (u, o) => {
    if (u.includes("diseases")) { calls++; lastUrl = u; lastForm = o && o.body; return { status: 200, json: { results: [{ name: "APHISP", description: "Bladluizen", score: 0.62 }, { name: "ERYSAM", description: "Meeldauw", score: 0.25 }, { name: "PUCCSP", description: "Roest", score: 0.05 }], remainingIdentificationRequests: 480 } }; }
    if (isGemini(u)) return gemOk(PLANT);
    return { status: 404 };
  };
  ok(hasText("Plantherkenning via de Pl@ntNet-API"), "PlantNet-vermelding op het beginscherm");
  uploadFile(0); await waitText("Madeliefje");
  ok(hasText("Extra ziektecheck (PlantNet)"), "ziektecheckkaart bij een plant");
  eq(calls, 0, "geen automatische ziekte-aanvraag (kost tegoed)");
  click("Ziektecheck uitvoeren"); await waitText("Bladluizen");
  eq(calls, 1, "precies één aanvraag na de klik");
  ok(hasText("62%") && hasText("Meeldauw") && hasText("25%"), "resultaten boven de drempel getoond");
  ok(!hasText("Roest"), "resultaat onder 20% niet getoond");
  ok(hasText("480") && hasText("geen zekerheid"), "tegoed en voorbehoud getoond");
  ok(lastUrl.includes("/v2/diseases/identify") && lastUrl.includes("api-key=N") && lastUrl.includes("lang=nl"), "juiste route, sleutel en taal");
  ok(lastForm && typeof lastForm.get === "function" && lastForm.get("organs") === "auto", "foto en organs=auto meegestuurd");
});
test("N2 PlantNet-ziektecheck: fouten, geen sleutel, kindermodus, dier", "scan", async () => {
  let r = fresh(); setKeys({ gemini: "K", plantNet: "N" }); localStorage.setItem("plantscanner_ziekte_plantnet", "1"); mount(r.App);
  let status = 403;
  global.__net.handler = (u) => u.includes("diseases") ? { status, text: JSON.stringify({ message: "CORS error: Origin not allowed" }) } : isGemini(u) ? gemOk(PLANT) : { status: 404 };
  uploadFile(0); await waitText("Madeliefje");
  click("Ziektecheck uitvoeren"); await waitText("Geautoriseerde domeinen");
  ok(hasText("Opnieuw proberen"), "bij een fout kan je opnieuw proberen");
  status = 429; click("Opnieuw proberen"); await waitText("dagtegoed");
  r = fresh(); setKeys({ gemini: "K" }); localStorage.setItem("plantscanner_ziekte_plantnet", "1"); mount(r.App);
  global.__net.handler = (u) => isGemini(u) ? gemOk(PLANT) : { status: 404 };
  uploadFile(0); await waitText("Madeliefje");
  ok(!hasText("Extra ziektecheck"), "zonder PlantNet-sleutel geen ziektecheckknop");
  r = fresh(); setKeys({ gemini: "K", plantNet: "N" }); localStorage.setItem("plantscanner_kids_mode", "1"); localStorage.setItem("plantscanner_ziekte_plantnet", "1"); mount(r.App);
  global.__net.handler = (u) => isGemini(u) ? gemOk(PLANT) : { status: 404 };
  uploadFile(0); await waitText("Madeliefje");
  ok(!hasText("Extra ziektecheck"), "kindermodus toont de ziektecheck niet");
  r = fresh(); setKeys({ gemini: "K", plantNet: "N" }); localStorage.setItem("plantscanner_ziekte_plantnet", "1"); mount(r.App);
  global.__net.handler = () => gemOk(ANIMAL);
  uploadFile(1); await waitText("Rode vos");
  ok(!hasText("Extra ziektecheck"), "geen ziektecheckkaart bij een dier");
});
test("N4 PlantNet-ziektecheck staat standaard uit en heeft een schakelaar in Instellingen", "scan", async () => {
  const r = fresh(); setKeys({ gemini: "K", plantNet: "N" }); mount(r.App);
  global.__net.handler = (u) => isGemini(u) ? gemOk(PLANT) : { status: 404 };
  uploadFile(0); await waitText("Madeliefje");
  ok(!hasText("Extra ziektecheck"), "standaard geen ziektecheckknop, ook niet met PlantNet-sleutel");
  click("Terug");
  await unlockSettings();
  ok(hasText("🔬 PlantNet-ziektecheck"), "schakelaarkaart in Instellingen");
  ok(hasText("Ziektecheck bij planten: UIT"), "schakelaar staat standaard uit");
  click(/Ziektecheck bij planten: UIT/);
  ok(hasText("Ziektecheck bij planten: AAN"), "schakelaar springt naar AAN");
  eq(localStorage.getItem("plantscanner_ziekte_plantnet"), "1", "schakelaar wordt bewaard");
});
test("N3 PlantNet-hulpfuncties", "controle", () => {
  const T = fresh().T;
  const a = T.plantNetZiekteItems({ results: [{ name: "B", description: "Laag", score: 0.1 }, { name: "A", description: "Hoog", score: 0.9 }, { name: "", description: "", score: 0.8 }], remainingIdentificationRequests: 7 });
  eq(a.sterk.length, 1, "alleen resultaten vanaf 20% met een naam");
  eq(a.sterk[0].naam, "Hoog", "gesorteerd en naam uit description");
  eq(a.resterend, 7, "tegoed overgenomen");
  const b = T.plantNetZiekteItems(null);
  ok(b.sterk.length === 0 && b.totaal === 0 && b.resterend === null, "leeg of ongeldig antwoord crasht niet");
  ok(T.plantNetFoutTekst(403).includes("Geautoriseerde domeinen") && T.plantNetFoutTekst(429).includes("dagtegoed") && T.plantNetFoutTekst(500).includes("500"), "foutteksten per statuscode");
});

test("D3 dierscan: resultaat en gezondheidscheck", "scan", async () => {
  const { App } = fresh(); setKeys({ gemini: "K" }); mount(App);
  global.__net.handler = () => gemOk(ANIMAL);
  uploadFile(1); await waitText("Rode vos");
  ok(hasText("Vulpes vulpes") && hasText("Zoogdier") && hasText("Bos"), "info getoond");
  ok(hasText("Leuk weetje") && hasText("Vossen zien goed in het donker"), "weetje getoond");
  ok(hasText("Gemini AI · AI-schatting") && !hasText("100% zekerheid"), "dier: geen verzonnen 100%");
  eq(JSON.parse(localStorage.getItem("plantscanner_history"))[0].score, null, "dier: opgeslagen zekerheid is null");
  ok(hasText("Gezondheidscheck: Let op") && hasText("Lijkt kreupel"), "gezondheidscheck 'let op'");
  ok(hasText("Verzorging & Omgang") && hasText("Houd afstand"), "omgangstip getoond");
  ok(!hasText("Giftigheid"), "geen giftigheidskaart bij dieren");
});
test("D4 foutafhandeling: daglimiet, 503-herkansing, netwerk, geen sleutel", "scan", async () => {
  // daglimiet
  let r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => ({ status: 429, text: '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded ... PerDay"}}' });
  uploadFile(0); await waitText("voor vandaag genoeg gewerkt");
  eq(geminiCalls(), 1, "daglimiet: geen nutteloze herhaling");
  click("Technische details"); ok(hasText("RESOURCE_EXHAUSTED"), "technische details tonen de ruwe fout");
  // 503 eenmaal, dan succes
  r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  let n = 0; global.__net.handler = () => (++n === 1 ? { status: 503, text: "overloaded" } : gemOk(PLANT));
  uploadFile(0); await waitText("Madeliefje", 5000);
  eq(geminiCalls(), 2, "503 -> automatisch 1 herkansing, daarna succes");
  // 503 altijd
  r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => ({ status: 503, text: "overloaded" });
  uploadFile(0); await waitText("even moe", 8000);
  eq(geminiCalls(), 3, "503 blijft -> 3 pogingen, dan 'even moe'");
  // 429 zonder daglimiet
  r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  let m = 0; global.__net.handler = () => (++m === 1 ? { status: 429, text: "Too many requests per minute" } : gemOk(PLANT));
  uploadFile(0); await waitText("Madeliefje", 5000);
  ok(true, "429 per minuut wordt herprobeerd");
  // netwerkfout
  r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => ({ throw: new TypeError("Failed to fetch") });
  uploadFile(0); await waitText("Geen internetverbinding", 6000);
  eq(geminiCalls(), 2, "netwerkfout: max 1 herkansing");
  // geen sleutel: duidelijke melding "er ontbreekt een instelling" (niet "ik zie hier geen plant")
  r = fresh(); mount(r.App);
  uploadFile(0);
  await waitText("Er ontbreekt een instelling");
  ok(!hasText("ik zie hier geen plant"), "zonder sleutels geen misleidende 'geen plant'-melding");
  click("Technische details"); ok(hasText("Geen API-sleutel ingesteld"), "technische details noemen de ontbrekende sleutel");
  eq(geminiCalls(), 0, "zonder sleutels geen netwerkaanroep");
  // dierscan zonder sleutel gaf al de juiste melding
  r = fresh(); mount(r.App);
  uploadFile(1);
  await waitText("Er ontbreekt een instelling");
  ok(true, "dierscan zonder sleutel: ontbrekende-instelling-melding");
  // wel een sleutel, maar de bron levert niets bruikbaars: blijft 'geen plant'
  r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => gemOk({});
  uploadFile(0);
  await waitText("ik zie hier geen plant");
  ok(!hasText("Er ontbreekt een instelling"), "met sleutel en leeg antwoord: gewone 'geen plant'-melding");
  click("Technische details"); ok(hasText("alle bronnen gaven niets terug") && !hasText("geen enkele sleutel"), "technische tekst klopt nu met de situatie");
});
test("D5 geschiedenis: openen en verwijderen", "controle", async () => {
  const { App } = fresh(); setKeys({ gemini: "K" }); mount(App);
  global.__net.handler = () => gemOk(PLANT);
  uploadFile(0); await waitText("Madeliefje"); click("Terug");
  click("Geschiedenis (1)"); ok(hasText("Madeliefje"), "scan in lijst");
  fireEvent.click(document.querySelector("img[alt='Madeliefje']").parentElement); ok(hasText("Giftigheid"), "oude scan opent met giftigheid");
  click("Terug"); click("Geschiedenis (1)");
  window.confirm = () => false; click("🗑"); ok(hasText("Madeliefje"), "annuleren verwijdert niets");
  window.confirm = () => true; click("🗑"); ok(hasText("Nog niets gescand"), "verwijderen werkt");
  eq(JSON.parse(localStorage.getItem("plantscanner_history")).length, 0, "localStorage leeg na verwijderen");
});
test("D6 kindermodus + voorlezen op resultaat", "scan", async () => {
  const { App } = fresh(); localStorage.setItem("natuurscanner_voorlezen", "1"); setKeys({ gemini: "K" }); mount(App); setKids();
  global.__net.handler = () => gemOk(PLANT);
  uploadFile(0); await waitText("Madeliefje");
  ok(hasText("Vraag altijd aan een volwassene"), "kindertekst bij giftigheid");
  await waitFor(() => { if (!speech.spoken.some((u) => u.text.includes("070 245 245"))) throw new Error("niet voorgelezen"); });
  ok(true, "voorlezen noemt het Antigifcentrum");
});

// ----- camera -----
test("E1 camera: zoom, zaklamp, ImageCapture en afsluiten", "scan", async () => {
  const { App } = fresh(); setKeys({ gemini: "K" }); mount(App);
  global.__net.handler = () => gemOk(PLANT);
  click("Scan Plant (Camera)");
  await waitFor(() => { if (!document.querySelector('input[type="range"]')) throw new Error("zoomschuif ontbreekt"); });
  ok(true, "zoomschuif verschijnt bij hardware-zoom");
  ok(hasText("1.0x"), "zoomwaarde zichtbaar");
  ok(hasText("💡"), "zaklamp-knop zichtbaar");
  eq(global.__cam.getUserMediaCalls[0].video.width.ideal, 3840, "hoge resolutie gevraagd");
  fireEvent.change(document.querySelector('input[type="range"]'), { target: { value: "2.5" } });
  await waitFor(() => { if (!global.__cam.applied.some((c) => c.advanced && c.advanced[0].zoom === 2.5)) throw new Error("zoom niet toegepast"); });
  ok(true, "hardware-zoom doorgegeven aan camera");
  click("💡"); await waitFor(() => { if (!global.__cam.applied.some((c) => c.advanced && c.advanced[0].torch === true)) throw new Error("torch"); });
  ok(true, "zaklamp aan doorgegeven");
  fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === ""));
  await waitText("Madeliefje");
  eq(global.__imageCapture.calls, 1, "ImageCapture.takePhoto gebruikt");
  ok(global.__cam.stopped >= 1, "camera-stream gestopt na foto");
  ok(global.__canvas.draws.every((d) => !(d[0] instanceof window.HTMLVideoElement)), "geen videoframe getekend (ImageCapture-route; enkel het verkleinen van de foto)");
});
test("E3 camera: afstandstip en tik om scherp te stellen", "scan", async () => {
  let r = fresh(); setKeys({ gemini: "K" }); global.__cam.caps = { zoom: { min: 1, max: 5, step: 0.1 }, focusMode: ["continuous", "single-shot"] }; mount(r.App);
  click("Scan Plant (Camera)"); await waitFor(() => { if (!document.querySelector("video")) throw new Error("camera"); });
  ok(hasText("Houd 20–30 cm afstand"), "afstandstip op het camerascherm");
  fireEvent.click(document.querySelector("video"));
  await waitFor(() => { if (!global.__cam.applied.some((c) => c.advanced && c.advanced[0].focusMode === "single-shot" && c.advanced[0].pointsOfInterest)) throw new Error("scherpstellen niet gevraagd"); });
  ok(true, "tik vraagt een eenmalige scherpstelling met scherpstelpunt");
  await waitFor(() => { if (!global.__cam.applied.some((c) => c.advanced && c.advanced[0].focusMode === "continuous" && !c.advanced[0].pointsOfInterest)) throw new Error("niet teruggezet"); });
  ok(true, "daarna weer continue autofocus");
  r = fresh(); setKeys({ gemini: "K" }); global.__cam.caps = { zoom: { min: 1, max: 5, step: 0.1 } }; mount(r.App);
  click("Scan Plant (Camera)"); await waitFor(() => { if (!document.querySelector("video")) throw new Error("camera"); });
  const voor = global.__cam.applied.length;
  fireEvent.click(document.querySelector("video"));
  await new Promise((rs) => setTimeout(rs, 50));
  eq(global.__cam.applied.length, voor, "camera zonder scherpstelstanden: tik doet niets stuk");
});
test("E4 camera: scherpste beeld van een reeks kiezen", "scan", async () => {
  const T = fresh().T;
  const scherp = new Uint8ClampedArray(16 * 16 * 4), vlak = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < 256; i++) { const v = (i + Math.floor(i / 16)) % 2 ? 255 : 0; scherp.set([v, v, v, 255], i * 4); vlak.set([128, 128, 128, 255], i * 4); }
  ok(T.scherpteScore(scherp, 16, 16) > T.scherpteScore(vlak, 16, 16) + 1000, "scherpteScore: scherp beeld scoort hoger dan vlak beeld");
  eq(T.scherpteScore(null, 0, 0), 0, "ongeldige invoer geeft 0");
  const r = fresh(); setKeys({ gemini: "K" }); global.__imageCapture.enabled = false; mount(r.App);
  let n = 0; const frames = [];
  window.createImageBitmap = async () => { const b = { id: ++n, width: 1280, height: 720, close() {} }; frames.push(b); return b; };
  global.__canvas.scherpOf = (src) => !!src && src.id === 3;
  global.__net.handler = () => gemOk(PLANT);
  click("Scan Plant (Camera)"); await waitFor(() => { if (!document.querySelector("video")) throw new Error("v"); });
  fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === ""));
  await waitText("Madeliefje");
  eq(frames.length, 5, "vijf beelden genomen");
  const getekend = global.__canvas.draws.find((a) => a.length === 9 && a[0] && a[0].id !== undefined && a[5] === 0 && a[7] > 0);
  ok(getekend && getekend[0].id === 3, "het scherpste beeld (nummer 3) is gekozen");
  ok(frames.every((f) => f.id), "alle beelden aangemaakt");
});
test("E2 camera: terugval zonder ImageCapture + digitale zoom + geweigerd", "scan", async () => {
  // zonder ImageCapture -> videoframe via canvas
  let r = fresh(); setKeys({ gemini: "K" }); global.__imageCapture.enabled = false; mount(r.App);
  global.__net.handler = () => gemOk(PLANT);
  click("Scan Plant (Camera)"); await waitFor(() => { if (!document.querySelector("video")) throw new Error("v"); });
  fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === ""));
  await waitText("Madeliefje");
  eq(global.__canvas.draws.length, 2, "videoframe getekend + miniatuur voor de geschiedenis");
  eq(global.__canvas.draws[0].length, 5, "volledig frame (geen uitsnede)");
  ok(global.__canvas.draws[0][0] instanceof window.HTMLVideoElement, "eerste tekening komt van de video");
  // digitale zoom
  r = fresh(); setKeys({ gemini: "K" }); global.__cam.caps = {}; mount(r.App);
  global.__net.handler = () => gemOk(PLANT);
  click("Scan Plant (Camera)"); await waitFor(() => { if (!document.querySelector('input[type="range"]')) throw new Error("zoomschuif (digitaal)"); });
  const video = document.querySelector("video");
  Object.defineProperty(video, "videoWidth", { value: 1600, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: 900, configurable: true });
  fireEvent.change(document.querySelector('input[type="range"]'), { target: { value: "2" } });
  await waitFor(() => { if (!/scale\(2\)/.test(document.querySelector("video").style.transform)) throw new Error("css-zoom"); });
  ok(true, "digitale zoom: CSS-schaal op preview");
  fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === ""));
  await waitText("Madeliefje");
  eq(global.__imageCapture.calls, 0, "digitale zoom slaat ImageCapture over");
  const d = global.__canvas.draws[0];
  ok(d && d.length === 9 && d[3] === 800 && d[4] === 450, "uitsnede = helft van het beeld bij 2x zoom");
  // geweigerd
  r = fresh(); global.__cam.mode = "denied"; mount(r.App);
  click("Scan Plant (Camera)");
  await waitText("Camera niet beschikbaar");
  ok(hasText("Kies foto uit galerij"), "galerij-knop als terugval");
  eq(global.__cam.getUserMediaCalls.length, 2, "eerst hoge resolutie, dan eenvoudige poging");
  click("Terug"); ok(hasText("Scan Plant (Camera)"), "terug naar startscherm");
});


// =====================================================================================
// F. NIEUW IN v5
// =====================================================================================
const seedEntry = (o) => ({ id: Date.now() - Math.floor(Math.random() * 1e6), date: "01/01/2026", image: "data:image/png;base64,AAAA", ...o });
async function unlockSettings() {
  click("Instellingen");
  if (btn("Ontgrendel")) { fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: "1234" } }); click("Ontgrendel"); }
  await waitText("🏫 Leerkracht Missies");
}

test("F1 sleutels standaard verborgen", "controle", async () => {
  const { App } = fresh(); setKeys({ gemini: "GEHEIM-G", plantNet: "GEHEIM-N", plantId: "GEHEIM-P" }); mount(App);
  await unlockSettings();
  const ins = [...document.querySelectorAll("input")];
  eq(ins.length, 6, "nog steeds 6 invoervelden");
  eq([ins[2].type, ins[3].type, ins[4].type].join(), "password,password,password", "Plant.id, PlantNet en Gemini zijn verborgen");
  eq(ins[1].type, "text", "Firebase-URL (geen geheim) blijft zichtbaar");
  ok(ins[4].autocomplete === "new-password", "browser biedt geen wachtwoord-opslag aan");
  eq(ins[4].value, "GEHEIM-G", "waarde blijft intact (enkel verborgen)");
  click("Toon sleutels"); ok([...document.querySelectorAll("input")].slice(2, 5).every((i) => i.type === "text"), "na 'Toon sleutels' zichtbaar");
  ok(hasText("Verberg sleutels"), "knop wisselt van tekst");
  click("Alles Opslaan");
  eq(localStorage.getItem("plantscanner_gemini_key"), "GEHEIM-G", "opslaan werkt nog");
  await unlockSettings();
  ok([...document.querySelectorAll("input")][4].type === "password", "bij terugkomen weer verborgen");
});

test("F2 paddenstoelen en eetwaarschuwing", "scan", async () => {
  const { T } = fresh();
  for (const n of ["Vliegenzwam", "Gewone paddenstoel", "Champignon", "Boleet", "Amanita muscaria", "Eekhoorntjesbrood", "Cantharel"]) ok(T.isPaddenstoel(n), "herkend als paddenstoel: " + n);
  for (const n of ["Madeliefje", "Eik", "Roos", "Lavendel", "Brandnetel", "Egel"]) ok(!T.isPaddenstoel(n), "geen paddenstoel: " + n);
  ok(!T.isPaddenstoel(null) && !T.isPaddenstoel(undefined) && !T.isPaddenstoel(""), "lege namen crashen niet");
  ok(T.PADDENSTOEL_WAARSCHUWING.includes("070 245 245") && T.PADDENSTOEL_WAARSCHUWING.includes("112"), "paddenstoeltekst noemt Antigifcentrum en 112");
  ok(T.resultText({ type: "plant", name: "Vliegenzwam", giftigheid: null }).includes("Dit lijkt een paddenstoel"), "voorlezen: paddenstoelwaarschuwing");
  ok(T.resultText({ type: "plant", name: "Roos", giftigheid: null }).includes("Eet nooit planten, bessen of paddenstoelen"), "voorlezen: algemene eetwaarschuwing");
  const r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => gemOk({ ...PLANT, name: "Vliegenzwam" });
  uploadFile(0); await waitText("Vliegenzwam");
  ok(hasText("Let op: paddenstoel") && hasText("dodelijk giftig"), "paddenstoelkaart op het scherm");
  ok(!hasText("Niet opeten"), "bij paddenstoel geen dubbele standaardkaart");
});

test("F3 back-up: functies", "controle", () => {
  const { T } = fresh();
  const a = seedEntry({ id: 3, name: "A", type: "plant" }), b = seedEntry({ id: 2, name: "B", type: "animal" }), c = seedEntry({ id: 1, name: "C", type: "plant" });
  const txt = T.makeBackup([a, b, c]);
  const p = T.parseBackup(txt);
  ok(p.ok && p.scans.length === 3 && p.overgeslagen === 0, "heen-en-terug: 3 scans");
  ok(!T.parseBackup("dit is geen json").ok, "ongeldige tekst geweigerd");
  ok(!T.parseBackup('{"iets":"anders"}').ok, "vreemd JSON-object geweigerd");
  ok(T.parseBackup(JSON.stringify([a, b])).ok, "kale lijst wordt ook aanvaard");
  const slecht = [a, { id: 9, name: "X", type: "plant", image: "javascript:alert(1)" }, { id: 8, name: "Y", type: "plant", image: "https://evil.example/x.png" }, { id: 7, type: "plant", image: "data:image/png;base64,AA" }, { id: 6, name: "Z", type: "mens", image: "data:image/png;base64,AA" }, null, 5];
  const q = T.parseBackup(JSON.stringify({ app: "NatuurScanner", scans: slecht }));
  ok(q.ok && q.scans.length === 1 && q.overgeslagen === 6, "onveilige of kapotte items overgeslagen (javascript:, externe URL, zonder naam, vreemd type)");
  const m = T.mergeHistory([a, c], [b, a]);
  ok(m.toegevoegd === 1 && m.alAanwezig === 1 && m.lijst.map((x) => x.id).join() === "3,2,1", "samenvoegen: geen dubbels, nieuwste eerst");
  const vol = T.saveHistory([]);
  ok(Array.isArray(vol), "saveHistory geeft altijd een lijst terug");
});

test("F4 back-up: knoppen op het scherm", "scan", async () => {
  const { App } = fresh(); setKeys({ gemini: "K" }); mount(App);
  global.__net.handler = () => gemOk(PLANT);
  uploadFile(0); await waitText("Madeliefje"); click("Terug");
  click("Geschiedenis (1)");
  ok(hasText("Back-up opslaan") && hasText("Back-up laden"), "knoppen zichtbaar");
  click("Back-up opslaan");
  eq(global.__downloads.length, 1, "download gestart");
  ok(/^natuurscanner-backup-\d{4}-\d{2}-\d{2}\.json$/.test(global.__downloads[0].download), "bestandsnaam met datum: " + global.__downloads[0].download);
  ok(hasText("Back-up met 1 scans gemaakt"), "bevestiging getoond");
  const tekst = await new Promise((res) => { const fr = new window.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(global.__lastBlob); });
  ok(tekst.includes('"app":"NatuurScanner"') && tekst.includes("Madeliefje"), "bestand bevat de scan");
  // wis alles en laad de back-up terug
  click("🗑"); ok(hasText("Nog niets gescand"), "geschiedenis leeg");
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File([tekst], "b.json", { type: "application/json" })] } });
  await waitText("1 scans toegevoegd");
  ok(hasText("Madeliefje"), "scan is terug na het laden");
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File([tekst], "b.json")] } });
  await waitText("0 scans toegevoegd"); ok(hasText("1 stonden er al"), "tweede keer laden maakt geen dubbels");
  eq(JSON.parse(localStorage.getItem("plantscanner_history")).length, 1, "nog steeds 1 scan opgeslagen");
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(["geen json {"], "x.json")] } });
  await waitText("geen geldige back-up"); ok(true, "kapotte back-up: duidelijke melding, geen crash");
  ok(hasText("Madeliefje"), "bestaande scans onaangetast na foute back-up");
});

test("F5 opslag vol: oudste scans vallen weg en gebruiker wordt gewaarschuwd", "scan", async () => {
  const { App, T } = fresh(); setKeys({ gemini: "K" });
  const oud = []; for (let i = 0; i < 30; i++) oud.push(seedEntry({ id: 5000 - i, name: "Oud" + i, type: "plant", image: "data:image/png;base64," + "A".repeat(400) }));
  localStorage.setItem("plantscanner_history", JSON.stringify(oud));
  const orig = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = function (k, v) { if (k === "plantscanner_history" && String(v).length > 11000) throw new Error("QuotaExceededError"); return orig.call(this, k, v); };
  try {
    mount(App);
    global.__net.handler = () => gemOk(PLANT);
    uploadFile(0); await waitText("Madeliefje"); click("Terug");
    await waitText("opslag van dit toestel is vol");
    ok(true, "waarschuwing op het startscherm");
    const nu = JSON.parse(localStorage.getItem("plantscanner_history"));
    ok(nu.length < 31 && nu[0].name === "Madeliefje", "nieuwste scan bewaard, oudste vielen weg (" + nu.length + " bewaard)");
    ok(nu.some((x) => x.name === "Oud0") && !nu.some((x) => x.name === "Oud29"), "de nieuwste oude scan blijft, de oudste valt weg");
    click("Geschiedenis"); click("Back-up opslaan"); click("Menu");
    ok(!hasText("opslag van dit toestel is vol"), "na een back-up verdwijnt de waarschuwing");
  } finally { window.Storage.prototype.setItem = orig; }
});

test("F6 album en voortgang", "scan", async () => {
  const { T } = fresh();
  const h = [seedEntry({ id: 5, name: "Madeliefje", type: "plant" }), seedEntry({ id: 9, name: "madeliefje ", type: "plant" }), seedEntry({ id: 7, name: "Vos", type: "animal" }), seedEntry({ id: 1, name: "Vos", type: "plant" })];
  const al = T.bouwAlbum(h);
  eq(al.length, 3, "dezelfde naam in andere hoofdletters telt als één soort; plant en dier met zelfde naam blijven apart");
  eq(al[0].laatste.id, 9, "nieuwste scan bepaalt de foto");
  eq(al.find((x) => x.name.trim().toLowerCase() === "madeliefje").aantal, 2, "aantal keer gescand");
  eq([T.albumBadge(2), T.albumBadge(3), T.albumBadge(10), T.albumBadge(25), T.albumBadge(50)].join("|"), "|🌱 Beginnende ontdekker|🥉 Natuurverkenner|🥈 Natuurkenner|🥇 Natuurmeester", "badges op 3/10/25/50");
  eq(T.bouwAlbum(null).length, 0, "lege/ontbrekende lijst crasht niet");
  const r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  ok(hasText("Mijn Album (0)"), "album-knop ook zonder kindermodus");
  global.__net.handler = (u, o) => gemOk(/Identificeer dit dier/.test(o.body) ? ANIMAL : PLANT);
  uploadFile(0); await waitText("Madeliefje"); click("Terug");
  uploadFile(0); await waitText("Madeliefje"); click("Terug");
  uploadFile(1); await waitText("Rode vos"); click("Terug");
  click("Mijn Album (2)");
  ok(hasText("2 soorten ontdekt") && hasText("1 planten") && hasText("1 dieren"), "teller: 2 soorten, 1 plant, 1 dier");
  ok(hasText("2× gescand") && hasText("1× gescand"), "aantal per soort");
  ok(hasText("Safari-sterren: 0") && hasText("Quizzen: 0"), "statistieken beginnen op nul");
  fireEvent.click(document.querySelector("img[alt='Rode vos']").parentElement);
  ok(hasText("Vulpes vulpes"), "klik in album opent het resultaat");
});

const NAMEN4 = ["Lavendel", "Basilicum", "Rode vos", "Merel"], KLASSEN = ["Zoogdier", "Vogel", "Reptiel", "Amfibie", "Vis", "Insect", "Spinachtige"], JANEE = ["Ja, giftig", "Nee, niet giftig"];
function klikScan(naamVan, juist) {
  const img = document.querySelector("img[alt='je scan']");
  const naam = naamVan[img.getAttribute("src")], tekst = body();
  let goed, set;
  if (tekst.includes("Welke soort heb jij hier gescand?")) { goed = naam; set = null; }
  else if (tekst.includes("Tot welke groep")) { goed = naam === "Rode vos" ? "Zoogdier" : "Vogel"; set = KLASSEN; }
  else { goed = naam === "Lavendel" ? "Ja, giftig" : "Nee, niet giftig"; set = JANEE; }
  const knoppen = screen.getAllByRole("button").filter((x) => { const tx = x.textContent.trim(); return tx && !/Stoppen|Lees voor|Volgende vraag|Resultaat/.test(tx); });
  const doel = juist ? knoppen.find((x) => x.textContent.trim() === goed) : knoppen.find((x) => x.textContent.trim() !== goed);
  if (!doel) throw new Error("antwoordknop niet gevonden voor " + goed);
  fireEvent.click(doel);
}
test("F7 quiz over eigen scans", "scan", async () => {
  const { T } = fresh();
  const A = "data:image/png;base64,IMGA", B = "data:image/png;base64,IMGB", C = "data:image/png;base64,IMGC", D = "data:image/png;base64,IMGD";
  const hist = [
    seedEntry({ id: 4, name: "Lavendel", type: "plant", image: A, giftigheid: { mens: "niet", dier: "licht" }, tip: "Veel zon" }),
    seedEntry({ id: 3, name: "Basilicum", type: "plant", image: B, giftigheid: { mens: "niet", dier: "niet" } }),
    seedEntry({ id: 2, name: "Rode vos", type: "animal", image: C, klasse: "Zoogdieren", weetje: "Vossen zijn slim." }),
    seedEntry({ id: 1, name: "Merel", type: "animal", image: D, klasse: "Vogels" }),
  ];
  eq(T.klasseCanon("Zoogdieren"), "Zoogdier", "klasse 'Zoogdieren' -> Zoogdier");
  eq(T.klasseCanon("vogel"), "Vogel", "klasse 'vogel' -> Vogel"); eq(T.klasseCanon("Rare klasse"), null, "onbekende klasse wordt overgeslagen");
  const naamVan = { [A]: "Lavendel", [B]: "Basilicum", [C]: "Rode vos", [D]: "Merel" };
  let alles = true, uniek = true, maxN = 0, minN = 99, soorten = new Set();
  for (let i = 0; i < 80; i++) {
    const vr = T.buildScanQuiz(hist);
    maxN = Math.max(maxN, vr.length); minN = Math.min(minN, vr.length);
    for (const q of vr) {
      if (new Set(q.opts.map((o) => o.toLowerCase())).size !== q.opts.length) uniek = false;
      const naam = naamVan[q.image];
      let goed;
      if (q.q === "Welke soort heb jij hier gescand?") { goed = naam; soorten.add("foto"); }
      else if (q.q.startsWith("Tot welke groep")) { goed = naam === "Rode vos" ? "Zoogdier" : "Vogel"; soorten.add("groep"); }
      else if (q.q.includes("giftig voor huisdieren")) { goed = naam === "Lavendel" ? "Ja, giftig" : "Nee, niet giftig"; soorten.add("gift"); }
      else { alles = false; continue; }
      if (q.opts[q.correct] !== goed) alles = false;
    }
  }
  ok(alles, "bij elke gegenereerde vraag staat het juiste antwoord op de juiste plek (80 rondes)");
  ok(uniek, "nooit twee gelijke antwoordopties (ook niet in andere hoofdletters)");
  ok(minN >= 3 && maxN <= 10, `aantal vragen tussen 3 en 10 (${minN}-${maxN})`);
  eq([...soorten].sort().join(), "foto,gift,groep", "alle drie de vraagsoorten komen voor");
  eq(T.buildScanQuiz([hist[0]]).length < 3, true, "met 1 scan te weinig vragen");
  // op het scherm
  const r = fresh(); localStorage.setItem("plantscanner_history", JSON.stringify(hist)); mount(r.App); setKids();
  click("Start Natuur Quiz");
  ok(hasText("Mijn Scans Quiz"), "knop zichtbaar bij 4 scans");
  click("Mijn Scans Quiz");
  let aantal = 0;
  for (let i = 0; i < 10; i++) {
    if (!hasText(`Vraag ${i + 1} / `)) break;
    aantal++;
    ok(!!document.querySelector("img[alt='je scan']"), `vraag ${i + 1} toont je eigen foto`);
    klikScan(naamVan, true);
    await volgende();
    await new Promise((res) => setTimeout(res, 20));
  }
  await waitFor(() => { if (!hasText("GEFELICITEERD")) throw new Error("geen diploma"); }, { timeout: 3000 });
  ok(aantal >= 3, `${aantal} vragen alle juist beantwoord -> diploma`);
  click("Verder Spelen");
  // te weinig scans
  const r2 = fresh(); localStorage.setItem("plantscanner_history", JSON.stringify([hist[0]])); mount(r2.App); setKids();
  click("Start Natuur Quiz");
  ok(!btn("Mijn Scans Quiz") && hasText("Scan eerst minstens 3"), "met 1 scan: geen knop maar een uitleg");
  // opnieuw spelen vanuit resultaatscherm blijft in de scans-quiz
  const r3 = fresh(); localStorage.setItem("plantscanner_history", JSON.stringify(hist)); mount(r3.App); setKids();
  click("Start Natuur Quiz"); click("Mijn Scans Quiz");
  let n3 = 0;
  while (hasText("Vraag " + (n3 + 1) + " / ") && n3 < 12) { klikScan(naamVan, false); n3++; await volgende(); await new Promise((res) => setTimeout(res, 20)); }
  await waitFor(() => { if (!btn("Nog een keer") && !btn("Verder Spelen")) throw new Error("einde niet bereikt"); }, { timeout: 3000 });
  ok(!!btn("Nog een keer"), "alles fout beantwoord -> resultaatscherm met 'Nog een keer'");
  click("Nog een keer"); await waitText("Vraag 1 / ");
  ok(!!document.querySelector("img[alt='je scan']"), "'Nog een keer' blijft bij de scans-quiz (met je eigen foto's)");
});



// =====================================================================================
// G. ROBUUSTHEID (gevonden met de aapjestest en nagedacht over echte situaties)
// =====================================================================================
const sleutelFouten = () => [...consoleErrors.entries()].filter(([m]) => /same key|Maximum update depth|unmounted component|Can't perform a React state update/.test(m)).reduce((a, [, n]) => a + n, 0);

test("G1 back-up met dubbele id's geeft geen dubbele items of key-fouten", "scan", async () => {
  const { T } = fresh();
  const x = seedEntry({ id: 77, name: "Dubbel", type: "plant" });
  const m = T.mergeHistory([], [x, { ...x }, seedEntry({ id: 78, name: "Enkel", type: "plant" })]);
  eq(m.toegevoegd, 2, "twee keer hetzelfde id in de back-up wordt maar één keer toegevoegd");
  eq(m.lijst.length, 2, "lijst heeft geen dubbele id's");
  const r = fresh(); mount(r.App);
  const voor = sleutelFouten();
  click("Geschiedenis");
  const tekst = JSON.stringify({ app: "NatuurScanner", scans: [x, { ...x }, { ...x, name: "Kopie" }] });
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File([tekst], "b.json")] } });
  await waitText("scans toegevoegd");
  eq(sleutelFouten() - voor, 0, "geen React key-waarschuwing na het laden");
  eq(JSON.parse(localStorage.getItem("plantscanner_history")).length, 1, "slechts 1 unieke scan opgeslagen");
});

test("G2 opslag vol tijdens opslaan/laden: bewaard = wat echt is opgeslagen", "controle", () => {
  const { T } = fresh();
  const orig = window.Storage.prototype.setItem;
  const maak = (n, g) => Array.from({ length: n }, (_, i) => seedEntry({ id: 9000 - i, name: "S" + i, type: "plant", image: "data:image/png;base64," + "A".repeat(g) }));
  try {
    window.Storage.prototype.setItem = function (k, v) { if (k === "plantscanner_history" && String(v).length > 8000) throw new Error("QuotaExceededError"); return orig.call(this, k, v); };
    const lijst = maak(60, 400);                    // ~30 KB: er moeten er veel wegvallen
    const bewaard = T.saveHistory(lijst);
    const opSchijf = JSON.parse(localStorage.getItem("plantscanner_history") || "[]");
    ok(bewaard.length < 60 && bewaard.length > 0, "een deel past (" + bewaard.length + " van 60)");
    eq(bewaard.length, opSchijf.length, "teruggegeven lijst = wat echt in localStorage staat (geen schijnbare scans)");
    eq(bewaard[0].id, 9000, "nieuwste blijft vooraan");
    const reuze = maak(1, 20000);                   // past nooit
    const leeg = T.saveHistory(reuze);
    eq(JSON.parse(localStorage.getItem("plantscanner_history")).length, leeg.length, "ook als niets past blijven lijst en opslag gelijk");
  } finally { window.Storage.prototype.setItem = orig; }
  const klein = maak(3, 10);
  eq(T.saveHistory(klein).length, 3, "normaal geval: niets valt weg");
  window.Storage.prototype.setItem = function () { throw new Error("SecurityError: opslag geblokkeerd"); };
  try { eq(T.saveHistory(klein).length, 3, "opslag helemaal geblokkeerd: scans blijven wel zichtbaar tijdens dit bezoek"); } finally { window.Storage.prototype.setItem = orig; }
});

test("G3 scans met kapotte of vreemde gegevens laten de app niet crashen", "scan", async () => {
  const img = "data:image/png;base64,AAAA";
  const hist = [
    { id: 4, name: "KapotA", type: "plant", image: img, date: "x", giftigheid: "kapot", health: 5, freq: null, amount: 7, light: {}, tip: [] },
    { id: 3, name: "KapotB", type: "animal", image: img, date: "x", klasse: 5, weetje: { a: 1 }, gezond: "ja", leefgebied: [], leeftijd: null },
    { id: 2, name: "KapotC", type: "plant", image: img, date: "x", giftigheid: { mens: {}, dier: [] }, health: { isHealthy: false } },
    { id: 1, name: "KapotD", type: "plant", image: img, date: "x", giftigheid: { mens: "sterk" }, health: null },
  ];
  const voor = sleutelFouten();
  for (const kids of [false, true]) {
    const r = fresh(); localStorage.setItem("plantscanner_history", JSON.stringify(hist)); if (kids) localStorage.setItem("plantscanner_kids_mode", "1");
    localStorage.setItem("natuurscanner_voorlezen", "1");
    mount(r.App);
    for (const h of hist) {
      click("Geschiedenis"); fireEvent.click(document.querySelector(`img[alt='${h.name}']`).parentElement);
      ok(hasText("← Terug"), `${h.name} (${kids ? "kind" : "volwassene"}): resultaatscherm opent zonder crash`);
      click("Terug");
    }
    click("Mijn Album"); ok(hasText("4 soorten ontdekt"), "album toont ook kapotte scans"); click("Menu");
    if (kids) { click("Start Natuur Quiz"); ok(hasText("Mijn Scans Quiz"), "scans-quiz beschikbaar"); click("Mijn Scans Quiz"); await waitText("Vraag 1 / "); ok(true, "scans-quiz start met kapotte gegevens"); }
  }
  eq(sleutelFouten() - voor, 0, "geen React-waarschuwingen");
});

test("G4 foutscherm in plaats van wit scherm", "controle", async () => {
  const { T } = fresh();
  let gooi = true;
  const Bom = () => { if (gooi) throw new Error("test-ontploffing"); return React.createElement("div", null, "alles weer goed"); };
  render(React.createElement(T.ErrorBoundary, null, React.createElement(Bom)));
  ok(hasText("Oeps, er ging iets mis"), "vriendelijk foutscherm");
  ok(hasText("je scans zijn nog bewaard"), "geruststellende tekst");
  ok(hasText("test-ontploffing") , "technische details voor de leerkracht aanwezig");
  gooi = false; click("Terug naar start");
  ok(hasText("alles weer goed"), "knop herstelt de app");
  eq(typeof T.cleanEntry, "function", "cleanEntry beschikbaar");
});

test("G5 AI levert objecten/lijsten i.p.v. tekst: geen crash, tekst blijft leesbaar", "scan", async () => {
  const T = fresh().T;
  eq(T.asText({ a: "Veel", b: ["zon", 3] }), "Veel · zon, 3", "asText: object en lijst");
  eq(T.asText(null) + T.asText(undefined) + T.asText(12) + T.asText(true), "12true", "asText: null/getal/boolean");
  const r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => gemOk({ ...PLANT, light: { min: "Halfschaduw", max: "Zon" }, soil: ["Los", "Voedzaam"], freq: 7, amount: { ml: "200" }, tip: null, ziekte: { naam: "Meeldauw" }, gezond: false, oorzaak: ["Vocht"], oplossing: { stap: "Knip aan" }, giftig: "ja, giftig" });
  const voor = sleutelFouten();
  uploadFile(0); await waitText("Madeliefje");
  ok(hasText("Halfschaduw · Zon") && hasText("Los, Voedzaam"), "geneste waarden worden leesbare tekst");
  ok(hasText("Meeldauw") && hasText("Knip aan"), "ook de gezondheidstekst");
  ok(hasText("Giftigheid") && hasText("Onbekend"), "kapotte 'giftig' -> onbekend (veilige raad)");
  const hist = JSON.parse(localStorage.getItem("plantscanner_history"));
  ok(typeof hist[0].light === "string" && typeof hist[0].freq === "string", "ook zo opgeslagen");
  click("Terug");
  const r2 = fresh(); setKeys({ gemini: "K" }); mount(r2.App);
  global.__net.handler = () => gemOk({ ...ANIMAL, weetje: ["Eerste", "Tweede"], leefgebied: { a: "Bos", b: "Tuin" }, klasse: ["Zoogdier"], leeftijd: 3, gezondheidsopmerking: null });
  uploadFile(1); await waitText("Rode vos");
  ok(hasText("Eerste, Tweede") && hasText("Bos · Tuin"), "dier: geneste waarden leesbaar");
  eq(sleutelFouten() - voor, 0, "geen React-waarschuwingen");
});


// =====================================================================================
// H. NIEUW IN v7: seizoensmissies en gevaarlijke/invasieve soorten
// =====================================================================================
test("H1 seizoensmissies: data en seizoenskeuze", "controle", () => {
  const { T } = fresh();
  eq(Object.keys(T.SAFARI_SEIZOEN).join(), "lente,zomer,herfst,winter", "vier seizoenen");
  for (const sz of Object.keys(T.SAFARI_SEIZOEN)) {
    const l = T.SAFARI_SEIZOEN[sz];
    eq(l.length, 12, `${sz}: 12 missies`);
    eq(new Set(l).size, 12, `${sz}: geen dubbele missies`);
    ok(l.every((m) => typeof m === "string" && m.length > 15 && m.length < 140), `${sz}: alle missies zijn nette tekst`);
  }
  const alle = Object.values(T.SAFARI_SEIZOEN).flat();
  eq(new Set(alle).size, 48, "geen enkele missie in twee seizoenen");
  const maanden = ["winter", "winter", "lente", "lente", "lente", "zomer", "zomer", "zomer", "herfst", "herfst", "herfst", "winter"];
  ok(maanden.every((sz, m) => T.huidigSeizoen(new Date(2026, m, 15)) === sz), "maand -> seizoen klopt voor alle 12 maanden");
  eq(T.huidigSeizoen(new Date(2026, 2, 1)) + T.huidigSeizoen(new Date(2026, 4, 31)) + T.huidigSeizoen(new Date(2026, 11, 1)) + T.huidigSeizoen(new Date(2026, 1, 28)), "lentelentewinterwinter", "randen van de seizoenen (1 maart, 31 mei, 1 december, 28 feb)");
  ok(["lente", "zomer", "herfst", "winter"].includes(T.huidigSeizoen()), "zonder datum: huidig seizoen");
  ok(!Object.keys(T.SAFARI_MISSIES).includes("seizoen"), "gewone gebieden blijven bos/park/dierentuin");
  eq(T.getMissieList("seizoen", []).join("|"), T.SAFARI_SEIZOEN[T.huidigSeizoen()].join("|"), "getMissieList('seizoen') geeft de lijst van het huidige seizoen");
});

test("H2 seizoensmissies op het scherm (alle vier de seizoenen)", "scan", async () => {
  const RealDate = global.Date;
  const maandVan = { lente: 3, zomer: 6, herfst: 9, winter: 0 };
  try {
    for (const sz of ["lente", "zomer", "herfst", "winter"]) {
      const maand = maandVan[sz];
      global.Date = class extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(2026, maand, 15, 12, 0, 0); }
        static now() { return new RealDate(2026, maand, 15, 12, 0, 0).getTime(); }
      };
      const r = fresh(); mount(r.App); setKids();
      click("Start Natuur Safari");
      const naam = r.T.SEIZOEN_NAAM[sz];
      ok(hasText(`${naam}-missies`), `${sz}: knop '${naam}-missies' zichtbaar`);
      ok(["bos", "park", "dierentuin"].every((g) => !!btn(g)), `${sz}: de drie gewone gebieden blijven bestaan`);
      click(`${naam}-missies`);
      const lijst = r.T.SAFARI_SEIZOEN[sz];
      const huidige = () => lijst.find((m) => body().includes(m));
      ok(!!huidige(), `${sz}: een missie uit de seizoenslijst wordt getoond`);
      const gezien = new Set([huidige()]); let vorige = huidige(), zelfde = false;
      for (let i = 0; i < 14; i++) { click("Andere missie"); const m = huidige(); if (!m) zelfde = true; if (m === vorige) zelfde = true; gezien.add(m); vorige = m; }
      ok(!zelfde, `${sz}: telkens een andere missie uit het eigen seizoen`);
      ok(gezien.size >= 10, `${sz}: 14x doorklikken geeft minstens 10 verschillende missies (${gezien.size})`);
      cleanup();
    }
  } finally { global.Date = RealDate; }
  // missie uit het seizoen laten controleren door Gemini
  const r = fresh(); setKeys({ gemini: "K" }); mount(r.App); setKids();
  global.__net.handler = () => gemOk({ gevonden: true, uitleg: "Prima gezien!" });
  click("Start Natuur Safari"); click(`${r.T.SEIZOEN_NAAM[r.T.huidigSeizoen()]}-missies`); click("Scan & Controleer");
  await waitFor(() => { if (!document.querySelector("video")) throw new Error("camera"); });
  fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === ""));
  await waitText("🎉 Prima gezien!"); ok(hasText("1 Sterren"), "ster na een geslaagde seizoensmissie");
});

test("H3 gevaarlijke en invasieve soorten: herkenning op naam", "controle", () => {
  const { T } = fresh();
  const titels = (n) => T.gevaarWaarschuwingen(n).map((g) => g.titel).join("|");
  for (const [naam, deel] of [["Reuzenberenklauw", "Berenklauw"], ["Gewone berenklauw", "Berenklauw"], ["Heracleum mantegazzianum", "Berenklauw"], ["Gevlekte scheerling", "Scheerling"], ["Waterscheerling", "Scheerling"],
    ["Eikenprocessierups", "Processierups"], ["Pijnboomprocessierups", "Processierups"], ["Aziatische hoornaar", "Hoornaar"], ["Europese hoornaar", "Hoornaar"], ["Teek", "Teek"], ["Schapenteek", "Teek"], ["Schapenteken", "Teek"], ["Ixodes ricinus", "Teek"],
    ["Japanse duizendknoop", "Invasieve"], ["Sachalinse duizendknoop", "Invasieve"], ["Reuzenbalsemien", "Invasieve"], ["Himalayabalsemien", "Invasieve"], ["Amerikaanse stierkikker", "Invasieve"]]) {
    ok(titels(naam).includes(deel), `herkend: ${naam}`);
  }
  for (const naam of ["Madeliefje", "Eik", "Roos", "Lavendel", "Vlijtig liesje", "Balsemien", "Tuinbalsemien", "Gewone wesp", "Teeltaarde", "Teelt", "Bibliotheek", "Apotheek", "Rode vos", "Merel", "Wilde peen", "Kervel", "Paardenbloem", "Egel", "", null, undefined])
    eq(T.gevaarWaarschuwingen(naam).length, 0, `geen waarschuwing voor: ${naam}`);
  const alleTeksten = T.GEVAAR_SOORTEN.map((g) => g.tekst);
  ok(T.GEVAAR_SOORTEN.filter((g) => g.ernst === "gevaar").every((g) => /112|dokter|volwassene|070 245 245/.test(g.tekst)), "elke gevaar-tekst zegt wat je moet doen (volwassene/dokter/112/Antigifcentrum)");
  ok(T.GEVAAR_SOORTEN.every((g) => g.tekst.length > 60 && g.tekst.length < 700 && g.titel && g.icoon), "alle teksten netjes gevuld");
  ok(alleTeksten.filter((x) => x.includes("070 245 245")).length >= 1, "Antigifcentrum genoemd bij de giftige scheerling");
  eq(T.gevaarWaarschuwingen("Eikenprocessierups op berenklauw").length, 2, "twee gevaren in één naam: beide getoond");
  ok(T.resultText({ type: "animal", name: "Eikenprocessierups" }).startsWith("Eikenprocessierups. Let op: Processierups: niet aanraken."), "voorlezen: waarschuwing komt vóór de rest (dier)");
  ok(T.resultText({ type: "plant", name: "Reuzenberenklauw", giftigheid: null }).includes("water en zeep"), "voorlezen: waarschuwing ook bij planten");
  ok(!T.resultText({ type: "plant", name: "Roos", giftigheid: null }).includes("Let op:"), "geen waarschuwing in de voorleestekst van een gewone plant");
});

test("H4 gevarenkaart op het resultaatscherm", "scan", async () => {
  let r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => gemOk({ ...PLANT, name: "Reuzenberenklauw" });
  uploadFile(0); await waitText("Reuzenberenklauw");
  ok(hasText("Berenklauw: niet aanraken") && hasText("water en zeep"), "plant: rode gevarenkaart");
  ok(hasText("Niet opeten") && hasText("Giftigheid"), "de bestaande giftigheids- en eetkaart blijven er ook staan");
  r = fresh(); setKeys({ gemini: "K" }); mount(r.App); setKids();
  global.__net.handler = () => gemOk({ ...ANIMAL, name: "Eikenprocessierups", klasse: "Insect" });
  uploadFile(1); await waitText("Eikenprocessierups");
  ok(hasText("Processierups: niet aanraken") && hasText("Spoel de huid"), "dier: gevarenkaart (kindermodus)");
  ok(hasText("Gezondheidscheck"), "bestaande dierenkaarten blijven staan");
  r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => gemOk({ ...PLANT, name: "Japanse duizendknoop" });
  uploadFile(0); await waitText("Japanse duizendknoop");
  ok(hasText("Invasieve soort") && hasText("composthoop"), "invasieve soort: blauwe kaart");
  r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => gemOk(PLANT);
  uploadFile(0); await waitText("Madeliefje");
  ok(!hasText("niet aanraken") && !hasText("Invasieve soort"), "gewone plant: geen gevarenkaart");
  r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => gemOk(ANIMAL);
  uploadFile(1); await waitText("Rode vos");
  ok(!hasText("niet aanraken") && !hasText("Invasieve soort") && !hasText("blijf weg van het nest"), "gewoon dier: geen gevarenkaart");
  // ook vanuit de geschiedenis en voorlezen
  r = fresh(); localStorage.setItem("natuurscanner_voorlezen", "1"); setKeys({ gemini: "K" }); mount(r.App);
  global.__net.handler = () => gemOk({ ...PLANT, name: "Gevlekte scheerling" });
  uploadFile(0); await waitText("Gevlekte scheerling");
  ok(hasText("Scheerling: zeer giftig"), "scheerlingkaart");
  await waitFor(() => { if (!speech.spoken.some((u) => u.text.includes("Scheerling is zeer giftig"))) throw new Error("niet voorgelezen"); });
  ok(true, "waarschuwing wordt ook voorgelezen");
});


test("G6 prestatie: scans-quiz en album blijven snel bij een grote geschiedenis", "controle", () => {
  const { T } = fresh();
  const maak = (n) => Array.from({ length: n }, (_, i) => seedEntry({ id: 10000 - i, name: "Soort " + i, type: i % 2 ? "animal" : "plant", klasse: "Vogels", image: "data:image/png;base64,AAAA", giftigheid: { mens: "niet", dier: "licht" } }));
  for (const n of [60, 250, 1000]) {
    const h = maak(n);
    const t0 = performance.now(); for (let k = 0; k < 5; k++) T.buildScanQuiz(h); const ms = (performance.now() - t0) / 5;
    ok(ms < 40, `buildScanQuiz bij ${n} scans: ${ms.toFixed(1)} ms per aanroep (grens 40 ms)`);
    const a0 = performance.now(); T.bouwAlbum(h); ok(performance.now() - a0 < 40, `bouwAlbum bij ${n} scans is snel`);
    const vr = T.buildScanQuiz(h);
    ok(vr.length >= 3 && vr.length <= 10, `${n} scans: ${vr.length} vragen`);
    ok(vr.every((q) => new Set(q.opts.map((o) => String(o).toLowerCase())).size === q.opts.length && q.opts[q.correct] !== undefined), `${n} scans: opties uniek en juist antwoord aanwezig`);
  }
});

test("G7 beschadigde opgeslagen gegevens: de app start en blijft werken", "scan", async () => {
  // eerst een echte sessie, zodat alle bestaande sleutels aangemaakt worden
  const a = fresh(); setKeys({ gemini: "K" }); localStorage.setItem("natuurscanner_voorlezen", "1"); mount(a.App); setKids();
  global.__net.handler = () => gemOk(PLANT);
  uploadFile(0); await waitText("Madeliefje"); click("Terug");
  click("Start Natuur Quiz"); click("Makkelijk"); await waitText("Vraag 1 / 10");
  const q0 = shownQuestion(a.T); fireEvent.click(screen.getAllByRole("button").find((x) => x.textContent.trim() === q0.opts[q0.correct])); await volgende(); click("Stoppen");
  click("Start Natuur Safari"); click("bos"); click("Menu");
  click("Start Natuur Safari"); click(/-missies/); click("Menu");
  const sleutels = [...new Set([...Object.keys(localStorage), "natuurscanner_stem", "natuurscanner_voorleestempo", "natuurscanner_stats", "plantscanner_api_usage", "plantscanner_teacher_pin", "plantscanner_firebase_url"])];
  ok(sleutels.length >= 10, `${sleutels.length} opslagsleutels gevonden: ${sleutels.join(", ").slice(0, 400)}`);
  const kapot = ["{{garbage", "null", "undefined", "[]", "{}", "123", '"tekst"', '{"a":{"b":1}}', "x".repeat(4000), "[1,2,3]", "[null]", '[{"id":1}]', '[{"id":1,"name":"X","type":"plant","image":"nope"}]', "true", "-1", "[[]]", '{"sterren":"veel","quizzen":{},"diplomas":[]}'];
  const tryClick = (re) => { const b = btn(re); if (b) { fireEvent.click(b); return true; } return false; };
  for (const g of kapot) {
    const r = fresh();
    for (const k of sleutels) localStorage.setItem(k, g);
    mount(r.App);
    const stap = (naam, f) => { try { f(); } catch (e) { throw new Error(`waarde ${JSON.stringify(g).slice(0, 30)} bij '${naam}': ${e.message.split("\n")[0]}`); } if (hasText("Oeps, er ging iets mis")) throw new Error(`foutscherm bij '${naam}' met opslagwaarde ${JSON.stringify(g).slice(0, 30)}`); };
    stap("start", () => ok(/PlantScanner|NatuurScanner/.test(body()) && !!btn("Instellingen"), `start met beschadigde opslag ${JSON.stringify(g).slice(0, 24)}`));
    stap("geschiedenis", () => { tryClick("Geschiedenis"); const im = document.querySelector("img[alt]:not([alt='scan'])"); if (im) fireEvent.click(im.parentElement); tryClick(/Menu|Terug/); tryClick(/Menu|Terug/); });
    stap("album", () => { tryClick("Mijn Album"); const im = document.querySelector("img[alt]:not([alt='scan'])"); if (im) fireEvent.click(im.parentElement); tryClick(/Menu|Terug/); tryClick(/Menu|Terug/); });
    stap("instellingen", () => { tryClick("Instellingen"); tryClick(/Menu|Terug|Opslaan/); });
    stap("kindermodus", () => { tryClick("🧒 Uit"); });
    stap("safari", () => { tryClick("Start Natuur Safari"); const g1 = btn("bos") || btn("park"); if (g1) fireEvent.click(g1); tryClick("Andere missie"); tryClick("Andere missie"); tryClick(/Menu/); tryClick(/Menu/); });
    stap("quiz", () => { tryClick("Start Natuur Quiz"); tryClick("Mijn Scans Quiz") || tryClick("Gemengd"); tryClick(/Stoppen/); tryClick(/Menu/); });
    ok(!!btn("Instellingen"), `na de rondgang weer op het startscherm (${JSON.stringify(g).slice(0, 24)})`);
  }
});

test("G8 quizvragen raken niet op: 8 rondes Moeilijk na elkaar", "scan", async () => {
  const { App, T } = fresh(); mount(App); setKids();
  const rondes = [];
  for (let r = 0; r < 8; r++) {
    click("Start Natuur Quiz"); click("Moeilijk");
    const vragen = [];
    for (let i = 0; i < 10; i++) {
      await waitText(`Vraag ${i + 1} / 10`);
      const q = shownQuestion(T); vragen.push(q.q);
      fireEvent.click(screen.getAllByRole("button").find((x) => x.textContent.trim() === q.opts[q.correct]));
      await volgende();
    }
    rondes.push(vragen);
    await waitText("GEFELICITEERD", 3000); click("Verder Spelen");
  }
  ok(rondes.every((v) => v.length === 10 && new Set(v).size === 10), "elke ronde: 10 verschillende vragen");
  ok(rondes.every((v) => v.every((q) => T.ALL_QUIZ_QUESTIONS.find((x) => x.q === q).niveau === 3)), "alle vragen uit niveau 3");
  const eerste4 = rondes.slice(0, 4).flat();
  eq(new Set(eerste4).size, 40, "de eerste 4 rondes (40 vragen) hebben geen enkele herhaling");
  eq(JSON.parse(localStorage.getItem("natuurscanner_stats")).quizzen, 8, "8 quizzen bijgehouden");
});


// =====================================================================================
// I. NIEUW IN v9: eerlijke gezondheidscheck (gezond / let op / seizoen / onzeker)
// =====================================================================================
const withDate = async (maand, fn) => {
  const RealDate = global.Date;
  global.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(2026, maand, 15, 12, 0, 0); }
    static now() { return new RealDate(2026, maand, 15, 12, 0, 0).getTime(); }
  };
  try { return await fn(); } finally { global.Date = RealDate; }
};
const plantUitkomst = async (antwoord, keys = { gemini: "K" }, handler) => {
  const r = fresh(); setKeys(keys); mount(r.App);
  global.__net.handler = handler || (() => gemOk(antwoord));
  uploadFile(0); await waitText(/Gezondheidscheck/);
  return r;
};

test("I1 gezondheid: normalisatie en toestanden", "controle", () => {
  const { T } = fresh();
  for (const v of [true, "true", "TRUE", "ja", "Yes", "gezond", " lijkt gezond "]) eq(T.normGezond(v), true, `true: ${JSON.stringify(v)}`);
  for (const v of [false, "false", "nee", "No", "niet gezond", "ongezond", "let op"]) eq(T.normGezond(v), false, `false: ${JSON.stringify(v)}`);
  for (const v of [undefined, null, "", "misschien", "onbekend", 0, 1, [], {}, "null"]) eq(T.normGezond(v), null, `onzeker: ${JSON.stringify(v)}`);
  const st = (h) => T.gezondheidToestand(h);
  eq(st(null), "onzeker", "geen gezondheidsgegevens = onzeker (niet 'gezond')");
  eq(st(undefined), "onzeker", "undefined = onzeker"); eq(st("kapot"), "onzeker", "tekst i.p.v. object = onzeker"); eq(st({}), "onzeker", "leeg object = onzeker");
  eq(st({ isHealthy: true }), "gezond", "true = gezond"); eq(st({ isHealthy: false }), "let-op", "false = let op");
  eq(st({ isHealthy: "false" }), "let-op", "tekst 'false' = let op"); eq(st({ isHealthy: null }), "onzeker", "null = onzeker");
  eq(st({ isHealthy: false, seasonal: true, diseaseName: "" }), "seizoen", "false + seizoensverkleuring zonder ziekte = seizoen");
  eq(st({ isHealthy: false, seasonal: true, diseaseName: "Meeldauw" }), "let-op", "seizoen telt niet als er een ziekte genoemd is");
  eq(st({ isHealthy: true, seasonal: true }), "gezond", "gezond blijft gezond");
  ok(T.GEZOND_UITLEG.includes("geen diagnose") && T.GEZOND_UITLEG.includes("real time"), "uitleg zegt eerlijk: geen diagnose, geen meting in real time");
  const maanden = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((m) => T.herfstNotitie(new Date(2026, m, 15)) ? "H" : "-").join("");
  eq(maanden, "--------HHH-", "herfstnotitie alleen in sep, okt, nov");
});

test("I2 plantscan: elke gezondheidstoestand op het scherm", "scan", async () => {
  const geen = (o, ...k) => { const c = { ...o }; k.forEach((x) => delete c[x]); return c; };
  // gezond, met uitleg en zonder het woord 'Geen ziektes'
  await plantUitkomst({ ...PLANT, gezond: true, waargenomen: "Mooie groene bladeren zonder vlekken" });
  ok(hasText("lijkt gezond") && hasText("Mooie groene bladeren zonder vlekken") && hasText("👀 Wat de AI ziet"), "gezond: toont wat de AI ziet");
  ok(hasText("geen diagnose") && !hasText("Geen ziektes of problemen"), "gezond: eerlijke uitleg, niet meer 'Geen ziektes of problemen'");
  // ontbrekend antwoord = onzeker
  await plantUitkomst(geen(PLANT, "gezond"));
  ok(hasText("❓ Gezondheidscheck: onzeker") && !hasText("lijkt gezond"), "ontbrekende 'gezond' = onzeker, niet gezond");
  await plantUitkomst({ ...PLANT, gezond: null });
  ok(hasText("onzeker") && !hasText("lijkt gezond"), "null = onzeker");
  await plantUitkomst({ ...PLANT, gezond: "false", ziekte: "Meeldauw" });
  ok(hasText("Let op") && hasText("Mogelijk probleem") && hasText("Meeldauw"), "tekst 'false' = let op (was: 'Gezond')");
  await plantUitkomst({ ...PLANT, gezond: "nee" });
  ok(hasText("Gezondheidscheck: Let op"), "'nee' = let op");
  await plantUitkomst({ ...PLANT, gezond: "misschien" });
  ok(hasText("onzeker"), "onduidelijk antwoord = onzeker");
  // herfstverkleuring
  await plantUitkomst({ ...PLANT, gezond: false, ziekte: "", waargenomen: "Gele en bruine bladeren, enkele bleke vlekken", oorzaak: "In oktober is verkleuring bij een esdoorn normaal", seizoen_normaal: true });
  ok(hasText("verkleuring, waarschijnlijk seizoen") && hasText("Gele en bruine bladeren") && hasText("normaal"), "seizoensverkleuring: oranje kaart met uitleg");
  ok(!hasText("🩺 Gezondheidscheck: Let op"), "seizoensverkleuring is geen alarm");
  // seizoen_normaal maar mét ziekte = toch let op
  await plantUitkomst({ ...PLANT, gezond: false, ziekte: "Bladvlekkenziekte", seizoen_normaal: true });
  ok(hasText("Gezondheidscheck: Let op") && hasText("Bladvlekkenziekte"), "een genoemde ziekte blijft 'let op'");
});

test("I3 gezondheid zonder Gemini of met meerdere bronnen", "scan", async () => {
  const net = (u) => u.includes("plantnet") ? { status: 200, json: { results: [{ species: { scientificNameWithoutAuthor: "Acer pseudoplatanus" }, score: 0.9 }] } } : { status: 404 };
  // alleen PlantNet: er is niets beoordeeld
  let r = fresh(); setKeys({ plantNet: "N" }); mount(r.App); global.__net.handler = async (u) => net(u);
  uploadFile(0); await waitText("Acer pseudoplatanus");
  ok(hasText("❓ Gezondheidscheck: onzeker") && !hasText("lijkt gezond"), "alleen PlantNet: 'onzeker' (was: '✅ Gezond' zonder beoordeling)");
  ok(hasText("niet betrouwbaar beoordeeld"), "legt uit dat er niets beoordeeld werd");
  // Gemini valt weg (daglimiet) maar PlantNet werkt
  r = fresh(); setKeys({ gemini: "K", plantNet: "N" }); mount(r.App);
  global.__net.handler = async (u) => (isGemini(u) ? { status: 429, text: "RESOURCE_EXHAUSTED PerDay" } : net(u));
  uploadFile(0); await waitText("Acer pseudoplatanus"); ok(hasText("❓ Gezondheidscheck: onzeker"), "Gemini-daglimiet: gezondheid onzeker");
  // Plant.id
  const pid = (binary, ziekte) => ({ status: 200, json: { result: { classification: { suggestions: [{ name: "Acer pseudoplatanus", probability: 0.95 }] }, disease: { is_healthy: binary === undefined ? {} : { binary }, disease: { suggestions: ziekte ? [{ name: ziekte, details: { description: "Een schimmel op het blad", treatment: { biological: ["Snoei aangetaste bladeren"] } } }] : [] } } } } });
  const kies = (antwoordPid, antwoordGem) => async (u) => (u.includes("plant.id") ? antwoordPid : isGemini(u) ? (antwoordGem ? gemOk(antwoordGem) : { status: 500, text: "x" }) : { status: 404 });
  r = fresh(); setKeys({ plantId: "P" }); mount(r.App); global.__net.handler = kies(pid(true), null);
  uploadFile(0); await waitText("Acer pseudoplatanus"); ok(hasText("lijkt gezond"), "Plant.id zegt gezond (zonder Gemini): lijkt gezond");
  r = fresh(); setKeys({ plantId: "P" }); mount(r.App); global.__net.handler = kies(pid(false, "Meeldauw"), null);
  uploadFile(0); await waitText("Acer pseudoplatanus");
  ok(hasText("Let op") && hasText("Meeldauw") && hasText("Snoei aangetaste bladeren"), "Plant.id zegt ziek: probleem en oplossing getoond");
  r = fresh(); setKeys({ plantId: "P" }); mount(r.App); global.__net.handler = kies(pid(undefined), null);
  uploadFile(0); await waitText("Acer pseudoplatanus"); ok(hasText("onzeker") && !hasText("lijkt gezond") && !hasText("Let op"), "Plant.id zonder duidelijk antwoord: onzeker (was: onterecht ziek of gezond)");
  // tegenspraak: Plant.id gezond, Gemini ziet een probleem -> let op
  r = fresh(); setKeys({ plantId: "P", gemini: "K" }); mount(r.App);
  global.__net.handler = kies(pid(true), { ...PLANT, gezond: false, ziekte: "Bladluizen", oorzaak: "Veel bladluizen op de jonge scheuten", oplossing: "Spoel af met water", waargenomen: "Plakkerige bladeren" });
  uploadFile(0); await waitText("Acer pseudoplatanus");
  ok(hasText("Gezondheidscheck: Let op") && hasText("Bladluizen") && hasText("Plakkerige bladeren"), "één bron ziet een probleem: 'let op' (voorzichtig)");
});

test("I4 de prompt kent datum en seizoen en laat 'weet ik niet' toe", "scan", async () => {
  for (const [maand, seizoen] of [[9, "herfst"], [6, "zomer"], [0, "winter"], [3, "lente"]]) {
    await withDate(maand, async () => {
      const r = fresh(); setKeys({ gemini: "K" }); mount(r.App);
      global.__net.handler = () => gemOk(PLANT);
      uploadFile(0); await waitText("Madeliefje");
      const aanroep = global.__net.calls.find((c) => isGemini(c.url));
      const prompt = JSON.parse(aanroep.opts.body).prompt || aanroep.opts.body;
      ok(prompt.includes(`seizoen: ${seizoen}`), `prompt noemt het seizoen: ${seizoen}`);
      ok(/\b2026\b/.test(prompt) && prompt.includes("in België"), "prompt bevat de datum en het land");
      ok(prompt.includes('"waargenomen"') && prompt.includes('"seizoen_normaal"') && prompt.includes("true/false/null"), "prompt vraagt om waarneming, seizoensuitleg en 'null' bij twijfel");
      ok(prompt.includes("Gok nooit") && prompt.includes("giftig"), "prompt behoudt de giftigheidscheck en 'Gok nooit'");
      cleanup();
    });
  }
});

test("I5 herfstnotitie op het resultaat", "scan", async () => {
  await withDate(9, async () => { await plantUitkomst({ ...PLANT, gezond: true }); ok(hasText("Het is herfst") && hasText("kamerplant"), "oktober: herfstnotitie zichtbaar"); });
  await withDate(6, async () => { await plantUitkomst({ ...PLANT, gezond: true }); ok(!hasText("Het is herfst"), "juli: geen herfstnotitie"); });
});

test("I6 dieren: drie toestanden en eerlijke uitleg", "scan", async () => {
  const dier = async (o) => { const r = fresh(); setKeys({ gemini: "K" }); mount(r.App); global.__net.handler = () => gemOk(o); uploadFile(1); await waitText(o.name); return r; };
  await dier({ ...ANIMAL, gezond: true, gezondheidsopmerking: "Ziet er alert uit" });
  ok(hasText("lijkt gezond") && hasText("Ziet er alert uit") && hasText("geen diagnose"), "dier gezond + uitleg");
  await dier({ ...ANIMAL, gezond: "false", gezondheidsopmerking: "Hinkt" });
  ok(hasText("Gezondheidscheck: Let op") && hasText("Hinkt"), "tekst 'false' = let op");
  await dier({ ...ANIMAL, gezond: null, gezondheidsopmerking: "" });
  ok(hasText("❓ Gezondheidscheck: onzeker") && hasText("niet goed beoordeeld"), "null = onzeker");
  const zonder = { ...ANIMAL }; delete zonder.gezond;
  await dier(zonder);
  ok(!hasText("Gezondheidscheck"), "geen 'gezond'-antwoord: geen kaart (er wordt niets beweerd)");
  const { T } = fresh();
  ok(T.resultText({ type: "animal", name: "Vos", gezond: "false" }).includes("Gezondheidscheck: let op"), "voorlezen: let op");
  ok(T.resultText({ type: "animal", name: "Vos", gezond: null }).includes("onzeker"), "voorlezen: onzeker");
  ok(T.resultText({ type: "plant", name: "Eik", health: null, giftigheid: null }).includes("onzeker"), "voorlezen plant: onzeker");
  ok(T.resultText({ type: "plant", name: "Eik", health: { isHealthy: true } , giftigheid: null }).includes("geen duidelijke tekenen van ziekte"), "voorlezen plant: gezond zonder 'geen ziektes'");
  ok(!T.resultText({ type: "plant", name: "Eik", health: { isHealthy: true }, giftigheid: null }).includes("Geen ziektes of problemen"), "oude stellige zin is weg");
  ok(T.resultText({ type: "plant", name: "Eik", health: { isHealthy: false, seasonal: true, diseaseName: "" }, giftigheid: null }).includes("hoort bij het seizoen") || T.resultText({ type: "plant", name: "Eik", health: { isHealthy: false, seasonal: true, diseaseName: "" }, giftigheid: null }).includes("waarschijnlijk bij het seizoen"), "voorlezen: seizoensverkleuring");
});

test("I7 esdoorn: waarschuwing voor paarden", "scan", async () => {
  const { T } = fresh();
  const titels = (n) => T.gevaarWaarschuwingen(n).map((g) => g.titel).join("|");
  for (const n of ["Gewone esdoorn (Acer pseudoplatanus)", "Gewone esdoorn", "Acer pseudoplatanus", "Vederesdoorn", "Acer negundo"]) ok(titels(n).includes("Esdoorn: gevaarlijk voor paarden"), "herkend: " + n);
  for (const n of ["Eik", "Noorse esdoorn", "Veldesdoorn", "Japanse esdoorn", "Madeliefje"]) ok(!titels(n).includes("paarden"), "geen paardenwaarschuwing voor: " + n);
  const g = T.gevaarWaarschuwingen("Gewone esdoorn")[0];
  ok(g.ernst === "info" && g.tekst.includes("atypische myopathie") && g.tekst.includes("dierenarts"), "tekst noemt atypische myopathie en de dierenarts");
  await plantUitkomst({ ...PLANT, name: "Gewone esdoorn (Acer pseudoplatanus)", gezond: true });
  ok(hasText("Esdoorn: gevaarlijk voor paarden") && hasText("weidemyopathie"), "kaart op het scherm");
});


// =====================================================================================
// J. NIEUW IN v10: automatische dubbelcheck per scan + diagnose-logboek
// =====================================================================================
test("J1 dubbelcheck: losse controles (tekst, namen, bronnen, giftigheid)", "controle", () => {
  const { T } = fresh();
  const pr = (t, s = "plant") => T.problemenInTekst(t, s);
  eq(pr("Mooie groene bladeren zonder vlekken").length, 0, "'zonder vlekken' is geen probleem");
  eq(pr("Geen schimmel te zien en geen gaatjes").length, 0, "ontkenning: geen schimmel, geen gaatjes");
  ok(pr("Gele en bruine bladeren, enkele bleke vlekken").some((x) => x.startsWith("gele")) && pr("Gele en bruine bladeren, enkele bleke vlekken").includes("vlekken"), "gele bladeren en vlekken gevonden");
  ok(pr("Veel bladluizen op de jonge scheuten").includes("bladluizen"), "bladluizen gevonden");
  eq(pr("Gele bloemen en groene bladeren").length, 0, "gele bloemen zijn geen probleem");
  ok(pr("De bladeren zijn geel").length === 1, "'de bladeren zijn geel' is een probleem");
  ok(pr("Het blad vertoont meeldauw").includes("meeldauw"), "meeldauw gevonden");
  eq(pr(null).length + pr(undefined).length + pr(5).length + pr({}).length, 0, "vreemde invoer crasht niet");
  ok(pr("Het dier hinkt en heeft een wond", "dier").length === 2, "dier: hinkt + wond");
  eq(pr("Geen wonden zichtbaar, alert en gezond", "dier").length, 0, "dier: ontkenning");
  eq(T.latijnUit("Gewone esdoorn (Acer pseudoplatanus)"), "Acer pseudoplatanus", "latijn tussen haakjes");
  eq(T.latijnUit("Acer pseudoplatanus"), "Acer pseudoplatanus", "enkel latijn");
  eq(T.latijnUit("Bellis perennis L."), "Bellis perennis", "met auteur");
  eq(T.latijnUit("Madeliefje") + T.latijnUit("") + T.latijnUit(null), "", "geen latijn herkend");
  const vb = (...a) => T.vergelijkBronnen(a.map((l, i) => ({ bron: "B" + i, latijn: l }))).oordeel;
  eq(vb("Acer pseudoplatanus", "acer pseudoplatanus"), "eens", "zelfde soort (hoofdletters negeren)");
  eq(vb("Acer pseudoplatanus", "Acer platanoides"), "geslacht", "zelfde geslacht");
  eq(vb("Acer pseudoplatanus", "Quercus robur"), "verschillend", "verschillend");
  eq(vb("Acer pseudoplatanus", ""), "enkel", "één bron");
  eq(vb("", ""), "geen", "geen bron");
  eq(vb("Acer pseudoplatanus", "Acer pseudoplatanus", "Quercus robur"), "verschillend", "drie bronnen, één wijkt af");
  // giftigheid tegen de lijst
  let g = T.giftControle("Witte lelie (Lilium candidum)", { mens: "niet", dier: "niet" });
  ok(g.aangepast && g.giftigheid.dier === "sterk" && g.giftigheid.mens === "licht" && g.naam.includes("lelie"), "lelie: AI zei 'niet', lijst zegt giftig voor katten");
  for (const n of ["Waterlelie", "Water lelie", "Witte waterlelie (Nymphaea alba)", "Nymphaea alba"]) eq(T.giftControle(n, { mens: "niet", dier: "niet" }).naam, "", `waterlelie staat niet op de lijst: ${n}`);
  eq(T.giftControle("Tijgerlelie (Lilium lancifolium)", { mens: "niet", dier: "niet" }).naam, "lelie of daglelie", "echte lelie (tijgerlelie) wel");
  eq(T.giftControle("Lelietje-van-dalen", null).giftigheid.mens, "sterk", "lelietje-van-dalen: zonder AI-antwoord toch sterk");
  g = T.giftControle("Taxus baccata", { mens: "sterk", dier: "sterk" });
  ok(g.naam === "taxus" && !g.aangepast, "taxus: AI zat al even hoog, niets aangepast");
  g = T.giftControle("Rododendron", { mens: "sterk", dier: "licht" });
  ok(g.aangepast && g.giftigheid.mens === "sterk" && g.giftigheid.dier === "sterk", "nooit lager dan de AI: mens blijft sterk, dier omhoog");
  eq(T.giftControle("Madeliefje", null).giftigheid, null, "gewone plant zonder AI-antwoord blijft null");
  const mv = T.giftControle("Lilium", { mens: "niet", dier: "niet", delen: "bladeren", symptomen: "x", omgang: "y" }).giftigheid;
  ok(mv.delen === "bladeren" && mv.symptomen === "x" && mv.omgang === "y", "tekst van de AI blijft behouden");
  ok(T.BEKENDE_GIFTIG.every((b) => b.re instanceof RegExp && b.naam && ["niet", "licht", "matig", "sterk"].includes(b.mens) && ["niet", "licht", "matig", "sterk"].includes(b.dier) && b.delen && b.symptomen && b.omgang), "alle 15 lijst-items hebben geldige niveaus en teksten");
  eq(T.BEKENDE_GIFTIG.length, 15, "15 bekende giftige planten");
  for (const n of ["Madeliefje", "Eik", "Roos", "Lavendel", "Basilicum", "Paardenbloem", "Gewone esdoorn", "Brandnetel", "Tomaat", "Waterlelie"]) eq(T.giftControle(n, { mens: "niet", dier: "niet" }).naam, "", `geen valse treffer: ${n}`);
  // volledige controle
  const bc = T.bouwPlantControles({ naam: "Acer pseudoplatanus", bronnen: [{ bron: "PlantNet", latijn: "Acer pseudoplatanus" }, { bron: "Gemini", latijn: "Acer pseudoplatanus" }], health: { isHealthy: true, observed: "Gele bladeren met vlekken" }, giftigheid: { mens: "niet", dier: "niet" }, verzorgingVanAI: true });
  ok(bc.health.isHealthy === null, "gezond + beschrijving met problemen = onzeker");
  eq(bc.controles.map((c) => c.id + ":" + c.status).join(), "bronnen:ok,gezondheid:let-op,giftigheid:info", "controles: bronnen ok, gezondheid let op, giftigheid info");
  const dc = T.bouwDierControles({ name: "Vos", gezond: true, gezondheidsopmerking: "Hinkt en heeft een wond", klasse: "Zoogdieren" });
  ok(dc.res.gezond === null && dc.controles.some((c) => c.id === "gezondheid" && c.status === "let-op") && dc.controles.some((c) => c.id === "groep" && c.status === "ok"), "dier: gezond + wond = onzeker, groep herkend");
  ok(!("gezond" in T.bouwDierControles({ name: "Vos" }).res), "dier zonder 'gezond': niets toegevoegd");
  eq(T.cleanControles("kapot").length + T.cleanControles(null).length + T.cleanControles([null, 5, {}, { tekst: "" }]).length, 0, "kapotte controles worden leeg");
  const cc = T.cleanControles([{ id: { a: 1 }, status: "raar", tekst: ["a", "b"] }]);
  ok(cc.length === 1 && cc[0].status === "info" && cc[0].tekst === "a, b", "onbekende status -> info, tekst wordt tekst");
  eq(T.cleanControles(Array.from({ length: 20 }, () => ({ status: "ok", tekst: "x" }))).length, 8, "maximaal 8 controles");
});

test("J2 bronnenvergelijking op het scherm", "scan", async () => {
  const pn = (lat) => async (u) => (u.includes("plantnet") ? { status: 200, json: { results: [{ species: { scientificNameWithoutAuthor: lat }, score: 0.9 }] } } : isGemini(u) ? gemOk({ ...PLANT, name: globalThis.__gemNaam }) : { status: 404 });
  const run = async (gemNaam, keys) => { globalThis.__gemNaam = gemNaam; const r = fresh(); setKeys(keys); mount(r.App); global.__net.handler = pn("Acer pseudoplatanus"); uploadFile(0); await waitText("Automatische dubbelcheck"); return r; };
  await run("Gewone esdoorn (Acer pseudoplatanus)", { gemini: "K", plantNet: "N" });
  ok(hasText("Meerdere bronnen zijn het eens"), "PlantNet en Gemini eens");
  ok(/\d van \d in orde/.test(body()), "kaart toont 'x van y in orde'");
  await run("Noorse esdoorn (Acer platanoides)", { gemini: "K", plantNet: "N" });
  ok(hasText("hetzelfde geslacht maar een andere soort"), "zelfde geslacht, andere soort");
  await run("Zomereik (Quercus robur)", { gemini: "K", plantNet: "N" });
  ok(hasText("De bronnen verschillen") && hasText("tweede foto"), "bronnen verschillen: raad voor een tweede foto");
  await run("Gewone esdoorn (Acer pseudoplatanus)", { gemini: "K" });
  ok(hasText("Slechts één bron kon de soort bepalen"), "enkel Gemini: eerlijk gemeld");
  ok(hasText("Dit zijn automatische controles") && hasText("geen garantie"), "uitleg: geen garantie");
  const r = fresh(); setKeys({ gemini: "K" }); mount(r.App); global.__net.handler = () => ({ status: 429, text: "RESOURCE_EXHAUSTED PerDay" });
  uploadFile(0); await waitText("voor vandaag genoeg gewerkt"); ok(!hasText("Automatische dubbelcheck"), "bij een mislukte scan geen dubbelcheck");
});

test("J3 gezondheid tegenover beschrijving op het scherm", "scan", async () => {
  await plantUitkomst({ ...PLANT, gezond: true, waargenomen: "Gele bladeren met bruine vlekken" });
  ok(hasText("❓ Gezondheidscheck: onzeker") && !hasText("lijkt gezond"), "gezond + gele bladeren: onzeker");
  ok(hasText("De AI zegt \"gezond\", maar beschrijft zelf") && hasText("Daarom behandelen we dit als onzeker"), "dubbelcheck legt de tegenspraak uit");
  await plantUitkomst({ ...PLANT, gezond: true, waargenomen: "Mooie groene bladeren zonder vlekken" });
  ok(hasText("lijkt gezond") && hasText("past bij de conclusie"), "consistente beschrijving: gezond blijft gezond");
  await plantUitkomst({ ...PLANT, gezond: true });
  ok(hasText("lijkt gezond") && hasText("beschreef niet wat hij zag"), "geen beschrijving: gezond maar met waarschuwing in de dubbelcheck");
  await plantUitkomst({ ...PLANT, gezond: false, ziekte: "Meeldauw", waargenomen: "Wit poeder op de bladeren, meeldauw" });
  ok(hasText("Gezondheidscheck: Let op") && hasText("De beschrijving van de AI past bij de conclusie"), "let op + passende beschrijving");
});

test("J4 giftigheid wordt nooit lager dan onze lijst", "scan", async () => {
  await plantUitkomst({ ...PLANT, name: "Witte lelie (Lilium candidum)", giftig: { mens: "niet", dier: "niet", delen: "", symptomen: "", omgang: "" } });
  ok(hasText("staat op onze lijst van bekende giftige planten") && hasText("de waarschuwing is aangepast"), "dubbelcheck meldt de aanpassing");
  const h = JSON.parse(localStorage.getItem("plantscanner_history"))[0];
  ok(h.giftigheid.dier === "sterk" && h.giftigheid.mens === "licht", "ook zo opgeslagen: dier sterk, mens licht");
  ok(hasText("Giftigheid") && hasText("070 245 245"), "giftigheidskaart + Antigifcentrum");
  await plantUitkomst({ ...PLANT, name: "Waterlelie (Nymphaea alba)", giftig: { mens: "niet", dier: "niet" } });
  ok(!hasText("de waarschuwing is aangepast") && hasText("niet op onze korte lijst"), "waterlelie: niet aangepast");
  await plantUitkomst({ ...PLANT, name: "Taxus (Taxus baccata)", giftig: { mens: "sterk", dier: "sterk" } });
  ok(hasText("de AI zat niet te laag"), "taxus: AI zat al juist");
});

test("J5 dieren: dubbelcheck", "scan", async () => {
  const dier = async (o) => { const r = fresh(); setKeys({ gemini: "K" }); mount(r.App); global.__net.handler = () => gemOk(o); uploadFile(1); await waitText(o.name); return r; };
  await dier({ ...ANIMAL, gezond: true, gezondheidsopmerking: "Hinkt en heeft een open wond", klasse: "Zoogdier" });
  ok(hasText("❓ Gezondheidscheck: onzeker") && hasText("beschrijft zelf") && hasText("Automatische dubbelcheck"), "dier: gezond + wond = onzeker");
  await dier({ ...ANIMAL, gezond: true, gezondheidsopmerking: "Ziet er alert uit", klasse: "Zoogdier" });
  ok(hasText("lijkt gezond") && hasText("De dierengroep (Zoogdier) is een bekende groep"), "dier: consistent");
  await dier({ ...ANIMAL, klasse: "wezen" });
  ok(hasText("dierengroep kon niet gecontroleerd worden"), "onbekende groep: eerlijk gemeld");
});

test("J6 diagnose-logboek en export", "scan", async () => {
  const { T } = fresh();
  for (let i = 0; i < 250; i++) T.logDiag({ type: "plant", naam: "n" + i });
  const l = T.loadDiag();
  ok(l.length === 200 && l[0].naam === "n249", "logboek bewaart de laatste 200, nieuwste eerst");
  ok(l[0].v === "ontwikkel · v10.5" && typeof l[0].t === "string", "elk item heeft versie en tijd");
  const r = fresh(); setKeys({ gemini: "GEHEIM-SLEUTEL-123" }); mount(r.App);
  global.__net.handler = () => gemOk(PLANT);
  uploadFile(0); await waitText("Madeliefje"); click("Terug");
  global.__net.handler = () => ({ status: 429, text: "RESOURCE_EXHAUSTED PerDay" });
  uploadFile(0); await waitText("voor vandaag genoeg gewerkt");
  global.__net.handler = () => gemOk({ ...ANIMAL });
  uploadFile(1); await waitText("Rode vos"); click("Terug");
  const log = r.T.loadDiag();
  eq(log.length, 3, "3 scans gelogd (twee gelukt, één mislukt)");
  const fout = log.find((x) => x.fout), ok1 = log.find((x) => x.naam === "Madeliefje");
  ok(fout && fout.type === "plant" && /429|PerDay/.test(fout.fout), "mislukte scan: fout bewaard");
  ok(ok1 && ok1.type === "plant" && ok1.bron === "Gemini AI" && Array.isArray(ok1.letop) && typeof ok1.ok === "number" && ok1.info >= 1, "geslaagde scan: bron en uitkomst van de dubbelcheck");
  ok(!JSON.stringify(log).includes("data:image") && !JSON.stringify(log).includes("GEHEIM-SLEUTEL-123"), "logboek bevat geen foto's en geen sleutels");
  // export via instellingen
  click("Instellingen");
  if (btn("Ontgrendel")) { fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: "1234" } }); click("Ontgrendel"); }
  await waitText("🩺 Diagnose");
  ok(hasText("Logboek: 3 scans"), "teller toont 3 scans");
  click("Diagnose-export opslaan");
  eq(global.__downloads.length, 1, "download gestart");
  ok(/^natuurscanner-diagnose-\d{4}-\d{2}-\d{2}\.json$/.test(global.__downloads[0].download), "bestandsnaam: " + global.__downloads[0].download);
  const tekst = await new Promise((res) => { const fr = new window.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(global.__lastBlob); });
  const d = JSON.parse(tekst);
  ok(d.app === "NatuurScanner" && d.soort === "diagnose-export" && d.versie === "ontwikkel · v10.5" && Array.isArray(d.logboek) && d.logboek.length === 3 && d.statistieken, "export bevat app, versie, logboek en statistieken");
  ok(!tekst.includes("data:image") && !tekst.includes("GEHEIM-SLEUTEL-123"), "export bevat geen foto's en geen sleutels");
  ok(hasText("Diagnose-export gemaakt (3 scans"), "bevestiging getoond");
  click("Logboek wissen"); ok(hasText("Logboek: 0 scans") && hasText("Logboek gewist"), "logboek wissen werkt");
  eq(r.T.loadDiag().length, 0, "echt leeg");
});

test("J7 oude of kapotte scans zonder dubbelcheck + voorlezen", "scan", async () => {
  const { T } = fresh();
  const r = fresh();
  const img = "data:image/png;base64,AAAA";
  localStorage.setItem("plantscanner_history", JSON.stringify([
    { id: 5, name: "OudePlant", type: "plant", image: img, date: "x", giftigheid: null },
    { id: 4, name: "Kapot", type: "plant", image: img, date: "x", controles: "kapot" },
    { id: 3, name: "Kapot2", type: "animal", image: img, date: "x", controles: [null, 5, { status: "ok" }, { status: "raar", tekst: { a: 1 } }] },
  ]));
  mount(r.App);
  for (const n of ["OudePlant", "Kapot"]) { click("Geschiedenis"); fireEvent.click(document.querySelector(`img[alt='${n}']`).parentElement); ok(hasText("← Terug") && !hasText("Automatische dubbelcheck"), `${n}: opent zonder dubbelcheckkaart`); click("Terug"); }
  click("Geschiedenis"); fireEvent.click(document.querySelector("img[alt='Kapot2']").parentElement);
  ok(hasText("← Terug") && hasText("Automatische dubbelcheck: 0 van 1 in orde") && !hasText("Oeps, er ging iets mis"), "kapotte controlelijst wordt opgeschoond: alleen bruikbare items, geen crash"); click("Terug");
  const tekst = T.resultText({ type: "plant", name: "Lelie", giftigheid: null, controles: [{ id: "giftigheid", status: "let-op", tekst: "Lelie staat op de lijst" }, { id: "bronnen", status: "ok", tekst: "ok" }] });
  ok(tekst.includes("Let op bij de dubbelcheck: Lelie staat op de lijst") && !tekst.includes("Let op bij de dubbelcheck: ok"), "voorlezen noemt enkel de 'let op'-controles");
  ok(!T.resultText({ type: "plant", name: "Roos", giftigheid: null }).includes("dubbelcheck"), "zonder controles geen dubbelcheck in de voorleestekst");
});

// =====================================================================================
// M. AAPJESTEST: een willekeurige gebruiker (herhaalbaar via zaad)
// =====================================================================================
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const crashes = [];
window.addEventListener("error", (e) => crashes.push("window.error: " + (e.message || e.error)));
process.on("unhandledRejection", (r) => crashes.push("unhandledRejection: " + (r && r.message ? r.message : r) + (process.env.DEBUG && r && r.stack ? " || " + String(r.stack).split("\n").slice(1, 5).join(" | ") : "")));
const MONKEY_STEPS = Number(process.env.STEPS || 220);
const SEEDS = (process.env.SEEDS || "1,2,3,4,5,6").split(",").map(Number);
for (const seed of SEEDS) {
  test(`M${seed} aapjestest (zaad ${seed}, ${MONKEY_STEPS} stappen)`, "scan", async () => {
    crashes.length = 0;
    const sleutelVoor = sleutelFouten();
    const trace = [];
    const rng = mulberry32(seed), origRandom = Math.random;
    Math.random = rng;
    const r = fresh();
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    setKeys({ gemini: "K", ...(rng() < 0.4 ? { plantNet: "N" } : {}) });
    if (rng() < 0.5) localStorage.setItem("plantscanner_kids_mode", "1");
    if (rng() < 0.4) localStorage.setItem("natuurscanner_voorlezen", "1");
    if (rng() < 0.5) {
      const h = []; for (let i = 0; i < 5; i++) h.push(seedEntry({ id: 9000 - i, name: pick(["Lavendel", "Rode vos", "Merel", "Eik", "Vliegenzwam"]) + (i % 2 ? "" : " "), type: i % 2 ? "animal" : "plant", klasse: "Vogels", giftigheid: i % 2 ? undefined : { mens: "licht", dier: "sterk", delen: "blad", symptomen: "x", omgang: "y" } }));
      localStorage.setItem("plantscanner_history", JSON.stringify(h));
    }
    global.__net.handler = async (u, o) => {
      const body_ = String((o && o.body) || "");
      if (u.includes("plantnet")) return rng() < 0.5 ? { status: 200, json: { results: [{ species: { scientificNameWithoutAuthor: "Bellis perennis" }, score: rng() }] } } : { status: 500, text: "boom" };
      const x = rng();
      if (x < 0.55) {
        if (/Identificeer dit dier/.test(body_)) return gemOk({ ...ANIMAL, gezond: rng() < 0.5, klasse: pick(["Zoogdier", "Vogels", "Reptiel", "onbekend", ""]) });
        if (/Safari scheidsrechter/.test(body_)) return gemOk({ gevonden: rng() < 0.5, uitleg: "Goed!" });
        const raar = rng() < 0.25;
        return gemOk({ ...PLANT, name: pick(["Madeliefje", "Vliegenzwam", "Eik", "Roos", "Reuzenberenklauw", "Eikenprocessierups", "Japanse duizendknoop"]), gezond: rng() < 0.5, giftig: rng() < 0.3 ? undefined : (raar ? pick(["ja", 5, [], { mens: {} }, null]) : PLANT.giftig), ...(raar ? { light: { a: "Zon" }, tip: ["x", "y"], freq: 3, amount: null, soil: {} } : {}) });
      }
      if (x < 0.65) return { status: 429, text: "RESOURCE_EXHAUSTED PerDay" };
      if (x < 0.75) return { status: 503, text: "overloaded" };
      if (x < 0.83) return { throw: new TypeError("Failed to fetch") };
      if (x < 0.91) return { status: 200, json: { candidates: [{ content: { parts: [{ text: "dit is geen json {{" }] } }] } };
      if (x < 0.96) return { status: 200, json: { candidates: [] } };
      return gemOk({});
    };
    global.__cam.mode = rng() < 0.2 ? "denied" : "ok";
    if (rng() < 0.3) global.__imageCapture.enabled = false;
    if (rng() < 0.3) global.__cam.caps = {};
    mount(r.App);
    const gezien = new Set();
    let lastClick = "";
    const markers = ["Vraag ", "Mijn Album", "Back-up", "Safari", "Instellingen", "Geschiedenis", "GEFELICITEERD", "Camera niet beschikbaar", "Giftigheid", "Gezondheidscheck", "Mijn Scans Quiz", "Wist je dat", "Niet opeten"];
    for (let step = 0; step < MONKEY_STEPS; step++) {
      const beforeCrash = crashes.length;
      try {
        const x = rng();
        if (x < 0.07) {
          const inputs = [...document.querySelectorAll('input[type="file"]')];
          if (inputs.length) {
            const inp = pick(inputs);
            const isBackup = /json/.test(inp.getAttribute("accept") || "");
            let content = "x", name = "foto.png", type = "image/png";
            if (isBackup) {
              name = "b.json"; type = "application/json";
              const kies = rng();
              content = kies < 0.4 ? makeBackupText() : kies < 0.6 ? "geen json" : kies < 0.8 ? JSON.stringify({ app: "NatuurScanner", scans: [{ id: 1, name: "Test", type: "plant", image: "data:image/png;base64,AA", giftigheid: "kapot", health: 5 }, { id: 1, name: "Dubbel", type: "plant", image: "data:image/png;base64,AA" }] }) : "[]";
            }
            trace.push("upload:" + (isBackup ? "back-up " + content.slice(0, 18) : "foto")); fireEvent.change(inp, { target: { files: [new File([content], name, { type })] } });
          }
        } else if (x < 0.12) {
          const ins = [...document.querySelectorAll("input:not([type=file])")];
          if (ins.length) { const inp = pick(ins); fireEvent.change(inp, { target: { value: pick(["", "1234", "112233", "abc", "x".repeat(50), "6"]) } }); }
        } else {
          const knoppen = screen.queryAllByRole("button");
          if (knoppen.length) { const kb = pick(knoppen); lastClick = kb.textContent.trim().slice(0, 30); trace.push("klik:" + lastClick); fireEvent.click(kb); }
        }
      } catch (e) { crashes.push(`stap ${step}: ${e.message.split("\n")[0]}`); }
      await new Promise((res) => setTimeout(res, Math.floor(rng() * 25)));
      if (hasText("Oeps, er ging iets mis")) crashes.push(`stap ${step}: foutscherm verscheen na klik op "${lastClick}"; laatste acties: ${trace.slice(-9).join(" > ")}`);
      const zichtbaar = (() => { const c = document.body.cloneNode(true); c.querySelectorAll("style,script").forEach((n) => n.remove()); return c.textContent.replace(/\s/g, "").length; })();
      if (zichtbaar < 3 && screen.queryAllByRole("button").length === 0 && !document.querySelector("video")) crashes.push(`stap ${step}: leeg scherm (witte pagina) na klik op "${lastClick}", inhoud: ${JSON.stringify(body().slice(0, 80))}, video:${!!document.querySelector("video")}; laatste acties: ${trace.slice(-9).join(" > ")}`);
      for (const m of markers) if (hasText(m)) gezien.add(m);
      if (crashes.length > beforeCrash) { console.log("   (zaad " + seed + ", stap " + step + ") " + crashes.slice(beforeCrash).join(" | ")); break; }
    }
    Math.random = origRandom;
    ok(crashes.length === 0, `geen crash, geen wit scherm: ${crashes.slice(0, 3).join(" | ")}`);
    eq(sleutelFouten() - sleutelVoor, 0, "geen React key-/state-waarschuwingen tijdens de aapjestest");
    console.log(`   (zaad ${seed}: schermen/onderdelen gezien: ${[...gezien].join(", ")})`);
  });
}
function makeBackupText() { try { return localStorage.getItem("plantscanner_history") ? JSON.stringify({ app: "NatuurScanner", versie: 1, scans: JSON.parse(localStorage.getItem("plantscanner_history")) }) : "[]"; } catch (e) { return "[]"; } }

// =====================================================================================
(async () => {
  console.log(`Bestand: ${path.relative(process.cwd(), APP_PATH)}  (${src.length} tekens)\n`);
  let scanPass = 0, scanTotal = 0, ctrlPass = 0, ctrlTotal = 0;
  for (const t of tests) {
    if (process.env.ONLY && !new RegExp(process.env.ONLY).test(t.name)) continue;
    const before = failed.length, c0 = checks;
    const boundaryTeller = () => [...consoleErrors.entries()].filter(([m]) => /NatuurScanner fout|The above error occurred/.test(m)).reduce((a, [, n]) => a + n, 0);
    const b0 = boundaryTeller();
    let err = null;
    try { await t.fn(); } catch (e) { err = e; }
    if (!err && !/^G4/.test(t.name) && (boundaryTeller() > b0 || hasText("Oeps, er ging iets mis"))) { failed.push(`${t.name}: het foutscherm (ErrorBoundary) sloeg toe: een onderdeel van de app crashte`); console.log("   ✗ " + failed[failed.length - 1]); }
    const good = !err && failed.length === before;
    if (err && process.env.DEBUG) console.log("   STACK:", String(err.stack).split("\n").slice(0, 8).join(" | ").slice(0, 900));
    if (err && process.env.DEBUG) { console.log("   DOM:", body().slice(0, 500)); console.log("   GESPROKEN:", speech.spoken.length, JSON.stringify(speech.spoken.map((u) => u.text.slice(0, 40)).slice(0, 40))); }
    if (err) { failed.push(`${t.name}: UITZONDERING ${err.message.split("\n")[0]}`); console.log("   ✗ " + failed[failed.length - 1]); }
    if (t.kind === "scan") { scanTotal++; if (good) scanPass++; } else { ctrlTotal++; if (good) ctrlPass++; }
    console.log(`${good ? "✔" : "✘"} ${t.name}  (${checks - c0} controles)`);
    cleanup();
  }
  console.log(`\nControles: ${checks} uitgevoerd, ${failed.length} mislukt`);
  console.log(`Testgroepen: ${ctrlPass}/${ctrlTotal} (controle) · ${scanPass}/${scanTotal} (scan/flow)`);
  if (consoleErrors.size) {
    console.log("\nConsole-meldingen tijdens de tests (uniek):");
    for (const [m, n] of consoleErrors) console.log(`  ${n}x ${m}`);
  }
  if (failed.length) { console.log("\nMISLUKT:"); failed.forEach((f) => console.log(" - " + f)); }
  process.exit(failed.length ? 1 : 0);
})();
