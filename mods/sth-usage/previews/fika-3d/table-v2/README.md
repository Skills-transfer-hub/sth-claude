# Buddy · Fika avec table pliante

Rendu de validation, sans intégration au mod.

Animation de 15,5 secondes à 30 FPS : Buddy sort une table pliante de derrière
lui, déplie les deux pieds graphite, pose son café et son kanelbulle, boit,
croque la brioche, puis range les accessoires et replie/range la table.
La dernière pose retrouve la première.

- `buddy-fika-review.mp4` : vidéo complète.
- `buddy-fika-review.blend` : scène Blender editable et animation.
- `index.html` : lecteur avec raccourcis vers chaque geste.
- `manifest.json` : durée, cadence et étapes.

Source : Buddy V6, sans remplacement de sa géométrie ou de son visage `^.^`.
Les mains d'origine sont animées, avec des raccords de bras graphite. La table
est en chêne avec deux cadres articulés, charnières et pieds en caoutchouc.

Recréer depuis la racine du mod :

```sh
FIKA_ENGINE=BLENDER_EEVEE FIKA_SIZE=720 FIKA_RENDER=1 \
  /Applications/Blender.app/Contents/MacOS/Blender --background \
  assets/model/buddy-v6.blend \
  --python tools/build_fika_preview.py
ffmpeg -framerate 30 -i previews/fika-3d/table-v2/frames/fika-%04d.png \
  -frames:v 465 -c:v libx264 -crf 16 -pix_fmt yuv420p -movflags +faststart \
  previews/fika-3d/table-v2/buddy-fika-review.mp4
```
