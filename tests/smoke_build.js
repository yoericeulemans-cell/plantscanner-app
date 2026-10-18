// Rooktest van de ECHTE productiebuild (react-scripts build, React 19, verkleind) in jsdom.
const http = require("http"), fs = require("fs"), path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const BUILD = process.argv[2];
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".map": "application/json" };
const server = http.createServer((req, res) => {
  let p = path.join(BUILD, decodeURIComponent(req.url.split("?")[0])); if (p.endsWith("/")) p += "index.html";
  if (!fs.existsSync(p)) { p = path.join(BUILD, "index.html"); }
  res.writeHead(200, { "Content-Type": mime[path.extname(p)] || "text/plain" }); res.end(fs.readFileSync(p));
});
const fouten = []; let checks = 0;
const ok = (c, l) => { checks++; if (!c) { fouten.push(l); console.log("   ✗ " + l); } };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
server.listen(0, async () => {
  const port = server.address().port;
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => fouten.push("jsdomError: " + String(e.message).slice(0, 160)));
  vc.on("error", (...a) => fouten.push("console.error: " + a.map(String).join(" ").slice(0, 200)));
  const dom = await JSDOM.fromURL(`http://localhost:${port}/`, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} })); } });
  const w = dom.window, d = w.document;
  await wacht(1500);
  const txt = () => d.body.textContent;
  const btn = (re) => [...d.querySelectorAll("button")].find((b) => (re instanceof RegExp ? re.test(b.textContent) : b.textContent.includes(re)));
  const klik = async (re) => { const b = btn(re); if (!b) { fouten.push("knop niet gevonden: " + re); return false; } b.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await wacht(120); return true; };
  ok(/PlantScanner|NatuurScanner/.test(txt()), "startscherm rendert");
  const verwacht = (fs.readFileSync(process.argv[3] || path.join(__dirname, "..", "src", "App.js"), "utf8").match(/APP_VERSIE = "([^"]+)"/) || [])[1];
  ok(!!verwacht && txt().includes("v: " + verwacht), `versienummer in de productiebuild: ${verwacht}`);
  ok(!!btn("Scan Plant") && !!btn("Mijn Album") && !!btn("Instellingen"), "hoofdknoppen aanwezig");
  await klik("🧒 Uit"); ok(txt().includes("Start Natuur Safari") && txt().includes("Start Natuur Quiz"), "kindermodus");
  await klik("Start Natuur Safari"); ok(txt().includes("Kies je missiegebied") && /-missies/.test(txt()), "safari met seizoensknop");
  await klik("bos"); ok(txt().includes("Safari Missie") && txt().includes("0 Sterren"), "missie getoond");
  await klik("Andere missie"); await klik(/Menu/);
  await klik("Start Natuur Quiz"); await klik("Makkelijk"); ok(txt().includes("Vraag 1 / 10"), "quizvraag 1");
  const opt = [...d.querySelectorAll("button")].filter((b) => b.textContent.trim() && !/Stoppen|Lees voor/.test(b.textContent))[0];
  opt.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await wacht(150);
  ok(txt().includes("Wist je dat") && !!btn("Volgende vraag"), "weetje + volgende-knop in productiebuild");
  await klik("Volgende vraag"); ok(txt().includes("Vraag 2 / 10"), "quizvraag 2");
  await klik(/Stoppen/);
  await klik("Mijn Album"); ok(txt().includes("Mijn Album") && txt().includes("0 soorten ontdekt"), "album leeg");
  await klik(/Menu/); await klik("Geschiedenis"); ok(txt().includes("Back-up opslaan") && txt().includes("Back-up laden"), "geschiedenis met back-up");
  await klik(/Menu|Terug/); await klik("Instellingen"); ok(txt().includes("vergrendeld"), "instellingen vragen de pincode");
  ok(!txt().includes("Oeps, er ging iets mis"), "foutscherm nooit getoond");
  w.close(); server.close();
  console.log(`\nRooktest productiebuild: ${checks} controles, ${fouten.length} problemen`);
  fouten.forEach((f) => console.log(" - " + f));
  process.exit(fouten.length ? 1 : 0);
});
