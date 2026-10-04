# Buddy · Fika, version retenue

La première version de 9 secondes est intégrée au mod. Buddy prend sa tasse,
boit du café puis croque un kanelbulle. La petite table reste en place.
La version sans fond, avec ombres de contact, est dans `transparent/`.
Le rendu Blender original avec son fond studio est conservé dans ce dossier.

Source : `assets/model/buddy-v6.blend`. Géométrie et visage V6 conservés.
Accessoires : tasse creuse, café, vapeur, kanelbulle avec sucre perlé et version
mordue, raccords de bras graphite et trois petites miettes après la morsure.

- `buddy-fika-review.mp4` : rendu original, 720 × 720 px à 30 FPS.
- `buddy-fika-review.blend` : scène V1 éditable et timeline de 270 poses.
- `frames/` : les 270 poses originales locales, non versionnées dans Git.
- `index.html` : lecteur avec raccourcis vers les gestes.
- `manifest.json` : version retenue et temps des gestes.
- `table-v2/` : variante de validation avec sortie/rangement, non intégrée.
- `transparent/` : même animation V1, PNG RGBA et vidéos WebM/MOV avec alpha.

Les séquences PNG de prévisualisation sont générées localement et ignorées par
Git. Le clone contient les scènes Blender, les vidéos et les poses déjà
encodées du mod ; voir `transparent/README.md` pour régénérer les 270 PNG RGBA.

Le mod affiche une seule animation à la place de Buddy : WebP 384 × 384 sur
desktop, `Raster` 24 × 12 en terminal. La lecture dure 9 secondes à 30 FPS,
puis Buddy reprend son état normal. Écrire un premier prompt arrête la fika
et masque définitivement sa bulle pour cette session.

Réencoder les poses depuis la racine du mod (Pillow et `cwebp` requis) :

```sh
python3 tools/encode_fika_frames.py previews/fika-3d/transparent --ui ui
```

Pour tester rapidement, lancer une session sans prompt avec
`STH_FIKA_PREVIEW=1 claude --plugin-dir .`, ouvrir `/sth-usage` et sélectionner
« Fika ? » après deux secondes. Dans le terminal intégré, utiliser Tab puis
Entrée. Le délai normal reste de deux minutes et la bulle est réservée au
panneau Buddy · Consommation.

Le script `tools/build_fika_preview.py` produit la variante V2 ; pour modifier
la version retenue, ouvrir son fichier `.blend` ci-dessus.
