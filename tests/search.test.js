// Unit tests of the bilingual search (src/js/core/search.js). Uses a small frozen sample; no data.js needed.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sb = {}; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/core/search.js'), 'utf8'), sb);
const core = sb.FMAP_CORE;

const SAMPLE = [
  { latin: 'Boletus edulis', fr: ['Cèpe de Bordeaux', 'Cèpe du Périgord'], family: 'Boletaceae' },
  { latin: 'Boletus pinophilus', fr: ['Cèpe des pins', 'Cèpe pinicole'], family: 'Boletaceae' },
  { latin: 'Cantharellus cibarius', fr: ['Girolle', 'Chanterelle commune'], family: 'Cantharellaceae' },
  { latin: 'Hydnum repandum', fr: ['Pied de mouton'], family: 'Hydnaceae' },
  { latin: 'Craterellus cornucopioides', fr: ['Trompette de la mort', 'Corne d’abondance'], family: 'Cantharellaceae' },
  { latin: 'Amanita phalloides', fr: ['Amanite phalloïde'], family: 'Amanitaceae' },
  { latin: 'Amanita muscaria', fr: ['Amanite tue-mouches', 'Fausse oronge'], family: 'Amanitaceae' },
  { latin: 'Clavariadelphus pistillaris', fr: ['Clavaire en massue'], family: 'Gomphaceae' },
  { latin: 'Trametes versicolor', fr: null, family: 'Polyporaceae' },
  { latin: 'Lepista nuda', fr: ['Pied bleu', 'Tricholome nu', 'Cœur de bœuf'], family: 'Tricholomataceae' },
];
const idx = core.buildSearchIndex(SAMPLE);
const find = (q) => Array.from(core.search(idx, q) || []).sort((a, b) => a.tier - b.tier || a.s - b.s).map((m) => SAMPLE[m.s].latin);

test('searchKey folds case, accents, ligatures, apostrophes and hyphens', () => {
  assert.strictEqual(core.searchKey('Cœur-de-bœuf'), 'coeur de boeuf');
  assert.strictEqual(core.searchKey('Corne d’abondance'), 'corne d abondance');
  assert.strictEqual(core.searchKey('  Amanite  PHALLOÏDE '), 'amanite phalloide');
  assert.strictEqual(core.searchKey('tue-mouches'), 'tue mouches');
});

test('French names are found, with or without accents, plural or case', () => {
  for (const q of ['cepe', 'cèpe', 'CEPES', 'cèpes']) {
    const r = find(q); assert.ok(r.includes('Boletus edulis') && r.includes('Boletus pinophilus'), q);
  }
  assert.deepStrictEqual(find('girolle')[0], 'Cantharellus cibarius');
  assert.deepStrictEqual(find('pied de mouton'), ['Hydnum repandum']);
  assert.deepStrictEqual(find('trompette de la mort'), ['Craterellus cornucopioides']);
  assert.deepStrictEqual(find('amanite phalloide'), ['Amanita phalloides']);
  assert.ok(find('amanite').length === 2);                          // the first word of the French name acts as the genus name
});

test('type-ahead: the last word is a prefix', () => {
  assert.deepStrictEqual(find('amanite phall'), ['Amanita phalloides']);
  assert.deepStrictEqual(find('cèpe de bord'), ['Boletus edulis']);
});

test('ligatures and hyphens are interchangeable', () => {
  assert.deepStrictEqual(find('coeur de boeuf'), ['Lepista nuda']);
  assert.deepStrictEqual(find('cœur'), ['Lepista nuda']);
  assert.deepStrictEqual(find('tue mouches'), ['Amanita muscaria']);
  assert.deepStrictEqual(find('corne d abondance'), ['Craterellus cornucopioides']);
});

test('Latin names and families keep working exactly as before', () => {
  assert.deepStrictEqual(find('Boletus edulis'), ['Boletus edulis']);
  assert.deepStrictEqual(find('boletus'), ['Boletus edulis', 'Boletus pinophilus']);
  assert.deepStrictEqual(find('Trametes'), ['Trametes versicolor']);
  assert.deepStrictEqual(find('amanitaceae').sort(), ['Amanita muscaria', 'Amanita phalloides']);
  assert.deepStrictEqual(find('cantharellus'), ['Cantharellus cibarius']);
});

test('ranking: exact name before prefix before inner word', () => {
  const r = core.search(idx, 'cepe des pins').sort((a, b) => a.tier - b.tier);
  assert.strictEqual(SAMPLE[r[0].s].latin, 'Boletus pinophilus');
  const g = core.search(idx, 'girolle');
  assert.strictEqual(g[0].tier, 0);
  assert.strictEqual(g[0].via, 1);                                   // matched through the primary French name
  const al = core.search(idx, 'chanterelle commune');
  assert.strictEqual(al[0].via, 2);                                  // matched through an alias
});

test('no match and empty query', () => {
  assert.deepStrictEqual(find('zzzz'), []);
  assert.strictEqual(core.search(idx, '   '), null);
});
