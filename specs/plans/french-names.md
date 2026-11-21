# Noms français des champignons, avec recherche bilingue (français + latin)

> Plan d'implémentation détaillé — **rien n'est codé**. Étiquettes : `enhancement`, `data`.
> Contexte transverse : [`specs/architecture.md`](../architecture.md).

## 1. Demande

> « Rajouter les noms français des champignons et non que latin, pouvoir rechercher par les deux. »

## 2. État actuel (vérifié)

- Le navigateur d'espèces cherche **uniquement** dans le nom latin et la famille : `matchesQuery` (`src/app.js:1232`) teste `speciesLower[s]` et `familyLower[…]`.
- Pourtant le champ propose le placeholder « Chercher : **cèpe**, Amanita, famille… » (`src/index.template.html:45`) et le panneau d'aide des « cèpes », « morilles » : **« cèpe » ne renvoie aujourd'hui rien**. À corriger comme un défaut, pas seulement comme une fonctionnalité.
- Le nom d'espèce s'affiche via `DICT.species[…]` à **8 endroits** de `app.js` (lignes 979 `listHtml`, 1190 `pickSpecies`, 1203 tri alphabétique, 1243 lignes de liste, 1313 étiquette d'aperçu, 1350 `genusIdx`, 1384 `applyStarter`, 1424 fiche) + le libellé de la puce de filtre (`state.speciesLabel`). Il n'y a **pas** de fonction unique « nom à afficher ».
- Des noms français existent déjà, **enfouis** dans les notes de `data_processed/edibility.csv` (« Amanite phalloïde : responsable… ») — environ 190 espèces, utilisables comme **graine et jeu de test**, pas comme source de vérité.
- Les libellés de guilde et de mode trophique sont affichés **en anglais brut** (FUNGuild : « Ectomycorrhizal », « Saprotroph »…) dans une interface française (`makeGroups`, `app.js:1047`). Même famille de problème : à traiter dans ce ticket (petit tableau de traduction).
- Le CSV contient `cd_ref` (code TAXREF) pour **94,9 %** des enregistrements ; `build.py` ne le lit pas aujourd'hui (`WANTED`, `build.py:95`).

### Chiffres mesurés ce jour sur le CSV réel (1 043 262 lignes)
| Mesure | Valeur |
|---|---|
| Espèces distinctes (`genus_species_ref`) | 11 619 |
| Couples (espèce, `cd_ref`) distincts | 12 756 |
| Espèces ayant **plusieurs** `cd_ref` | 707 |
| Part des observations couverte par les **100** espèces les plus observées | 32,8 % |
| … par les **500** premières | 65,9 % |
| … par les **2 000** premières | 91,0 % |
| `cd_ref` manquant | 5,09 % des lignes |

Conséquence de pilotage : **cibler 100 % des 500 premières espèces et ≥ 95 % des 2 000 premières** couvre l'essentiel de l'usage ; la longue traîne (61 % des taxons ont < 10 observations d'après l'article) peut rester en latin seul sans que ce soit un défaut.

## 3. Sources des noms vernaculaires (ordre de priorité)

| # | Source | Rôle | Remarques |
|---|---|---|---|
| 1 | **Surcharges manuelles** `data_processed/vernacular_fr.csv` (colonne `status=validated`) | gagne toujours | relecture par mycologues (SMF ou société locale) |
| 2 | **TAXREF (INPN / MNHN)** noms vernaculaires | source de référence | publié sous licence ouverte d'après data.gouv.fr ; la **structure exacte du fichier vernaculaire (noms de colonnes) n'a pas pu être confirmée** par la recherche : lire la doc de la version courante (`taxref@mnhn.fr` en dernier recours). Le référentiel s'appuie sur des groupes d'experts dont la Société Mycologique de France. |
| 3 | **Wikidata** propriété P1843 (`taxon common name`, monolingue, filtre `@fr`) | complément | Wikidata est en général sous CC0 (**à confirmer** sur les conditions d'utilisation) ; requête SPARQL ciblée Fungi |
| 4 | GBIF `vernacularNames` (backbone) | repli | licences variables selon le jeu source : consigner la provenance par ligne |
| 5 | Notes d'`edibility.csv` | graine initiale | à extraire une fois, puis dédupliquer avec 1–2 |

Statuts par ligne : `validated` (humain), `source` (importé, non revu), `proposed` (extrait de notes). L'interface **n'affiche** que `validated` + `source`, jamais `proposed`.

### Jointure
`cd_ref` du CSV → TAXREF. Les noms vernaculaires TAXREF sont rattachés à un `cd_nom` qui peut être un **synonyme** : joindre via la table principale `cd_nom → cd_ref`, sinon on perd des noms. Pour les 707 espèces à plusieurs `cd_ref` : retenir le `cd_ref` de **rang espèce** (sinon le plus fréquent) et agréger les noms des sous-taxons uniquement si l'espèce n'en a aucun.
Repli sans `cd_ref` : jointure par nom latin normalisé.

## 4. Pipeline de données

1. **`tools/prepare_vernacular.py`** (exécuté à la main, sortie **committée**, comme les GeoJSON) — téléchargement soumis à approbation, URL + date + SHA-256 + millésime TAXREF notés dans `data_processed/SOURCES.md`. Filtre : règne Fungi. Produit `data_processed/vernacular_fr.csv` :
   `species,cd_ref,name_fr,is_primary,source,status,note`
2. **Règle de nom principal** par espèce : `validated` + `is_primary` > TAXREF premier nom > Wikidata > GBIF ; les autres noms deviennent **alias** (cherchables, non affichés en titre).
3. **`build.py`** : lit `vernacular_fr.csv`, aligne sur `dicts.species`, écrit `META.vernacular = { names: [...], idx: [...] }` (tableaux parallèles, **sparse** : seules les espèces avec nom). Un nom principal + alias séparés par `|`. Estimation : 2 000–6 000 espèces × ~40 o ≈ 0,1–0,25 Mo (à mesurer).
4. **Rapport de couverture imprimé par le build** : % d'observations avec nom français ; couverture top 100/500/2 000 ; **liste CSV des 500 premières espèces sans nom** (`build_reports/missing_fr_top500.csv`) à faire compléter par les mycologues (feuille de relecture exportable).
5. Ne pas dupliquer dans les notes de comestibilité : `edibility.csv` garde la prose ; le nom vient de `vernacular_fr.csv`.

## 5. Recherche (cœur technique)

### Normalisation commune (latin, français, alias, requêtes)
Fonction pure `searchKey(s)` :
1. minuscule ; 2. NFD + suppression des diacritiques (é→e, ç→c) ; 3. **ligatures** `œ→oe`, `æ→ae` (« cœur », « bœuf » : le NFD ne les décompose pas) ; 4. apostrophes `’ʼ'` et tirets `-–—` → espace ; 5. tout non alphanumérique → espace, espaces compactés. 
**Différent de `normName` actuel** (`app.js:204`) qui *supprime* les non-alphanumériques et colle les mots (« pied de mouton » → « piedemouton ») : correct pour apparier des noms de départements, faux pour de la recherche multi-mots. Ne pas réutiliser.

### Algorithme
- Requête → mots ; pluriel naïf : retire un `s`/`x` final des mots de ≥ 4 lettres (« cèpes » → « cepe », « morilles » → « morille ») ; le **dernier mot** est traité en préfixe (saisie au fil de l'eau : « amanite phal »), les autres en mot entier **ou** préfixe de mot.
- Correspondance **ET** entre mots, dans **un** nom (latin ou un alias français) — pas à cheval sur deux noms.
- Champs cherchés : nom latin, nom français principal, alias, famille (comportement actuel conservé). Le genre latin est déjà trouvé par préfixe.
- **Classement** (puis nombre d'observations décroissant en départage) : 1 égalité exacte d'un nom, 2 préfixe du nom entier, 3 préfixe d'un mot, 4 sous-chaîne. Meilleur score sur les noms de l'espèce.
- Index construit **une fois** au chargement : tableau de chaînes précalculées `keys[s] = [latin, fr, alias…].map(searchKey)` — 11 618 espèces, quelques ms. Pas de dépendance (pas de Fuse/Lunr : pas de CDN, et inutile à cette taille).
- Anciens noms/synonymes latins (ex. `Boletus` → `Imleria`) : **hors périmètre**, ticket futur (TAXREF fournit les synonymes).
- **Indication de correspondance** : si le résultat ne ressort que par un alias, afficher « aussi appelé : Cèpe » sous le nom ; si par le latin alors que le français existe, rien de plus.

### Ce que « cèpe » doit donner (jeux de tests)
Avec les noms TAXREF/SMF effectifs (à vérifier au build) : `cepe` → *Boletus edulis* et les autres cèpes (aereus, pinophilus, reticulatus) ; `girolle` → *Cantharellus cibarius* ; `pied de mouton` → *Hydnum repandum* (et espèces proches selon les noms) ; `trompette de la mort` ; `amanite phalloide` (sans accent) → *Amanita phalloides* ; `Amanita phall` ; `coeur` / `cœur` identiques ; `Cantharellus` ; `bolétacées`/`boletaceae` (famille) ; mot isolé de genre (« amanite ») renvoie **toutes** les amanites (le 1er mot du nom français joue le rôle de nom de genre sans table spéciale).
Mettre ces cas dans `tests/search.spec.js` (Node, sans navigateur) alimenté par un mini-jeu de données figé.

## 6. Affichage

Convention des guides de terrain : **nom français en titre, binôme latin en italique en dessous**.

| Endroit | Aujourd'hui | Cible |
|---|---|---|
| Ligne de liste | latin en italique + famille | **Nom français** (gras) ; sous-ligne `Latin en italique · Famille` ; sans nom français : latin seul comme aujourd'hui |
| Puce de filtre, étiquette « Aperçu », « Voir les N espèces » | latin | nom d'affichage |
| Fiche espèce (`openSpecies`) | titre latin | titre = nom FR, sous-titre latin italique, **aussi appelé** : alias |
| Infobulles (`listHtml`, top espèces) | latin | nom d'affichage (latin au survol via `title`) |
| Départs rapides (`STARTERS`) | latin en dur | utiliser les noms FR |
| Lien Wikipédia de la fiche | `fr.wikipedia.org/wiki/<latin>` | inchangé (redirige) ; ajouter lien INPN/TAXREF si `cd_ref` connu |

Bascule persistante **« Afficher d'abord : nom français / nom latin »** (défaut : français), mémorisée dans `localStorage` **entre try/catch** (comme `store` existant). Tri « A→Z » = par **nom d'affichage** (rang alphabétique recalculé avec `localeCompare('fr')` sur la clé choisie ; deux tableaux de rangs précalculés, pas de tri à chaque frappe).

**Une seule fonction** `displayName(idx)` / `latinName(idx)` / `aliases(idx)` ; interdire par revue/lint tout nouvel accès `DICT.species[...]` pour affichage (grep en CI). Cela prépare aussi l'internationalisation et le multi-jeux de données (voir `dynamic-dataset.md` : table de taxons canonique).

### Libellés guildes / modes trophiques (inclus ici)
Tableau `GUILD_FR`, `TROPHIC_FR` (≈ 31 + 7 valeurs) dans un fichier de traduction ; valeurs non traduites affichées telles quelles + `console.warn` listé au build. Les clés restent les valeurs sources.

## 7. Cas limites

- Un même nom français pour plusieurs espèces (« chanterelle », « bolet ») : normal, la liste montre toutes les espèces ; aucune déduplication.
- Plusieurs noms pour une espèce : un principal, le reste en alias.
- Nom français = mot latin ou nom propre (« Morille ») : OK, la normalisation est indépendante de la casse.
- Espèces sans `cd_ref` (5 %) : jointure par nom, sinon latin seul.
- Droits : Wikidata/GBIF/TAXREF exigent une attribution à jour dans le pied de page et `README.md` ; noter la licence **ligne par ligne** si GBIF est utilisé.
- **Sécurité sanitaire** : un nom populaire erroné est plus dangereux qu'une absence (confusion comestible/toxique). Pas d'import de noms *non revus* pour les espèces mortelles/toxiques de la table de comestibilité : celles-ci doivent être `validated`.
- Les noms vernaculaires sont **régionaux** : prévoir (colonne `region`, vide pour l'instant) sans l'exploiter.

## 8. Performance

Index de recherche : ~10–20 ms au boot (une passe sur 11 618 espèces). Frappe : filtrage sur 11 618 clés précalculées, ≪ 5 ms (le debounce de 150 ms existant reste). Taille de `data.js` : +0,1–0,25 Mo. Aucun impact sur la passe `applyFilters` (les noms ne touchent pas aux enregistrements).

## 9. Critères d'acceptation

- Taper `cepe`, `cèpe`, `CEPES`, `cèpe de bordeaux` trouve *Boletus edulis* en premier ou parmi les premiers.
- La recherche latine actuelle donne **exactement** les mêmes résultats qu'avant pour les requêtes sans correspondance française (test de non-régression sur 50 requêtes).
- Le placeholder du champ est vrai.
- Couverture affichée par le build ; top 500 sans nom ≤ 5 % (cible 0 % après relecture) ; top 2 000 ≥ 95 %.
- Aucune occurrence de `DICT.species[` dans du code d'affichage hors `displayName`.
- Bascule FR/latin persistante ; tri A→Z cohérent avec la bascule.
- Guildes/modes trophiques en français.
- Accessibilité : la ligne conserve un `aria-label` « Nom français, nom latin, N observations, comestibilité ».

## 10. Découpage

1. `tools/prepare_vernacular.py` + `vernacular_fr.csv` initial (graine des notes d'`edibility.csv` + TAXREF) + `SOURCES.md`.
2. `build.py` : lecture `cd_ref`, jointure, `META.vernacular`, rapport de couverture et liste des manquants.
3. `searchKey` + index + classement + tests Node.
4. `displayName` partout + bascule + tri + fiche + infobulles + starters.
5. Traduction guildes/trophique.
6. Relecture mycologues (boucle sur `missing_fr_top500.csv`) — **tâche humaine**, à planifier tôt car c'est elle qui gouverne le calendrier.

## 11. Questions ouvertes

1. Qui relit ? (SMF, association locale, les cartographes eux-mêmes ?) Le délai de relecture dépasse le temps de développement.
2. Autorise-t-on le téléchargement de TAXREF (taille à vérifier) et l'interrogation de Wikidata/GBIF pendant la préparation ?
3. Noms régionaux : un seul nom « national » suffit-il ?
4. Faut-il aussi chercher les **synonymes latins** (anciens noms) ?
5. Afficher le nom français par défaut est-il le bon choix pour le public cible, ou latin d'abord pour les naturalistes ?

## 12. Estimation grossière
Préparation données 1–1,5 j · build 0,5–1 j · recherche + tests 1–1,5 j · affichage 1 j · traductions 0,5 j ⇒ **≈ 4–5 j de développement**, plus la relecture humaine (hors estimation).
