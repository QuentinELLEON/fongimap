'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sb = {}; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/core/urlstate.js'), 'utf8'), sb);
const core = sb.FMAP_CORE;
const plain = (o) => JSON.parse(JSON.stringify(o));

test('round trip keeps every field', () => {
  const m = Object.assign(plain(core.defaultViewState()), {
    sp: ['Boletus edulis', 'Amanita phalloides'], m: [9, 10], d: ['39', '2A'], y: [2000, 2021], c: '06152', e: 1,
    g: ['Ectomycorrhizal'], ph: ['Ascomycota'], v: [5.7, 46.7, 6], l: 'communes', mt: 'count', n: 'latin', fo: 0, al: 0,
  });
  const str = core.encodeState(m);
  assert.ok(!str.includes(' '), 'no raw spaces');
  assert.deepStrictEqual(plain(core.decodeState('#' + str)), m);
});

test('defaults are omitted and an empty hash decodes to defaults', () => {
  assert.strictEqual(core.encodeState(core.defaultViewState()), '');
  assert.deepStrictEqual(plain(core.decodeState('')), plain(core.defaultViewState()));
});

test('garbage never throws and invalid values are dropped', () => {
  const s = core.decodeState('#m=0,13,abc,5&y=2021-2000&v=1,2&e=9&zz=1&=&sp=%E0%A4%A&n=klingon');
  assert.deepStrictEqual(plain(s.m), [5]);
  assert.strictEqual(s.y, null); assert.strictEqual(s.v, null); assert.strictEqual(s.e, 0); assert.strictEqual(s.n, '');
});

test('names with accents, spaces and ampersands survive', () => {
  const m = Object.assign(plain(core.defaultViewState()), { sp: ['Genre é & co', 'x y'] });
  assert.deepStrictEqual(plain(core.decodeState(core.encodeState(m))).sp, ['Genre é & co', 'x y']);
});
