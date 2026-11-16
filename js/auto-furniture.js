const AUTO_PLACEMENT_MARGIN = 0.045;
const AUTO_PLACEMENT_FLOOR_GAP = 0.015;
const AUTO_PLACEMENT_STEP = 0.18;

function classifyAutoModel(filename) {
  const name = filename.toLowerCase().replace(/[_-]+/g, ' ');
  if (/speaker|soundbar|audio/.test(name)) {
    return /duo|pair|set|twin/.test(name)
      ? {type: 'speaker-pair', label: 'Speaker pair'}
      : {type: 'speaker', label: 'Speaker'};
  }
  if (/air purifier|air cleaner|aircleaner|purifier/.test(name)) return {type: 'purifier', label: 'Air Purifier'};
  if (/sofa|couch|loveseat/.test(name)) return {type: 'sofa', label: 'Sofa'};
  if (/lamp|floor light|standing light/.test(name)) return {type: 'lamp', label: 'Lamp'};
  if (/tv stand|tv bench|tv table|tv console|meja tv/.test(name)) return {type: 'tv-stand', label: 'TV stand'};
  if (/table|meja|coffee table/.test(name)) return {type: 'table', label: 'Table'};
  if (/chair|armchair|recliner/.test(name)) return {type: 'chair', label: 'Chair'};
  if (/cabinet|console|shelf|rak/.test(name)) return {type: 'cabinet', label: 'Cabinet'};
  if (/\btv\b|television|monitor|display/.test(name)) return {type: 'tv', label: 'TV'};
  return {type: 'generic', label: 'Furniture'};
}

function autoModelPriority(type) {
  return ({'tv-stand': 0, tv: 1, sofa: 2, 'speaker-pair': 3, speaker: 3, table: 4, cabinet: 5, chair: 6, lamp: 7, purifier: 8, generic: 9})[type] ?? 10;
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
    this.placedModels = [];
    this.size = new THREE.Vector3();
    this.direction = new THREE.Vector3();
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
      if (role.type === 'speaker') {
        fresh.push(
          {...model, role, instanceName: `${model.filename} (Left)`, side: 'left'},
          {...model, role, instanceName: `${model.filename} (Right)`, side: 'right'}
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
    entity.id = this.makeEntityId(descriptor.instanceName);
    entity.classList.add('auto-placed-model');
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

  makeEntityId(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let id = `auto-model-${slug}`;
    let suffix = 2;
    while (document.getElementById(id)) id = `auto-model-${slug}-${suffix++}`;
    return id;
  },

  getModelBox(entity) {
    const root = entity.getObject3D('mesh');
    if (!root) throw new Error('GLB loaded without a mesh object.');
    this.scene.object3D.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) throw new Error('GLB mesh has an empty bounding box.');
    return box;
  },

  fitModelScale(entity, role, box) {
    box.getSize(this.size);
    const horizontalWidth = Math.max(this.size.x, this.size.z);
    const horizontalDepth = Math.min(this.size.x, this.size.z);
    const targets = {
      tv: {width: 1.55, depth: 0.42, height: 1.0},
      'tv-stand': {width: 1.65, depth: 0.58, height: 0.62},
      'speaker-pair': {width: 1.45, depth: 0.62, height: 0.82},
      speaker: {width: 0.5, depth: 0.48, height: 0.78},
      sofa: {width: 2.3, depth: 1.2, height: 1.12},
      table: {width: 1.2, depth: 0.82, height: 0.62},
      lamp: {width: 0.48, depth: 0.48, height: 1.72},
      purifier: {width: 0.48, depth: 0.48, height: 1.0},
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
    const fittedBox = this.getModelBox(entity);
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
    const room = this.getRoom();
    const box = this.getModelBox(item.entity);
    if (item.role.type === 'sofa') return Math.PI;
    if (item.role.type === 'tv' || item.role.type === 'tv-stand' || item.role.type === 'speaker-pair') return 0;
    if (item.role.type === 'speaker') {
      const sofa = this.getPlacedModel('sofa');
      const target = sofa ? this.boxCenter(sofa.bounds) : new THREE.Vector3(0, this.getFloorY(), room.inside.minZ + 1.2);
      const preferred = this.preferredCenter(item, box);
      this.direction.set(target.x - preferred.x, 0, target.z - preferred.z);
      return Math.atan2(-this.direction.x, -this.direction.z);
    }
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
    const frontZ = room.inside.maxZ;
    const backZ = room.inside.minZ;

    switch (item.role.type) {
      case 'tv':
        if (tvStand) {
          const standCenter = this.boxCenter(tvStand.bounds);
          const standDepth = tvStand.bounds.max.z - tvStand.bounds.min.z;
          return new THREE.Vector3(standCenter.x, this.getFloorY(), standCenter.z - (standDepth - size.z) / 2);
        }
        return new THREE.Vector3(roomCenterX, this.getFloorY(), frontZ - size.z / 2 - 0.12);
      case 'tv-stand':
        return new THREE.Vector3(roomCenterX, this.getFloorY(), frontZ - size.z / 2 - 0.12);
      case 'speaker-pair':
        return new THREE.Vector3(roomCenterX, this.getFloorY(), (tvBox ? tvBox.min.z : frontZ - 0.35) - size.z / 2 - 0.12);
      case 'speaker': {
        const sideSign = item.side === 'left' ? -1 : 1;
        const tvCenter = tvBox ? this.boxCenter(tvBox) : new THREE.Vector3(roomCenterX, this.getFloorY(), frontZ - 0.2);
        const speakerWidth = Math.max(size.x, size.z);
        const tvWidth = tvBox ? Math.max(tvBox.max.x - tvBox.min.x, tvBox.max.z - tvBox.min.z) : 1.55;
        const x = tvCenter.x + sideSign * (tvWidth / 2 + speakerWidth / 2 + 0.09);
        return new THREE.Vector3(x, this.getFloorY(), tvCenter.z);
      }
      case 'sofa':
        return new THREE.Vector3(roomCenterX, this.getFloorY(), backZ + size.z / 2 + 0.28);
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

  candidateBox(baseBox, centerX, centerZ) {
    const center = baseBox.getCenter(new THREE.Vector3());
    const delta = new THREE.Vector3(
      centerX - center.x,
      (this.activeItem?.baseY ?? this.getFloorY()) + AUTO_PLACEMENT_FLOOR_GAP - baseBox.min.y,
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

  isValidCandidate(box, item) {
    const room = this.getRoom();
    const inside = room.inside;
    if (box.min.x < inside.minX + AUTO_PLACEMENT_MARGIN || box.max.x > inside.maxX - AUTO_PLACEMENT_MARGIN) return false;
    if (box.min.z < inside.minZ + AUTO_PLACEMENT_MARGIN || box.max.z > inside.maxZ - AUTO_PLACEMENT_MARGIN) return false;
    if (box.min.y < this.getFloorY() + AUTO_PLACEMENT_FLOOR_GAP - 0.002 || box.max.y > room.ceilingY - AUTO_PLACEMENT_MARGIN) return false;
    return !this.shell.colliders.some(collider => collider !== item.collider && this.collidesWithBox(box, collider));
  },

  findNearestFreePosition(baseBox, desiredCenter, item) {
    const room = this.getRoom();
    const test = (x, z) => {
      const candidate = this.candidateBox(baseBox, x, z);
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
    const tvStand = descriptor.role.type === 'tv' ? this.getPlacedModel('tv-stand') : null;
    const item = {
      entity,
      root,
      descriptor,
      role: descriptor.role,
      side: descriptor.side,
      bounds: null,
      collider: null,
      baseY: tvStand ? tvStand.bounds.max.y : this.getFloorY()
    };
    let box = this.getModelBox(entity);
    const rawSize = box.getSize(new THREE.Vector3());
    box = this.fitModelScale(entity, item.role, box);
    const yaw = this.preferredYaw(item);
    entity.object3D.rotation.set(0, yaw, 0);
    this.scene.object3D.updateMatrixWorld(true);
    box = this.fitInsideRoom(entity);

    this.activeItem = item;
    let desired = this.preferredCenter(item, box);
    let placement = this.findNearestFreePosition(box, desired, item);
    let crowdScale = 1;
    while (!placement && crowdScale > 0.35) {
      crowdScale *= 0.85;
      entity.object3D.scale.multiplyScalar(0.85);
      box = this.fitInsideRoom(entity);
      desired = this.preferredCenter(item, box);
      placement = this.findNearestFreePosition(box, desired, item);
    }
    this.activeItem = null;
    if (!placement) throw new Error('No collision-free position was found inside the room.');

    entity.object3D.position.add(placement.delta);
    this.scene.object3D.updateMatrixWorld(true);
    item.bounds = this.getModelBox(entity);
    item.bounds.getSize(this.size);
    const finalCenter = this.boxCenter(item.bounds);
    const relocated = Math.hypot(finalCenter.x - desired.x, finalCenter.z - desired.z) > 0.08;
    item.collider = {
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
    this.shell.colliders.push(item.collider);
    this.placedModels.push(item);

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
      collider: {...item.collider}
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
    if (!this.isValidCandidate(item.bounds, item)) {
      console.warn('[Models] Collision validation failed after placement.', {modelName: descriptor.instanceName, path: descriptor.path, bounds: item.bounds.clone()});
    }
  },

  remove() {
    window.removeEventListener('living-room-model-catalog-ready', this.onCatalogReady);
  }
});
