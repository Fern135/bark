# Byte character

Converted from the user-supplied `byte.obj`, `byte_color_map.png`, and
`lambert2_Normal.png`. The GLB embeds both textures and retains the OBJ's blue
collar material. Meshes are centered and scaled to two units tall to match Bark's
character collider. OBJ contains no skeleton or animation clips.

Rebuild with Blender:

```sh
blender --background --python web/scripts/import-byte-model.py -- /path/to/byte.obj /path/to/byte_color_map.png /path/to/lambert2_Normal.png web/public/models/byte
```

The generated thumbnail is a render of this GLB. The procedural toy-model build
does not overwrite this directory.
