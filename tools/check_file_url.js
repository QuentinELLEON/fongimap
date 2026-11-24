// Opens index.html over file:// (the way a double-click does) in a real Chromium-family browser (Chrome or Edge, headless),
// waits for the application, and prints what a user would rely on: the headline counters, which engine back-end started
// (worker from a Blob, or main thread), whether the commune geometry decoded, and any page error.
//   node tools/check_file_url.js [path-to-browser]        exit code 1 when the app does not come up
//   CHECK_QUERY="?ds=gbif_fr_recent" node tools/check_file_url.js     same, with a query string / hash
// Needs Node 22+ (global WebSocket). No dependency. Used to fill the browser table of specs/architecture.md section 6.
'use strict';
const path = require('node:path');
const { launch } = require('./lib/browser');

const ROOT = path.join(__dirname, '..');
(async () => {
  const b = await launch(process.argv[2]);
  const url = 'file:///' + ROOT.replace(/\\/g, '/').replace(/^\//, '') + '/index.html' + (process.env.CHECK_QUERY || '');
  await b.open(url);
  const ok = await b.waitFor("!!(window.FMAP_APP && document.getElementById('loading-overlay').classList.contains('hidden'))");
  const info = await b.eval("(async () => { const A = window.FMAP_APP; if (!A) return null; await new Promise(r => setTimeout(r, 2500));" +
    "return { url: location.href, userAgent: navigator.userAgent.replace(/.*(Chrome|Edg)\\/([\\d.]+).*/, '$1 $2'), observations: document.getElementById('n-filtered').textContent, species: document.getElementById('n-species').textContent," +
    "departments: document.getElementById('n-depts').textContent, engine: A.engine && A.engine.mode, communes: A.geoState, stylesheets: document.styleSheets.length, scripts: document.scripts.length, loadingMessage: document.getElementById('loading-msg').textContent }; })()");
  console.log(JSON.stringify({ browser: path.basename(b.browser), ok, info, errors: b.errors.slice(0, 5) }, null, 2));
  b.close();
  process.exit(ok && info && info.observations !== '—' ? 0 : 1);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
