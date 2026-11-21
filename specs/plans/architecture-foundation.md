# Fondation d'architecture : une base de code, deux livrables (autonome et web)

> Plan d'implémentation détaillé — **rien n'est codé**. Étiquettes : `architecture`, `documentation`.
> Lire d'abord [`specs/architecture.md`](../architecture.md) (critique + décisions). Ce ticket est le **préalable** de [`dynamic-dataset.md`](dynamic-dataset.md) ; il n'est pas bloquant pour les trois autres évolutions, mais il les rend plus propres.

## 1. Objectif

Garder le **confort actuel** (ouvrir `index.html` par double-clic, hors ligne, sans serveur) tout en rendant possible, sans réécriture, un mode **web** où les données viennent de fichiers statiques ou d'un serveur. Une seule base de code ; deux assemblages.

Non-objectifs : changer de framework, réécrire l'interface, introduire TypeScript obligatoire, toucher aux visuels.

## 2. Diagnostic résumé (détail dans `architecture.md`)

1. Documentation de spécification **obsolète et contradictoire** avec le code (v1.0).
2. Artefacts générés (`index.html` 0,8 Mo, `data.js` 8 Mo) et `__pycache__` **versionnés**, `.gitignore` incomplet, `.gitattributes` LFS résiduel pour un fichier désormais ignoré.
3. `src/app.js` : une IIFE de 1 509 lignes, dizaines de variables d'état globales partagées, aucune frontière donnée / moteur / vue.
4. Interface de données = deux globals ; format figé (18 o entrelacés, constantes dispersées, dictionnaires plafonnés à 254).
5. `META` mélange géographie et jeu de données ; pas de clés canoniques.
6. `build.py` monolithique (807 lignes) ; contrainte « pandas + numpy » incompatible avec le futur travail géométrique ; pas de tests ni d'intégration continue.

## 3. Livrables cibles

```
src/
  core/        pur, sans DOM : format, décodage, filtres, agrégation, recherche, math géo
  engine/      LocalEngine (+ worker.js) ; interface Engine ; RemoteEngine (plus tard)
  data/        ScriptSource, HttpSource ; registre de paquets
  view/        carte (couches canvas), liste d'espèces, fiche, légende
  app.js       câblage et état
  styles/      tokens.css, base.css, components.css
pipeline/      ingest, geocode, mask, grid, pack  (découpage de build.py)
tools/         prepare_*.py (géométrie, vernaculaire, synthétique)
tests/         unitaires Node + Playwright
data/          raw/ (ignoré) · reference/ (petits fichiers sources committés)
dist/          sortie de build (ignorée) : standalone/ et web/
```
La réorganisation de dossiers se fait **par étapes** (§5) ; elle n'est pas faite d'un coup.

### Deux assemblages
- `dist/standalone/` : `index.html` autonome + `data.js` (comme aujourd'hui) — **ou**, option « fichier unique », tout inliné (base64) dans `index.html` (~10–12 Mo : fonctionne mais perd le chargement paresseux ; à proposer, pas à imposer).
- `dist/web/` : `index.html` mince + `app.js` + `fmap-manifest.json` + paquets `.bin` ; même code applicatif, `HttpSource` à la place de `ScriptSource`.

## 4. Décisions à prendre (ADR) — voir `architecture.md` §5

| # | Décision | Recommandation |
|---|---|---|
| ADR-1 | Static-first, serveur optionnel (port `DataSource`/`Engine`) | adopter |
| ADR-2 | Format de paquets v2 colonnaire (SoA), en-tête versionné, double encodage `.bin`/`.js` | adopter |
| ADR-3 | Clés canoniques : INSEE, `cd_ref` TAXREF, grille Lambert-93 | adopter |
| ADR-4 | Géométrie administrative dérivée de la topologie des communes | adopter (cf. `communes-layer.md`) |
| ADR-5 | Artefacts de build **non versionnés**, produits par CI | adopter |
| ADR-6 | Outil d'assemblage : concaténation Python actuelle **ou** `esbuild` (IIFE) | `esbuild` à terme ; commencer par la concaténation ordonnée |

## 5. Plan de migration (chaque étape : l'application marche, comportement identique)

**Règle d'or** : *golden master*. Avant tout, enregistrer des « photos » chiffrées : pour ~30 scénarios (aucun filtre, *Boletus edulis*, octobre, Jura, 2000–2021, comestibles, Valbonne…), les compteurs `total`, `nSpecies`, `nDepts`, top 10 espèces, somme des lieux. Chaque PR doit les reproduire à l'identique. Valeurs d'ancrage : 1 043 262 observations, 11 618 taxons, 96 départements, Pas-de-Calais 78 199, Valbonne 302/180/7.

0. **Hygiène du dépôt** (½ j) — *(en partie fait avec ce ticket : `.gitignore`, `__pycache__` retiré de l'index)*. Reste : décider du sort de `index.html`/`data.js` committés (garder jusqu'à l'étape CI), retirer l'attribut LFS résiduel de `.gitattributes`, script `tools/fetch_raw.py` qui télécharge le CSV Zenodo **avec SHA-256** (remplace toute idée de LFS/copie manuelle).
1. **Specs à jour** (½ j) — déjà amorcé : bandeaux « obsolète » sur `design.md`/`requirements.md`/`tasks.md`, nouveau `architecture.md`, `roadmap.md`, `literature.md`, `CLAUDE.md`. Reste : réécrire `requirements.md` v2 (FR/NFR réels), `design.md` v2.
2. **Banc d'essai et golden master** (1–1,5 j) : harnais Playwright + script de snapshot ; stocker les références dans `tests/golden/`. **Rien d'autre ne commence avant.**
3. **Découpage de `app.js` en fichiers** (2–3 j), toujours concaténés dans une IIFE par `assemble_html.py` (ordre explicite dans un manifeste) : `core/` (fonctions pures déjà isolables : `niceCut`, `hurlbert`, `normName`, `makeGroups`, géométrie d'hexagones/échelle), puis `view/`. Aucune logique modifiée. L'état global est regroupé dans un objet `S` (par domaine) — c'est la partie risquée ; l'étape se fait par sous-systèmes (labels, légende, liste, fiche), chacun validé par le golden master + captures.
4. **Interface `DataSource` + `Engine`** (2–3 j) : encapsuler `boot()`/`splitColumns`/`applyFilters`/`aggregate`/`scanSpecies` derrière `Engine` ; `ScriptSource` lit `window.FMAP_*` comme aujourd'hui. **Aucun changement de format**. L'UI ne lit plus jamais `META` directement.
5. **Géographie séparée du jeu de données** (1–2 j) : paquet `geo-admin` (départements, régions, communes à venir, hexagones, toponymes) distinct du paquet `ds-fongibase` (enregistrements, lieux, dictionnaires). Les lieux dépendent du jeu ; hexagones/communes/toponymes sont **partagés**.
6. **Table canonique des taxons** (1–1,5 j) : `taxa` (clé `cd_ref`, nom latin, nom(s) français, famille/ordre, comestibilité + notes) hors des dictionnaires du jeu ; chaque jeu garde un tableau `localSpecies → taxonId`. C'est aussi la base de `french-names.md`.
7. **Format v2 colonnaire + double encodage** (3–4 j) — mutualisé avec `dynamic-dataset.md` §4.2 ; lecteur v1 conservé une version.
8. **Worker** (2–3 j) — mutualisé avec `dynamic-dataset.md` §6.
9. **CI** (1 j) : GitHub Actions — installe Python, télécharge le CSV Zenodo (vérifie le SHA-256), `build`, tests, produit les deux assemblages, publie `dist/web` sur Pages et `fongimap-offline.zip` en *release* (remplace les `index.html`/`data.js` committés). Tests Node + Playwright sur le build.
10. **Assemblage** : migrer vers `esbuild` seulement si le besoin apparaît (sources de carte, tree-shaking de D3 : l'import complet pèse 280 Ko, seuls `d3-zoom`, `d3-geo`, `d3-scale`, `d3-quadtree`, `d3-transition`, `d3-polygon`, `d3-interpolate`… sont utilisés).

Les étapes 3–6 se font **sans toucher** au format binaire ni à l'interface ; elles dérisquent 7–8.

## 6. Contraintes `file://` à respecter (matrice vérifiée / à vérifier)

| Capacité | `file://` | Source |
|---|---|---|
| `<script src>` classique | OK | déjà utilisé (`data.js`) |
| Modules ES (`type="module"`, `import`) | **bloqués** (CORS, origine opaque) | NFR-04.2 existant ; confirmé par les rapports de bugs navigateurs |
| `fetch()` d'un fichier local | **bloqué** (Chrome) | comportement connu ; d'où le jumeau `.js` des paquets |
| Worker depuis `Blob` | **à vérifier par spike** : Chrome en général oui ; **Safari/WebKit rapporté non** | `literature.md` |
| `SharedArrayBuffer` | non (isolation cross-origin requise) | — |
| IndexedDB / `localStorage` | variable selon navigateur (origine opaque) ; toujours entouré de `try/catch` | règle existante |
| WebAssembly depuis octets | OK (instanciation depuis `ArrayBuffer`) | à confirmer si utilisé |
| `DecompressionStream` | OK en navigateur récent ; repli `fflate` | — |

## 7. Qualité et outillage

- **Tests unitaires Node** (`node --test`, aucun paquet) sur `core/` : normalisation de recherche, niveaux de classes, classement, géométrie d'hexagones, décodage, filtres sur un mini-jeu figé.
- **Python** : `pytest` pour `pipeline/` (Lambert-93, hexagone, masque, rattachement commune).
- **E2E** : Playwright (Chromium puis Firefox) sur `dist/web` servi par `python -m http.server` ; `file://` couvert par un test de démarrage sur le build autonome si l'outil le permet.
- **Lint** : ESLint (règle : pas de `var`, pas d'accès direct `DICT.species[`, pas de variables globales implicites) ; `tsc --checkJs` avec JSDoc **facultatif**.
- **Dépendances vendorisées** (`build/d3.min.js` 7.9.0, `fflate.umd.js` 0.8.2) : consigner version, URL, SHA-256 et licence (`build/VENDOR.md`) ; vérifier que les en-têtes de licence sont conservés dans l'assemblage.
- **Gouvernance** : `CONTRIBUTING.md` minimal (comment construire, tester, quelles données ne jamais committer).

## 8. Critères d'acceptation

- Les deux assemblages se construisent depuis la même source par une commande.
- Golden master identique avant/après chaque étape.
- `index.html` + `data.js` autonomes fonctionnent par double-clic (test de démarrage).
- Plus aucun artefact généré ni `__pycache__` dans le HEAD ; croissance de l'historique nulle à chaque régénération (aujourd'hui `.git/objects` ≈ 33 Mo non empaquetés pour 2 commits, chaque `data.js` régénéré ajoute ≈ 5–8 Mo incompressibles car déjà zlib).
- `specs/` ne contredit plus le code (revue de relecture).
- CI verte sur PR.

## 9. Risques

| Risque | Parade |
|---|---|
| Refactor silencieusement cassant | golden master + captures + PR petites |
| État global dense (≈ 60 `let` partagés) | extraire par sous-système, jamais en bloc |
| Surcoût d'outillage pour des cartographes non développeurs | tout reste lançable par `python build.py && python assemble_html.py` ; CI produit les livrables |
| Historique git alourdi | décision explicite sur la réécriture d'historique (non recommandée) ; geler les artefacts dès maintenant |
| Dérive entre plan et réalité | `architecture.md` mis à jour à chaque étape |

## 10. Questions ouvertes

1. Veut-on conserver l'option **fichier unique** (tout inliné) malgré ~10–12 Mo ?
2. Node/npm acceptable dans la chaîne (pour `esbuild`, Playwright) ?
3. Où publier (GitHub Pages ? autre hébergement ?) ; domaine ?
4. Réécrire l'historique pour retirer les anciens `data.js` ? (déconseillé)
5. Qui valide la comestibilité et les noms (voir `french-names.md`) ?

## 11. Estimation grossière
Étapes 0–2 : 2–3 j · 3 : 2–3 j · 4 : 2–3 j · 5 : 1–2 j · 6 : 1–1,5 j · 9 : 1 j ⇒ **≈ 10–14 j** jusqu'à une base saine ; 7–8 comptés dans `dynamic-dataset.md`.
