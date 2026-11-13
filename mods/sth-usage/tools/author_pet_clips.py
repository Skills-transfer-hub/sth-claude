"""Author Buddy's pet clips (walk, run, jump, sit, sleep) as NLA tracks in buddy-v6.blend.

Run inside Blender, then render with render_buddy_frames.py:

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    assets/model/buddy-v6.blend --python tools/author_pet_clips.py

Poses are computed for every 30 FPS source frame, so each loop closes exactly.
Re-running replaces the pet tracks; the six original clips are untouched.
"""

import bpy, math, os

SOURCE_FPS = 30
# Seconds per clip; render_buddy_frames.py samples them at 20 FPS.
CLIPS = {"walk": 1.2, "run": 0.6, "jump": 1.0, "sit": 2.0, "sleep": 3.0}
# Facing 3/4 toward screen right; the panel mirrors the poses to walk left.
HEAD = math.radians(60)
TAU = 2 * math.pi

ROOT = bpy.data.objects["Buddy V6"]
BODY = bpy.data.objects["Buddy · body pose"]
LEFT_FOOT = bpy.data.objects["Buddy · left hip foot pivot"]
RIGHT_FOOT = bpy.data.objects["Buddy · right hip foot pivot"]
LEFT_ARM = bpy.data.objects["Buddy · left shoulder pivot"]
RIGHT_ARM = bpy.data.objects["Buddy · right shoulder pivot V6"]
RIG = (ROOT, BODY, LEFT_FOOT, RIGHT_FOOT, LEFT_ARM, RIGHT_ARM)
REST = {
    ROOT: ((0, 0, 0), (0, 0, 0)),
    BODY: ((0, 0, 1.28), (0, -0.052, 0)),
    LEFT_FOOT: ((-0.65, -0.015, 0.36), (0, 0, 0)),
    RIGHT_FOOT: ((0.65, -0.015, 0.36), (0, 0, 0)),
    LEFT_ARM: ((-1.09, 0.015, -0.04), (0, 0, 0)),
    RIGHT_ARM: ((1.09, 0.015, -0.04), (0, 0, 0)),
}


def smooth(edge0, edge1, x):
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def pose(clip, p):
    """Offsets from REST for phase p in [0, 1): {obj: (dloc, drot, scale)}."""
    s, c = math.sin(TAU * p), math.cos(TAU * p)
    out = {obj: ([0, 0, 0], [0, 0, 0], [1, 1, 1]) for obj in RIG}
    out[ROOT][1][2] = HEAD
    if clip in ("walk", "run"):
        run = clip == "run"
        stride, lift, swing = (0.34, 0.2, 0.75) if run else (0.28, 0.14, 0.4)
        out[ROOT][0][2] = 0.07 * abs(s) if run else 0
        out[BODY][0][2] = (0.06 if run else 0.04) * abs(s)
        out[BODY][1][0] = 0.2 if run else 0.08            # lean toward the walk
        out[BODY][1][2] = 0.06 * s
        for foot, phase in ((LEFT_FOOT, 0), (RIGHT_FOOT, 0.5)):
            fs, fc = math.sin(TAU * (p + phase)), math.cos(TAU * (p + phase))
            out[foot][0][1] = -stride * fs
            out[foot][0][2] = lift * max(0.0, fc)
            out[foot][1][0] = -0.25 * max(0.0, fc)
        out[LEFT_ARM][1][0] = swing * s
        out[RIGHT_ARM][1][0] = -swing * s
        out[LEFT_ARM][1][1], out[RIGHT_ARM][1][1] = 0.12, -0.12
    elif clip == "jump":
        crouch = smooth(0.0, 0.18, p) - smooth(0.18, 0.32, p)
        air = smooth(0.25, 0.8, p)
        height = 0.55 * math.sin(math.pi * air) if 0.25 < p < 0.8 else 0
        land = smooth(0.78, 0.86, p) - smooth(0.86, 1.0, p)
        squash = 0.1 * crouch + 0.08 * land
        stretch = 0.06 * math.sin(math.pi * air) if 0.25 < p < 0.8 else 0
        out[ROOT][0][2] = height
        out[BODY][0][2] = -0.18 * (crouch + land)
        out[BODY][2][:] = [1 + squash, 1 + squash, 1 - squash + stretch]
        raise_arms = 2.2 * math.sin(math.pi * air) if 0.25 < p < 0.8 else 0
        out[LEFT_ARM][1][1], out[RIGHT_ARM][1][1] = 0.15 + raise_arms, -0.15 - raise_arms
        for foot in (LEFT_FOOT, RIGHT_FOOT):
            out[foot][1][0] = -0.3 * (math.sin(math.pi * air) if 0.25 < p < 0.8 else 0)
    elif clip in ("sit", "sleep"):
        sleep = clip == "sleep"
        breath = math.sin(TAU * p)
        out[BODY][0][2] = -0.3
        out[BODY][1][0] = 0.22 if sleep else 0.0           # nod forward asleep
        out[BODY][1][1] = (0.1 if sleep else 0.0)
        out[BODY][2][:] = [1 - 0.012 * breath, 1 - 0.012 * breath, 1 + (0.03 if sleep else 0.015) * breath]
        for foot in (LEFT_FOOT, RIGHT_FOOT):
            out[foot][0][1] = -0.42
            out[foot][0][2] = -0.12
            out[foot][1][0] = -1.15
        droop = 0.12 if sleep else 0.3
        out[LEFT_ARM][1][1], out[RIGHT_ARM][1][1] = droop, -droop
        out[LEFT_ARM][1][0] = out[RIGHT_ARM][1][0] = -0.25 if not sleep else 0.1
    return out


def key_clip(clip, seconds):
    frames = round(seconds * SOURCE_FPS)
    for obj in RIG:
        obj.animation_data_create()
        ad = obj.animation_data
        for track in [t for t in ad.nla_tracks if t.name == clip]:
            ad.nla_tracks.remove(track)
        name = f"Buddy V6 {clip} · {obj.name}"
        if name in bpy.data.actions:
            bpy.data.actions.remove(bpy.data.actions[name])
        ad.action = bpy.data.actions.new(name)
    for frame in range(frames + 1):
        values = pose(clip, (frame % frames) / frames)
        for obj in RIG:
            (loc, rot), (dloc, drot, scale) = REST[obj], values[obj]
            obj.location = [a + b for a, b in zip(loc, dloc)]
            obj.rotation_euler = [a + b for a, b in zip(rot, drot)]
            obj.scale = scale
            for path in ("location", "rotation_euler", "scale"):
                obj.keyframe_insert(path, frame=1 + frame)
    for obj in RIG:
        ad = obj.animation_data
        action = ad.action
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for point in curve.keyframe_points:
                            point.interpolation = "LINEAR"
        ad.action = None
        track = ad.nla_tracks.new()
        track.name = clip
        track.strips.new(action.name, 1, action)
        track.mute = True
    print("PET_CLIP", clip, frames, flush=True)


def sleep_props():
    ok = bpy.data.objects["Buddy · canonical face · ok"]
    face = bpy.data.objects.get("Buddy · canonical face · sleep")
    if face is None:
        face = ok.copy()
        face.data = ok.data.copy()
        face.name = "Buddy · canonical face · sleep"
        bpy.context.scene.collection.objects.link(face)
        for collection in ok.users_collection:
            if face.name not in collection.objects:
                collection.objects.link(face)
    face.data.body = "-_-"
    face["state"] = "sleep"
    face.hide_render = True
    # Two "z" letters rise from Buddy's head, one after the other.
    for index in range(2):
        name = f"Buddy · sleep z {index}"
        z = bpy.data.objects.get(name)
        if z is None:
            z = bpy.data.objects.new(name, ok.data.copy())
            for collection in ok.users_collection:
                collection.objects.link(z)
        z.data.body = "z"
        z.data.materials.clear()
        z.data.materials.append(bpy.data.materials["STH · pale typography"])
        z["state"] = "sleep-z"
        z.parent = ROOT
        z.rotation_euler = ok.matrix_world.to_euler()  # root is at rest here
        z.animation_data_create()
        ad = z.animation_data
        for track in list(ad.nla_tracks):
            ad.nla_tracks.remove(track)
        action_name = f"Buddy V6 sleep · {name}"
        if action_name in bpy.data.actions:
            bpy.data.actions.remove(bpy.data.actions[action_name])
        ad.action = bpy.data.actions.new(action_name)
        frames = round(CLIPS["sleep"] * SOURCE_FPS)
        for frame in range(frames + 1):
            p = ((frame / frames) + index * 0.5) % 1
            grow = math.sin(math.pi * p)
            z.location = (0.45 + 0.4 * p, -0.45, 2.05 + 0.6 * p)
            z.scale = (1.8 * grow + 0.001,) * 3
            z.keyframe_insert("location", frame=1 + frame)
            z.keyframe_insert("scale", frame=1 + frame)
        action = ad.action
        ad.action = None
        track = ad.nla_tracks.new()
        track.name = "sleep"
        track.strips.new(action.name, 1, action)
        track.mute = True


sleep_props()
for clip, seconds in CLIPS.items():
    key_clip(clip, seconds)
if os.environ.get("BUDDY_PET_SAVE", "1") == "1":
    bpy.ops.wm.save_mainfile()
    print("PET_SAVED", bpy.data.filepath, flush=True)
