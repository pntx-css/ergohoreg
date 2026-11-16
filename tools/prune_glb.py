import json
from pathlib import Path
import struct
import copy

def prune_glb(src_path: Path, dst_path: Path, keep_parent_names: set):
    data = src_path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data)
    assert magic == 0x46546C67 and version == 2
    
    json_length, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4E4F534A
    gltf = json.loads(data[20:20 + json_length])
    
    bin_start = 20 + json_length
    bin_length, bin_kind = struct.unpack_from('<II', data, bin_start)
    assert bin_kind == 0x004E4942
    bin_data = data[bin_start + 8 : bin_start + 8 + bin_length]
    
    nodes = gltf['nodes']
    
    kept_node_indices = set()
    
    def mark_node(idx):
        kept_node_indices.add(idx)
        for child in nodes[idx].get('children', []):
            mark_node(child)
            
    # Always keep root chain
    kept_node_indices.add(0)
    kept_node_indices.add(1)
    kept_node_indices.add(2)
    
    for c in nodes[2].get('children', []):
        child_node = nodes[c]
        if child_node.get('name') in keep_parent_names:
            mark_node(c)

    print(f"Kept nodes ({len(kept_node_indices)}):")
    for idx in sorted(kept_node_indices):
        print(f"  Node {idx}: {nodes[idx].get('name')}")
        
    # 2. Determine kept meshes
    kept_mesh_indices = set()
    for n_idx in kept_node_indices:
        m_idx = nodes[n_idx].get('mesh')
        if m_idx is not None:
            kept_mesh_indices.add(m_idx)
            
    print(f"\nKept meshes ({len(kept_mesh_indices)}):")
    for idx in sorted(kept_mesh_indices):
        print(f"  Mesh {idx}: {gltf['meshes'][idx].get('name')}")
        
    # 3. Determine kept accessors & materials
    kept_accessor_indices = set()
    kept_material_indices = set()
    
    for m_idx in kept_mesh_indices:
        mesh = gltf['meshes'][m_idx]
        for prim in mesh['primitives']:
            for attr_acc in prim['attributes'].values():
                kept_accessor_indices.add(attr_acc)
            if 'indices' in prim:
                kept_accessor_indices.add(prim['indices'])
            if 'material' in prim:
                kept_material_indices.add(prim['material'])
                
    print(f"\nKept materials ({len(kept_material_indices)}):")
    for idx in sorted(kept_material_indices):
        print(f"  Material {idx}: {gltf['materials'][idx].get('name')}")

    # 4. Determine kept textures & images & samplers
    kept_texture_indices = set()
    for mat_idx in kept_material_indices:
        mat = gltf['materials'][mat_idx]
        pbr = mat.get('pbrMetallicRoughness', {})
        for tex_field in ['baseColorTexture', 'metallicRoughnessTexture']:
            if tex_field in pbr and 'index' in pbr[tex_field]:
                kept_texture_indices.add(pbr[tex_field]['index'])
        for tex_field in ['normalTexture', 'occlusionTexture', 'emissiveTexture']:
            if tex_field in mat and 'index' in mat[tex_field]:
                kept_texture_indices.add(mat[tex_field]['index'])
                
    kept_image_indices = set()
    kept_sampler_indices = set()
    for t_idx in kept_texture_indices:
        tex = gltf['textures'][t_idx]
        if 'source' in tex:
            kept_image_indices.add(tex['source'])
        if 'sampler' in tex:
            kept_sampler_indices.add(tex['sampler'])
            
    # 5. Determine kept bufferViews
    kept_bufferview_indices = set()
    for acc_idx in kept_accessor_indices:
        acc = gltf['accessors'][acc_idx]
        if 'bufferView' in acc:
            kept_bufferview_indices.add(acc['bufferView'])
            
    for img_idx in kept_image_indices:
        img = gltf['images'][img_idx]
        if 'bufferView' in img:
            kept_bufferview_indices.add(img['bufferView'])
            
    print(f"Total bufferViews kept: {len(kept_bufferview_indices)} of {len(gltf.get('bufferViews', []))}")
    print(f"Total images kept: {len(kept_image_indices)} of {len(gltf.get('images', []))}")
    print(f"Total accessors kept: {len(kept_accessor_indices)} of {len(gltf.get('accessors', []))}")

    # 6. Rebuild buffer and bufferViews
    bv_old_to_new = {}
    new_buffer_views = []
    new_bin_bytes = bytearray()
    
    for old_bv_idx in sorted(kept_bufferview_indices):
        old_bv = copy.deepcopy(gltf['bufferViews'][old_bv_idx])
        old_offset = old_bv.get('byteOffset', 0)
        length = old_bv['byteLength']
        
        while len(new_bin_bytes) % 4 != 0:
            new_bin_bytes.append(0)
            
        new_offset = len(new_bin_bytes)
        new_bin_bytes.extend(bin_data[old_offset : old_offset + length])
        
        old_bv['buffer'] = 0
        old_bv['byteOffset'] = new_offset
        bv_old_to_new[old_bv_idx] = len(new_buffer_views)
        new_buffer_views.append(old_bv)

    while len(new_bin_bytes) % 4 != 0:
        new_bin_bytes.append(0)

    # 7. Rebuild images
    img_old_to_new = {}
    new_images = []
    for old_img_idx in sorted(kept_image_indices):
        old_img = copy.deepcopy(gltf['images'][old_img_idx])
        if 'bufferView' in old_img:
            old_img['bufferView'] = bv_old_to_new[old_img['bufferView']]
        img_old_to_new[old_img_idx] = len(new_images)
        new_images.append(old_img)

    # 8. Rebuild samplers
    samp_old_to_new = {}
    new_samplers = []
    for old_samp_idx in sorted(kept_sampler_indices):
        old_samp = copy.deepcopy(gltf['samplers'][old_samp_idx])
        samp_old_to_new[old_samp_idx] = len(new_samplers)
        new_samplers.append(old_samp)

    # 9. Rebuild textures
    tex_old_to_new = {}
    new_textures = []
    for old_tex_idx in sorted(kept_texture_indices):
        old_tex = copy.deepcopy(gltf['textures'][old_tex_idx])
        if 'source' in old_tex:
            old_tex['source'] = img_old_to_new[old_tex['source']]
        if 'sampler' in old_tex:
            old_tex['sampler'] = samp_old_to_new[old_tex['sampler']]
        tex_old_to_new[old_tex_idx] = len(new_textures)
        new_textures.append(old_tex)

    # 10. Rebuild materials
    mat_old_to_new = {}
    new_materials = []
    for old_mat_idx in sorted(kept_material_indices):
        old_mat = copy.deepcopy(gltf['materials'][old_mat_idx])
        pbr = old_mat.get('pbrMetallicRoughness', {})
        for tex_field in ['baseColorTexture', 'metallicRoughnessTexture']:
            if tex_field in pbr and 'index' in pbr[tex_field]:
                pbr[tex_field]['index'] = tex_old_to_new[pbr[tex_field]['index']]
        for tex_field in ['normalTexture', 'occlusionTexture', 'emissiveTexture']:
            if tex_field in old_mat and 'index' in old_mat[tex_field]:
                old_mat[tex_field]['index'] = tex_old_to_new[old_mat[tex_field]['index']]
        mat_old_to_new[old_mat_idx] = len(new_materials)
        new_materials.append(old_mat)

    # 11. Rebuild accessors
    acc_old_to_new = {}
    new_accessors = []
    for old_acc_idx in sorted(kept_accessor_indices):
        old_acc = copy.deepcopy(gltf['accessors'][old_acc_idx])
        if 'bufferView' in old_acc:
            old_acc['bufferView'] = bv_old_to_new[old_acc['bufferView']]
        acc_old_to_new[old_acc_idx] = len(new_accessors)
        new_accessors.append(old_acc)

    # 12. Rebuild meshes
    mesh_old_to_new = {}
    new_meshes = []
    for old_m_idx in sorted(kept_mesh_indices):
        old_m = copy.deepcopy(gltf['meshes'][old_m_idx])
        for prim in old_m['primitives']:
            for attr_name, acc_idx in list(prim['attributes'].items()):
                prim['attributes'][attr_name] = acc_old_to_new[acc_idx]
            if 'indices' in prim:
                prim['indices'] = acc_old_to_new[prim['indices']]
            if 'material' in prim:
                prim['material'] = mat_old_to_new[prim['material']]
        mesh_old_to_new[old_m_idx] = len(new_meshes)
        new_meshes.append(old_m)

    # 13. Rebuild nodes
    node_old_to_new = {}
    new_nodes = []
    for old_n_idx in sorted(kept_node_indices):
        node_old_to_new[old_n_idx] = len(new_nodes)
        new_nodes.append(None)
        
    for old_n_idx in sorted(kept_node_indices):
        old_n = copy.deepcopy(nodes[old_n_idx])
        if 'children' in old_n:
            old_n['children'] = [node_old_to_new[c] for c in old_n['children'] if c in node_old_to_new]
        if 'mesh' in old_n:
            old_n['mesh'] = mesh_old_to_new[old_n['mesh']]
        new_idx = node_old_to_new[old_n_idx]
        new_nodes[new_idx] = old_n

    # 14. Rebuild gltf object
    new_gltf = copy.deepcopy(gltf)
    new_gltf['nodes'] = new_nodes
    new_gltf['meshes'] = new_meshes
    new_gltf['accessors'] = new_accessors
    new_gltf['bufferViews'] = new_buffer_views
    new_gltf['buffers'] = [{'byteLength': len(new_bin_bytes)}]
    if new_materials:
        new_gltf['materials'] = new_materials
    elif 'materials' in new_gltf:
        del new_gltf['materials']
        
    if new_textures:
        new_gltf['textures'] = new_textures
    elif 'textures' in new_gltf:
        del new_gltf['textures']
        
    if new_images:
        new_gltf['images'] = new_images
    elif 'images' in new_gltf:
        del new_gltf['images']
        
    if new_samplers:
        new_gltf['samplers'] = new_samplers
    elif 'samplers' in new_gltf:
        del new_gltf['samplers']

    new_gltf['scenes'] = [{'name': 'Sketchfab_Scene', 'nodes': [node_old_to_new[0]]}]
    new_gltf['scene'] = 0

    # 15. Serialize to GLB
    json_bytes = json.dumps(new_gltf, separators=(',', ':')).encode('utf-8')
    while len(json_bytes) % 4 != 0:
        json_bytes += b' '
        
    total_length = 12 + 8 + len(json_bytes) + 8 + len(new_bin_bytes)
    
    header = struct.pack('<III', 0x46546C67, 2, total_length)
    json_chunk_hdr = struct.pack('<II', len(json_bytes), 0x4E4F534A)
    bin_chunk_hdr = struct.pack('<II', len(new_bin_bytes), 0x004E4942)
    
    out_data = header + json_chunk_hdr + json_bytes + bin_chunk_hdr + bytes(new_bin_bytes)
    dst_path.write_bytes(out_data)
    print(f"\nWritten {len(out_data)} bytes ({len(out_data)/1024/1024:.2f} MB) to {dst_path}")

if __name__ == '__main__':
    # Nodes defining walls, floor, and ceiling
    # Tembok: Plane.001, Plane.002, Plane.003, Cube (back wall), Cube.003 (corner wall)
    # Lantai: Plane
    # Langit-langit / Atap: Plane.004, Cube.002 (ceiling beams)
    keep_parents = {
        'Cube',         # Back wall structure
        'Cube.002',     # Ceiling beams / atap
        'Cube.003',     # Corner wall / pilar
        'Plane',        # Floor / lantai
        'Plane.001',    # Wall main
        'Plane.002',    # Wall front/window
        'Plane.003',    # Wall side
        'Plane.004'     # Ceiling / langit-langit
    }
    prune_glb(Path('models/living_room_interior_free.glb'), Path('models/living_room_clean.glb'), keep_parents)
