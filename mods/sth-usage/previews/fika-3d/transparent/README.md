# Buddy · Fika sans fond

Première animation V1, 9 secondes à 30 FPS, conservant Buddy, sa tasse,
son kanelbulle et la petite table fixe. Le World et le sol opaque sont retirés.
Le sol est un shadow catcher Cycles : seules ses ombres restent dans l’alpha.

- `buddy-fika-transparent.webm` : VP9 avec alpha, lisible dans le lecteur Chromium.
- `buddy-fika-transparent.mov` : master ProRes 4444 avec alpha pour le montage.
- `buddy-fika-transparent.blend` : scène éditable avec fond transparent.
- `frames/` : 270 PNG RGBA 720 × 720 générés localement, non versionnés dans Git.
- `index.html` : lecteur avec fonds clair, sombre et damier pour vérifier l’alpha.

Un export MP4/H.264 ne conserve pas ce canal alpha.

Depuis la racine du mod :

```sh
FIKA_RENDER=1 /Applications/Blender.app/Contents/MacOS/Blender --background \
  previews/fika-3d/buddy-fika-review.blend --python tools/render_fika_transparent.py
python3 tools/encode_fika_frames.py previews/fika-3d/transparent --check-only
python3 tools/encode_fika_frames.py previews/fika-3d/transparent --ui ui
ffmpeg -framerate 30 -i previews/fika-3d/transparent/frames/fika-%04d.png \
  -frames:v 270 -c:v libvpx-vp9 -pix_fmt yuva420p -crf 18 -b:v 0 \
  -auto-alt-ref 0 -row-mt 1 -deadline good -cpu-used 2 \
  previews/fika-3d/transparent/buddy-fika-transparent.webm
ffmpeg -framerate 30 -i previews/fika-3d/transparent/frames/fika-%04d.png \
  -frames:v 270 -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le \
  -alpha_bits 16 -qscale:v 4 \
  previews/fika-3d/transparent/buddy-fika-transparent.mov
```

Variables Blender : `FIKA_STILLS=1,86` pour deux poses, `FIKA_SAMPLES=32`
(défaut), `FIKA_DEVICE=CPU` pour désactiver Metal. Les fichiers V1 d’origine
et la variante V2 restent préservés.
