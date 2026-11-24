// Minimal Chrome DevTools Protocol driver for the check tools (no dependency; Node 22+ for the global WebSocket).
//   const b = await launch(); await b.open(url); await b.waitFor('expr'); await b.eval('expr'); b.close();
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser(explicit) {
  const list = [explicit, process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  return list.find((p) => fs.existsSync(p)) || null;
}

async function launch(explicitPath, opts) {
  const browser = findBrowser(explicitPath);
  if (!browser) throw new Error('No Chrome / Edge found: pass its path as the first argument or set CHROME_PATH.');
  const o = Object.assign({ width: 1280, height: 800 }, opts), port = 9300 + Math.floor(Math.random() * 500), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fmap-check-'));
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--window-size=' + o.width + ',' + o.height, 'about:blank'], { stdio: 'ignore' });
  const getJson = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { try { targets = await getJson('/json'); } catch (e) { await sleep(250); } }
  const page = targets && targets.find((t) => t.type === 'page');
  if (!page) { child.kill(); throw new Error('browser did not start'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const waiting = new Map(), errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception || {}).description || d.params.exceptionDetails.text);
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value || a.description).join(' '));
  };
  const send = (method, params) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: o.width, height: o.height, deviceScaleFactor: 1, mobile: false });
  const api = {
    browser, errors, sleep,
    async open(url) { await send('Page.navigate', { url }); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception ? r.result.exceptionDetails.exception.description : 'evaluation failed'); return r.result && r.result.result ? r.result.result.value : undefined; },
    async waitFor(expr, tries) { for (let i = 0; i < (tries || 120); i++) { await sleep(500); if (await api.eval(expr)) return true; } return false; },
    close() { try { ws.close(); } catch (e) { /* closed */ } child.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* temp profile */ } },
  };
  return api;
}
module.exports = { launch, findBrowser, sleep };
