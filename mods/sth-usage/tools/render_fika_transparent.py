"""Render the retained Fika V1 scene with a transparent world and contact shadows.

Load previews/fika-3d/buddy-fika-review.blend before running this script.
FIKA_STILLS=1,86 renders selected poses; FIKA_RENDER=1 renders all 270.
"""

import json
import os
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "previews/fika-3d/transparent"
SOURCE = ROOT / "previews/fika-3d/buddy-fika-review.blend"
if Path(bpy.data.filepath).resolve() != SOURCE:
    raise ValueError("Load the retained nine-second V1 .blend, not the table variant")

scene = bpy.context.scene
if (scene.frame_start, scene.frame_end, scene.render.fps) != (1, 270, 30):
    raise ValueError("Expected the retained V1 timeline: 270 poses at 30 FPS")

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "frames").mkdir(exist_ok=True)

scene.render.engine = "CYCLES"
scene.cycles.samples = int(os.environ.get("FIKA_SAMPLES", "32"))
scene.cycles.use_denoising = True
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.035
scene.cycles.device = "CPU"
if os.environ.get("FIKA_DEVICE", "METAL") == "METAL":
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = device.type == "METAL"
    if any(device.use for device in preferences.devices):
        scene.cycles.device = "GPU"

# A shadow catcher contributes only contact shadows, never an opaque floor.
floor = bpy.data.objects["Studio floor"]
floor.hide_render = False
floor.is_shadow_catcher = True
scene.render.film_transparent = True
scene.render.use_persistent_data = True
scene.render.resolution_x = 720
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.compression = 15
scene.render.filepath = str(OUT / "frames/fika-")
scene.frame_set(1)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "buddy-fika-transparent.blend"))

manifest = json.loads((SOURCE.parent / "manifest.json").read_text())
manifest.update({"scene_source": str(SOURCE), "transparent": True,
                 "shadow_catcher": True, "renderer": "CYCLES",
                 "samples": scene.cycles.samples, "integrated": False})
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

stills = os.environ.get("FIKA_STILLS", "")
if stills:
    for frame in map(int, stills.split(",")):
        scene.frame_set(frame)
        scene.render.filepath = str(OUT / f"pose-{frame:03d}.png")
        bpy.ops.render.render(write_still=True)
elif os.environ.get("FIKA_RENDER") == "1":
    bpy.ops.render.render(animation=True)

print("FIKA_TRANSPARENT_READY", str(OUT), flush=True)
