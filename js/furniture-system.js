const FURNITURE_GRID = 0.1;
const FURNITURE_CLEARANCE = 0.035;
const FURNITURE_FLOOR_Y = 0;
// Approximate TV console top height measured in the current room scene.
const TV_STAND_TOP_Y = 0.48;

function furnitureRole(part) {
  const {minX, maxX, minY, maxY, minZ, maxZ} = part.bounds;
  const width = maxX - minX;
  const height = maxY - minY;
  const depth = maxZ - minZ;
  const source = part.source.toLowerCase();

  // Tall/broad room structure or ceiling beams remain static.
  if (minY > 2.5 || (height > 3.2 && width > 2)) return {role: 'structure', label: 'Struktur ruangan'};
  if (width > 2.2 && depth > 0.85 && height < 1.35) return {role: 'sofa', label: 'Sofa'};
  if (source.includes('material001_material009')) {
    return height > 1.7
      ? {role: 'cabinet', label: 'Lemari'}
      : {role: 'tv', label: 'TV dan console'};
  }
  if (source.includes('material_material004')) {
    return width > 2.2
      ? {role: 'sofa', label: 'Sofa'}
      : {role: 'table', label: 'Meja'};
  }
  if (source.includes('material002_material011') && depth > 1.2 && height < 0.7) return {role: 'decor', label: 'Furnitur samping'};
  if (source.includes('material003_material012') && height > 1.8) return {role: 'lamp', label: 'Lampu'};
  if (source.includes('material003_material012') && minX > 0 && minZ > 1.5 && height > 1) {
    return {role: 'airPurifier', label: 'Air Purifier'};
  }
  if (source.includes('material001_material009')) return {role: 'cabinet', label: 'Lemari'};
  if (source.includes('material002_material011')) return {role: 'decor', label: 'Dekorasi'};
  if (source.includes('material003_material012')) return {role: 'decor', label: 'Dekorasi'};
  return {role: 'furniture', label: 'Furnitur'};
}

function cloneMaterials(material) {
  return Array.isArray(material) ? material.map(item => item.clone()) : material.clone();
}

function triangleMaterialIndex(geometry, triangleId) {
  const start = triangleId * 3;
  const group = geometry.groups.find(item => start >= item.start && start < item.start + item.count);
  return group?.materialIndex || 0;
}

function geometryFromTriangles(sourceGeometry, triangleIds, matrix = null, pivot = null) {
  const geometry = sourceGeometry.clone();
  if (matrix) geometry.applyMatrix4(matrix);
  if (pivot) geometry.translate(-pivot.x, -pivot.y, -pivot.z);

  const sourceIndex = sourceGeometry.index?.array;
  const indices = [];
  const groupRuns = [];
  let runMaterial = null;
  let runStart = 0;
  let runCount = 0;
  for (const triangleId of triangleIds) {
    const offset = triangleId * 3;
    const materialIndex = triangleMaterialIndex(sourceGeometry, triangleId);
    if (runMaterial !== null && materialIndex !== runMaterial) {
      groupRuns.push({start: runStart, count: runCount, materialIndex: runMaterial});
      runStart += runCount;
      runCount = 0;
    }
    runMaterial = materialIndex;
    for (let corner = 0; corner < 3; corner++) indices.push(sourceIndex ? sourceIndex[offset + corner] : offset + corner);
    runCount += 3;
  }
  if (runCount) groupRuns.push({start: runStart, count: runCount, materialIndex: runMaterial || 0});

  geometry.setIndex(indices);
  geometry.clearGroups();
  for (const group of groupRuns) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function collisionPairKey(left, right) {
  const leftId = left.itemId || left.name;
  const rightId = right.itemId || right.name;
  return [leftId, rightId].sort().join('|');
}

AFRAME.registerComponent('furniture-editor', {
  init() {
    this.scene = this.el;
    this.camera = null;
    this.rig = null;
    this.shell = null;
    this.ready = false;
    this.furnitureInitialized = false;
    this.speakersInitialized = false;
    this.items = [];
    this.initialOverlapAllowances = new Map();
    this.grabbedItem = null;
    this.nearbyItem = null;
    this.cameraPosition = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.lastHint = '';
    this.lastButtonLabel = '';
    this.lastGrabMoveKey = '';
    this.lastFloorRayHit = false;
    this.crosshair = document.getElementById('crosshair');
    this.debugPanel = document.getElementById('collision-debug-panel');
    this.debugMode = new URLSearchParams(location.search).get('collisionDebug') === '1' ||
      new URLSearchParams(location.search).get('wallDebug') === '1';
    this.overlapDebugHelpers = [];
    this.speakerModelLogged = false;
    this.speakerModelFailed = false;
    this.raycaster = new THREE.Raycaster();
    this.floorRaycaster = new THREE.Raycaster();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FURNITURE_FLOOR_Y);
    this.floorHitPoint = new THREE.Vector3();
    this.floorObject = document.getElementById('ground');
    this.fPopup = document.getElementById('f-interaction-popup');
    this.fPopupContent = document.getElementById('f-interaction-content');
    this.fPopupClose = document.getElementById('f-interaction-close');
    this.fPopupHadPointerLock = false;
    this.onFPopupClose = () => {
      if (this.fPopup) this.fPopup.hidden = true;
      if (!this.fPopupHadPointerLock) return;
      this.fPopupHadPointerLock = false;
      const desktopController = this.rig?.components['fps-controls']?.desktopController;
      if (desktopController) desktopController.requestPointerLock();
    };
    this.onPopupBackdropClick = event => {
      if (event.target === this.fPopup) this.onFPopupClose();
    };
    this.onPopupKeyDown = event => {
      if (event.key === 'Escape' && this.fPopup && !this.fPopup.hidden) {
        event.preventDefault();
        this.onFPopupClose();
      }
    };
    this.fPopupClose?.addEventListener('click', this.onFPopupClose);
    this.fPopup?.addEventListener('click', this.onPopupBackdropClick);
    window.addEventListener('keydown', this.onPopupKeyDown);
    this.vrButtonState = {grab: false, left: false, right: false, up: false, down: false};
    this.preview = document.createElement('a-box');
    this.preview.id = 'furniture-placement-preview';
    this.preview.setAttribute('visible', false);
    this.preview.setAttribute('material', 'color: #42e875; wireframe: true; transparent: true; opacity: 0.95; depthTest: false');
    this.scene.appendChild(this.preview);
    this.placementMarker = document.createElement('a-ring');
    this.placementMarker.id = 'placement-floor-marker';
    this.placementMarker.setAttribute('rotation', '-90 0 0');
    this.placementMarker.setAttribute('radius-inner', '0.2');
    this.placementMarker.setAttribute('radius-outer', '0.29');
    this.placementMarker.setAttribute('material', 'color: #42e875; shader: flat; transparent: true; opacity: 0.95; depthTest: false; depthWrite: false');
    this.placementMarker.setAttribute('visible', false);
    this.scene.appendChild(this.placementMarker);

    const speakerTemplate = document.getElementById('speaker-template');
    this.onSpeakerModelLoaded = () => {
      if (this.speakerModelLogged) return;
      this.speakerModelLogged = true;
      console.info('[LivingRoom] Speaker model loaded.', {
        path: document.getElementById('speaker-model')?.getAttribute('src') || './models/speaker_heads.glb'
      });
    };
    this.onSpeakerModelError = event => {
      this.speakerModelFailed = true;
      console.error('[LivingRoom] Speaker model failed to load.', {
        path: document.getElementById('speaker-model')?.getAttribute('src') || './models/speaker_heads.glb',
        error: event.detail
      });
    };
    speakerTemplate?.addEventListener('model-loaded', this.onSpeakerModelLoaded);
    speakerTemplate?.addEventListener('model-error', this.onSpeakerModelError);

    this.grabButton = document.getElementById('grab-button');
    this.rotateLeftButton = document.getElementById('rotate-left-button');
    this.rotateRightButton = document.getElementById('rotate-right-button');
    this.heightUpButton = document.getElementById('height-up-button');
    this.heightDownButton = document.getElementById('height-down-button');
    this.onKeyDown = event => {
      if (event.repeat) return;
      if (event.code === 'KeyF') {
        if (event.defaultPrevented) return;
        event.preventDefault();
        this.toggleGrab();
        this.showFPopup();
      } else if (event.code === 'KeyE') {
        event.preventDefault();
        this.toggleGrab();
      } else if (event.code === 'KeyQ') {
        event.preventDefault();
        this.rotateGrabbed(-15);
      } else if (event.code === 'KeyR') {
        event.preventDefault();
        this.rotateGrabbed(15);
      } else if (event.code === 'KeyT') {
        event.preventDefault();
        this.adjustHeight(0.1);
      } else if (event.code === 'KeyG') {
        event.preventDefault();
        this.adjustHeight(-0.1);
      }
    };
    this.onGrabClick = event => { event.preventDefault(); event.stopPropagation(); this.toggleGrab(); };
    this.onRotateLeft = event => { event.preventDefault(); event.stopPropagation(); this.rotateGrabbed(-15); };
    this.onRotateRight = event => { event.preventDefault(); event.stopPropagation(); this.rotateGrabbed(15); };
    this.onHeightUp = event => { event.preventDefault(); event.stopPropagation(); this.adjustHeight(0.1); };
    this.onHeightDown = event => { event.preventDefault(); event.stopPropagation(); this.adjustHeight(-0.1); };
    window.addEventListener('keydown', this.onKeyDown);
    this.grabButton?.addEventListener('click', this.onGrabClick);
    this.rotateLeftButton?.addEventListener('click', this.onRotateLeft);
    this.rotateRightButton?.addEventListener('click', this.onRotateRight);
    this.heightUpButton?.addEventListener('click', this.onHeightUp);
    this.heightDownButton?.addEventListener('click', this.onHeightDown);
  },

  tick() {
    this.camera ||= document.getElementById('player-camera');
    this.rig ||= document.getElementById('player-rig');
    if (!this.camera || !this.rig) return;
    if (!this.furnitureInitialized) {
      const shell = this.scene.components['room-shell'];
      if (shell?.collisionReady) this.initializeFurniture(shell);
      return;
    }

    if (!this.speakersInitialized) {
      this.initializeSpeakers();
      return;
    }
    if (!this.ready) this.ready = true;

    this.registerAutoSofaItems();
    this.updateVRButtons();
    if (this.grabbedItem) this.updateGrabbedItem();
    else {
      this.updateFurnitureColliders();
      this.updateNearbyItem();
    }
    this.updateInteractionUI();
    this.scene.components['ergonomics-evaluator']?.updateScores(this.items, this.shell);
  },

  initializeFurniture(shell) {
    this.shell = shell;
    const usedTriangles = new Map();
    for (const part of shell.furnitureParts) {
      const descriptor = furnitureRole(part);
      if (descriptor.role === 'structure') continue;
      const item = this.createFurnitureItem(part, descriptor);
      this.items.push(item);
      part.collider.itemId = item.id;
      part.collider.item = item;
      item.collider = part.collider;
      item.collider.localWidth = item.width;
      item.collider.localDepth = item.depth;
      item.collider.localHeight = item.height;
      let selected = usedTriangles.get(part.sourceMesh);
      if (!selected) usedTriangles.set(part.sourceMesh, selected = new Set());
      for (const triangleId of part.triangleIds) selected.add(triangleId);
    }
    this.removeExtractedTriangles(usedTriangles);
    this.createTVArea();
    this.registerLampu();
    this.registerModelCollider('TELEPHONE', 'telephone_on_a_table.glb');
    this.registerModelCollider('MEJA', 'coffee_table_-_living_room.glb', true);
    this.updateFurnitureColliders();
    this.furnitureInitialized = true;
  },

  registerLampu() {
    const entity = document.getElementById('lampu');
    if (!entity) return;

    const width = 0.56;
    const depth = 0.56;
    const height = 1.968;
    const position = entity.object3D.position;
    const rotationY = entity.object3D.rotation.y;

    const collider = {
      minX: position.x - width / 2 - FURNITURE_CLEARANCE,
      maxX: position.x + width / 2 + FURNITURE_CLEARANCE,
      minY: FURNITURE_FLOOR_Y,
      maxY: FURNITURE_FLOOR_Y + height,
      minZ: position.z - depth / 2 - FURNITURE_CLEARANCE,
      maxZ: position.z + depth / 2 + FURNITURE_CLEARANCE,
      kind: 'furniture',
      id: 'lampu',
      itemId: 'lampu',
      name: 'lampu',
      source: 'lamp.glb',
      role: 'lamp'
    };

    const modelEntity = entity.querySelector('[gltf-model]');
    const item = {
      id: 'lampu',
      label: 'Lampu',
      role: 'lamp',
      source: 'lamp.glb',
      entity,
      transform: entity,
      meshes: [],
      materials: [],
      position: entity.object3D.position,
      originalPosition: entity.object3D.position.clone(),
      width,
      depth,
      height,
      verticalOrigin: 'bottom',
      baseY: FURNITURE_FLOOR_Y,
      rotationY,
      originalRotationY: rotationY,
      verticalOffset: 0,
      valid: true,
      collider,
      moved: false
    };

    const updateMaterials = () => {
      const root = modelEntity?.getObject3D('mesh') || entity.object3D;
      item.materials = this.collectMaterials(root);
      const meshes = [];
      root.traverse(obj => {
        if (obj.isMesh && obj.el?.id !== 'lampu-hitbox' && obj.parent?.el?.id !== 'lampu-hitbox') {
          meshes.push(obj);
        }
      });
      item.meshes = meshes;
    };

    if (modelEntity) {
      modelEntity.addEventListener('model-loaded', updateMaterials, {once: true});
      if (modelEntity.getObject3D('mesh')) updateMaterials();
    } else {
      updateMaterials();
    }

    collider.item = item;
    this.items.push(item);
    this.shell.colliders.push(collider);
    if (this.shell.debug) this.shell.addDebugBox(collider, '#42e875', `${collider.name}-debug`);
  },

  registerModelCollider(entityId, source, movable = false) {
    const entity = document.getElementById(entityId);
    if (!entity) return;

    const registerCollider = () => {
      if (this.shell.colliders.some(collider => collider.id === entityId)) return;
      const model = entity.getObject3D('mesh');
      if (!model) {
        console.error(`[LivingRoom] ${entityId} model loaded without a mesh; collision was not registered.`);
        return;
      }

      this.scene.object3D.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      if (bounds.isEmpty()) {
        console.error(`[LivingRoom] ${entityId} model has empty bounds; collision was not registered.`);
        return;
      }

      const collider = {
        minX: bounds.min.x - FURNITURE_CLEARANCE,
        maxX: bounds.max.x + FURNITURE_CLEARANCE,
        minY: bounds.min.y,
        maxY: bounds.max.y,
        minZ: bounds.min.z - FURNITURE_CLEARANCE,
        maxZ: bounds.max.z + FURNITURE_CLEARANCE,
        kind: 'furniture',
        id: entityId,
        name: entityId,
        source,
        role: 'furniture'
      };
      if (movable) {
        const inverse = entity.object3D.matrixWorld.clone().invert();
        const localBounds = new THREE.Box3();
        model.traverse(object => {
          if (!object.isMesh || !object.geometry?.attributes?.position) return;
          if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
          const matrix = inverse.clone().multiply(object.matrixWorld);
          localBounds.union(object.geometry.boundingBox.clone().applyMatrix4(matrix));
        });
        if (localBounds.isEmpty()) {
          console.error(`[Furniture] Could not measure the ${entityId} model for interaction.`);
          return;
        }
        const size = localBounds.getSize(new THREE.Vector3());
        const worldPosition = entity.object3D.getWorldPosition(new THREE.Vector3());
        const item = {
          id: entity.id,
          label: 'Meja',
          role: 'table',
          source,
          entity,
          transform: entity,
          meshes: [],
          materials: this.collectMaterials(model),
          position: entity.object3D.position,
          originalPosition: entity.object3D.position.clone(),
          width: size.x,
          depth: size.z,
          height: size.y,
          localCenter: localBounds.getCenter(new THREE.Vector3()),
          verticalOrigin: 'bottom',
          baseY: entity.object3D.position.y,
          floorOffset: bounds.min.y - worldPosition.y,
          rotationY: entity.object3D.rotation.y,
          originalRotationY: entity.object3D.rotation.y,
          verticalOffset: 0,
          valid: true,
          collider,
          moved: false
        };
        model.traverse(object => {
          if (object.isMesh) item.meshes.push(object);
        });
        collider.itemId = item.id;
        collider.role = item.role;
        collider.item = item;
        this.items.push(item);
        this.captureInitialOverlaps();
      }
      this.shell.colliders.push(collider);
      if (this.shell.debug) this.shell.addDebugBox(collider, '#ff9c38', `${entityId}-debug`);
      console.info('[LivingRoom] Scene model collision registered.', {
        id: entityId,
        bounds: {
          min: bounds.min.toArray(),
          max: bounds.max.toArray()
        }
      });
    };

    if (entity.getObject3D('mesh')) registerCollider();
    else {
      entity.addEventListener('model-loaded', registerCollider, {once: true});
      entity.addEventListener('model-error', event => {
        console.error(`[LivingRoom] ${entityId} model failed to load; collision was not registered.`, event.detail);
      }, {once: true});
    }
  },

  registerAutoSofaItems() {
    const models = this.scene.components['auto-furniture-loader']?.placedModels || [];
    for (const model of models) {
      if (model.role.type !== 'sofa' || !model.collider ||
        this.items.some(item => item.id === model.entity.id || item.role === 'sofa')) continue;

      const entity = model.entity;
      entity.object3D.updateWorldMatrix(true, true);
      const inverse = entity.object3D.matrixWorld.clone().invert();
      const localBounds = new THREE.Box3();
      model.root?.traverse(object => {
        if (!object.isMesh || !object.geometry?.attributes?.position) return;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        const matrix = inverse.clone().multiply(object.matrixWorld);
        localBounds.union(object.geometry.boundingBox.clone().applyMatrix4(matrix));
      });
      if (localBounds.isEmpty()) {
        console.error(`[Furniture] Could not measure the ${entity.id} model for interaction.`);
        continue;
      }

      const size = localBounds.getSize(new THREE.Vector3());
      const worldPosition = entity.object3D.getWorldPosition(new THREE.Vector3());
      const item = {
        id: entity.id,
        label: 'Sofa',
        role: 'sofa',
        source: model.descriptor.path,
        entity,
        transform: entity,
        meshes: [],
        materials: this.collectMaterials(model.root),
        position: entity.object3D.position,
        originalPosition: entity.object3D.position.clone(),
        width: size.x,
        depth: size.z,
        height: size.y,
        localCenter: localBounds.getCenter(new THREE.Vector3()),
        verticalOrigin: 'bottom',
        baseY: entity.object3D.position.y,
        floorOffset: model.bounds.min.y - worldPosition.y,
        rotationY: entity.object3D.rotation.y,
        originalRotationY: entity.object3D.rotation.y,
        verticalOffset: 0,
        valid: true,
        collider: model.collider,
        moved: false,
        autoModel: model
      };
      model.root?.traverse(object => {
        if (object.isMesh) item.meshes.push(object);
      });
      model.collider.kind = 'furniture';
      model.collider.itemId = item.id;
      model.collider.role = item.role;
      model.collider.item = item;
      this.items.push(item);
      this.captureInitialOverlaps();
    }
  },

  createTVArea() {
    const tv = this.items.find(item => item.role === 'tv');
    if (!tv) return;
    const position = tv.transform.object3D.getWorldPosition(new THREE.Vector3());
    const rotation = tv.transform.object3D.rotation.y;
    const area = document.createElement('a-entity');
    area.id = 'tv-area';
    area.classList.add('tv-area');
    area.setAttribute('position', `${position.x} ${FURNITURE_FLOOR_Y} ${position.z}`);
    area.setAttribute('rotation', `0 ${THREE.MathUtils.radToDeg(rotation)} 0`);
    this.scene.appendChild(area);
    area.object3D.position.set(position.x, FURNITURE_FLOOR_Y, position.z);
    area.object3D.rotation.set(0, rotation, 0);

    area.appendChild(tv.entity);
    tv.entity.setAttribute('position', '0 0 0');
    tv.entity.setAttribute('rotation', '0 0 0');
    tv.entity.object3D.position.set(0, 0, 0);
    tv.entity.object3D.rotation.set(0, 0, 0);
    tv.transform = area;
    tv.position = area.object3D.position;
    tv.rotationY = 0;
    tv.groupId = area.id;
    tv.collider.groupId = area.id;
    tv.collider.role = tv.role;
    this.tvArea = area;
  },

  initializeSpeakers() {
    const template = document.getElementById('speaker-template');
    if (!template) {
      this.speakersInitialized = true;
      return;
    }
    const modelRoot = template?.getObject3D('mesh');
    if (!template || !modelRoot || this.speakerModelFailed) return;
    if (!this.speakerModelLogged) this.onSpeakerModelLoaded();
    const speakerRoot = modelRoot.getObjectByName('SpeakerHead_23') || modelRoot.getObjectByName('SidewaysSpeaker_11');
    const tv = this.items.find(item => item.role === 'tv');
    if (!speakerRoot || !tv || !this.tvArea) {
      if (!speakerRoot) {
        this.speakerModelFailed = true;
        console.error('[LivingRoom] Speaker model loaded but no supported speaker node was found.', {
          expectedNodes: ['SpeakerHead_23', 'SidewaysSpeaker_11']
        });
      }
      return;
    }

    modelRoot.updateMatrixWorld(true);
    speakerRoot.traverse(object => {
      if (object.isSkinnedMesh) object.skeleton.update();
    });
    const sourceBounds = new THREE.Box3().setFromObject(speakerRoot);
    if (sourceBounds.isEmpty()) {
      this.speakerModelFailed = true;
      console.error('[LivingRoom] Speaker model contains no measurable geometry.');
      return;
    }
    const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
    const content = new THREE.Group();
    content.name = 'speaker-static-mesh';
    speakerRoot.traverse(source => {
      if (!source.isMesh || !source.geometry?.attributes?.position) return;
      const geometry = source.geometry.clone();
      const positions = geometry.attributes.position;
      const point = new THREE.Vector3();
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index);
        if (source.isSkinnedMesh) source.applyBoneTransform(index, point);
        point.applyMatrix4(source.matrixWorld).sub(sourceCenter);
        positions.setXYZ(index, point.x, point.y, point.z);
      }
      geometry.deleteAttribute('normal');
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, cloneMaterials(source.material));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      content.add(mesh);
    });
    if (!content.children.length) {
      this.speakerModelFailed = true;
      console.error('[LivingRoom] Speaker model contains no renderable meshes.');
      return;
    }

    const localBounds = new THREE.Box3().setFromObject(content);
    const size = localBounds.getSize(new THREE.Vector3());
    const speakerHeight = Math.max(size.y, 0.12);
    const sofa = this.items.find(item => item.role === 'sofa');
    const sofaCenter = sofa ? new THREE.Vector3(
      (sofa.collider.minX + sofa.collider.maxX) / 2,
      0,
      (sofa.collider.minZ + sofa.collider.maxZ) / 2
    ) : new THREE.Vector3(0, 0, this.tvArea.object3D.position.z + 1);
    const localSofaDirection = sofaCenter.sub(this.tvArea.object3D.getWorldPosition(new THREE.Vector3()));
    localSofaDirection.y = 0;
    localSofaDirection.applyQuaternion(this.tvArea.object3D.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    const speakerYaw = Math.atan2(-localSofaDirection.z, localSofaDirection.x);
    const tvWidth = tv.collider.maxX - tv.collider.minX;
    const offsetX = Math.max(0.6, tvWidth / 2 + size.x / 2 + 0.12);
    const standTopY = TV_STAND_TOP_Y;
    tv.speakerSurfaceY = standTopY;
    const speakerCenterY = standTopY + speakerHeight / 2;
    const sidePlacements = [
      {id: 'speaker-left', label: 'Speaker Kiri', x: -offsetX},
      {id: 'speaker-right', label: 'Speaker Kanan', x: offsetX}
    ];

    for (const placement of sidePlacements) {
      const entity = document.createElement('a-entity');
      entity.id = placement.id;
      entity.classList.add('furniture-grabbable');
      entity.setAttribute('position', `${placement.x} ${speakerCenterY} 0`);
      entity.setAttribute('rotation', `0 ${THREE.MathUtils.radToDeg(speakerYaw)} 0`);
      entity.object3D.position.set(placement.x, speakerCenterY, 0);
      entity.object3D.rotation.set(0, speakerYaw, 0);
      const mesh = content.clone(true);
      // Each speaker owns cloned geometry and materials so its highlight is independent.
      mesh.traverse(object => {
        if (!object.isMesh) return;
        object.geometry = object.geometry.clone();
        object.material = Array.isArray(object.material)
          ? object.material.map(material => material.clone())
          : object.material.clone();
      });
      entity.object3D.add(mesh);
      this.tvArea.appendChild(entity);

      const collider = {
        minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0,
        kind: 'furniture', id: placement.id, itemId: placement.id,
        groupId: this.tvArea.id, name: placement.id, source: 'speaker_heads.glb', role: 'speaker'
      };
      const item = {
        id: placement.id, label: placement.label, role: 'speaker', source: 'speaker_heads.glb',
        entity, transform: entity, meshes: [mesh], materials: this.collectMaterials(mesh),
        position: entity.object3D.position, originalPosition: entity.object3D.position.clone(),
        width: Math.max(size.x, 0.12), depth: Math.max(size.z, 0.12), height: speakerHeight,
        verticalOrigin: 'center', baseY: speakerCenterY, rotationY: speakerYaw,
        originalRotationY: speakerYaw, verticalOffset: 0, valid: true, collider,
        groupId: this.tvArea.id, moved: false
      };
      collider.item = item;
      this.items.push(item);
      this.shell.colliders.push(collider);
      if (this.shell.debug) this.shell.addDebugBox(collider, '#ff9c38', `${collider.name}-debug`);
    }

    template.remove();
    this.speakersInitialized = true;
    this.updateFurnitureColliders();
    this.captureInitialOverlaps();
    this.scene.components['ergonomics-evaluator']?.updateScores(this.items, this.shell);
    console.info('[LivingRoom] Speaker pair and placement colliders created.', {
      ids: ['speaker-left', 'speaker-right'],
      tvArea: this.tvArea.id,
      standTopY,
      symmetricOffset: offsetX,
      facingYaw: speakerYaw,
      modelNode: speakerRoot.name
    });
    console.info('[LivingRoom] Furniture editing is ready.', {
      movableFurniture: this.items.map(item => ({id: item.id, label: item.label})),
      tvArea: this.tvArea.id,
      speakers: ['speaker-left', 'speaker-right'],
      grid: `${FURNITURE_GRID} m`,
      controls: 'E grab/place, Q/R rotate'
    });
  },

  createFurnitureItem(part, descriptor) {
    const bounds = part.bounds;
    const pivot = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, bounds.minY, (bounds.minZ + bounds.maxZ) / 2);
    const matrix = part.sourceMesh.matrixWorld.clone();
    const geometry = geometryFromTriangles(part.sourceMesh.geometry, part.triangleIds, matrix, pivot);
    const material = cloneMaterials(part.sourceMesh.material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;

    const entity = document.createElement('a-entity');
    entity.id = part.id;
    entity.classList.add('furniture-grabbable');
    entity.setAttribute('position', `${pivot.x} ${FURNITURE_FLOOR_Y} ${pivot.z}`);
    entity.object3D.position.set(pivot.x, FURNITURE_FLOOR_Y, pivot.z);
    entity.object3D.add(mesh);
    this.scene.appendChild(entity);

    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const height = bounds.maxY - bounds.minY;
    const item = {
      id: part.id,
      label: descriptor.label,
      role: descriptor.role,
      source: part.source,
      entity,
      transform: entity,
      meshes: [mesh],
      materials: this.collectMaterials(mesh),
      position: entity.object3D.position,
      originalPosition: new THREE.Vector3(pivot.x, FURNITURE_FLOOR_Y, pivot.z),
      width,
      depth,
      height,
      verticalOrigin: 'bottom',
      baseY: FURNITURE_FLOOR_Y,
      rotationY: 0,
      originalRotationY: 0,
      verticalOffset: 0,
      valid: true,
      collider: part.collider,
      moved: false
    };
    return item;
  },

  collectMaterials(root) {
    const materials = [];
    root.traverse(object => {
      if (!object.isMesh) return;
      if (object.el?.id === 'lampu-hitbox' || object.parent?.el?.id === 'lampu-hitbox') return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material || materials.includes(material)) continue;
        materials.push(material);
      }
    });
    return materials.map(material => ({
      material,
      color: material.color?.clone(),
      emissive: material.emissive?.clone(),
      emissiveIntensity: material.emissiveIntensity,
      transparent: material.transparent,
      opacity: material.opacity,
      depthWrite: material.depthWrite
    }));
  },

  removeExtractedTriangles(usedTriangles) {
    for (const [mesh, selected] of usedTriangles) {
      const sourceGeometry = mesh.geometry;
      const sourceIndex = sourceGeometry.index;
      const triangleCount = Math.floor((sourceIndex ? sourceIndex.count : sourceGeometry.attributes.position.count) / 3);
      const remaining = [];
      for (let triangle = 0; triangle < triangleCount; triangle++) {
        if (!selected.has(triangle)) remaining.push(triangle);
      }
      if (!remaining.length) {
        mesh.removeFromParent();
        continue;
      }
      mesh.geometry = geometryFromTriangles(sourceGeometry, remaining);
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
  },

  updateFurnitureColliders() {
    this.scene.object3D.updateMatrixWorld(true);
    for (const item of this.items) {
      Object.assign(item.collider, this.colliderAtPose(item, this.getItemWorldPose(item)));
      if (this.shell.debug) this.syncDebugBox(item.collider);
    }
  },

  getItemWorldPose(item) {
    const transform = item.transform.object3D;
    const position = transform.getWorldPosition(new THREE.Vector3());
    const orientation = item.rotationPivotGroup || transform;
    const quaternion = orientation.getWorldQuaternion(new THREE.Quaternion());
    const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
    return {position, yaw: rotation.y};
  },

  setItemWorldPose(item, position, yaw) {
    const transform = item.transform.object3D;
    const parent = transform.parent;
    const localPosition = position.clone();
    let parentYaw = 0;
    if (parent) {
      parent.worldToLocal(localPosition);
      const parentQuaternion = parent.getWorldQuaternion(new THREE.Quaternion());
      parentYaw = new THREE.Euler().setFromQuaternion(parentQuaternion, 'YXZ').y;
    }
    transform.position.copy(localPosition);
    const pivotYaw = item.rotationPivotGroup
      ? new THREE.Euler().setFromQuaternion(item.rotationPivotGroup.quaternion, 'YXZ').y
      : 0;
    transform.rotation.set(0, yaw - parentYaw - pivotYaw, 0);
    item.rotationY = transform.rotation.y;
    if (item.rotationPivotGroup) item.rotationY += pivotYaw;
    item.position = transform.position;
    transform.updateMatrix();
  },

  colliderAtPose(item, pose) {
    const scale = item.transform.object3D.getWorldScale(new THREE.Vector3());
    const halfWidth = item.width * Math.abs(scale.x) / 2;
    const halfDepth = item.depth * Math.abs(scale.z) / 2;
    const height = item.height * Math.abs(scale.y);
    const cosine = Math.cos(pose.yaw);
    const sine = Math.sin(pose.yaw);
    const halfX = Math.abs(cosine) * halfWidth + Math.abs(sine) * halfDepth + FURNITURE_CLEARANCE;
    const halfZ = Math.abs(sine) * halfWidth + Math.abs(cosine) * halfDepth + FURNITURE_CLEARANCE;
    const pivotYaw = item.rotationPivotGroup
      ? new THREE.Euler().setFromQuaternion(item.rotationPivotGroup.quaternion, 'YXZ').y
      : 0;
    const centerYaw = pose.yaw - pivotYaw;
    const centerCosine = Math.cos(centerYaw);
    const centerSine = Math.sin(centerYaw);
    const localCenter = item.localCenter;
    const centerX = pose.position.x + (localCenter
      ? centerCosine * localCenter.x * scale.x + centerSine * localCenter.z * scale.z
      : 0);
    const centerZ = pose.position.z + (localCenter
      ? -centerSine * localCenter.x * scale.x + centerCosine * localCenter.z * scale.z
      : 0);
    const minY = item.verticalOrigin === 'center'
      ? pose.position.y - height / 2
      : pose.position.y + (item.floorOffset || 0);
    return {
      minX: centerX - halfX, maxX: centerX + halfX,
      minY, maxY: minY + height,
      minZ: centerZ - halfZ, maxZ: centerZ + halfZ
    };
  },

  captureInitialOverlaps() {
    for (const item of this.items) {
      for (const other of this.shell.colliders) {
        if (other === item.collider || other.kind !== 'furniture' || other.maxY <= item.collider.minY || other.minY >= item.collider.maxY) continue;
        const intersection = {
          minX: Math.max(item.collider.minX, other.minX),
          maxX: Math.min(item.collider.maxX, other.maxX),
          minY: Math.max(item.collider.minY, other.minY),
          maxY: Math.min(item.collider.maxY, other.maxY),
          minZ: Math.max(item.collider.minZ, other.minZ),
          maxZ: Math.min(item.collider.maxZ, other.maxZ)
        };
        if (intersection.minX < intersection.maxX && intersection.minZ < intersection.maxZ) {
          this.initialOverlapAllowances.set(collisionPairKey(item.collider, other), intersection);
        }
      }
    }
  },

  syncDebugBox(box) {
    const helper = document.getElementById(`${box.name}-debug`);
    if (!helper) return;
    helper.setAttribute('position', `${(box.minX + box.maxX) / 2} ${(box.minY + box.maxY) / 2} ${(box.minZ + box.maxZ) / 2}`);
    helper.setAttribute('width', box.maxX - box.minX);
    helper.setAttribute('height', box.maxY - box.minY);
    helper.setAttribute('depth', box.maxZ - box.minZ);
  },

  updateNearbyItem() {
    this.scene.object3D.updateMatrixWorld(true);
    this.camera.object3D.getWorldPosition(this.cameraPosition);
    this.camera.object3D.getWorldDirection(this.direction);
    this.raycaster.set(this.cameraPosition, this.direction);
    let nearest = null;
    let nearestDistance = 3.5;
    for (const collider of this.shell.colliders) {
      if (collider.kind !== 'furniture') continue;
      const box = new THREE.Box3(
        new THREE.Vector3(collider.minX, collider.minY, collider.minZ),
        new THREE.Vector3(collider.maxX, collider.maxY, collider.maxZ)
      );
      const hit = this.raycaster.ray.intersectBox(box, new THREE.Vector3());
      if (!hit) continue;
      const distance = this.cameraPosition.distanceTo(hit);
      if (distance < nearestDistance) {
        nearest = this.items.find(item => item.id === collider.itemId) || null;
        nearestDistance = distance;
      }
    }
    this.crosshair?.classList.toggle('is-target', !!nearest);
    if (nearest !== this.nearbyItem) {
      if (this.nearbyItem) this.setAppearance(this.nearbyItem, 'normal');
      this.nearbyItem = nearest;
      if (nearest) this.setAppearance(nearest, 'highlight');
    }
  },

  updateGrabbedItem() {
    const item = this.grabbedItem;
    if (!item?.transform?.object3D || !item.collider) return;
    this.scene.object3D.updateMatrixWorld(true);
    this.camera.object3D.getWorldPosition(this.cameraPosition);
    this.camera.object3D.getWorldDirection(this.direction);
    // The A-Frame camera entity exposes a generic Object3D whose +Z axis points backward.
    // Match fps-controls: invert it to get the camera's forward direction (-Z).
    this.direction.negate();
    this.direction.y = 0;
    if (this.direction.lengthSq() < 0.001) this.direction.set(0, 0, -1);
    else this.direction.normalize();

    const targetX = this.cameraPosition.x + this.direction.x * 1.35;
    const targetZ = this.cameraPosition.z + this.direction.z * 1.35;
    const floorHeight = this.getFloorHeight(targetX, targetZ);
    const candidateY = item.verticalOrigin === 'bottom' || item.role === 'lamp'
      ? FURNITURE_FLOOR_Y - (item.floorOffset || 0)
      : Math.max(FURNITURE_FLOOR_Y, floorHeight ?? FURNITURE_FLOOR_Y, item.baseY + item.verticalOffset);
    const candidatePose = {
      position: new THREE.Vector3(
        Math.round(targetX / FURNITURE_GRID) * FURNITURE_GRID,
        candidateY,
        Math.round(targetZ / FURNITURE_GRID) * FURNITURE_GRID
      ),
      yaw: this.getParentWorldYaw(item.transform.object3D) + item.rotationY
    };
    item.moved = true;

    const candidate = {...item.collider, ...this.colliderAtPose(item, candidatePose)};
    const currentPose = this.getItemWorldPose(item);
    const localPositionBefore = item.transform.object3D.position.clone();
    const canRelocateFreely = this.isMovable(item);
    const placementRejection = this.getPlacementRejection(item, candidate);
    const pathValid = canRelocateFreely || this.isPlacementPathValid(item, currentPose, candidatePose);
    item.valid = floorHeight !== null && !placementRejection && pathValid;
    if (item.valid) {
      this.setItemWorldPose(item, candidatePose.position, candidatePose.yaw);
      this.updateFurnitureColliders();
      item.lastValidTransform = this.captureItemTransform(item);
    }
    this.setAppearance(item, item.valid ? 'valid' : 'highlight');
    this.updatePreview(candidate, item.valid);
    this.updateFloorMarker(candidatePose.position, floorHeight, item.valid);
    this.updatePlacementDebug(item, candidate, item.valid);

    const position = candidatePose.position;
    const actualPosition = this.getItemWorldPose(item).position;
    const localPositionAfter = item.transform.object3D.position.clone();
    const requestedDelta = currentPose.position.distanceTo(position);
    const appliedDelta = currentPose.position.distanceTo(actualPosition);
    const rejectionReason = floorHeight === null
      ? 'floor ray did not reach a valid room position'
      : placementRejection?.reason === 'collision'
        ? `collision with ${placementRejection.blockerKind === 'wall' ? 'wall' : placementRejection.blockerKind === 'furniture' ? 'furniture' : 'object'}`
        : placementRejection?.reason === 'horizontal-room-boundary' || placementRejection?.reason === 'vertical-room-boundary'
          ? 'outside room bounds'
          : placementRejection?.reason || (!pathValid ? 'placement path blocked' : null);
    const blocker = placementRejection?.blocker || null;
    const blockerKind = placementRejection?.blockerKind || null;
    const moveKey = `${item.id}|${item.valid}|${position.x.toFixed(2)}|${position.y.toFixed(2)}|${position.z.toFixed(2)}|${candidatePose.yaw.toFixed(3)}|${rejectionReason}|${blocker}`;
    if (moveKey !== this.lastGrabMoveKey) {
      this.lastGrabMoveKey = moveKey;
      const diagnostic = {
        id: item.id,
        oldWorldPosition: currentPose.position.toArray().map(value => Number(value.toFixed(3))),
        rawTargetPosition: [targetX, candidateY, targetZ].map(value => Number(value.toFixed(3))),
        targetWorldPosition: position.toArray().map(value => Number(value.toFixed(3))),
        finalWorldPosition: actualPosition.toArray().map(value => Number(value.toFixed(3))),
        object3DLocalPositionBefore: localPositionBefore.toArray().map(value => Number(value.toFixed(3))),
        object3DLocalPositionAfter: localPositionAfter.toArray().map(value => Number(value.toFixed(3))),
        requestedDeltaMeters: Number(requestedDelta.toFixed(3)),
        appliedDeltaMeters: Number(appliedDelta.toFixed(3)),
        floorRayHit: this.lastFloorRayHit,
        floorHeight,
        rejectionReason,
        blocker,
        blockerKind
      };
      if (!item.valid) {
        console.warn(`[Furniture Move Debug] Move rejected: ${rejectionReason}`, diagnostic);
      } else if (appliedDelta > 0.005) {
        console.info('[Furniture Move Debug] Move successful: old position → new position', diagnostic);
      } else if (requestedDelta > 0.005) {
        console.error('[Furniture Move Debug] Move rejected: object3D transform did not apply target position', diagnostic);
      } else {
        console.info('[Furniture Move Debug] No visible movement: target unchanged after grid snapping', diagnostic);
      }
    }
  },

  getFloorHeight(x, z) {
    const bounds = ROOM_LAYOUT.inside;
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
      this.lastFloorRayHit = false;
      return null;
    }
    this.floorRaycaster.set(
      new THREE.Vector3(x, ROOM_LAYOUT.ceilingY + 1, z),
      new THREE.Vector3(0, -1, 0)
    );
    const hit = this.floorRaycaster.ray.intersectPlane(this.floorPlane, this.floorHitPoint);
    this.lastFloorRayHit = !!hit;
    return hit ? Math.max(FURNITURE_FLOOR_Y, hit.y) : null;
  },

  updateFloorMarker(position, floorHeight, valid) {
    const marker = this.placementMarker;
    marker.object3D.position.set(position.x, Math.max(0.005, (floorHeight ?? FURNITURE_FLOOR_Y) + 0.005), position.z);
    const material = marker.getObject3D('mesh')?.material;
    if (material?.color) material.color.set(valid ? '#42e875' : '#ff4055');
    else marker.setAttribute('material', `color: ${valid ? '#42e875' : '#ff4055'}; shader: flat; transparent: true; opacity: 0.95; depthTest: false; depthWrite: false`);
    marker.object3D.visible = true;
  },

  updatePlacementDebug(item, candidate, valid) {
    if (!this.debugMode) return;
    for (const helper of this.overlapDebugHelpers) helper.remove();
    this.overlapDebugHelpers.length = 0;
    let overlapCount = 0;
    for (const other of this.shell.colliders) {
      if (other.itemId === item.id) continue;
      const minX = Math.max(candidate.minX, other.minX);
      const maxX = Math.min(candidate.maxX, other.maxX);
      const minY = Math.max(candidate.minY, other.minY);
      const maxY = Math.min(candidate.maxY, other.maxY);
      const minZ = Math.max(candidate.minZ, other.minZ);
      const maxZ = Math.min(candidate.maxZ, other.maxZ);
      if (minX >= maxX || minY >= maxY || minZ >= maxZ) continue;
      overlapCount++;
      const helper = document.createElement('a-box');
      helper.classList.add('placement-overlap-debug');
      helper.setAttribute('position', `${(minX + maxX) / 2} ${(minY + maxY) / 2} ${(minZ + maxZ) / 2}`);
      helper.setAttribute('width', Math.max(0.015, maxX - minX));
      helper.setAttribute('height', Math.max(0.015, maxY - minY));
      helper.setAttribute('depth', Math.max(0.015, maxZ - minZ));
      helper.setAttribute('material', 'color: #ff1744; transparent: true; opacity: 0.72; depthWrite: false; side: double');
      this.scene.appendChild(helper);
      this.overlapDebugHelpers.push(helper);
    }
    const p = candidate;
    this.debugPanel.hidden = false;
    this.debugPanel.textContent = `DEBUG COLLISION: ON · Furnitur: ${this.items.length} · ${item.id} (${((p.minX + p.maxX) / 2).toFixed(2)}, ${((p.minY + p.maxY) / 2).toFixed(2)}, ${((p.minZ + p.maxZ) / 2).toFixed(2)}) · Placement ${valid ? 'HIJAU' : 'MERAH'} · Overlap: ${overlapCount}`;
  },

  getParentWorldYaw(transform) {
    const parent = transform.parent;
    if (!parent) return 0;
    const quaternion = parent.getWorldQuaternion(new THREE.Quaternion());
    return new THREE.Euler().setFromQuaternion(quaternion, 'YXZ').y;
  },

  captureItemTransform(item) {
    const pose = this.getItemWorldPose(item);
    return {position: pose.position.clone(), yaw: pose.yaw, verticalOffset: item.verticalOffset};
  },

  isPlacementPathValid(item, fromPose, toPose) {
    const angleDelta = Math.atan2(Math.sin(toPose.yaw - fromPose.yaw), Math.cos(toPose.yaw - fromPose.yaw));
    const distance = fromPose.position.distanceTo(toPose.position);
    const steps = Math.max(1, Math.ceil(Math.max(distance / 0.1, Math.abs(angleDelta) / THREE.MathUtils.degToRad(7.5))));
    for (let step = 1; step <= steps; step++) {
      const amount = step / steps;
      const pose = {
        position: fromPose.position.clone().lerp(toPose.position, amount),
        yaw: fromPose.yaw + angleDelta * amount
      };
      const box = {...item.collider, ...this.colliderAtPose(item, pose)};
      if (!this.isValidPlacement(item, box)) return false;
    }
    return true;
  },

  getPlacementRejection(item, candidate) {
    const bounds = ROOM_LAYOUT.inside;
    const values = [candidate.minX, candidate.maxX, candidate.minY, candidate.maxY, candidate.minZ, candidate.maxZ];
    if (!values.every(Number.isFinite)) return {reason: 'invalid-bounds', blocker: null, blockerKind: null};
    if (candidate.minY < FURNITURE_FLOOR_Y - 0.001 || candidate.maxY > ROOM_LAYOUT.ceilingY - 0.02) {
      return {reason: 'vertical-room-boundary', blocker: 'room', blockerKind: 'room'};
    }
    if (candidate.minX < bounds.minX + 0.02 || candidate.maxX > bounds.maxX - 0.02 ||
        candidate.minZ < bounds.minZ + 0.02 || candidate.maxZ > bounds.maxZ - 0.02) {
      return {reason: 'horizontal-room-boundary', blocker: 'room', blockerKind: 'room'};
    }

    for (const other of this.shell.colliders) {
      if (other === candidate || other.itemId === item.id || other.maxY <= candidate.minY || other.minY >= candidate.maxY) continue;
      if (item.role === 'tv' && other.groupId === item.groupId) continue;
      if (item.role === 'speaker' && other.role === 'tv' && other.groupId === item.groupId) {
        const tabletopY = other.item?.speakerSurfaceY;
        const restingOnTable = Number.isFinite(tabletopY) &&
          Math.abs(candidate.minY - tabletopY) <= 0.025 &&
          candidate.minX >= other.minX && candidate.maxX <= other.maxX &&
          candidate.minZ >= other.minZ && candidate.maxZ <= other.maxZ;
        if (!restingOnTable) return {
          reason: 'collision',
          blocker: other.item?.label || other.name || other.itemId || 'tv',
          blockerKind: other.kind || 'furniture'
        };
        continue;
      }
      const overlapX = Math.max(0, Math.min(candidate.maxX, other.maxX) - Math.max(candidate.minX, other.minX));
      const overlapZ = Math.max(0, Math.min(candidate.maxZ, other.maxZ) - Math.max(candidate.minZ, other.minZ));
      if (overlapX <= 0 || overlapZ <= 0) continue;
      if (this.isMovable(item)) {
        // The moving item's collider is padded by FURNITURE_CLEARANCE. Other
        // furniture colliders receive the same padding, so ignore only the
        // overlap caused by those safety margins, not a real model collision.
        const margin = FURNITURE_CLEARANCE * (other.kind === 'furniture' ? 2 : 1);
        if (overlapX <= margin + 0.001 || overlapZ <= margin + 0.001) continue;
      }
      if (other.kind === 'furniture') {
        const initial = this.initialOverlapAllowances.get(collisionPairKey(candidate, other));
        if (initial) {
          const withinInitialOverlap =
            Math.max(candidate.minX, other.minX) >= initial.minX - 0.002 &&
            Math.min(candidate.maxX, other.maxX) <= initial.maxX + 0.002 &&
            Math.max(candidate.minY, other.minY) >= initial.minY - 0.002 &&
            Math.min(candidate.maxY, other.maxY) <= initial.maxY + 0.002 &&
            Math.max(candidate.minZ, other.minZ) >= initial.minZ - 0.002 &&
            Math.min(candidate.maxZ, other.maxZ) <= initial.maxZ + 0.002;
          if (withinInitialOverlap) continue;
        }
      }
      return {
        reason: 'collision',
        blocker: other.item?.label || other.name || other.itemId || other.kind || 'unknown',
        blockerKind: other.kind || 'object'
      };
    }
    return null;
  },

  isValidPlacement(item, candidate) {
    return !this.getPlacementRejection(item, candidate);
  },

  updatePreview(box, valid) {
    this.preview.object3D.position.set((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
    this.preview.object3D.scale.set(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ);
    if (this.previewValid !== valid) {
      const material = this.preview.getObject3D('mesh')?.material;
      if (material?.color) material.color.set(valid ? '#42e875' : '#ff4055');
      else this.preview.setAttribute('material', `color: ${valid ? '#42e875' : '#ff4055'}; wireframe: true; transparent: true; opacity: 0.95; depthTest: false`);
      this.previewValid = valid;
    }
    this.preview.object3D.visible = true;
  },

  showFPopup() {
    if (!this.fPopup || !this.fPopupContent) return;
    if (this.fPopup.hidden) {
      this.fPopupHadPointerLock = document.pointerLockElement === this.scene.canvas;
    }
    if (this.fPopupHadPointerLock) {
      const desktopController = this.rig?.components['fps-controls']?.desktopController;
      if (desktopController) desktopController.exitPointerLock();
      else if (document.pointerLockElement) document.exitPointerLock();
    }
    if (this.grabbedItem) {
      this.fPopupContent.textContent = `${this.grabbedItem.label} sedang dipindahkan. Tekan F untuk meletakkan atau tutup popup ini untuk melanjutkan.`;
    } else if (this.nearbyItem) {
      this.fPopupContent.textContent = `${this.nearbyItem.label} terdeteksi oleh crosshair. Tekan F untuk mengambil barang ini.`;
    } else {
      this.fPopupContent.textContent = 'Arahkan crosshair ke furnitur yang dapat dipindahkan.';
    }
    this.fPopup.hidden = false;
  },

  toggleGrab() {
    if (this.grabbedItem) {
      const item = this.grabbedItem;
      const restoredLastValid = !item.valid;
      if (restoredLastValid && item.lastValidTransform) {
        item.verticalOffset = item.lastValidTransform.verticalOffset;
        this.setItemWorldPose(item, item.lastValidTransform.position, item.lastValidTransform.yaw);
      }
      item.valid = true;
      this.updateFurnitureColliders();
      this.setAppearance(item, 'normal');
      this.grabbedItem = null;
      this.preview.object3D.visible = false;
      this.placementMarker.object3D.visible = false;
      for (const helper of this.overlapDebugHelpers) helper.remove();
      this.overlapDebugHelpers.length = 0;
      const pose = this.getItemWorldPose(item);
      console.info('[LivingRoom] Grab End', {
        id: item.id,
        position: pose.position.toArray().map(value => Number(value.toFixed(2))),
        restoredLastValid
      });
      this.lastGrabMoveKey = '';
      this.scene.components['ergonomics-evaluator']?.updateScores(this.items, this.shell);
      this.updateNearbyItem();
      this.updateInteractionUI();
      console.info('[Furniture Move Debug] Move Mode inactive', {
        id: item.id,
        positionBefore: item.moveModeStartPosition?.toArray().map(value => Number(value.toFixed(2))) || null,
        positionAfter: pose.position.toArray().map(value => Number(value.toFixed(2)))
      });
      item.moveModeStartPosition = null;
      return;
    }
    if (!this.nearbyItem) return;
    this.grabbedItem = this.nearbyItem;
    this.nearbyItem = null;
    this.grabbedItem.lastValidTransform = this.captureItemTransform(this.grabbedItem);
    this.grabbedItem.moveModeStartPosition = this.grabbedItem.lastValidTransform.position.clone();
    this.grabbedItem.valid = true;
    this.setAppearance(this.grabbedItem, 'highlight');
    console.info('[Furniture Move Debug] Move Mode active', {
      id: this.grabbedItem.id,
      positionBefore: this.grabbedItem.moveModeStartPosition.toArray().map(value => Number(value.toFixed(2)))
    });
    this.updateGrabbedItem();
    this.updateInteractionUI();
  },

  isMovable(item) {
    return item?.role === 'sofa' || item?.id === 'MEJA';
  },

  rotateGrabbed(degrees) {
    if (!this.grabbedItem) return;
    this.grabbedItem.rotationY += THREE.MathUtils.degToRad(degrees);
    this.updateGrabbedItem();
    this.updateInteractionUI();
  },

  adjustHeight(delta) {
    const item = this.grabbedItem;
    if (!item || item.role !== 'tv') return;
    const minOffset = FURNITURE_FLOOR_Y - item.baseY;
    const maxOffset = ROOM_LAYOUT.ceilingY - item.height - item.baseY - 0.02;
    item.verticalOffset = clamp(Math.round((item.verticalOffset + delta) * 100) / 100, minOffset, maxOffset);
    this.updateGrabbedItem();
    this.updateInteractionUI();
  },

  setAppearance(item, mode) {
    if (item.appearance === mode) return;
    item.appearance = mode;
    const colors = {highlight: '#ffd65a', valid: '#60ff91', invalid: '#ff5062'};
    for (const state of item.materials) {
      const material = state.material;
      if (mode === 'normal') {
        if (state.color) material.color.copy(state.color);
        if (state.emissive) material.emissive.copy(state.emissive);
        material.emissiveIntensity = state.emissiveIntensity;
        material.transparent = state.transparent;
        material.opacity = state.opacity;
        material.depthWrite = state.depthWrite;
      } else {
        const tint = colors[mode];
        if (material.color && state.color) material.color.copy(state.color).lerp(new THREE.Color(tint), 0.35);
        if (material.emissive) {
          material.emissive.set(tint);
          material.emissiveIntensity = mode === 'highlight' ? 0.35 : 0.18;
        }
        material.transparent = state.transparent;
        material.opacity = state.opacity;
        material.depthWrite = state.depthWrite;
      }
      material.needsUpdate = true;
    }
  },

  updateInteractionUI() {
    const hint = document.getElementById('interaction-hint');
    let message = '';
    let buttonLabel = 'Dekati furnitur';
    let disabled = true;
    if (this.grabbedItem) {
      const item = this.grabbedItem;
      const controls = this.scene.is('vr-mode') ? 'trigger letakkan · stik kanan putar' : 'F letakkan · Q/R putar 15°';
      const heightControls = this.scene.is('vr-mode') ? ' · stik kanan atas/bawah tinggi' : ' · T/G tinggi';
      message = item.valid
        ? `${item.label} · ${controls}${item.role === 'tv' ? heightControls : ''}`
        : `${item.label} · preview merah; F kembali ke posisi valid terakhir`;
      buttonLabel = item.valid ? 'Letakkan' : 'Kembali ke posisi valid';
      disabled = false;
    } else if (this.nearbyItem) {
      message = this.scene.is('vr-mode')
        ? `Tekan trigger untuk mengambil · ${this.nearbyItem.label}`
        : `Tekan F untuk Mengambil · ${this.nearbyItem.label}`;
      buttonLabel = `Ambil ${this.nearbyItem.label}`;
      disabled = false;
    }
    if (hint && message !== this.lastHint) {
      hint.textContent = message;
      hint.hidden = !message;
      this.lastHint = message;
    }
    if (this.grabButton) {
      if (buttonLabel !== this.lastButtonLabel) {
        this.grabButton.textContent = buttonLabel;
        this.lastButtonLabel = buttonLabel;
      }
      this.grabButton.disabled = disabled;
    }
    if (this.rotateLeftButton) this.rotateLeftButton.disabled = !this.grabbedItem;
    if (this.rotateRightButton) this.rotateRightButton.disabled = !this.grabbedItem;
    const isTV = this.grabbedItem?.role === 'tv';
    if (this.heightUpButton) this.heightUpButton.disabled = !isTV;
    if (this.heightDownButton) this.heightDownButton.disabled = !isTV;
    this.scene.components['ergonomics-evaluator']?.setInteractionHint(message);
  },

  updateVRButtons() {
    const session = this.scene.renderer?.xr?.getSession?.();
    const source = session?.inputSources?.find(input => input.handedness === 'right' && input.gamepad);
    const buttons = source?.gamepad?.buttons || [];
    const axes = source?.gamepad?.axes || [];
    const stickX = axes.length >= 4 ? axes[2] : axes[0] || 0;
    const stickY = axes.length >= 4 ? axes[3] : axes[1] || 0;
    const pressed = {
      grab: !!buttons[0]?.pressed,
      left: !!buttons[4]?.pressed || stickX < -0.72,
      right: !!buttons[5]?.pressed || stickX > 0.72,
      up: stickY < -0.72,
      down: stickY > 0.72
    };
    if (pressed.grab && !this.vrButtonState.grab) this.toggleGrab();
    if (pressed.left && !this.vrButtonState.left) this.rotateGrabbed(-15);
    if (pressed.right && !this.vrButtonState.right) this.rotateGrabbed(15);
    if (pressed.up && !this.vrButtonState.up) this.adjustHeight(0.1);
    if (pressed.down && !this.vrButtonState.down) this.adjustHeight(-0.1);
    this.vrButtonState = pressed;
  },

  remove() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keydown', this.onPopupKeyDown);
    this.fPopupClose?.removeEventListener('click', this.onFPopupClose);
    this.fPopup?.removeEventListener('click', this.onPopupBackdropClick);
    this.grabButton?.removeEventListener('click', this.onGrabClick);
    this.rotateLeftButton?.removeEventListener('click', this.onRotateLeft);
    this.rotateRightButton?.removeEventListener('click', this.onRotateRight);
    this.heightUpButton?.removeEventListener('click', this.onHeightUp);
    this.heightDownButton?.removeEventListener('click', this.onHeightDown);
    const speakerTemplate = document.getElementById('speaker-template');
    speakerTemplate?.removeEventListener('model-loaded', this.onSpeakerModelLoaded);
    speakerTemplate?.removeEventListener('model-error', this.onSpeakerModelError);
    this.preview?.remove();
    this.placementMarker?.remove();
    for (const helper of this.overlapDebugHelpers) helper.remove();
  }
});
