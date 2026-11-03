// Simulatie van public/gemini-test.html en public/plantnet-test.html in jsdom (nagemaakte fetch).
// Gebruik: node tests/paginas-test.js   (vanuit de repo-root; vereist `cd tests && npm ci`)
const path = require("path");
const fs = require("fs");
const { JSDOM } = require(path.join(__dirname, "node_modules", "jsdom"));
const ROOT = path.join(__dirname, "..");
const ORIGIN = "https://yvhzpk.csb.app";
let ok = 0, fout = 0;
function check(naam, voorwaarde, extra) {
  if (voorwaarde) { ok++; console.log("  ✔ " + naam); } else { fout++; console.log("  ✘ " + naam + (extra ? "  → " + extra : "")); }
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

async function laad(bestand, antwoorden, opties = {}) {
  const html = fs.readFileSync(path.join(ROOT, "public", bestand), "utf8");
  const oproepen = [];
  const dom = new JSDOM(html, {
    url: ORIGIN + "/" + bestand, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      if (opties.sleutelKey) w.localStorage.setItem(opties.sleutelKey, "TESTSLEUTEL123");
      if (opties.gebruik) w.localStorage.setItem("plantscanner_api_usage", JSON.stringify(opties.gebruik));
      const echtTimeout = w.setTimeout.bind(w);
      w.setTimeout = (f, ms) => echtTimeout(f, Math.min(ms || 0, 5)); // 3 s wachttijd inkorten
      let i = 0;
      w.fetch = (url, init) => {
        oproepen.push({ url: String(url), init });
        const a = antwoorden[Math.min(i++, antwoorden.length - 1)];
        if (a.gooi) return Promise.reject(new Error(a.gooi));
        return Promise.resolve({ status: a.status, ok: a.status >= 200 && a.status < 300, headers: { get: (k) => (a.headers || {})[k.toLowerCase()] || null }, text: () => Promise.resolve(a.tekst || ""), json: () => Promise.resolve(JSON.parse(a.tekst || "{}")) });
      };
    },
  });
  return { dom, w: dom.window, d: dom.window.document, oproepen };
}
const uitslag = (p) => p.d.getElementById("uitslag").textContent;

(async () => {
  console.log("Gemini-testpagina");
  const gevallen = [
    ["gelukt (200)", { status: 200, tekst: '{"candidates":[]}' }, /Gelukt/, null],
    ["dagelijks limiet (429 met PerDay)", { status: 429, tekst: '{"error":{"message":"Quota exceeded ... GenerateRequestsPerDayPerProjectPerModel"}}' }, /dagelijkse limiet/, /per minuut/],
    ["minuutlimiet (429 zonder PerDay)", { status: 429, tekst: '{"error":{"status":"RESOURCE_EXHAUSTED","message":"rate limit"}}' }, /limiet per minuut/, /dagelijkse limiet van Gemini is bereikt/],
    ["overbelast (503)", { status: 503, tekst: '{"error":{"message":"The model is overloaded"}}' }, /overbelast/, null],
    ["model weg (404)", { status: 404, tekst: "models/xyz is not found" }, /ander model/, null],
    ["foute sleutel (403)", { status: 403, tekst: "API key not valid" }, /sleutel/i, null],
    ["geen netwerk (fetch gooit)", { gooi: "Failed to fetch" }, /Geen antwoord/, null],
    ["Retry-After wordt getoond", { status: 429, tekst: "x", headers: { "retry-after": "17" } }, /Retry-After: 17/, null],
  ];
  for (const [naam, antw, verwacht, nietVerwacht] of gevallen) {
    const p = await laad("gemini-test.html", [antw], { sleutelKey: "plantscanner_gemini_key" });
    p.d.getElementById("knopA").click(); await wacht(30);
    const t = uitslag(p);
    check(naam, verwacht.test(t) && (!nietVerwacht || !nietVerwacht.test(t)), t.slice(0, 160));
    if (naam.startsWith("gelukt")) {
      const o = p.oproepen[0];
      const body = JSON.parse(o.init.body);
      check("URL = Worker + ?api-key=<sleutel uit app>", o.url === "https://summer-snowflake-d2dc.yoericeulemans.workers.dev/gemini?api-key=TESTSLEUTEL123", o.url);
      check("body heeft base64 (echte JPEG, zonder data:-voorvoegsel) en prompt", body.base64.startsWith("/9j/") && !body.base64.includes("data:") && body.prompt.length > 5);
      check("methode POST met JSON-header", o.init.method === "POST" && o.init.headers["Content-Type"] === "application/json");
      check("knoppen weer actief na de test", !p.d.getElementById("knopA").disabled && !p.d.getElementById("knopB").disabled);
    }
    p.w.close();
  }
  { // Test B
    const p = await laad("gemini-test.html", [{ status: 200, tekst: "{}" }, { status: 429, tekst: "rate limit" }, { status: 503, tekst: "overloaded" }], { sleutelKey: "plantscanner_gemini_key" });
    p.d.getElementById("knopB").click(); await wacht(120);
    const t = uitslag(p);
    check("Test B: 3 oproepen gedaan", p.oproepen.length === 3, String(p.oproepen.length));
    check("Test B: toont oproep 1, 2 en 3 met hun eigen uitkomst", /Oproep 1: Gelukt/.test(t) && /Oproep 2: Mislukt \(HTTP 429\)/.test(t) && /Oproep 3: Mislukt \(HTTP 503\)/.test(t), t.slice(0, 200));
    p.w.close();
  }
  { // zonder sleutel
    const p = await laad("gemini-test.html", [{ status: 200 }]);
    p.d.getElementById("knopA").click(); await wacht(20);
    check("zonder sleutel: vriendelijke melding en géén oproep", /Vul eerst je Gemini-sleutel in/.test(uitslag(p)) && p.oproepen.length === 0);
    p.w.close();
  }
  { // recente oproepen uit de app
    const nu = Date.now();
    const p = await laad("gemini-test.html", [{ status: 200 }], { sleutelKey: "plantscanner_gemini_key", gebruik: [nu - 1000, nu - 5000, nu - 90000] });
    check("toont aantal app-oproepen in de laatste minuut (2 van 3)", /laatste minuut.*: 2\./.test(p.d.getElementById("recent").textContent), p.d.getElementById("recent").textContent);
    p.w.close();
  }

  console.log("PlantNet-testpagina");
  {
    const p = await laad("plantnet-test.html", [{ status: 403, tekst: "CORS error: Origin not allowed" }], { sleutelKey: "plantscanner_plantnet_key" });
    check("toont het exacte adres van de pagina (mét https://)", p.d.getElementById("adresTekst").textContent === ORIGIN, p.d.getElementById("adresTekst").textContent);
    check("adresvak noemt 'mét https://' en 'Geautoriseerde domeinen'", /mét https:\/\//.test(p.d.getElementById("adres").textContent) && /Geautoriseerde domeinen/.test(p.d.getElementById("adres").textContent));
    check("sleutel uit de app is vooraf ingevuld", p.d.getElementById("sleutel").value === "TESTSLEUTEL123");
    p.w.close();
  }
  console.log("\n" + ok + " controles geslaagd, " + fout + " mislukt");
  process.exit(fout ? 1 : 0);
})();
