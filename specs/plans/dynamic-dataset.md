# Second jeu de données, dynamique, avec de meilleures performances

> Plan d'implémentation détaillé — **rien n'est codé**. Étiquettes : `enhancement`, `architecture`, `data`.
> **Dépend de** [`architecture-foundation.md`](architecture-foundation.md) (format de paquet, source de données abstraite). Contexte : [`specs/architecture.md`](../architecture.md).

## 1. Demande

> « Pouvoir rajouter un 2e dataset, cette fois dynamique tout en améliorant les performances. »
> Contrainte d'architecture donnée : un serveur viendra dans quelques mois, **mais l'application doit pouvoir rester sans serveur**.

### Ce qu'on ne sait pas (à lever en premier — §10)
« Dynamique » peut vouloir dire : (a) jeu **mis à jour** régulièrement (nouvelles observations), (b) jeu **chargé à la demande** (trop gros pour être embarqué), (c) jeu **interrogé** côté serveur (filtres exécutés là-bas). Ces trois besoins ont des architectures différentes. Le plan ci-dessous est conçu pour que **(a) et (b) fonctionnent sans serveur**, et que **(c) soit un adaptateur de plus**, pas une réécriture. Taille, source, rythme de mise à jour et licence du second jeu sont **inconnus** : ils fixent les seuils de bascule (§5).

## 2. État actuel et goulots (mesurés ou lus dans le code)

| Sujet | Constat |
|---|---|
| Interface de données | Deux globals : `window.FMAP_META` (JSON) et `window.FMAP_DATA` (base64 zlib), lus directement par `boot()` (`app.js:152`). Aucune notion de « jeu de données ». |
| Poids de `data.js` | 8,04 Mo : base64 des enregistrements 5,30 Mo ; `META` 2,74 Mo (lieux 1,47, hexagones 0,48, communes 0,41, dictionnaires 0,28, toponymes 0,09, comestibilité 0,02). Géographie et jeu de données **mélangés** dans un seul fichier. |
| Format enregistrements | 18 octets **entrelacés** (AoS), puis dé-entrelacés par une boucle JS de 1 M d'itérations × 14 lectures (`splitColumns`, `app.js:134`). Le tri (dept, espèce) aide zlib (~×5,3) mais pas la boucle. |
| Passes sur les enregistrements | `applyFilters` (écrit `failMask` 2 o/enregistrement) puis `aggregate` ; `computeRichness` au besoin ; `scanSpecies` (1 passe) à chaque ouverture de fiche ; l'aperçu au survol refait une passe. Mesuré : filtre+rendu 22–65 ms à 1 M (`context.md` §7.x). À 5 M ⇒ ~5× : 110–330 ms **sur le thread principal**, la carte saccade. |
| Dictionnaires | champs 8 bits plafonnés à 254 valeurs (familles : 318 → 254 conservées ; départements : 254 en comptant les codes étrangers) ⇒ perte silencieuse (« missing ») ; un second jeu aurait d'autres dictionnaires. |
| Clés | Espèces = indices dans `dicts.species` propres à ce build ; commune = indices dans `META.communes`. Aucune clé **canonique** inter-jeux. |
| Threading | Tout sur le thread principal. |
| `file://` | `fetch()` d'un fichier local est bloqué par les navigateurs ; la voie `<script src>` est la seule qui marche (c'est pourquoi `data.js` existe). |

## 3. Principes de conception

1. **Static-first, server-optional** : même application, mêmes fonctions ; la source de données est un *port* avec plusieurs adaptateurs (§4).
2. **Canonique par clé stable** : espèce = `cd_ref` TAXREF (nom latin en repli), département/commune = code INSEE, hexagone = identifiant de grille Lambert-93 commun. Les indices d'un jeu restent **locaux** ; une table de correspondance les relie aux clés globales.
3. **Géographie ≠ jeu de données** : paquets séparés (fond administratif, hexagones, toponymes) partagés par tous les jeux.
4. **Moteur hors du fil principal** (Web Worker) avec la **même API** que le moteur local actuel, de sorte qu'un moteur *distant* soit substituable.
5. **Mesurer d'abord** : aucun choix de performance sans bancs d'essai reproductibles (§7).

## 4. Architecture cible pour les données

```
                 ┌────────────────────────── UI (carte, liste, fiche) ───────────────┐
                 │  ne connaît que : Engine.setFilters() / Engine.onResult(aggregats) │
                 └───────────────────────────────┬────────────────────────────────────┘
                                                 │ messages (Transferables)
                              ┌──────────────────┴───────────────────┐
                              │ Engine  (Worker | fil principal)      │
                              │  LocalEngine : colonnes en mémoire    │  ← §6 (jeux ≲ qq millions)
                              │  RemoteEngine : requêtes → serveur    │  ← §8 (jeux plus gros)
                              └───────┬──────────────────────┬────────┘
                                      │ DataSource            │
                       ┌──────────────┴───┐         ┌─────────┴─────────┐
                       │ ScriptSource      │         │ HttpSource         │
                       │ (<script> → base64│         │ (fetch binaire,    │
                       │  file:// OK)      │         │  Range, ETag)      │
                       └───────────────────┘         └────────────────────┘
```

### 4.1 Paquets de données (« packages »)
Manifeste `fmap-manifest.json` **et** son jumeau `fmap-manifest.js` (pour `file://`) :
```json
{ "format": 2, "built": "2026-…",
  "geo":      [{"id":"admin-fr","files":["geo-admin.bin"],"version":"…"}],
  "taxa":     {"id":"taxa-fr","files":["taxa.bin"]},
  "datasets": [
    {"id":"fongibase","title":"FongiBase 2022","mode":"embedded","records":1043262,"files":["ds-fongibase.bin"],"updated":null},
    {"id":"<second>","title":"…","mode":"chunked","chunks":["ds-2-0001.bin","ds-2-0002.bin"],"updated":"…"}
  ]}
```
Chaque fichier existe sous **deux encodages** produits par le même build : `.bin` (récupéré par `fetch`) et `.js` (`FMAP.register("ds-fongibase", "<base64>")`, chargé par `<script>` : `file://` OK). Les octets sont identiques.

### 4.2 Format de colonnes v2 (amélioration de performance **sans serveur**)
- **Une colonne = un tampon** (structure de tableaux, SoA) au lieu d'enregistrements entrelacés de 18 octets : chaque colonne se compresse beaucoup mieux (année/mois/espèce/département triés ou presque constants → delta + RLE), et le décodage devient une **vue sans copie** (`new Uint16Array(buf, off, N)`) : on supprime `splitColumns`.
- Gain attendu à **mesurer** (je n'ai pas encore la mesure) : octets sur disque ↓ nettement, décodage ≈ O(1) au lieu de ≈ 50–100 ms. Un prototype Python (3 colonnes, `zlib`) tranche en une heure : **première tâche du spike**.
- En-tête de fichier : `magic`, `format`, `schema` (liste de colonnes : nom, type, nullable), `rows`, somme de contrôle (CRC32). Fini les constantes dispersées (`REC = 18`).
- Dictionnaires **sans plafond 254** : indice 8 ou 16 bits choisi selon la cardinalité réelle (colonne `dept` : `uint16` si nécessaire) — corrige la perte silencieuse.
- `Float32` pour les positions si la quantification 16 bits devient trop grossière pour un jeu plus précis (le build choisit, l'en-tête le dit).
- Compression : `deflate` via `fflate` (déjà présent) ; **`DecompressionStream('deflate')` natif** quand disponible (Chrome 80+, Firefox 113+, Safari 16.4+) pour décompresser sans bloquer ni embarquer de code ; `fflate` en repli (Firefox 88–112 du cahier des charges).

## 5. Les trois régimes (choisis par taille et rythme du second jeu)

| Régime | Quand | Fonctionnement | Serveur ? |
|---|---|---|---|
| **A. Embarqué** | ≲ 2–3 M d'enregistrements, mises à jour rares | paquet `.js` à côté de `index.html`, chargé **à la demande** quand l'utilisateur active le jeu | non |
| **B. Par morceaux (chunked) « dynamique statique »** | jeu qui croît/est rafraîchi, quelques millions | découpage **par période** (mois/année) en morceaux immuables + manifeste ; le client ne recharge que ce qui est nouveau (ETag / `Cache-Control: immutable`), cache **IndexedDB** ; en `file://`, un script `tools/refresh_dataset.py` régénère les `.js` | non (hébergement statique + tâche planifiée type CI) |
| **C. Interrogé (serveur)** | dizaines de millions, filtres lourds, ou données qu'on ne peut/doit pas distribuer entièrement | `RemoteEngine` envoie l'état des filtres + l'emprise/le niveau ; le serveur renvoie des **agrégats** (comptages par hexagone/commune/espèce/mois) en tableaux binaires ; pas d'enregistrement unitaire | oui |

> Le mot « dynamique » est donc couvert **sans serveur** par B : « mettre à jour des fichiers statiques » (GitHub Actions + Pages/Releases, ou n'importe quel hébergement de fichiers). C'est la voie de moindre exploitation, et elle ne ferme pas la porte au serveur.

### Règle de bascule (indicative, à valider par le banc d'essai §7)
A→B si le jeu dépasse ≈ 3 M de lignes ou change plus d'une fois par mois ; B→C si la mémoire cible (≈ 200 Mo) ou le temps de filtre (> 150 ms hors fil principal) est dépassé, ou si l'API de la source impose un accès contrôlé.

## 6. Moteur local : où gagner en performance (ordre de rentabilité)

Aucun de ces gains n'est chiffré avant mesure ; l'ordre est celui du *coût attendu / bénéfice*.

1. **Format SoA + vues sans copie** (§4.2) : supprime `splitColumns` ; réduit le transfert.
2. **Web Worker** : filtre/agrégation hors du fil principal ; le résultat (compteurs par espèce, département, commune, lieu) revient en `Transferable`. Le fil principal ne fait que dessiner ⇒ pas de saccade même à plusieurs millions. **À vérifier par un spike sur `file://`** : un worker construit depuis un `Blob` fonctionne en général sous Chrome mais **pas sous Safari/WebKit** d'après les rapports de bugs trouvés ; les modules ES sont bloqués sur `file://` (CORS). Repli : moteur sur le fil principal découpé en tranches (`scheduler.postTask` / `requestIdleCallback`, ≤ 8 ms) — même API.
3. **Passe unique fusionnée** : aujourd'hui `applyFilters` écrit `failMask` puis `aggregate` relit tout. Fusionner en une passe qui calcule les compteurs *en même temps* (le masque n'est écrit que si nécessaire : aperçu, richesse). Divise par ~2 le coût mémoire-bande.
4. **Tests d'activation spécialisés** : générer (ou écrire à la main pour les ≈ 10 combinaisons fréquentes) des boucles qui ne testent que les filtres actifs (aujourd'hui 10 `if` par ligne même sans filtre). Possible via fonctions spécialisées ; `new Function` est une option mais évitable.
5. **Exploiter le tri** : les enregistrements sont triés par (département, espèce). Un filtre département ⇒ **plage contiguë** (`deptStart[d]..deptEnd[d]`) ; un filtre espèce seul ⇒ index inversé (offsets par espèce dans une permutation secondaire). Réduit « 1 département + 1 espèce » de 1 M à quelques milliers de lignes. Coût : un index de ~4 o × N.
6. **Index par mois/année** (histogrammes cumulatifs) pour les filtres temporels fréquents ; à envisager seulement si 1–5 ne suffisent pas.
7. **Agrégation hiérarchique** : conserver des compteurs pré-agrégés par (espèce × département × mois) pour répondre sans toucher aux enregistrements à l'état « sans filtre fin » ; utile à l'ouverture et au survol (aperçu d'espèce, `scanSpecies`).
8. **Évaluation paresseuse** : `computeRichness` (256 × 11 618 `Uint16`) n'est calculé que si la mesure est active (déjà le cas) ; `scanSpecies` mis en cache par espèce.
9. **Démarrage progressif** : afficher la carte dès que la géographie et les compteurs de base sont prêts (< 300 ms), puis activer filtres et liste quand les colonnes sont décodées ; second jeu **chargé uniquement s'il est activé**.
10. **Mémoire** : `failMask` en `Uint16` ⇒ 2 Mo/M de lignes ; OK. Pour deux jeux, un masque par jeu.
11. Alternatives **écartées** pour le build autonome : DuckDB-WASM/Apache Arrow (plusieurs Mo de WASM, chargement `fetch` problématique en `file://`), `crossfilter2` (gain réel seulement avec filtrage incrémental ; à reconsidérer si le banc d'essai le justifie), WebGL/deck.gl (dessin déjà en canvas suffisant ; réévaluer au-delà de ~500 000 symboles).

## 7. Banc d'essai de performance (à créer **avant** d'optimiser)

`tools/make_synthetic_csv.py` existe ; l'étendre pour générer N = 1 / 2 / 5 / 10 M avec le schéma du second jeu. Harnais Playwright (Chromium, + Firefox ensuite) enregistrant, dans `specs/performance.md` :
- temps jusqu'à la carte interactive (TTI) et jusqu'à la liste prête ;
- durée de `applyFilters` + `aggregate` (valeurs `perf.*` déjà exposées par `FMAP_APP`) pour 6 scénarios (aucun filtre, espèce, mois, département, période, tous) ;
- plus longue **tâche longue** du fil principal pendant un filtre (`PerformanceObserver` `longtask`) ;
- mémoire (`performance.measureUserAgentSpecificMemory` ou `performance.memory` en Chromium) ;
- taille sur disque / transférée.
**Budgets cibles** (proposition) : 1 M → TTI ≤ 1 s, filtre ≤ 50 ms ; 5 M → TTI ≤ 2,5 s, **aucune tâche longue > 50 ms** pendant un filtre (grâce au worker ou aux tranches), filtre bout en bout ≤ 250 ms, mémoire ≤ 250 Mo.

## 8. Moteur distant (régime C) — contrat à figer maintenant, à implémenter plus tard

Un seul point d'entrée, idempotent, **cacheable** :
```
POST /v1/datasets/{id}/query
{ "filters": { "species":[cd_ref…], "months":[9,10], "years":[2000,2021], "depts":["39"], "communes":["06152"], "edible":1 },
  "level": "dept|hex|commune|site", "bbox":[lon0,lat0,lon1,lat1], "include":["counts","species","series"] }
→ application/octet-stream  (en-tête JSON + tableaux typés alignés sur les index du manifeste)
```
- Les réponses sont **bornées** (nombre d'hexagones/communes/espèces est borné), donc cacheables par CDN avec la requête normalisée comme clé.
- Pas d'enregistrement unitaire sorti du serveur (sauf « liste des observations d'un lieu », paginée) : moins de volume **et** meilleure maîtrise des données sensibles (positions précises d'espèces protégées).
- Pile simple recommandée : API légère (FastAPI/Express) + **DuckDB** lisant du Parquet partitionné par année ; ou fonctions serverless. **Écarter** PostGIS/ClickHouse tant que la volumétrie ne l'exige pas.
- Alternative **sans serveur applicatif** à étudier : **PMTiles** (archive de tuiles servie par requêtes HTTP `Range`) pour les couches pré-agrégées par niveau ; elle suppose un hébergeur qui supporte `Range` et CORS (les hébergeurs statiques n'ont pas tous cette capacité — un retour d'expérience cite un hébergeur sans `Range` contourné par un service worker). Ne convient pas aux filtres combinatoires libres : à réserver aux couches de fond/hexagones fixes.
- Authentification/limites : hors périmètre tant que le jeu est public ; à prévoir si les données ne le sont pas.

## 9. Interface utilisateur du multi-jeux

- **Sélecteur de jeu** (segment ou liste) dans l'en-tête ou « Couches » : `FongiBase 2022 · <second jeu>`, avec date de mise à jour, nombre d'observations, licence/attribution.
- Les deux jeux **partagent** : filtres de période/mois/département, espèces (table canonique), commune, comestibilité. Le compte affiché par espèce = somme (option « par jeu » en infobulle).
- Représentation : la carte montre **un jeu à la fois** par défaut (couleur/rampe inchangées) ; un mode « comparer » (côte à côte ou différence) est une **évolution ultérieure** qui exige de répondre à : *les deux jeux mesurent-ils le même effort ?* (biais d'observateurs ≠ entre sources : ne jamais soustraire des comptes bruts sans le dire).
- Distinguer visuellement un jeu **dynamique** : pastille « mis à jour le … », indicateur de chargement des morceaux, état hors ligne.
- Attribution et licences affichées **par jeu** (légende, export).

## 10. Questions ouvertes (bloquantes pour l'estimation)

1. **Quel est le second jeu ?** (source, API ou fichier, schéma, couverture géographique, licence ; sensible ou public ?) Candidats plausibles à étudier — **non vérifiés** : extractions GBIF « Fungi » France, iNaturalist, bases de sociétés mycologiques.
2. Taille actuelle et **croissance** (lignes/mois) ?
3. « Dynamique » = mis à jour (A/B) ou interrogé (C) ? À quelle fréquence, par qui ?
4. Doit-il fonctionner **hors ligne** après un premier chargement ? (⇒ IndexedDB)
5. Mêmes champs que FongiBase ? Sinon lesquels (précision spatiale, identifiant d'observateur — **RGPD**) ?
6. Contrainte de **confidentialité** : positions d'espèces protégées/sensibles ? (dégradation obligatoire côté serveur ou au build)
7. Quel hébergement statique est envisagé (`Range`, CORS, en-têtes de cache) ?
8. Quand le serveur arrive, quelle équipe l'exploite ?

## 11. Découpage

0. **Spike (1 j)** : banc d'essai minimal + prototype SoA (taille/temps de décodage) + test Worker `Blob` sur `file://` (Chrome, Firefox, Safari si disponible) + `DecompressionStream`. Publie des **chiffres**.
1. Fondation d'architecture (voir l'issue dédiée) : paquets, `DataSource`, `Engine`, table canonique des taxons.
2. Format de colonnes v2 + build ; migration de FongiBase vers v2 (**sans changement visible**, valeurs d'ancrage identiques).
3. Moteur dans un Worker (+ repli tranches) ; une passe fusionnée ; benchs avant/après.
4. Index par tri (département/espèce) et agrégats pré-calculés si le banc d'essai le justifie.
5. Second jeu en régime A (chargement à la demande, sélecteur de jeu).
6. Régime B : manifeste, morceaux, rafraîchissement, cache IndexedDB.
7. `RemoteEngine` + contrat d'API (quand le serveur existe).

## 12. Tests et critères d'acceptation

- **Non-régression** : FongiBase v2 renvoie *bit pour bit* les mêmes compteurs que v1 pour 30 scénarios de filtres (script de comparaison) ; valeurs d'ancrage conservées.
- Un jeu absent ou corrompu ne casse pas l'application (message, désactivation du jeu, l'autre reste utilisable) ; somme de contrôle vérifiée.
- `file://` : le jeu s'active avec uniquement `<script>` ; aucun `fetch` local.
- HTTP : morceaux récupérés une fois, ensuite cache ; mise à jour = nouveaux morceaux seulement.
- Budgets §7 atteints sur 1 M et 5 M synthétiques.
- Les deux jeux ne partagent aucun indice local : test avec dictionnaires volontairement décalés.
- Licences/attributions du second jeu visibles.

## 13. Risques

| Risque | Parade |
|---|---|
| Spécification floue du « dynamique » | questions §10 **avant** l'estimation ferme |
| Worker indisponible sur `file://` selon navigateur | repli en tranches, même API |
| Dérive de format entre `.bin` et `.js` | un seul générateur, test de hachage |
| Clés canoniques incomplètes (`cd_ref` absent 5 %) | repli sur nom normalisé, rapport d'appariement |
| Diffusion de données sensibles | dégradation de position au build/serveur, jamais côté client |
| Surdimensionnement (DuckDB/PostGIS) | ne passer au régime C que sur preuve chiffrée |
| Dette de compatibilité (format v1 déjà diffusé) | `format` dans l'en-tête, lecteur v1 conservé 1 version |

## 14. Estimation grossière
Spike 1 j · fondation (voir son issue) · format v2 + migration 3–4 j · worker + passe fusionnée 3–4 j · index/agrégats 2–3 j · second jeu régime A 4–5 j · régime B 4–6 j · régime C ≥ 8 j (dépend du serveur) ⇒ **A ≈ 11–14 j après fondation ; B ≈ +5 j ; C ≈ +8 j et plus**. Fortement dépendant des réponses du §10.
