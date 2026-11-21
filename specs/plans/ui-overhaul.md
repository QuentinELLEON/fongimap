# Améliorer l'UI générale de l'application

> Plan d'implémentation détaillé — **rien n'est codé**. Étiquettes : `enhancement`, `accessibility`.
> Contexte transverse : [`specs/architecture.md`](../architecture.md). S'articule avec [`communes-layer.md`](communes-layer.md) (légende, contrôles de carte) et [`french-names.md`](french-names.md) (lignes de la liste d'espèces).

## 1. Demande et méthode

« Améliorer l'UI générale de l'app » est volontairement large. On la traite comme un **chantier mesuré** : un audit chiffré (§2), des principes (§3), des chantiers indépendants et livrables séparément (§5), une validation avec les cartographes avant les gros changements de mise en page (§7).

> Règle de conduite : pas de refonte « big bang ». Chaque chantier est une PR qui laisse l'application utilisable et mesurable.

## 2. Audit de l'existant (constats vérifiables)

### Accessibilité
| Constat | Preuve |
|---|---|
| Texte secondaire sous le seuil WCAG AA (4,5:1) | `--fg3 #8a7d66` sur `--bg #f7f4ee` = **3,67:1** ; sur `--bg2` = **3,38:1** (ratios calculés ce jour avec la formule WCAG 2.x). Utilisé pour compteurs, légendes d'axes, notes. |
| Pastilles de comestibilité à texte blanc illisible | blanc sur `#56B4E9` (« À cuire ») = **2,31:1** ; sur `#E69F00` (« Toxique ») = **2,25:1** ; sur `#009E73` = 3,42 ; sur `#9a9484` = 3,02. Le bouton ambre `--accent3` portant du texte blanc : 3,38. |
| Puces de filtre **non focalisables** | `buildChips` crée des `<span>` avec un `click` (`app.js:1067`) ; la grille des mois est faite de `<div>` (`app.js:1099`) → inaccessibles au clavier et aux lecteurs d'écran. |
| Liste des départements | `<select multiple>` détourné par un `mousedown` + `preventDefault` (`app.js:1111`) : comportement clavier non standard. |
| Carte non pilotable au clavier | `d3.zoom` ne gère ni flèches ni +/−. |
| Aperçu au **survol** uniquement | `mouseenter` sur les lignes (`app.js:1277`), infobulles de carte au `mousemove` : rien pour le tactile. |
| Petits corps de texte | 4 règles CSS ≤ 10 px, étiquettes de mini-histogramme 8,5 px (`miniBars`), base 13 px. |
| Pas de région live | le nombre d'espèces/observations change sans annonce (`aria-live`). |

### Mise en page / responsive
- `body { min-width: 1100px; min-height: 640px }` (`style.css:31`) ; **aucun** `@media` hormis `prefers-reduced-motion`. Téléphone/tablette inutilisables (hors périmètre v1 : requirements §3 ; à réviser — les cartographes montrent la carte en réunion et sur tablette).
- En-tête surchargé à 1100 px : titre + sous-titre, ligne de chiffres, segment comestibilité, Réinitialiser, aide.
- Fiche espèce : 170 px d'illustration de remplacement (« Photo à venir ») qui ne dit rien et repousse le contenu ; HTML construit par concaténation de chaînes avec styles en ligne (`openSpecies`, `app.js:1451`) : difficile à thématiser.

### Cohérence visuelle
- **Trois rampes** différentes selon le niveau (YlGn départements, YlOrBr hexagones, ambre pour les lieux) + quatre teintes de comestibilité : la légende change de langage à chaque zoom.
- Icônes = **émojis et glyphes** (🍄 🍽 ☠ ⚙ ✔ ♨ ⚠) : rendu variable selon l'OS/la police, impossible à teinter proprement, bruit pour lecteurs d'écran.
- Libellés FUNGuild en anglais dans une interface française (cf. `french-names.md`).
- Filtres actifs dispersés en quatre endroits (segment du bandeau, puce espèce, puce commune, badge de l'onglet Filtres).

### Partage / travail des cartographes
- Aucun **état dans l'URL** : on ne peut pas envoyer « cette vue » à un collègue ni la citer.
- Aucun **export** (image de la carte avec légende et sources, liste d'espèces CSV). Requirements v1 le déclarait hors périmètre ; le retour terrain dit le contraire.
- Pas d'impression.

## 3. Principes

1. **Lisible avant joli** : contrastes AA, corps ≥ 12 px, cibles ≥ 24×24 px (WCAG 2.2, critère 2.5.8), 44 px sur tactile.
2. **Le clavier d'abord** : tout ce qui se clique se focalise (vrais `<button>`, `role`, ordre de tabulation logique).
3. **Une carte, un langage visuel** : mêmes teintes de base à tous les niveaux, légende unique, hiérarchie de traits cartographique (région > département > commune).
4. **Divulgation progressive** (déjà un principe du projet, `context.md` §7.5) : ne pas rajouter de contrôles visibles ; déplacer vers « Options ».
5. **Fonctionne hors ligne et en `file://`** : aucune police/icône/CDN distant ; tout inline.
6. **Mesurable** : chaque chantier a un critère objectif (axe-core, ratio, capture, tâche).

## 4. Système de design (fondation, chantier T1)

### Jetons (`:root`, `src/style.css` scindé en `tokens.css`, `base.css`, composants)
- Rôles de couleur nommés par **usage**, pas par teinte : `--surface`, `--surface-2`, `--text`, `--text-muted` (≥ 4,5:1 sur toutes les surfaces), `--border`, `--accent`, `--focus`, `--danger`, `--data-1..7` (rampe séquentielle), `--edi-1..5`.
- `--text-muted` : viser ≈ `#6b5f4b` (à vérifier par calcul) au lieu de `#8a7d66`.
- Pastilles de comestibilité : **fond clair + bordure + icône + texte sombre** (contraste ≥ 4,5:1) plutôt que fond saturé + texte blanc ; l'information ne repose pas sur la seule couleur (icône SVG + libellé), conformément au choix Okabe-Ito déjà fait.
- Échelle typographique : 12 / 13 / 15 / 18 / 24 ; interligne 1,4 ; police système conservée (hors ligne).
- Espacement 4 px ; rayons 6/10 px ; 3 niveaux d'élévation.
- **Thème sombre** (`prefers-color-scheme` + bascule manuelle) : *optionnel*, après T1–T6, car la carte exige des rampes validées en sombre.

### Icônes
Sprite SVG inline (≈ 20 symboles : recherche, filtre, couches, aide, fermer, réinitialiser, lien, image, comestible, cuire, non comestible, toxique, mortel, localisation, +, −, vue entière…), `fill="currentColor"`, `aria-hidden` + libellé texte. Supprimer tous les émojis de l'interface (le logo 🍄 peut devenir un SVG de marque).

## 5. Chantiers (chacun livrable seul)

### T2 — Accessibilité « gains rapides » (premier à livrer, faible risque)
- `chip`/`month-btn` → `<button type="button" aria-pressed>` ; groupes en `role="group"` + `aria-label`.
- Liste des départements → `<fieldset>` de cases à cocher filtrables, **ou** conserver `<select multiple>` natif sans détournement ; décider après test avec lecteur d'écran (NVDA/VoiceOver).
- Contrastes corrigés (jetons T1) ; anneau de focus visible `:focus-visible` (déjà partiellement : `style.css` ligne `button:focus-visible`), étendu aux lignes de liste.
- `aria-live="polite"` sur le compte d'espèces/observations (débounce ~500 ms pour ne pas bavarder pendant l'animation).
- Navigation clavier de la carte : flèches = pan, `+`/`−` = zoom, `0` = vue entière, `Entrée` sur le lieu/commune actif ; focus visible sur la carte (`tabindex="0"`, `role="application"` avec description).
- Alternative non visuelle à la carte : le tableau « Départements les plus riches » existe dans la fiche ; ajouter une vue **tableau** (liste triable des départements/communes visibles) accessible depuis Options → aussi utile aux cartographes.
- Cible : `axe-core` (Playwright) **0 violation serious/critical** ; Lighthouse accessibilité ≥ 95 (mesuré sur serveur local, la page `file://` n'est pas auditable par Lighthouse).

### T3 — Mise en page responsive
Trois gabarits :
| Largeur | Gabarit |
|---|---|
| ≥ 1100 px | actuel, panneau latéral fixe 296–320 px |
| 700–1099 px | panneau latéral **repliable** en tiroir au-dessus de la carte (bouton « Champignons / Filtres ») ; fiche espèce en tiroir plein hauteur |
| < 700 px | carte plein écran + **bottom sheet** à 3 crans (poignée / mi-hauteur / plein) hébergeant onglets Champignons / Filtres ; barre d'actions compacte ; légende repliée par défaut |
Supprimer `min-width`/`min-height` du `body`. Tactile : tap = infobulle fixe (pas de survol), **aperçu d'espèce au survol remplacé par appui long ou bouton « Aperçu »** sur tactile ; pincer pour zoomer (d3-zoom le fait déjà).

### T4 — Barre « Filtres actifs »
Une barre horizontale sous l'en-tête (au-dessus de la carte) listant **tous** les filtres actifs sous forme de puces retirables : espèce(s), commune, département(s), période, mois, comestibilité, guildes… + « Tout réinitialiser ». Remplace les quatre emplacements actuels ; le badge de l'onglet Filtres reste. Le segment « Tous / Comestibles / Toxiques » reste dans l'en-tête (usage fréquent) mais devient une puce quand actif.

### T5 — Carte : contrôles, légende, hiérarchie
- Contrôles regroupés dans **quatre coins fixes** : haut-gauche = recherche de lieu/commune (cf. `communes-layer.md`), haut-droite = zoom + vue entière + options, bas-gauche = légende (repliable), bas-droite = échelle + mini-carte de situation.
- Légende : un seul « composant légende » paramétré par niveau (département / hexagone / commune / lieu), mêmes teintes de base, bornes lisibles, rappel d'unité, **note de biais d'effort** déplaçable en infobulle « i ».
- Hiérarchie de traits partagée avec la couche communes (régions 1,8 px, départements 1,1 px, communes 0,4 px, côte 0,8 px).
- Palette : unifier YlGn pour la quantité surfacique à tous les niveaux ; **l'ambre** reste réservé aux lieux ponctuels (valeur absolue, taille) ; justifier dans la légende (`context.md` §7.4 : valeur = relatif, taille = absolu).

### T6 — Liste d'espèces et fiche
- Ligne : nom français + latin (cf. `french-names.md`), pastille de comestibilité à icône SVG, compteur, **rien d'autre** (pas de nouvelles colonnes).
- Fiche : retirer le grand placeholder tant qu'aucune image n'existe → bandeau compact avec pastille de comestibilité et noms ; la photo apparaît seulement si `FMAP_SPECIES_PROVIDER` en fournit une. Remplacer l'HTML en chaîne par un **gabarit** (`<template>`) + classes CSS (plus de styles en ligne), aucun changement de contenu.
- Avertissement de comestibilité : texte conservé tel quel, lisible (≥ 12 px, contraste AA), visible sans défilement sur la fiche.

### T7 — État dans l'URL (lien partageable)
`location.hash` = état sérialisé lisible : `#sp=boletus-edulis&m=9,10&d=25&y=2000-2021&v=3.2/46.8/4.1&n=commune&e=1`. Lecture au boot, écriture avec `history.replaceState` débounce 300 ms. Valeurs inconnues ignorées (jamais d'erreur). Fonctionne sur `file://` (le hash n'est pas envoyé au serveur ; aucune donnée personnelle). Bouton « Copier le lien ».
Contrainte : les indices d'espèces ne doivent **pas** figurer dans le lien (instables d'un build à l'autre) → identifiants stables (binôme latin ou `cd_ref`).

### T8 — Export
- **PNG** de la vue : composer `map-svg` (sérialisé) + canvases + légende + échelle + attribution (« FongiBase, Gautier et al. 2022 — CC-BY 4.0 », mention comestibilité si pertinente) sur un `canvas` hors-écran, à 2× ; télécharger via `<a download>` / `canvas.toBlob` (aucune requête réseau).
- **CSV** de la liste d'espèces courante (nom FR, latin, famille, nombre d'observations, comestibilité indicative).
- Impression : feuille de style `@media print` (carte + légende + sources, sans panneau).
- L'export exige une **attribution automatique** : jamais d'export sans la ligne de licence.

### T9 — Internationalisation minimale
Extraire les chaînes en `i18n/fr.json` + `en.json`, fonction `t(key, vars)`, bascule dans l'en-tête. Parité fr/en pour l'interface ; données (noms) selon `french-names.md`. Pourquoi : audience de cartographes, partage international possible, et surtout **toute chaîne en dur est un obstacle à l'évolution** (aujourd'hui des centaines de littéraux français dans `app.js` et le gabarit HTML).

### T10 — Écrans d'état
Chargement : barre de progression déjà présente ; ajouter l'estimation « environ N s » seulement si mesurable. Erreurs : message actionnable (« data.js introuvable : placez-le à côté de index.html ») déjà amorcé (`showError`). Vide : « Aucune espèce avec ces filtres » existe ; ajouter l'action « Retirer le dernier filtre ». Aide (« À quoi sert FongiMap ? ») : raccourcir (4 questions → 3), garder la mémoire `localStorage`.

### T11 — Thème sombre (optionnel) et contraste élevé
Jetons redéfinis sous `prefers-color-scheme: dark` et `[data-theme]` ; rampes de carte revalidées sur fond sombre ; `forced-colors` respecté.

## 6. Ordre recommandé et dépendances

`T1 jetons` → `T2 accessibilité` (indépendant de la carte, à livrer en premier) → `T6 liste/fiche` (après `french-names`) → `T5 carte` (en même temps que `communes-layer`) → `T3 responsive` → `T4 barre de filtres` → `T7 URL` → `T8 export` → `T9 i18n` → `T10`, `T11`.
Pas de dépendance à la refonte d'architecture, **mais** T9 et T6 gagnent à passer par `displayName`/`t()` isolés, ce que prévoit la refonte.

## 7. Validation avec les cartographes (avant T3/T4/T5)

1. 2–3 maquettes HTML statiques (pas d'outil externe) de l'écran principal à 1280 px et 390 px ; recueil de retours en une réunion.
2. **Test d'utilisabilité** avec 5 personnes, tâches chronométrées : (a) trouver où observer un cèpe en octobre dans le Jura, (b) restreindre à une commune, (c) exporter la vue, (d) partager le lien, (e) lire la légende et dire ce que veut dire la couleur.
3. Indicateurs de succès : réussite ≥ 90 % par tâche, score **SUS ≥ 80**, 0 erreur bloquante sur (e).

## 8. Tests automatiques

- Playwright : captures de référence à 1280×760, 820×1180, 390×844 ; comparaison d'images avec tolérance (régression visuelle) ; **jamais** de comparaison sur la carte animée sans figer (`prefers-reduced-motion` + attente `perf.total`).
- `axe-core` sur : accueil, onglet Filtres, fiche ouverte, aide ouverte.
- Contrôle de contraste automatisé des jetons (script `tools/check_contrast.py`) qui échoue sous 4,5:1 (texte) / 3:1 (composants).
- Test clavier scripté : Tab parcourt tous les contrôles ; Échap ferme fiche/aide/options ; focus rendu à l'élément déclencheur.

## 9. Critères d'acceptation globaux

0 violation axe serious/critical ; tous les textes ≥ AA ; carte utilisable à 390 px ; état partageable par URL ; export PNG avec légende et attribution ; aucune dépendance réseau ajoutée ; temps de boot et de filtre inchangés (±10 %) ; aucune régression des valeurs d'ancrage (`communes-layer.md` §8).

## 10. Risques

| Risque | Parade |
|---|---|
| Dérive de périmètre (« améliorer » est ouvert) | chantiers T1–T11 fermés ; tout ajout = nouvelle issue |
| Conflits avec les couches de carte | T5 coordonné avec `communes-layer` ; une seule personne sur `drawLayers` |
| Régressions visuelles invisibles | captures de référence + revue |
| Bottom-sheet tactile buggé | prototype isolé avant intégration |
| Coût i18n | commencer par extraire, traduire ensuite |

## 11. Questions ouvertes

1. Les tablettes/téléphones sont-ils réellement visés (réunions, terrain) ?
2. Thème sombre : utile ou luxe ?
3. L'export PNG doit-il suivre une charte (titre, auteur, date) ?
4. Anglais nécessaire maintenant ?
5. Faut-il une identité visuelle (logo) plutôt qu'un émoji ?

## 12. Estimation grossière
T1 1 j · T2 2 j · T3 3 j · T4 1 j · T5 2–3 j · T6 1,5 j · T7 1 j · T8 2 j · T9 2 j · T10 0,5 j · T11 1–2 j · tests/captures 2 j ⇒ **≈ 19–22 jours** si tout est livré ; **T1+T2+T6** (≈ 4,5 j) suffisent pour un premier gain net.
