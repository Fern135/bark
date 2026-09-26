"""The document a new game starts from: a lit scene with a ground plane and a Python script."""
import copy

NEW_GAME = {
    "version": 1,
    "project": {
        "version": 1,
        "name": "My Game",
        "entities": [
            {
                "id": "ground",
                "name": "Ground",
                "tags": ["ground"],
                "enabled": True,
                "visible": True,
                "parentId": None,
                "transform": {
                    "position": {"x": 0, "y": -0.5, "z": 0},
                    "rotation": {"x": 0, "y": 0, "z": 0, "w": 1},
                    "scale": {"x": 1, "y": 1, "z": 1},
                },
                "visual": {"kind": "box", "size": {"x": 20, "y": 1, "z": 20}, "color": "#55AA66"},
                "collider": {
                    "shape": "box",
                    "size": {"x": 20, "y": 1, "z": 20},
                    "trigger": False,
                    "membership": 1,
                    "mask": 4294967295,
                },
                "body": {
                    "mode": "static",
                    "gravityEnabled": False,
                    "mass": 1,
                    "restitution": 0.3,
                    "friction": 0.5,
                    "rotationLocked": False,
                },
                "properties": {},
                "character": None,
                "interaction": None,
            }
        ],
        "assets": [],
        "materials": [],
        "prefabs": [],
        "properties": {},
        "settings": {
            "background": "#101D19",
            "ambientIntensity": 0.8,
            "sunIntensity": 1.5,
            "shadows": True,
            "resolutionScale": 1,
            "maxDevicePixelRatio": 2,
            "gravity": {"x": 0, "y": -9.81, "z": 0},
        },
        "cameras": {
            "active": "editor",
            "targetId": None,
            "target": {"x": 0, "y": 1, "z": 0},
            "offset": {"x": 0, "y": 5, "z": -9},
            "fieldOfView": 60,
        },
        "input": {
            "forward": ["KeyW", "ArrowUp"],
            "backward": ["KeyS", "ArrowDown"],
            "left": ["KeyA", "ArrowLeft"],
            "right": ["KeyD", "ArrowRight"],
            "jump": ["Space"],
            "interact": ["KeyE"],
            "primary": ["Mouse0"],
        },
    },
    "script": {"language": "python", "source": 'print("Hello from Bark!")\n'},
}


def new_game_document(name=None):
    document = copy.deepcopy(NEW_GAME)
    if name:
        document["project"]["name"] = name
    return document
