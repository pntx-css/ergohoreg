const FURNITURE_GRID = 0.25;
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

  // This tall, broad component is part of the room structure, so it remains static.
  if (height > 3.2 && width > 2) return {role: 'structure', label: 'Struktur ruangan'};
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

function horizontalOverlapArea(left, right) {
  const width = Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX));
  const depth = Math.max(0, Math.min(left.maxZ, right.maxZ) - Math.max(left.minZ, right.minZ));
  return width * depth;
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
    this.crosshair = document.getElementById('crosshair');
    this.debugPanel = document.getElementById('collision-debug-panel');
    this.debugMode = new URLSearchParams(location.search).get('collisionDebug') === '1' ||
      new URLSearchParams(location.search).get('wallDebug') === '1';
    this.overlapDebugHelpers = [];
    this.speakerModelLogged = false;
    this.speakerModelFailed = false;
    this.raycaster = new THREE.Raycaster();
    this.floorRaycaster = new THREE.Raycaster();
    this.floorObject = document.getElementById('ground');
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
      if (event.code === 'KeyE') {
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

    this.updateFurnitureColliders();
    this.updateVRButtons();
    if (this.grabbedItem) this.updateGrabbedItem();
    else this.updateNearbyItem();
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
    this.updateFurnitureColliders();
    this.furnitureInitialized = true;
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
    const offsetX = Math.min(0.95, Math.max(0.5, (tvWidth - size.x) * 0.34));
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
    const quaternion = transform.getWorldQuaternion(new THREE.Quaternion());
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
    transform.rotation.set(0, yaw - parentYaw, 0);
    item.rotationY = transform.rotation.y;
    item.position = transform.position;
    transform.updateMatrix();
  },

  colliderAtPose(item, pose) {
    const scale = item.transform.object3D.getWorldScale(new THREE.Vector3());
    const halfWidth = item.width * Math.abs(scale.x) / 2;
    const halfDepth = item.depth * Math.abs(scale.z) / 2;
    const height = item.height * Math.abs(scale.y);
    const halfX = Math.abs(Math.cos(pose.yaw)) * halfWidth + Math.abs(Math.sin(pose.yaw)) * halfDepth + FURNITURE_CLEARANCE;
    const halfZ = Math.abs(Math.sin(pose.yaw)) * halfWidth + Math.abs(Math.cos(pose.yaw)) * halfDepth + FURNITURE_CLEARANCE;
    const minY = item.verticalOrigin === 'center' ? pose.position.y - height / 2 : pose.position.y;
    return {
      minX: pose.position.x - halfX, maxX: pose.position.x + halfX,
      minY, maxY: minY + height,
      minZ: pose.position.z - halfZ, maxZ: pose.position.z + halfZ
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
    this.scene.object3D.updateMatrixWorld(true);
    this.camera.object3D.getWorldPosition(this.cameraPosition);
    this.camera.object3D.getWorldDirection(this.direction);
    this.direction.y = 0;
    if (this.direction.lengthSq() < 0.001) this.direction.set(0, 0, -1);
    else this.direction.normalize();

    const targetX = this.cameraPosition.x + this.direction.x * 1.35;
    const targetZ = this.cameraPosition.z + this.direction.z * 1.35;
    const floorHeight = this.getFloorHeight(targetX, targetZ);
    const candidatePose = {
      position: new THREE.Vector3(
        Math.round(targetX / FURNITURE_GRID) * FURNITURE_GRID,
        Math.max(FURNITURE_FLOOR_Y, floorHeight ?? FURNITURE_FLOOR_Y, item.baseY + item.verticalOffset),
        Math.round(targetZ / FURNITURE_GRID) * FURNITURE_GRID
      ),
      yaw: this.getParentWorldYaw(item.transform.object3D) + item.rotationY
    };
    item.moved = true;

    const candidate = {...item.collider, ...this.colliderAtPose(item, candidatePose)};
    const currentPose = this.getItemWorldPose(item);
    item.valid = floorHeight !== null && this.isValidPlacement(item, candidate) &&
      this.isPlacementPathValid(item, currentPose, candidatePose);
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
    const moveKey = `${item.id}|${item.valid}|${position.x.toFixed(2)}|${position.y.toFixed(2)}|${position.z.toFixed(2)}|${candidatePose.yaw.toFixed(3)}`;
    if (moveKey !== this.lastGrabMoveKey) {
      this.lastGrabMoveKey = moveKey;
      console.info('[LivingRoom] Grab Move', {
        id: item.id,
        position: position.toArray().map(value => Number(value.toFixed(2))),
        valid: item.valid
      });
    }
  },

  getFloorHeight(x, z) {
    if (!this.floorObject?.object3D) return null;
    this.scene.object3D.updateMatrixWorld(true);
    this.floorRaycaster.set(
      new THREE.Vector3(x, ROOM_LAYOUT.ceilingY + 1, z),
      new THREE.Vector3(0, -1, 0)
    );
    const hit = this.floorRaycaster.intersectObject(this.floorObject.object3D, true)[0];
    return hit ? Math.max(FURNITURE_FLOOR_Y, hit.point.y) : null;
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

  isValidPlacement(item, candidate) {
    const bounds = ROOM_LAYOUT.inside;
    const values = [candidate.minX, candidate.maxX, candidate.minY, candidate.maxY, candidate.minZ, candidate.maxZ];
    if (!values.every(Number.isFinite)) return false;
    if (candidate.minY < FURNITURE_FLOOR_Y - 0.001 || candidate.maxY > ROOM_LAYOUT.ceilingY - 0.02) return false;
    if (candidate.minX < bounds.minX + 0.02 || candidate.maxX > bounds.maxX - 0.02 ||
        candidate.minZ < bounds.minZ + 0.02 || candidate.maxZ > bounds.maxZ - 0.02) return false;

    return !this.shell.colliders.some(other => {
      if (other === candidate || other.itemId === item.id || other.maxY <= candidate.minY || other.minY >= candidate.maxY) return false;
      if (item.role === 'tv' && other.groupId === item.groupId) return false;
      if (item.role === 'speaker' && other.role === 'tv' && other.groupId === item.groupId) {
        const tabletopY = other.item?.speakerSurfaceY;
        const restingOnTable = Number.isFinite(tabletopY) &&
          Math.abs(candidate.minY - tabletopY) <= 0.025 &&
          candidate.minX >= other.minX && candidate.maxX <= other.maxX &&
          candidate.minZ >= other.minZ && candidate.maxZ <= other.maxZ;
        return !restingOnTable;
      }
      const overlap = horizontalOverlapArea(candidate, other);
      if (overlap <= 0) return false;
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
          if (withinInitialOverlap) return false;
        }
      }
      return true;
    });
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
      return;
    }
    if (!this.nearbyItem) return;
    this.grabbedItem = this.nearbyItem;
    this.nearbyItem = null;
    this.grabbedItem.lastValidTransform = this.captureItemTransform(this.grabbedItem);
    this.grabbedItem.valid = true;
    this.setAppearance(this.grabbedItem, 'highlight');
    console.info('[LivingRoom] Grab Start', {id: this.grabbedItem.id, item: this.grabbedItem.label});
    this.updateGrabbedItem();
    this.updateInteractionUI();
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
      const controls = this.scene.is('vr-mode') ? 'trigger letakkan · stik kanan putar' : 'E letakkan · Q/R putar 15°';
      const heightControls = this.scene.is('vr-mode') ? ' · stik kanan atas/bawah tinggi' : ' · T/G tinggi';
      message = item.valid
        ? `${item.label} · ${controls}${item.role === 'tv' ? heightControls : ''}`
        : `${item.label} · preview merah; E kembali ke posisi valid terakhir`;
      buttonLabel = item.valid ? 'Letakkan' : 'Kembali ke posisi valid';
      disabled = false;
    } else if (this.nearbyItem) {
      message = this.scene.is('vr-mode')
        ? `Tekan trigger untuk mengambil · ${this.nearbyItem.label}`
        : `Tekan E untuk Mengambil · ${this.nearbyItem.label}`;
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
