# FongiMap

Carte interactive, **hors-ligne et sans serveur**, des 1 043 262 observations fongiques de
France (1708–2021) de l'extrait FongiBase — Gautier et al. 2022
([Zenodo 17158524](https://zenodo.org/records/17158524), CC-BY 4.0).

Livrable : **deux fichiers** à garder dans le même dossier — `index.html` et `data.js`.
Double-clic sur `index.html` (protocole `file://`, aucune connexion requise).

## Construire l'application

Prérequis : Python 3.9+, `pandas`, `numpy`.

```bash
pip install pandas numpy
```

1. Télécharger `DATA_Gautier et al 2022.csv` (219 Mo) depuis Zenodo et le placer dans `data_raw/`.
2. Générer les données embarquées :

   ```bash
   python build.py            # ~25 s, produit data.js (~7,2 Mo avec les vraies données)
   ```

3. Assembler la page (bibliothèques, fond de carte, CSS et JS sont intégrés) :

   ```bash
   python assemble_html.py    # produit index.html (~0,8 Mo)
   ```

4. Ouvrir `index.html`.

Options utiles de `build.py` : `--csv CHEMIN`, `--out DOSSIER`, `--sample N` (N premières lignes,
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
| Onglet « 🍄 Champignons » | **Navigateur d'espèces** : recherche en direct (nom ou famille), tri « Plus observées » / « A→Z », badge de comestibilité (couleur + icône), famille, nombre d'observations. La liste suit **tous** les filtres sauf le filtre d'espèce : elle répond à « quels champignons ici / maintenant / comestibles ? ». **Clic** = filtre sur l'espèce, la carte vole vers sa répartition (2ᵉ–98ᵉ centiles de ses lieux) et la fiche s'ouvre ; second clic = retire. **Survol** d'une ligne = aperçu de sa répartition sur la carte. Entrée = choisit la première ligne. Une recherche qui donne plusieurs espèces propose « Voir les N espèces sur la carte ». |
| Filtre par commune | **Clic sur un nom de ville** (ou sur un lieu isolé de la carte) = filtre sur cette commune : la carte vole vers ses lieux, la liste d'espèces devient « les champignons de Valbonne », une pastille « Commune : Valbonne (06) × » (et le badge de l'onglet Filtres) permet de retirer le filtre ; reclic sur la même commune = retire. Clic sur un groupe de lieux = zoom. Approximation : il n'y a pas de contours de communes hors-ligne, chaque lieu est rattaché à la commune du même nom (≤ 12 km), sinon au centre de commune le plus proche. |
| Onglet « Filtres » | Période (double curseur), mois, département, guilde, et « Filtres avancés » (phylum, mode trophique, écorégion), combinés en **ET**. Le badge de l'onglet compte les filtres actifs. |
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
- **Hexagones de 10 km** : après avoir testé des hexagones écran, puis des carrés INPN, la couche intermédiaire est un pavage d'hexagones (10 km de large, ≈ 86,6 km² chacun, tous de même surface, calculés dans `build.py` en Lambert-93). Surface égale donc comptage = densité : variable *valeur* (5 classes). Une phrase dans la légende explique leur sens.
- **Incertitude** : positions approximatives dessinées en pâle (valeur/transparence = qualité de la position), signalées dans la légende et les infobulles, masquables.
- **Légende** : une seule à la fois ; classes aux bornes arrondies (départements : 6 classes issues des quantiles, bornes arrondies à 1, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × 10ⁿ), vignettes étiquetées. Valeur (clair → foncé) pour les données relatives (densité par département, hexagones de surface égale) ; taille (cercles proportionnels par classes) pour les comptages absolus (lieux).
- **Couleurs** : palette de comestibilité sans opposition rouge/vert (Okabe-Ito) et icônes redondantes dans la fiche.
- Non retenu : cartes de chaleur par noyau (le choix de la largeur de bande peut tromper), remplacées par des cellules comptées.

### Précision spatiale
Le CSV ne donne que le **département**, un **point GPS** (462 678 observations) et un **nom de lieu** libre (`locality`).
`build.py` place en plus les observations sans GPS à partir de (département, lieu) :
1. centre de la **commune** de ce nom dans ce département (liste officielle `data_raw/communes.json`, téléchargée depuis
   [geo.api.gouv.fr](https://geo.api.gouv.fr/communes?fields=nom,code,codeDepartement,centre&format=json&geometry=centre)) : 468 823 observations ;
2. sinon position médiane des autres observations du même lieu : 8 793 observations.

Résultat : **927 007 observations localisées (88,9 %)**, 45 200 positions dont 6 831 approximatives (après masque terrestre, ci-dessous). Les positions
approximatives (centre de commune, pas le lieu exact de la récolte) sont dessinées en pâle et signalées dans l'infobulle.
~9 000 observations (nom de lieu absent ou introuvable) restent au niveau département. Sans `communes.json` (ou avec
`--no-geocode`) seuls les vrais points GPS sont utilisés. Source des communes : Etalab / IGN, licence ouverte.

### Masque terrestre (rien sur la mer ni à l'étranger)
`build.py` teste chaque position distincte contre les polygones des 96 départements (point dans polygone, sans dépendance
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
pas été validée par un mycologue : ne jamais consommer un champignon sur cette base. Éditez le CSV puis relancez `build.py`.

### Photo / texte de la fiche
Branchement prévu : définir `window.FMAP_SPECIES_PROVIDER = (nom) => Promise.resolve({imageUrl, summary})` avant l'application.

Particularités des données réelles, gérées par `build.py` : colonne `department` = **codes** (associés aux
noms via le fond de carte) ; coordonnées `NULL` ou `0,0` (≈ 576 000 enregistrements) traitées comme absentes — seules
462 678 observations ont un point GPS valide ; dates `AAAA-01-01` (≈ 70 000) = « année seule », mois inconnu
(`--keep-jan1` pour les conserver) ; années hors 1700–2021 ignorées ; espèce `NA NA` = non renseignée.

Une sélection de période différente de 1900–2021 exclut les observations sans date.

## Structure

```
index.html            ← livrable (généré)         data.js ← livrable (généré par build.py)
build.py              ← ETL CSV → data.js          assemble_html.py ← assemble index.html
src/                  ← app.js, style.css, index.template.html
build/                ← d3.min.js 7.9.0, fflate.umd.js 0.8.2
data_processed/       ← GeoJSON départements / régions (gregoiredavid/france-geojson)
tools/                ← générateur de CSV synthétique pour les tests
specs/                ← context / requirements / design / tasks
```

Le format binaire (18 octets/enregistrement) est documenté en tête de `build.py` et `src/app.js`.
