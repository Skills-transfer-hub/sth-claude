import bpy, os
from mathutils import Vector

OUT = os.environ["BUDDY_OUT"]
CLIPS = {"ok": ("idle", 4.0), "work": ("work", 2.4), "done": ("done", 1.9),
         "error": ("error", 1.5), "update": ("update", 1.8), "noConfig": ("noConfig", 3.6)}
SOURCE_FPS = 30
FRAME_FPS = 20
SIZE = int(os.environ.get("BUDDY_SIZE", "384"))
STATES = os.environ.get("BUDDY_STATES", ",".join(CLIPS)).split(",")
SAMPLES = int(os.environ.get("BUDDY_SAMPLES", "64"))
PREVIEW = os.environ.get("BUDDY_PREVIEW") == "1"

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.threads_mode = "FIXED"
scene.render.threads = min(os.cpu_count() or 4, 6)
if os.environ.get("BUDDY_DEVICE", "CPU") == "METAL":
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
        preferences.compute_device_type = "METAL"
        preferences.get_devices()
        metal = [device for device in preferences.devices if device.type == "METAL"]
        if metal:
            for device in preferences.devices:
                device.use = device.type == "METAL"
            scene.cycles.device = "GPU"
    except Exception as error:
        print("BUDDY_CPU_FALLBACK", str(error), flush=True)
print("BUDDY_RENDER", SIZE, SAMPLES, scene.cycles.device, flush=True)
scene.render.film_transparent = True
bpy.data.objects["Studio floor"].hide_render = True
scene.render.resolution_x = SIZE
scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.compression = 100
scene.camera.location = (3.5, -8, 3.1)
scene.camera.rotation_euler = (Vector((0, 0, 1.15)) - scene.camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera.data.ortho_scale = 3.8

animated = [obj for obj in bpy.data.objects if obj.animation_data and obj.animation_data.nla_tracks]
faces = [obj for obj in bpy.data.objects if "canonical face" in obj.name]

for state, (clip, seconds) in CLIPS.items():
    if state not in STATES:
        continue
    for obj in animated:
        obj.animation_data.action = None
        obj.animation_data.use_nla = True
        for track in obj.animation_data.nla_tracks:
            track.mute = track.name != clip
    for face in faces:
        face.hide_render = face.get("state") != state
        if face.get("state") == state:
            face.data.materials[0] = bpy.data.materials["STH · pale typography"]
    directory = os.path.join(OUT, "frames", state)
    os.makedirs(directory, exist_ok=True)
    count = round(seconds * FRAME_FPS)
    if PREVIEW:
        count = 1
    for index in range(count):
        path = os.path.join(directory, f"{index:03d}.png")
        source_frame = 1 + index * SOURCE_FPS / FRAME_FPS
        scene.frame_set(int(source_frame), subframe=source_frame % 1)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
    print("BUDDY_STATE", state, count, flush=True)
