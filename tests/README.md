# Automatische controle

Deze map bevat de automatische controle van `src/App.js`. GitHub draait ze bij elke push naar `ontwikkel` of `main`
(zie `.github/workflows/ci.yml`). Je hoeft er niets voor te doen.

Wat er gecontroleerd wordt:
- de volledige testsuite in een nagemaakte browser (jsdom, React 19, StrictMode)
- een aapjestest: willekeurige gebruikers klikken honderden keren door de app terwijl Gemini willekeurig faalt
- statische analyse: geen niet-gedefinieerde namen, hookregels
- een echte productiebuild (`react-scripts build`) met een rooktest

Lokaal draaien (Node 20 of hoger):

    cd tests && npm ci && cd ..
    STRICT=1 node tests/run.js src/App.js

Dit bewijst de logica in een nagemaakte browser. Echte camera, stemmen, iPad en echte AI-antwoorden worden NIET getest.
