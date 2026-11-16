import json
from pathlib import Path
import struct
import numpy as np

def create_flat_box_room_glb(src_path: Path, dst_path: Path):
    data = src_path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data)
    json_length, kind = struct.unpack_from('<II', data, 12)
    gltf = json.loads(data[20:20 + json_length])
    bin_start = 20 + json_length
    bin_length, _ = struct.unpack_from('<II', data, bin_start)
    bin_data = data[bin_start + 8 : bin_start + 8 + bin_length]
    
    # In model space:
    # Scene coordinates: x in [-2.993, 2.993], z in [-3.96, 2.38], y in [0.0, 4.58]
    # Scale = 0.2, pos_y = -0.165412
    # model = (scene - [0, -0.165412, 0]) / 0.2
    xmin, xmax = -2.993 * 5, 2.993 * 5
    zmin, zmax = -3.96 * 5, 2.38 * 5
    ymin = (0.0 + 0.165412) * 5
    ymax = (4.58 + 0.165412) * 5
    
    # UV scaling: 1 repeat per ~1.5 meters in scene space
    ux = (xmax - xmin) * 0.2 / 1.5  # ~3.99
    uz = (zmax - zmin) * 0.2 / 1.5  # ~4.23
    uy = (ymax - ymin) * 0.2 / 1.5  # ~3.05
    
    # 1. Geometry for Floor
    # Facing +Y (up)
    floor_pos = np.array([
        [xmin, ymin, zmin],
        [xmax, ymin, zmin],
        [xmax, ymin, zmax],
        [xmin, ymin, zmax]
    ], dtype=np.float32)
    floor_norm = np.array([[0, 1, 0]] * 4, dtype=np.float32)
    floor_uv = np.array([
        [0, 0],
        [ux, 0],
        [ux, uz],
        [0, uz]
    ], dtype=np.float32)
    floor_idx = np.array([0, 1, 2, 0, 2, 3], dtype=np.uint16)
    
    # 2. Geometry for Ceiling
    # Facing -Y (down)
    ceil_pos = np.array([
        [xmin, ymax, zmax],
        [xmax, ymax, zmax],
        [xmax, ymax, zmin],
        [xmin, ymax, zmin]
    ], dtype=np.float32)
    ceil_norm = np.array([[0, -1, 0]] * 4, dtype=np.float32)
    ceil_uv = np.array([
        [0, 0],
        [ux, 0],
        [ux, uz],
        [0, uz]
    ], dtype=np.float32)
    ceil_idx = np.array([0, 1, 2, 0, 2, 3], dtype=np.uint16)
    
    # 3. Geometry for 4 Walls (combined into 1 mesh)
    # Back wall (z = zmin, facing +Z)
    w_back_pos = np.array([
        [xmin, ymin, zmin],
        [xmax, ymin, zmin],
        [xmax, ymax, zmin],
        [xmin, ymax, zmin]
    ], dtype=np.float32)
    w_back_norm = np.array([[0, 0, 1]] * 4, dtype=np.float32)
    w_back_uv = np.array([[0, 0], [ux, 0], [ux, uy], [0, uy]], dtype=np.float32)
    
    # Front wall (z = zmax, facing -Z)
    w_front_pos = np.array([
        [xmax, ymin, zmax],
        [xmin, ymin, zmax],
        [xmin, ymax, zmax],
        [xmax, ymax, zmax]
    ], dtype=np.float32)
    w_front_norm = np.array([[0, 0, -1]] * 4, dtype=np.float32)
    w_front_uv = np.array([[0, 0], [ux, 0], [ux, uy], [0, uy]], dtype=np.float32)
    
    # Left wall (x = xmin, facing +X)
    w_left_pos = np.array([
        [xmin, ymin, zmax],
        [xmin, ymin, zmin],
        [xmin, ymax, zmin],
        [xmin, ymax, zmax]
    ], dtype=np.float32)
    w_left_norm = np.array([[1, 0, 0]] * 4, dtype=np.float32)
    w_left_uv = np.array([[0, 0], [uz, 0], [uz, uy], [0, uy]], dtype=np.float32)
    
    # Right wall (x = xmax, facing -X)
    w_right_pos = np.array([
        [xmax, ymin, zmin],
        [xmax, ymin, zmax],
        [xmax, ymax, zmax],
        [xmax, ymax, zmin]
    ], dtype=np.float32)
    w_right_norm = np.array([[-1, 0, 0]] * 4, dtype=np.float32)
    w_right_uv = np.array([[0, 0], [uz, 0], [uz, uy], [0, uy]], dtype=np.float32)
    
    walls_pos = np.vstack([w_back_pos, w_front_pos, w_left_pos, w_right_pos])
    walls_norm = np.vstack([w_back_norm, w_front_norm, w_left_norm, w_right_norm])
    walls_uv = np.vstack([w_back_uv, w_front_uv, w_left_uv, w_right_uv])
    
    walls_idx = []
    for quad_i in range(4):
        base = quad_i * 4
        walls_idx.extend([base + 0, base + 1, base + 2, base + 0, base + 2, base + 3])
    walls_idx = np.array(walls_idx, dtype=np.uint16)
    
    # Identify materials from original GLB
    # Material 6: 'Material.001' (Wall)
    # Material 5: 'material' (Floor)
    # Material 3: 'Material.002' (Ceiling)
    kept_material_indices = [6, 5, 3] # [Wall, Floor, Ceiling]
    
    # Textures/images used by these materials:
    # Material.001 uses textures referencing Image 4, 5
    # Material.002 uses textures referencing Image 2, 3
    # material uses no textures
    mat_map = {6: 0, 5: 1, 3: 2} # old -> new
    
    kept_texture_indices = set()
    for m_idx in kept_material_indices:
        mat = gltf['materials'][m_idx]
        pbr = mat.get('pbrMetallicRoughness', {})
        for k in ['baseColorTexture', 'metallicRoughnessTexture']:
            if k in pbr:
                kept_texture_indices.add(pbr[k]['index'])
        for k in ['normalTexture', 'occlusionTexture', 'emissiveTexture']:
            if k in mat:
                kept_texture_indices.add(mat[k]['index'])
                
    kept_image_indices = set()
    kept_sampler_indices = set()
    for t_idx in kept_texture_indices:
        tex = gltf['textures'][t_idx]
        if 'source' in tex: kept_image_indices.add(tex['source'])
        if 'sampler' in tex: kept_sampler_indices.add(tex['sampler'])
        
    kept_bufferview_indices = set()
    for img_idx in kept_image_indices:
        img = gltf['images'][img_idx]
        if 'bufferView' in img:
            kept_bufferview_indices.add(img['bufferView'])
            
    # Now build new buffer
    new_bin_bytes = bytearray()
    new_bufferviews = []
    bv_map = {}
    
    # First copy image bufferViews from original bin
    for old_bv_idx in sorted(kept_bufferview_indices):
        old_bv = gltf['bufferViews'][old_bv_idx]
        offset = old_bv.get('byteOffset', 0)
        length = old_bv['byteLength']
        
        while len(new_bin_bytes) % 4 != 0: new_bin_bytes.append(0)
        new_offset = len(new_bin_bytes)
        new_bin_bytes.extend(bin_data[offset : offset + length])
        
        new_bv = {
            'buffer': 0,
            'byteOffset': new_offset,
            'byteLength': length
        }
        bv_map[old_bv_idx] = len(new_bufferviews)
        new_bufferviews.append(new_bv)

    # Rebuild images, samplers, textures, materials
    img_map = {}
    new_images = []
    for old_img_idx in sorted(kept_image_indices):
        old_img = dict(gltf['images'][old_img_idx])
        if 'bufferView' in old_img:
            old_img['bufferView'] = bv_map[old_img['bufferView']]
        img_map[old_img_idx] = len(new_images)
        new_images.append(old_img)
        
    samp_map = {}
    new_samplers = []
    for old_s_idx in sorted(kept_sampler_indices):
        samp_map[old_s_idx] = len(new_samplers)
        new_samplers.append(dict(gltf['samplers'][old_s_idx]))
        
    tex_map = {}
    new_textures = []
    for old_t_idx in sorted(kept_texture_indices):
        tex = dict(gltf['textures'][old_t_idx])
        if 'source' in tex: tex['source'] = img_map[tex['source']]
        if 'sampler' in tex: tex['sampler'] = samp_map[tex['sampler']]
        tex_map[old_t_idx] = len(new_textures)
        new_textures.append(tex)
        
    new_materials = []
    for old_m_idx in kept_material_indices:
        mat = dict(gltf['materials'][old_m_idx])
        mat['doubleSided'] = True # Ensure visible from both sides
        pbr = dict(mat.get('pbrMetallicRoughness', {}))
        for k in ['baseColorTexture', 'metallicRoughnessTexture']:
            if k in pbr and 'index' in pbr[k]:
                pbr[k] = dict(pbr[k])
                pbr[k]['index'] = tex_map[pbr[k]['index']]
        mat['pbrMetallicRoughness'] = pbr
        for k in ['normalTexture', 'occlusionTexture', 'emissiveTexture']:
            if k in mat and 'index' in mat[k]:
                mat[k] = dict(mat[k])
                mat[k]['index'] = tex_map[mat[k]['index']]
        new_materials.append(mat)
        
    # Helper to add bufferView and accessor for mesh arrays
    new_accessors = []
    def add_accessor(arr, comp_type, acc_type, target=None):
        nonlocal new_bin_bytes, new_bufferviews, new_accessors
        while len(new_bin_bytes) % 4 != 0: new_bin_bytes.append(0)
        offset = len(new_bin_bytes)
        raw = arr.tobytes()
        new_bin_bytes.extend(raw)
        
        bv_idx = len(new_bufferviews)
        bv = {
            'buffer': 0,
            'byteOffset': offset,
            'byteLength': len(raw)
        }
        if target: bv['target'] = target
        new_bufferviews.append(bv)
        
        acc = {
            'bufferView': bv_idx,
            'byteOffset': 0,
            'componentType': comp_type, # 5126 for float, 5123 for ushort
            'count': len(arr),
            'type': acc_type,
            'min': arr.min(axis=0).tolist(),
            'max': arr.max(axis=0).tolist()
        }
        acc_idx = len(new_accessors)
        new_accessors.append(acc)
        return acc_idx

    # Target constants: ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963
    # Walls mesh
    walls_pos_acc = add_accessor(walls_pos, 5126, 'VEC3', 34962)
    walls_norm_acc = add_accessor(walls_norm, 5126, 'VEC3', 34962)
    walls_uv_acc = add_accessor(walls_uv, 5126, 'VEC2', 34962)
    walls_idx_acc = add_accessor(walls_idx, 5123, 'SCALAR', 34963)
    
    # Floor mesh
    floor_pos_acc = add_accessor(floor_pos, 5126, 'VEC3', 34962)
    floor_norm_acc = add_accessor(floor_norm, 5126, 'VEC3', 34962)
    floor_uv_acc = add_accessor(floor_uv, 5126, 'VEC2', 34962)
    floor_idx_acc = add_accessor(floor_idx, 5123, 'SCALAR', 34963)
    
    # Ceiling mesh
    ceil_pos_acc = add_accessor(ceil_pos, 5126, 'VEC3', 34962)
    ceil_norm_acc = add_accessor(ceil_norm, 5126, 'VEC3', 34962)
    ceil_uv_acc = add_accessor(ceil_uv, 5126, 'VEC2', 34962)
    ceil_idx_acc = add_accessor(ceil_idx, 5123, 'SCALAR', 34963)
    
    # Meshes:
    # Mesh 0: Walls -> Plane.001_Material.001_0
    # Mesh 1: Floor -> Plane_Floor_0
    # Mesh 2: Ceiling -> Plane.004_Material.002_0
    new_meshes = [
        {
            'name': 'Plane.001_Material.001_0',
            'primitives': [{
                'attributes': {'POSITION': walls_pos_acc, 'NORMAL': walls_norm_acc, 'TEXCOORD_0': walls_uv_acc},
                'indices': walls_idx_acc,
                'material': mat_map[6] # Material.001
            }]
        },
        {
            'name': 'Plane_Floor_0',
            'primitives': [{
                'attributes': {'POSITION': floor_pos_acc, 'NORMAL': floor_norm_acc, 'TEXCOORD_0': floor_uv_acc},
                'indices': floor_idx_acc,
                'material': mat_map[5] # material
            }]
        },
        {
            'name': 'Plane.004_Material.002_0',
            'primitives': [{
                'attributes': {'POSITION': ceil_pos_acc, 'NORMAL': ceil_norm_acc, 'TEXCOORD_0': ceil_uv_acc},
                'indices': ceil_idx_acc,
                'material': mat_map[3] # Material.002
            }]
        }
    ]
    
    # Nodes:
    # 0: Sketchfab_model
    # 1: 3ce6ca67227f4cf0809b60b0c8d0183f.fbx
    # 2: RootNode -> children: [3, 4, 5]
    # 3: Plane.001_Material.001_0 (mesh 0: Walls)
    # 4: Plane_Floor_0 (mesh 1: Floor)
    # 5: Plane.004_Material.002_0 (mesh 2: Ceiling)
    new_nodes = [
        {'name': 'Sketchfab_model', 'children': [1]},
        {'name': '3ce6ca67227f4cf0809b60b0c8d0183f.fbx', 'children': [2]},
        {'name': 'RootNode', 'children': [3, 4, 5]},
        {'name': 'Plane.001_Material.001_0', 'mesh': 0},
        {'name': 'Plane_Floor_0', 'mesh': 1},
        {'name': 'Plane.004_Material.002_0', 'mesh': 2}
    ]
    
    # Pad bin data to 4 bytes
    while len(new_bin_bytes) % 4 != 0: new_bin_bytes.append(0)
    
    new_gltf = {
        'asset': gltf.get('asset', {'version': '2.0'}),
        'scenes': [{'name': 'Sketchfab_Scene', 'nodes': [0]}],
        'scene': 0,
        'nodes': new_nodes,
        'meshes': new_meshes,
        'materials': new_materials,
        'textures': new_textures,
        'images': new_images,
        'samplers': new_samplers,
        'accessors': new_accessors,
        'bufferViews': new_bufferviews,
        'buffers': [{'byteLength': len(new_bin_bytes)}]
    }
    
    json_bytes = json.dumps(new_gltf, separators=(',', ':')).encode('utf-8')
    while len(json_bytes) % 4 != 0: json_bytes += b' '
    
    total_len = 12 + 8 + len(json_bytes) + 8 + len(new_bin_bytes)
    hdr = struct.pack('<III', 0x46546C67, 2, total_len)
    j_hdr = struct.pack('<II', len(json_bytes), 0x4E4F534A)
    b_hdr = struct.pack('<II', len(new_bin_bytes), 0x004E4942)
    
    out_data = hdr + j_hdr + json_bytes + b_hdr + bytes(new_bin_bytes)
    dst_path.write_bytes(out_data)
    print(f"Generated clean flat box room GLB: {len(out_data)} bytes ({len(out_data)/1024/1024:.2f} MB)")

if __name__ == '__main__':
    create_flat_box_room_glb(
        Path('models/living_room_interior_free.original.glb'),
        Path('models/living_room_flat_box.glb')
    )
