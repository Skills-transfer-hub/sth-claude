"""A compact folding fika table for the standalone Buddy animation preview.

create_fika_table() returns table_root, left_hinge, right_hinge, grip_left and
grip_right.  Grip positions are mathutils.Vector values in table_root space.
The tabletop is centred on the root origin.  Open supports point downwards;
left_hinge.rotation_euler.y = -pi/2 and right_hinge.rotation_euler.y = pi/2
fold both supports inwards, flat under the tabletop.

This module does not change Buddy, scene settings, cameras, lights or the mod.
"""

import bpy
from mathutils import Vector


PREFIX = "Fika table · "


def _empty(name, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.1
    obj.parent = parent
    return obj


def _material(name, color, roughness):
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
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    return material


def _wood_material():
    material = _material("oiled Nordic oak", (0.33, 0.155, 0.059), 0.47)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    coordinates = nodes.new("ShaderNodeTexCoord")
    stretch = nodes.new("ShaderNodeVectorMath")
    stretch.operation = "MULTIPLY"
    stretch.inputs[1].default_value = (1.3, 30, 4)
    grain = nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 4
    grain.inputs["Detail"].default_value = 3
    grain.inputs["Roughness"].default_value = 0.72
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.20
    ramp.color_ramp.elements[0].color = (0.16, 0.067, 0.021, 1)
    ramp.color_ramp.elements[1].position = 0.84
    ramp.color_ramp.elements[1].color = (0.45, 0.235, 0.091, 1)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    bump.inputs["Distance"].default_value = 0.002
    shader = nodes.get("Principled BSDF")
    links.new(coordinates.outputs["Generated"], stretch.inputs[0])
    links.new(stretch.outputs["Vector"], grain.inputs["Vector"])
    links.new(grain.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    links.new(grain.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return material


def _box(name, size, position, material, parent, bevel=0.006):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = PREFIX + name
    obj.parent = parent
    obj.location = position
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if bevel:
        modifier = obj.modifiers.new("Rounded edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 4
    modifier = obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    modifier.keep_sharp = True
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def _axle(name, position, radius, length, material, parent):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=length)
    obj = bpy.context.object
    obj.name = PREFIX + name
    obj.parent = parent
    obj.location = position
    # Cylinder's Z axis becomes the hinge's Y axis.
    obj.rotation_euler.x = 1.5707963267948966
    obj.data.materials.append(material)
    modifier = obj.modifiers.new("Soft machined edges", "BEVEL")
    modifier.width = 0.002
    modifier.segments = 3
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def _support(name, hinge, graphite, rubber):
    # Two graphite rails plus a transverse foot form a restrained U frame.
    # All parts live in the hinge's local space and fold together as one unit.
    # Small offset keeps the folded frame clear of the 10 cm wooden top.
    # The hinge axis itself retains the exact requested position.
    x = -0.025 if name.startswith("left") else 0.025
    for side, y in [("front", -0.30), ("back", 0.30)]:
        _box(name + " " + side + " rail", (0.032, 0.032, 0.470),
             (x, y, -0.250), graphite, hinge, 0.008)
        _box(name + " " + side + " rubber foot", (0.043, 0.048, 0.018),
             (x, y, -0.497), rubber, hinge, 0.004)
        _axle(name + " " + side + " pivot collar", (0, y, 0),
              0.030, 0.064, graphite, hinge)
    _box(name + " lower crossbar", (0.032, 0.644, 0.032),
         (x, 0, -0.478), graphite, hinge, 0.008)
    _axle(name + " hinge pin", (0, 0, 0), 0.016, 0.660, graphite, hinge)


def create_fika_table():
    """Create the open table and return its animation pivots and grip offsets."""
    wood = _wood_material()
    graphite = _material("matte graphite frame", (0.029, 0.039, 0.047), 0.39)
    rubber = _material("dark rubber feet", (0.008, 0.010, 0.012), 0.82)
    root = _empty("table_root")
    _box("oak tabletop", (2.5, 0.83, 0.10), (0, 0, 0), wood, root, 0.024)
    left_hinge = _empty("left_hinge", root)
    right_hinge = _empty("right_hinge", root)
    left_hinge.location = (-0.92, 0, -0.055)
    right_hinge.location = (0.92, 0, -0.055)
    # Fixed mounting saddles stay under the wood as the legs rotate.
    for name, x in [("left", -0.92), ("right", 0.92)]:
        for side, y in [("front", -0.30), ("back", 0.30)]:
            _box(name + " " + side + " hinge saddle", (0.088, 0.094, 0.028),
                 (x, y, -0.053), graphite, root, 0.009)
    _support("left support", left_hinge, graphite, rubber)
    _support("right support", right_hinge, graphite, rubber)
    root["accessory"] = "Compact Nordic oak folding fika table"
    root["width"] = 2.5
    root["depth"] = 0.83
    root["tabletop_thickness"] = 0.10
    root["support_height"] = 0.50
    bpy.ops.object.select_all(action="DESELECT")
    return {"table_root": root, "left_hinge": left_hinge,
            "right_hinge": right_hinge,
            "grip_left": Vector((-1.12, -0.38, -0.03)),
            "grip_right": Vector((1.12, -0.38, -0.03))}
