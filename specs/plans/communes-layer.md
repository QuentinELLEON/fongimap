# Carte : couleur par commune (délimitations) au zoom, pour se repérer

> Plan d'implémentation détaillé — **rien n'est codé**. Étiquettes : `enhancement`.
> Contexte transverse : [`specs/architecture.md`](../architecture.md). Dépend de rien ; le chargement de la géométrie doit suivre le format « paquet » décrit dans [`architecture-foundation.md`](architecture-foundation.md) (mais peut démarrer avant, voir §9).

## 1. Demande (retour des cartographes)

> « Mettre la couleur des communes en délimitation et quand on zoom pour se repérer. »

### Interprétation retenue (à confirmer, cf. §11)
Quand on zoome, la carte perd aujourd'hui sa couleur : la choroplèthe des départements s'estompe à 30 % (`drawLayers`, `src/app.js:667`) et on ne voit plus que des hexagones puis des points ambre sans aucune limite administrative plus fine que le département. On veut :
1. **dessiner les limites des communes** (polygones réels) dès que le zoom les rend lisibles ;
2. **les colorer** (choroplèthe par commune, même logique que les départements) pour garder une lecture « couleur = quantité » à tous les niveaux de zoom ;
3. s'en servir pour **se repérer** : noms, hiérarchie de traits (région > département > commune), survol/clic précis.

Lecture alternative écartée : « seulement des contours colorés par département ». Moins utile, ne règle pas « département → commune » laissé en suspens en [`context.md` §7.6](../context.md).

## 2. État actuel (ce qui existe, vérifié dans le code)

| Sujet | Où | Constat |
|---|---|---|
| Échelle sémantique | `layerAlphas()` `app.js:553` | départements → hexagones 10 km (k 1,7–2,8) → lieux (k 5,2–6,4). Pas de niveau « commune ». |
| Communes | `META.communes` (0,41 Mo) | seulement nom, code département, centre. Pas de géométrie. |
| Commune d'un lieu | `build.py: build_communes` | commune de même nom si centre ≤ 12 km, sinon **centre de commune le plus proche** → approximatif (cf. `context.md` §7.7 « Caveats »). |
| Masque terrestre | `build.py: mask_to_land` | construit sur les polygones départements simplifiés ; 272 positions hors tracé, 252 ramenées de 300 m. |
| Traits | `strokeBorders()` `app.js:452` | un seul `Path2D` (`landClip`) = départements. |
| Libellés | `layoutLabels()` `app.js:772` | villes ≥ 5 000 hab. seulement (2 280 communes). |

## 3. Décisions de conception

### D1. Une seule source géométrique : la topologie des communes
Départements, régions, trait de côte et masque terrestre sont **dérivés** de la topologie des communes (fusion d'arcs partagés), pas téléchargés séparément. Sinon les traits « département » (gregoiredavid) et « commune » (autre source/millésime) ne coïncident pas : fentes, doubles traits. TopoJSON/arcs partagés permet aussi de **tracer chaque frontière une seule fois** et de classer chaque arc par niveau (`commune` / `département` / `région` / `côte`), d'où la hiérarchie de traits sans calcul à l'exécution.

### D2. Coordonnées stockées *déjà projetées* (espace virtuel 1000×1000)
Le dessin actuel utilise `ctx.setTransform` + un `Path2D` en coordonnées virtuelles (`clipToLand`). On fait pareil : `build` écrit les sommets en entiers dans l'espace virtuel (même projection que d3 : `rotate([-3,0])`, parallèles 44/49, `fitSize([1000,1000], DEPTS)`), et `META.proj = {scale, translate, rotate, parallels}` est embarqué. **Aucune projection par sommet à l'exécution** (1 M de sommets × d3 = trop pour une frame). Test d'écart JS↔Python < 0,01 px sur 100 points aléatoires pour empêcher toute dérive.
*Risque :* si le fond de carte `fitSize` change, tout est à régénérer → le test de dérive doit casser le build, pas silencieusement décaler.

### D3. Niveau d'affichage et échelle de zoom
Ordre cible : **département → hexagone → commune → (lieux par-dessus)**.
Ordres de grandeur (à mesurer, k = zoom d3) : la France métropolitaine ≈ 551 700 km² pour ≈ 34 800 communes, soit ≈ 16 km² (≈ 4 km de côté) ; à k = 1 la carte fait ≈ 0,63 px/km sur un viewport ~700 px de haut → une commune médiane fait ≈ 2,5 px à k = 1, ≈ 12 px à k = 5, ≈ 20 px à k = 8.

| Niveau | k | Remarque |
|---|---|---|
| Départements | < 2 | inchangé |
| Hexagones 10 km | 1,7 → ~5 | inchangé (garde la lecture « densité à surface égale ») |
| **Communes** | fondu 4 → 5,5, plein ≥ 5,5 | nouveau |
| Lieux (symboles) | **déplacés** de 5,2–6,4 à ≈ 9–11 | sinon communes et points se superposent dès leur apparition ; communes passent à 45 % d'opacité de remplissage, **bordures conservées** |

À valider avec les cartographes sur 3 zones (Île-de-France dense, Jura, Corse) : c'est un réglage, pas une vérité.

### D4. Valeur colorée
Même sélecteur que les départements (`METRICS`) : densité (obs/km²) par défaut, total, richesse. **Attention** : à l'échelle communale, la densité est volatile (petite commune + 1 observation = valeur énorme) :
- classes par quantiles **sur les communes non vides** uniquement (comme `updateMap` pour les départements), bornes arrondies (`niceCut`), légende propre au niveau ;
- commune à 0 observation = remplissage neutre `COL_ZERO` + bordure visible (pour que le maillage reste lisible) ;
- l'infobulle affiche toujours le **nombre brut** et le nombre d'espèces ; option « Total » pour ceux qui veulent le brut ;
- teinte identique aux départements (YlGn) pour la continuité visuelle ; classes différentes par niveau (jamais visibles ensemble) — à discuter : échelle fixe partagée entre niveaux (voir Questions ouvertes).

Point de vigilance de fond : **469 000 observations** (45 %) sont positionnées *au centre de commune* (`approx`). Pour elles la commune est la vraie précision : la choroplèthe communale est plus fidèle que les points. Elle doit donc être le niveau « honnête » par défaut au zoom moyen ; la légende le dit.

### D5. Rattachement lieu → commune par **polygone**, pas par proximité
- Lieux GPS : point-dans-polygone sur les **géométries non simplifiées** (index grille ou R-tree maison en numpy), repli sur la commune la plus proche si hors de tout polygone (côte).
- Lieux « centre de commune » (`approx`) : la commune est **connue par son code INSEE** (c'est ce qui les a géocodés) → on la conserve ; ne **pas** re-tester le point : le « centre » de l'API peut être hors du polygone d'une commune concave.
- Supprime la règle 12 km / plus proche centre (`context.md` §7.7).
- Bonus : remplace le masque terrestre départemental par l'union des communes (côte plus fine) ; objectif : les 272 positions « hors tracé » doivent baisser nettement. À mesurer, pas à promettre.

## 4. Données

### Source (à valider — voir [`literature.md`](../literature.md))
Candidats (ordre de préférence) :
1. **IGN ADMIN-EXPRESS COG PLUS, versions « simplifiées par l'IGN »** (geoparquet / GeoJSON 4326 / **TopoJSON** 4326 et 2154) — déjà généralisé, topologie partagée si TopoJSON. Millésime à épingler.
2. Etalab « Contours administratifs » (data.gouv.fr, GeoJSON / GeoJSON.gz), celui qu'utilise l'API Géo.
3. `gregoiredavid/france-geojson` (communes par département) : dépôt déjà utilisé pour les départements/régions.
4. API Géo (`geo.api.gouv.fr/communes?geometry=contour&format=geojson`) : contour complet, **lourd**, un appel par département.

Licence à vérifier avant tout ajout (Licence Ouverte Etalab attendue pour 1–2, **non vérifié ici**). Même COG (millésime) que `data_raw/communes.json` : sinon fusions de communes (« communes nouvelles ») ⇒ codes INSEE qui ne se retrouvent plus. Exiger : 0 code orphelin dans les deux sens, rapport imprimé par le build.

### Cas particuliers
- Paris / Lyon / Marseille : rester au niveau commune (75056, 69123, 13055). Les localités du CSV portent rarement l'arrondissement. À documenter dans la légende.
- Corse (2A/2B) incluse ; outre-mer exclu (le fond de carte l'exclut déjà).
- Communes déléguées / mer / lacs : ignorer, ne garder que les communes COG.

### Étape de préparation (hors `build.py`)
`tools/prepare_communes.py` (ou `mapshaper` si Node accepté) — **exécuté une fois, sortie committée** dans `data_processed/` comme les GeoJSON existants, pour que `build.py` reste `numpy + pandas` (NFR-05.1) :
1. lire la source, filtrer métropole ;
2. simplifier **en préservant la topologie** (Visvalingam ou Douglas-Peucker sur arcs partagés) ; tolérance par niveau de détail (cf. D6) ;
3. dériver départements et régions par fusion de communes (contrôle : mêmes codes que `departements.geojson` / `regions.geojson`) ;
4. classer les arcs : `commune`, `département`, `région`, `côte` (= arc n'ayant qu'un voisin) ;
5. calculer pour chaque commune : `code`, `nom`, `dep`, `surface_km2` (**surface ellipsoïdale non simplifiée**, jamais celle du polygone simplifié), `pop`, point d'ancrage d'étiquette (`polylabel`/point représentatif, pas le centroïde) ;
6. écrire `data_processed/communes.topo.json` + `SOURCES.md` (URL, date, SHA-256, licence, millésime COG).

### Format embarqué (budget **≤ 3 Mo** de plus dans `data.js`, à mesurer en spike)
Coordonnées entières (espace virtuel × 16, soit ~0,06 unité = quelques dizaines de mètres), **delta-codées** par arc, varint, puis `zlib` + base64 comme les enregistrements. Estimation à vérifier : ~1 M de sommets uniques après simplification × ≈ 2–2,5 octets compressés ≈ 2–3 Mo. Si le budget saute : (a) tolérance plus forte, (b) 12 Mo reste le plafond NFR-03.2 (aujourd'hui 8,04 Mo), (c) paquet séparé `geo-communes.js` chargé à la demande (§5).

### Deux niveaux de détail (LOD)
- **L1** (tolérance ≈ 300–400 m) : livré dans le build autonome, suffit jusqu'à k ≈ 12.
- **L2** (≈ 80–100 m) : seulement dans le build « web » (tuiles/paquets chargés à la demande, cf. `dynamic-dataset.md` §6). En autonome, au-delà de k ≈ 12, on garde L1 (côtés un peu anguleux) — **choix assumé**, à documenter.

## 5. Exécution (runtime)

1. **Chargement paresseux** : la géométrie n'est décodée qu'au premier passage k ≥ 3,5 (idle callback), jamais au boot. Décodage par **tuiles spatiales** (grille ~16×16 sur l'espace virtuel) pour étaler le coût.
2. **Structure** : `communeCount: Uint32Array(nCommunes)`, `communeClass: Uint8Array`, `tileIndex: Map<tile, Int32Array(communeIds)>`, `pathCache: Map<id, Path2D>` (LRU ~8 000).
3. **Agrégation** : *aucun coût par enregistrement supplémentaire* — après `aggregate()`, additionner `siteTarget[k]` dans `communeCount[siteCommune[k]]` (45 000 lieux, ~0,1 ms). Les 9 000 observations sans lieu restent au niveau département (déjà le cas).
4. **Dessin** (canvas 2D, nouvelle couche entre `grid-canvas` et `dot-canvas`, ou fusion avec `grid-canvas` partagé) :
   - cull par tuiles visibles puis bbox ;
   - regroupement par classe de couleur → un `fillStyle` par classe ;
   - **bordures** : tracer les arcs (une fois chacun) par niveau, du plus fin au plus épais : commune `0,4 px rgba(60,52,38,.25)`, département `1,1 px .6`, région `1,8 px .8`, côte `0,8 px`. Largeurs en **pixels écran** (`lineWidth = px / a`, comme `strokeBorders`) ;
   - dessiner le remplissage *puis* les traits (masque les coutures d'anticrénelage entre polygones voisins) ;
   - clip terre : plus nécessaire pour ce niveau (les polygones *sont* la terre).
5. **Étiquettes** : réutiliser `layoutLabels` ; une commune est nommée si la largeur écran de sa bbox ≥ largeur du texte + 8 px et k ≥ 7 ; priorité population puis surface ; ancre = point d'ancrage précalculé. Noms de départements jusqu'à k < 20 au lieu de 14.
6. **Interaction** : survol = contour 2 px + infobulle (nom, INSEE, pop., obs., espèces, densité) ; clic = `pickCommune` **avec zoom sur la bbox du polygone** (au lieu de la bbox des lieux) ; Échap retire le filtre. Test de survol par tuile + point-dans-polygone sur les seuls candidats (bbox), pas par SVG (35 000 `<path>` DOM interdit).
7. **Recherche de commune** (sous-tâche optionnelle mais forte pour « se repérer ») : champ « Aller à une commune… » dans la barre latérale ou le coin de carte, autocomplétion sur `COM.names` (normalisation identique à la recherche d'espèces, cf. `french-names.md`), vole vers le polygone et active le filtre.
8. **Légende** : un bloc « Observations par km² — communes » + une ligne « 0 observation » ; mention `Les lieux en centre de commune sont approximatifs : la commune est l'échelle fiable`.
9. **Options** : le sélecteur de niveau (`seg-layer`) gagne « Communes » ; case « Afficher les limites communales » indépendante pour garder le maillage sous les hexagones si voulu.

## 6. Performance (budgets, à mesurer avant/après)

| Mesure | Budget |
|---|---|
| Surcoût au boot | 0 ms (géométrie paresseuse) |
| Décodage géométrie complète (idle, 1 fois) | ≤ 400 ms hors thread principal si Worker disponible, sinon par tuiles ≤ 16 ms/tâche |
| Frame de pan/zoom à k = 6 sur Île-de-France (≈ 2 000 communes visibles) | ≤ 16 ms (60 fps) en cible, ≤ 33 ms accepté |
| Recoloration après filtre (agrégation + classes) | ≤ 5 ms en plus des ~35–65 ms actuels |
| Mémoire supplémentaire | ≤ 40 Mo (tampons de géométrie + cache `Path2D` plafonné) |

Si un budget est dépassé : rastériser les communes hors mouvement (cache bitmap), réduire la LOD pendant le geste (`k` en cours d'animation), ou `OffscreenCanvas` dans un Worker.

## 7. Accessibilité & lisibilité

- Ne pas faire reposer la lecture sur la seule couleur : traits de bordure visibles, valeur en infobulle, légende chiffrée.
- Rampe vérifiée daltonisme (YlGn séquentielle : OK en luminance monotone — le valider par simulation) et contraste des bordures ≥ 3:1 contre le remplissage le plus clair.
- Survol non indispensable : la sélection par clic/Entrée + la recherche de commune offrent un accès clavier.

## 8. Tests et critères d'acceptation

**Build** : toutes les communes COG métropolitaines présentes ; 0 code orphelin (rapport) ; chaque lieu GPS a une commune ; nombre de lieux dont la commune change vs l'ancienne règle (rapport de régression) ; sortie déterministe (même hash à données identiques) ; poids ≤ budget ; test de dérive de projection.
**Valeurs d'ancrage à conserver** : 1 043 262 enregistrements, 11 618 taxons, 96 départements, max département 78 199 (Pas-de-Calais), **Valbonne : 302 observations, 180 espèces, 7 lieux** (peut varier légèrement avec le rattachement par polygone : l'écart doit être expliqué, pas ignoré).
**Visuel** (captures Playwright, 3 viewports) : Valbonne k≈43 (polygone, nom, clic), Paris/Île-de-France k≈6, Corse k≈5, frontière belge (Nord) k≈8 : pas de fente entre département et communes, pas de commune qui déborde en mer.
**Fonctionnel** : clic commune ⇒ filtre + vol sur polygone ; second clic ⇒ retire ; espèce active ⇒ communes sans l'espèce neutres ; légende change avec le niveau ; Échap.
**Perf** : harnais commun (`specs/performance.md` à créer) : p95 de frame lors d'un pan scripté.

## 9. Découpage proposé (PR de taille revue)

0. **Spike (½–1 j)** : récupérer la source, simplifier à 3 tolérances, **publier les tailles réelles** (brut, zlib, base64) et un rendu de contrôle. Décide LOD et budget.
1. `tools/prepare_communes.py` + `data_processed/communes.topo.json` + `SOURCES.md` (+ rapport de cohérence COG).
2. `build.py` : rattachement lieu→commune par polygone ; écriture `META.proj` et de la géométrie ; test de non-régression sur Valbonne.
3. Runtime : décodage paresseux, index de tuiles, `Path2D` en cache, dessin remplissage + bordures hiérarchiques ; nouvelle échelle sémantique.
4. Interaction : survol/infobulle, clic/filtre sur polygone, étiquettes.
5. Légende, options, recherche de commune.
6. Mesures de perf, captures de référence, mise à jour README/`context.md`.

Les étapes 3–5 sont indépendantes de la refonte d'architecture : la géométrie peut être un `<script>` supplémentaire (`geo-communes.js`) qui expose `window.FMAP_GEO_COMMUNES`, conforme au futur format « paquet ».

## 10. Risques

| Risque | Parade |
|---|---|
| Taille > 3 Mo | spike, tolérance, LOD, paquet séparé |
| Millésime COG ≠ `communes.json` | épingler un seul millésime, rapport d'orphelins bloquant |
| Fusions de communes depuis 2022 : localités du CSV (années 1708–2021) pointent vers d'anciennes communes | table d'alias ancien→nouveau code (INSEE publie les « mouvements de communes ») ; sinon repli sur nom |
| Perf de dessin à k bas (trop de polygones) | seuil de zoom + cull + cache bitmap |
| Rendu « mosaïque » trop chargé | bordures très claires, pas d'aplat saturé, option de masquage |
| Écart JS/Python de projection | test automatisé bloquant |

## 11. Questions ouvertes (à trancher avec les cartographes)

1. La lecture du §1 est-elle la bonne ? (sinon : contours colorés par département uniquement).
2. Valeur par défaut : densité par km², total, ou « présence/absence » à l'échelle commune ?
3. Échelle de classes : propre à chaque niveau (recommandé) ou **unique** partagée département/commune ?
4. Garder les hexagones entre départements et communes, ou les retirer au profit des communes ?
5. Arrondissements de Paris/Lyon/Marseille : agrégés (proposé) ou séparés ?
6. Acceptez-vous la perte de finesse au-delà de k ≈ 12 dans le build autonome ?
7. Souhaitez-vous d'autres repères (cours d'eau, forêts, routes principales) ? Hors périmètre ici, mais « se repérer » pourrait l'exiger : sources IGN/OSM à étudier dans un ticket séparé.

## 12. Estimation grossière
Spike 0,5–1 j · préparation données 1–2 j · build 1–2 j · runtime 3–4 j · interaction/légende/recherche 2 j · tests/perf 1–2 j ⇒ **≈ 9–13 jours** pour une personne connaissant le code. Le principal inconnu est la taille de la géométrie : le spike la lève.
