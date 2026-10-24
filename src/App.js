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
    const l = JSON.parse(localStorage.getItem(LS_KEYS.history));
    return Array.isArray(l) ? l.filter((x) => x && typeof x === "object").map(cleanEntry) : [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  // Geeft de lijst terug die ECHT is opgeslagen. Eerst valt telkens de oudste scan weg; blijft het te groot,
  // dan vallen er meer tegelijk weg. Kan er helemaal niets bewaard worden (opslag geblokkeerd), dan blijft de lijst
  // alleen in het geheugen staan zodat de scan tijdens dit bezoek zichtbaar blijft.
  let wList = list;
  for (let i = 0; ; i++) {
    try {
      localStorage.setItem(LS_KEYS.history, JSON.stringify(wList));
      return wList;
    } catch (e) {
      if (wList.length === 0) return list;
      const drop = i < 10 ? 1 : Math.max(1, Math.ceil(wList.length * 0.1));
      wList = wList.slice(0, Math.max(0, wList.length - drop));
    }
  }
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
  const compact = text.replace(/[\s_-]/g, "");
  if (compact.includes("perday") || compact.includes("dailylimit") || compact.includes("dagelijks")) {
    return "🌙 De scanner heeft voor vandaag genoeg gewerkt. Probeer het morgen opnieuw! (Volwassene: het dagelijkse limiet van Gemini is bereikt.)";
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
/* ============ SEIZOENSMISSIES ============ */
const SAFARI_SEIZOEN = {
  "lente": [
    "🌱 Zoek een boom of struik met knoppen of net uitgekomen blaadjes",
    "🌼 Vind een gele bloem, zoals een paardenbloem of speenkruid",
    "🐝 Zoek een bij of hommel op een bloem",
    "🦋 Zoek een vlinder in de lentezon",
    "🌸 Zoek een boom of struik met bloesem",
    "🐦 Vind een vogel die zingt of op een tak zit",
    "🐜 Zoek een mier of een rij mieren",
    "🌿 Vind een plantje dat net uit de grond komt",
    "🍃 Zoek heel jonge, lichtgroene blaadjes",
    "🌷 Zoek een bloem die in een bolletje onder de grond heeft gewacht, zoals een narcis of krokus",
    "🪲 Zoek een kriebelbeestje onder een steen of blad (zet alles weer netjes terug)",
    "🌳 Vind een boom en kijk goed naar zijn knoppen"
  ],
  "zomer": [
    "🐝 Zoek een bloem waar een bij of hommel op zit",
    "🦋 Zoek een vlinder in de zon",
    "🫐 Vind een plant met bessen of vruchtjes (kijken, niet eten!)",
    "🐞 Zoek een lieveheersbeestje of een ander klein kevertje",
    "🌳 Vind een plek in de schaduw onder een grote boom",
    "🌾 Zoek een grashalm met zaadjes of een pluizige zaadbol",
    "🕷️ Zoek een spin in haar web",
    "🦗 Zoek een sprinkhaan of krekel in het gras",
    "🌻 Vind een zonnebloem, roos of lavendel",
    "🐦 Zoek een zwaluw of mus in de lucht of op een draad",
    "☘️ Zoek een klaver of een plantje met drie blaadjes",
    "💧 Zoek een libel of waterjuffer bij het water (blijf op een veilige afstand van de rand)"
  ],
  "herfst": [
    "🍂 Zoek een gevallen blad in een mooie herfstkleur",
    "🌰 Vind een eikel, kastanje of beukennootje",
    "🍄 Zoek een paddenstoel (raak hem niet aan en eet hem nooit!)",
    "🐿️ Zoek een eekhoorn of een gaai die voedsel verzamelt",
    "🕸️ Vind een spinnenweb met dauwdruppels",
    "🌳 Zoek een boom die al bijna kale takken heeft",
    "🍒 Zoek bessen aan een struik (kijken, niet eten!)",
    "🐦 Zoek een roodborstje of een andere vogel in de tuin",
    "🍁 Zoek een hoop bladeren waar dieren zich kunnen verstoppen",
    "🌼 Zoek een plant die ondanks de herfst nog bloeit",
    "🐌 Zoek een slak op een vochtige plek",
    "🌲 Vind een dennenappel"
  ],
  "winter": [
    "🌳 Zoek een boom zonder blaadjes en bekijk zijn takken",
    "🌿 Vind een plant die in de winter groen blijft, zoals klimop of een den",
    "🐦 Zoek vogels die komen eten bij een voederplek",
    "🐾 Zoek sporen of pootafdrukken in de sneeuw of de modder",
    "🌱 Zoek een knop aan een tak die wacht tot de lente",
    "❄️ Zoek een sneeuwklokje, krokus of een andere vroege bloem",
    "🐦 Zoek een merel of roodborstje in de tuin",
    "🟢 Zoek mos op een boom of muur",
    "🧊 Zoek rijp of ijs op een plant (blijf altijd van bevroren water af!)",
    "🌲 Zoek een dennenappel of een eikel op de grond",
    "🪺 Zoek een vogelnest in een kale boom (kijk van ver en laat het met rust)",
    "🍃 Zoek een plantje dat zelfs in de winter groen blijft, zoals gras of mos"
  ]
};
const SEIZOEN_NAAM = { lente: "Lente", zomer: "Zomer", herfst: "Herfst", winter: "Winter" };
const SEIZOEN_ICOON = { lente: "🌷", zomer: "☀️", herfst: "🍂", winter: "❄️" };
function huidigSeizoen(d) {
  const m = (d instanceof Date ? d : new Date()).getMonth();   // 0 = januari
  return m >= 2 && m <= 4 ? "lente" : m >= 5 && m <= 7 ? "zomer" : m >= 8 && m <= 10 ? "herfst" : "winter";
}

function getMissieList(omgeving, customMissions) {
  if (omgeving === "leerkracht") return customMissions || [];
  if (omgeving === "seizoen") return SAFARI_SEIZOEN[huidigSeizoen()] || [];
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
const APP_VERSIE = "ontwikkel · v10.1";
// Alle keuzes voor de stem: de Nederlandse stemmen van het toestel + 2 "systeemstemmen" (de app dwingt dan geen stem af,
// het toestel kiest zelf de standaardstem voor nl-BE of nl-NL).
function stemOpties() {
  return [
    ...nlVoices().map((v) => ({ id: v.name, voice: v, lang: v.lang, label: v.name })),
    { id: "__sys_BE", voice: null, lang: "nl-BE", label: "systeemstem (nl-BE)" },
    { id: "__sys_NL", voice: null, lang: "nl-NL", label: "systeemstem (nl-NL)" },
  ];
}
function pickOption() {
  const opts = stemOpties();
  const gekozen = opts.find((o) => o.id === SPEECH_VOICE_NAME);
  if (gekozen) return gekozen;
  const eerste = opts[0];
  // Alleen een stem afdwingen als we zeker weten dat het een mannenstem is; anders kiest het toestel zelf.
  return eerste.voice && voiceScore(eerste.voice) >= 10 ? eerste : opts.find((o) => o.id === "__sys_BE");
}
function stemUitleg(o, ni, n, alle) {
  const lijst = alle.length ? alle.map((v) => v.name + " (" + v.lang + ")").join(", ") : "geen";
  return `Stem ${ni + 1} van ${n}: ${o.label}. Stemmen die dit toestel doorgeeft (${alle.length}): ${lijst}. Versie: ${APP_VERSIE}.${SPEECH_FOUT ? " Laatste stemfout: " + SPEECH_FOUT + "." : ""} Tip: voor meer keuze installeer je een andere Nederlandse stem of engine in Instellingen → Tekst-naar-spraak.`;
}
let SPEECH_ID = 0; // telt mee bij elke nieuwe spreekopdracht, zodat een oude herpoging een nieuwe tekst nooit overstemt
let SPEECH_FOUT = ""; // laatste stemfout van het toestel (komt in de uitleg van de Stem-knop)
function speak(text, poging) {
  if (!SPEECH_OK) return;
  const t = cleanForSpeech(text);
  if (!t) return;
  const n = poging || 0;
  const id = n === 0 ? ++SPEECH_ID : SPEECH_ID;
  try {
    const synth = window.speechSynthesis;
    const busy = synth.speaking || synth.pending;
    synth.cancel();
    const go = () => {
      if (id !== SPEECH_ID) return;
      try {
        const o = pickOption();
        // Poging 0: de gekozen stem. Poging 1: geen stem afdwingen, de andere taalvariant (nl-NL/nl-BE).
        // Poging 2: algemeen "nl". Zo blijft het voorlezen werken als een telefoon de gekozen stem stil weigert.
        const v = n === 0 ? o.voice : null;
        const taal = n === 0 ? o.lang : n === 1 ? (o.lang === "nl-BE" ? "nl-NL" : "nl-BE") : "nl";
        try { synth.resume(); } catch (e) {}
        let gestart = false; let herpoging = false;
        const volgende = () => {
          if (herpoging || gestart || id !== SPEECH_ID || n >= 2) return;
          herpoging = true;
          speak(t, n + 1);
        };
        // Zin per zin voorlezen: lange teksten blijven dan niet halverwege hangen.
        (t.match(/[^.!?]+[.!?]*/g) || [t]).forEach((part, i) => {
          const p = part.trim();
          if (!p) return;
          const u = new SpeechSynthesisUtterance(p);
          if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = taal; }
          u.rate = SPEECH_RATE;
          u.pitch = SPEECH_PITCH;
          if (i === 0) {
            u.onstart = () => { gestart = true; };
            u.onboundary = () => { gestart = true; };
            u.onerror = (ev) => {
              const fout = String((ev && ev.error) || "onbekend");
              if (fout === "canceled" || fout === "interrupted") return;
              SPEECH_FOUT = fout + " (poging " + (n + 1) + ", taal " + (taal || "-") + ")";
              volgende();
            };
          }
          synth.speak(u);
        });
        // Stil blijven zonder foutmelding gebeurt ook op sommige telefoons: dan na 2,5 seconden de volgende poging.
        setTimeout(() => {
          if (!gestart && id === SPEECH_ID && !herpoging && n < 2) { SPEECH_FOUT = "geen geluid gestart (poging " + (n + 1) + ", taal " + (taal || "-") + ")"; volgende(); }
        }, 2500);
      } catch (e) {}
    };
    if (busy) setTimeout(go, 60); else go();
  } catch (e) {}
}
function stopSpeaking() {
  SPEECH_ID++;
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
  gevaarWaarschuwingen(r.name).forEach((g) => p.push(`Let op: ${g.titel}. ${g.tekst}`));
  (Array.isArray(r.controles) ? r.controles : []).filter((c) => c && c.status === "let-op").forEach((c) => p.push(`Let op bij de dubbelcheck: ${c.tekst}`));
  if (r.type === "animal") {
    if (r.klasse) p.push(`Klasse: ${r.klasse}.`);
    if (r.leefgebied) p.push(`Leefgebied: ${r.leefgebied}.`);
    if (r.leeftijd) p.push(`Geschatte leeftijd: ${r.leeftijd}.`);
    if (r.weetje) p.push(`Leuk weetje: ${r.weetje}`);
    if (typeof r.gezond !== "undefined") {
      const gz = normGezond(r.gezond);
      p.push(gz === false ? `Gezondheidscheck: let op. ${r.gezondheidsopmerking || "Er lijkt iets niet in orde te zijn."}` : gz === true ? `Gezondheidscheck: lijkt gezond. ${r.gezondheidsopmerking || ""}` : `Gezondheidscheck: onzeker. ${r.gezondheidsopmerking || "De toestand van het dier kon op de foto niet goed beoordeeld worden."}`);
      p.push("Dit is een inschatting van een AI, geen diagnose.");
    }
    if (r.verzorgingstip) p.push(`Verzorging en omgang: ${r.verzorgingstip}`);
  } else {
    if (r.light) p.push(`Zonlicht: ${r.light}.`);
    if (r.soil) p.push(`Bodem: ${r.soil}.`);
    const st = gezondheidToestand(r.health), h = r.health && typeof r.health === "object" ? r.health : {};
    if (st === "let-op") p.push("Gezondheidscheck: let op.");
    else if (st === "seizoen") p.push("Gezondheidscheck: de bladeren hebben een andere kleur, wat waarschijnlijk bij het seizoen hoort.");
    else if (st === "gezond") p.push("Gezondheidscheck: op de foto zie ik geen duidelijke tekenen van ziekte.");
    else p.push("Gezondheidscheck: onzeker. De gezondheid kon op de foto niet goed beoordeeld worden.");
    if (h.observed) p.push(`De AI ziet: ${h.observed}`);
    if (h.diseaseName) p.push(`Mogelijk probleem: ${h.diseaseName}.`);
    if (h.note) p.push(`Toelichting: ${h.note}`);
    if (h.solution) p.push(`Wat je kunt doen: ${h.solution}`);
    p.push("Dit is een inschatting van een AI, geen diagnose.");
    p.push(giftTekst(r.giftigheid, !!r.__kids));
    p.push(isPaddenstoel(r.name) ? PADDENSTOEL_WAARSCHUWING : EET_WAARSCHUWING);
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
  const gg = normGift(g) || { mens: "onbekend", dier: "onbekend", delen: "", symptomen: "", omgang: "" };
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

/* ============ AUTOMATISCHE DUBBELCHECK PER SCAN ============ */
// Deze controles lopen bij elke scan, lokaal en zonder extra AI-aanroep. Ze zijn een vangnet voor fouten van de AI, geen garantie.
const GIFT_RANG = { onbekend: -1, niet: 0, licht: 1, matig: 2, sterk: 3 };
const BEKENDE_GIFTIG = [
  { naam: "lelie of daglelie", re: /\blelie\b|\blelies\b|lilium|daglelie|hemerocallis/i, niet: /water.?lelie|nymphaea/i, mens: "licht", dier: "sterk", delen: "alle delen, ook het stuifmeel en het water uit de vaas", symptomen: "bij katten nierfalen: braken, loomheid, minder plassen", omgang: "Zet geen lelies in huis als je katten hebt. Bij contact meteen naar de dierenarts." },
  { naam: "lelietje-van-dalen", re: /lelietje.van.dalen|convallaria/i, mens: "sterk", dier: "sterk", delen: "alle delen, ook de rode bessen en het water uit de vaas", symptomen: "misselijkheid, braken, hartritmeklachten", omgang: "Niet eten en niet in de mond steken. Was je handen na aanraking." },
  { naam: "taxus", re: /taxus|venijnboom/i, mens: "sterk", dier: "sterk", delen: "naalden en zaden", symptomen: "duizeligheid, braken, hartklachten", omgang: "Niet eten. Houd kinderen en huisdieren uit de buurt." },
  { naam: "gouden regen", re: /gouden regen|laburnum/i, mens: "sterk", dier: "sterk", delen: "alle delen, vooral de zaden in de peulen", symptomen: "braken, buikpijn, kramp", omgang: "Niet eten. Houd kinderen en huisdieren uit de buurt." },
  { naam: "wolfskers", re: /wolfskers|belladonna|atropa/i, mens: "sterk", dier: "sterk", delen: "alle delen, vooral de zwarte bessen", symptomen: "wijde pupillen, hartkloppingen, verwardheid", omgang: "Niet aanraken om te eten. Bel bij inname meteen het Antigifcentrum." },
  { naam: "vingerhoedskruid", re: /vingerhoedskruid|digitalis/i, mens: "sterk", dier: "sterk", delen: "alle delen", symptomen: "misselijkheid, trage of onregelmatige hartslag", omgang: "Niet eten en was je handen na aanraking." },
  { naam: "monnikskap", re: /monnikskap|aconitum/i, mens: "sterk", dier: "sterk", delen: "alle delen, vooral de wortel", symptomen: "tintelingen, braken, hartritmeklachten", omgang: "Niet aanraken zonder handschoenen en nooit eten." },
  { naam: "oleander", re: /oleander|nerium/i, mens: "sterk", dier: "sterk", delen: "alle delen", symptomen: "braken, hartritmeklachten", omgang: "Niet eten en draag handschoenen bij snoeien." },
  { naam: "wonderboom", re: /wonderboom|ricinus/i, mens: "sterk", dier: "sterk", delen: "vooral de zaden", symptomen: "buikpijn, braken, ernstige uitdroging", omgang: "Niet eten. Bel bij inname meteen het Antigifcentrum." },
  { naam: "rododendron of azalea", re: /rododendron|rhododendron|azalea/i, mens: "matig", dier: "sterk", delen: "bladeren en bloemen", symptomen: "kwijlen, braken, zwakte", omgang: "Niet eten. Houd huisdieren uit de buurt." },
  { naam: "dieffenbachia", re: /dieffenbachia/i, mens: "matig", dier: "matig", delen: "alle delen, vooral het sap", symptomen: "prikkeling en zwelling van mond en keel", omgang: "Draag handschoenen en was je handen na aanraking." },
  { naam: "wolfsmelk", re: /wolfsmelk|euphorbia/i, mens: "matig", dier: "matig", delen: "het witte melksap", symptomen: "huid- en oogirritatie, buikklachten", omgang: "Raak het sap niet aan. Spoel bij contact met water." },
  { naam: "narcis", re: /narcis|narcissus/i, mens: "matig", dier: "matig", delen: "vooral de bollen", symptomen: "braken, buikpijn, diarree", omgang: "Niet eten. Bewaar bollen buiten bereik van kinderen en huisdieren." },
  { naam: "klimop", re: /\bklimop\b|hedera/i, mens: "matig", dier: "matig", delen: "bladeren en bessen", symptomen: "braken, diarree, huidirritatie", omgang: "Niet eten en was je handen na aanraking." },
  { naam: "sagopalm", re: /sagopalm|cycas/i, mens: "matig", dier: "sterk", delen: "vooral de zaden", symptomen: "braken, leverschade (bij honden zeer ernstig)", omgang: "Niet eten. Houd huisdieren uit de buurt." },
];
function giftControle(naam, g) {
  const n = String(naam || "");
  const basis = normGift(g);
  const lijst = BEKENDE_GIFTIG.filter((b) => b.re.test(n) && !(b.niet && b.niet.test(n)));
  if (lijst.length === 0) return { giftigheid: basis, aangepast: false, naam: "" };
  const uit = { ...(basis || { mens: "onbekend", dier: "onbekend", delen: "", symptomen: "", omgang: "" }) };
  let aangepast = false;
  for (const b of lijst) for (const k of ["mens", "dier"]) {
    if ((GIFT_RANG[b[k]] ?? -1) > (GIFT_RANG[uit[k]] ?? -1)) { uit[k] = b[k]; aangepast = true; }
  }
  if (aangepast) {
    uit.delen = uit.delen || lijst[0].delen;
    uit.symptomen = uit.symptomen || lijst[0].symptomen;
    uit.omgang = uit.omgang || lijst[0].omgang;
  }
  return { giftigheid: uit, aangepast, naam: lijst[0].naam, vorigeMens: basis ? basis.mens : "onbekend", vorigeDier: basis ? basis.dier : "onbekend" };
}

const NEGATIE = new Set(["geen", "zonder", "niet", "nauwelijks", "niets"]);
const PROBLEEM_PLANT = /^(schimmel\w*|meeldauw\w*|rot|rotte|luizen|bladluizen|gaatjes|gaten|verwelk\w*|beschadig\w*|ziek\w*|vraat\w*|dor|dode|afgestorven|kapot|aangevreten|aantasting\w*|plekken|vlekken|vlekkerig\w*|gevlekt\w*|vlek)$/;
const PROBLEEM_KLEUR = /^(gele|geel|bruine|bruin|verkleurd\w*|verkleuring\w*|bleke|bleek|zwarte|zwart|grijze|grijzige)$/;
const BLAD_WOORD = /^(blad|bladeren|blaadjes|naalden|stengel|stengels|takken)$/;
const PROBLEEM_DIER = /^(gewond\w*|wond\w*|bloed\w*|bloedt|kreupel\w*|hink\w*|ziek\w*|verzwakt\w*|mager\w*|uitgeput\w*|dood|dode|parasiet\w*|schurft\w*|vervuild\w*)$/;
function problemenInTekst(tekst, soort) {
  const w = String(tekst || "").toLowerCase().match(/[a-zà-ÿ]+/g) || [];
  const genegeerd = (i) => { for (let k = Math.max(0, i - 3); k < i; k++) if (NEGATIE.has(w[k])) return true; return false; };
  const re = soort === "dier" ? PROBLEEM_DIER : PROBLEEM_PLANT;
  const gevonden = [];
  w.forEach((x, i) => {
    if (genegeerd(i)) return;
    if (re.test(x)) gevonden.push(x);
    else if (soort !== "dier" && PROBLEEM_KLEUR.test(x) && w.slice(Math.max(0, i - 2), i + 4).some((y) => BLAD_WOORD.test(y))) gevonden.push(`${x} (bij de bladeren)`);
  });
  return [...new Set(gevonden)].slice(0, 4);
}

function latijnUit(naam) {
  const s = String(naam || "").trim();
  const m = s.match(/\(([A-Z][a-z-]+ [a-z-]+)/);
  if (m) return m[1];
  if (/^[A-Z][a-z-]+ [a-z-]+(?: [A-Za-z.×x-]+)*$/.test(s)) return s.split(/\s+/).slice(0, 2).join(" ");
  return "";
}
function vergelijkBronnen(bronnen) {
  const l = (bronnen || []).filter((b) => b && b.latijn);
  if (l.length === 0) return { oordeel: "geen", bronnen: l };
  if (l.length === 1) return { oordeel: "enkel", bronnen: l };
  const soorten = new Set(l.map((b) => b.latijn.toLowerCase()));
  const geslachten = new Set(l.map((b) => b.latijn.toLowerCase().split(" ")[0]));
  return { oordeel: soorten.size === 1 ? "eens" : geslachten.size === 1 ? "geslacht" : "verschillend", bronnen: l };
}

function bouwPlantControles({ naam, bronnen, health, giftigheid, verzorgingVanAI }) {
  const c = [];
  const v = vergelijkBronnen(bronnen);
  const lijstTekst = v.bronnen.map((b) => `${b.bron}: ${b.latijn}`).join("; ");
  if (v.oordeel === "eens") c.push({ id: "bronnen", status: "ok", tekst: `Meerdere bronnen zijn het eens over de soort (${lijstTekst}).` });
  else if (v.oordeel === "geslacht") c.push({ id: "bronnen", status: "let-op", tekst: `De bronnen noemen hetzelfde geslacht maar een andere soort (${lijstTekst}). Neem een extra foto van een blad of bloem om zeker te zijn.` });
  else if (v.oordeel === "verschillend") c.push({ id: "bronnen", status: "let-op", tekst: `De bronnen verschillen (${lijstTekst}). Neem een tweede foto van een blad of bloem en vergelijk.` });
  else if (v.oordeel === "enkel") c.push({ id: "bronnen", status: "info", tekst: `Slechts één bron kon de soort bepalen (${lijstTekst}). Met een PlantNet- of Plant.id-sleutel erbij kan de app dit kruiscontroleren.` });
  else c.push({ id: "bronnen", status: "info", tekst: "De soort kon niet met een wetenschappelijke naam vergeleken worden." });

  const h = health && typeof health === "object" ? { ...health } : null;
  const st = gezondheidToestand(h);
  const obs = h && h.observed ? h.observed : "";
  const pr = obs ? problemenInTekst(obs, "plant") : [];
  if (st === "gezond" && pr.length) {
    h.isHealthy = null;
    c.push({ id: "gezondheid", status: "let-op", tekst: `De AI zegt "gezond", maar beschrijft zelf: ${pr.join(", ")}. Daarom behandelen we dit als onzeker.` });
  } else if (st === "gezond" && obs) c.push({ id: "gezondheid", status: "ok", tekst: "De beschrijving van de AI past bij de conclusie 'gezond'." });
  else if (st === "gezond") c.push({ id: "gezondheid", status: "info", tekst: "De AI beschreef niet wat hij zag, dus 'gezond' is moeilijker te controleren." });
  else if (st === "onzeker") c.push({ id: "gezondheid", status: "info", tekst: "De gezondheid kon op deze foto niet beoordeeld worden." });
  else if (pr.length) c.push({ id: "gezondheid", status: "ok", tekst: "De beschrijving van de AI past bij de conclusie." });

  const gc = giftControle(naam, giftigheid);
  if (gc.naam && gc.aangepast) c.push({ id: "giftigheid", status: "let-op", tekst: `De AI zei: mens "${gc.vorigeMens}", huisdier "${gc.vorigeDier}". Maar ${gc.naam} staat op onze lijst van bekende giftige planten, dus de waarschuwing is aangepast.` });
  else if (gc.naam) c.push({ id: "giftigheid", status: "ok", tekst: `Gecontroleerd tegen onze lijst van bekende giftige planten (${gc.naam}): de AI zat niet te laag.` });
  else c.push({ id: "giftigheid", status: "info", tekst: "Deze plant staat niet op onze korte lijst van bekende giftige planten; de giftigheid komt alleen van de AI. Bij twijfel: Antigifcentrum 070 245 245." });

  if (!verzorgingVanAI) c.push({ id: "verzorging", status: "info", tekst: "Het verzorgingsadvies is een algemene standaard en geen advies voor deze soort." });
  return { controles: c, health: h, giftigheid: gc.giftigheid };
}

function bouwDierControles(res) {
  const r = { ...res };
  const c = [];
  const heeft = "gezond" in r;
  const gz = heeft ? normGezond(r.gezond) : undefined;
  const pr = problemenInTekst(r.gezondheidsopmerking, "dier");
  if (gz === true && pr.length) {
    r.gezond = null;
    c.push({ id: "gezondheid", status: "let-op", tekst: `De AI zegt "gezond", maar beschrijft zelf: ${pr.join(", ")}. Daarom behandelen we dit als onzeker.` });
  } else if (gz === true || gz === false) c.push({ id: "gezondheid", status: "ok", tekst: "Er is een gezondheidsinschatting; de beschrijving spreekt die niet tegen." });
  else if (heeft) c.push({ id: "gezondheid", status: "info", tekst: "De toestand van het dier kon niet beoordeeld worden." });
  const klasse = klasseCanon(r.klasse);
  c.push(klasse ? { id: "groep", status: "ok", tekst: `De dierengroep (${klasse}) is een bekende groep.` } : { id: "groep", status: "info", tekst: "De dierengroep kon niet gecontroleerd worden." });
  return { res: r, controles: c };
}

function cleanControles(c) {
  if (!Array.isArray(c)) return [];
  return c.filter((x) => x && typeof x === "object").slice(0, 8)
    .map((x) => ({ id: asText(x.id).slice(0, 20), status: ["ok", "let-op", "info"].includes(x.status) ? x.status : "info", tekst: asText(x.tekst).slice(0, 400) }))
    .filter((x) => x.tekst);
}

function DubbelcheckKaart({ controles, cardStyle }) {
  const lijst = Array.isArray(controles) ? controles : [];
  if (lijst.length === 0) return null;
  const ok = lijst.filter((c) => c.status === "ok").length;
  const letop = lijst.filter((c) => c.status === "let-op").length;
  const icoon = { ok: "✅", "let-op": "⚠️", info: "ℹ️" };
  return (
    <div style={{ ...cardStyle, borderLeft: `6px solid ${letop ? "#e67e22" : "#2ecc71"}` }}>
      <div style={{ fontWeight: 800, marginBottom: 10, color: "#a8e6cf", fontSize: 18 }}>🧪 Automatische dubbelcheck: {ok} van {lijst.length} in orde</div>
      <div style={{ fontSize: 14, lineHeight: "1.6" }}>
        {lijst.map((c, i) => <div key={i} style={{ marginTop: i ? 6 : 0 }}>{icoon[c.status]} {c.tekst}</div>)}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>Dit zijn automatische controles op wat de AI zegt. Ze verkleinen de kans op fouten, maar geven geen garantie.</div>
    </div>
  );
}

/* ============ DIAGNOSE-LOGBOEK (geen foto's, geen sleutels) ============ */
const DIAG_KEY = "natuurscanner_diagnose";
function loadDiag() {
  try { const l = JSON.parse(localStorage.getItem(DIAG_KEY)); return Array.isArray(l) ? l.filter((x) => x && typeof x === "object") : []; } catch (e) { return []; }
}
function logDiag(rec) {
  try {
    const l = loadDiag();
    l.unshift({ t: new Date().toISOString(), v: APP_VERSIE, ...rec });
    localStorage.setItem(DIAG_KEY, JSON.stringify(l.slice(0, 200)));
  } catch (e) { /* logboek is bijzaak: nooit de app laten haperen */ }
}
function diagVoorScan(e) {
  const c = Array.isArray(e && e.controles) ? e.controles : [];
  return {
    type: e.type, bron: String(e.source || ""), naam: String(e.name || "").slice(0, 80),
    ok: c.filter((x) => x.status === "ok").length, info: c.filter((x) => x.status === "info").length, letop: c.filter((x) => x.status === "let-op").map((x) => x.id),
    gezond: e.type === "plant" ? (e.health ? e.health.isHealthy : null) : (e.gezond === undefined ? null : e.gezond),
  };
}
function makeDiagExport() {
  let ua = ""; try { ua = navigator.userAgent; } catch (e) { /* niets */ }
  return JSON.stringify({ app: "NatuurScanner", soort: "diagnose-export", versie: APP_VERSIE, datum: new Date().toISOString(), browser: ua, statistieken: loadStats(), logboek: loadDiag() }, null, 1);
}

/* ============ GEZONDHEID: gezond / let op / seizoen / onzeker ============ */
// Een ontbrekend of onduidelijk antwoord wordt NOOIT als "gezond" getoond: dan is de toestand "onzeker".
function normGezond(v) {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "ja", "yes", "gezond", "lijkt gezond"].includes(s)) return true;
    if (["false", "nee", "no", "niet gezond", "ongezond", "let op"].includes(s)) return false;
  }
  return null;
}
function gezondheidToestand(h) {
  const gz = h && typeof h === "object" ? normGezond(h.isHealthy) : null;
  if (gz === false && h.seasonal === true && !h.diseaseName) return "seizoen";
  return gz === false ? "let-op" : gz === true ? "gezond" : "onzeker";
}
const GEZOND_UITLEG = "Dit is een inschatting van een AI op één foto, geen diagnose en geen meting in real time. Twijfel je? Vraag het aan een kenner of een volwassene.";
function herfstNotitie(d) {
  return huidigSeizoen(d) === "herfst" ? "🍂 Het is herfst: veel bomen, struiken en buitenplanten kleuren en verliezen nu hun bladeren. Dat is normaal. Gele of bruine bladeren bij een kamerplant of midden in de zomer wijzen vaker op een probleem." : "";
}
function huidigeDatumTekst() {
  try { return new Date().toLocaleDateString("nl-BE", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return ""; }
}
const GEZOND_KLEUR = { "let-op": "#e74c3c", gezond: "#2ecc71", seizoen: "#e67e22", onzeker: "#95a5a6" };
const GEZOND_TITEL = { "let-op": "🩺 Gezondheidscheck: Let op", gezond: "✅ Gezondheidscheck: lijkt gezond", seizoen: "🍂 Gezondheidscheck: verkleuring, waarschijnlijk seizoen", onzeker: "❓ Gezondheidscheck: onzeker" };
function PlantGezondheidKaart({ health, cardStyle }) {
  const st = gezondheidToestand(health);
  const h = health && typeof health === "object" ? health : {};
  const herfst = herfstNotitie();
  return (
    <div style={{ ...cardStyle, borderLeft: `6px solid ${GEZOND_KLEUR[st]}` }}>
      <div style={{ fontWeight: 800, marginBottom: 10, color: "#a8e6cf", fontSize: 18 }}>{GEZOND_TITEL[st]}</div>
      <div style={{ fontSize: 15, lineHeight: "1.6" }}>
        {h.observed && <div><strong>👀 Wat de AI ziet:</strong> {h.observed}</div>}
        {h.diseaseName && <div style={{ marginTop: 6 }}><strong>🦠 Mogelijk probleem:</strong> {h.diseaseName}</div>}
        {h.note && <div style={{ marginTop: 6 }}><strong>ℹ️ Toelichting:</strong> {h.note}</div>}
        {h.solution && <div style={{ marginTop: 6 }}><strong>🛠️ Wat kun je doen:</strong> {h.solution}</div>}
        {st === "gezond" && !h.observed && <div>Op deze foto zie ik geen duidelijke tekenen van ziekte of schade.</div>}
        {st === "onzeker" && <div>De gezondheid kon op deze foto niet betrouwbaar beoordeeld worden. Probeer eventueel een scherpere foto van één blad of één plant.</div>}
        {herfst && <div style={{ marginTop: 8 }}>{herfst}</div>}
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>{GEZOND_UITLEG}</div>
      </div>
    </div>
  );
}
function DierGezondheidKaart({ gezond, opmerking, cardStyle }) {
  const gz = normGezond(gezond);
  const st = gz === false ? "let-op" : gz === true ? "gezond" : "onzeker";
  const standaard = st === "let-op" ? "Er lijkt iets niet in orde te zijn." : st === "gezond" ? "Geen duidelijke verwondingen of ziektetekens op de foto." : "De toestand van het dier kon op deze foto niet goed beoordeeld worden.";
  return (
    <div style={{ ...cardStyle, borderLeft: `6px solid ${GEZOND_KLEUR[st]}` }}>
      <div style={{ fontWeight: 800, marginBottom: 10, color: "#a8e6cf", fontSize: 18 }}>{GEZOND_TITEL[st]}</div>
      <div style={{ fontSize: 15 }}>{opmerking || standaard}</div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>{GEZOND_UITLEG}</div>
    </div>
  );
}

/* ============ VEILIGE GEGEVENS + FOUTSCHERM ============ */
// Alles wat als tekst getoond wordt, wordt tot tekst gemaakt: een object of lijst van de AI (of uit een back-up)
// mag het scherm nooit laten crashen.
function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ");
  if (typeof v === "object") return Object.values(v).map(asText).filter(Boolean).join(" · ");
  return "";
}
const TEKST_VELDEN = ["name", "date", "source", "light", "soil", "freq", "amount", "tip", "scientificName", "klasse", "familie", "leefgebied", "leeftijd", "weetje", "gezondheidsopmerking", "verzorgingstip"];
function cleanEntry(e) {
  if (!e || typeof e !== "object") return e;
  const o = { ...e };
  for (const k of TEKST_VELDEN) if (k in o && typeof o[k] !== "string") o[k] = asText(o[k]);
  if ("health" in o) {
    const h = o.health;
    o.health = h && typeof h === "object" ? { ...h, isHealthy: normGezond(h.isHealthy), diseaseName: asText(h.diseaseName), note: asText(h.note), solution: asText(h.solution), observed: asText(h.observed) } : null;
  }
  if ("giftigheid" in o) o.giftigheid = normGift(o.giftigheid);
  if ("gezond" in o) o.gezond = normGezond(o.gezond);
  if ("controles" in o) o.controles = cleanControles(o.controles);
  return o;
}
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { fout: null, poging: 0 }; }
  static getDerivedStateFromError(fout) { return { fout }; }
  componentDidCatch(fout, info) { try { console.error("NatuurScanner fout:", fout, info && info.componentStack); } catch (e) { /* niets */ } }
  render() {
    if (this.state.fout) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, background: "#0f3d4a", color: "#fff", fontFamily: "sans-serif" }}>
          <div style={{ fontSize: 56 }}>😕</div>
          <div style={{ fontSize: 24, fontWeight: 800, margin: "12px 0" }}>Oeps, er ging iets mis</div>
          <div style={{ maxWidth: 420, lineHeight: 1.6, marginBottom: 20 }}>Geen paniek: je scans zijn nog bewaard. Ga terug naar het startscherm en probeer het opnieuw.</div>
          <button style={{ padding: "16px 28px", borderRadius: 18, border: "none", background: "#2ecc71", color: "#fff", fontSize: 18, fontWeight: 800, cursor: "pointer" }} onClick={() => this.setState({ fout: null, poging: this.state.poging + 1 })}>🏠 Terug naar start</button>
          <details style={{ marginTop: 20, opacity: 0.7, maxWidth: 420 }}><summary>Technische details (voor de leerkracht)</summary><div style={{ fontSize: 12, marginTop: 8, wordBreak: "break-word" }}>{String(this.state.fout && this.state.fout.message ? this.state.fout.message : this.state.fout)}</div></details>
        </div>
      );
    }
    return <React.Fragment key={this.state.poging}>{this.props.children}</React.Fragment>;
  }
}

/* ============ GEVAARLIJKE EN INVASIEVE SOORTEN IN BELGIË (op naam herkend) ============ */
const GEVAAR_SOORTEN = [
  { ernst: "info", icoon: "🐴", re: /gewone esdoorn|acer pseudoplatanus|vederesdoorn|acer negundo/i, titel: "Esdoorn: gevaarlijk voor paarden", tekst: "De zaden (de vliegende 'neusjes'), de jonge zaailingen en soms ook de bladeren van de gewone esdoorn kunnen paarden ernstig ziek maken (atypische myopathie, ook weidemyopathie genoemd). Heb je paarden of ezels? Houd ze in de herfst en de lente weg van esdoorns en hun zaadjes, en bel bij spierstijfheid of zwakte meteen de dierenarts." },
  { ernst: "gevaar", icoon: "🌿", re: /berenklauw|heracleum/i, titel: "Berenklauw: niet aanraken", tekst: "Het sap van reuzenberenklauw kan samen met zonlicht pijnlijke blaren en brandwonden geven, en ook gewone berenklauw kan de huid irriteren. Raak de plant niet aan en laat geen sap op je huid komen. Gebeurd het toch? Spoel de huid goed met water en zeep, houd de plek uit de zon en ga naar een dokter. Bij ernstige klachten bel je 112." },
  { ernst: "gevaar", icoon: "☠️", re: /scheerling|conium/i, titel: "Scheerling: zeer giftig", tekst: "Scheerling is zeer giftig en lijkt op wilde peen en kervel. Eet er nooit van, pluk hem niet en was je handen na aanraking. Heb je er toch van gegeten, of twijfel je? Bel meteen het Antigifcentrum 070 245 245, of 112 bij nood." },
  { ernst: "gevaar", icoon: "🐛", re: /processierups|thaumetopoea/i, titel: "Processierups: niet aanraken", tekst: "De fijne haartjes van processierupsen kunnen jeuk, uitslag, pijnlijke ogen en soms ademhalingsklachten geven. Blijf uit de buurt van de rupsen en hun nesten en raak ze niet aan. Last gehad? Spoel de huid met water, doe de kleren in de was en vraag een volwassene om hulp of bel de huisarts. Heb je moeite met ademen, bel dan 112." },
  { ernst: "gevaar", icoon: "🐝", re: /hoornaar|vespa crabro|vespa velutina/i, titel: "Hoornaar: blijf weg van het nest", tekst: "Blijf uit de buurt van nesten en sla niet naar de dieren. Een steek kan pijnlijk zijn en is gevaarlijk bij een allergie. Ga rustig weg en vertel het aan een volwassene. Bij een dik gezicht of een dikke keel, of moeilijk ademen: bel meteen 112." },
  { ernst: "gevaar", icoon: "🕷️", re: /teek\b|teken\b|ixodes/i, titel: "Teek: haal hem snel weg", tekst: "Teken kunnen ziektes overbrengen, zoals de ziekte van Lyme. Laat een volwassene de teek zo snel mogelijk met een tekentang verwijderen en de plek ontsmetten. Let de weken erna op een rode ring of koorts: ga dan naar de dokter." },
  { ernst: "invasief", icoon: "🚫", re: /japanse duizendknoop|sachalinse duizendknoop|boheemse duizendknoop|reynoutria|fallopia/i, titel: "Invasieve soort", tekst: "Duizendknoop uit Azië is een invasieve plant die onze inheemse planten verdringt en uit kleine stukjes weer kan groeien. Verspreid hem niet en doe snoeiafval niet op de composthoop. Vraag een volwassene hoe je het veilig afvoert." },
  { ernst: "invasief", icoon: "🚫", re: /reuzenbalsemien|himalayabalsemien|impatiens glandulifera/i, titel: "Invasieve soort", tekst: "Reuzenbalsemien verspreidt zich razendsnel met springende zaden en verdringt inheemse planten. Help hem niet verspreiden en vertel het aan een volwassene." },
  { ernst: "invasief", icoon: "🐸", re: /stierkikker|lithobates|rana catesbeiana/i, titel: "Invasieve soort", tekst: "De Amerikaanse stierkikker komt oorspronkelijk uit Noord-Amerika en verdringt onze eigen kikkers. Raak hem niet aan en vertel het aan een volwassene." },
];
function gevaarWaarschuwingen(name) {
  const n = String(name || "");
  return GEVAAR_SOORTEN.filter((g) => g.re.test(n)).slice(0, 2);
}
function GevaarKaart({ name, cardStyle }) {
  const lijst = gevaarWaarschuwingen(name);
  if (lijst.length === 0) return null;
  return (
    <>
      {lijst.map((g) => (
        <div key={g.titel} style={{ ...cardStyle, borderLeft: `6px solid ${{ gevaar: "#e74c3c", info: "#e67e22" }[g.ernst] || "#3498db"}` }}>
          <div style={{ fontWeight: 800, marginBottom: 6, color: { gevaar: "#ff6b6b", info: "#ffb86b" }[g.ernst] || "#74b9ff", fontSize: 17 }}>{g.icoon} {g.titel}</div>
          <div style={{ fontSize: 14, lineHeight: "1.6" }}>{g.tekst}</div>
        </div>
      ))}
    </>
  );
}

/* ============ EETWAARSCHUWING ============ */
const FUNGI_RE = /paddenstoel|zwam|schimmel|champignon|boleet|boletus|russula|cantharel|cantharellus|amaniet|amanita|eekhoorntjesbrood|truffel|bovist|plooirokje|fungus|fungi|mushroom|agaricus/i;
function isPaddenstoel(name) { return FUNGI_RE.test(String(name || "")); }
const EET_WAARSCHUWING = "Eet nooit planten, bessen of paddenstoelen op basis van een app. Een foutje kan gevaarlijk zijn. Vraag het altijd aan een deskundige.";
const PADDENSTOEL_WAARSCHUWING = "Dit lijkt een paddenstoel. Eet nooit een paddenstoel op basis van een app: sommige soorten zijn dodelijk giftig en lijken sterk op eetbare soorten. Heb je er toch van gegeten, of twijfel je? Bel meteen het Antigifcentrum 070 245 245, of 112 bij nood.";
function EetWaarschuwing({ name, cardStyle }) {
  const padd = isPaddenstoel(name);
  return (
    <div style={{ ...cardStyle, borderLeft: `6px solid ${padd ? "#e74c3c" : "#e67e22"}` }}>
      <div style={{ fontWeight: 800, marginBottom: 6, color: padd ? "#ff6b6b" : "#ffb86b", fontSize: 16 }}>{padd ? "🍄 Let op: paddenstoel" : "🚫 Niet opeten"}</div>
      <div style={{ fontSize: 14, lineHeight: "1.6" }}>{padd ? PADDENSTOEL_WAARSCHUWING : EET_WAARSCHUWING}</div>
    </div>
  );
}

/* ============ BACK-UP, MINIATUUR, ALBUM, STATISTIEKEN ============ */
async function makeThumb(dataUrl) {
  try { return await resizeDataUrl(dataUrl, 640, 0.72); } catch (e) { return dataUrl; }
}
function makeBackup(list) {
  return JSON.stringify({ app: "NatuurScanner", versie: 1, datum: new Date().toISOString(), scans: list });
}
function parseBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return { ok: false, fout: "Dit bestand is geen geldige back-up." }; }
  const lijst = Array.isArray(d) ? d : d && d.app === "NatuurScanner" && Array.isArray(d.scans) ? d.scans : null;
  if (!lijst) return { ok: false, fout: "Dit bestand is geen NatuurScanner-back-up." };
  const scans = lijst.filter((x) => x && typeof x === "object" && x.id != null && typeof x.name === "string" && (x.type === "plant" || x.type === "animal") && typeof x.image === "string" && x.image.startsWith("data:image/"));
  return { ok: true, scans: scans.map(cleanEntry), overgeslagen: lijst.length - scans.length };
}
function mergeHistory(huidig, nieuw) {
  const ids = new Set(huidig.map((h) => String(h.id)));
  const toe = nieuw.filter((n) => { const k = String(n.id); if (ids.has(k)) return false; ids.add(k); return true; });
  const lijst = [...huidig, ...toe].sort((a, b) => Number(b.id) - Number(a.id));
  return { lijst, toegevoegd: toe.length, alAanwezig: nieuw.length - toe.length };
}
function bouwAlbum(list) {
  const map = new Map();
  for (const h of list || []) {
    if (!h || !h.name) continue;
    const k = `${h.type}:${String(h.name).trim().toLowerCase()}`;
    const e = map.get(k);
    if (!e) map.set(k, { key: k, name: h.name, type: h.type, aantal: 1, laatste: h });
    else { e.aantal++; if (Number(h.id) > Number(e.laatste.id)) e.laatste = h; }
  }
  return [...map.values()].sort((a, b) => Number(b.laatste.id) - Number(a.laatste.id));
}
function albumBadge(n) {
  return n >= 50 ? "🥇 Natuurmeester" : n >= 25 ? "🥈 Natuurkenner" : n >= 10 ? "🥉 Natuurverkenner" : n >= 3 ? "🌱 Beginnende ontdekker" : "";
}
const STATS_KEY = "natuurscanner_stats";
function loadStats() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STATS_KEY)); } catch (e) { s = null; }
  s = s || {};
  return { sterren: Number(s.sterren) || 0, quizzen: Number(s.quizzen) || 0, diplomas: Number(s.diplomas) || 0, besteProcent: Number(s.besteProcent) || 0 };
}
function updateStats(fn) {
  const n = fn(loadStats());
  try { localStorage.setItem(STATS_KEY, JSON.stringify(n)); } catch (e) { /* opslag vol: geen ramp */ }
  return n;
}

/* ============ QUIZ OVER EIGEN SCANS (lokaal, zonder AI-aanroep) ============ */
const SCAN_NAMEN_REST = ["Madeliefje", "Paardenbloem", "Klaproos", "Brandnetel", "Eik", "Egel", "Merel", "Vos", "Eekhoorn", "Konijn", "Ooievaar", "Mus"];
const KLASSE_CANON = [["zoogdier", "Zoogdier"], ["vogel", "Vogel"], ["reptiel", "Reptiel"], ["amfibie", "Amfibie"], ["vis", "Vis"], ["insect", "Insect"], ["spin", "Spinachtige"]];
function klasseCanon(k) {
  const s = String(k || "").trim().toLowerCase();
  for (const [p, n] of KLASSE_CANON) if (s.startsWith(p)) return n;
  return null;
}
function buildScanQuiz(list) {
  // Rekentijd blijft laag, ook bij honderden scans: er worden maximaal 10 soorten gekozen die een vraag krijgen.
  const album = bouwAlbum(list);
  const lc = (x) => String(x).trim().toLowerCase();
  const namen = album.map((a) => a.name);
  const vragen = [];
  for (const a of shuffleArray(album).slice(0, 10)) {
    const r = a.laatste;
    const weetje = r.type === "animal" ? (r.weetje || "") : (r.tip ? `Tip bij deze plant: ${r.tip}` : "");
    // 1. Welke soort is dit? (met je eigen foto)
    const gebruikt = new Set([lc(a.name)]);
    const afleiders = [];
    for (const n of shuffleArray([...namen, ...SCAN_NAMEN_REST])) {
      if (afleiders.length >= 3) break;
      if (gebruikt.has(lc(n))) continue;
      gebruikt.add(lc(n)); afleiders.push(n);
    }
    const opts = shuffleArray([a.name, ...afleiders]);
    vragen.push({ q: "Welke soort heb jij hier gescand?", opts, correct: opts.indexOf(a.name), niveau: 1, image: r.image, weetje });
    // 2. Dierengroep
    if (r.type === "animal") {
      const canon = klasseCanon(r.klasse);
      if (canon) {
        const o = shuffleArray([canon, ...shuffleArray(KLASSE_CANON.map((k) => k[1]).filter((k) => k !== canon)).slice(0, 3)]);
        vragen.push({ q: `Tot welke groep dieren hoort ${a.name}?`, opts: o, correct: o.indexOf(canon), niveau: 1, image: r.image, weetje });
      }
    }
    // 3. Giftig voor huisdieren (volgens de AI-inschatting)
    if (r.type === "plant" && r.giftigheid && ["niet", "licht", "matig", "sterk"].includes(r.giftigheid.dier)) {
      const ja = r.giftigheid.dier !== "niet";
      vragen.push({ q: `Volgens je scan: is ${a.name} giftig voor huisdieren?`, opts: ["Ja, giftig", "Nee, niet giftig"], correct: ja ? 0 : 1, niveau: 1, image: r.image, weetje: "Dit is een inschatting van een AI op basis van een foto. Vraag bij twijfel altijd een dierenarts." });
    }
  }
  return shuffleArray(vragen).slice(0, 10);
}

const ALL_QUIZ_QUESTIONS = [
  // Planten & fotosynthese
  { q: "Welk deel van een plant zet zonlicht om in energie?", opts: ["Wortel", "Blad", "Bloem", "Stengel"], correct: 1 , niveau: 1, weetje: "In de cellen van het blad zit bladgroen, dat zonlicht opvangt om suiker te maken." },
  { q: "Hoe heet het proces waarbij planten zuurstof produceren?", opts: ["Ademhaling", "Fotosynthese", "Verdamping", "Bestuiving"], correct: 1 , niveau: 2, weetje: "Met zonlicht, water en koolstofdioxide maakt een plant suiker, en daarbij komt zuurstof vrij." },
  { q: "Wat neemt een plant voornamelijk op via haar wortels?", opts: ["Zonlicht", "Water & mineralen", "Zuurstof", "Insecten"], correct: 1 , niveau: 1, weetje: "Wortelharen, fijn als haartjes, zuigen water en mineralen uit de grond op." },
  { q: "Welke plant heeft van nature de minste hoeveelheid water nodig?", opts: ["Varen", "Cactus", "Tomaat", "Basilicum"], correct: 1 , niveau: 1, weetje: "Een cactus bewaart water in zijn dikke stengel en heeft stekels in plaats van bladeren, zodat er weinig water verdampt." },
  { q: "Welk gas ademen planten overdag voornamelijk in?", opts: ["Zuurstof", "Koolstofdioxide", "Stikstof", "Waterstof"], correct: 1 , niveau: 2, weetje: "Planten nemen koolstofdioxide op via piepkleine openingen in hun bladeren." },
  { q: "Wat gebeurt er met een plant die te veel water krijgt?", opts: ["Ze groeit sneller", "De wortels kunnen gaan rotten", "Ze wordt groener", "Niets"], correct: 1 , niveau: 2, weetje: "Wortels hebben ook lucht nodig: in drassige grond krijgen ze te weinig zuurstof en rotten ze." },
  { q: "Waar zit chlorofyl (bladgroen) vooral in?", opts: ["Bloemblaadjes", "Bladeren", "Wortels", "Zaden"], correct: 1 , niveau: 2, weetje: "Chlorofyl geeft bladeren hun groene kleur en vangt het licht op voor de fotosynthese." },
  { q: "Hoe noemen we een plant die maar één jaar leeft?", opts: ["Eenjarige plant", "Vaste plant", "Struik", "Boom"], correct: 0 , niveau: 2, weetje: "Eenjarigen zoals zonnebloemen groeien, bloeien en maken zaad in één jaar, daarna sterft de plant." },
  { q: "Wat hebben zaden nodig om te ontkiemen?", opts: ["Enkel duisternis", "Water, warmte en soms licht", "Alleen aarde", "Suiker"], correct: 1 , niveau: 1, weetje: "Een zaadje wacht tot de omstandigheden goed zijn; daarom zaaien we vooral in de lente." },
  { q: "Welk deel van de plant transporteert water naar de bladeren?", opts: ["De bloem", "De stengel", "De vrucht", "Het zaad"], correct: 1 , niveau: 2, weetje: "Water gaat via dunne buisjes in de stengel omhoog naar de bladeren." },
  // Bomen
  { q: "Welke boomsoort behoudt haar groene naalden gedurende de winter?", opts: ["Eik", "Dennenboom", "Beuk", "Kastanje"], correct: 1 , niveau: 1, weetje: "Naalden hebben een waslaagje en verliezen weinig water; een den vervangt ze geleidelijk, daarom blijft hij het hele jaar groen." },
  { q: "Hoe kun je de exacte leeftijd van een omgehakte boom aflezen?", opts: ["Aantal bladeren", "Jaarringen in de stam", "Diepte van wortels", "Dikte van de schors"], correct: 1 , niveau: 1, weetje: "Elk jaar groeit er een nieuwe ring bij: breed in een goed jaar, smal in een droog jaar." },
  { q: "Welke boom geeft eikels?", opts: ["Beuk", "Eik", "Berk", "Wilg"], correct: 1 , niveau: 1, weetje: "Gaaien begraven eikels en vergeten er sommige, waaruit dan nieuwe eiken groeien." },
  { q: "Hoe noemen we een bos met vooral naaldbomen?", opts: ["Loofbos", "Naaldbos", "Gemengd bos", "Struikgewas"], correct: 1 , niveau: 1, weetje: "Naaldbomen zoals spar en den hebben naalden en dragen kegels, zoals dennenappels." },
  { q: "Wat verliezen de meeste loofbomen in de herfst?", opts: ["Hun wortels", "Hun bladeren", "Hun schors", "Hun bloesems"], correct: 1 , niveau: 1, weetje: "In de herfst breekt een loofboom zijn bladgroen af; daarom worden bladeren geel, oranje en bruin." },
  { q: "Welke boom heeft witte, papierachtige schors?", opts: ["Eik", "Berk", "Beuk", "Den"], correct: 1 , niveau: 2, weetje: "De witte schors van een berk komt los in dunne, papierachtige velletjes." },
  { q: "Wat is de belangrijkste functie van de schors van een boom?", opts: ["Voedsel maken", "De boom beschermen", "Water opslaan", "Zuurstof maken"], correct: 1 , niveau: 2, weetje: "Schors beschermt de boom tegen kou, hitte, schimmels en hongerige dieren." },
  { q: "Welke boom draagt kastanjes?", opts: ["Kastanjeboom", "Eik", "Berk", "Populier"], correct: 0 , niveau: 1, weetje: "Let op: paardenkastanjes zijn niet eetbaar; tamme kastanjes kun je wel roosteren." },
  { q: "Hoe noem je jonge boompjes die net uit een zaadje komen?", opts: ["Stekjes", "Kiemplantjes", "Loten", "Twijgen"], correct: 1 , niveau: 2, weetje: "Uit een zaadje komt eerst een kiemplantje met kiembladeren, daarna groeien de echte bladeren." },
  { q: "Welke boomsoort behoort tot de langst levende bomen ter wereld (duizenden jaren)?", opts: ["Populier", "Sequoia (mammoetboom)", "Wilg", "Berk"], correct: 1 , niveau: 3, weetje: "Sommige sequoia's kunnen ruim 3000 jaar oud worden." },
  // Bloemen & bestuiving
  { q: "Hoe noemen we het gele poeder in bloemen dat bijen verzamelen?", opts: ["Suiker", "Zand", "Stuifmeel", "Nectar"], correct: 2 , niveau: 1, weetje: "Bijen nemen stuifmeel mee naar het nest als eiwitrijk voedsel voor hun larven." },
  { q: "Waarom zijn bloemen vaak felgekleurd?", opts: ["Om insecten aan te trekken", "Om warmte vast te houden", "Om regen af te weren", "Toeval"], correct: 0 , niveau: 1, weetje: "Veel bloemen hebben ook patronen die wij niet zien maar insecten wel: zij zien ultraviolet licht." },
  { q: "Wat is bestuiving?", opts: ["Water geven aan een plant", "Stuifmeel overbrengen naar een andere bloem", "Bladeren snoeien", "Zaden planten"], correct: 1 , niveau: 2, weetje: "Zonder bestuiving geen appels, peren of kersen: bijen en andere insecten doen het werk." },
  { q: "Welk dier is de bekendste bestuiver?", opts: ["Mier", "Bij", "Spin", "Worm"], correct: 1 , niveau: 1, weetje: "Naast honingbijen leven er in België meer dan 350 soorten wilde bijen, de meeste leven alleen." },
  { q: "Wat drinken bijen uit bloemen?", opts: ["Water", "Nectar", "Melk", "Sap"], correct: 1 , niveau: 1, weetje: "Een bij brengt nectar naar de kast, waar hij tot honing wordt omgevormd." },
  { q: "Hoe noemen we een bloem die 's nachts opengaat en overdag sluit?", opts: ["Nachtbloem", "Zonnebloem", "Ochtendster", "Winterbloem"], correct: 0 , niveau: 2, weetje: "Nachtbloemen, zoals de nachtkaars, geuren sterk om nachtvlinders aan te trekken." },
  { q: "Waaruit ontstaat een vrucht meestal?", opts: ["Uit het blad", "Uit de bevruchte bloem", "Uit de wortel", "Uit de stengel"], correct: 1 , niveau: 2, weetje: "Na de bestuiving groeit het vruchtbeginsel van de bloem uit tot een vrucht met zaden." },
  { q: "Welke bloem draait zijn 'gezicht' mee met de zon?", opts: ["Tulp", "Zonnebloem", "Roos", "Klaproos"], correct: 1 , niveau: 1, weetje: "Jonge zonnebloemen volgen de zon; volwassen bloemen kijken meestal naar het oosten." },
  { q: "Wat zit er in een zaaddoos van een bloem?", opts: ["Water", "Zaadjes", "Stuifmeel", "Nectar"], correct: 1 , niveau: 1, weetje: "In elk zaadje zit een piepkleine plant met een voedselvoorraad om te kunnen groeien." },
  { q: "Hoe heten de gekleurde blaadjes rond het hart van een bloem?", opts: ["Kelkbladeren", "Kroonbladeren", "Steelbladeren", "Wortelbladeren"], correct: 1 , niveau: 3, weetje: "De groene blaadjes aan de buitenkant van een bloem heten kelkbladeren." },
  // Groenten & moestuin
  { q: "Van welke plant maken we friet?", opts: ["Aardappel", "Wortel", "Ui", "Prei"], correct: 0 , niveau: 1, weetje: "Groene aardappels en de bessen van de aardappelplant zijn giftig: eet ze nooit." },
  { q: "Welk deel van de wortelplant eten we?", opts: ["Het blad", "De wortel", "De bloem", "Het zaad"], correct: 1 , niveau: 1, weetje: "Een wortel is een verdikte wortel waarin de plant suiker opslaat voor later." },
  { q: "Groeien tomaten boven of onder de grond?", opts: ["Boven de grond", "Onder de grond", "Allebei", "In het water"], correct: 0 , niveau: 1, weetje: "Tomatenplanten zijn familie van de aardappelplant." },
  { q: "Waarom is het goed om onkruid uit je moestuin te wieden?", opts: ["Onkruid smaakt lekker", "Het neemt water en voedingsstoffen weg van je groenten", "Onkruid trekt vlinders aan", "Geen enkele reden"], correct: 1 , niveau: 2, weetje: "Onkruid concurreert met je groenten om licht, water en voedsel." },
  { q: "Welke groente groeit als een hoofd van dicht opeengepakte bladeren?", opts: ["Wortel", "Sla of kool", "Aardappel", "Prei"], correct: 1 , niveau: 1, weetje: "Kool vormt een stevige krop van bladeren; spruitjes zijn kleine koppen langs de stengel." },
  { q: "Wat gebruik je best om je moestuinbodem te verrijken?", opts: ["Plastic", "Compost", "Zand", "Steentjes"], correct: 1 , niveau: 2, weetje: "In compost werken schimmels, bacteriën en wormen: ze maken van afval nieuwe, voedzame grond." },
  { q: "In welk seizoen zaai je de meeste groenten?", opts: ["Winter", "Lente", "Herfst", "Het maakt niet uit"], correct: 1 , niveau: 1, weetje: "Veel groenten zaai je in de lente, maar sla en spinazie kun je ook in de herfst zaaien." },
  { q: "Wat is een peul (zoals bij erwten) eigenlijk?", opts: ["Een wortel", "Een zaaddoos met zaadjes erin", "Een blad", "Een bloem"], correct: 1 , niveau: 2, weetje: "Erwten en bonen zijn vlinderbloemigen: met hulp van bacteriën in hun wortels maken ze stikstof voor de bodem." },
  { q: "Welke groente is eigenlijk een vrucht, net als een appel?", opts: ["Wortel", "Tomaat", "Ui", "Aardappel"], correct: 1 , niveau: 2, weetje: "Voor een plantkundige is een vrucht het deel met de zaden, dus ook komkommer en courgette zijn vruchten." },
  { q: "Waarom worden bijen graag gezien in de moestuin?", opts: ["Ze bestuiven de bloemen van je groenten", "Ze eten onkruid", "Ze maken de grond los", "Ze houden vogels weg"], correct: 0 , niveau: 1, weetje: "Zonder bijen krijg je veel minder tomaten, courgettes en appels." },
  // Insecten & kleine beestjes
  { q: "Wat bouwt een rups vlak voordat hij verandert in een vlinder?", opts: ["Een holletje in de grond", "Een vogelnest", "Een cocon of pop", "Een web"], correct: 2 , niveau: 1, weetje: "In de pop wordt de rups helemaal omgebouwd tot vlinder: dat heet metamorfose." },
  { q: "Hoeveel wandelende poten heeft een volwassen spin?", opts: ["6 poten", "8 poten", "10 poten", "12 poten"], correct: 1 , niveau: 1, weetje: "Spinnen hebben acht poten en twee lichaamsdelen; insecten hebben zes poten en drie lichaamsdelen." },
  { q: "Wat is de favoriete snack van een hongerig lieveheersbeestje?", opts: ["Gras", "Bladluizen", "Nectar", "Rijp fruit"], correct: 1 , niveau: 1, weetje: "Een lieveheersbeestje en zijn larve eten heel veel bladluizen: een cadeau voor je planten." },
  { q: "Hoeveel poten heeft een insect?", opts: ["4 poten", "6 poten", "8 poten", "10 poten"], correct: 1 , niveau: 1, weetje: "Insecten hebben drie lichaamsdelen: kop, borststuk en achterlijf." },
  { q: "Wat maakt een spinnenweb zo sterk?", opts: ["Het is van metaal", "De zijdedraad is heel elastisch en sterk", "Het is nat", "Het is dik als touw"], correct: 1 , niveau: 2, weetje: "Spinnenzijde is bij dezelfde dikte sterker dan staal en tegelijk elastisch." },
  { q: "Hoe communiceren mieren vooral met elkaar?", opts: ["Met geluid", "Met geurstoffen", "Met kleuren", "Met dansjes in de lucht"], correct: 1 , niveau: 2, weetje: "Mieren laten geursporen achter, zo vinden ze de weg naar eten en terug naar het nest." },
  { q: "Wat doet een bij als ze een goede bloem gevonden heeft?", opts: ["Ze schreeuwt", "Ze doet een 'bijendans' om het aan anderen te laten weten", "Ze slaapt", "Ze vliegt meteen naar huis"], correct: 1 , niveau: 3, weetje: "Door de richting en de duur van haar dans vertelt een bij hoe ver en waar de bloemen zijn." },
  { q: "Welk klein beestje rolt zich op tot een balletje als het schrikt?", opts: ["Oorworm", "Pissebed", "Mier", "Vlieg"], correct: 1 , niveau: 1, weetje: "Een pissebed is geen insect maar familie van krabben en garnalen." },
  { q: "Hoeveel stadia doorloopt een vlinder in zijn leven?", opts: ["2", "3", "4", "5"], correct: 2 , niveau: 2, weetje: "Ei, rups, pop, vlinder: dat noemen we een volledige gedaanteverwisseling." },
  { q: "Wat eten de meeste volwassen vlinders?", opts: ["Bladeren", "Nectar", "Andere insecten", "Aarde"], correct: 1 , niveau: 1, weetje: "Vlinders drinken met een lange roltong, die ze oprollen als ze hem niet gebruiken." },
  // Vogels
  { q: "Welke vogel in België is opvallend groen en klopt op boomstammen?", opts: ["Merel", "Groene specht", "Mus", "Kraai"], correct: 1 , niveau: 2, weetje: "De groene specht vangt mieren met zijn extra lange, kleverige tong; zijn roep klinkt als een lach." },
  { q: "Waarvan zijn de meeste vogelnesten gemaakt?", opts: ["Steen", "Takjes, mos en veren", "Plastic", "Zand"], correct: 1 , niveau: 1, weetje: "Heb je een nest gevonden, blijf er dan weg om de vogels niet te storen." },
  { q: "Welke vogel is bekend om zijn roep en legt eitjes in nesten van andere vogels?", opts: ["Merel", "Koekoek", "Mus", "Ekster"], correct: 1 , niveau: 2, weetje: "Een jonge koekoek wordt groot gebracht door pleegouders, zoals een rietzanger of een heggenmus." },
  { q: "Waar zijn donsveertjes vooral goed voor?", opts: ["Vliegen", "Warmte vasthouden", "Zwemmen", "Zingen"], correct: 1 , niveau: 2, weetje: "Donsveertjes sluiten lucht tussen hun pluisjes in, en lucht houdt warmte vast." },
  { q: "Hoe noemen we vogels die 's winters naar warmere landen trekken?", opts: ["Standvogels", "Trekvogels", "Roofvogels", "Watervogels"], correct: 1 , niveau: 1, weetje: "Zwaluwen vliegen elk jaar duizenden kilometers naar Afrika en terug." },
  { q: "Wat eten kleine tuinvogels vooral in de winter bij een voederplek?", opts: ["Vlees", "Zaden en vetbollen", "Enkel fruit", "Water"], correct: 1 , niveau: 1, weetje: "Geef geen brood aan vogels, dat is ongezond voor hen; kies zaden, pinda's of vetbollen zonder plastic netje." },
  { q: "Welke vogel is een grote roofvogel die je in België kan zien?", opts: ["Mus", "Buizerd", "Merel", "Mees"], correct: 1 , niveau: 2, weetje: "Een buizerd zit vaak op een paal of in een boom en vangt vooral muizen." },
  { q: "Waaraan herken je een merel-mannetje meestal?", opts: ["Bruine veren", "Zwarte veren met gele snavel", "Witte veren", "Blauwe veren"], correct: 1 , niveau: 1, weetje: "Vrouwelijke merels zijn bruin; alleen de mannetjes zijn zwart met een gele snavel." },
  { q: "Waar gebruikt een vogel zijn snavel NIET voor?", opts: ["Eten pakken", "Nest bouwen", "Zwemmen onder water als een vis", "Veren verzorgen"], correct: 2 , niveau: 2, weetje: "Een snavel dient om te eten, om veren te poetsen, om nesten te bouwen en soms om zich te verdedigen." },
  { q: "Hoe heet een jonge vogel die nog niet kan vliegen?", opts: ["Kuiken", "Larve", "Rups", "Pop"], correct: 0 , niveau: 1, weetje: "Een kuiken heeft eerst dons; zijn echte veren groeien later." },
  // Zoogdieren
  { q: "Wat is het grootste zoogdier ter wereld?", opts: ["Olifant", "Blauwe vinvis", "Giraffe", "Neushoorn"], correct: 1 , niveau: 1, weetje: "Een blauwe vinvis kan wel 30 meter lang worden en eet vooral heel kleine kreeftjes: krill." },
  { q: "Hoe noem je een dier dat alleen planten eet?", opts: ["Vleeseter", "Planteneter", "Alleseter", "Aaseter"], correct: 1 , niveau: 1, weetje: "Planteneters hebben vaak brede kiezen om gras te malen; koeien herkauwen hun eten." },
  { q: "Welk dier houdt een winterslaap in België?", opts: ["Vos", "Egel", "Konijn", "Eekhoorn"], correct: 1 , niveau: 1, weetje: "Een egel slaapt grofweg van november tot maart; een hoop bladeren en hout is een goede schuilplaats." },
  { q: "Wat is typisch aan alle zoogdieren?", opts: ["Ze leggen eieren", "Ze geven hun jongen melk", "Ze hebben schubben", "Ze kunnen allemaal vliegen"], correct: 1 , niveau: 2, weetje: "Ook walvissen, vleermuizen en mensen zijn zoogdieren." },
  { q: "Welk dier graaft gangen en maakt de aarde luchtiger?", opts: ["Vlinder", "Mol", "Merel", "Kikker"], correct: 1 , niveau: 1, weetje: "Een mol eet vooral regenwormen; molshopen zijn aarde die hij uit zijn gangen duwt." },
  { q: "Wat legt een eekhoorn vooral aan in de herfst?", opts: ["Een voorraad noten en zaden", "Een nest van modder", "Water", "Niets bijzonders"], correct: 0 , niveau: 1, weetje: "Eekhoorns vergeten soms waar ze noten begroeven, zo planten ze nieuwe bomen." },
  { q: "Hoe vindt een vleermuis zijn weg in het donker?", opts: ["Met zijn ogen", "Met echolocatie (geluidsgolven)", "Met zijn neus", "Met zijn staart"], correct: 1 , niveau: 3, weetje: "Een vleermuis roept geluiden die wij niet horen en luistert naar de echo." },
  { q: "Welk Belgisch bosdier heeft een rode vacht en een pluimstaart?", opts: ["Wolf", "Vos", "Das", "Otter"], correct: 1 , niveau: 1, weetje: "Vossen leven niet alleen in bossen, maar ook in steden en tuinen." },
  { q: "Wat is een duidelijk kenmerk van een egel?", opts: ["Zachte vacht", "Stekels op zijn rug", "Vinnen", "Een lange snuit als een olifant"], correct: 1 , niveau: 1, weetje: "Een egel heeft zo'n 5000 tot 7000 stekels en rolt zich op als hij schrikt." },
  { q: "Welk dier draagt zijn baby in een buidel?", opts: ["Konijn", "Kangoeroe", "Egel", "Vos"], correct: 1 , niveau: 1, weetje: "Een jonge kangoeroe is bij de geboorte kleiner dan een snoepboon en kruipt zelf naar de buidel." },
  // Water & vijverleven
  { q: "Hoe noemen we een kikker als hij nog een staart heeft en in het water leeft?", opts: ["Larve", "Dikkopje", "Ei", "Pop"], correct: 1 , niveau: 2, weetje: "Een dikkopje ademt met kieuwen; later krijgt hij longen." },
  { q: "Welk dier draagt zijn huis op zijn rug?", opts: ["Slak", "Kikker", "Vis", "Eend"], correct: 0 , niveau: 1, weetje: "Het slakkenhuis groeit mee met de slak." },
  { q: "Wat gebruiken vissen om zuurstof uit water te halen?", opts: ["Longen", "Kieuwen", "Neusgaten", "Alleen hun huid"], correct: 1 , niveau: 2, weetje: "Kieuwen halen de opgeloste zuurstof uit het water dat er langs stroomt." },
  { q: "Welk beestje kan op het wateroppervlak 'schaatsen' zonder te zinken?", opts: ["Waterschaatser", "Kikker", "Vis", "Slak"], correct: 0 , niveau: 2, weetje: "Een waterschaatser blijft drijven dankzij de oppervlaktespanning van het water." },
  { q: "Wat is een typisch verschil tussen een kikker en een pad?", opts: ["Geen verschil", "Padden hebben meestal een drogere, bultige huid", "Kikkers leven alleen op het land", "Padden kunnen vliegen"], correct: 1 , niveau: 3, weetje: "Padden hebben een bultige huid en lopen eerder dan ze springen; veel padden trekken in de lente naar hun geboorteplas." },
  { q: "Wat eten de meeste vijverkikkers?", opts: ["Alleen planten", "Insecten en andere kleine beestjes", "Steentjes", "Alleen vis"], correct: 1 , niveau: 1, weetje: "Een kikker vangt zijn prooi met een kleverige tong die razendsnel uitschiet." },
  { q: "Wat leggen kikkers in het water?", opts: ["Kikkerdril (eitjes)", "Jongen die al kunnen springen", "Nesten", "Niets"], correct: 0 , niveau: 1, weetje: "Kikkerdril ziet er uit als gelei met zwarte stipjes; elk stipje is een eitje. Haal het niet uit de vijver." },
  { q: "Welke waterplant drijft met ronde bladeren op het wateroppervlak?", opts: ["Waterlelie", "Cactus", "Varen", "Klaver"], correct: 0 , niveau: 1, weetje: "Waterlelies hebben lange stelen die tot op de bodem van de vijver reiken." },
  { q: "Wat gebeurt er met een dikkopje als hij groeit?", opts: ["Hij krijgt vleugels", "Hij krijgt poten en verliest zijn staart", "Hij wordt een vis", "Er verandert niets"], correct: 1 , niveau: 2, weetje: "Eerst groeien de achterpoten, dan de voorpoten, en de staart wordt opgenomen in het lichaam." },
  { q: "Wat is een amfibie?", opts: ["Een dier dat zowel in water als op land kan leven", "Een dier dat alleen vliegt", "Een plant", "Een insect"], correct: 0 , niveau: 3, weetje: "Het woord amfibie komt uit het Grieks en betekent zoiets als 'dubbelleven'." },
  // Seizoenen & weer
  { q: "In welk seizoen beginnen de meeste bomen weer bladeren te krijgen?", opts: ["Winter", "Lente", "Zomer", "Herfst"], correct: 1 , niveau: 1, weetje: "Knoppen zwellen op als de dagen langer worden en het warmer wordt." },
  { q: "Wat gebeurt er met de dagen in de zomer?", opts: ["Ze worden korter", "Ze worden langer", "Ze blijven gelijk", "Ze verdwijnen"], correct: 1 , niveau: 1, weetje: "Op de langste dag van het jaar gaat de zon bij ons pas rond tien uur 's avonds onder." },
  { q: "Welk seizoen komt na de zomer?", opts: ["Winter", "Lente", "Herfst", "Er komt niets na"], correct: 2 , niveau: 1, weetje: "In de herfst rijpen noten en bessen, en verschijnen veel paddenstoelen." },
  { q: "Waarom vallen bladeren in de herfst van de bomen?", opts: ["De boom is ziek", "De boom bereidt zich voor op de winter", "De wind waait ze er per ongeluk af", "Vogels trekken ze eraf"], correct: 1 , niveau: 2, weetje: "De boom sluit de bladstelen af met een laagje kurk, zodat het blad zonder wondje kan vallen." },
  { q: "Wat is rijp (vorst)?", opts: ["Bevroren waterdruppels op koude oppervlakken", "Een soort regen", "Warme lucht", "Een soort wind"], correct: 0 , niveau: 2, weetje: "Rijp ontstaat als waterdamp op koude oppervlakken meteen bevriest." },
  { q: "In welk seizoen zie je de meeste bloemen bloeien in de tuin?", opts: ["Winter", "Lente en zomer", "Alleen herfst", "Nooit"], correct: 1 , niveau: 1, weetje: "Veel bloemen bloeien in de lente en zomer, wanneer bijen en vlinders actief zijn." },
  { q: "Wat doen veel dieren als de winter eraan komt en voedsel schaars wordt?", opts: ["Ze verhuizen naar de zee", "Winterslaap houden of wegtrekken", "Ze veranderen van kleur naar roze", "Niets bijzonders"], correct: 1 , niveau: 2, weetje: "Sommige dieren, zoals de vleermuis, slapen in de winter; andere, zoals de zwaluw, trekken weg." },
  { q: "Wat is dauw op het gras 's ochtends vroeg?", opts: ["Gesmolten sneeuw", "Kleine waterdruppeltjes uit de lucht", "Regen die net gevallen is", "Zweet van de plant"], correct: 1 , niveau: 2, weetje: "Dauw ontstaat als waterdamp uit de lucht op koud gras condenseert." },
  { q: "Welk seizoen heeft meestal de kortste dagen en langste nachten?", opts: ["Zomer", "Winter", "Lente", "Herfst"], correct: 1 , niveau: 1, weetje: "Rond 21 december is de dag het kortst; daarna worden de dagen weer langer." },
  { q: "Wat hebben planten vooral nodig om goed te groeien in de lente?", opts: ["Enkel duisternis", "Water, licht en warmte", "Alleen sneeuw", "Niets"], correct: 1 , niveau: 1, weetje: "Warmte, licht en water zorgen ervoor dat zaden ontkiemen en planten in de lente groeien." },
  // Natuur & milieu algemeen
  { q: "Wat is een voedselketen?", opts: ["Een keten om fietsen vast te maken", "Hoe dieren en planten elkaar opeten voor energie", "Een soort plant", "Een weg door het bos"], correct: 1 , niveau: 2, weetje: "Een voedselketen begint bij een plant en eindigt vaak bij een roofdier." },
  { q: "Waarom zijn bijen zo belangrijk voor de natuur?", opts: ["Ze maken honing en bestuiven bloemen en gewassen", "Ze houden muggen weg", "Ze maken geen geluid", "Ze zijn niet belangrijk"], correct: 0 , niveau: 1, weetje: "Zonder bestuivers zoals bijen, hommels en zweefvliegen krijgen veel gewassen minder vruchten." },
  { q: "Wat is compost?", opts: ["Afval dat wordt weggegooid", "Verteerd organisch materiaal dat de bodem voedt", "Een soort plastic", "Een soort insect"], correct: 1 , niveau: 2, weetje: "Compost is donkere, kruimelige grond die ontstaat uit keuken- en tuinafval." },
  { q: "Wat betekent het als een diersoort 'bedreigd' is?", opts: ["Er zijn er heel veel", "Er zijn er nog maar weinig en ze kunnen uitsterven", "Ze zijn gevaarlijk voor mensen", "Ze leven niet meer in het wild"], correct: 1 , niveau: 2, weetje: "Je helpt bedreigde dieren door hun leefgebied te beschermen, bijvoorbeeld met een wilde hoek in de tuin." },
  { q: "Wat doen wormen voor de bodem?", opts: ["Ze maken de grond luchtig en verrijken ze", "Ze maken de grond hard", "Ze eten planten kapot", "Niets nuttigs"], correct: 0 , niveau: 1, weetje: "Regenwormen trekken bladeren de grond in, zo komen voedingsstoffen in de bodem." },
  { q: "Wat is een ecosysteem?", opts: ["Een computer", "Een gemeenschap van planten en dieren die samen leven", "Een soort weer", "Een moestuin alleen"], correct: 1 , niveau: 3, weetje: "Een vijver, een bos of zelfs een rotte boomstam is een eigen ecosysteem." },
  { q: "Waarom is het belangrijk om afval niet in de natuur te gooien?", opts: ["Het kan dieren en planten schaden", "Het maakt niets uit", "Dieren vinden het lekker", "Het helpt planten groeien"], correct: 0 , niveau: 1, weetje: "Plastic verdwijnt in de natuur niet echt: het valt uiteen in steeds kleinere stukjes." },
  { q: "Wat is recycleren?", opts: ["Afval weggooien in de natuur", "Materialen hergebruiken in plaats van weggooien", "Planten water geven", "Dieren voeden"], correct: 1 , niveau: 1, weetje: "Van plastic flessen kun je nieuwe producten maken, zoals warme truien." },
  { q: "Welk gas produceren planten dat belangrijk is om te ademen?", opts: ["Koolstofdioxide", "Zuurstof", "Stikstof", "Methaan"], correct: 1 , niveau: 1, weetje: "Planten maken zuurstof bij de fotosynthese; wij ademen die in." },
  { q: "Waarom groeien planten vaak richting het licht?", opts: ["Toeval", "Ze hebben licht nodig voor fotosynthese", "Ze zijn bang in het donker", "Licht maakt ze zwaarder"], correct: 1 , niveau: 2, weetje: "Dat heet fototropisme: de plant buigt naar het licht toe." },
  // Extra vragen (niveau-gemengd)
  { q: "Wat noemen we het topje van een wortel dat de plant dieper de grond in laat groeien?", opts: ["Wortelharen", "Groeipunt (wortelpunt)", "Bladsteel", "Knop"], correct: 1, niveau: 3, weetje: "De wortelmuts beschermt het groeiende worteltopje terwijl het door de aarde duwt." },
  { q: "Wat doet een plant als er te weinig licht is?", opts: ["Ze groeit sneller", "Ze groeit slap en zoekt naar meer licht", "Ze bloeit sneller", "Niets verandert"], correct: 1, niveau: 2, weetje: "Een plant met te weinig licht wordt lang, bleek en slap." },
  { q: "Wat is een 'kroon' bij een boom?", opts: ["De wortels", "Het bovenste deel met takken en bladeren", "De stam", "De schors"], correct: 1, niveau: 2, weetje: "In de kroon van een oude boom wonen vogels, insecten en soms vleermuizen." },
  { q: "Welke boom verliest zijn bladeren NIET in de winter?", opts: ["Eik", "Beuk", "Den (naaldboom)", "Berk"], correct: 2, niveau: 1, weetje: "Een lork is een naaldboom die in de herfst wel zijn naalden verliest." },
  { q: "Wat trekt vlinders vooral aan bij een bloem?", opts: ["De kleur en geur", "Het gewicht", "De vorm van het blad", "De hoogte van de plant"], correct: 0, niveau: 1, weetje: "Vlinders proeven met hun voeten." },
  { q: "Wat gebeurt er meestal als een bloem niet bestoven wordt?", opts: ["Ze maakt gewoon een vrucht", "Er komt meestal geen vrucht of zaad", "Ze wordt groter", "Niets"], correct: 1, niveau: 2, weetje: "Daarom zijn bestuivers zo belangrijk voor fruit, zoals appels en kersen." },
  { q: "Welke groente kan je nog in de winter oogsten uit een moestuin?", opts: ["Boerenkool", "Meloen", "Aardbei", "Komkommer"], correct: 0, niveau: 2, weetje: "Boerenkool wordt zoeter na een nachtje vorst." },
  { q: "Waarom draai je vruchtgroenten elk jaar naar een andere plek in de moestuin?", opts: ["Om de bodem niet uit te putten en ziektes te voorkomen", "Om ze mooier te laten groeien", "Omdat het verplicht is", "Geen reden"], correct: 0, niveau: 3, weetje: "Dit heet vruchtwisseling: elke plant haalt andere voedingsstoffen uit de grond." },
  { q: "Wat is het nut van een oorworm in de tuin?", opts: ["Hij eet schadelijke bladluizen", "Hij is enkel schadelijk", "Hij eet alleen hout", "Geen enkel nut"], correct: 0, niveau: 2, weetje: "Een oorworm eet bladluizen, maar soms ook jonge blaadjes en bloemblaadjes." },
  { q: "Hoeveel poten heeft een duizendpoot ongeveer?", opts: ["6", "8", "Heel veel (tientallen tot honderden)", "Geen poten"], correct: 2, niveau: 1, weetje: "De duizendpoot met de meeste poten heeft er 1306, maar de meeste soorten hebben er veel minder." },
  { q: "Wat is een broedseizoen?", opts: ["De periode waarin vogels eieren leggen en jongen grootbrengen", "De periode waarin vogels wegtrekken", "De winter", "Een soort vogelgeluid"], correct: 0, niveau: 2, weetje: "Snoei in die periode liever geen heggen, zodat je geen nesten verstoort." },
  { q: "Welke vogel zwemt en duikt goed en heeft zwemvliezen?", opts: ["Mus", "Eend", "Merel", "Specht"], correct: 1, niveau: 1, weetje: "Eenden poetsen hun veren met olie uit een klier bij hun staart, zo blijven ze waterdicht." },
  { q: "Wat is het verschil tussen een haas en een konijn?", opts: ["Geen verschil", "Hazen zijn groter en hun jongen kunnen meteen lopen", "Konijnen leven in bomen", "Hazen zijn vissen"], correct: 1, niveau: 3, weetje: "Een jonge haas wordt geboren met open ogen en een vacht; een jong konijn is kaal en blind." },
  { q: "Hoe noemen we de ondergrondse woning van een das?", opts: ["Hol / burcht", "Nest", "Kooi", "Web"], correct: 0, niveau: 2, weetje: "Een das graaft een burcht met gangen en kamers, soms al generaties lang gebruikt." },
  { q: "Wat is de taak van riet aan de rand van een vijver?", opts: ["Het zuivert het water en biedt schuilplaats aan dieren", "Het maakt het water vies", "Het heeft geen enkele functie", "Het trekt alleen muggen aan"], correct: 0, niveau: 3, weetje: "Riet geeft schuilplaats aan vogels zoals de rietzanger." },
  { q: "Waar leggen de meeste waterinsecten hun eitjes?", opts: ["In de lucht", "In of bij het water", "Onder de grond", "In bomen"], correct: 1, niveau: 2, weetje: "Libellenlarven leven soms jarenlang onder water voor ze als libel uitkomen." },
  { q: "Wat is een typisch teken dat de lente begint in de natuur?", opts: ["Bomen verliezen hun bladeren", "Sneeuwklokjes en krokussen beginnen te bloeien", "Alle dieren gaan slapen", "Het wordt overal kouder"], correct: 1, niveau: 1, weetje: "Sneeuwklokjes en krokussen bloeien vroeg omdat ze voedsel bewaren in een bolletje onder de grond." },
  { q: "Waarom trekken sommige vogels in de herfst naar het zuiden?", opts: ["Om vakantie te vieren", "Om voedsel te vinden waar het warmer is", "Ze houden van vliegen", "Zonder reden"], correct: 1, niveau: 2, weetje: "Veel vogels vertrekken niet door de kou, maar omdat er in de winter te weinig insecten zijn." },
  { q: "Wat is biodiversiteit?", opts: ["Een soort plastic", "De verscheidenheid aan planten en dieren in een gebied", "Een soort weer", "Een moestuintechniek"], correct: 1, niveau: 3, weetje: "Hoe meer soorten, hoe sterker een ecosysteem: het kan beter tegen ziekte en droogte." },
  { q: "Waarom is het goed om inheemse (van nature bij ons voorkomende) planten in je tuin te zetten?", opts: ["Ze trekken lokale insecten en vogels beter aan", "Ze zijn altijd goedkoper", "Ze hebben geen water nodig", "Geen enkele reden"], correct: 0, niveau: 3, weetje: "Een inheemse eik herbergt meer dan 200 soorten insecten, veel meer dan de meeste uitheemse bomen." },
  // Extra vragen: dieren, bos, park, dierentuin (v2)
  { q: "Hoe heet het jong van een kikker?", opts: ["Rups", "Kikkervisje", "Pop", "Veulen"], correct: 1, niveau: 1, weetje: "Een kikkervisje ademt met kieuwen en eet vooral algen." },
  { q: "Welke vrucht groeit aan een eik?", opts: ["Dennenappel", "Kastanje", "Eikel", "Beukennootje"], correct: 2, niveau: 1, weetje: "Een eik begint pas na tientallen jaren eikels te dragen." },
  { q: "Wat eet een panda bijna uitsluitend?", opts: ["Vis", "Bamboe", "Insecten", "Fruit"], correct: 1, niveau: 1, weetje: "Een reuzenpanda eet meer dan 10 kilo bamboe per dag." },
  { q: "Welk dier heeft de langste nek?", opts: ["Olifant", "Kameel", "Struisvogel", "Giraffe"], correct: 3, niveau: 1, weetje: "Een giraffe heeft net als wij maar zeven nekwervels, alleen zijn ze veel langer." },
  { q: "Wat is het grootste landdier?", opts: ["Neushoorn", "Giraffe", "Afrikaanse olifant", "Nijlpaard"], correct: 2, niveau: 1, weetje: "Een Afrikaanse olifant kan tot ongeveer 6 ton wegen." },
  { q: "Welk dier is het snelste op het land?", opts: ["Leeuw", "Paard", "Cheeta", "Struisvogel"], correct: 2, niveau: 2, weetje: "Een cheeta haalt in korte sprints ongeveer 100 kilometer per uur." },
  { q: "Hoe noemen we een groep wolven?", opts: ["Roedel", "Zwerm", "School", "Kudde"], correct: 0, niveau: 2, weetje: "Een wolvenroedel is meestal een familie: de ouders met hun jongen." },
  { q: "Wat zit er in de bult van een kameel?", opts: ["Water", "Lucht", "Spieren", "Vet"], correct: 3, niveau: 2, weetje: "In de bult zit vet, geen water: het is een energievoorraad." },
  { q: "Welk dier bouwt dammen in beken en rivieren?", opts: ["Egel", "Bever", "Das", "Vos"], correct: 1, niveau: 2, weetje: "Bevers zijn terug in België en hun dammen scheppen nieuwe leefplekken voor andere dieren." },
  { q: "Welke boom herken je aan zijn witte schors met zwarte vlekken?", opts: ["Berk", "Eik", "Den", "Plataan"], correct: 0, niveau: 2, weetje: "Een berk groeit snel op kale grond en is een echte pioniersboom." },
  { q: "Wat gebeurt er met een egel tijdens zijn winterslaap?", opts: ["Hij eet extra veel", "Zijn hartslag en lichaamstemperatuur dalen sterk", "Hij verhuist naar het zuiden", "Hij verandert van kleur"], correct: 1, niveau: 2, weetje: "Zijn hartslag zakt van zo'n 190 naar ongeveer 20 slagen per minuut." },
  { q: "Welke vogel kan zijn kop bijna helemaal omdraaien?", opts: ["Uil", "Mus", "Eend", "Duif"], correct: 0, niveau: 2, weetje: "Een uil heeft 14 nekwervels, twee keer zoveel als wij; daarom kan hij zijn kop zo ver draaien." },
  { q: "Welk reptiel kan van kleur veranderen?", opts: ["Krokodil", "Schildpad", "Kameleon", "Slang"], correct: 2, niveau: 2, weetje: "Een kameleon verandert vooral van kleur om te communiceren, niet alleen om zich te verstoppen." },
  { q: "Wat is een predator?", opts: ["Een plant", "Een jager die andere dieren eet", "Een prooidier", "Een plantenetend dier"], correct: 1, niveau: 2, weetje: "De vos en de uil zijn predatoren; muizen staan op hun menu." },
  { q: "Hoe kan je de leeftijd van een boomstam schatten?", opts: ["Aan de kleur van de bladeren", "Aan de lengte van de wortels", "Door de jaarringen te tellen", "Aan het aantal vogels"], correct: 2, niveau: 2, weetje: "Brede ringen betekenen goede jaren met veel water; smalle ringen droge of koude jaren." },
  { q: "Wat is het verschil tussen een carnivoor en een omnivoor?", opts: ["Carnivoren eten planten, omnivoren vlees", "Carnivoren eten vlees, omnivoren planten én vlees", "Er is geen verschil", "Omnivoren eten enkel insecten"], correct: 1, niveau: 3, weetje: "Mensen en beren zijn omnivoren." },
  { q: "Wat is symbiose?", opts: ["Twee soorten die samenleven en elkaar helpen", "Een dier dat een ander dier opeet", "Een plant die afsterft", "Een soort bodem"], correct: 0, niveau: 3, weetje: "Boomwortels en schimmels helpen elkaar: de schimmel geeft water en mineralen, de boom geeft suiker." },
  { q: "Wat is een parasiet?", opts: ["Een nuttige bij", "Een organisme dat op of in een ander leeft en daar voordeel van haalt", "Een eetbare paddenstoel", "Een dier dat enkel planten eet"], correct: 1, niveau: 3, weetje: "Een teek en een vlo zijn parasieten: ze leven van het bloed van hun gastheer." },
  { q: "Wat is een 'pionierplant'?", opts: ["Een plant die als eerste op kale grond groeit", "Een plant met stekels", "Een waterplant", "Een plant die enkel 's nachts bloeit"], correct: 0, niveau: 3, weetje: "Berken en wilgenroosjes groeien als eerste op kale grond en maken die geschikt voor andere planten." },
  { q: "Wat is humus?", opts: ["Een soort mos", "Een boomsoort", "Een dier in de bodem", "Vruchtbare laag van verteerde bladeren en plantenresten"], correct: 3, niveau: 3, weetje: "Humus houdt water en voedingsstoffen vast en maakt de bodem donker en kruimelig." },
  { q: "Waarom hebben flamingo's roze veren?", opts: ["Door pigmenten uit hun voedsel", "Ze verven zichzelf", "Door de zon", "Ze worden zo geboren"], correct: 0, niveau: 3, weetje: "Flamingo's worden roze door kleurstoffen in de algen en kreeftjes die ze eten." },
  { q: "Wat vertelt een dansende bij aan de andere bijen?", opts: ["Dat het gaat regenen", "Dat ze honing maakt", "Waar voedsel te vinden is", "Dat ze een partner zoekt"], correct: 2, niveau: 3, weetje: "Die dans heet de kwispeldans." },
  { q: "Welk zoogdier legt eieren?", opts: ["Egel", "Vogelbekdier", "Konijn", "Vleermuis"], correct: 1, niveau: 3, weetje: "Het vogelbekdier leeft in Australië, heeft een eendensnavel en de mannetjes hebben een gifspoor." },
  { q: "Waarom vliegen ganzen in V-vorm?", opts: ["Zo sparen ze energie", "Om mooier te zijn", "Om te kunnen praten", "Zodat jagers hen niet zien"], correct: 0, niveau: 3, weetje: "De vogel vooraan heeft het zwaarst, dus ze wisselen vaak van plaats." },
  { q: "Wat is het mycelium van een paddenstoel?", opts: ["De hoed", "Het onderaardse draadnetwerk dat voedsel opneemt", "De zaden", "De steel"], correct: 1, niveau: 3, weetje: "Een stukje mycelium onder de grond kan veel groter zijn dan de paddenstoelen die je boven de grond ziet. Eet nooit paddenstoelen op basis van een app." },
  { q: "Hoe noemen we een groep leeuwen?", opts: ["Zwerm", "Kudde", "Troep (pride)", "School"], correct: 2, niveau: 3, weetje: "Leeuwen zijn bijna de enige katachtigen die in een groep leven." },
  { q: "Welk deel van een bloem maakt het stuifmeel?", opts: ["Stamper", "Kelkblad", "Wortel", "Meeldraad (helmknop)"], correct: 3, niveau: 3, weetje: "Het stuifmeel zit op het topje van de meeldraad, de helmknop." },
  // Extra moeilijke vragen (niveau 3)
  { q: "Wat gebeurt er in de herfst met het chlorofyl in een blad?", opts: ["Het wordt afgebroken, zodat andere kleuren zichtbaar worden", "Het verdwijnt omdat het blad bevriest", "Het wordt omgezet in water", "Het blijft altijd even groen"], correct: 0, niveau: 3, weetje: "De gele en oranje kleuren zaten er al in, maar werden verborgen door het groen." },
  { q: "Hoe heten de minuscule openingen in een blad waar gassen in en uit gaan?", opts: ["Huidmondjes", "Wortelharen", "Nerven", "Kelkbladeren"], correct: 0, niveau: 3, weetje: "Op één blad kunnen duizenden huidmondjes zitten, vooral aan de onderkant." },
  { q: "Welke naaldboom verliest zijn naalden wel in de herfst?", opts: ["Lork", "Spar", "Den", "Taxus"], correct: 0, niveau: 3, weetje: "De naalden van een lork worden goudgeel voor ze vallen." },
  { q: "Waarmee vermenigvuldigen varens zich?", opts: ["Met sporen", "Met zaden in een vrucht", "Met bloemen en nectar", "Met knollen onder de grond"], correct: 0, niveau: 3, weetje: "Varens hebben geen bloemen of zaden; de sporen zitten vaak als bruine stipjes onder de bladeren." },
  { q: "Welke plant leeft op takken van bomen en haalt daar water en mineralen uit?", opts: ["Maretak", "Klimop", "Brandnetel", "Mos"], correct: 0, niveau: 3, weetje: "De maretak heeft ook groene blaadjes en maakt dus zelf suiker. Eet de witte bessen nooit: ze zijn giftig voor mensen." },
  { q: "Tot welke groep dieren horen spinnen?", opts: ["Spinachtigen", "Insecten", "Kreeftachtigen", "Duizendpoten"], correct: 0, niveau: 3, weetje: "Net als mijten en teken zijn spinnen spinachtigen, geen insecten." },
  { q: "Wat is een metamorfose?", opts: ["Een dier verandert helemaal van vorm tijdens zijn leven", "Een dier wisselt van huid", "Een dier gaat op reis", "Een dier eet iets anders"], correct: 0, niveau: 3, weetje: "Een rups wordt een vlinder en een kikkervisje een kikker: beide maken een metamorfose door." },
  { q: "Welke vogel kan achteruit vliegen?", opts: ["Kolibrie", "Merel", "Zwaluw", "Uil"], correct: 0, niveau: 3, weetje: "Een kolibrie kan ook stilhangen in de lucht door zijn vleugels razendsnel te bewegen." },
  { q: "Wat doen de meeste vleermuizen in België in de winter?", opts: ["Winterslaap in grotten of kelders", "Naar Afrika trekken", "Wakker blijven en jagen", "Eieren leggen"], correct: 0, niveau: 3, weetje: "Wakker worden kost een slapende vleermuis veel energie, dus verstoor een winterslaper nooit." },
  { q: "Waarom zijn veel dieren in een sneeuwlandschap wit?", opts: ["Zo vallen ze minder op", "Omdat ze het koud hebben", "Omdat ze ziek zijn", "Door het zonlicht"], correct: 0, niveau: 3, weetje: "Poolvossen en sneeuwhazen zijn in de winter wit en in de zomer bruin of grijs." },
  { q: "Wie staat onderaan bijna elke voedselketen op het land?", opts: ["Planten", "Roofdieren", "Insecten", "Schimmels"], correct: 0, niveau: 3, weetje: "Planten maken met zonlicht hun eigen voedsel; alle andere dieren leven direct of indirect van hen." },
  { q: "Welke levende wezens breken gevallen bladeren in de bodem af?", opts: ["Schimmels en bacteriën", "Bijen", "Vlinders", "Mussen"], correct: 0, niveau: 3, weetje: "Zo komen voedingsstoffen terug in de grond en kunnen nieuwe planten groeien." },
  { q: "Wat is een invasieve exoot?", opts: ["Een uitheemse soort die inheemse soorten verdringt", "Een zeldzame inheemse soort", "Een huisdier", "Een soort die in zee leeft"], correct: 0, niveau: 3, weetje: "In België zijn bijvoorbeeld de Japanse duizendknoop en de reuzenberenklauw invasief. Raak reuzenberenklauw nooit aan: het sap veroorzaakt brandwonden in de zon." },
  { q: "Welk licht kunnen bijen zien dat wij niet zien?", opts: ["Ultraviolet licht", "Infrarood licht", "Röntgenlicht", "Radiogolven"], correct: 0, niveau: 3, weetje: "Veel bloemen hebben patronen in UV-licht die bijen de weg naar de nectar wijzen." },
  { q: "Hoe noemen we dieren die hun lichaamstemperatuur niet zelf regelen, zoals hagedissen?", opts: ["Wisselwarm", "Gelijkwarm", "Warmbloedig", "Nachtdier"], correct: 0, niveau: 3, weetje: "Daarom zonnen hagedissen op een warme steen voor ze op jacht gaan." },
  { q: "Waar stijgt het water in een boom omhoog van de wortels naar de bladeren?", opts: ["In dunne buisjes in het hout", "In de buitenste schors", "In de bladeren", "In de bloemen"], correct: 0, niveau: 3, weetje: "Dat water kan tientallen meters stijgen, zonder pomp." },
  { q: "Wat is een monocultuur?", opts: ["Een veld met maar één soort gewas", "Een tuin vol wilde bloemen", "Een bos met veel soorten", "Een moestuin met kruiden"], correct: 0, niveau: 3, weetje: "Plagen en ziektes verspreiden zich er sneller, en er leven minder dieren dan in een gemengd gebied." },
  { q: "Waar vervoert een werkbij stuifmeel?", opts: ["In pollenkorfjes op haar achterpoten", "In haar maag", "In haar angel", "Onder haar vleugels"], correct: 0, niveau: 3, weetje: "Dat zie je als gele of oranje bolletjes aan haar poten." },
  { q: "Hoe noemen we een dier dat vooral dode dieren (aas) eet?", opts: ["Aaseter", "Zaadeter", "Vruchteneter", "Bladeter"], correct: 0, niveau: 3, weetje: "Kraaien en raven ruimen zo dode dieren op en houden de natuur schoon." },
  { q: "Waarom kunnen uilen bijna geluidloos vliegen?", opts: ["Hun veren hebben zachte, gekartelde randen", "Ze vliegen heel hoog", "Ze hebben heel kleine vleugels", "Ze vliegen alleen als het regent"], correct: 0, niveau: 3, weetje: "Zo horen hun prooien, zoals muizen, ze niet aankomen." },
  { q: "Waarmee kunnen kikkers deels ademen?", opts: ["Met hun huid", "Met kieuwen als volwassen dier", "Met hun tong", "Met hun ogen"], correct: 0, niveau: 3, weetje: "Daarom is hun huid altijd vochtig en zijn kikkers gevoelig voor vervuild water." },
  { q: "Welke planten maken met hulp van bacteriën in hun wortels stikstof voor de bodem?", opts: ["Vlinderbloemigen, zoals klaver en bonen", "Grassen", "Varens", "Mossen"], correct: 0, niveau: 3, weetje: "Daarom zaaien tuiniers soms klaver of bonen om de grond te verrijken." },
  { q: "Waarom hebben veel planten felrode bessen?", opts: ["Om vogels aan te trekken die de zaden verspreiden", "Om bijen te waarschuwen", "Om zich warm te houden", "Om water vast te houden"], correct: 0, niveau: 3, weetje: "Maar eet nooit zomaar bessen: veel zijn giftig voor mensen." },
  { q: "Welke dieren noemen we gewervelden?", opts: ["Dieren met een ruggengraat", "Dieren zonder skelet", "Dieren met zes poten", "Dieren die eieren leggen"], correct: 0, niveau: 3, weetje: "Zoogdieren, vogels, reptielen, amfibieën en vissen zijn gewervelden; insecten niet." },
  { q: "Welk orgaan helpt een beenvis om op een bepaalde diepte te blijven?", opts: ["De zwemblaas", "De kieuwen", "De staart", "De schubben"], correct: 0, niveau: 3, weetje: "De zwemblaas is een met gas gevulde zak: vult de vis hem meer, dan stijgt hij." },
  { q: "Waarvoor dienen de nerven in een blad?", opts: ["Water en voedingsstoffen vervoeren en het blad stevig houden", "Zonlicht opvangen", "Insecten lokken", "Zaden maken"], correct: 0, niveau: 3, weetje: "De nerven zijn de buisjes en het skelet van het blad." },
  { q: "Waarom is dood hout in een bos zo waardevol?", opts: ["Er leven veel kevers, schimmels en vogels in", "Het houdt het bos warm", "Het maakt het bos gevaarlijker", "Het is nutteloos afval"], correct: 0, niveau: 3, weetje: "Spechten, vleermuizen en tientallen soorten kevers gebruiken dood hout als thuis of voedsel." },
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
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 },
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

function AppInner() {
  const [screen, setScreen] = useState("home");
  const [keys, setKeys] = useState(loadKeys());
  const [kidsMode, setKidsMode] = useState(localStorage.getItem(LS_KEYS.kidsMode) === "1");
  const [history, setHistory] = useState(loadHistory());
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [toonSleutels, setToonSleutels] = useState(false);
  const [backupBericht, setBackupBericht] = useState("");
  const [diagBericht, setDiagBericht] = useState("");
  const [diagTeller, setDiagTeller] = useState(0);
  const [opslagVol, setOpslagVol] = useState(false);
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
  const [stemInfo, setStemInfo] = useState("");
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
  
  const bewaarScan = async (entry) => {
    const thumb = await makeThumb(entry.image);
    const verwacht = history.length + 1;
    const bewaard = saveHistory([{ ...entry, image: thumb }, ...history]);
    setHistory(bewaard);
    if (bewaard.length < verwacht) setOpslagVol(true);
  };

  const exporteerDiagnose = () => {
    try {
      const blob = new Blob([makeDiagExport()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `natuurscanner-diagnose-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setDiagBericht(`✅ Diagnose-export gemaakt (${loadDiag().length} scans in het logboek).`);
    } catch (err) {
      setDiagBericht("⚠️ Diagnose-export mislukt: " + (err && err.message ? err.message : ""));
    }
  };

  const exporteerBackup = () => {
    try {
      const blob = new Blob([makeBackup(history)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `natuurscanner-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setOpslagVol(false);
      setBackupBericht(`✅ Back-up met ${history.length} scans gemaakt. Bewaar het bestand op een veilige plek.`);
    } catch (err) {
      setBackupBericht("⚠️ Back-up maken mislukt: " + (err && err.message ? err.message : ""));
    }
  };

  const importeerBackup = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const p = parseBackup(String(reader.result || ""));
      if (!p.ok) { setBackupBericht("⚠️ " + p.fout); return; }
      const m = mergeHistory(history, p.scans);
      const bewaard = saveHistory(m.lijst);
      setHistory(bewaard);
      const nietBewaard = m.lijst.length - bewaard.length;
      setBackupBericht(`✅ ${m.toegevoegd} scans toegevoegd (${m.alAanwezig} stonden er al${p.overgeslagen ? `, ${p.overgeslagen} ongeldig overgeslagen` : ""}).` + (nietBewaard > 0 ? ` ⚠️ De opslag was vol: ${nietBewaard} oudste scans pasten niet.` : ""));
    };
    reader.onerror = () => setBackupBericht("⚠️ Het bestand kon niet gelezen worden.");
    reader.readAsText(f);
    e.target.value = "";
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
          updateStats((s) => ({ ...s, sterren: s.sterren + 1 }));
          setSafariBericht(`🎉 ${res.uitleg}`);
          setSafariOpdracht(pickNextMissionIndex(missieList, safariOpdracht, safariOmgeving));
        } else {
          setSafariBericht(`🤔 ${res.uitleg}`);
        }
        setTimeout(() => setSafariBericht(""), 5000);
      } catch (err) {
        logDiag({ type: "safari", fout: String(err && err.message).slice(0, 200) });
        setError("Safari controle mislukt. " + (err && err.message ? err.message : ""));
      }
      setScanMode("general");
      setScreen("safari");
      return;
    }

    if (mode === "animal") {
      try {
        if (!keys.gemini) throw new Error("Gemini API-sleutel ontbreekt.");
        const res = await callGemini(base64, keys.gemini, `Bioloog. Identificeer dit dier of insect, EN beoordeel meteen hoe het dier er op de foto bij lijkt te staan (zichtbare verwondingen, ziektetekens, uitputting, of gewoon gezond) EN geef een korte praktische verzorgings-/omgangstip (bv. wat te doen als je dit dier tegenkomt, hoe ermee om te gaan, of wanneer hulp van een volwassene/dierenarts nodig is). JSON: {"name":"Naam","scientificName":"Wetenschappelijk","klasse":"Klasse","familie":"Familie","leefgebied":"Habitat","leeftijd":"Schatting leeftijd","weetje":"Leuk weetje.","gezond":true/false,"gezondheidsopmerking":"Wat je ziet aan de gezondheid/toestand van het dier op de foto.","verzorgingstip":"Praktisch advies over verzorging/omgang met dit dier."}`);
        const dc = bouwDierControles(res);
        const entry = cleanEntry({ id: Date.now(), date: new Date().toLocaleDateString("nl-BE"), image: dataUrl, type: "animal", score: null, source: "Gemini AI", ...dc.res, controles: dc.controles });
        logDiag(diagVoorScan(entry));
        await bewaarScan(entry);
        setResult(entry);
        setScreen("result");
      } catch (err) {
        logDiag({ type: "animal", fout: String(err && err.message).slice(0, 200) });
        setError("Dier niet herkend: " + err.message);
        setScreen("home");
      }
      setScanMode("general");
      return;
    }

    try {
      const plantData = await identifyPlant(base64);
      const entry = { id: Date.now(), date: new Date().toLocaleDateString("nl-BE"), image: dataUrl, type: "plant", lastWatered: Date.now(), ...plantData };
      logDiag(diagVoorScan(entry));
      await bewaarScan(entry);
      setResult(entry);
      setScreen("result");
    } catch (err) {
      logDiag({ type: "plant", fout: String(err && err.message).slice(0, 200) });
      setError("Plant niet herkend: " + err.message);
      setScreen("home");
    }
  };

  // ===== VOORLEZEN: automatisch voorlezen als de schakelaar aan staat =====
  const berichtRef = useRef("");
  berichtRef.current = safariBericht;
  const huidigeMissie = safariOmgeving ? getMissieList(safariOmgeving, keys.customMissions)[safariOpdracht] || "" : "";
  useEffect(() => {
    if (!SPEECH_OK) return;
    let tries = 0; let last = -1;
    const iv = setInterval(() => {
      tries++;
      let n = 0; try { n = (window.speechSynthesis.getVoices() || []).length; } catch (e) {}
      if (n !== last) { last = n; setVoiceTick((x) => x + 1); }
      if (tries >= 12) clearInterval(iv);
    }, 500);
    return () => clearInterval(iv);
  }, []);
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
    speak((quizAnswered === q.correct ? "Goed zo! Dat is juist." : `Helaas. Het juiste antwoord is: ${q.opts[q.correct]}.`) + (q.weetje ? ` Wist je dat? ${q.weetje}` : ""));
  }, [quizAnswered]);
  useEffect(() => {
    if (screen !== "keys") setToonSleutels(false);
  }, [screen]);
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

  const startQuiz = (niveauKeuze) => {
    const gekozenNiveau = niveauKeuze || quizNiveau;
    if (gekozenNiveau === "scans") {
      const eigen = buildScanQuiz(history);
      if (eigen.length < 3) return;
      setQuizNiveau("scans");
      setCurrentQuizQuestions(eigen);
      setQuizIndex(0);
      setQuizScore(0);
      setQuizAnswered(null);
      setScreen("quiz");
      return;
    }
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
    if (i === currentQuizQuestions[quizIndex].correct) setQuizScore((s) => s + 1);
  };

  const volgendeVraag = () => {
    if (quizAnswered === null) return;
    if (quizIndex + 1 >= currentQuizQuestions.length) {
      const pct = Math.round((quizScore / currentQuizQuestions.length) * 100);
      const diploma = quizScore / currentQuizQuestions.length >= 0.8;
      updateStats((s) => ({ ...s, quizzen: s.quizzen + 1, diplomas: s.diplomas + (diploma ? 1 : 0), besteProcent: Math.max(s.besteProcent, pct) }));
      setScreen(diploma ? "diploma" : "quizResult");
    } else {
      setQuizIndex((idx) => idx + 1);
      setQuizAnswered(null);
    }
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

    const maxAttempts = 3; // 1 poging + 2 automatische herkansingen bij tijdelijke drukte (503/429)
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
        if (attempt >= 2) throw lastErr; // bij time-out/netwerkfout maximaal 1 herkansing (anders wacht een kind veel te lang)
        if (attempt < maxAttempts) {
          setLoadingMsg("Verbinding mislukt, nieuwe poging...");
          await new Promise((r) => setTimeout(r, 1500));
        }
        continue;
      }

      if (!res.ok) {
        let detail = "";
        try { detail = (await res.text()).slice(0, 500); } catch (e) {}
        lastErr = new Error(`API Fout (${res.status})${detail ? ": " + detail : ""}`);
        // 503 (te druk) en 429 (rate limit) zijn meestal tijdelijk — Google raadt
        // zelf aan het gewoon nog eens te proberen. Eén keer opnieuw na 2,5s.
        if ((res.status === 503 || res.status === 429) && !/perday|dailylimit/.test(detail.toLowerCase().replace(/[\s_-]/g, "")) && attempt < maxAttempts) {
          setLoadingMsg("Gemini heeft het even druk, nieuwe poging...");
          await new Promise((r) => setTimeout(r, 2500 * attempt));
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
    // Zonder enige sleutel kan geen enkele bron werken: toon dan de melding "er ontbreekt een instelling"
    // in plaats van het misleidende "ik zie hier geen plant".
    if (!plantId && !plantNet && !gemini) throw new Error("Geen API-sleutel ingesteld. Vul een sleutel in bij Instellingen.");

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
          `Je bent een plantenexpert. Vandaag is het ${huidigeDatumTekst()} in België (seizoen: ${SEIZOEN_NAAM[huidigSeizoen()].toLowerCase()}). Identificeer deze plant EN geef meteen verzorgingsadvies EN een gezondheidscheck EN een giftigheidscheck. Antwoord in eenvoudig Nederlands. Gezondheidscheck: beschrijf eerst kort wat je op de foto ziet aan de bladeren (kleur, vlekken, gaatjes, verwelking, schimmel) in "waargenomen". Zet "gezond" alleen op true als je duidelijk geen verkleuring, vlekken of schade ziet. Zie je gele, bruine of gevlekte bladeren, zet "gezond" dan op false en leg bij "oorzaak" uit of dit door het seizoen normaal kan zijn (bijvoorbeeld herfstkleuren bij een loofboom) of op een probleem wijst; zet "seizoen_normaal" op true als de verkleuring waarschijnlijk seizoensgebonden en normaal is. Is de foto te onduidelijk of weet je het niet zeker, zet "gezond" dan op null. Gok nooit. JSON: {"name":"Nederlandse naam (Latijnse naam)","gezond":true/false/null,"waargenomen":"","seizoen_normaal":true/false/null,"ziekte":"","oorzaak":"","oplossing":"","light":"","soil":"","freq":"","amount":"","tip":"","giftig":{"mens":"niet|licht|matig|sterk|onbekend","dier":"niet|licht|matig|sterk|onbekend","delen":"welke delen giftig zijn","symptomen":"mogelijke klachten, kort","omgang":"hoe ga je ermee om, bv. handschoenen of handen wassen"}} Bij giftig: dier betekent katten en honden. Weet je het niet zeker, antwoord onbekend. Gok nooit.`,
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
    let healthData = { isHealthy: null, diseaseName: "", note: "", solution: "", observed: "", seasonal: null };

    const sug = idData?.result?.classification?.suggestions?.[0];
    if (sug) {
      plantName = sug.name;
      score = Math.round((sug.probability || 0) * 100);
      source = "Plant.id";
      const diseaseInfo = idData.result?.disease;
      if (diseaseInfo) {
        const isHealthy = normGezond(diseaseInfo.is_healthy?.binary);
        const topDisease = diseaseInfo.disease?.suggestions?.[0];
        healthData = {
          isHealthy,
          diseaseName: isHealthy === false ? topDisease?.name || "" : "",
          note: isHealthy === false ? topDisease?.details?.description || "" : "",
          solution: isHealthy === false ? topDisease?.details?.treatment?.biological?.[0] || "" : "",
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
        score = null;
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
      // Gezondheid: Plant.id is de gespecialiseerde bron als die een antwoord gaf; Gemini vult aan. Zegt één van beide
      // dat er iets mis is, dan tonen we "let op". Een ontbrekend antwoord is "onzeker", nooit "gezond".
      const gGez = normGezond(gRes.gezond);
      if (!idData?.result?.disease) {
        healthData = { isHealthy: gGez, diseaseName: asText(gRes.ziekte), note: asText(gRes.oorzaak), solution: asText(gRes.oplossing), observed: "", seasonal: null };
      } else if (healthData.isHealthy !== false && gGez === false) {
        healthData = { isHealthy: false, diseaseName: asText(gRes.ziekte), note: asText(gRes.oorzaak), solution: asText(gRes.oplossing), observed: "", seasonal: null };
      }
      healthData.observed = asText(gRes.waargenomen);
      healthData.seasonal = normGezond(gRes.seizoen_normaal);
    }

    if (!plantName) {
      const detail = errors.length ? " — " + errors.join(" · ") : " (alle bronnen gaven niets terug)";
      throw new Error("Geen plant gevonden." + detail);
    }

    const bronnen = [
      { bron: "Plant.id", latijn: latijnUit(sug && sug.name) },
      { bron: "PlantNet", latijn: latijnUit(netData?.results?.[0]?.species?.scientificNameWithoutAuthor) },
      { bron: "Gemini", latijn: latijnUit(gRes && gRes.name) },
    ];
    const check = bouwPlantControles({
      naam: [plantName, gRes && gRes.name, ...bronnen.map((b) => b.latijn)].filter(Boolean).join(" | "),
      bronnen, health: healthData, giftigheid: normGift(gRes && gRes.giftig),
      verzorgingVanAI: !!(gRes && (gRes.light || gRes.soil || gRes.freq || gRes.amount)),
    });
    return cleanEntry({ name: plantName, score, source, ...careData, health: check.health, giftigheid: check.giftigheid, controles: check.controles });
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
            {SPEECH_OK && voorlezen && voiceTick >= 0 && (() => {
              const opts = stemOpties(); const cur = pickOption(); const idx = Math.max(0, opts.findIndex((o) => o.id === cur.id));
              return <button style={t.iconBtn} onClick={() => {
                const ni = (idx + 1) % opts.length; SPEECH_VOICE_NAME = opts[ni].id;
                try { localStorage.setItem("natuurscanner_stem", SPEECH_VOICE_NAME); } catch (e) {}
                const alle = (() => { try { return window.speechSynthesis.getVoices() || []; } catch (e) { return []; } })();
                setStemInfo(stemUitleg(opts[ni], ni, opts.length, alle)); setVoiceTick((x) => x + 1);
                speak(`Stem ${ni + 1} van ${opts.length}. Zo klink ik nu.`);
              }}>🗣️ Stem {idx + 1}/{opts.length}</button>;
            })()}
            <div style={{ background: "rgba(0,0,0,0.2)", padding: "8px 12px", borderRadius: "16px", fontSize: "14px", fontWeight: "bold", color: liveApiUsage >= 15 ? "#ff6b6b" : "#2ecc71" }}>📊 {liveApiUsage}/15</div>
            <button style={t.iconBtn} onClick={() => { setPinInput(""); setPinError(""); setScreen(settingsUnlocked ? "keys" : "pinGate"); }}>⚙️ Instellingen</button>
          </div>

          {stemInfo && (<div onClick={() => setStemInfo("")} style={{ background: "rgba(0,0,0,0.35)", borderRadius: 14, padding: 12, margin: "0 0 14px", fontSize: 13, lineHeight: 1.5 }}>🗣️ {stemInfo}<div style={{ opacity: 0.7, marginTop: 6 }}>(tik om te sluiten)</div></div>)}

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
          <div style={{ textAlign: "center", fontSize: 11, opacity: 0.45, marginTop: -6, marginBottom: 8 }}>v: {APP_VERSIE}</div>

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

          <button style={{ ...t.ghostButton, marginTop: 10 }} onClick={() => { setBackupBericht(""); setScreen("history"); }}>📸 Geschiedenis ({history.length})</button>
          <button style={t.ghostButton} onClick={() => setScreen("album")}>📖 Mijn Album ({bouwAlbum(history).length})</button>
          {opslagVol && <div style={{ marginTop: 10, padding: 12, borderRadius: 14, background: "rgba(230,126,34,0.2)", border: "1px solid #e67e22", fontSize: 14 }}>⚠️ De opslag van dit toestel is vol: de oudste scans werden verwijderd. Maak een back-up in Geschiedenis.</div>}
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
          <div style={t.subtitle}>{result.source === "Gemini AI" || result.score == null ? `${result.source} · AI-schatting, controleer altijd` : `${result.source} · ${result.score}% zekerheid`}</div>
          <div style={{ textAlign: "center", marginBottom: 16 }}><VoorleesKnop text={resultText({ ...result, __kids: kidsMode })} label="Lees alles voor" /></div>

          <GevaarKaart name={result.name} cardStyle={t.card} />

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
              {typeof result.gezond !== "undefined" && <DierGezondheidKaart gezond={result.gezond} opmerking={result.gezondheidsopmerking} cardStyle={t.card} />}
              <DubbelcheckKaart controles={result.controles} cardStyle={t.card} />
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

              <PlantGezondheidKaart health={result.health} cardStyle={t.card} />
              <DubbelcheckKaart controles={result.controles} cardStyle={t.card} />

              <GiftigKaart g={result.giftigheid} kids={kidsMode} cardStyle={t.card} />
              <EetWaarschuwing name={result.name} cardStyle={t.card} />

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
                <button key="seizoen" onClick={() => { setSafariOmgeving("seizoen"); setSafariOpdracht(pickNextMissionIndex(getMissieList("seizoen"), -1, "seizoen-" + huidigSeizoen())); }} style={{ gridColumn: "1 / -1", backgroundColor: "#8e44ad", color: "#fff", padding: "16px", border: "none", borderRadius: "16px", fontSize: "17px", fontWeight: "800", cursor: "pointer" }}>{SEIZOEN_ICOON[huidigSeizoen()]} {SEIZOEN_NAAM[huidigSeizoen()]}-missies</button>
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

            <button type="button" style={{ ...s.ghostButton, marginBottom: 12 }} onClick={() => setToonSleutels((v) => !v)}>{toonSleutels ? "🙈 Verberg sleutels" : "👁️ Toon sleutels"}</button>
            <label style={s.label}>Plant.id API</label>
            <input style={s.input} type={toonSleutels ? "text" : "password"} autoComplete="new-password" value={keys.plantId} onChange={(e) => setKeys({ ...keys, plantId: e.target.value })} />

            <label style={s.label}>PlantNet API</label>
            <input style={s.input} type={toonSleutels ? "text" : "password"} autoComplete="new-password" value={keys.plantNet} onChange={(e) => setKeys({ ...keys, plantNet: e.target.value })} />

            <label style={s.label}>Gemini API</label>
            <input style={s.input} type={toonSleutels ? "text" : "password"} autoComplete="new-password" value={keys.gemini} onChange={(e) => setKeys({ ...keys, gemini: e.target.value })} />
          </div>

          <div style={s.card}>
            <div style={{ fontWeight: 800, marginBottom: 12, color: "#a8e6cf", fontSize: 18 }}>🩺 Diagnose</div>
            <div style={{ fontSize: 14, lineHeight: "1.6", marginBottom: 12 }}>Bij elke scan houdt de app een klein logboek bij: soort, bron, uitkomst van de automatische dubbelcheck en eventuele fouten. Er worden geen foto's of sleutels in bewaard. Exporteer het bestand om fouten op te sporen.</div>
            <div style={{ fontSize: 14, marginBottom: 12 }}>Logboek: {loadDiag().length} scans{diagTeller < 0 ? "" : ""}</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={s.ghostButton} onClick={exporteerDiagnose}>💾 Diagnose-export opslaan</button>
              <button style={s.ghostButton} onClick={() => { try { localStorage.removeItem(DIAG_KEY); } catch (e) { /* niets */ } setDiagBericht("🗑️ Logboek gewist."); setDiagTeller((n) => n + 1); }}>🗑️ Logboek wissen</button>
            </div>
            {diagBericht && <div style={{ fontSize: 14, marginTop: 10 }}>{diagBericht}</div>}
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

          <button style={s.bigButton} onClick={() => { saveKeys(keys); setToonSleutels(false); setScreen("home"); }}>💾 Alles Opslaan</button>
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
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginBottom: 12 }}>
            <button style={t.ghostButton} onClick={exporteerBackup}>💾 Back-up opslaan</button>
            <label style={{ ...t.ghostButton, cursor: "pointer", display: "inline-block" }}>📂 Back-up laden<input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={importeerBackup} /></label>
          </div>
          {backupBericht && <div style={{ textAlign: "center", fontSize: 14, marginBottom: 12 }}>{backupBericht}</div>}
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

      {/* ALBUM */}
      {screen === "album" && (() => {
        const album = bouwAlbum(history);
        const st = loadStats();
        const planten = album.filter((a) => a.type === "plant").length;
        const dieren = album.filter((a) => a.type === "animal").length;
        const badge = albumBadge(album.length);
        return (
          <>
            <button style={t.backLink} onClick={() => setScreen("home")}>← Menu</button>
            <div style={t.title}>📖 Mijn Album</div>
            <div style={{ textAlign: "center", marginBottom: 12 }}>{album.length} soorten ontdekt · 🌿 {planten} planten · 🦋 {dieren} dieren{badge ? ` · ${badge}` : ""}</div>
            <div style={{ ...t.card, textAlign: "center", fontSize: 15 }}>⭐ Safari-sterren: {st.sterren} · 🎯 Quizzen: {st.quizzen} · 🎓 Diploma's: {st.diplomas} · 🏆 Beste score: {st.besteProcent}%</div>
            {album.length === 0 && <div style={{ textAlign: "center", opacity: 0.6, marginTop: 20 }}>Nog niets ontdekt. Scan een plant of dier!</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
              {album.map((a) => (
                <div key={a.key} style={{ ...t.card, padding: 10, cursor: "pointer", textAlign: "center" }} onClick={() => { setResult(a.laatste); setScreen("result"); }}>
                  <img src={a.laatste.image} alt={a.name} style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 10 }} />
                  <div style={{ fontWeight: 700, marginTop: 6 }}>{a.type === "animal" ? "🦋" : "🌿"} {a.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{a.aantal}× gescand</div>
                </div>
              ))}
            </div>
          </>
        );
      })()}

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
            {bouwAlbum(history).length >= 3
              ? <button onClick={() => startQuiz("scans")} style={{ backgroundColor: "#16a085", color: "#fff", padding: "18px", border: "none", borderRadius: "18px", fontSize: "18px", fontWeight: "800", cursor: "pointer" }}>📸 Mijn Scans Quiz</button>
              : <div style={{ fontSize: 13, opacity: 0.7 }}>📸 Scan eerst minstens 3 verschillende planten of dieren voor de scans-quiz.</div>}
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
          <div style={{ ...t.card, marginBottom: 24 }}>{currentQuizQuestions[quizIndex].image && <img src={currentQuizQuestions[quizIndex].image} alt="je scan" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 12, marginBottom: 12 }} />}<div style={{ fontSize: 20, fontWeight: 800 }}>{currentQuizQuestions[quizIndex].q}</div><VoorleesKnop text={quizText(currentQuizQuestions[quizIndex])} label="Lees voor" /></div>
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
          {quizAnswered !== null && (
            <div style={{ ...t.card, marginTop: 16 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{quizAnswered === currentQuizQuestions[quizIndex].correct ? "✅ Goed zo!" : "❌ Helaas, bijna!"}</div>
              {currentQuizQuestions[quizIndex].weetje && <div style={{ fontSize: 15, lineHeight: "1.6" }}><strong>💡 Wist je dat?</strong> {currentQuizQuestions[quizIndex].weetje}</div>}
              <button style={{ ...t.bigButton, width: "100%", marginTop: 12 }} onClick={volgendeVraag}>{quizIndex + 1 >= currentQuizQuestions.length ? "🏁 Resultaat" : "➡️ Volgende vraag"}</button>
            </div>
          )}
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

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
