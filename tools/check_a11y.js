// Accessibility audit with axe-core on the main screens, in headless Chrome / Edge over file://.
//   npm install --no-save axe-core            (once; axe-core is not a dependency of the project)
//   node tools/check_a11y.js [path-to-browser]  exit code 1 when a serious or critical violation is found
// Screens: home (species tab), filters tab, "Autour de moi" tab with a point chosen, species sheet, help dialog,
// side panel hidden, dark theme. Target of specs/requirements.md: 0 serious / critical.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./lib/browser');

const ROOT = path.join(__dirname, '..');
const axePath = [process.env.AXE_PATH, path.join(ROOT, 'node_modules/axe-core/axe.min.js'), path.join(process.cwd(), 'node_modules/axe-core/axe.min.js')].filter(Boolean).find((p) => fs.existsSync(p));
if (!axePath) { console.error('axe-core not found: run  npm install --no-save axe-core  (or set AXE_PATH).'); process.exit(2); }

const STEPS = [
  ['home (species tab)', "document.getElementById('help-start').click(); new Promise(r => setTimeout(r, 2800))"],   // wait for the loading overlay to fade out
  ['filters tab', "document.querySelector('#side-tabs button[data-tab=filters]').click()"],
  ['around-me tab with a point', "document.querySelector('#side-tabs button[data-tab=near]').click(); FMAP_APP.setMe(5.9, 46.6, 'map', 0); new Promise(r => setTimeout(r, 1500))"],
  ['species sheet', "document.querySelector('#side-tabs button[data-tab=species]').click(); FMAP_APP.pickSpecies(FMAP_APP.browser.rows[0].idx); new Promise(r => setTimeout(r, 1500))"],
  ['side panel hidden', "document.getElementById('btn-side').click(); new Promise(r => setTimeout(r, 400))"],
  ['help dialog', "document.getElementById('btn-side').click(); document.getElementById('btn-help').click(); new Promise(r => setTimeout(r, 400))"],
  ['dark theme', "document.getElementById('help-close').click(); document.documentElement.setAttribute('data-theme', 'dark'); new Promise(r => setTimeout(r, 400))"],
];

(async () => {
  const b = await launch(process.argv[2]);
  await b.open('file:///' + ROOT.replace(/\\/g, '/').replace(/^\//, '') + '/index.html');
  if (!(await b.waitFor("!!(window.FMAP_APP && document.getElementById('loading-overlay').classList.contains('hidden'))"))) { console.error('the app did not start'); b.close(); process.exit(1); }
  await b.eval(fs.readFileSync(axePath, 'utf8'));
  let bad = 0; const report = [];
  for (const [name, js] of STEPS) {
    await b.eval('(async () => { ' + js + ' })()');
    await b.sleep(600);
    const res = await b.eval("axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map(n => n.target.join(' ') + ' :: ' + (n.any[0] ? n.any[0].message : (n.failureSummary || '')).slice(0, 140)) })))");
    const serious = res.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    bad += serious.length; report.push({ screen: name, violations: res.length, seriousOrCritical: serious.length, details: res });
  }
  report.forEach((r) => {
    console.log('\n## ' + r.screen + ': ' + r.violations + ' violation(s), ' + r.seriousOrCritical + ' serious/critical');
    r.details.forEach((v) => console.log('  - [' + v.impact + '] ' + v.id + ' (' + v.nodes + ' node(s)): ' + v.help + '\n      ' + v.sample.join('\n      ')));
  });
  console.log('\nTotal serious/critical: ' + bad);
  b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
