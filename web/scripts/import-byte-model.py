"""Blender: --background --python this_file -- model.obj color.png normal.png output_dir"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

obj_path, color_path, normal_path, output = map(Path, sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=str(obj_path), forward_axis="NEGATIVE_Z", up_axis="Y")
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
color = bpy.data.images.load(str(color_path))
normal = bpy.data.images.load(str(normal_path))
normal.colorspace_settings.name = "Non-Color"
material = bpy.data.materials.get("lambert2")
if material is None:
    raise RuntimeError("Expected the OBJ's lambert2 texture material")
material.use_nodes = True
nodes, links = material.node_tree.nodes, material.node_tree.links
nodes.clear()
surface = nodes.new("ShaderNodeBsdfPrincipled")
surface.inputs["Roughness"].default_value = 0.8
surface.inputs["Metallic"].default_value = 0
diffuse = nodes.new("ShaderNodeTexImage")
diffuse.image = color
detail = nodes.new("ShaderNodeTexImage")
detail.image = normal
normal_map = nodes.new("ShaderNodeNormalMap")
normal_map.inputs["Strength"].default_value = 0.7
sink = nodes.new("ShaderNodeOutputMaterial")
links.new(diffuse.outputs["Color"], surface.inputs["Base Color"])
links.new(detail.outputs["Color"], normal_map.inputs["Color"])
links.new(normal_map.outputs["Normal"], surface.inputs["Normal"])
links.new(surface.outputs["BSDF"], sink.inputs["Surface"])

# Bark's character origin is centered, with a two-unit-high capsule collider.
corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
low = Vector(tuple(min(point[i] for point in corners) for i in range(3)))
high = Vector(tuple(max(point[i] for point in corners) for i in range(3)))
center = (low + high) / 2
scale = 2 / (high.z - low.z)
for obj in meshes:
    transform = obj.matrix_world.copy()
    for vertex in obj.data.vertices:
        vertex.co = (transform @ vertex.co - center) * scale
    obj.matrix_world.identity()
    # Face the same direction as Bark's built-in characters and preview camera.
    obj.rotation_euler.z = math.pi
    obj.modifiers.new(name="Export triangles", type="TRIANGULATE")

output.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output / "player.glb"), export_format="GLB", export_yup=True, export_tangents=True, export_apply=True, export_animations=False)
size = (high - low) * scale
(output / "manifest.json").write_text(json.dumps({"file": "player.glb", "source": "User-supplied byte.obj, byte_color_map.png, lambert2_Normal.png", "size": {"x": size.x, "y": size.z, "z": size.y}}, indent=2) + "\n")
print("BYTE_MODEL", json.dumps({"meshes": len(meshes), "height": size.z, "output": str(output / "player.glb")}))
