# Rendus de Buddy

Le modèle source est `assets/model/buddy-v6.blend`. Les six animations sont
rendues en 384 × 384 px à 20 images par seconde, avec Cycles, 64 échantillons
et un fond transparent. Buddy est affiché en 144 × 144 px sur le desktop.

Depuis la racine du mod :

```sh
BUDDY_OUT=/tmp/sth-buddy-hd /Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup \
  assets/model/buddy-v6.blend \
  --python tools/render_buddy_frames.py
python3 tools/encode_buddy_frames.py /tmp/sth-buddy-hd/frames /tmp/sth-buddy-hd/desktop
python3 tools/encode_buddy_terminal.py /tmp/sth-buddy-hd/frames /tmp/sth-buddy-hd/terminal
python3 tools/check_buddy_assets.py /tmp/sth-buddy-hd --ui ui
```

L'encodeur nécessite `cwebp`. Il convertit chaque pose en WebP qualité 95 et
conserve la résolution et l'alpha. `tools/frame_sheets.py` réunit ensuite les
poses d'un état dans une feuille WebP animée, sans les réencoder : chaque image
de la feuille redonne octet pour octet la pose fixe d'origine. Le code du mod ne
contient aucune image encodée.

Après validation, remplacer `assets/frames/` par les poses PNG, puis
`assets/desktop/` et `assets/terminal/` par les feuilles générées, et lancer
`/reload-plugins` dans Claude.

Le terminal tente d'afficher directement les PNG 384 × 384 dans un composant
`Image`, animé à 20 FPS. Le nom du terminal ne suffit pas à établir sa capacité :
le refus réel d'`Image` ou de `ui.blit` sélectionne le rendu en cellules.
Sous tmux, le mod utilise directement ce rendu. Un refus tardif d'une ancienne
pose ne supprime pas l'animation qui l'a remplacée.

Ce rendu affiche les mêmes poses avec `Raster`, en quadrants colorés BMP,
jusqu'à 48 colonnes × 24 lignes, via `ui.blit` toutes les 100 ms. Les poses
de 96 × 96 pixels sont quantifiées par le codec BP1 (palette de 255 couleurs au
maximum, index transparent), puis stockées sans perte dans une feuille PNG
animée par état, chaque pose dans son propre flux zlib, lignes en filtre 0 et
alpha 0 ou 255. `hooks/frame-sheets.ts` décompresse une seule pose à la fois.
Chaque cellule affiche deux couleurs dans quatre quadrants. `hooks/terminal-raster.ts` adapte les pixels
par moyenne d'aire à la taille du panneau, puis produit les triplets LEu32
attendus par le terminal. Son cache garde huit rendus au maximum.

L'encodeur reprend une pose sur deux des PNG à 20 FPS, ce qui conserve la durée
des animations. Un recadrage carré fixe sur les six états conserve tous les
mouvements sans variation de cadrage ; le gamma de 0,75 préserve mieux les
ombres et le contour du visage que l'ancien gamma de 0,55. Le panneau demande
50 colonnes et adapte son dessin à l'espace réellement accordé : 40 × 20
cellules lorsque sa largeur reste à 42 colonnes. Le rendu fonctionne aussi
dans le terminal intégré de Claude. Il reste un dessin par caractères, dont
la précision dépend du panneau et de la police.

L'encodeur terminal nécessite Pillow et conserve le fond transparent avec les
couleurs par défaut du terminal. Ses dimensions et sa cadence sont exportées
par `hooks/frame-sheets.ts`. Le desktop utilise `ui/buddy.ts`, un module
`Client` avec une seule horloge locale de 50 ms. Il affiche une seule pose `Svg`
par rendu, sous la limite Client de 100 000 caractères. Le panneau transmet
l'état, la légende et le nombre de poses ; le module demande par `ui.message`
la première pose qui lui manque, et le hook lui répond avec un lot de poses
lues dans la feuille WebP de l'état, 90 000 caractères au maximum.

Variables facultatives : `BUDDY_STATES=error,work`, `BUDDY_SIZE=384`,
`BUDDY_SAMPLES=64`, `BUDDY_PREVIEW=1` (une pose par état),
`BUDDY_DEVICE=METAL` (CPU par défaut), `BUDDY_CWEBP=/chemin/vers/cwebp`.

## Pause Fika V1

La pause sélectionnée reprend l'animation V1 à 30 images par seconde pendant
9 secondes, avec la petite table statique. Sa version sans fond fournit les
270 PNG RGBA dans `previews/fika-3d/transparent/frames/` pour la génération.
Leurs copies exactes dans `assets/fika/` sont les PNG livrés pour le rendu
natif ; les dossiers de frames des prévisualisations sont exclus de Git.
Les fichiers opaques originaux de V1 sont conservés. Cet encodeur ne lance
aucun nouveau rendu.

Avec un Python disposant de Pillow et `cwebp` dans le PATH :

```sh
python3 tools/encode_fika_frames.py previews/fika-3d/transparent --check-only
python3 tools/encode_fika_frames.py previews/fika-3d/transparent
python3 tools/encode_fika_frames.py previews/fika-3d/transparent --terminal-only
python3 tools/check_buddy_assets.py assets --ui ui
```

Le manifeste source doit déclarer `transparent: true`. Le contrôle `--check-only`
vérifie les 270 PNG, leur ordre, leurs dimensions et la présence de pixels
visibles et entièrement transparents, sans écrire de feuilles.
`--terminal-only` vérifie les mêmes sources et régénère seulement la feuille
terminal ; aucun WebP desktop n'est réencodé.
L'encodage complet copie aussi les PNG natifs, octet pour octet, dans
`assets/fika/`, pour que l'affichage HD fonctionne après un clone du dépôt.
Les contrôles `--check-only` et `--terminal-only` ne modifient pas ces PNG.

L'encodeur réduit les poses de 720 à 384 px avec Lanczos et un alpha
prémultiplié pour éviter les franges de couleur aux bords. Les poses UI sont
encodées en qualité WebP 75 et qualité alpha 50. Le masque alpha est quantifié :
l'erreur moyenne doit rester inférieure à 5 niveaux sur 255 pour la géométrie
visible et les contours. Les pixels entièrement transparents restent à alpha 0.
Les pertes mesurées sur les 270 poses figurent dans le bilan d'encodage.
Les PNG et les vidéos maîtres conservent leur alpha original.
Chaque rendu Client reste sous 100 000 caractères.

Les feuilles `assets/desktop/fika.webp` (270 poses) et `assets/terminal/fika.png`
(135 poses) suivent les mêmes formats ; `hooks/frame-sheets.ts` exporte la
cadence et les dimensions terminal. Le terminal utilise les mêmes palettes BP1 et
le même décodeur de quadrants, avec des sources de 96 × 96 pixels sans recadrer
la scène Fika.
Le dessin atteint 48 × 24 cellules, avec un gamma de 0,75. Il reprend une pose
sur deux à 15 FPS et conserve les neuf secondes de Fika.
Lorsque le protocole d'image est accepté, les 270 PNG natifs 720 × 720 sont
affichés à 30 FPS. Le desktop conserve également les 270 poses à 30 FPS.

Le bilan d'encodage et le digest des sources V1 sont enregistrés dans
`tools/fika-frames.json`. Le script remplace uniquement les feuilles Fika qu'il
génère et vérifie les dimensions, la cadence et les limites avant de les
installer.

## Audit complet des médias

```sh
python3 tools/audit_buddy_media.py
```

Avec Pillow et `cwebp`, ce contrôle décode chaque PNG source et chaque pose
des feuilles livrées (WebP desktop et raster terminal),
vérifie l'ordre et les digests, reproduit chaque encodage depuis sa source,
puis génère des planches et des animations APNG à partir des données exactes.
Il écrit un nouveau dossier sous `outputs/buddy-audit/` sans modifier les assets.
L'audit des fichiers complète les tests de transitions et la vérification du
rendu dans le terminal réel.
