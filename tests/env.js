// Browseromgeving voor de tests: jsdom + nagemaakte speechSynthesis, fetch, Image, canvas, camera.
// Alles wat in een echte browser/telefoon anders kan zijn, is hier een NAGEMAAKTE versie.
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://localhost/",
  pretendToBeVisual: true,
});
const w = dom.window;

// Globals die de app en testing-library nodig hebben
global.window = w;
global.document = w.document;
Object.defineProperty(global, "navigator", { value: w.navigator, configurable: true });
for (const k of [
  "localStorage", "HTMLElement", "HTMLInputElement", "HTMLCanvasElement", "HTMLMediaElement", "Node", "Element",
  "Event", "MouseEvent", "KeyboardEvent", "File", "FileReader", "Blob", "FormData", "MutationObserver",
  "getComputedStyle", "DOMParser", "CustomEvent", "AbortController",
]) {
  if (w[k] !== undefined) {
    try { Object.defineProperty(global, k, { value: w[k], configurable: true, writable: true }); } catch (e) {}
  }
}
global.IS_REACT_ACT_ENVIRONMENT = true;

// Tijdschaal: wachttijden >= 1000 ms worden 20x korter, zodat de tests snel lopen
// (quiz-pauze 1500ms -> 75ms, herkansing 2500ms -> 125ms, safari-bericht 5000ms -> 250ms).
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms >= 1000 ? ms / 20 : ms, ...a);
w.setTimeout = global.setTimeout;

// ---- nagemaakte spraaksynthese ----
const speech = {
  voices: [],            // door de test in te stellen
  spoken: [],            // elke Utterance die gesproken werd
  cancelCount: 0,
  speaking: false,
  pending: false,
  getVoices() { return speech.voices; },
  silent: 0,             // aantal komende utterances dat stil blijft (geen start-gebeurtenis), om een telefoon na te bootsen die niets laat horen
  speak(u) {
    speech.spoken.push(u);
    if (speech.silent > 0) { speech.silent--; return; }
    realSetTimeout(() => { u.onstart && u.onstart({}); }, 0);
  },
  cancel() { speech.cancelCount++; },
  addEventListener() {},
  removeEventListener() {},
};
class FakeUtterance {
  constructor(text) { this.text = text; this.lang = ""; this.voice = null; this.rate = 1; this.pitch = 1; }
}
w.speechSynthesis = speech;
w.SpeechSynthesisUtterance = FakeUtterance;
global.SpeechSynthesisUtterance = FakeUtterance;

// ---- nagemaakte Image + canvas ----
global.__img = { width: 3000, height: 2000, fail: false };
global.Image = class {
  constructor() { this.width = 0; this.height = 0; }
  set src(v) {
    realSetTimeout(() => {
      if (global.__img.fail) { this.onerror && this.onerror(new Error("img")); return; }
      this.width = global.__img.width; this.height = global.__img.height;
      this.onload && this.onload();
    }, 0);
  }
};
w.Image = global.Image;
global.__canvas = { draws: [], dataUrlCalls: [] };
w.HTMLCanvasElement.prototype.getContext = function () {
  return { drawImage: (...a) => global.__canvas.draws.push(a) };
};
w.HTMLCanvasElement.prototype.toDataURL = function (type, q) {
  global.__canvas.dataUrlCalls.push([type, q, this.width, this.height]);
  return "data:image/jpeg;base64,RESIZED";
};

// ---- camera ----
w.HTMLMediaElement.prototype.play = () => Promise.resolve();
global.__cam = {
  mode: "ok",            // "ok" | "denied"
  caps: { zoom: { min: 1, max: 5, step: 0.1 }, torch: true },
  constraintCalls: [],
  applied: [],
  stopped: 0,
  getUserMediaCalls: [],
};
function makeStream() {
  const track = {
    getCapabilities: global.__cam.caps === null ? undefined : () => global.__cam.caps,
    getSettings: () => ({ zoom: 1 }),
    applyConstraints: async (c) => { global.__cam.applied.push(c); },
    stop: () => { global.__cam.stopped++; },
  };
  return { getVideoTracks: () => [track], getTracks: () => [track] };
}
Object.defineProperty(w.navigator, "mediaDevices", {
  configurable: true,
  value: {
    getUserMedia: async (c) => {
      global.__cam.getUserMediaCalls.push(c);
      if (global.__cam.mode === "denied") throw new Error("NotAllowedError");
      return makeStream();
    },
  },
});
global.__imageCapture = { enabled: true, calls: 0 };
Object.defineProperty(w, "ImageCapture", {
  configurable: true,
  get() {
    if (!global.__imageCapture.enabled) return undefined;
    return class { constructor(t) { this.track = t; } async takePhoto() { global.__imageCapture.calls++; return new w.Blob(["x"], { type: "image/jpeg" }); } };
  },
});

// ---- nagemaakte fetch ----
// handler(url, opts) => { status, json, text } ; wordt per test ingesteld
global.__net = { calls: [], handler: null };
global.fetch = async (url, opts) => {
  global.__net.calls.push({ url: String(url), opts });
  if (String(url).startsWith("data:")) return { ok: true, status: 200, blob: async () => new w.Blob(["x"]) };
  const r = global.__net.handler ? await global.__net.handler(String(url), opts) : { status: 500, text: "geen handler" };
  if (r && r.throw) throw r.throw;
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.json,
    text: async () => (r.text !== undefined ? r.text : JSON.stringify(r.json || {})),
  };
};
w.fetch = global.fetch;

// ---- downloads (back-up) ----
global.__downloads = [];
global.__lastBlob = null;
global.URL.createObjectURL = (b) => { global.__lastBlob = b; return "blob:test"; };
global.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () { global.__downloads.push({ href: this.href, download: this.download }); };

w.confirm = () => true;
w.alert = () => {};

module.exports = { dom, w, speech };
