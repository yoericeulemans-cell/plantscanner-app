import React, { useState, useEffect, useRef } from "react";

/* ============ BEVEILIGING: nooit echte sleutels hier hardcoden! ============
   Vul GEEN echte API-sleutels in op deze plek. Sleutels horen alleen in
   localStorage terecht te komen via het Instellingenscherm in de app zelf.
   Als je dit bestand deelt (met een AI, op GitHub, via een sandbox-link),
   staan hardcoded sleutels hier gewoon leesbaar voor iedereen. */
const FALLBACK_KEYS = {
  plantId: "",
  plantNet: "",
  gemini: "",
  firebaseUrl: "",
};

/* Ontwikkelaars-noodcode: werkt ALTIJD om Instellingen te openen, ook als de
   PIN hieronder gewijzigd of vergeten is. Verander deze gerust naar iets dat
   alleen jij kent — het hoeft niet hetzelfde te zijn als de PIN die je in de
   app zelf instelt. */
const DEVELOPER_OVERRIDE_PIN = "112233";

/* ============ STORAGE HELPERS ============ */
const LS_KEYS = {
  plantIdKey: "plantscanner_plantid_key",
  plantNetKey: "plantscanner_plantnet_key",
  geminiKey: "plantscanner_gemini_key",
  history: "plantscanner_history",
  kidsMode: "plantscanner_kids_mode",
  customMissions: "plantscanner_custom_missions_v3",
  apiUsage: "plantscanner_api_usage",
  firebaseKey: "plantscanner_firebase_url",
  teacherPin: "plantscanner_teacher_pin",
};

function loadKeys() {
  let custom = [];
  try {
    const stored = localStorage.getItem(LS_KEYS.customMissions);
    if (stored) custom = JSON.parse(stored);
  } catch (e) {}

  return {
    plantId: localStorage.getItem(LS_KEYS.plantIdKey) || FALLBACK_KEYS.plantId,
    plantNet: localStorage.getItem(LS_KEYS.plantNetKey) || FALLBACK_KEYS.plantNet,
    gemini: localStorage.getItem(LS_KEYS.geminiKey) || FALLBACK_KEYS.gemini,
    firebaseUrl: localStorage.getItem(LS_KEYS.firebaseKey) || FALLBACK_KEYS.firebaseUrl,
    customMissions: Array.isArray(custom) ? custom : [],
    teacherPin: localStorage.getItem(LS_KEYS.teacherPin) || "1234",
  };
}

function saveKeys(keysObj) {
  localStorage.setItem(LS_KEYS.plantIdKey, keysObj.plantId || "");
  localStorage.setItem(LS_KEYS.plantNetKey, keysObj.plantNet || "");
  localStorage.setItem(LS_KEYS.geminiKey, keysObj.gemini || "");
  localStorage.setItem(LS_KEYS.firebaseKey, keysObj.firebaseUrl || "");
  localStorage.setItem(LS_KEYS.teacherPin, keysObj.teacherPin || "1234");
  localStorage.setItem(
    LS_KEYS.customMissions,
    JSON.stringify(keysObj.customMissions || [])
  );
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEYS.history)) || [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  let wList = list;
  for (let i = 0; i < 10; i++) {
    try {
      localStorage.setItem(LS_KEYS.history, JSON.stringify(wList));
      return wList;
    } catch (e) {
      wList = wList.slice(0, -1);
    }
  }
  return wList;
}

/* Verkleint een foto (dataURL) vóór verzending naar de API's. Foto's uit de
   camera of galerij zijn vaak 3000-4000px breed (meerdere MB's) — dat kost
   veel tijd om te versturen over mobiel internet. Terugbrengen naar max.
   1280px lange zijde scheelt merkbaar in scansnelheid, zonder dat de
   herkenning/analyse er merkbaar minder nauwkeurig van wordt. */
const MAX_IMAGE_DIMENSION = 1280;
const IMAGE_QUALITY = 0.85;

function resizeDataUrl(dataUrl, maxDim = MAX_IMAGE_DIMENSION, quality = IMAGE_QUALITY) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Kon de foto niet verwerken voor verkleining."));
    img.src = dataUrl;
  });
}

/* Voert een fetch uit met een maximale wachttijd. Zonder dit kan één trage of
   hangende aanvraag (bv. een wankele mobiele verbinding of een "koude start"
   van de Cloudflare Worker) de hele scan minutenlang laten hangen. Na
   timeoutMs breekt de aanvraag zelf af, zodat we snel weten dat die bron niet
   op tijd antwoordde in plaats van er eindeloos op te wachten. */
function fetchWithTimeout(url, options = {}, timeoutMs = 13000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/* Zet een technische foutmelding om naar een korte, geruststellende boodschap
   voor kinderen. De volledige, technische tekst gaat nergens verloren — die
   blijft gewoon beschikbaar achter het "Technische details"-knopje in de
   foutmelding zelf, voor wie (bv. de leerkracht) toch de exacte oorzaak wil
   zien. Dit raakt alleen hoe de bestaande foutmelding getoond wordt, niet de
   logica die de fouten zelf veroorzaakt of opvangt. */
function friendlyErrorMessage(raw) {
  if (!raw) return "";
  const text = raw.toLowerCase();
  if (text.includes("sleutel ontbreekt") || text.includes("geen gemini") || text.includes("api sleutel ingesteld") || text.includes("api-sleutel ingesteld")) {
    return "🔑 Er ontbreekt een instelling. Vraag een volwassene om dit in ⚙️ Instellingen te bekijken.";
  }
  if (text.includes("429") || text.includes("rate_limit") || text.includes("503") || text.includes("druk") || text.includes("high demand") || text.includes("antwoordde niet binnen")) {
    return "😴 De scanner is even moe, probeer over een paar minuutjes opnieuw!";
  }
  if (text.includes("niet bereikbaar") || text.includes("failed to fetch") || text.includes("networkerror")) {
    return "📶 Geen internetverbinding gevonden, check de wifi.";
  }
  if (text.includes("niet herkend") || text.includes("geen plant gevonden") || text.includes("geen dier")) {
    return "🔍 Hmm, ik zie hier geen plant of dier op! Probeer een andere foto.";
  }
  return "😕 Er ging iets mis. Probeer het nog eens!";
}

const logApiCall = (firebaseUrl) => {
  const now = Date.now();
  try {
    let usage = JSON.parse(localStorage.getItem(LS_KEYS.apiUsage) || "[]");
    usage.push(now);
    usage = usage.filter((t) => now - t < 60000);
    localStorage.setItem(LS_KEYS.apiUsage, JSON.stringify(usage));
  } catch (e) {}

  if (firebaseUrl && firebaseUrl.trim() !== "") {
    try {
      const baseUrl = firebaseUrl.replace(/\/$/, "");
      fetch(`${baseUrl}/scans.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestamp: now }),
      });
    } catch (e) {}
  }
};

const SAFARI_MISSIES = {
  bos: [
    "🌳 Vind een oude boom met een heel dikke stam",
    "🍂 Zoek een mooi gekleurd herfstblad of uniek blad",
    "🐜 Zoek een kriebelbeestje of insect op de grond",
    "🌲 Zoek een dennenappel, eikel of beukennootje",
    "🌿 Vind een zacht kussentje van groen mos",
    "🕸️ Vind een kunstig gespinnen spinnenweb",
    "🪵 Zoek een omgevallen boom waar nieuwe planten op groeien",
    "🍄 Spot een wilde paddenstoel of zwam",
    "🐾 Vind een dierenspoor of pootafdruk",
    "🪶 Zoek een mooie vogelveer",
    "🦉 Luister of je een vogel kan horen zingen",
    "🌰 Zoek een boom met opvallend geribbelde schors",
    "🍁 Vind een blad met een bijzondere of grillige vorm",
    "🐿️ Zoek sporen van een eekhoorn, zoals een geknaagde dennenappel",
    "🌤️ Zoek een open plek in het bos waar veel zonlicht doorkomt",
    "🐸 Zoek een kikker, pad of ander amfibie bij een poel",
    "🕳️ Vind een holletje of gangetje van een dier in de grond",
    "🍂 Zoek drie verschillende soorten bladeren op de bosbodem",
    "🌧️ Vind een blad met een regendruppel erop",
    "🦔 Zoek sporen van een egel, zoals een schuilplaatsje onder bladeren",
    "🦌 Zoek sporen van een ree of ander groot dier (afdruk of vraatsporen)",
    "🪺 Zoek een vogelnest in een boom of struik (kijk van op een afstand!)",
    "🌱 Vind een heel jong boompje dat net uit de grond komt",
    "🐞 Spot een lieveheersbeestje of een kever",
    "🌳 Vind een boom waar jij en een vriend samen nauwelijks omheen kunnen",
    "🌲 Zoek een naaldboom en een loofboom naast elkaar",
    "🍃 Vind dode bladeren die aan het vergaan zijn tot nieuwe aarde",
    "🌈 Zoek vijf verschillende kleuren in de natuur om je heen",
    "🐛 Zoek een rups of larve op een blad",
    "🌿 Zoek een varen",
  ],
  park: [
    "🌳 Vind een grote schaduwrijke boom om onder te zitten",
    "🦆 Zoek eendjes of een andere watervogel in de vijver van het park",
    "🐿️ Zoek een eekhoorn die tussen de bomen springt",
    "🌸 Vind een bloeiende struik of boom",
    "🍃 Vind drie verschillende soorten bladeren op het gras",
    "🧺 Zoek een fijn picknickplekje in de schaduw",
    "🐦 Luister naar vogelgezang en probeer de vogel ook te zien",
    "🦋 Zoek een vlinder die tussen de bloemen fladdert",
    "🐝 Spot een bij op een bloem in het park",
    "🌾 Vind een pluk gras dat langer is dan de rest",
    "🪑 Zoek een bankje waar je even kan rusten",
    "🐌 Zoek een slak op een blad of steen",
    "🐕 Tel hoeveel honden je op je wandeling tegenkomt",
    "🌼 Zoek de kleinste bloem die je kan vinden",
    "🍂 Vind een blad dat al helemaal droog en bruin is",
    "🦢 Zoek een zwaan of gans bij het water",
    "🐦 Spot een duif, mus of merel en kijk wat hij doet",
    "🌻 Zoek een gele en een paarse bloem",
    "🐜 Volg een mier en kijk waar ze naartoe gaat",
    "🕊️ Zoek een veer van een vogel in het gras",
    "🍀 Zoek een klavertje of een heel klein plantje tussen het gras",
    "🦗 Zoek een sprinkhaan of ander klein beestje in het gras",
    "🪨 Zoek een steen met een mooie kleur of vorm",
    "🌿 Zoek een plant met haartjes of stekels op het blad",
    "🐟 Zoek vissen of kikkervisjes in het water van de vijver",
  ],
  dierentuin: [
    "🦁 Zoek een dier met een dikke, opvallende vacht",
    "🦒 Vind het dier met de langste nek",
    "🐒 Zoek een dier dat aan het klimmen of springen is",
    "🦓 Vind een dier met strepen of vlekken op zijn vacht",
    "🐘 Zoek het grootste dier dat je kan vinden",
    "🦜 Vind een vogel met opvallende, felle kleuren",
    "🐢 Zoek een dier dat heel traag beweegt",
    "🦈 Vind een dier dat in het water leeft of zwemt",
    "🦉 Zoek een dier dat normaal vooral 's nachts actief is",
    "🐍 Vind een dier zonder poten",
    "🦥 Zoek een dier dat aan het slapen of rusten is",
    "🦩 Vind een dier met een opvallende kleur zoals roze of felgeel",
    "🐧 Zoek een dier dat niet kan vliegen maar wel goed kan zwemmen",
    "🐅 Vind een dier met scherpe klauwen of tanden",
    "🦎 Zoek een dier met schubben",
    "🦘 Zoek een dier dat springt of hupt",
    "🐻 Vind een beer of een ander groot roofdier",
    "🦏 Zoek een dier met een hoorn",
    "🐊 Zoek een reptiel of een amfibie",
    "🐠 Zoek een vis met felle kleuren",
    "🦅 Vind een roofvogel",
    "🐃 Zoek een dier dat in een groep of kudde leeft",
    "🦧 Vind een aap en kijk wat hij doet",
    "🐪 Zoek een dier dat goed tegen droogte of hitte kan",
    "🐼 Zoek een dier dat vooral planten eet",
    "🦦 Zoek een dier met zwemvliezen of een platte staart",
    "🐾 Vind het kleinste dier dat je in de dierentuin ziet",
  ],
};

// Kiest een willekeurige missie-index die verschilt van de vorige, zodat dezelfde missie niet
// twee keer na elkaar verschijnt (bij lijsten van 1 item is er uiteraard geen keuze).
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function loadSeen(key) {
  try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function saveSeen(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list.slice(-400))); } catch (e) {}
}
const QUIZ_SEEN_KEY = "natuurscanner_seen_quiz";
// Antwoordopties door elkaar husselen (juiste antwoord blijft correct), behalve bij opties als "geen van beide".
function shuffleOptions(q) {
  if (q.opts.some((o) => /bovenstaande|beide|alle drie|geen van/i.test(o))) return q;
  const order = shuffleArray(q.opts.map((_, i) => i));
  return { ...q, opts: order.map((i) => q.opts[i]), correct: order.indexOf(q.correct) };
}
// Kiest een missie die nog NIET getoond is (ook niet in vorige sessies). Pas als alle missies
// van een gebied geweest zijn, begint de cyclus opnieuw. Nooit twee keer dezelfde na elkaar.
function pickNextMissionIndex(list, excludeIndex, omgeving) {
  const n = (list || []).length;
  if (n <= 1) return 0;
  const key = "natuurscanner_seen_missies_" + omgeving;
  let seen = loadSeen(key).filter((t) => list.includes(t));
  let cand = list.map((_, i) => i).filter((i) => i !== excludeIndex && !seen.includes(list[i]));
  if (cand.length === 0) {
    seen = excludeIndex >= 0 && list[excludeIndex] ? [list[excludeIndex]] : [];
    cand = list.map((_, i) => i).filter((i) => i !== excludeIndex);
  }
  const next = cand[Math.floor(Math.random() * cand.length)];
  saveSeen(key, [...seen, list[next]]);
  return next;
}

// Geeft de juiste missielijst terug voor een omgeving, inclusief de speciale
// "leerkracht"-categorie (de missies die de leerkracht zelf heeft toegevoegd).
function getMissieList(omgeving, customMissions) {
  if (omgeving === "leerkracht") return customMissions || [];
  return SAFARI_MISSIES[omgeving] || [];
}

/* ============ VOORLEZEN (spraaksynthese van de browser, geen extra kosten of sleutels) ============ */
let SPEECH_RATE = 0.9; // 0.9 = normaal, 0.7 = langzaam (voor kinderen die nog leren lezen)
const SPEECH_OK = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
function cleanForSpeech(t) {
  return String(t || "").replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ").replace(/\s+/g, " ").trim();
}
let SPEECH_PITCH = 0.8; // lagere toon = dieper
let SPEECH_VOICE_NAME = (() => { try { return localStorage.getItem("natuurscanner_stem") || ""; } catch (e) { return ""; } })();
// Geeft elke Nederlandse stem een score: liefst mannelijk en natuurlijk (neural/online/network), geen robotstem.
function voiceScore(v) {
  const n = (v.name || "") + " " + (v.voiceURI || "");
  const lang = (v.lang || "").replace("_", "-").toLowerCase();
  if (!lang.startsWith("nl")) return -999;
  let sc = lang === "nl-be" ? 1 : 0;
  if (/maarten|xander|arnaud|\bmale\b|\bman\b|ruben|pieter|bart|jan\b/i.test(n)) sc += 10;
  if (/ellen|claire|colette|fenna|femke|\bfemale\b|vrouw|laura|eline/i.test(n)) sc -= 10;
  if (/natural|neural|online|network|premium|enhanced|wavenet/i.test(n)) sc += 4;
  if (/compact|espeak|robot/i.test(n)) sc -= 4;
  return sc;
}
function nlVoices() {
  try {
    return (window.speechSynthesis.getVoices() || []).filter((v) => voiceScore(v) > -900).sort((a, b) => voiceScore(b) - voiceScore(a) || String(a.name).localeCompare(String(b.name)));
  } catch (e) { return []; }
}
function pickVoice() {
  const list = nlVoices();
  return list.find((v) => v.name === SPEECH_VOICE_NAME) || list[0] || null;
}
function speak(text) {
  if (!SPEECH_OK) return;
  const t = cleanForSpeech(text);
  if (!t) return;
  try {
    const synth = window.speechSynthesis;
    const busy = synth.speaking || synth.pending;
    synth.cancel();
    const go = () => {
      try {
        const v = pickVoice();
        // Zin per zin voorlezen: lange teksten blijven dan niet halverwege hangen.
        (t.match(/[^.!?]+[.!?]*/g) || [t]).forEach((part) => {
          const p = part.trim();
          if (!p) return;
          const u = new SpeechSynthesisUtterance(p);
          if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "nl-BE"; }
          u.rate = SPEECH_RATE;
          u.pitch = SPEECH_PITCH;
          synth.speak(u);
        });
      } catch (e) {}
    };
    if (busy) setTimeout(go, 60); else go();
  } catch (e) {}
}
function stopSpeaking() {
  try { if (SPEECH_OK) window.speechSynthesis.cancel(); } catch (e) {}
}
function VoorleesKnop({ text, label }) {
  if (!SPEECH_OK) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); speak(text); }}
      aria-label="Lees voor"
      style={{ background: "rgba(255,255,255,0.18)", border: "none", borderRadius: 14, padding: "8px 14px", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 12 }}
    >
      🔊 {label || ""}
    </button>
  );
}
const LETTERS = ["A", "B", "C", "D", "E"];
function quizText(q) {
  return q ? `${q.q} ${q.opts.map((o, i) => `Antwoord ${LETTERS[i]}: ${o}.`).join(" ")}` : "";
}
function resultText(r) {
  if (!r) return "";
  const p = [`${r.name}.`];
  if (r.type === "animal") {
    if (r.klasse) p.push(`Klasse: ${r.klasse}.`);
    if (r.leefgebied) p.push(`Leefgebied: ${r.leefgebied}.`);
    if (r.leeftijd) p.push(`Geschatte leeftijd: ${r.leeftijd}.`);
    if (r.weetje) p.push(`Leuk weetje: ${r.weetje}`);
    if (typeof r.gezond !== "undefined") {
      p.push(r.gezond === false ? `Gezondheidscheck: let op. ${r.gezondheidsopmerking || "Er lijkt iets niet in orde te zijn."}` : `Gezondheidscheck: lijkt gezond. ${r.gezondheidsopmerking || ""}`);
    }
    if (r.verzorgingstip) p.push(`Verzorging en omgang: ${r.verzorgingstip}`);
  } else {
    if (r.light) p.push(`Zonlicht: ${r.light}.`);
    if (r.soil) p.push(`Bodem: ${r.soil}.`);
    const h = r.health;
    if (h && h.isHealthy === false) {
      p.push("Gezondheidscheck: let op.");
      if (h.diseaseName) p.push(`Probleem: ${h.diseaseName}.`);
      if (h.note) p.push(`Oorzaak: ${h.note}`);
      if (h.solution) p.push(`Oplossing: ${h.solution}`);
    } else {
      p.push("Gezondheidscheck: deze plant lijkt gezond. Geen ziektes of problemen gevonden op de foto.");
    }
    p.push(giftTekst(r.giftigheid, !!r.__kids));
    if (r.freq) p.push(`Water: ${r.freq}.`);
    if (r.amount) p.push(r.amount);
    if (r.tip) p.push(`Tip: ${r.tip}`);
  }
  return p.join(" ");
}


/* ============ GIFTIGHEID (planten) ============ */
const GIFT_RANK = { onbekend: 0, niet: 1, licht: 2, matig: 3, sterk: 4 };
const GIFT_LABEL = { niet: ["✅", "Niet giftig", "#2ecc71"], licht: ["🟡", "Licht giftig", "#f1c40f"], matig: ["🟠", "Giftig", "#e67e22"], sterk: ["🔴", "Zeer giftig", "#e74c3c"], onbekend: ["❓", "Onbekend", "#95a5a6"] };
// Vaste, veilige basisraad (komt NIET van de AI): wat te doen na contact met een mogelijk giftige plant.
const GIFT_NA_CONTACT = [
  "Huid: wassen met water en zeep.",
  "Ogen: minstens 15 minuten spoelen met lauw water.",
  "Mond of ingeslikt: spoel de mond met water en laat niet braken.",
  "Bel het Antigifcentrum: 070 245 245 (dag en nacht) en volg het advies. Bij ernstige klachten of bewusteloosheid: bel 112.",
  "Huisdier: bel meteen de dierenarts en neem een stukje van de plant mee.",
];
function normGift(g) {
  if (!g || typeof g !== "object") return null;
  const lv = (x) => { const v = String(x || "").toLowerCase().trim(); return GIFT_RANK[v] !== undefined ? v : "onbekend"; };
  return { mens: lv(g.mens), dier: lv(g.dier), delen: String(g.delen || "").slice(0, 200), symptomen: String(g.symptomen || "").slice(0, 300), omgang: String(g.omgang || "").slice(0, 300) };
}
function giftInfo(g) {
  const gg = g || { mens: "onbekend", dier: "onbekend", delen: "", symptomen: "", omgang: "" };
  const gevaar = GIFT_RANK[gg.mens] >= 2 || GIFT_RANK[gg.dier] >= 2;
  const onbekend = gg.mens === "onbekend" || gg.dier === "onbekend";
  const top = GIFT_RANK[gg.mens] >= GIFT_RANK[gg.dier] ? gg.mens : gg.dier;
  const kleur = gevaar ? GIFT_LABEL[top][2] : onbekend ? GIFT_LABEL.onbekend[2] : GIFT_LABEL.niet[2];
  return { gg, gevaar, onbekend, kleur };
}
function giftTekst(g, kids) {
  const { gg, gevaar, onbekend } = giftInfo(g);
  const p = [`Giftigheid. Voor mensen: ${GIFT_LABEL[gg.mens][1]}. Voor huisdieren, zoals katten en honden: ${GIFT_LABEL[gg.dier][1]}.`];
  if (gg.delen) p.push(`Giftige delen: ${gg.delen}.`);
  if (gevaar) {
    if (gg.symptomen) p.push(`Mogelijke klachten: ${gg.symptomen}.`);
    if (gg.omgang) p.push(`Zo ga je ermee om: ${gg.omgang}.`);
    p.push("Na contact: " + GIFT_NA_CONTACT.join(" "));
  } else if (onbekend) {
    p.push("Raak de plant niet aan zonder te vragen en eet er nooit van. " + GIFT_NA_CONTACT.join(" "));
  } else {
    p.push("Veilig om aan te raken, maar eet nooit zomaar van een plant. Toch last gehad? Bel het Antigifcentrum: 070 245 245.");
  }
  if (kids) p.push("Vraag altijd aan een volwassene voor je iets van een plant aanraakt of in je mond steekt.");
  p.push("Dit is een inschatting op basis van een foto en niet 100 procent zeker.");
  return p.join(" ");
}
function GiftigKaart({ g, kids, cardStyle }) {
  const { gg, gevaar, onbekend, kleur } = giftInfo(g);
  const rij = (icoon, naam, lvl) => (<div style={{ marginTop: 4 }}><strong>{icoon} {naam}:</strong> {GIFT_LABEL[lvl][0]} {GIFT_LABEL[lvl][1]}</div>);
  return (
    <div style={{ ...cardStyle, borderLeft: `6px solid ${kleur}` }}>
      <div style={{ fontWeight: 800, marginBottom: 10, color: "#a8e6cf", fontSize: 18 }}>{kids ? "⚠️ Is deze plant giftig?" : "⚠️ Giftigheid"}</div>
      <div style={{ fontSize: 15, lineHeight: "1.6" }}>
        {rij("👤", "Mensen", gg.mens)}
        {rij("🐾", "Huisdieren (kat/hond)", gg.dier)}
        {gg.delen && <div style={{ marginTop: 8 }}><strong>🌿 Giftige delen:</strong> {gg.delen}</div>}
        {gevaar && gg.symptomen && <div style={{ marginTop: 8 }}><strong>🤒 Mogelijke klachten:</strong> {gg.symptomen}</div>}
        {gevaar && gg.omgang && <div style={{ marginTop: 8 }}><strong>🧤 Zo ga je ermee om:</strong> {gg.omgang}</div>}
        {!gevaar && !onbekend && <div style={{ marginTop: 8 }}>👍 Veilig om aan te raken. Eet toch nooit zomaar van een plant.</div>}
        {!gevaar && onbekend && <div style={{ marginTop: 8 }}>❓ Raak de plant niet aan zonder te vragen en eet er nooit van.</div>}
        {(gevaar || onbekend) && (
          <div style={{ marginTop: 10, background: "rgba(231, 76, 60, 0.15)", padding: 12, borderRadius: 12 }}>
            <strong>🚑 Na contact: wat doe je?</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>{GIFT_NA_CONTACT.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {!gevaar && !onbekend && <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>Toch last gehad? Bel het Antigifcentrum: 070 245 245.</div>}
        {kids && <div style={{ marginTop: 10, fontWeight: 700 }}>👨‍👩‍👧 Vraag altijd aan een volwassene voor je iets van een plant aanraakt of in je mond steekt!</div>}
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>Een inschatting op basis van een foto en AI, niet 100% zeker.</div>
      </div>
      <VoorleesKnop text={giftTekst(g, kids)} label="Lees voor" />
    </div>
  );
}

const ALL_QUIZ_QUESTIONS = [
  // Planten & fotosynthese
  { q: "Welk deel van een plant zet zonlicht om in energie?", opts: ["Wortel", "Blad", "Bloem", "Stengel"], correct: 1 , niveau: 1 },
  { q: "Hoe heet het proces waarbij planten zuurstof produceren?", opts: ["Ademhaling", "Fotosynthese", "Verdamping", "Bestuiving"], correct: 1 , niveau: 2 },
  { q: "Wat neemt een plant voornamelijk op via haar wortels?", opts: ["Zonlicht", "Water & mineralen", "Zuurstof", "Insecten"], correct: 1 , niveau: 1 },
  { q: "Welke plant heeft van nature de minste hoeveelheid water nodig?", opts: ["Varen", "Cactus", "Tomaat", "Basilicum"], correct: 1 , niveau: 1 },
  { q: "Welk gas ademen planten overdag voornamelijk in?", opts: ["Zuurstof", "Koolstofdioxide", "Stikstof", "Waterstof"], correct: 1 , niveau: 2 },
  { q: "Wat gebeurt er met een plant die te veel water krijgt?", opts: ["Ze groeit sneller", "De wortels kunnen gaan rotten", "Ze wordt groener", "Niets"], correct: 1 , niveau: 2 },
  { q: "Waar zit chlorofyl (bladgroen) vooral in?", opts: ["Bloemblaadjes", "Bladeren", "Wortels", "Zaden"], correct: 1 , niveau: 2 },
  { q: "Hoe noemen we een plant die maar één jaar leeft?", opts: ["Eenjarige plant", "Vaste plant", "Struik", "Boom"], correct: 0 , niveau: 2 },
  { q: "Wat hebben zaden nodig om te ontkiemen?", opts: ["Enkel duisternis", "Water, warmte en soms licht", "Alleen aarde", "Suiker"], correct: 1 , niveau: 1 },
  { q: "Welk deel van de plant transporteert water naar de bladeren?", opts: ["De bloem", "De stengel", "De vrucht", "Het zaad"], correct: 1 , niveau: 2 },
  // Bomen
  { q: "Welke boomsoort behoudt haar groene naalden gedurende de winter?", opts: ["Eik", "Dennenboom", "Beuk", "Kastanje"], correct: 1 , niveau: 1 },
  { q: "Hoe kun je de exacte leeftijd van een omgehakte boom aflezen?", opts: ["Aantal bladeren", "Jaarringen in de stam", "Diepte van wortels", "Dikte van de schors"], correct: 1 , niveau: 1 },
  { q: "Welke boom geeft eikels?", opts: ["Beuk", "Eik", "Berk", "Wilg"], correct: 1 , niveau: 1 },
  { q: "Hoe noemen we een bos met vooral naaldbomen?", opts: ["Loofbos", "Naaldbos", "Gemengd bos", "Struikgewas"], correct: 1 , niveau: 1 },
  { q: "Wat verliezen de meeste loofbomen in de herfst?", opts: ["Hun wortels", "Hun bladeren", "Hun schors", "Hun bloesems"], correct: 1 , niveau: 1 },
  { q: "Welke boom heeft witte, papierachtige schors?", opts: ["Eik", "Berk", "Beuk", "Den"], correct: 1 , niveau: 2 },
  { q: "Wat is de belangrijkste functie van de schors van een boom?", opts: ["Voedsel maken", "De boom beschermen", "Water opslaan", "Zuurstof maken"], correct: 1 , niveau: 2 },
  { q: "Welke boom draagt kastanjes?", opts: ["Kastanjeboom", "Eik", "Berk", "Populier"], correct: 0 , niveau: 1 },
  { q: "Hoe noem je jonge boompjes die net uit een zaadje komen?", opts: ["Stekjes", "Kiemplantjes", "Loten", "Twijgen"], correct: 1 , niveau: 2 },
  { q: "Welke boomsoort behoort tot de langst levende bomen ter wereld (duizenden jaren)?", opts: ["Populier", "Sequoia (mammoetboom)", "Wilg", "Berk"], correct: 1 , niveau: 3 },
  // Bloemen & bestuiving
  { q: "Hoe noemen we het gele poeder in bloemen dat bijen verzamelen?", opts: ["Suiker", "Zand", "Stuifmeel", "Nectar"], correct: 2 , niveau: 1 },
  { q: "Waarom zijn bloemen vaak felgekleurd?", opts: ["Om insecten aan te trekken", "Om warmte vast te houden", "Om regen af te weren", "Toeval"], correct: 0 , niveau: 1 },
  { q: "Wat is bestuiving?", opts: ["Water geven aan een plant", "Stuifmeel overbrengen naar een andere bloem", "Bladeren snoeien", "Zaden planten"], correct: 1 , niveau: 2 },
  { q: "Welk dier is de bekendste bestuiver?", opts: ["Mier", "Bij", "Spin", "Worm"], correct: 1 , niveau: 1 },
  { q: "Wat drinken bijen uit bloemen?", opts: ["Water", "Nectar", "Melk", "Sap"], correct: 1 , niveau: 1 },
  { q: "Hoe noemen we een bloem die 's nachts opengaat en overdag sluit?", opts: ["Nachtbloem", "Zonnebloem", "Ochtendster", "Winterbloem"], correct: 0 , niveau: 2 },
  { q: "Waaruit ontstaat een vrucht meestal?", opts: ["Uit het blad", "Uit de bevruchte bloem", "Uit de wortel", "Uit de stengel"], correct: 1 , niveau: 2 },
  { q: "Welke bloem draait zijn 'gezicht' mee met de zon?", opts: ["Tulp", "Zonnebloem", "Roos", "Klaproos"], correct: 1 , niveau: 1 },
  { q: "Wat zit er in een zaaddoos van een bloem?", opts: ["Water", "Zaadjes", "Stuifmeel", "Nectar"], correct: 1 , niveau: 1 },
  { q: "Hoe heten de gekleurde blaadjes rond het hart van een bloem?", opts: ["Kelkbladeren", "Kroonbladeren", "Steelbladeren", "Wortelbladeren"], correct: 1 , niveau: 3 },
  // Groenten & moestuin
  { q: "Van welke plant maken we friet?", opts: ["Aardappel", "Wortel", "Ui", "Prei"], correct: 0 , niveau: 1 },
  { q: "Welk deel van de wortelplant eten we?", opts: ["Het blad", "De wortel", "De bloem", "Het zaad"], correct: 1 , niveau: 1 },
  { q: "Groeien tomaten boven of onder de grond?", opts: ["Boven de grond", "Onder de grond", "Allebei", "In het water"], correct: 0 , niveau: 1 },
  { q: "Waarom is het goed om onkruid uit je moestuin te wieden?", opts: ["Onkruid smaakt lekker", "Het neemt water en voedingsstoffen weg van je groenten", "Onkruid trekt vlinders aan", "Geen enkele reden"], correct: 1 , niveau: 2 },
  { q: "Welke groente groeit als een hoofd van dicht opeengepakte bladeren?", opts: ["Wortel", "Sla of kool", "Aardappel", "Prei"], correct: 1 , niveau: 1 },
  { q: "Wat gebruik je best om je moestuinbodem te verrijken?", opts: ["Plastic", "Compost", "Zand", "Steentjes"], correct: 1 , niveau: 2 },
  { q: "In welk seizoen zaai je de meeste groenten?", opts: ["Winter", "Lente", "Herfst", "Het maakt niet uit"], correct: 1 , niveau: 1 },
  { q: "Wat is een peul (zoals bij erwten) eigenlijk?", opts: ["Een wortel", "Een zaaddoos met zaadjes erin", "Een blad", "Een bloem"], correct: 1 , niveau: 2 },
  { q: "Welke groente is eigenlijk een vrucht, net als een appel?", opts: ["Wortel", "Tomaat", "Ui", "Aardappel"], correct: 1 , niveau: 2 },
  { q: "Waarom worden bijen graag gezien in de moestuin?", opts: ["Ze bestuiven de bloemen van je groenten", "Ze eten onkruid", "Ze maken de grond los", "Ze houden vogels weg"], correct: 0 , niveau: 1 },
  // Insecten & kleine beestjes
  { q: "Wat bouwt een rups vlak voordat hij verandert in een vlinder?", opts: ["Een holletje in de grond", "Een vogelnest", "Een cocon of pop", "Een web"], correct: 2 , niveau: 1 },
  { q: "Hoeveel wandelende poten heeft een volwassen spin?", opts: ["6 poten", "8 poten", "10 poten", "12 poten"], correct: 1 , niveau: 1 },
  { q: "Wat is de favoriete snack van een hongerig lieveheersbeestje?", opts: ["Gras", "Bladluizen", "Nectar", "Rijp fruit"], correct: 1 , niveau: 1 },
  { q: "Hoeveel poten heeft een insect?", opts: ["4 poten", "6 poten", "8 poten", "10 poten"], correct: 1 , niveau: 1 },
  { q: "Wat maakt een spinnenweb zo sterk?", opts: ["Het is van metaal", "De zijdedraad is heel elastisch en sterk", "Het is nat", "Het is dik als touw"], correct: 1 , niveau: 2 },
  { q: "Hoe communiceren mieren vooral met elkaar?", opts: ["Met geluid", "Met geurstoffen", "Met kleuren", "Met dansjes in de lucht"], correct: 1 , niveau: 2 },
  { q: "Wat doet een bij als ze een goede bloem gevonden heeft?", opts: ["Ze schreeuwt", "Ze doet een 'bijendans' om het aan anderen te laten weten", "Ze slaapt", "Ze vliegt meteen naar huis"], correct: 1 , niveau: 3 },
  { q: "Welk klein beestje rolt zich op tot een balletje als het schrikt?", opts: ["Oorworm", "Pissebed", "Mier", "Vlieg"], correct: 1 , niveau: 1 },
  { q: "Hoeveel stadia doorloopt een vlinder in zijn leven?", opts: ["2", "3", "4", "5"], correct: 2 , niveau: 2 },
  { q: "Wat eten de meeste volwassen vlinders?", opts: ["Bladeren", "Nectar", "Andere insecten", "Aarde"], correct: 1 , niveau: 1 },
  // Vogels
  { q: "Welke vogel in België is opvallend groen en klopt op boomstammen?", opts: ["Merel", "Groene specht", "Mus", "Kraai"], correct: 1 , niveau: 2 },
  { q: "Waarvan zijn de meeste vogelnesten gemaakt?", opts: ["Steen", "Takjes, mos en veren", "Plastic", "Zand"], correct: 1 , niveau: 1 },
  { q: "Welke vogel is bekend om zijn roep en legt eitjes in nesten van andere vogels?", opts: ["Merel", "Koekoek", "Mus", "Ekster"], correct: 1 , niveau: 2 },
  { q: "Waar zijn donsveertjes vooral goed voor?", opts: ["Vliegen", "Warmte vasthouden", "Zwemmen", "Zingen"], correct: 1 , niveau: 2 },
  { q: "Hoe noemen we vogels die 's winters naar warmere landen trekken?", opts: ["Standvogels", "Trekvogels", "Roofvogels", "Watervogels"], correct: 1 , niveau: 1 },
  { q: "Wat eten kleine tuinvogels vooral in de winter bij een voederplek?", opts: ["Vlees", "Zaden en vetbollen", "Enkel fruit", "Water"], correct: 1 , niveau: 1 },
  { q: "Welke vogel is een grote roofvogel die je in België kan zien?", opts: ["Mus", "Buizerd", "Merel", "Mees"], correct: 1 , niveau: 2 },
  { q: "Waaraan herken je een merel-mannetje meestal?", opts: ["Bruine veren", "Zwarte veren met gele snavel", "Witte veren", "Blauwe veren"], correct: 1 , niveau: 1 },
  { q: "Waar gebruikt een vogel zijn snavel NIET voor?", opts: ["Eten pakken", "Nest bouwen", "Zwemmen onder water als een vis", "Veren verzorgen"], correct: 2 , niveau: 2 },
  { q: "Hoe heet een jonge vogel die nog niet kan vliegen?", opts: ["Kuiken", "Larve", "Rups", "Pop"], correct: 0 , niveau: 1 },
  // Zoogdieren
  { q: "Wat is het grootste zoogdier ter wereld?", opts: ["Olifant", "Blauwe vinvis", "Giraffe", "Neushoorn"], correct: 1 , niveau: 1 },
  { q: "Hoe noem je een dier dat alleen planten eet?", opts: ["Vleeseter", "Planteneter", "Alleseter", "Aaseter"], correct: 1 , niveau: 1 },
  { q: "Welk dier houdt een winterslaap in België?", opts: ["Vos", "Egel", "Konijn", "Eekhoorn"], correct: 1 , niveau: 1 },
  { q: "Wat is typisch aan alle zoogdieren?", opts: ["Ze leggen eieren", "Ze geven hun jongen melk", "Ze hebben schubben", "Ze kunnen allemaal vliegen"], correct: 1 , niveau: 2 },
  { q: "Welk dier graaft gangen en maakt de aarde luchtiger?", opts: ["Vlinder", "Mol", "Merel", "Kikker"], correct: 1 , niveau: 1 },
  { q: "Wat legt een eekhoorn vooral aan in de herfst?", opts: ["Een voorraad noten en zaden", "Een nest van modder", "Water", "Niets bijzonders"], correct: 0 , niveau: 1 },
  { q: "Hoe vindt een vleermuis zijn weg in het donker?", opts: ["Met zijn ogen", "Met echolocatie (geluidsgolven)", "Met zijn neus", "Met zijn staart"], correct: 1 , niveau: 3 },
  { q: "Welk Belgisch bosdier heeft een rode vacht en een pluimstaart?", opts: ["Wolf", "Vos", "Das", "Otter"], correct: 1 , niveau: 1 },
  { q: "Wat is een duidelijk kenmerk van een egel?", opts: ["Zachte vacht", "Stekels op zijn rug", "Vinnen", "Een lange snuit als een olifant"], correct: 1 , niveau: 1 },
  { q: "Welk dier draagt zijn baby in een buidel?", opts: ["Konijn", "Kangoeroe", "Egel", "Vos"], correct: 1 , niveau: 1 },
  // Water & vijverleven
  { q: "Hoe noemen we een kikker als hij nog een staart heeft en in het water leeft?", opts: ["Larve", "Dikkopje", "Ei", "Pop"], correct: 1 , niveau: 2 },
  { q: "Welk dier draagt zijn huis op zijn rug?", opts: ["Slak", "Kikker", "Vis", "Eend"], correct: 0 , niveau: 1 },
  { q: "Wat gebruiken vissen om zuurstof uit water te halen?", opts: ["Longen", "Kieuwen", "Neusgaten", "Alleen hun huid"], correct: 1 , niveau: 2 },
  { q: "Welk beestje kan op het wateroppervlak 'schaatsen' zonder te zinken?", opts: ["Waterschaatser", "Kikker", "Vis", "Slak"], correct: 0 , niveau: 2 },
  { q: "Wat is een typisch verschil tussen een kikker en een pad?", opts: ["Geen verschil", "Padden hebben meestal een drogere, bultige huid", "Kikkers leven alleen op het land", "Padden kunnen vliegen"], correct: 1 , niveau: 3 },
  { q: "Wat eten de meeste vijverkikkers?", opts: ["Alleen planten", "Insecten en andere kleine beestjes", "Steentjes", "Alleen vis"], correct: 1 , niveau: 1 },
  { q: "Wat leggen kikkers in het water?", opts: ["Kikkerdril (eitjes)", "Jongen die al kunnen springen", "Nesten", "Niets"], correct: 0 , niveau: 1 },
  { q: "Welke waterplant drijft met ronde bladeren op het wateroppervlak?", opts: ["Waterlelie", "Cactus", "Varen", "Klaver"], correct: 0 , niveau: 1 },
  { q: "Wat gebeurt er met een dikkopje als hij groeit?", opts: ["Hij krijgt vleugels", "Hij krijgt poten en verliest zijn staart", "Hij wordt een vis", "Er verandert niets"], correct: 1 , niveau: 2 },
  { q: "Wat is een amfibie?", opts: ["Een dier dat zowel in water als op land kan leven", "Een dier dat alleen vliegt", "Een plant", "Een insect"], correct: 0 , niveau: 3 },
  // Seizoenen & weer
  { q: "In welk seizoen beginnen de meeste bomen weer bladeren te krijgen?", opts: ["Winter", "Lente", "Zomer", "Herfst"], correct: 1 , niveau: 1 },
  { q: "Wat gebeurt er met de dagen in de zomer?", opts: ["Ze worden korter", "Ze worden langer", "Ze blijven gelijk", "Ze verdwijnen"], correct: 1 , niveau: 1 },
  { q: "Welk seizoen komt na de zomer?", opts: ["Winter", "Lente", "Herfst", "Er komt niets na"], correct: 2 , niveau: 1 },
  { q: "Waarom vallen bladeren in de herfst van de bomen?", opts: ["De boom is ziek", "De boom bereidt zich voor op de winter", "De wind waait ze er per ongeluk af", "Vogels trekken ze eraf"], correct: 1 , niveau: 2 },
  { q: "Wat is rijp (vorst)?", opts: ["Bevroren waterdruppels op koude oppervlakken", "Een soort regen", "Warme lucht", "Een soort wind"], correct: 0 , niveau: 2 },
  { q: "In welk seizoen zie je de meeste bloemen bloeien in de tuin?", opts: ["Winter", "Lente en zomer", "Alleen herfst", "Nooit"], correct: 1 , niveau: 1 },
  { q: "Wat doen veel dieren als de winter eraan komt en voedsel schaars wordt?", opts: ["Ze verhuizen naar de zee", "Winterslaap houden of wegtrekken", "Ze veranderen van kleur naar roze", "Niets bijzonders"], correct: 1 , niveau: 2 },
  { q: "Wat is dauw op het gras 's ochtends vroeg?", opts: ["Gesmolten sneeuw", "Kleine waterdruppeltjes uit de lucht", "Regen die net gevallen is", "Zweet van de plant"], correct: 1 , niveau: 2 },
  { q: "Welk seizoen heeft meestal de kortste dagen en langste nachten?", opts: ["Zomer", "Winter", "Lente", "Herfst"], correct: 1 , niveau: 1 },
  { q: "Wat hebben planten vooral nodig om goed te groeien in de lente?", opts: ["Enkel duisternis", "Water, licht en warmte", "Alleen sneeuw", "Niets"], correct: 1 , niveau: 1 },
  // Natuur & milieu algemeen
  { q: "Wat is een voedselketen?", opts: ["Een keten om fietsen vast te maken", "Hoe dieren en planten elkaar opeten voor energie", "Een soort plant", "Een weg door het bos"], correct: 1 , niveau: 2 },
  { q: "Waarom zijn bijen zo belangrijk voor de natuur?", opts: ["Ze maken honing en bestuiven bloemen en gewassen", "Ze houden muggen weg", "Ze maken geen geluid", "Ze zijn niet belangrijk"], correct: 0 , niveau: 1 },
  { q: "Wat is compost?", opts: ["Afval dat wordt weggegooid", "Verteerd organisch materiaal dat de bodem voedt", "Een soort plastic", "Een soort insect"], correct: 1 , niveau: 2 },
  { q: "Wat betekent het als een diersoort 'bedreigd' is?", opts: ["Er zijn er heel veel", "Er zijn er nog maar weinig en ze kunnen uitsterven", "Ze zijn gevaarlijk voor mensen", "Ze leven niet meer in het wild"], correct: 1 , niveau: 2 },
  { q: "Wat doen wormen voor de bodem?", opts: ["Ze maken de grond luchtig en verrijken ze", "Ze maken de grond hard", "Ze eten planten kapot", "Niets nuttigs"], correct: 0 , niveau: 1 },
  { q: "Wat is een ecosysteem?", opts: ["Een computer", "Een gemeenschap van planten en dieren die samen leven", "Een soort weer", "Een moestuin alleen"], correct: 1 , niveau: 3 },
  { q: "Waarom is het belangrijk om afval niet in de natuur te gooien?", opts: ["Het kan dieren en planten schaden", "Het maakt niets uit", "Dieren vinden het lekker", "Het helpt planten groeien"], correct: 0 , niveau: 1 },
  { q: "Wat is recycleren?", opts: ["Afval weggooien in de natuur", "Materialen hergebruiken in plaats van weggooien", "Planten water geven", "Dieren voeden"], correct: 1 , niveau: 1 },
  { q: "Welk gas produceren planten dat belangrijk is om te ademen?", opts: ["Koolstofdioxide", "Zuurstof", "Stikstof", "Methaan"], correct: 1 , niveau: 1 },
  { q: "Waarom groeien planten vaak richting het licht?", opts: ["Toeval", "Ze hebben licht nodig voor fotosynthese", "Ze zijn bang in het donker", "Licht maakt ze zwaarder"], correct: 1 , niveau: 2 },
  // Extra vragen (niveau-gemengd)
  { q: "Wat noemen we het topje van een wortel dat de plant dieper de grond in laat groeien?", opts: ["Wortelharen", "Groeipunt (wortelpunt)", "Bladsteel", "Knop"], correct: 1, niveau: 3 },
  { q: "Wat doet een plant als er te weinig licht is?", opts: ["Ze groeit sneller", "Ze groeit slap en zoekt naar meer licht", "Ze bloeit sneller", "Niets verandert"], correct: 1, niveau: 2 },
  { q: "Wat is een 'kroon' bij een boom?", opts: ["De wortels", "Het bovenste deel met takken en bladeren", "De stam", "De schors"], correct: 1, niveau: 2 },
  { q: "Welke boom verliest zijn bladeren NIET in de winter?", opts: ["Eik", "Beuk", "Den (naaldboom)", "Berk"], correct: 2, niveau: 1 },
  { q: "Wat trekt vlinders vooral aan bij een bloem?", opts: ["De kleur en geur", "Het gewicht", "De vorm van het blad", "De hoogte van de plant"], correct: 0, niveau: 1 },
  { q: "Wat gebeurt er meestal als een bloem niet bestoven wordt?", opts: ["Ze maakt gewoon een vrucht", "Er komt meestal geen vrucht of zaad", "Ze wordt groter", "Niets"], correct: 1, niveau: 2 },
  { q: "Welke groente kan je nog in de winter oogsten uit een moestuin?", opts: ["Boerenkool", "Meloen", "Aardbei", "Komkommer"], correct: 0, niveau: 2 },
  { q: "Waarom draai je vruchtgroenten elk jaar naar een andere plek in de moestuin?", opts: ["Om de bodem niet uit te putten en ziektes te voorkomen", "Om ze mooier te laten groeien", "Omdat het verplicht is", "Geen reden"], correct: 0, niveau: 3 },
  { q: "Wat is het nut van een oorworm in de tuin?", opts: ["Hij eet schadelijke bladluizen", "Hij is enkel schadelijk", "Hij eet alleen hout", "Geen enkel nut"], correct: 0, niveau: 2 },
  { q: "Hoeveel poten heeft een duizendpoot ongeveer?", opts: ["6", "8", "Heel veel (tientallen tot honderden)", "Geen poten"], correct: 2, niveau: 1 },
  { q: "Wat is een broedseizoen?", opts: ["De periode waarin vogels eieren leggen en jongen grootbrengen", "De periode waarin vogels wegtrekken", "De winter", "Een soort vogelgeluid"], correct: 0, niveau: 2 },
  { q: "Welke vogel zwemt en duikt goed en heeft zwemvliezen?", opts: ["Mus", "Eend", "Merel", "Specht"], correct: 1, niveau: 1 },
  { q: "Wat is het verschil tussen een haas en een konijn?", opts: ["Geen verschil", "Hazen zijn groter en hun jongen kunnen meteen lopen", "Konijnen leven in bomen", "Hazen zijn vissen"], correct: 1, niveau: 3 },
  { q: "Hoe noemen we de ondergrondse woning van een das?", opts: ["Hol / burcht", "Nest", "Kooi", "Web"], correct: 0, niveau: 2 },
  { q: "Wat is de taak van riet aan de rand van een vijver?", opts: ["Het zuivert het water en biedt schuilplaats aan dieren", "Het maakt het water vies", "Het heeft geen enkele functie", "Het trekt alleen muggen aan"], correct: 0, niveau: 3 },
  { q: "Waar leggen de meeste waterinsecten hun eitjes?", opts: ["In de lucht", "In of bij het water", "Onder de grond", "In bomen"], correct: 1, niveau: 2 },
  { q: "Wat is een typisch teken dat de lente begint in de natuur?", opts: ["Bomen verliezen hun bladeren", "Sneeuwklokjes en krokussen beginnen te bloeien", "Alle dieren gaan slapen", "Het wordt overal kouder"], correct: 1, niveau: 1 },
  { q: "Waarom trekken sommige vogels in de herfst naar het zuiden?", opts: ["Om vakantie te vieren", "Om voedsel te vinden waar het warmer is", "Ze houden van vliegen", "Zonder reden"], correct: 1, niveau: 2 },
  { q: "Wat is biodiversiteit?", opts: ["Een soort plastic", "De verscheidenheid aan planten en dieren in een gebied", "Een soort weer", "Een moestuintechniek"], correct: 1, niveau: 3 },
  { q: "Waarom is het goed om inheemse (van nature bij ons voorkomende) planten in je tuin te zetten?", opts: ["Ze trekken lokale insecten en vogels beter aan", "Ze zijn altijd goedkoper", "Ze hebben geen water nodig", "Geen enkele reden"], correct: 0, niveau: 3 },
  // Extra vragen: dieren, bos, park, dierentuin (v2)
  { q: "Hoe heet het jong van een kikker?", opts: ["Rups", "Kikkervisje", "Pop", "Veulen"], correct: 1, niveau: 1 },
  { q: "Welke vrucht groeit aan een eik?", opts: ["Dennenappel", "Kastanje", "Eikel", "Beukennootje"], correct: 2, niveau: 1 },
  { q: "Wat eet een panda bijna uitsluitend?", opts: ["Vis", "Bamboe", "Insecten", "Fruit"], correct: 1, niveau: 1 },
  { q: "Welk dier heeft de langste nek?", opts: ["Olifant", "Kameel", "Struisvogel", "Giraffe"], correct: 3, niveau: 1 },
  { q: "Wat is het grootste landdier?", opts: ["Neushoorn", "Giraffe", "Afrikaanse olifant", "Nijlpaard"], correct: 2, niveau: 1 },
  { q: "Welk dier is het snelste op het land?", opts: ["Leeuw", "Paard", "Cheeta", "Struisvogel"], correct: 2, niveau: 2 },
  { q: "Hoe noemen we een groep wolven?", opts: ["Roedel", "Zwerm", "School", "Kudde"], correct: 0, niveau: 2 },
  { q: "Wat zit er in de bult van een kameel?", opts: ["Water", "Lucht", "Spieren", "Vet"], correct: 3, niveau: 2 },
  { q: "Welk dier bouwt dammen in beken en rivieren?", opts: ["Egel", "Bever", "Das", "Vos"], correct: 1, niveau: 2 },
  { q: "Welke boom herken je aan zijn witte schors met zwarte vlekken?", opts: ["Berk", "Eik", "Den", "Plataan"], correct: 0, niveau: 2 },
  { q: "Wat gebeurt er met een egel tijdens zijn winterslaap?", opts: ["Hij eet extra veel", "Zijn hartslag en lichaamstemperatuur dalen sterk", "Hij verhuist naar het zuiden", "Hij verandert van kleur"], correct: 1, niveau: 2 },
  { q: "Welke vogel kan zijn kop bijna helemaal omdraaien?", opts: ["Uil", "Mus", "Eend", "Duif"], correct: 0, niveau: 2 },
  { q: "Welk reptiel kan van kleur veranderen?", opts: ["Krokodil", "Schildpad", "Kameleon", "Slang"], correct: 2, niveau: 2 },
  { q: "Wat is een predator?", opts: ["Een plant", "Een jager die andere dieren eet", "Een prooidier", "Een plantenetend dier"], correct: 1, niveau: 2 },
  { q: "Hoe kan je de leeftijd van een boomstam schatten?", opts: ["Aan de kleur van de bladeren", "Aan de lengte van de wortels", "Door de jaarringen te tellen", "Aan het aantal vogels"], correct: 2, niveau: 2 },
  { q: "Wat is het verschil tussen een carnivoor en een omnivoor?", opts: ["Carnivoren eten planten, omnivoren vlees", "Carnivoren eten vlees, omnivoren planten én vlees", "Er is geen verschil", "Omnivoren eten enkel insecten"], correct: 1, niveau: 3 },
  { q: "Wat is symbiose?", opts: ["Twee soorten die samenleven en elkaar helpen", "Een dier dat een ander dier opeet", "Een plant die afsterft", "Een soort bodem"], correct: 0, niveau: 3 },
  { q: "Wat is een parasiet?", opts: ["Een nuttige bij", "Een organisme dat op of in een ander leeft en daar voordeel van haalt", "Een eetbare paddenstoel", "Een dier dat enkel planten eet"], correct: 1, niveau: 3 },
  { q: "Wat is een 'pionierplant'?", opts: ["Een plant die als eerste op kale grond groeit", "Een plant met stekels", "Een waterplant", "Een plant die enkel 's nachts bloeit"], correct: 0, niveau: 3 },
  { q: "Wat is humus?", opts: ["Een soort mos", "Een boomsoort", "Een dier in de bodem", "Vruchtbare laag van verteerde bladeren en plantenresten"], correct: 3, niveau: 3 },
  { q: "Waarom hebben flamingo's roze veren?", opts: ["Door pigmenten uit hun voedsel", "Ze verven zichzelf", "Door de zon", "Ze worden zo geboren"], correct: 0, niveau: 3 },
  { q: "Wat vertelt een dansende bij aan de andere bijen?", opts: ["Dat het gaat regenen", "Dat ze honing maakt", "Waar voedsel te vinden is", "Dat ze een partner zoekt"], correct: 2, niveau: 3 },
  { q: "Welk zoogdier legt eieren?", opts: ["Egel", "Vogelbekdier", "Konijn", "Vleermuis"], correct: 1, niveau: 3 },
  { q: "Waarom vliegen ganzen in V-vorm?", opts: ["Zo sparen ze energie", "Om mooier te zijn", "Om te kunnen praten", "Zodat jagers hen niet zien"], correct: 0, niveau: 3 },
  { q: "Wat is het mycelium van een paddenstoel?", opts: ["De hoed", "Het onderaardse draadnetwerk dat voedsel opneemt", "De zaden", "De steel"], correct: 1, niveau: 3 },
  { q: "Hoe noemen we een groep leeuwen?", opts: ["Zwerm", "Kudde", "Troep (pride)", "School"], correct: 2, niveau: 3 },
  { q: "Welk deel van een bloem maakt het stuifmeel?", opts: ["Stamper", "Kelkblad", "Wortel", "Meeldraad (helmknop)"], correct: 3, niveau: 3 },
];

function getWaterInfoFallback() {
  return {
    light: "Gemiddeld zonlicht",
    soil: "Standaard potgrond",
    freq: "1x per week",
    amount: "Water tot de grond vochtig is.",
    tip: "Voel de grond: als de bovenste 2cm droog is, geef dan water.",
  };
}

const s = {
  screen: {
    fontFamily: "system-ui, sans-serif",
    minHeight: "100vh",
    padding: "24px 20px 50px",
    display: "flex",
    flexDirection: "column",
    background: "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
    color: "#fff",
  },
  title: { fontSize: 28, fontWeight: 800, margin: "10px 0 6px", textAlign: "center" },
  subtitle: { fontSize: 15, opacity: 0.85, textAlign: "center", marginBottom: 28 },
  card: {
    background: "rgba(255, 255, 255, 0.08)",
    backdropFilter: "blur(12px)",
    borderRadius: 24,
    padding: 22,
    marginBottom: 18,
    border: "1px solid rgba(255, 255, 255, 0.15)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  },
  bigButton: {
    background: "linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 20,
    padding: "18px 20px",
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    width: "100%",
    boxSizing: "border-box",
  },
  ghostButton: {
    background: "rgba(255, 255, 255, 0.05)",
    color: "#fff",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    borderRadius: 20,
    padding: "16px 18px",
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 12,
    cursor: "pointer",
    width: "100%",
    boxSizing: "border-box",
    textAlign: "center",
  },
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  iconBtn: { background: "rgba(255, 255, 255, 0.1)", border: "1px solid rgba(255, 255, 255, 0.2)", borderRadius: 16, padding: "12px 16px", color: "#fff" },
  input: { width: "100%", padding: "16px", borderRadius: 16, border: "1px solid rgba(255, 255, 255, 0.3)", background: "rgba(0, 0, 0, 0.2)", color: "#fff", fontSize: 16, marginBottom: 16 },
  label: { fontSize: 14, opacity: 0.9, marginBottom: 8, display: "block", fontWeight: 600 },
  backLink: { background: "none", border: "none", color: "#a8e6cf", fontSize: 22, marginBottom: 20, textAlign: "left", padding: "10px 4px", fontWeight: 700, cursor: "pointer" },
  resultImg: { width: "100%", borderRadius: 20, marginBottom: 20, maxHeight: 320, objectFit: "cover" },
  historyItem: { display: "flex", gap: 16, alignItems: "center", background: "rgba(255, 255, 255, 0.06)", borderRadius: 20, padding: 12, marginBottom: 12, cursor: "pointer" },
  historyImg: { width: 64, height: 64, borderRadius: 14, objectFit: "cover" },
  quizOpt: { width: "100%", textAlign: "left", padding: "16px 20px", borderRadius: 16, border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(255, 255, 255, 0.1)", color: "#fff", fontSize: 17, marginBottom: 12, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" },
};
const KIDS_COLORS = ["#2ecc71", "#3498db", "#e67e22", "#f1c40f", "#8e44ad", "#16a085"];
const ks = {
  ...s,
  screen: { ...s.screen, background: "linear-gradient(135deg, #134e5e 0%, #71b280 100%)" },
  title: { ...s.title, fontSize: 34, fontWeight: 900 },
  card: { ...s.card, background: "rgba(255, 255, 255, 0.15)", border: "2px solid rgba(255, 255, 255, 0.25)" },
  bigButton: { ...s.bigButton, borderRadius: 24, padding: "20px 22px", fontSize: 20 },
  ghostButton: { ...s.ghostButton, borderRadius: 24, fontSize: 18 },
};

export default function App() {
  const [screen, setScreen] = useState("home");
  const [keys, setKeys] = useState(loadKeys());
  const [kidsMode, setKidsMode] = useState(localStorage.getItem(LS_KEYS.kidsMode) === "1");
  const [history, setHistory] = useState(loadHistory());
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [result, setResult] = useState(null);
  const [liveApiUsage, setLiveApiUsage] = useState(0);

  const [currentQuizQuestions, setCurrentQuizQuestions] = useState([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [quizAnswered, setQuizAnswered] = useState(null);

  const [safariOmgeving, setSafariOmgeving] = useState(null);
  const [safariOpdracht, setSafariOpdracht] = useState(0);
  const [safariStickers, setSafariStickers] = useState(0);
  const [safariBericht, setSafariBericht] = useState("");
  const [newMissionInput, setNewMissionInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);
  const [quizNiveau, setQuizNiveau] = useState("gemengd");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraError, setCameraError] = useState("");
  const [scanMode, setScanMode] = useState("general");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomRange, setZoomRange] = useState({ min: 1, max: 1, step: 0.1 });
  const [zoomLevel, setZoomLevel] = useState(1);
  const [voorlezen, setVoorlezen] = useState(localStorage.getItem("natuurscanner_voorlezen") === "1");
  const [voiceTick, setVoiceTick] = useState(0);
  const [tempo, setTempo] = useState(localStorage.getItem("natuurscanner_voorleestempo") === "langzaam" ? "langzaam" : "normaal");

  useEffect(() => {
    localStorage.setItem(LS_KEYS.kidsMode, kidsMode ? "1" : "0");
  }, [kidsMode]);

  useEffect(() => {
    if (screen !== "home") return;
    const interval = setInterval(async () => {
      const now = Date.now();
      if (keys.firebaseUrl && keys.firebaseUrl.trim() !== "") {
        try {
          const baseUrl = keys.firebaseUrl.replace(/\/$/, "");
          const res = await fetch(`${baseUrl}/scans.json`);
          const data = await res.json();
          if (data) {
            const recentScans = Object.values(data).filter((entry) => now - entry.timestamp < 60000);
            setLiveApiUsage(recentScans.length);
          } else {
            setLiveApiUsage(0);
          }
        } catch (e) {}
      } else {
        try {
          let usage = JSON.parse(localStorage.getItem(LS_KEYS.apiUsage) || "[]");
          usage = usage.filter((t) => now - t < 60000);
          setLiveApiUsage(usage.length);
        } catch (e) {}
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [keys.firebaseUrl, screen]);

  const openCamera = async (m) => {
    setScanMode(m);
    setCameraError("");
    setTorchSupported(false);
    setTorchOn(false);
    setZoomSupported(false);
    setZoomRange({ min: 1, max: 3, step: 0.1 });
    setZoomLevel(1);
    setScreen("camera");
    
    const constraints = {
      video: {
        facingMode: { ideal: "environment" },
        // Hogere ideale resolutie gevraagd (was 1920x1080) voor een scherpere
        // opname; "min" blijft laag zodat oudere/zwakkere camera's nog steeds
        // gewoon een stream krijgen in plaats van meteen te falen.
        width: { ideal: 3840, min: 1280 },
        height: { ideal: 2160, min: 720 },
        advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }, { whiteBalanceMode: "continuous" }]
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track && typeof track.getCapabilities === 'function') {
        const capabilities = track.getCapabilities();
        setTorchSupported(!!capabilities.torch);
        if (capabilities.zoom && capabilities.zoom.max > capabilities.zoom.min) {
          setZoomSupported(true);
          setZoomRange({
            min: capabilities.zoom.min,
            max: capabilities.zoom.max,
            step: capabilities.zoom.step || 0.1,
          });
          const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
          setZoomLevel(settings.zoom || capabilities.zoom.min);
        }
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(e => {});
      }
    } catch (err) {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        streamRef.current = fallbackStream;
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          await videoRef.current.play();
        }
      } catch (fallbackErr) {
        setCameraError("Camera niet beschikbaar op dit apparaat. Gebruik de knop hieronder om een foto te kiezen.");
      }
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track) {
      try {
        await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
        setTorchOn(!torchOn);
      } catch (e) {}
    }
  };

  const handleZoomChange = async (value) => {
    setZoomLevel(value);
    // Enkel echte hardware-zoom proberen als het toestel dat ook meldt te
    // ondersteunen. Zonder die ondersteuning blijft het puur digitaal: de
    // live preview wordt via CSS ingezoomd, en bij het nemen van de foto
    // wordt het beeld bijgesneden (zie capturePhoto hieronder).
    if (zoomSupported) {
      const track = streamRef.current?.getVideoTracks()[0];
      if (track) {
        try {
          await track.applyConstraints({ advanced: [{ zoom: value }] });
        } catch (e) {}
      }
    }
  };

  const closeCamera = () => {
    setTorchOn(false);
    setZoomSupported(false);
    setTorchSupported(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScreen(scanMode === "safari" ? "safari" : "home");
    setScanMode("general");
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    // Probeer eerst een scherpe, volwaardige foto via de ImageCapture API:
    // die gebruikt de echte camera-capture-pijplijn (met autofocus-moment)
    // in plaats van gewoon een los frame uit de live videopreview te grijpen,
    // wat vaak wazig/minder scherp is. Niet elke browser ondersteunt dit
    // (bv. Safari op iPhone vaak niet) — dan valt de code automatisch terug
    // op de bestaande videoframe-methode hieronder.
    const track = streamRef.current?.getVideoTracks()[0];
    const digitalZoomActive = !zoomSupported && zoomLevel > 1;

    // Bij digitale (software) zoom slaan we de ImageCapture-route over: die
    // zou gewoon de volle, niet-ingezoomde foto teruggeven, los van wat de
    // gebruiker op het scherm ziet. In dat geval snijden we hieronder zelf
    // het ingezoomde gedeelte uit het videoframe.
    if (!digitalZoomActive && track && typeof window.ImageCapture === "function") {
      try {
        const imageCapture = new window.ImageCapture(track);
        const blob = await imageCapture.takePhoto();
        const rawDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Kon de scherpe foto niet lezen."));
          reader.readAsDataURL(blob);
        });
        const dataUrl = await resizeDataUrl(rawDataUrl).catch(() => rawDataUrl);
        const currentMode = scanMode;
        closeCamera();
        await processImage(dataUrl, currentMode);
        return;
      } catch (e) {
        // Geen paniek: val gewoon stil terug op de methode hieronder.
      }
    }

    const canvas = canvasRef.current;
    let width = video.videoWidth || 1280;
    let height = video.videoHeight || 720;
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      if (width > height) {
        height = Math.round((height * MAX_IMAGE_DIMENSION) / width);
        width = MAX_IMAGE_DIMENSION;
      } else {
        width = Math.round((width * MAX_IMAGE_DIMENSION) / height);
        height = MAX_IMAGE_DIMENSION;
      }
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (digitalZoomActive) {
      // Enkel het middelste stukje van het echte camerabeeld gebruiken
      // (ter grootte van 1/zoomLevel), en dat uitrekken over het volledige
      // canvas — dat is exact wat de gebruiker op het scherm zag dankzij
      // de CSS-zoom op het video-element hierboven.
      const srcW = video.videoWidth / zoomLevel;
      const srcH = video.videoHeight / zoomLevel;
      const srcX = (video.videoWidth - srcW) / 2;
      const srcY = (video.videoHeight - srcH) / 2;
      ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, width, height);
    } else {
      ctx.drawImage(video, 0, 0, width, height);
    }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.90);
    const currentMode = scanMode;
    closeCamera();
    await processImage(dataUrl, currentMode);
  };

  /* ---------- UPLOAD HANDLER VIA LABEL + INPUT KOPPELING ---------- */
  const handleFileChange = (e, modeOverride) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const currentMode = modeOverride || scanMode;
    setScanMode(currentMode);
    setScreen("loading");
    setLoadingMsg("Foto inlezen...");

    const reader = new FileReader();
    reader.onload = async (uploadEvent) => {
      const rawDataUrl = uploadEvent.target.result;
      let dataUrl = rawDataUrl;
      try {
        setLoadingMsg("Foto optimaliseren...");
        dataUrl = await resizeDataUrl(rawDataUrl);
      } catch (resizeErr) {
        dataUrl = rawDataUrl; // verkleinen mislukt? gebruik dan gewoon de originele foto
      }
      try {
        await processImage(dataUrl, currentMode);
      } catch (err) {
        setError("Kon de gekozen foto niet verwerken.");
        setScreen("home");
      } finally {
        e.target.value = "";
      }
    };
    reader.onerror = () => {
      setError("Kon het bestand niet lezen vanaf het apparaat.");
      setScreen("home");
      e.target.value = "";
    };
    reader.readAsDataURL(file);
  };
  
  const processImage = async (dataUrl, mode) => {
    setError("");
    setShowErrorDetails(false);
    setScreen("loading");
    setLoadingMsg("Analyseren...");
    const base64 = dataUrl.split(",")[1];

    if (mode === "safari") {
      try {
        if (!keys.gemini) throw new Error("Gemini API-sleutel ontbreekt.");
        const missieList = getMissieList(safariOmgeving, keys.customMissions);
        const missie = missieList[safariOpdracht];
        const res = await callGemini(base64, keys.gemini, `Safari scheidsrechter. Missie: "${missie}". Staat dit op de foto? JSON: {"gevonden":true/false,"uitleg":"Tip of compliment."}`);
        if (res.gevonden) {
          setSafariStickers((s) => s + 1);
          setSafariBericht(`🎉 ${res.uitleg}`);
          setSafariOpdracht(pickNextMissionIndex(missieList, safariOpdracht, safariOmgeving));
        } else {
          setSafariBericht(`🤔 ${res.uitleg}`);
        }
        setTimeout(() => setSafariBericht(""), 5000);
      } catch (err) {
        setError("Safari controle mislukt.");
      }
      setScanMode("general");
      setScreen("safari");
      return;
    }

    if (mode === "animal") {
      try {
        if (!keys.gemini) throw new Error("Gemini API-sleutel ontbreekt.");
        const res = await callGemini(base64, keys.gemini, `Bioloog. Identificeer dit dier of insect, EN beoordeel meteen hoe het dier er op de foto bij lijkt te staan (zichtbare verwondingen, ziektetekens, uitputting, of gewoon gezond) EN geef een korte praktische verzorgings-/omgangstip (bv. wat te doen als je dit dier tegenkomt, hoe ermee om te gaan, of wanneer hulp van een volwassene/dierenarts nodig is). JSON: {"name":"Naam","scientificName":"Wetenschappelijk","klasse":"Klasse","familie":"Familie","leefgebied":"Habitat","leeftijd":"Schatting leeftijd","weetje":"Leuk weetje.","gezond":true/false,"gezondheidsopmerking":"Wat je ziet aan de gezondheid/toestand van het dier op de foto.","verzorgingstip":"Praktisch advies over verzorging/omgang met dit dier."}`);
        const entry = { id: Date.now(), date: new Date().toLocaleDateString("nl-BE"), image: dataUrl, type: "animal", score: 100, source: "Gemini AI", ...res };
        setHistory(saveHistory([entry, ...history]));
        setResult(entry);
        setScreen("result");
      } catch (err) {
        setError("Dier niet herkend: " + err.message);
        setScreen("home");
      }
      setScanMode("general");
      return;
    }

    try {
      const plantData = await identifyPlant(base64);
      const entry = { id: Date.now(), date: new Date().toLocaleDateString("nl-BE"), image: dataUrl, type: "plant", lastWatered: Date.now(), ...plantData };
      setHistory(saveHistory([entry, ...history]));
      setResult(entry);
      setScreen("result");
    } catch (err) {
      setError("Plant niet herkend: " + err.message);
      setScreen("home");
    }
  };

  // ===== VOORLEZEN: automatisch voorlezen als de schakelaar aan staat =====
  const berichtRef = useRef("");
  berichtRef.current = safariBericht;
  const huidigeMissie = safariOmgeving ? getMissieList(safariOmgeving, keys.customMissions)[safariOpdracht] || "" : "";
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!SPEECH_OK) return;
    const f = () => setVoiceTick((x) => x + 1);
    try { window.speechSynthesis.addEventListener?.("voiceschanged", f); } catch (e) {}
    return () => { try { window.speechSynthesis.removeEventListener?.("voiceschanged", f); } catch (e) {} };
  }, []);
  useEffect(() => { stopSpeaking(); }, [screen]);
  useEffect(() => {
    SPEECH_RATE = tempo === "langzaam" ? 0.7 : 0.9;
    try { localStorage.setItem("natuurscanner_voorleestempo", tempo); } catch (e) {}
  }, [tempo]);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => {
    try { localStorage.setItem("natuurscanner_voorlezen", voorlezen ? "1" : "0"); } catch (e) {}
    if (!voorlezen) stopSpeaking();
  }, [voorlezen]);
  useEffect(() => {
    if (voorlezen && screen === "safari" && safariOmgeving && !berichtRef.current && huidigeMissie) speak("Jouw missie: " + huidigeMissie);
  }, [voorlezen, screen, safariOmgeving, safariOpdracht]);
  useEffect(() => {
    if (voorlezen && safariBericht) speak(safariBericht + (safariBericht.startsWith("🎉") && huidigeMissie ? " Nieuwe missie: " + huidigeMissie : ""));
  }, [safariBericht]);
  useEffect(() => {
    if (voorlezen && screen === "quiz" && currentQuizQuestions.length > 0) speak(quizText(currentQuizQuestions[quizIndex]));
  }, [voorlezen, screen, quizIndex, currentQuizQuestions]);
  useEffect(() => {
    if (!voorlezen || screen !== "quiz" || quizAnswered === null || !currentQuizQuestions[quizIndex]) return;
    const q = currentQuizQuestions[quizIndex];
    speak(quizAnswered === q.correct ? "Goed zo! Dat is juist." : `Helaas. Het juiste antwoord is: ${q.opts[q.correct]}.`);
  }, [quizAnswered]);
  useEffect(() => {
    if (voorlezen && screen === "result" && result) speak(resultText({ ...result, __kids: kidsMode }));
  }, [voorlezen, screen, result]);
  useEffect(() => {
    if (!voorlezen) return;
    if (screen === "diploma") speak("Gefeliciteerd! Jij hebt het officiële Natuur Ontdekker Diploma behaald!");
    if (screen === "quizResult") speak(`Je score is ${quizScore} op ${currentQuizQuestions.length}. ` + (quizScore / currentQuizQuestions.length >= 0.6 ? "Geniaal, echte Natuur Ontdekker!" : "Goed gedaan, blijf oefenen!"));
  }, [voorlezen, screen]);
  useEffect(() => {
    if (voorlezen && screen === "home" && error) speak(friendlyErrorMessage(error));
  }, [voorlezen, screen, error]);
  useEffect(() => {
    if (voorlezen && screen === "loading" && loadingMsg) speak(loadingMsg);
  }, [voorlezen, screen, loadingMsg]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const startQuiz = (niveauKeuze) => {
    const gekozenNiveau = niveauKeuze || quizNiveau;
    setQuizNiveau(gekozenNiveau);
    const pool =
      gekozenNiveau === "gemengd"
        ? ALL_QUIZ_QUESTIONS
        : ALL_QUIZ_QUESTIONS.filter((q) => q.niveau === gekozenNiveau);
    const aantal = Math.min(10, pool.length);
    // Eerst vragen die nog niet gesteld zijn; pas als die op zijn, beginnen we opnieuw voor dit niveau.
    let seen = loadSeen(QUIZ_SEEN_KEY);
    let picked = shuffleArray(pool.filter((q) => !seen.includes(q.q))).slice(0, aantal);
    if (picked.length < aantal) {
      const rest = shuffleArray(pool.filter((q) => !picked.includes(q)));
      picked = [...picked, ...rest.slice(0, aantal - picked.length)];
      seen = seen.filter((t) => !pool.some((q) => q.q === t));
    }
    saveSeen(QUIZ_SEEN_KEY, [...seen, ...picked.map((q) => q.q)]);
    const shuffled = shuffleArray(picked).map(shuffleOptions);
    setCurrentQuizQuestions(shuffled);
    setQuizIndex(0);
    setQuizScore(0);
    setQuizAnswered(null);
    setScreen("quiz");
  };

  const handleQuizAnswer = (i) => {
    if (quizAnswered !== null) return;
    setQuizAnswered(i);
    const isCorrect = i === currentQuizQuestions[quizIndex].correct;
    if (isCorrect) setQuizScore((s) => s + 1);

    setTimeout(() => {
      if (quizIndex + 1 >= currentQuizQuestions.length) {
        if ((quizScore + (isCorrect ? 1 : 0)) / currentQuizQuestions.length >= 0.8) setScreen("diploma");
        else setScreen("quizResult");
      } else {
        setQuizIndex((idx) => idx + 1);
        setQuizAnswered(null);
      }
    }, voorlezen ? 4500 : 1500);
  };

  const verwijderUitGeschiedenis = (id) => {
    if (window.confirm("Weet je zeker dat je deze scan wilt verwijderen?")) {
      const updated = history.filter((item) => item.id !== id);
      setHistory(updated);
      localStorage.setItem(LS_KEYS.history, JSON.stringify(updated));
    }
  };

  const addCustomMission = () => {
    if (!newMissionInput.trim()) return;
    const updatedMissions = [...keys.customMissions, newMissionInput.trim()];
    const updatedKeys = { ...keys, customMissions: updatedMissions };
    setKeys(updatedKeys);
    saveKeys(updatedKeys);
    setNewMissionInput("");
  };

  const removeCustomMission = (index) => {
    const updatedMissions = keys.customMissions.filter((_, i) => i !== index);
    const updatedKeys = { ...keys, customMissions: updatedMissions };
    setKeys(updatedKeys);
    saveKeys(updatedKeys);
  };

  async function callGemini(base64, apiKey, prompt, timeoutMs = 35000) {
    if (!apiKey) throw new Error("Geen Gemini API sleutel ingesteld.");

    const maxAttempts = 2; // 1 poging + 1 automatische herkansing bij tijdelijke drukte
    let lastErr;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logApiCall(keys.firebaseUrl);
      let res;
      try {
        res = await fetchWithTimeout(`https://summer-snowflake-d2dc.yoericeulemans.workers.dev/gemini?api-key=${apiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64, prompt }),
        }, timeoutMs);
      } catch (e) {
        lastErr = e.name === "AbortError"
          ? new Error(`Gemini antwoordde niet binnen ${Math.round(timeoutMs / 1000)}s.`)
          : new Error(`Gemini niet bereikbaar: ${e.message}`);
        if (attempt < maxAttempts) {
          setLoadingMsg("Verbinding mislukt, nieuwe poging...");
          await new Promise((r) => setTimeout(r, 1500));
        }
        continue;
      }

      if (!res.ok) {
        let detail = "";
        try { detail = (await res.text()).slice(0, 150); } catch (e) {}
        lastErr = new Error(`API Fout (${res.status})${detail ? ": " + detail : ""}`);
        // 503 (te druk) en 429 (rate limit) zijn meestal tijdelijk — Google raadt
        // zelf aan het gewoon nog eens te proberen. Eén keer opnieuw na 2,5s.
        if ((res.status === 503 || res.status === 429) && attempt < maxAttempts) {
          setLoadingMsg("Gemini heeft het even druk, nieuwe poging...");
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        throw lastErr;
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      return JSON.parse(rawText.replace(/```json/gi, "").replace(/```/g, "").trim());
    }

    throw lastErr;
  }

  async function identifyPlant(base64) {
    const { plantId, plantNet, gemini } = keys;

    // Alle beschikbare bronnen worden nu TEGELIJK aangeroepen in plaats van
    // na elkaar (was: Plant.id → wachten → PlantNet → wachten → Gemini
    // → wachten → nóg een Gemini-aanroep voor verzorging/gezondheid).
    // Dat gebeurt nu allemaal parallel, wat de scan meestal een stuk
    // sneller maakt. Let op: hierdoor wordt de Gemini-aanroep voortaan ook
    // gedaan wanneer Plant.id/PlantNet al meteen een resultaat gaven (voorheen
    // gebeurde dat soms niet) — dat kost dus af en toe één extra Gemini-call
    // uit je dagelijkse quota, in ruil voor een veel snellere analyse.
    setLoadingMsg("Analyseren (alle bronnen tegelijk)...");

    const errors = [];

    const plantIdPromise = plantId
      ? fetchWithTimeout(`https://plant.id/api/v3/identification?api-key=${plantId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            images: [`data:image/jpeg;base64,${base64}`],
            similar_images: true,
            health: "auto",
          }),
        }, 13000)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .catch((e) => {
            errors.push(`Plant.id: ${e.name === "AbortError" ? "geen antwoord binnen 13s" : e.message}`);
            return null;
          })
      : Promise.resolve(null);

    const plantNetPromise = plantNet
      ? (async () => {
          const blob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
          const form = new FormData();
          form.append("images", blob);
          form.append("organs", "auto");
          const netRes = await fetchWithTimeout(`https://my-api.plantnet.org/v2/identify/all?api-key=${plantNet}`, { method: "POST", body: form }, 13000);
          if (!netRes.ok) throw new Error(`HTTP ${netRes.status}`);
          return netRes.json();
        })().catch((e) => {
          errors.push(`PlantNet: ${e.name === "AbortError" ? "geen antwoord binnen 13s" : e.message}`);
          return null;
        })
      : Promise.resolve(null);

    const geminiPromise = gemini
      ? callGemini(
          base64,
          gemini,
          `Je bent een plantenexpert. Identificeer deze plant EN geef meteen verzorgingsadvies EN een gezondheidscheck EN een giftigheidscheck. Antwoord in eenvoudig Nederlands. JSON: {"name":"Naam","gezond":true/false,"ziekte":"","oorzaak":"","oplossing":"","light":"","soil":"","freq":"","amount":"","tip":"","giftig":{"mens":"niet|licht|matig|sterk|onbekend","dier":"niet|licht|matig|sterk|onbekend","delen":"welke delen giftig zijn","symptomen":"mogelijke klachten, kort","omgang":"hoe ga je ermee om, bv. handschoenen of handen wassen"}} Bij giftig: dier betekent katten en honden. Weet je het niet zeker, antwoord onbekend. Gok nooit.`,
          35000
        ).catch((e) => {
          errors.push(`Gemini: ${e.message}`);
          return null;
        })
      : Promise.resolve(null);

    const [idData, netData, gRes] = await Promise.all([plantIdPromise, plantNetPromise, geminiPromise]);

    let plantName = "";
    let score = 0;
    let source = "";
    let careData = getWaterInfoFallback();
    let healthData = { isHealthy: true, diseaseName: "", note: "", solution: "" };

    const sug = idData?.result?.classification?.suggestions?.[0];
    if (sug) {
      plantName = sug.name;
      score = Math.round((sug.probability || 0) * 100);
      source = "Plant.id";
      const diseaseInfo = idData.result?.disease;
      if (diseaseInfo) {
        const isHealthy = !!diseaseInfo.is_healthy?.binary;
        const topDisease = diseaseInfo.disease?.suggestions?.[0];
        healthData = {
          isHealthy,
          diseaseName: isHealthy ? "" : topDisease?.name || "",
          note: isHealthy ? "" : topDisease?.details?.description || "",
          solution: isHealthy ? "" : topDisease?.details?.treatment?.biological?.[0] || "",
        };
      }
    }

    if (!plantName) {
      const b = netData?.results?.[0];
      if (b) {
        plantName = b.species?.scientificNameWithoutAuthor || b.species?.commonNames?.[0];
        score = Math.round((b.score || 0) * 100);
        source = "PlantNet";
      }
    }

    if (gRes) {
      // Naam van Gemini enkel gebruiken als Plant.id/PlantNet niets vonden
      if (!plantName) {
        plantName = gRes.name;
        score = 100;
        source = "Gemini AI";
      }
      // Verzorgingsadvies komt altijd van Gemini (enige bron die dit levert)
      careData = {
        light: gRes.light || careData.light,
        soil: gRes.soil || careData.soil,
        freq: gRes.freq || careData.freq,
        amount: gRes.amount || careData.amount,
        tip: gRes.tip || careData.tip,
      };
      // Gezondheidsdata van Gemini enkel gebruiken als Plant.id nog geen ziektedata gaf
      if (!idData?.result?.disease) {
        healthData = {
          isHealthy: gRes.gezond,
          diseaseName: gRes.ziekte || "",
          note: gRes.oorzaak || "",
          solution: gRes.oplossing || "",
        };
      }
    }

    if (!plantName) {
      const detail = errors.length ? " — " + errors.join(" · ") : " (geen enkele sleutel ingesteld of alle bronnen gaven niets terug)";
      throw new Error("Geen plant gevonden." + detail);
    }

    return { name: plantName, score, source, ...careData, health: healthData, giftigheid: normGift(gRes && gRes.giftig) };
  }

  const t = kidsMode ? ks : s;

  return (
    <div style={t.screen}>
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* CAMERA SCREEN */}
      {screen === "camera" && (
        <div style={{ ...s.screen, padding: 0, position: "relative", background: "#000" }}>
          {cameraError ? (
            <div style={{ ...s.screen, alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 15 }}>📷</div>
              <div style={{ fontSize: 18, marginBottom: 25, color: "#fff", fontWeight: 600 }}>{cameraError}</div>
              
              <label style={{ ...t.bigButton, background: "#2ecc71", width: "100%", display: "flex", justifyContent: "center", alignItems: "center", cursor: "pointer" }}>
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFileChange(e, scanMode)} />
                🖼️ Kies foto uit galerij
              </label>

              <button style={{ ...t.ghostButton, color: "#fff", width: "100%", marginTop: 10 }} onClick={closeCamera}>← Terug</button>
            </div>
          ) : (
            <>
              <video ref={videoRef} playsInline autoPlay muted style={{ width: "100%", height: "100vh", objectFit: "cover", transform: !zoomSupported && zoomLevel > 1 ? `scale(${zoomLevel})` : "none", transition: "transform 0.1s linear" }} />
              {torchSupported && (
                <button onClick={toggleTorch} style={{ position: "absolute", top: 30, right: 20, background: torchOn ? "#f1c40f" : "rgba(0,0,0,0.6)", color: "#fff", borderRadius: "50%", width: 55, height: 55, fontSize: 26, cursor: "pointer", border: "none" }}>
                  {torchOn ? "🔦" : "💡"}
                </button>
              )}
              {zoomRange.max > zoomRange.min && (
                <div style={{ position: "absolute", bottom: 150, left: 40, right: 40, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>🔍</span>
                  <input
                    type="range"
                    min={zoomRange.min}
                    max={zoomRange.max}
                    step={zoomRange.step}
                    value={zoomLevel}
                    onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, textShadow: "0 1px 3px rgba(0,0,0,0.8)", minWidth: 34 }}>{zoomLevel.toFixed(1)}x</span>
                </div>
              )}
              <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 30 }}>
                <button onClick={closeCamera} style={{ background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: 16, padding: "14px 20px", border: "none", cursor: "pointer" }}>✕</button>
                <button onClick={capturePhoto} style={{ width: 80, height: 80, borderRadius: "50%", background: "#fff", border: "6px solid #2ecc71", cursor: "pointer" }} />
              </div>
            </>
          )}
        </div>
      )}

      {/* HOME SCREEN */}
      {screen === "home" && (
        <>
          <div style={t.topBar}>
            <button style={t.iconBtn} onClick={() => setKidsMode(!kidsMode)}>{kidsMode ? "🧒 Aan" : "🧒 Uit"}</button>
            {SPEECH_OK && <button style={t.iconBtn} onClick={() => { const nv = !voorlezen; setVoorlezen(nv); if (nv) speak("Voorlezen staat aan."); else stopSpeaking(); }}>{voorlezen ? "🔊 Aan" : "🔇 Uit"}</button>}
            {SPEECH_OK && voorlezen && <button style={t.iconBtn} onClick={() => { const nt = tempo === "langzaam" ? "normaal" : "langzaam"; SPEECH_RATE = nt === "langzaam" ? 0.7 : 0.9; setTempo(nt); speak(nt === "langzaam" ? "Ik praat nu langzaam." : "Ik praat nu normaal."); }}>{tempo === "langzaam" ? "🐢 Traag" : "🐇 Normaal"}</button>}
            {SPEECH_OK && voorlezen && voiceTick >= 0 && nlVoices().length >= 2 && (() => {
              const list = nlVoices(); const cur = pickVoice(); const idx = Math.max(0, list.findIndex((v) => cur && v.name === cur.name));
              return <button style={t.iconBtn} onClick={() => { const ni = (idx + 1) % list.length; SPEECH_VOICE_NAME = list[ni].name; try { localStorage.setItem("natuurscanner_stem", SPEECH_VOICE_NAME); } catch (e) {} setVoiceTick((x) => x + 1); speak(`Stem ${ni + 1} van ${list.length}. Zo klink ik nu.`); }}>🗣️ Stem {idx + 1}/{list.length}</button>;
            })()}
            <div style={{ background: "rgba(0,0,0,0.2)", padding: "8px 12px", borderRadius: "16px", fontSize: "14px", fontWeight: "bold", color: liveApiUsage >= 15 ? "#ff6b6b" : "#2ecc71" }}>📊 {liveApiUsage}/15</div>
            <button style={t.iconBtn} onClick={() => { setPinInput(""); setPinError(""); setScreen(settingsUnlocked ? "keys" : "pinGate"); }}>⚙️ Instellingen</button>
          </div>

          {error && (
            <div style={{ background: "rgba(231, 76, 60, 0.9)", color: "#fff", padding: "16px", borderRadius: "16px", marginBottom: "20px", textAlign: "center", fontWeight: "bold" }}>
              <div>⚠️ {friendlyErrorMessage(error)}</div>
              <VoorleesKnop text={friendlyErrorMessage(error)} label="Lees voor" />
              <button
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: 400, textDecoration: "underline", cursor: "pointer", marginTop: 8, padding: 0 }}
              >
                {showErrorDetails ? "Verberg technische details" : "Technische details (voor de leerkracht)"}
              </button>
              {showErrorDetails && (
                <div style={{ fontSize: 12, fontWeight: 400, marginTop: 8, opacity: 0.85, textAlign: "left", wordBreak: "break-word" }}>{error}</div>
              )}
            </div>
          )}

          <div style={t.title}>{kidsMode ? "🌿 NatuurScanner" : "🌿 PlantScanner"}</div>
          <div style={t.subtitle}>{kidsMode ? "Ontdek en leer over de natuur!" : "Identificeer planten en dieren."}</div>

          <button style={t.bigButton} onClick={() => openCamera("general")}>🌱 Scan Plant (Camera)</button>
          <button style={{ ...t.bigButton, background: "linear-gradient(135deg, #3498db 0%, #2980b9 100%)" }} onClick={() => openCamera("animal")}>🦋 Scan Dier (Camera)</button>

          <div style={{ display: "flex", gap: "12px", marginBottom: 12 }}>
            <label style={{ ...t.ghostButton, flex: 1, marginBottom: 0, background: "rgba(46, 204, 113, 0.15)", color: "#a8e6cf", display: "flex", justifyContent: "center", alignItems: "center", cursor: "pointer" }}>
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFileChange(e, "general")} />
              🖼️ Upload Plant
            </label>
            <label style={{ ...t.ghostButton, flex: 1, marginBottom: 0, background: "rgba(52, 152, 219, 0.15)", color: "#a9cce3", display: "flex", justifyContent: "center", alignItems: "center", cursor: "pointer" }}>
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFileChange(e, "animal")} />
              🖼️ Upload Dier
            </label>
          </div>

          {kidsMode && (
            <button style={{ ...t.bigButton, background: "linear-gradient(135deg, #e67e22 0%, #d35400 100%)", marginTop: 12 }} onClick={() => {
              setSafariOmgeving(null);
              setSafariBericht("");
              setScreen("safari");
            }}>
              🧭 Start Natuur Safari!
            </button>
          )}

          <button style={{ ...t.ghostButton, marginTop: 10 }} onClick={() => setScreen("history")}>📸 Geschiedenis ({history.length})</button>
          {kidsMode && (
            <button style={{ ...t.ghostButton, color: "#f1c40f" }} onClick={() => setScreen("quizNiveau")}>🎯 Start Natuur Quiz</button>
          )}
        </>
      )}

      {/* RESULT SCREEN */}
      {screen === "result" && result && (
        <>
          <button style={t.backLink} onClick={() => setScreen("home")}>← Terug</button>
          <img src={result.image} alt="scan" style={t.resultImg} />
          <div style={t.title}>{result.name}</div>
          <div style={t.subtitle}>{result.source} · {result.score}% zekerheid</div>
          <div style={{ textAlign: "center", marginBottom: 16 }}><VoorleesKnop text={resultText({ ...result, __kids: kidsMode })} label="Lees alles voor" /></div>

          {result.type === "animal" ? (
            <>
              <div style={t.card}>
                <div style={{ fontWeight: 800, marginBottom: 10, color: "#a8e6cf", fontSize: 18 }}>🧬 Info</div>
                <div style={{ fontSize: 15, lineHeight: "1.8" }}>
                  {result.scientificName && <div><strong>🔬 Wetenschappelijke naam:</strong> {result.scientificName}</div>}
                  {result.klasse && <div><strong>🧩 Klasse:</strong> {result.klasse}</div>}
                  {result.familie && <div><strong>🌳 Familie:</strong> {result.familie}</div>}
                  {result.leefgebied && <div><strong>🏞️ Leefgebied:</strong> {result.leefgebied}</div>}
                  {result.leeftijd && <div><strong>⏳ Geschatte leeftijd:</strong> {result.leeftijd}</div>}
                </div>
              </div>
              {result.weetje && (
                <div style={{ ...t.card, background: "rgba(241, 196, 15, 0.15)" }}>
                  <div style={{ fontWeight: 800, marginBottom: 6, color: "#f1c40f" }}>💡 Leuk weetje</div>
                  <div style={{ fontSize: 15 }}>{result.weetje}</div>
                </div>
              )}
              {typeof result.gezond !== "undefined" && (
                <div style={{ ...t.card, borderLeft: result.gezond === false ? "6px solid #e74c3c" : "6px solid #2ecc71" }}>
                  <div style={{ fontWeight: 800, marginBottom: 10, color: "#a8e6cf", fontSize: 18 }}>
                    {result.gezond === false ? "🩺 Gezondheidscheck: Let op" : "✅ Gezondheidscheck: Lijkt gezond"}
                  </div>
                  <div style={{ fontSize: 15 }}>{result.gezondheidsopmerking || (result.gezond === false ? "Er lijkt iets niet in orde te zijn." : "Geen zichtbare verwondingen of ziektetekens op de foto.")}</div>
                </div>
              )}
              {result.verzorgingstip && (
                <div style={t.card}>
                  <div style={{ fontWeight: 800, marginBottom: 10, color: "#a8e6cf", fontSize: 18 }}>🧑‍⚕️ Verzorging & Omgang</div>
                  <div style={{ fontSize: 15 }}>{result.verzorgingstip}</div>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={t.card}>
                <div style={{ fontWeight: 800, marginBottom: 10, color: "#a8e6cf", fontSize: 18 }}>🔎 Plant & Groei Info</div>
                <div style={{ fontSize: 15, lineHeight: "1.6" }}><strong>☀️ Zonlicht:</strong> {result.light}<br /><strong>🌱 Bodem:</strong> {result.soil}</div>
              </div>

              <div style={{ ...t.card, borderLeft: (result.health && result.health.isHealthy === false) ? "6px solid #e74c3c" : "6px solid #2ecc71" }}>
                <div style={{ fontWeight: 800, marginBottom: 10, color: "#a8e6cf", fontSize: 18 }}>
                  {(result.health && result.health.isHealthy === false) ? "🩺 Gezondheidscheck: Let op" : "✅ Gezondheidscheck: Gezond"}
                </div>
                {(result.health && result.health.isHealthy === false) ? (
                  <div style={{ fontSize: 15, lineHeight: "1.6" }}>
                    {result.health.diseaseName && <div><strong>🦠 Probleem:</strong> {result.health.diseaseName}</div>}
                    {result.health.note && <div style={{ marginTop: 6 }}><strong>ℹ️ Oorzaak:</strong> {result.health.note}</div>}
                    {result.health.solution && <div style={{ marginTop: 6 }}><strong>🛠️ Oplossing:</strong> {result.health.solution}</div>}
                  </div>
                ) : (
                  <div style={{ fontSize: 15 }}>Deze plant lijkt gezond! Geen ziektes of problemen gevonden op de foto.</div>
                )}
              </div>

              <GiftigKaart g={result.giftigheid} kids={kidsMode} cardStyle={t.card} />

              <div style={t.card}>
                <div style={{ fontWeight: 800, marginBottom: 12, color: "#a8e6cf", fontSize: 18 }}>💧 Water Schema</div>
                <div style={{ fontSize: 17, fontWeight: "bold", color: "#64b5f6", marginBottom: 6 }}>⏱️ {result.freq}</div>
                <div style={{ fontSize: 15, marginBottom: 16 }}>💧 {result.amount}</div>
                <div style={{ fontSize: 14, background: "rgba(241, 196, 15, 0.15)", padding: 12, borderRadius: 12 }}><strong>💡 Tip:</strong> {result.tip}</div>
              </div>
            </>
          )}
        </>
      )}

      {/* DIPLOMA SCREEN */}
      {screen === "diploma" && (
        <div style={{ ...t.screen, alignItems: "center", justifyContent: "center", textAlign: "center", background: "linear-gradient(135deg, #f1c40f 0%, #e67e22 100%)" }}>
          <div style={{ fontSize: 80, marginBottom: 20 }}>🎓</div>
          <h1 style={{ color: "#fff", fontSize: 36, margin: "0 0 10px 0" }}>GEFELICITEERD!</h1>
          <p style={{ fontSize: 18, color: "#fff", fontWeight: "bold" }}>Jij hebt het officiële Natuur Ontdekker Diploma behaald!</p>
          <button style={{ ...t.bigButton, background: "#fff", color: "#d35400", width: "100%", maxWidth: "320px", marginTop: 20 }} onClick={() => setScreen("home")}>Verder Spelen</button>
        </div>
      )}

      {/* SAFARI SCREEN */}
      {screen === "safari" && (
        <>
          <button style={t.backLink} onClick={() => { setScreen("home"); setSafariOmgeving(null); }}>← Menu</button>
          {!safariOmgeving ? (
            <div style={{ ...t.card, textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🧭</div>
              <h3 style={{ color: "#fff", marginTop: 0, fontSize: "26px" }}>Kies je missiegebied!</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px" }}>
                {Object.keys(SAFARI_MISSIES).map((omg, i) => (
                  <button key={omg} onClick={() => { setSafariOmgeving(omg); setSafariOpdracht(pickNextMissionIndex(SAFARI_MISSIES[omg], -1, omg)); }} style={{ backgroundColor: KIDS_COLORS[i % 6], color: "#fff", padding: "16px", border: "none", borderRadius: "16px", fontSize: "17px", fontWeight: "bold", cursor: "pointer", textTransform: "capitalize" }}>
                    {omg}
                  </button>
                ))}
                {keys.customMissions.length > 0 && (
                  <button
                    key="leerkracht"
                    onClick={() => { setSafariOmgeving("leerkracht"); setSafariOpdracht(pickNextMissionIndex(keys.customMissions, -1, "leerkracht")); }}
                    style={{ gridColumn: "1 / -1", backgroundColor: "#f1c40f", color: "#3d3300", padding: "16px", border: "none", borderRadius: "16px", fontSize: "17px", fontWeight: "800", cursor: "pointer" }}
                  >
                    🌟 Gouden Knop: Missies van de Juf/Meester!
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ ...t.card, textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                <h3 style={{ color: "#fff", margin: 0, fontSize: "22px" }}>Safari Missie</h3>
                <button onClick={() => setSafariOmgeving(null)} style={{ background: "rgba(255,255,255,0.1)", color: "#fff", borderRadius: "14px", padding: "8px 12px", border: "none", cursor: "pointer" }}>Wissel</button>
              </div>
              <div style={{ backgroundColor: "rgba(255,255,255,0.1)", padding: "24px", borderRadius: "20px", marginBottom: "24px" }}>
                <p style={{ fontSize: "22px", fontWeight: "bold", color: "#fff", margin: 0 }}>{huidigeMissie}</p>
                <VoorleesKnop text={"Jouw missie: " + huidigeMissie} label="Lees voor" />
              </div>
              <p style={{ fontSize: "24px", margin: "20px 0", color: "#f1c40f", fontWeight: "800" }}>⭐ {safariStickers} Sterren</p>
              {safariBericht && <div style={{ color: "#fff", fontWeight: "bold", fontSize: "16px", backgroundColor: "rgba(231, 76, 60, 0.4)", padding: "14px", borderRadius: "16px", marginBottom: 20 }}>{safariBericht}</div>}
              <button onClick={() => openCamera("safari")} style={{ backgroundColor: KIDS_COLORS[2], color: "#fff", padding: "20px", border: "none", borderRadius: "20px", fontSize: "20px", fontWeight: "800", width: "100%", cursor: "pointer" }}>📷 Scan & Controleer!</button>
              <button
                onClick={() => {
                  const list = getMissieList(safariOmgeving, keys.customMissions);
                  setSafariBericht("");
                  setSafariOpdracht(pickNextMissionIndex(list, safariOpdracht, safariOmgeving));
                }}
                style={{ background: "rgba(255,255,255,0.1)", color: "#fff", padding: "14px", border: "none", borderRadius: "16px", fontSize: "15px", fontWeight: "700", width: "100%", cursor: "pointer", marginTop: 12 }}
              >
                ⏭️ Andere missie
              </button>
            </div>
          )}
        </>
      )}

      {/* PIN GATE */}
      {screen === "pinGate" && (
        <div style={{ ...s.screen, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={s.title}>Instellingen vergrendeld</div>
          <div style={{ ...s.subtitle, marginBottom: 20 }}>Vraag de leerkracht om de PIN-code in te voeren</div>
          <input
            style={{ ...s.input, textAlign: "center", fontSize: 24, letterSpacing: 4, maxWidth: 240 }}
            type="password"
            inputMode="numeric"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder="••••"
          />
          {pinError && <div style={{ color: "#ff6b6b", marginBottom: 12 }}>{pinError}</div>}
          <button
            style={{ ...s.bigButton, maxWidth: 240 }}
            onClick={() => {
              if (pinInput === keys.teacherPin || pinInput === DEVELOPER_OVERRIDE_PIN) {
                setSettingsUnlocked(true);
                setPinError("");
                setScreen("keys");
              } else {
                setPinError("Onjuiste PIN-code, probeer opnieuw.");
              }
              setPinInput("");
            }}
          >
            Ontgrendel
          </button>
          <button style={{ ...s.ghostButton, maxWidth: 240 }} onClick={() => setScreen("home")}>← Menu</button>
        </div>
      )}

      {/* SETTINGS */}
      {screen === "keys" && (
        <>
          <button style={s.backLink} onClick={() => setScreen("home")}>← Menu</button>
          <div style={s.title}>⚙️ Instellingen</div>
          
          <div style={s.card}>
            <div style={{ fontWeight: 800, marginBottom: 16, color: "#f1c40f" }}>🏫 Leerkracht Missies</div>
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
              <input style={{ ...s.input, marginBottom: 0 }} value={newMissionInput} onChange={(e) => setNewMissionInput(e.target.value)} placeholder="Bv. Zoek een eikel" />
              <button style={{ ...s.bigButton, marginBottom: 0, padding: "12px 16px", width: "auto" }} onClick={addCustomMission}>➕</button>
            </div>
            {keys.customMissions && keys.customMissions.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.08)", padding: "12px", borderRadius: "12px", marginBottom: "8px" }}>
                <span>{m}</span>
                <button onClick={() => removeCustomMission(i)} style={{ background: "transparent", border: "none", color: "#ff7675", fontSize: 18, cursor: "pointer" }}>✕</button>
              </div>
            ))}
          </div>

          <div style={s.card}>
            <div style={{ fontWeight: 800, marginBottom: 16, color: "#a8e6cf", fontSize: 18 }}>🔑 API Sleutels & Firebase</div>
            
            <label style={s.label}>Firebase Live URL (Klassikale meting)</label>
            <input style={s.input} value={keys.firebaseUrl} onChange={(e) => setKeys({ ...keys, firebaseUrl: e.target.value })} placeholder="https://..." />

            <label style={s.label}>Plant.id API</label>
            <input style={s.input} value={keys.plantId} onChange={(e) => setKeys({ ...keys, plantId: e.target.value })} />

            <label style={s.label}>PlantNet API</label>
            <input style={s.input} value={keys.plantNet} onChange={(e) => setKeys({ ...keys, plantNet: e.target.value })} />

            <label style={s.label}>Gemini API</label>
            <input style={s.input} value={keys.gemini} onChange={(e) => setKeys({ ...keys, gemini: e.target.value })} />
          </div>

          <div style={s.card}>
            <div style={{ fontWeight: 800, marginBottom: 16, color: "#ff9f43", fontSize: 18 }}>🔒 PIN-code Instellingen</div>
            <label style={s.label}>Nieuwe PIN-code (4 cijfers)</label>
            <input
              style={s.input}
              type="password"
              inputMode="numeric"
              value={keys.teacherPin}
              onChange={(e) => setKeys({ ...keys, teacherPin: e.target.value })}
              placeholder="1234"
            />
            <div style={{ fontSize: 13, opacity: 0.7 }}>Vergeten mag: de ontwikkelaarscode werkt altijd als noodtoegang.</div>
          </div>

          <button style={s.bigButton} onClick={() => { saveKeys(keys); setScreen("home"); }}>💾 Alles Opslaan</button>
        </>
      )}

      {/* LOADING */}
      {screen === "loading" && (
        <div style={{ ...t.screen, alignItems: "center", justifyContent: "center" }}>
          <style>{`
            @keyframes scannerPulse {
              0%, 100% { transform: scale(1) rotate(-6deg); }
              50% { transform: scale(1.15) rotate(6deg); }
            }
            @keyframes scannerDot {
              0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
              40% { opacity: 1; transform: translateY(-6px); }
            }
          `}</style>
          <div style={{ fontSize: 60, marginBottom: 24, animation: "scannerPulse 1.4s ease-in-out infinite" }}>🌱</div>
          <div style={{ fontSize: 18, color: "#fff", fontWeight: 600, textAlign: "center" }}>{loadingMsg}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: "#2ecc71", animation: "scannerDot 1.2s infinite ease-in-out", animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 20, textAlign: "center", maxWidth: 260 }}>
            Dit kan tot 30 seconden duren. Geen zorgen, de scanner is nog bezig! 🔎
          </div>
        </div>
      )}

      {/* HISTORY */}
      {screen === "history" && (
        <>
          <button style={t.backLink} onClick={() => setScreen("home")}>← Menu</button>
          <div style={t.title}>📸 Geschiedenis</div>
          {history.length === 0 && <div style={{ textAlign: "center", opacity: 0.6, marginTop: 20 }}>Nog niets gescand.</div>}
          {history.map((h) => (
            <div key={h.id} style={t.historyItem} onClick={() => { setResult(h); setScreen("result"); }}>
              <img src={h.image} alt={h.name} style={t.historyImg} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{h.name}</div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>{h.date}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); verwijderUitGeschiedenis(h.id); }} style={{ background: "rgba(231, 76, 60, 0.15)", border: "none", color: "#ff6b6b", borderRadius: "12px", padding: "10px", cursor: "pointer", fontSize: "18px" }}>🗑️</button>
            </div>
          ))}
        </>
      )}

      {/* QUIZ NIVEAU KEUZE */}
      {screen === "quizNiveau" && (
        <div style={{ ...t.card, textAlign: "center" }}>
          <button style={t.backLink} onClick={() => setScreen("home")}>← Menu</button>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
          <h3 style={{ color: "#fff", marginTop: 0, fontSize: "24px" }}>Kies je niveau!</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: 20 }}>
            <button onClick={() => startQuiz(1)} style={{ backgroundColor: "#2ecc71", color: "#fff", padding: "18px", border: "none", borderRadius: "18px", fontSize: "18px", fontWeight: "800", cursor: "pointer" }}>🟢 Makkelijk</button>
            <button onClick={() => startQuiz(2)} style={{ backgroundColor: "#f1c40f", color: "#fff", padding: "18px", border: "none", borderRadius: "18px", fontSize: "18px", fontWeight: "800", cursor: "pointer" }}>🟡 Gemiddeld</button>
            <button onClick={() => startQuiz(3)} style={{ backgroundColor: "#e74c3c", color: "#fff", padding: "18px", border: "none", borderRadius: "18px", fontSize: "18px", fontWeight: "800", cursor: "pointer" }}>🔴 Moeilijk</button>
            <button onClick={() => startQuiz("gemengd")} style={{ backgroundColor: "#9b59b6", color: "#fff", padding: "18px", border: "none", borderRadius: "18px", fontSize: "18px", fontWeight: "800", cursor: "pointer" }}>🌈 Gemengd (alle niveaus)</button>
          </div>
        </div>
      )}

      {/* QUIZ */}
      {screen === "quiz" && currentQuizQuestions.length > 0 && (
        <>
          <button style={t.backLink} onClick={() => setScreen("home")}>← Stoppen</button>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
            <div>Vraag {quizIndex + 1} / {currentQuizQuestions.length}</div>
            <div style={{ color: "#f1c40f", fontWeight: 700 }}>Score: {quizScore}</div>
          </div>
          <div style={{ ...t.card, marginBottom: 24 }}><div style={{ fontSize: 20, fontWeight: 800 }}>{currentQuizQuestions[quizIndex].q}</div><VoorleesKnop text={quizText(currentQuizQuestions[quizIndex])} label="Lees voor" /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {currentQuizQuestions[quizIndex].opts.map((opt, i) => {
              let bg = "rgba(255,255,255,0.1)", border = "1px solid rgba(255,255,255,0.2)", icon = "";
              if (quizAnswered !== null) {
                if (i === currentQuizQuestions[quizIndex].correct) { bg = "rgba(46, 204, 113, 0.2)"; border = "2px solid #2ecc71"; icon = " ✅"; }
                else if (i === quizAnswered) { bg = "rgba(231, 76, 60, 0.2)"; border = "2px solid #e74c3c"; icon = " ❌"; }
              }
              return (
                <button key={i} style={{ ...t.quizOpt, background: bg, border }} onClick={() => handleQuizAnswer(i)}>
                  <span>{opt}</span><span>{icon}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {screen === "quizResult" && (
        <div style={{ ...t.screen, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <div style={{ fontSize: 60, marginBottom: 20 }}>🏆</div>
          <div style={{ ...t.title, fontSize: 48 }}>{quizScore} / {currentQuizQuestions.length}</div>
          <p style={{ fontSize: "20px", fontWeight: 600, marginBottom: "20px" }}>{quizScore / currentQuizQuestions.length >= 0.6 ? "Geniaal, echte Natuur Ontdekker!" : "Goed gedaan, blijf oefenen!"}</p>
          <VoorleesKnop text={`Je score is ${quizScore} op ${currentQuizQuestions.length}.`} label="Lees voor" />
          <button style={{ ...t.bigButton, width: "100%" }} onClick={() => startQuiz(quizNiveau)}>🔁 Nog een keer</button>
          <button style={{ ...t.ghostButton, width: "100%" }} onClick={() => setScreen("home")}>← Menu</button>
        </div>
      )}
    </div>
  );
}