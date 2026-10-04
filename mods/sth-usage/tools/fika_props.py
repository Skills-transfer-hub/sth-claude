"""Blender accessories for Buddy's fika preview, with no scene side effects.

create_fika_props() returns cup_root, bun_root, bun_bitten_root and steam_root.
The cup and buns are Z-up, with their origins at the centre of their base.
Move/rotate/scale only the root empties.  The bitten bun starts hidden; swap the
two buns with set_prop_visible(root, visible).  Steam is a child of cup_root.
No camera, light, world, Buddy object, or animation is touched by this module.
"""

import math
import random

import bpy
from mathutils import Vector


TAU = math.tau
PREFIX = "Fika · "


def _material(name, color, roughness=0.4):
    material = bpy.data.materials.new(PREFIX + name)
    material.diffuse_color = (*color, 1)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    if shader is None:
        shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.name = "Principled BSDF"
    output = next((node for node in nodes if node.type == "OUTPUT_MATERIAL"), None)
    if output is None:
        output = nodes.new("ShaderNodeOutputMaterial")
    if not output.inputs["Surface"].is_linked:
        material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    return material


def _noise_finish(material, colors, scale, bump_strength, bump_distance):
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes.get("Principled BSDF")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 3.2
    noise.inputs["Roughness"].default_value = 0.72
    ramp = nodes.new("ShaderNodeValToRGB")
    for element in list(ramp.color_ramp.elements)[2:]:
        ramp.color_ramp.elements.remove(element)
    for index, (position, color) in enumerate(colors):
        element = (ramp.color_ramp.elements[index] if index < 2
                   else ramp.color_ramp.elements.new(position))
        element.position = position
        element.color = (*color, 1)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = bump_distance
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])


def _empty(name, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.1
    obj.parent = parent
    return obj


def _mesh(name, vertices, faces, material, parent):
    mesh = bpy.data.meshes.new(PREFIX + name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(PREFIX + name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def _lathe(name, profile, material, parent, segments=96):
    vertices = []
    for radius, z in profile:
        vertices.extend((radius * math.cos(TAU * i / segments),
                         radius * math.sin(TAU * i / segments), z)
                        for i in range(segments))
    faces = []
    for ring in range(len(profile) - 1):
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((ring * segments + i, ring * segments + j,
                          (ring + 1) * segments + j,
                          (ring + 1) * segments + i))
    # Profiles run from the bottom centre, around the outside, and back to the
    # inner centre, forming a watertight cup with real ceramic wall thickness.
    return _mesh(name, vertices, faces, material, parent)


def _curve(name, points, radius, material, parent, bevel_resolution=4):
    curve = bpy.data.curves.new(PREFIX + name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 12
    curve.bevel_depth = radius
    curve.bevel_resolution = bevel_resolution
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, position in zip(spline.points, points):
        point.co = (*position, 1)
    obj = bpy.data.objects.new(PREFIX + name, curve)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    return obj


def _uvsphere(name, position, scale, material, parent, segments=32, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings,
                                       location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = PREFIX + name
    obj.parent = parent
    obj.location = position
    obj.scale = scale
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def set_prop_visible(root, visible):
    """Show/hide the mesh children of an accessory, including nested steam."""
    for obj in [root, *root.children_recursive]:
        obj.hide_render = not visible
        obj.hide_viewport = not visible


def _cup(ceramic, coffee_material, steam_material):
    root = _empty("cup_root")
    # A softly flared Scandinavian cup. The lip doubles back into the interior.
    profile = [(0.0001, 0.008), (0.110, 0.008), (0.143, 0.012),
               (0.155, 0.025), (0.158, 0.065), (0.173, 0.145),
               (0.191, 0.270), (0.213, 0.410), (0.217, 0.443),
               (0.215, 0.453), (0.208, 0.458), (0.200, 0.455),
               (0.195, 0.447), (0.192, 0.415), (0.173, 0.285),
               (0.155, 0.165), (0.146, 0.100), (0.133, 0.072),
               (0.105, 0.062), (0.0001, 0.062)]
    _lathe("ceramic cup", profile, ceramic, root)
    # Half-oval handle: ends are embedded in the cup, never a detached torus.
    points = []
    for i in range(65):
        t = math.pi * i / 64
        points.append((0.196 + 0.171 * math.sin(t), 0,
                       0.273 + 0.114 * math.cos(t)))
    _curve("ceramic handle", points, 0.026, ceramic, root, 5)
    # Small dark foot is an actual recess in the underside, not a floating disk.
    foot = _lathe("ceramic foot", [(0.137, 0.004), (0.140, 0.010),
                                  (0.136, 0.019), (0.119, 0.019),
                                  (0.118, 0.004), (0.137, 0.004)],
                  ceramic, root)
    coffee = _lathe("coffee surface", [(0.0001, 0.405), (0.160, 0.405),
                                      (0.189, 0.406), (0.191, 0.410)],
                    coffee_material, root)
    steam_root = _empty("steam_root", root)
    for index, (x, y, phase) in enumerate([(-0.072, 0.012, 0),
                                          (0.050, -0.018, 1.1)]):
        points = []
        for i in range(48):
            t = i / 47
            points.append((x + 0.018 * math.sin(t * TAU * 1.05 + phase),
                           y + 0.007 * math.sin(t * TAU + phase),
                           0.428 + 0.185 * t))
        steam = _curve("steam %d" % index, points, 0.005,
                       steam_material, steam_root, 3)
        for i, point in enumerate(steam.data.splines[0].points):
            point.radius = 0.4 + 0.55 * math.sin(math.pi * i / 47)
    root["accessory"] = "Ceramic coffee cup"
    root["handle_side"] = "+X"
    return root, steam_root


def _spiral_point(t):
    angle = t * math.pi * 5.5 + 0.4
    radius = 0.015 + 0.230 * t
    z = 0.112 - 0.024 * t + 0.008 * math.sin(angle * 1.8)
    return Vector((radius * math.cos(angle), radius * math.sin(angle), z))


def _pastry(name, dough, cinnamon, sugar, parent):
    # A low baked foundation connects the rolls; the top is real coiled dough,
    # rather than a cinnamon graphic painted onto a sphere.
    _uvsphere(name + " baked base", (0, 0, 0.060), (0.264, 0.257, 0.058),
              dough, parent, 64, 32)
    vertices, faces = [], []
    segments, ring_sides = 280, 20
    for i in range(segments + 1):
        t = i / segments
        centre = _spiral_point(t)
        tangent = (_spiral_point(min(1, t + 0.0005)) -
                   _spiral_point(max(0, t - 0.0005))).normalized()
        side = Vector((-tangent.y, tangent.x, 0)).normalized()
        width = 0.033 + 0.005 * math.sin(t * math.pi) + 0.0014 * math.sin(t * 97)
        height = 0.038 + 0.004 * math.sin(t * 37)
        for j in range(ring_sides):
            a = TAU * j / ring_sides
            position = centre + side * (width * math.cos(a))
            position.z += height * math.sin(a)
            vertices.append(tuple(position))
    for i in range(segments):
        for j in range(ring_sides):
            k = (j + 1) % ring_sides
            faces.append((i * ring_sides + j, i * ring_sides + k,
                          (i + 1) * ring_sides + k, (i + 1) * ring_sides + j))
    faces.append(tuple(reversed(range(ring_sides))))
    faces.append(tuple(segments * ring_sides + j for j in range(ring_sides)))
    _mesh(name + " spiral dough", vertices, faces, dough, parent)
    # A recessed cinnamon ribbon tracks the inside of the visible spiral.
    points = []
    for i in range(260):
        t = 0.025 + i / 259 * 0.960
        centre = _spiral_point(t)
        radial = Vector((centre.x, centre.y, 0)).normalized()
        centre -= radial * 0.020
        centre.z += 0.027
        points.append(tuple(centre))
    cinnamon_obj = _curve(name + " cinnamon ribbon", points, 0.0055,
                          cinnamon, parent, 3)
    # Curves become meshes so the bitten variant cuts both pastry and filling.
    bpy.context.view_layer.objects.active = cinnamon_obj
    cinnamon_obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    cinnamon_obj.select_set(False)
    rng = random.Random(20261004)
    for i in range(60):
        t = rng.uniform(0.045, 0.965)
        point = _spiral_point(t)
        point.z += 0.038 + 0.004 * math.sin(t * 37)
        point.x += rng.uniform(-0.014, 0.014)
        point.y += rng.uniform(-0.014, 0.014)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1)
        pearl = bpy.context.object
        pearl.name = PREFIX + name + " pearl %02d" % i
        pearl.parent = parent
        pearl.location = point
        size = rng.uniform(0.0046, 0.0082)
        pearl.scale = (size * rng.uniform(0.75, 1.30), size,
                       size * rng.uniform(0.7, 1.0))
        pearl.rotation_euler = tuple(rng.uniform(0, math.pi) for _ in range(3))
        pearl.data.materials.append(sugar)


def _bite(root, crumb):
    # Three intersecting curved cuts give a readable, human bite silhouette.
    cuts = [(0.207, -0.168, 0.125, 0.111),
            (0.267, -0.104, 0.089, 0.080),
            (0.147, -0.224, 0.070, 0.068)]
    for index, (x, y, rx, ry) in enumerate(cuts):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24)
        cutter = bpy.context.object
        cutter.name = PREFIX + "bite cutter"
        cutter.location = (x, y, 0.08)
        cutter.scale = (rx, ry, 0.24)
        cutter.data.materials.append(crumb)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for obj in list(root.children):
            if obj.type != "MESH":
                continue
            # Do not leave isolated sugar floating inside the missing bite.
            if "pearl" in obj.name:
                point = obj.location
                if ((point.x - x) / rx) ** 2 + ((point.y - y) / ry) ** 2 < 1.1:
                    bpy.data.objects.remove(obj, do_unlink=True)
                continue
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new("Fresh bite %d" % index, "BOOLEAN")
            modifier.operation = "DIFFERENCE"
            modifier.solver = "EXACT"
            modifier.object = cutter
            if hasattr(modifier, "material_mode"):
                modifier.material_mode = "TRANSFER"
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    root["bite_side"] = "+X, -Y"


def create_fika_props():
    """Return accessory roots, leaving the bitten bun hidden until needed."""
    ceramic = _material("warm ivory ceramic", (0.82, 0.84, 0.76), 0.22)
    _noise_finish(ceramic, [(0.25, (0.76, 0.80, 0.72)),
                            (0.80, (0.87, 0.89, 0.80))], 55, 0.12, 0.001)
    coffee = _material("fresh dark coffee", (0.020, 0.007, 0.003), 0.13)
    shader = coffee.node_tree.nodes.get("Principled BSDF")
    shader.inputs["IOR"].default_value = 1.333
    shader.inputs["Coat Weight"].default_value = 0.20
    steam = _material("soft coffee steam", (0.86, 0.88, 0.87), 0.9)
    steam_shader = steam.node_tree.nodes.get("Principled BSDF")
    steam_shader.inputs["Alpha"].default_value = 0.10
    if hasattr(steam, "surface_render_method"):
        steam.surface_render_method = "DITHERED"
    dough = _material("golden cardamom dough", (0.38, 0.14, 0.030), 0.44)
    _noise_finish(dough, [(0.22, (0.17, 0.043, 0.005)),
                         (0.50, (0.40, 0.15, 0.029)),
                         (0.78, (0.65, 0.33, 0.087))], 12, 0.20, 0.005)
    cinnamon = _material("cinnamon filling", (0.19, 0.043, 0.012), 0.53)
    sugar = _material("Swedish pearl sugar", (0.96, 0.93, 0.81), 0.62)
    crumb = _material("fresh exposed bun crumb", (0.80, 0.56, 0.28), 0.75)
    _noise_finish(crumb, [(0.25, (0.68, 0.40, 0.16)),
                          (0.75, (0.93, 0.70, 0.39))], 65, 0.38, 0.005)
    cup_root, steam_root = _cup(ceramic, coffee, steam)
    bun_root = _empty("bun_root")
    bun_bitten_root = _empty("bun_bitten_root")
    _pastry("kanelbulle", dough, cinnamon, sugar, bun_root)
    _pastry("bitten kanelbulle", dough, cinnamon, sugar, bun_bitten_root)
    _bite(bun_bitten_root, crumb)
    set_prop_visible(bun_bitten_root, False)
    bun_root["accessory"] = "Swedish cinnamon bun with pearl sugar"
    bun_bitten_root["accessory"] = "Swedish cinnamon bun, one bite taken"
    bpy.ops.object.select_all(action="DESELECT")
    return {"cup_root": cup_root, "bun_root": bun_root,
            "bun_bitten_root": bun_bitten_root, "steam_root": steam_root}
