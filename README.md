# FongiMap

Carte interactive, **hors-ligne et sans serveur**, des 1 043 262 observations fongiques de
France (1708–2021) de l'extrait FongiBase — Gautier et al. 2022
([Zenodo 17158524](https://zenodo.org/records/17158524), CC-BY 4.0).

**Jeu de données par défaut** : « GBIF — positions précises (≤ 100 m) » (26 813 observations de macromycètes depuis 1990, CC0 / CC-BY). FongiBase et le jeu GBIF récent restent disponibles dans le sélecteur de l’en-tête ou avec `index.html?ds=fongibase`. Pour changer le défaut : `window.FMAP_DS_DEFAULT` dans `index.html`.

Livrable : **un dossier** à garder tel quel — `index.html` (petite page d’entrée) et `assets/` : `css/`, `js/` (application, moteur, D3, fond de carte) et `data/` (`data.js`, `geo-communes.js` — limites communales chargées au zoom —, `datasets.js` — liste des jeux de données —, jeux supplémentaires).
Double-clic sur `index.html` (protocole `file://`, aucune connexion requise ; seules deux fonctions facultatives, signalées dans l’interface, interrogent des services en ligne : couches IGN aux derniers zooms, humidité récente dans « Autour de moi »).

## Construire l'application

Prérequis : Python 3.9+, `pandas`, `numpy`.

```bash
pip install pandas numpy
```

1. Télécharger `DATA_Gautier et al 2022.csv` (219 Mo) depuis Zenodo et le placer dans `data_raw/`.
2. Générer les données embarquées :

   ```bash
   python tools/build_data.py   # ~40 s, produit assets/data/data.js (~9,5 Mo avec les vraies données)
   ```

3. Construire les fichiers du navigateur à partir de `src/` (CSS, JS, fond de carte, bibliothèques) :

   ```bash
   python tools/build_web.py    # produit assets/css/app.css et assets/js/*.js (≈ 1 Mo)
   ```

4. Ouvrir `index.html`.

Options utiles de `tools/build_data.py` : `--csv CHEMIN`, `--out DOSSIER`, `--sample N` (N premières lignes,
pour itérer vite), `--inspect` (affiche schéma, taux de valeurs manquantes, couverture GPS,
plage de dates, valeurs les plus fréquentes — n'écrit rien).

Pour tester sans le CSV réel : `python tools/make_synthetic_csv.py --rows 20000 --out test_data/x.csv`
génère un CSV **synthétique** (données aléatoires, jamais à présenter comme réelles).

## Utilisation

Principe (cours d'infovis) : *vue d'ensemble d'abord, zoom et filtre, détails à la demande*. À la première visite, un panneau
« À quoi sert FongiMap ? » (bouton **?** pour le rouvrir ; mémorisé dans `localStorage`, sans erreur si le stockage est bloqué)
explique le but, le mode d'emploi, les sources et les limites, et propose 4 questions de départ (« Où trouver des cèpes ? »,
« Quels champignons comestibles en octobre ? », morilles au printemps, amanite phalloïde).

| Zone | Rôle |
|---|---|
| Carte, zoom sémantique | Vue d'ensemble : départements. En zoomant, la carte se précise toute seule : **hexagones de 10 km** (≈ ×2) puis **lieux** (≈ ×6) en symboles gradués (1–9, 10–99, 100–999, ≥ 1 000 observations). Les lieux proches (moins de 17 px) sont **regroupés** en un seul symbole à contour épais (« regrouper plutôt que retirer ») ; zoomer les sépare. Les **frontières des départements** sont tracées par-dessus les hexagones et les lieux (les hexagones sont visiblement coupés à la frontière). Tout est **découpé sur la terre de France** (rien sur la mer ni à l'étranger). Une seule légende, celle de la couche visible. |
| Repères | Noms de lieux avec niveaux de détail et anti-chevauchement (halo blanc) : régions → grandes villes → départements → villes ≥ 5 000 hab. → plus gros lieux de récolte à fort zoom ; noms de mers et de pays voisins en vue d'ensemble ; échelle, **mini-carte de situation** (cliquable) dès qu'on zoome, nom du département survolé ou filtré. |
| Onglet « Champignons » | **Navigateur d'espèces** : recherche en direct (nom ou famille), tri « Plus observées » / « A→Z », badge de comestibilité (couleur + icône), famille, nombre d'observations. La liste suit **tous** les filtres sauf le filtre d'espèce : elle répond à « quels champignons ici / maintenant / comestibles ? ». **Clic** = filtre sur l'espèce, la carte vole vers sa répartition (2ᵉ–98ᵉ centiles de ses lieux) et la fiche s'ouvre ; second clic = retire. **Survol** d'une ligne = aperçu de sa répartition sur la carte. Entrée = choisit la première ligne. Une recherche qui donne plusieurs espèces propose « Voir les N espèces sur la carte ». |
| Filtre par commune | **Clic sur un nom de ville** (ou sur un lieu isolé de la carte) = filtre sur cette commune : la carte vole vers ses lieux, la liste d'espèces devient « les champignons de Valbonne », une pastille « Commune : Valbonne (06) × » (et le badge de l'onglet Filtres) permet de retirer le filtre ; reclic sur la même commune = retire. Clic sur un groupe de lieux = zoom. Approximation : il n'y a pas de contours de communes hors-ligne, chaque lieu est rattaché à la commune du même nom (≤ 12 km), sinon au centre de commune le plus proche. |
| Onglet « Filtres » | Période (double curseur), mois, département, guilde, et « Filtres avancés » (phylum, mode trophique, écorégion), combinés en **ET**. Le badge de l'onglet compte les filtres actifs. |
| Onglet « Autour de moi » | **Que trouver près de moi, maintenant ?** Un point (bouton « Me localiser » ou clic sur la carte), une date et un rayon (5, 10, 25, 50 km) donnent les espèces les plus observées dans ce rayon à cette époque de l’année (mois de la date, avec transition sur les mois voisins), avec leur total annuel, et les **lieux** où aller (distance, direction), éventuellement pour une espèce choisie ; filtre Toutes / Comestibles / Toxiques. « Vérifier l’humidité » (en ligne, sur clic, position arrondie à 1 km envoyée à open-meteo.com) montre la pluie, l’humidité de l’air et du sol et la température des derniers jours avec une indication simple de conditions favorables. La position n’est ni enregistrée ni mise dans le lien partagé. |
| Panneau latéral | Bouton en haut à gauche, languette sur le bord du panneau, touche `[` ou Ctrl/Cmd + B : masque ou rouvre le panneau pour donner toute la fenêtre à la carte ; le choix est mémorisé. |
| Comestibilité (en-tête) | « Tous / Comestibles / Toxiques » filtre toutes les vues, liste comprise. **Table indicative** (voir ci-dessous). |
| ⚙ Options de la carte | Niveau de détail forcé (Auto / Départements / Hexagones / Lieux), mesure colorant les départements (observations par 100 km² par défaut, total, espèces distinctes, richesse raréfiée), affichage des positions approximatives. |
| Fiche espèce | Photo (emplacement en attente), taxonomie, comestibilité et avertissement, chiffres clés, saisonnalité, départements les plus riches, « Voir sur la carte », Wikipédia/GBIF. Échap pour fermer. |

Les graphiques du bas ont été supprimés (trop d'informations) : la saisonnalité d'une espèce est dans sa fiche, la période et
les mois sont des filtres de la barre latérale. Toutes les mises à jour s'animent (jointures D3 enter/update/exit, ré-ordonnancement
FLIP de la liste, valeurs qui défilent) ; désactivé si le système demande de réduire les animations.

La liste d'espèces et les départements de la carte comptent les observations qui passent **tous les autres** filtres que le
leur : valeurs sélectionnées et non sélectionnées restent visibles côte à côte (filtrage croisé / « brushing and linking »).

### Choix cartographiques
- **Projection** : Lambert-93 (méridien central 3° E, parallèles 44° et 49° N), la projection officielle française.
- **Carte choroplèthe** : les totaux bruts reflètent la taille du département et l'effort des observateurs ; la densité par km² est donc la mesure par défaut, avec des classes par quantiles (bornes affichées) et une palette séquentielle sans classe quasi blanche.
- **Biais d'échantillonnage** : la densité d'observations mesure surtout l'effort de collecte, pas l'abondance des champignons. La richesse raréfiée (n = 100) est une correction partielle ; elle ne supprime pas le biais de localisation des observateurs, et ses écarts sont souvent faibles.
- **Hexagones de 10 km** : après avoir testé des hexagones écran, puis des carrés INPN, la couche intermédiaire est un pavage d'hexagones (10 km de large, ≈ 86,6 km² chacun, tous de même surface, calculés dans `tools/build_data.py` en Lambert-93). Surface égale donc comptage = densité : variable *valeur* (5 classes). Une phrase dans la légende explique leur sens.
- **Incertitude** : positions approximatives dessinées en pâle (valeur/transparence = qualité de la position), signalées dans la légende et les infobulles, masquables.
- **Légende** : une seule à la fois ; classes aux bornes arrondies (départements : 6 classes issues des quantiles, bornes arrondies à 1, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × 10ⁿ), vignettes étiquetées. Valeur (clair → foncé) pour les données relatives (densité par département, hexagones de surface égale) ; taille (cercles proportionnels par classes) pour les comptages absolus (lieux).
- **Couleurs** : palette de comestibilité sans opposition rouge/vert (Okabe-Ito) et icônes redondantes dans la fiche.
- Non retenu : cartes de chaleur par noyau (le choix de la largeur de bande peut tromper), remplacées par des cellules comptées.

### Précision spatiale
Le CSV ne donne que le **département**, un **point GPS** (462 678 observations) et un **nom de lieu** libre (`locality`).
`tools/build_data.py` place en plus les observations sans GPS à partir de (département, lieu) :
1. centre de la **commune** de ce nom dans ce département (liste officielle `data_raw/communes.json`, téléchargée depuis
   [geo.api.gouv.fr](https://geo.api.gouv.fr/communes?fields=nom,code,codeDepartement,centre&format=json&geometry=centre)) : 468 823 observations ;
2. sinon position médiane des autres observations du même lieu : 8 793 observations.

Résultat : **927 007 observations localisées (88,9 %)**, 45 200 positions dont 6 831 approximatives (après masque terrestre, ci-dessous). Les positions
approximatives (centre de commune, pas le lieu exact de la récolte) sont dessinées en pâle et signalées dans l'infobulle.
~9 000 observations (nom de lieu absent ou introuvable) restent au niveau département. Sans `communes.json` (ou avec
`--no-geocode`) seuls les vrais points GPS sont utilisés. Source des communes : Etalab / IGN, licence ouverte.

### Masque terrestre (rien sur la mer ni à l'étranger)
`tools/build_data.py` teste chaque position distincte contre les polygones des 96 départements (point dans polygone, sans dépendance
supplémentaire, en Lambert-93). Sur 45 245 positions, 272 tombent hors du fond de carte simplifié : **252** (7 357 observations,
à moins de 3 km de la côte ou de la frontière : simple imprécision du tracé simplifié) sont ramenées 300 m à l'intérieur ;
**20** (266 observations : mer, étranger, îles absentes du fond comme les Sept-Îles, coordonnées arrondies en mer) perdent
leur position mais restent comptées par département. Contrôle final : 0 position conservée hors des polygones. À l'affichage,
les mailles et les symboles sont de plus découpés (`clip`) sur le contour des départements. Hors fond de carte par le code
département : 16 364 observations (971–976 outre-mer 13 828, vide 1 011, `ZMMMT` 156, codes erronés) : comptées dans les totaux
mais sans département sur la carte. Option `--no-mask` pour désactiver.

### Noms de lieux
Les villes de ≥ 5 000 habitants (2 280 communes) sont embarquées dans `data.js` (nom, centre, population ; population
téléchargée sur l'API publique [geo.api.gouv.fr](https://geo.api.gouv.fr/communes?fields=nom,code,population&format=json) dans
`data_raw/communes_population.json`, 1,9 Mo, jointe par code INSEE). Noms de régions et départements : fond de carte.

### Comestibilité
Aucun jeu de données ouvert exploitable n'existe : `data_processed/edibility.csv` est une table **rédigée à la main**
(≈ 190 espèces courantes + règles par genre, toujours dans le sens prudent), couvrant ≈ 55 % des observations. Elle n'a
pas été validée par un mycologue : ne jamais consommer un champignon sur cette base. Éditez le CSV puis relancez `tools/build_data.py`.

### Photo / texte de la fiche
Branchement prévu : définir `window.FMAP_SPECIES_PROVIDER = (nom) => Promise.resolve({imageUrl, summary})` avant l'application.

Particularités des données réelles, gérées par `tools/build_data.py` : colonne `department` = **codes** (associés aux
noms via le fond de carte) ; coordonnées `NULL` ou `0,0` (≈ 576 000 enregistrements) traitées comme absentes — seules
462 678 observations ont un point GPS valide ; dates `AAAA-01-01` (≈ 70 000) = « année seule », mois inconnu
(`--keep-jan1` pour les conserver) ; années hors 1700–2021 ignorées ; espèce `NA NA` = non renseignée.

Une sélection de période différente de 1900–2021 exclut les observations sans date.

## Structure

```
index.html            ← page d’entrée (écrite à la main, ≈ 19 Ko)
assets/               ← tout ce que la page charge (généré, versionné pour l’instant)
  css/app.css           styles (construit depuis src/css/)
  js/                   app.js · core.js (moteur) · worker-source.js · geo-france.js · vendor/ (D3, fflate)
  data/                 data.js · geo-communes.js · datasets.js · data-<jeu>.js (tools/build_data.py)
src/                  ← sources : css/ (11 fichiers ordonnés), js/core/ (moteur sans DOM), js/app/ (application)
vendor/               ← d3.min.js 7.9.0, fflate.umd.js 0.8.2 (VENDOR.md)
tools/                ← build_data.py (CSV → assets/data) · build_web.py (src → assets) · pipeline/ · import_gbif.py ·
                        fetch_raw.py · prepare_vernacular.py · make_synthetic_csv.py · check_file_url.js · check_a11y.js
data_processed/       ← GeoJSON départements / régions, comestibilité, noms français (petits fichiers versionnés)
data_raw/             ← entrées téléchargées (CSV ignoré par git)
tests/  specs/        ← tests Node · spécifications et journal de décisions
```

Le format binaire (18 octets/enregistrement, auto-décrit par `META.format` : version, taille, CRC-32) est documenté en tête de `tools/build_data.py` et de `src/js/app/00-state.js`.

## Développement (nouveautés de novembre 2026)

```bash
python tools/fetch_raw.py --what all   # télécharge le CSV FongiBase et les limites communales IGN, vérifie les SHA-256
python tools/build_data.py            # assets/data : data.js + geo-communes.js + datasets.js (~40 s)
python tools/build_web.py              # assets/css + assets/js (après toute modification de src/)
node --test "tests/*.test.js"          # 23 tests : moteur (golden master), « autour de moi », recherche, URL, chunks, moteur distant, courbes de niveau
node tools/check_file_url.js           # charge index.html en file:// dans Chrome/Edge sans interface et vérifie compteurs, Worker, erreurs
node tools/check_a11y.js               # axe-core sur 7 écrans (npm install --no-save axe-core d’abord)
node tools/bench_engine.js             # mesures de performance (voir specs/performance.md)
```

- **Noms français** : `tools/prepare_vernacular.py` (TAXREF v18 puis Wikidata) produit `data_processed/vernacular_fr.csv` ; corrections humaines dans `data_processed/vernacular_overrides.csv` (`species,name_fr,status`). La recherche accepte français et latin (sans accents, pluriels, ligatures).
- **Communes** : polygones IGN ADMIN-EXPRESS COG PLUS 2025 (Licence Ouverte), `tools/pipeline/communes.py`. Au zoom, départements → hexagones → communes colorées → lieux. Champ « Aller à une commune » sur la carte.
- **Forêts et altitudes (IGN, en ligne)** : aux derniers niveaux de zoom (k ≥ ~50), délimitation des forêts (masque forêt IGN 2021-2023), courbes de niveau calculées à partir de RGE ALTI (gras tous les 100 m, étiquetées), sommets et cols avec leur altitude. Deux interrupteurs indépendants dans ⚙ Options (`fo=0` / `al=0` dans le lien) ; sans connexion, ces couches sont simplement absentes.
- **Lien partageable** : l'état (filtres, vue, niveau) est dans l'adresse (`#sp=Boletus%20edulis&m=9,10&v=5.7,46.7,6`). Exports PNG / CSV dans ⚙ Options.
- **Plusieurs jeux de données** : `python tools/build_data.py --csv autre.csv --dataset-id mon_jeu --title "…" --credit "…" --licence "…" [--chunks 4] [--synthetic]` produit `assets/data/data-mon_jeu.js` (et ses morceaux) ; le sélecteur de l'en-tête (ou `index.html?ds=mon_jeu`) change de jeu. Avec `--chunks`, les périodes récentes se chargent d'abord, les anciennes en arrière-plan.
- **Moteur** : `src/js/core/` (sans DOM, testé sous Node) tourne dans un Web Worker (vérifié en `file://` sur Chrome et Edge) ; `?worker=0` force le fil principal ; `?verify=1` contrôle la somme de contrôle des données.
- **Fluidité** : pendant un glisser ou un zoom, les calques sont déplacés par le navigateur (transformation CSS) et redessinés quand le geste s’arrête ; les couches IGN ne chargent rien en mouvement. Un moteur distant (`tools/serve_remote.js`) montre le contrat HTTP d'un futur serveur.
- Documentation : `specs/README.md` (index), `specs/architecture.md`, `specs/roadmap.md`, `specs/performance.md`, `specs/context.md` §8–9.

## Déploiement (GitHub Actions → Netlify)

`.github/workflows/deploy-netlify.yml` : à chaque fusion sur `main`, le workflow vérifie que `assets/` est à jour et lance les tests, puis publie `index.html` et `assets/` (rien d’autre) sur le site Netlify **fongimap** avec la CLI Netlify.
À faire une fois dans GitHub (Settings → Secrets and variables → Actions) : ajouter le secret `NETLIFY_AUTH_TOKEN` (votre jeton d’accès personnel Netlify), au niveau du dépôt ou de l’environnement `production`. Le workflow retrouve tout seul l’**identifiant** du site à partir de son nom (`fongimap` par défaut, variable facultative `NETLIFY_SITE`), car la CLI Netlify n’accepte plus un nom pour `--site` ; vous pouvez aussi fixer l’identifiant avec la variable `NETLIFY_SITE_ID` (Netlify → Site configuration → Site ID). Le jeton doit appartenir au compte ou à l’équipe qui possède le site. Ne jamais écrire le jeton dans le dépôt. Lancement manuel possible (onglet Actions → deploy-netlify → Run workflow).
