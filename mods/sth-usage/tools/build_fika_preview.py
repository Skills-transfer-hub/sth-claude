"""Author a separate Blender Fika review scene. Does not modify mod assets."""

from pathlib import Path
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fika_props import create_fika_props
from fika_table import create_fika_table

OUT = Path(os.environ.get("FIKA_OUT", str(Path(__file__).resolve().parents[1] / "previews/fika-3d/table-v2")))
OUT.mkdir(parents=True, exist_ok=True)
FPS = 30
SECONDS = 15.5
END = round(FPS * SECONDS)
FIKA_START = 3.2
scene = bpy.context.scene
scene.frame_set(1)

character = bpy.data.collections["Buddy V6 · neutral armed terminal companion"]
for obj in character.objects:
    obj.animation_data_clear()
root = bpy.data.objects["Buddy V6"]
pose = bpy.data.objects["Buddy · body pose"]
body = bpy.data.objects["Buddy · soft rectangular body"]
hands = [bpy.data.objects["Buddy · left hand"], bpy.data.objects["Buddy · right hand · hello"]]
shoulders = [bpy.data.objects["Buddy · left shoulder pivot"], bpy.data.objects["Buddy · right shoulder pivot V6"]]
pose_rest = pose.location.copy()
pose_rotation = pose.rotation_euler.copy()
for face in [obj for obj in character.objects if "canonical face" in obj.name]:
    face.hide_render = face.get("state") != "done"
    face.hide_viewport = face.hide_render
    if not face.hide_render:
        face.data.materials[0] = bpy.data.materials["STH · pale typography"]

bpy.context.view_layer.update()
hand_rest = [hand.matrix_world.copy() for hand in hands]
for hand, matrix in zip(hands, hand_rest):
    hand.parent = None
    hand.matrix_world = matrix
    hand.rotation_mode = "QUATERNION"

props = create_fika_props()
cup = props["cup_root"]
bun = props["bun_root"]
bitten = props["bun_bitten_root"]
steam = props["steam_root"]
cup_rest = Vector((0.84, -1.10, 0.614))
bun_rest = Vector((-0.78, -1.10, 0.620))
cup_sip = Vector((0.32, -1.03, 0.91))
bun_bite = Vector((-0.23, -0.88, 1.08))
cup_grip = Vector(props.get("cup_grip", (0.34, 0, 0.28)))
bun_grip = Vector((-0.20, 0, 0.04))


def smooth(t, start, end):
    value = max(0, min(1, (t - start) / (end - start)))
    return value * value * (3 - 2 * value)


def held(t, start, rise_end, hold_end, end):
    return smooth(t, start, rise_end) * (1 - smooth(t, hold_end, end))


def path(t, poses):
    if t <= poses[0][0]:
        return Vector(poses[0][1])
    for (start, previous), (end, following) in zip(poses, poses[1:]):
        if t <= end:
            return Vector(previous).lerp(Vector(following), smooth(t, start, end))
    return Vector(poses[-1][1])


def key(obj, frame, paths=("location", "rotation_quaternion", "scale")):
    for path in paths:
        obj.keyframe_insert(data_path=path, frame=frame)


def rounded_box(name, location, scale, material, bevel):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    soft = obj.modifiers.new("Rounded edges", "BEVEL")
    soft.width = bevel
    soft.segments = 5
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


wood = bpy.data.materials.new("Fika · pale oak")
wood.diffuse_color = (0.52, 0.39, 0.25, 1)
wood.use_nodes = True
shader = next((node for node in wood.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
if shader is None:
    shader = wood.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
output = next((node for node in wood.node_tree.nodes if node.type == "OUTPUT_MATERIAL"), None)
if output is None:
    output = wood.node_tree.nodes.new("ShaderNodeOutputMaterial")
if not output.inputs["Surface"].is_linked:
    wood.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
shader.inputs["Base Color"].default_value = (0.52, 0.39, 0.25, 1)
shader.inputs["Roughness"].default_value = 0.6
table = create_fika_table()
table_root = table["table_root"]

# The existing V6 hands remain intact. Small graphite links keep contact with
# the shell when their original rigid shoulder arcs cannot reach the props.
links = []
for side in ("left", "right"):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12)
    link = bpy.context.object
    link.name = f"Fika · {side} articulated arm link"
    link.data.materials.append(body.data.materials[0])
    for polygon in link.data.polygons:
        polygon.use_smooth = True
    link.rotation_mode = "QUATERNION"
    links.append(link)

crumbs = []
for index in range(3):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
    crumb = bpy.context.object
    crumb.name = f"Fika · bite crumb {index + 1}"
    crumb.data.materials.append(wood)
    crumbs.append(crumb)


def show_group(parent, visible, frame):
    for obj in [parent, *parent.children_recursive]:
        obj.hide_render = not visible
        obj.hide_viewport = not visible
        obj.keyframe_insert(data_path="hide_render", frame=frame)
        obj.keyframe_insert(data_path="hide_viewport", frame=frame)


for frame in range(1, END + 2):
    t = (frame - 1) / FPS
    ft = t - FIKA_START
    anticipation = held(ft, 0.25, 0.8, 1.35, 2.1)
    drinking = held(ft, 1.35, 2.3, 3.10, 4.10)
    eating = held(ft, 4.3, 5.40, 7.15, 8.25)
    chew = math.sin((ft - 6.0) * math.tau * 2.2) * held(ft, 6.0, 6.2, 7.0, 7.4)
    table_reach = held(t, 0.20, 0.80, 2.25, 2.55) + held(t, 12.75, 13.05, 14.88, 15.40)
    pose.location = pose_rest + Vector((0.055 * drinking - 0.035 * eating, -0.025 * anticipation, -0.014 * anticipation + 0.015 * chew))
    pose.rotation_euler = pose_rotation.copy()
    pose.rotation_euler.x += math.radians(2 * anticipation - 4 * drinking + 1.8 * chew + 2 * table_reach)
    pose.rotation_euler.y += math.radians(-3 * drinking + 3 * eating + 3 * table_reach)
    key(pose, frame, ("location", "rotation_euler"))

    table_root.location = path(t, [
        (0, (-0.30, 0.80, 1.25)), (0.65, (-0.30, 0.80, 1.25)),
        (1.10, (-1.05, 0.30, 1.22)), (1.72, (-0.25, -1.10, 1.10)),
        (2.30, (0, -1.10, 0.562)), (13.12, (0, -1.10, 0.562)),
        (13.55, (0, -1.10, 1.10)), (14.20, (-1.05, 0.30, 1.22)),
        (14.88, (-0.30, 0.80, 1.25)),
    ])
    table_root.rotation_euler.x = path(t, [
        (0, (math.pi / 2, 0, 0)), (1.10, (math.pi / 2, 0, 0)),
        (2.10, (0, 0, 0)), (13.55, (0, 0, 0)),
        (14.20, (math.pi / 2, 0, 0)),
    ]).x
    folded = 1 - smooth(t, 1.70, 2.10) + smooth(t, 13.55, 14.00)
    table["left_hinge"].rotation_euler.y = -math.pi / 2 * folded
    table["right_hinge"].rotation_euler.y = math.pi / 2 * folded
    key(table_root, frame, ("location", "rotation_euler"))
    for hinge in (table["left_hinge"], table["right_hinge"]):
        key(hinge, frame, ("rotation_euler",))
    show_group(table_root, 0.60 <= t < 14.95, frame)

    lift = held(ft, 1.45, 2.45, 3.1, 4.1)
    sip = held(ft, 2.42, 2.75, 3.02, 3.45)
    cup.location = cup_rest.lerp(cup_sip, lift)
    cup.rotation_euler = (math.radians(-30 * sip), math.radians(-20 * sip), 0)
    if t < FIKA_START:
        cup.location = path(t, [(2.40, (0.65, 0.85, 1.50)), (2.62, (1.60, 0.75, 1.65)),
                                (2.86, (1.60, -0.85, 1.20)), (3.15, cup_rest)])
    elif t >= 12.15:
        cup.location = path(t, [(12.15, cup_rest), (12.45, (1.60, -0.85, 1.20)),
                                (12.70, (1.60, 0.75, 1.65)), (12.95, (0.65, 0.85, 1.50))])
    key(cup, frame, ("location", "rotation_euler", "scale"))
    show_group(cup, 2.38 <= t < 13.00, frame)

    lift_bun = held(ft, 4.6, 5.80, 7.35, 8.35)
    nibble = held(ft, 5.70, 5.95, 6.10, 6.40)
    bun.location = bun_rest.lerp(bun_bite, lift_bun) + Vector((0.02 * nibble, 0.07 * nibble, 0.025 * nibble))
    bun.rotation_euler = (math.radians(60 * lift_bun), math.radians(-12 * lift_bun), math.radians(-8 * lift_bun))
    if t < FIKA_START:
        bun.location = path(t, [(2.45, (-0.65, 0.85, 1.40)), (2.65, (-1.60, 0.75, 1.55)),
                                (2.90, (-1.50, -0.85, 1.05)), (3.20, bun_rest)])
    elif t >= 12.15:
        bun.location = path(t, [(12.15, bun_rest), (12.45, (-1.50, -0.85, 1.05)),
                                (12.70, (-1.60, 0.75, 1.55)), (12.95, (-0.65, 0.85, 1.40))])
    bitten.location = bun.location
    bitten.rotation_euler = bun.rotation_euler
    key(bun, frame, ("location", "rotation_euler", "scale"))
    key(bitten, frame, ("location", "rotation_euler", "scale"))
    show_group(bun, 2.43 <= t < 13.00 and ft < 6.1, frame)
    show_group(bitten, t < 13.00 and ft >= 6.1, frame)

    bpy.context.view_layer.update()
    grips = [bun.matrix_world @ bun_grip, cup.matrix_world @ cup_grip]
    table_grips = [table_root.matrix_world @ table["grip_left"], table_root.matrix_world @ table["grip_right"]]
    cleanup_reach = held(t, 12.00, 12.15, 12.95, 13.05)
    prop_reach = [held(ft, 4.12, 4.62, 8.32, 8.80) + held(t, 2.22, 2.45, 3.20, 3.65) + cleanup_reach,
                  held(ft, 0.55, 1.35, 4.05, 4.65) + held(t, 2.20, 2.40, 3.15, 3.65) + cleanup_reach]
    for index, (hand, shoulder, link) in enumerate(zip(hands, shoulders, links)):
        rest_location, rest_quaternion, rest_scale = hand_rest[index].decompose()
        attachment = shoulder.matrix_world.translation
        total_reach = prop_reach[index] + table_reach
        reach = min(1, total_reach)
        grip = ((grips[index] * prop_reach[index] + table_grips[index] * table_reach) / total_reach
                if total_reach > 0 else grips[index])
        direction = (attachment - grip).normalized()
        quaternion = direction.to_track_quat("Z", "Y")
        hand.location = rest_location.lerp(grip + direction * 0.20, reach)
        hand.rotation_quaternion = rest_quaternion.slerp(quaternion, reach)
        hand.scale = rest_scale
        key(hand, frame)
        bpy.context.view_layer.update()
        wrist = hand.matrix_world @ Vector((0, 0, 0.31))
        delta = wrist - attachment
        link.location = (attachment + wrist) * 0.5
        link.rotation_quaternion = delta.normalized().to_track_quat("Z", "Y")
        link.scale = (0.09 * reach, 0.09 * reach, delta.length * 0.52 * reach)
        key(link, frame)

    for index, crumb in enumerate(crumbs):
        elapsed = ft - 6.12 - index * 0.045
        visible = 0 <= elapsed <= 0.72
        crumb.scale = (0.016, 0.025, 0.02) if visible else (0, 0, 0)
        crumb.location = (-0.12 + index * 0.08 + elapsed * (index - 1) * 0.14, -1.04 - elapsed * 0.12, max(0.625, 1.24 + elapsed * 0.18 - 2.3 * elapsed * elapsed))
        key(crumb, frame, ("location", "scale"))

    if steam:
        steam.rotation_euler.z = math.radians(math.sin(t * 2) * 8)
        key(steam, frame, ("rotation_euler",))

# Per-frame samples retain prop/hand contact; do not overshoot between samples.
for obj in bpy.data.objects:
    if obj.animation_data and obj.animation_data.action:
        action = obj.animation_data.action
        for layer in action.layers:
            for strip in layer.strips:
                if hasattr(strip, "channelbags"):
                    for bag in strip.channelbags:
                        for curve in bag.fcurves:
                            for point in curve.keyframe_points:
                                point.interpolation = "CONSTANT" if curve.data_path.startswith("hide_") else "LINEAR"

scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = END
scene.render.engine = os.environ.get("FIKA_ENGINE", "CYCLES")
if scene.render.engine == "CYCLES":
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(os.environ.get("FIKA_SAMPLES", "24"))
    scene.cycles.use_denoising = True
scene.render.threads_mode = "FIXED"
scene.render.threads = 6
size = int(os.environ.get("FIKA_SIZE", "720"))
scene.render.resolution_x = size
scene.render.resolution_y = size
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.compression = 15
scene.camera.location = (3.1, -8, 3.6)
scene.camera.rotation_euler = (Vector((0, -0.25, 1.17)) - scene.camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera.data.type = "ORTHO"
scene.camera.data.ortho_scale = 4.9
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.42
bpy.data.objects["Studio floor"].hide_render = False
scene.frame_set(170)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "VIEW_3D":
            area.spaces.active.region_3d.view_perspective = "CAMERA"
scene.render.filepath = str(OUT / "frames/" / "fika-")
(OUT / "frames").mkdir(exist_ok=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "buddy-fika-review.blend"))
(OUT / "manifest.json").write_text(json.dumps({
    "source": "assets/model/buddy-v6.blend",
    "fps": FPS, "seconds": SECONDS, "frames": END,
    "review_only": True, "integrated": False,
    "beats": {"sortie_table": 1.1, "installation": 2.3, "gorgee": 6.05,
              "morsure": 9.3, "mastication": 10.0, "rangement_table": 14.12},
}, indent=2))

selected_frames = os.environ.get("FIKA_STILLS", "").split(",")
if selected_frames != [""]:
    for value in selected_frames:
        scene.frame_set(int(value))
        scene.render.filepath = str(OUT / f"pose-{int(value):03d}.png")
        bpy.ops.render.render(write_still=True)
elif os.environ.get("FIKA_RENDER") == "1":
    bpy.ops.render.render(animation=True)

print("FIKA_REVIEW_READY", str(OUT), flush=True)
