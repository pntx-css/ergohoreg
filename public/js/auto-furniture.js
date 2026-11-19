const AUTO_PLACEMENT_MARGIN = 0.045;
const AUTO_PLACEMENT_FLOOR_GAP = 0.015;
const AUTO_PLACEMENT_STEP = 0.18;

function classifyAutoModel(filename) {
  const name = filename.toLowerCase().replace(/[_-]+/g, ' ');
  if (/\bfloor\b|\blantai\b/.test(name)) return {type: 'floor', label: 'Floor'};
  if (/\bac\b|air conditioner|air conditioning|aircon/.test(name)) return {type: 'air-conditioner', label: 'Air Conditioner'};
  if (/ceiling.?(lamp|light)|chandelier|pendant|hanging|plafon|\blampu\b/.test(name)) return {type: 'ceiling-lamp', label: 'Ceiling Lamp'};
  if (/light.?switch|switch|saklar/.test(name)) return {type: 'switch', label: 'Light Switch'};
  if (/door|pintu/.test(name)) return {type: 'door', label: 'Door'};
  if (/speaker|soundbar|audio/.test(name)) {
    return /duo|pair|set|twin/.test(name)
      ? {type: 'speaker-pair', label: 'Speaker pair'}
      : {type: 'speaker', label: 'Speaker'};
  }
  if (/air purifier|air cleaner|aircleaner|purifier/.test(name)) return {type: 'purifier', label: 'Air Purifier'};
  if (/sofa|couch|loveseat/.test(name)) return {type: 'sofa', label: 'Sofa'};
  if (/rug|carpet/.test(name)) return {type: 'rug', label: 'Rug'};
  if (/lamp|floor light|standing light/.test(name)) return {type: 'lamp', label: 'Lamp'};
  if (/tv stand|tv bench|tv table|tv console|meja tv/.test(name)) return {type: 'tv-stand', label: 'TV stand'};
  if (/table|meja|coffee table/.test(name)) return {type: 'table', label: 'Table'};
  if (/chair|armchair|recliner/.test(name)) return {type: 'chair', label: 'Chair'};
  if (/cabinet|console|shelf|rak/.test(name)) return {type: 'cabinet', label: 'Cabinet'};
  if (/\btv\b|television|monitor|display/.test(name)) return {type: 'tv', label: 'TV'};
  return {type: 'generic', label: 'Furniture'};
}

function autoModelPriority(type) {
  return ({floor: -1, 'tv-stand': 0, tv: 1, sofa: 2, rug: 3, 'speaker-pair': 4, speaker: 4, table: 5, cabinet: 6, chair: 7, lamp: 8, purifier: 9, door: 10, switch: 11, generic: 12, 'air-conditioner': 13, 'ceiling-lamp': 14})[type] ?? 15;
}

function vectorData(vector, digits = 3) {
  return {
    x: Number(vector.x.toFixed(digits)),
    y: Number(vector.y.toFixed(digits)),
    z: Number(vector.z.toFixed(digits))
  };
}

AFRAME.registerComponent('auto-furniture-loader', {
  init() {
    this.scene = this.el;
    this.catalog = window.LivingRoomModelCatalog || [];
    this.catalogReady = !!window.LivingRoomModelCatalogReady;
    this.started = false;
    this.loading = false;
    this.queue = [];
    this.seenPaths = new Set();
    this.speakerPairSupport = new Map();
    this.placedModels = [];
    this.size = new THREE.Vector3();
    this.shell = null;

    this.onCatalogReady = () => {
      this.catalog = window.LivingRoomModelCatalog || [];
      this.catalogReady = true;
      if (this.started) {
        this.enqueueCatalog(this.catalog);
        this.loadNextModel();
      }
    };
    window.addEventListener('living-room-model-catalog-ready', this.onCatalogReady);
  },

  tick() {
    if (this.started || !this.catalogReady) return;
    const shell = this.scene.components['room-shell'];
    const editor = this.scene.components['furniture-editor'];
    if (!shell?.collisionReady || !editor?.furnitureInitialized) return;

    this.shell = shell;
    this.started = true;
    this.enqueueCatalog(this.catalog);
    if (!this.queue.length) {
      console.info('[Models] No eligible .glb files found in models/.');
      return;
    }
    console.info('[Models] Automatic furniture placement started.', {
      files: [...this.seenPaths]
    });
    this.loadNextModel();
  },

  enqueueCatalog(catalog) {
    const fresh = [];
    for (const model of catalog) {
      if (!model?.path || !model?.url || this.seenPaths.has(model.path)) continue;
      const role = classifyAutoModel(model.filename || model.path);
      this.seenPaths.add(model.path);
      if (role.type === 'speaker' || role.type === 'speaker-pair') {
        const pairModel = role.type === 'speaker-pair';
        const speakerRole = {type: 'speaker', label: 'Speaker'};
        fresh.push(
          {...model, role: speakerRole, speakerPairPart: pairModel, instanceName: `${model.filename} (Left)`, side: 'left'},
          {...model, role: speakerRole, speakerPairPart: pairModel, instanceName: `${model.filename} (Right)`, side: 'right'}
        );
      } else {
        fresh.push({...model, role, instanceName: model.filename, side: null});
      }
    }
    fresh.sort((left, right) => autoModelPriority(left.role.type) - autoModelPriority(right.role.type) || left.filename.localeCompare(right.filename));
    this.queue.push(...fresh);
  },

  loadNextModel() {
    if (!this.started || this.loading) return;
    const descriptor = this.queue.shift();
    if (!descriptor) {
      console.info('[Models] Automatic placement complete.', {placed: this.placedModels.length});
      return;
    }

    const entity = document.createElement('a-entity');
    entity.id = this.makeEntityId(descriptor);
    entity.classList.add('auto-placed-model');
    this.setModelIdentity(entity, descriptor);
    entity.object3D.position.set(0, 0, 0);
    entity.object3D.rotation.set(0, 0, 0);
    entity.object3D.scale.set(1, 1, 1);
    this.scene.appendChild(entity);

    this.loading = true;
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timeout);
      entity.removeEventListener('model-loaded', onLoaded);
      entity.removeEventListener('model-error', onFailed);
      return true;
    };
    const onLoaded = () => {
      if (!finish()) return;
      try {
        this.placeLoadedModel(entity, descriptor);
      } catch (error) {
        console.error('Model Failed To Load', {
          modelName: descriptor.instanceName,
          path: descriptor.path,
          cause: error
        });
        entity.remove();
      }
      this.loading = false;
      this.loadNextModel();
    };
    const onFailed = event => {
      if (!finish()) return;
      console.error('Model Failed To Load', {
        modelName: descriptor.instanceName,
        path: descriptor.path,
        cause: event.detail?.message || event.detail?.src || event.detail || 'Unknown GLB loading error'
      });
      entity.remove();
      this.loading = false;
      this.loadNextModel();
    };
    const timeout = setTimeout(() => onFailed({detail: {message: 'Loading timed out after 30 seconds.'}}), 30000);
    entity.addEventListener('model-loaded', onLoaded);
    entity.addEventListener('model-error', onFailed);
    entity.setAttribute('gltf-model', descriptor.url);
  },

  makeEntityId(descriptor) {
    const {type} = descriptor.role;
    if (type === 'tv') return 'tv';
    if (type === 'tv-stand') return 'meja_tv';
    if (type === 'sofa') return 'sofa';
    if (type === 'rug') return 'karpet';
    if (type === 'door') return 'pintu';
    if (type === 'switch') return 'saklar';
    if (type === 'ceiling-lamp') return 'lampugantung';
    if (type === 'air-conditioner') return 'ac';
    // The source is a stereo pair, so each physical speaker needs its own DOM ID.
    if (type === 'speaker' || type === 'speaker-pair') return descriptor.side === 'right' ? 'speaker_kanan' : 'speaker_kiri';

    const slug = descriptor.instanceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let id = `auto-model-${slug}`;
    let suffix = 2;
    while (document.getElementById(id)) id = `auto-model-${slug}-${suffix++}`;
    return id;
  },

  setModelIdentity(entity, descriptor) {
    const {type} = descriptor.role;
    entity.dataset.modelRole = type;
    if (type === 'tv') {
      entity.dataset.model = 'tv';
      entity.dataset.front = 'local +Z (menghadap ke area sofa)';
      entity.dataset.back = 'local -Z (menghadap dinding belakang)';
    } else if (type === 'tv-stand') {
      entity.dataset.model = 'meja_tv';
      entity.dataset.front = 'local -X (menghadap ke area sofa)';
      entity.dataset.back = 'local +X (menghadap dinding belakang)';
    } else if (type === 'speaker' || type === 'speaker-pair') {
      entity.dataset.model = 'speaker';
      entity.dataset.front = 'menghadap ke area sofa';
      entity.dataset.back = 'membelakangi area sofa';
    }
  },

  getModelBox(entity) {
    const root = entity.getObject3D('mesh');
    if (!root) throw new Error('GLB loaded without a mesh object.');
    this.scene.object3D.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) throw new Error('GLB mesh has an empty bounding box.');
    return box;
  },

  meshCount(object) {
    let count = 0;
    object.traverse(child => { if (child.isMesh) count++; });
    return count;
  },

  findSpeakerBranches(root) {
    let match = null;
    const visit = object => {
      const branches = object.children.filter(child => this.meshCount(child) > 0);
      if (branches.length === 2) {
        const counts = branches.map(branch => this.meshCount(branch));
        if (Math.min(...counts) >= 2 && Math.abs(counts[0] - counts[1]) <= Math.max(...counts) * 0.15) match = branches;
      }
      for (const child of object.children) visit(child);
    };
    visit(root);
    return match;
  },

  keepSpeakerBranch(entity, side) {
    const root = entity.getObject3D('mesh');
    if (!root) return false;
    this.scene.object3D.updateMatrixWorld(true);
    const branches = this.findSpeakerBranches(root);
    if (!branches) return false;

    const selected = branches[side === 'right' ? 1 : 0];
    const localMatrix = root.matrixWorld.clone().invert().multiply(selected.matrixWorld.clone());
    for (const branch of branches) if (branch !== selected) branch.removeFromParent();
    selected.removeFromParent();
    localMatrix.decompose(selected.position, selected.quaternion, selected.scale);
    selected.updateMatrix();
    root.add(selected);
    this.scene.object3D.updateMatrixWorld(true);
    return true;
  },

  fitModelScale(entity, role, box) {
    box.getSize(this.size);
    const horizontalWidth = Math.max(this.size.x, this.size.z);
    const horizontalDepth = Math.min(this.size.x, this.size.z);
    const targets = {
      tv: {width: 1.55, depth: 0.42, height: 1.0},
      'tv-stand': {width: 1.65, depth: 0.58, height: 0.62},
      'speaker-pair': {width: 1.45, depth: 0.62, height: 0.82},
      speaker: {width: 0.55, depth: 0.52, height: 0.9},
      sofa: {width: 2.3, depth: 1.2, height: 1.12},
      rug: {width: 10 / 3, depth: 34 / 15, height: 0.06},
      door: {width: 1.18, depth: 0.34, height: 2.3},
      table: {width: 1.2, depth: 0.82, height: 0.62},
      lamp: {width: 0.48, depth: 0.48, height: 1.72},
      'ceiling-lamp': {width: 1.55, depth: 1.55, height: 1.1},
      purifier: {width: 0.48, depth: 0.48, height: 1.0},
      'air-conditioner': {width: 1.0, depth: 0.34, height: 0.36},
      switch: {width: 0.42, depth: 0.07, height: 0.2625},
      cabinet: {width: 1.25, depth: 0.6, height: 1.65},
      chair: {width: 0.82, depth: 0.82, height: 1.05},
      generic: {width: 1.15, depth: 1.15, height: 1.35}
    }[role.type];
    const ratios = [
      horizontalWidth > 0.00001 ? targets.width / horizontalWidth : Infinity,
      horizontalDepth > 0.00001 ? targets.depth / horizontalDepth : Infinity,
      this.size.y > 0.00001 ? targets.height / this.size.y : Infinity
    ].filter(Number.isFinite);
    if (!ratios.length) throw new Error('GLB dimensions are zero or invalid.');
    const factor = Math.min(...ratios);
    if (!Number.isFinite(factor) || factor <= 0) throw new Error('Could not calculate a positive model scale.');
    entity.object3D.scale.setScalar(factor);
    this.scene.object3D.updateMatrixWorld(true);
    let fittedBox = this.getModelBox(entity);
    if (role.type === 'tv-stand') {
      fittedBox.getSize(this.size);
      const widthAxis = this.size.x >= this.size.z ? 'x' : 'z';
      entity.object3D.scale[widthAxis] *= 1.3;
      this.scene.object3D.updateMatrixWorld(true);
      fittedBox = this.getModelBox(entity);
      fittedBox.getSize(this.size);
      console.info('[Models] TV stand width increased by 30%.', {
        dimensions: {width: Number(Math.max(this.size.x, this.size.z).toFixed(3)), height: Number(this.size.y.toFixed(3)), length: Number(Math.min(this.size.x, this.size.z).toFixed(3))}
      });
    }
    fittedBox.getSize(this.size);
    return fittedBox;
  },

  getRoom() {
    const room = window.LivingRoom?.layout;
    if (!room) throw new Error('Living Room dimensions are unavailable.');
    return room;
  },

  getFloorY() {
    return Math.max(0, this.getRoom().floorY);
  },

  getPlacedModel(type) {
    return this.placedModels.find(item => item.role.type === type) || null;
  },

  boxCenter(box) {
    return box.getCenter(new THREE.Vector3());
  },

  preferredYaw(item) {
    if (item.role.type === 'door') return -Math.PI / 2;
    if (item.role.type === 'switch') return Math.PI;
    if (item.role.type === 'air-conditioner') return Math.PI / 2;
    if (item.role.type === 'sofa') return -Math.PI / 2;
    if (item.role.type === 'rug') return -Math.PI / 2;
    // Rotate the speaker and TV stand on the horizontal (Y) axis.
    if (item.role.type === 'tv-stand') return -Math.PI / 2;
    if (item.role.type === 'speaker' || item.role.type === 'speaker-pair') return -Math.PI / 2;
    if (item.role.type === 'tv') return 0;
    if (item.role.type === 'chair') return Math.PI;
    if (item.role.type === 'cabinet') return -Math.PI / 2;
    return 0;
  },

  preferredCenter(item, box) {
    const room = this.getRoom();
    const size = box.getSize(new THREE.Vector3());
    const sofa = this.getPlacedModel('sofa');
    const tv = this.getPlacedModel('tv');
    const tvStand = this.getPlacedModel('tv-stand');
    const sofaBox = sofa?.bounds;
    const tvBox = tv?.bounds;
    const roomCenterX = (room.inside.minX + room.inside.maxX) / 2;
    const roomCenterZ = (room.inside.minZ + room.inside.maxZ) / 2;
    const backZ = room.inside.minZ;

    switch (item.role.type) {
      case 'tv':
        if (tvStand) {
          const standCenter = this.boxCenter(tvStand.bounds);
          return new THREE.Vector3(standCenter.x, this.getFloorY(), standCenter.z);
        }
        return new THREE.Vector3(roomCenterX, this.getFloorY(), backZ + size.z / 2 + 0.08);
      case 'tv-stand':
        return new THREE.Vector3(roomCenterX, this.getFloorY(), backZ + size.z / 2 + 0.08);
      case 'speaker-pair':
        return new THREE.Vector3(roomCenterX, this.getFloorY(), tvBox ? this.boxCenter(tvBox).z : backZ + 0.5);
      case 'speaker': {
        const sideSign = item.side === 'left' ? -1 : 1;
        const tvCenter = tvBox ? this.boxCenter(tvBox) : new THREE.Vector3(roomCenterX, this.getFloorY(), backZ + 0.5);
        const speakerWidth = Math.max(size.x, size.z);
        const standBox = tvStand?.bounds;
        const tvWidth = tvBox ? Math.max(tvBox.max.x - tvBox.min.x, tvBox.max.z - tvBox.min.z) : 1.55;
        const standWidth = standBox ? Math.max(standBox.max.x - standBox.min.x, standBox.max.z - standBox.min.z) : 0;
        const systemWidth = Math.max(tvWidth, standWidth);
        const x = tvCenter.x + sideSign * (systemWidth / 2 + speakerWidth / 2 + 0.12);
        return new THREE.Vector3(x, this.getFloorY(), tvCenter.z);
      }
      case 'sofa':
        return new THREE.Vector3(0.128, this.getFloorY(), -0.179);
      case 'door': {
        const center = box.getCenter(new THREE.Vector3());
        const wallX = room.inside.maxX;
        const thickness = box.max.x - box.min.x;
        return new THREE.Vector3(wallX + thickness * 0.63 - box.max.x + center.x, this.getFloorY(), 1.139 + center.z);
      }
      case 'rug': {
        const sofaCenter = sofaBox ? this.boxCenter(sofaBox) : new THREE.Vector3(0.128, this.getFloorY(), -0.179);
        const tvStandCenter = tvStand ? this.boxCenter(tvStand.bounds) : new THREE.Vector3(roomCenterX, this.getFloorY(), backZ + size.z / 2 + 0.08);
        return new THREE.Vector3(
          (sofaCenter.x + tvStandCenter.x) / 2,
          this.getFloorY(),
          (sofaCenter.z + tvStandCenter.z) / 2
        );
      }
      case 'table': {
        const z = sofaBox ? sofaBox.max.z + size.z / 2 + 0.35 : roomCenterZ - 0.55;
        const x = sofaBox ? this.boxCenter(sofaBox).x : roomCenterX;
        return new THREE.Vector3(x, this.getFloorY(), z);
      }
      case 'lamp': {
        if (sofaBox) return new THREE.Vector3(sofaBox.min.x - size.x / 2 - 0.18, this.getFloorY(), this.boxCenter(sofaBox).z);
        return new THREE.Vector3(room.inside.minX + size.x / 2 + 0.22, this.getFloorY(), backZ + size.z / 2 + 0.5);
      }
      case 'purifier':
        return new THREE.Vector3(room.inside.maxX - size.x / 2 - 0.16, this.getFloorY(), backZ + size.z / 2 + 0.16);
      case 'cabinet':
        return new THREE.Vector3(room.inside.minX + size.x / 2 + 0.16, this.getFloorY(), roomCenterZ);
      case 'chair': {
        if (sofaBox) return new THREE.Vector3(sofaBox.max.x + size.x / 2 + 0.35, this.getFloorY(), this.boxCenter(sofaBox).z + size.z * 0.25);
        return new THREE.Vector3(roomCenterX + 1.1, this.getFloorY(), roomCenterZ - 0.7);
      }
      default:
        return new THREE.Vector3(roomCenterX, this.getFloorY(), roomCenterZ);
    }
  },

  candidateBox(baseBox, centerX, centerZ, baseY = this.getFloorY(), floorGap = AUTO_PLACEMENT_FLOOR_GAP) {
    const center = baseBox.getCenter(new THREE.Vector3());
    const delta = new THREE.Vector3(
      centerX - center.x,
      baseY + floorGap - baseBox.min.y,
      centerZ - center.z
    );
    return {box: baseBox.clone().translate(delta), delta};
  },

  collidesWithBox(box, collider) {
    if (!Number.isFinite(collider.minX) || !Number.isFinite(collider.maxX)) return false;
    const verticalOverlap = Math.min(box.max.y, collider.maxY) - Math.max(box.min.y, collider.minY);
    const xOverlap = Math.min(box.max.x, collider.maxX) - Math.max(box.min.x, collider.minX);
    const zOverlap = Math.min(box.max.z, collider.maxZ) - Math.max(box.min.z, collider.minZ);
    return verticalOverlap > 0.02 && xOverlap > 0.025 && zOverlap > 0.025;
  },

  fitFloorScale(entity, box) {
    const room = this.getRoom().inside;
    box.getSize(this.size);
    if (this.size.x <= 0.00001 || this.size.z <= 0.00001) {
      throw new Error('Floor GLB must contain a measurable horizontal surface.');
    }
    entity.object3D.scale.x *= (room.maxX - room.minX - 0.04) / this.size.x;
    entity.object3D.scale.z *= (room.maxZ - room.minZ - 0.04) / this.size.z;
    this.scene.object3D.updateMatrixWorld(true);
    return this.getModelBox(entity);
  },

  placeFloorModel(box) {
    const room = this.getRoom().inside;
    const center = box.getCenter(new THREE.Vector3());
    const delta = new THREE.Vector3(
      (room.minX + room.maxX) / 2 - center.x,
      0.005 - center.y,
      (room.minZ + room.maxZ) / 2 - center.z
    );
    return {box: box.clone().translate(delta), delta};
  },

  placeAirConditioner(entity) {
    const room = this.getRoom().inside;
    const center = new THREE.Vector3(
      (room.minX + room.maxX) / 2,
      2.85,
      (room.minZ + room.maxZ) / 2
    );
    const walls = [
      {side: 'left', yaw: Math.PI / 2, normal: 'x', direction: 1},
      {side: 'right', yaw: -Math.PI / 2, normal: 'x', direction: -1},
      {side: 'back', yaw: 0, normal: 'z', direction: 1},
      {side: 'front', yaw: Math.PI, normal: 'z', direction: -1}
    ];

    for (const wall of walls) {
      entity.object3D.rotation.set(0, wall.yaw, 0);
      this.scene.object3D.updateMatrixWorld(true);
      const orientedBox = this.getModelBox(entity);
      const size = orientedBox.getSize(new THREE.Vector3());
      const centerAxis = wall.normal === 'x' ? 'z' : 'x';
      const min = room[`min${centerAxis.toUpperCase()}`];
      const max = room[`max${centerAxis.toUpperCase()}`];
      const halfSpan = size[centerAxis] / 2;
      const candidateCenters = [];
      for (let offset = 0; offset <= max - min; offset += 0.2) {
        const offsets = offset === 0 ? [0] : [-offset, offset];
        for (const value of offsets) {
          const candidate = center[centerAxis] + value;
          if (candidate >= min + halfSpan + 0.08 && candidate <= max - halfSpan - 0.08) {
            candidateCenters.push(candidate);
          }
        }
      }

      for (const wallCenter of candidateCenters) {
        const boxCenter = orientedBox.getCenter(new THREE.Vector3());
        const delta = new THREE.Vector3();
        delta[centerAxis] = wallCenter - boxCenter[centerAxis];
        delta.y = center.y - boxCenter.y;
        if (wall.normal === 'x') {
          const targetX = wall.direction > 0 ? room.minX + 0.02 : room.maxX - 0.02;
          delta.x = wall.direction > 0 ? targetX - orientedBox.min.x : targetX - orientedBox.max.x;
        } else {
          const targetZ = wall.direction > 0 ? room.minZ + 0.02 : room.maxZ - 0.02;
          delta.z = wall.direction > 0 ? targetZ - orientedBox.min.z : targetZ - orientedBox.max.z;
        }

        const candidateBox = orientedBox.clone().translate(delta);
        const withinRoom = candidateBox.min.x >= room.minX && candidateBox.max.x <= room.maxX &&
          candidateBox.min.z >= room.minZ && candidateBox.max.z <= room.maxZ &&
          candidateBox.min.y >= this.getRoom().floorY && candidateBox.max.y <= this.getRoom().ceilingY;
        if (!withinRoom) continue;

        const overlaps = this.shell.colliders.filter(collider => this.collidesWithBox(candidateBox, collider));
        if (overlaps.length) continue;
        entity.object3D.position.add(delta);
        this.scene.object3D.updateMatrixWorld(true);
        return {box: this.getModelBox(entity), wall: wall.side};
      }
    }

    throw new Error('No wall position is clear of room walls and furniture.');
  },

  placeCeilingLamp(entity, box) {
    const room = this.getRoom();
    const inside = room.inside;
    const center = box.getCenter(new THREE.Vector3());
    const delta = new THREE.Vector3(
      (inside.minX + inside.maxX) / 2 - center.x,
      room.ceilingY - 0.035 - box.max.y,
      (inside.minZ + inside.maxZ) / 2 - center.z
    );
    const candidateBox = box.clone().translate(delta);
    const penetratesCeiling = candidateBox.max.y > room.ceilingY - 0.02;
    const penetratesWallBounds = candidateBox.min.x < inside.minX + 0.015 ||
      candidateBox.max.x > inside.maxX - 0.015 ||
      candidateBox.min.z < inside.minZ + 0.015 ||
      candidateBox.max.z > inside.maxZ - 0.015;
    const overlaps = this.shell.colliders
      .filter(collider => this.collidesWithBox(candidateBox, collider))
      .map(collider => ({name: collider.name, kind: collider.kind}));
    if (penetratesCeiling || penetratesWallBounds || overlaps.length || candidateBox.min.y < 2.1) {
      console.warn('[Models] Ceiling lamp placement intersects the ceiling, a wall, or furniture.', {
        modelName: entity.id,
        penetratesCeiling,
        penetratesWallBounds,
        overlaps,
        bounds: candidateBox
      });
      throw new Error('Ceiling lamp has no safe centered ceiling placement.');
    }

    entity.object3D.position.add(delta);
    this.scene.object3D.updateMatrixWorld(true);
    return {box: this.getModelBox(entity), ceilingY: room.ceilingY};
  },

  placeLightSwitch(entity, box) {
    const room = this.getRoom();
    const door = this.getPlacedModel('door');
    const size = box.getSize(new THREE.Vector3());
    const gap = 0.15;
    const wallMargin = 0.08;
    const canPlaceAtPositiveZ = door
      ? door.bounds.max.z + size.z / 2 + gap <= room.inside.maxZ - wallMargin
      : true;
    const centerZ = door
      ? canPlaceAtPositiveZ
        ? door.bounds.max.z + size.z / 2 + gap
        : door.bounds.min.z - size.z / 2 - gap
      : room.inside.maxZ - wallMargin - size.z / 2;
    const center = box.getCenter(new THREE.Vector3());
    const delta = new THREE.Vector3(
      room.inside.maxX - box.max.x,
      1.2 - center.y,
      centerZ - center.z
    );

    entity.object3D.position.add(delta);
    this.scene.object3D.updateMatrixWorld(true);
    return {box: this.getModelBox(entity), wall: 'right'};
  },

  updateCeilingLampLighting(box) {
    const light = document.getElementById('room-light-ceiling-center');
    if (!light) {
      console.error('[Lighting] The ceiling lamp was loaded, but its point light is missing.');
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const lightY = Math.min(box.max.y - 0.2, box.min.y + 0.28);
    light.setAttribute('position', `${center.x} ${lightY} ${center.z}`);
    light.setAttribute('light', {
      type: 'point',
      color: '#ffddb3',
      intensity: 2.4,
      distance: 7,
      decay: 2,
      castShadow: false
    });
    console.info('[Lighting] Warm ceiling-lamp lighting positioned.', {
      position: vectorData(new THREE.Vector3(center.x, lightY, center.z)),
      color: '#ffddb3',
      intensity: 2.4,
      distance: 7
    });
  },

  isValidCandidate(box, item, ignoreCollider = null) {
    const room = this.getRoom();
    const inside = room.inside;
    const margin = item.role.type === 'door' ? 0 : AUTO_PLACEMENT_MARGIN;
    const boundaryTolerance = item.role.type === 'door' ? 0.002 : 0;
    if (box.min.x < inside.minX + margin - boundaryTolerance || box.max.x > inside.maxX - margin + boundaryTolerance) return false;
    if (box.min.z < inside.minZ + margin - boundaryTolerance || box.max.z > inside.maxZ - margin + boundaryTolerance) return false;
    const floorGap = item.floorGap ?? AUTO_PLACEMENT_FLOOR_GAP;
    if (box.min.y < this.getFloorY() + floorGap - 0.002 || box.max.y > room.ceilingY - AUTO_PLACEMENT_MARGIN) return false;
    return !this.shell.colliders.some(collider => collider !== item.collider && collider !== ignoreCollider && this.collidesWithBox(box, collider));
  },

  findNearestFreePosition(baseBox, desiredCenter, item) {
    const room = this.getRoom();
    const test = (x, z) => {
      const candidate = this.candidateBox(baseBox, x, z, item.baseY, item.floorGap);
      return this.isValidCandidate(candidate.box, item) ? candidate : null;
    };
    const direct = test(desiredCenter.x, desiredCenter.z);
    if (direct) return direct;

    const maxDistance = Math.hypot(room.inside.maxX - room.inside.minX, room.inside.maxZ - room.inside.minZ);
    const maxRing = Math.ceil(maxDistance / AUTO_PLACEMENT_STEP);
    for (let ring = 1; ring <= maxRing; ring++) {
      const candidates = [];
      for (let offset = -ring; offset <= ring; offset++) {
        candidates.push([offset, -ring], [offset, ring]);
        if (offset !== -ring && offset !== ring) candidates.push([-ring, offset], [ring, offset]);
      }
      candidates.sort((left, right) => Math.hypot(left[0], left[1]) - Math.hypot(right[0], right[1]));
      for (const [offsetX, offsetZ] of candidates) {
        const result = test(desiredCenter.x + offsetX * AUTO_PLACEMENT_STEP, desiredCenter.z + offsetZ * AUTO_PLACEMENT_STEP);
        if (result) return result;
      }
    }
    return null;
  },

  fitInsideRoom(entity) {
    const room = this.getRoom();
    let box = this.getModelBox(entity);
    box.getSize(this.size);
    const floorY = this.getFloorY();
    const available = {
      x: room.inside.maxX - room.inside.minX - AUTO_PLACEMENT_MARGIN * 2,
      y: room.ceilingY - floorY - AUTO_PLACEMENT_MARGIN * 2,
      z: room.inside.maxZ - room.inside.minZ - AUTO_PLACEMENT_MARGIN * 2
    };
    const factor = Math.min(
      available.x / Math.max(this.size.x, 0.00001),
      available.y / Math.max(this.size.y, 0.00001),
      available.z / Math.max(this.size.z, 0.00001),
      1
    );
    if (factor < 0.9999) {
      entity.object3D.scale.multiplyScalar(factor);
      box = this.getModelBox(entity);
      console.info('[Models] Scale automatically reduced to fit the room.', {
        modelName: entity.id,
        scale: vectorData(entity.object3D.scale)
      });
    }
    return box;
  },

  placeLoadedModel(entity, descriptor) {
    const root = entity.getObject3D('mesh');
    if (!root) throw new Error('The loader completed without a GLB mesh.');
    let role = descriptor.role;
    if (descriptor.speakerPairPart) {
      const pairSupport = this.speakerPairSupport.get(descriptor.path);
      if (pairSupport === false && descriptor.side === 'right') {
        entity.remove();
        return;
      }
      const separated = this.keepSpeakerBranch(entity, descriptor.side);
      this.speakerPairSupport.set(descriptor.path, separated);
      if (!separated) {
        if (descriptor.side === 'right') {
          entity.remove();
          return;
        }
        role = {type: 'speaker-pair', label: 'Speaker pair'};
        console.warn('[Models] Speaker pair could not be split into left/right objects; keeping it as one pair.', {path: descriptor.path});
      }
    }

    let uprightX = 0;
    if (role.type === 'speaker' || role.type === 'speaker-pair') {
      const rawBox = this.getModelBox(entity);
      const rawDimensions = rawBox.getSize(new THREE.Vector3());
      if (rawDimensions.z > rawDimensions.y * 1.5 && rawDimensions.z > rawDimensions.x * 1.5) {
        uprightX = -Math.PI / 2;
        entity.object3D.rotation.x = uprightX;
        this.scene.object3D.updateMatrixWorld(true);
      }
    }
    const tvStand = descriptor.role.type === 'tv' ? this.getPlacedModel('tv-stand') : null;
    const item = {
      entity,
      root,
      descriptor,
      role,
      side: descriptor.side,
      bounds: null,
      collider: null,
      baseY: role.type === 'tv' && tvStand ? tvStand.bounds.max.y : this.getFloorY(),
      floorGap: role.type === 'rug' ? 0 : role.type === 'door' ? 0.002 : undefined
    };
    let box = this.getModelBox(entity);
    const rawSize = box.getSize(new THREE.Vector3());
    if (item.role.type === 'floor') {
      entity.object3D.rotation.set(0, 0, 0);
      box = this.fitFloorScale(entity, box);
    } else {
      box = this.fitModelScale(entity, item.role, box);
      const yaw = this.preferredYaw(item);
      entity.object3D.rotation.order = uprightX ? 'YXZ' : 'XYZ';
      entity.object3D.rotation.set(uprightX, yaw, 0);
      this.scene.object3D.updateMatrixWorld(true);
      if (item.role.type !== 'air-conditioner') box = this.fitInsideRoom(entity);
    }

    let desired = this.preferredCenter(item, box);
    const relationalPlacement = ['tv', 'tv-stand', 'speaker', 'speaker-pair', 'sofa', 'rug', 'door'].includes(role.type);
    let placement;
    let mountedWall = null;
    if (item.role.type === 'floor') placement = this.placeFloorModel(box);
    else if (item.role.type === 'air-conditioner') {
      const mounted = this.placeAirConditioner(entity);
      box = mounted.box;
      mountedWall = mounted.wall;
      desired = this.boxCenter(box);
      entity.dataset.mountedWall = mountedWall;
      placement = {box, delta: new THREE.Vector3()};
    } else if (item.role.type === 'ceiling-lamp') {
      const mounted = this.placeCeilingLamp(entity, box);
      box = mounted.box;
      desired = this.boxCenter(box);
      entity.dataset.mountedSurface = 'ceiling';
      placement = {box, delta: new THREE.Vector3()};
    } else if (item.role.type === 'switch') {
      const mounted = this.placeLightSwitch(entity, box);
      box = mounted.box;
      desired = this.boxCenter(box);
      mountedWall = mounted.wall;
      entity.dataset.mountedWall = mountedWall;
      placement = {box, delta: new THREE.Vector3()};
    } else {
      placement = relationalPlacement
        ? this.candidateBox(box, desired.x, desired.z, item.baseY, item.floorGap)
        : this.findNearestFreePosition(box, desired, item);
    }
    let crowdScale = 1;
    while (!placement && !relationalPlacement && item.role.type !== 'air-conditioner' && crowdScale > 0.35) {
      crowdScale *= 0.85;
      entity.object3D.scale.multiplyScalar(0.85);
      box = this.fitInsideRoom(entity);
      desired = this.preferredCenter(item, box);
      placement = this.findNearestFreePosition(box, desired, item);
    }
    if (!placement) throw new Error('No collision-free position was found inside the room.');

    entity.object3D.position.add(placement.delta);
    this.scene.object3D.updateMatrixWorld(true);
    item.bounds = this.getModelBox(entity);
    item.bounds.getSize(this.size);
    const finalCenter = this.boxCenter(item.bounds);
    const relocated = Math.hypot(finalCenter.x - desired.x, finalCenter.z - desired.z) > 0.08;
    item.collider = ['floor', 'air-conditioner', 'ceiling-lamp', 'switch'].includes(item.role.type) ? null : {
      kind: 'auto-model',
      name: entity.id,
      modelName: descriptor.filename,
      modelPath: descriptor.path,
      minX: item.bounds.min.x,
      maxX: item.bounds.max.x,
      minY: item.bounds.min.y,
      maxY: item.bounds.max.y,
      minZ: item.bounds.min.z,
      maxZ: item.bounds.max.z
    };
    if (item.collider && role.type !== 'rug') this.shell.colliders.push(item.collider);
    this.placedModels.push(item);
    if (['sofa', 'tv', 'speaker'].includes(item.role.type)) {
      this.scene.components['furniture-editor']?.registerAutoFurnitureItem(item);
    }

    if (item.role.type === 'floor') {
      const oldGround = document.getElementById('ground');
      if (oldGround) oldGround.object3D.visible = false;
      const editor = this.scene.components['furniture-editor'];
      if (editor) editor.floorObject = entity;
    }
    if (item.role.type === 'ceiling-lamp') this.updateCeilingLampLighting(item.bounds);

    const rotation = entity.object3D.rotation;
    const report = {
      modelName: descriptor.instanceName,
      path: descriptor.path,
      dimensionsBeforeScale: {
        width: Number(Math.max(rawSize.x, rawSize.z).toFixed(3)),
        height: Number(rawSize.y.toFixed(3)),
        length: Number(Math.min(rawSize.x, rawSize.z).toFixed(3))
      },
      dimensionsAfterScale: {
        width: Number(Math.max(this.size.x, this.size.z).toFixed(3)),
        height: Number(this.size.y.toFixed(3)),
        length: Number(Math.min(this.size.x, this.size.z).toFixed(3))
      },
      position: vectorData(entity.object3D.position),
      rotation: {
        x: Number(THREE.MathUtils.radToDeg(rotation.x).toFixed(1)),
        y: Number(THREE.MathUtils.radToDeg(rotation.y).toFixed(1)),
        z: Number(THREE.MathUtils.radToDeg(rotation.z).toFixed(1))
      },
      scale: vectorData(entity.object3D.scale),
      collider: item.collider ? {...item.collider} : null,
      mountedWall,
      mountedSurface: item.role.type === 'ceiling-lamp' ? 'ceiling' : null
    };
    console.info('Model Loaded Successfully', {modelName: descriptor.instanceName, path: descriptor.path});
    console.info('Model Name Position Rotation Scale', report);
    if (relocated) {
      console.info('[Models] Preferred spot was occupied; nearest clear position selected.', {
        modelName: descriptor.instanceName,
        preferredCenter: vectorData(desired),
        finalCenter: vectorData(finalCenter)
      });
    }
    if (item.role.type === 'air-conditioner') {
      const overlaps = this.shell.colliders
        .filter(collider => this.collidesWithBox(item.bounds, collider))
        .map(collider => ({name: collider.name, kind: collider.kind}));
      if (overlaps.length) {
        console.warn('[Models] Air conditioner intersects a wall or furniture.', {
          modelName: descriptor.instanceName,
          overlaps
        });
      } else {
        console.info('[Models] Air conditioner wall and furniture clearance verified.', {
          modelName: descriptor.instanceName,
          wall: mountedWall
        });
      }
    } else if (item.role.type === 'ceiling-lamp') {
      console.info('[Models] Ceiling lamp ceiling and furniture clearance verified.', {
        modelName: descriptor.instanceName,
        bounds: {
          min: vectorData(item.bounds.min),
          max: vectorData(item.bounds.max)
        }
      });
    } else if (!['floor', 'switch'].includes(item.role.type) && !this.isValidCandidate(item.bounds, item)) {
      console.warn('[Models] Collision validation failed after placement.', {modelName: descriptor.instanceName, path: descriptor.path, bounds: item.bounds.clone()});
    }
  },

  remove() {
    window.removeEventListener('living-room-model-catalog-ready', this.onCatalogReady);
  }
});
