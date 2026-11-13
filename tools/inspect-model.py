"""Read-only GLB/GLTF audit. Python standard library only; optional developer tool."""
import hashlib
import json
from pathlib import Path
import struct
import sys
from urllib.parse import unquote

path = Path(sys.argv[1] if len(sys.argv) > 1 else 'models/living_room_interior_free.glb')
data = path.read_bytes()
if path.suffix.lower() == '.glb':
    magic, version, length = struct.unpack_from('<III', data)
    if magic != 0x46546C67 or version != 2 or length != len(data):
        raise ValueError('Invalid GLB header')
    json_length, kind = struct.unpack_from('<II', data, 12)
    if kind != 0x4E4F534A:
        raise ValueError('Missing JSON chunk')
    gltf = json.loads(data[20:20 + json_length])
else:
    gltf = json.loads(data)
external = [item['uri'] for key in ['buffers', 'images'] for item in gltf.get(key, []) if 'uri' in item and not item['uri'].startswith('data:')]
missing = [uri for uri in external if not (path.parent / unquote(uri)).is_file()]
triangles = sum(gltf['accessors'][p['indices']]['count'] // 3 for mesh in gltf.get('meshes', []) for p in mesh['primitives'] if 'indices' in p and p.get('mode', 4) == 4)
report = {
    'file': path.as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
    'asset': gltf.get('asset'), 'extensions': gltf.get('extensionsUsed', []),
    'counts': {k: len(gltf.get(k, [])) for k in ['nodes', 'meshes', 'materials', 'textures', 'images']},
    'indexed_triangles': triangles, 'external_assets': external, 'missing_assets': missing,
    'mesh_nodes': [n.get('name', '(unnamed)') for n in gltf.get('nodes', []) if 'mesh' in n]
}
print(json.dumps(report, indent=2, ensure_ascii=True))
sys.exit(1 if missing else 0)
