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
python3 tools/encode_buddy_frames.py /tmp/sth-buddy-hd/frames /tmp/sth-buddy-hd/ui/frames
python3 tools/encode_buddy_terminal.py /tmp/sth-buddy-hd/frames /tmp/sth-buddy-hd/ui/terminal-frames
python3 tools/check_buddy_assets.py /tmp/sth-buddy-hd --ui /tmp/sth-buddy-hd/ui
```

L'encodeur nécessite `cwebp`. Il convertit chaque pose en WebP qualité 95,
conserve la résolution et l'alpha, puis produit des modules TypeScript de
chaînes base64. Chaque fichier reste sous 1 MiB et le graphe sous 8 MiB.

Après validation, remplacer `assets/frames/` par les poses PNG et
`ui/frames/` et `ui/terminal-frames/` par les modules générés, puis lancer
`/reload-plugins` dans Claude.

Le terminal affiche les mêmes poses avec `Raster`, en demi-blocs colorés
sur 24 colonnes × 12 lignes, via `ui.blit` toutes les 50 ms. Ce rendu fonctionne
aussi dans le terminal intégré de Claude, sans protocole d'image Kitty.
L'encodeur terminal nécessite Pillow et conserve le fond transparent avec les
couleurs par défaut du terminal. Le desktop utilise `ui/buddy.ts`, un module
`Client` avec une seule horloge locale de 50 ms. Il
affiche une seule pose `Svg` par rendu, sous la limite Client de 100 000
caractères. Le panneau transmet seulement l'état et la légende de Buddy.

Variables facultatives : `BUDDY_STATES=error,work`, `BUDDY_SIZE=384`,
`BUDDY_SAMPLES=64`, `BUDDY_PREVIEW=1` (une pose par état),
`BUDDY_DEVICE=METAL` (CPU par défaut), `BUDDY_CWEBP=/chemin/vers/cwebp`.

## Pause Fika V1

La pause sélectionnée reprend l'animation V1 à 30 images par seconde pendant
9 secondes, avec la petite table statique. Sa version sans fond fournit les
270 PNG RGBA dans `previews/fika-3d/transparent/frames/`. Les fichiers opaques
originaux de V1 sont conservés. Cet encodeur ne lance aucun nouveau rendu.

Avec un Python disposant de Pillow et `cwebp` dans le PATH :

```sh
python3 tools/encode_fika_frames.py previews/fika-3d/transparent --check-only
python3 tools/encode_fika_frames.py previews/fika-3d/transparent --ui ui
python3 tools/check_buddy_assets.py assets --ui ui
```

Le manifeste source doit déclarer `transparent: true`. Le contrôle `--check-only`
vérifie les 270 PNG, leur ordre, leurs dimensions et la présence de pixels
visibles et entièrement transparents, sans écrire de modules.

L'encodeur réduit les poses de 720 à 384 px avec Lanczos et un alpha
prémultiplié pour éviter les franges de couleur aux bords. Les poses UI sont
encodées en qualité WebP 75 et qualité alpha 50 pour garder le graphe complet
sous 8 MiB, avec 64 KiB de marge pour le client. Le masque alpha est quantifié :
l'erreur moyenne doit rester inférieure à 5 niveaux sur 255 pour la géométrie
visible et les contours. Les pixels entièrement transparents restent à alpha 0.
Les pertes mesurées sur les 270 poses figurent dans le bilan d'encodage.
Les PNG et les vidéos maîtres conservent leur alpha original.
Chaque module reste sous 1 MiB et chaque rendu Client sous 100 000 caractères.

Les fichiers `ui/frames/fika/index.ts` et `ui/terminal-frames/fika/index.ts`
exportent `FPS`, `DURATION_MS`, `FRAME_COUNT`, `FRAMES` et le tableau par défaut.
L'index terminal exporte également `COLUMNS` et `ROWS`. Les poses sont réparties
en blocs de 12, avec un dernier bloc de 6. Le terminal conserve le format
LEu32 (code Unicode, couleur de premier plan, couleur de fond), en 24 × 12 cellules.

Le bilan d'encodage, le digest des sources V1 et les budgets sont enregistrés
dans `ui/frames/fika/manifest.json`. Le script remplace uniquement les modules
Fika qu'il génère et vérifie les dimensions, la cadence et les limites avant
de les installer.
