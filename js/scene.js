const ROOM_LAYOUT = {
  // Interior perimeter measured from the transformed GLB, in scene meters.
  inside: {minX: -2.993, maxX: 2.993, minZ: -3.96, maxZ: 2.38},
  floorY: -0.1,
  ceilingY: 4.58,
  wallThickness: 0.16,
  wallDepthStart: -3.96,
  wallDepthEnd: 3.65,
  // The GLB has walls on -X, -Z, and +Z. Only the +X side is open.
  openings: [{side: 'right', line: 2.993, start: -3.96, end: 3.65}]
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
window.LivingRoom = window.LivingRoom || {};
window.LivingRoom.layout = ROOM_LAYOUT;

AFRAME.registerComponent('spawn-look', {
  dependencies: ['look-controls'],

  init() {
    const look = this.el.components['look-controls'];
    const rotation = this.el.getAttribute('rotation');
    look.yawObject.rotation.y = THREE.MathUtils.degToRad(rotation.y);
    look.pitchObject.rotation.x = THREE.MathUtils.degToRad(rotation.x);
  }
});

AFRAME.registerComponent('fps-controls', {
  schema: {speed: {default: 1.35}},
  dependencies: ['room-collision'],

  init() {
    this.keys = new Set();
    this.touchAxis = {x: 0, y: 0};
    this.touchPointer = null;
    this.direction = new THREE.Vector3();
    this.camera = document.getElementById('player-camera');
    this.touchZone = document.getElementById('touch-move');

    this.onKeyDown = event => {
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) return;
      event.preventDefault();
      this.keys.add(event.code);
    };
    this.onKeyUp = event => this.keys.delete(event.code);
    this.clearInput = () => {
      this.keys.clear();
      this.touchAxis.x = 0;
      this.touchAxis.y = 0;
      this.touchPointer = null;
    };
    this.onPointerDown = event => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      this.touchPointer = {id: event.pointerId, x: event.clientX, y: event.clientY};
      this.touchZone.setPointerCapture?.(event.pointerId);
    };
    this.onPointerMove = event => {
      if (!this.touchPointer || event.pointerId !== this.touchPointer.id) return;
      event.preventDefault();
      event.stopPropagation();
      this.touchAxis.x = clamp((event.clientX - this.touchPointer.x) / 70, -1, 1);
      this.touchAxis.y = clamp((this.touchPointer.y - event.clientY) / 70, -1, 1);
    };
    this.onPointerEnd = event => {
      if (!this.touchPointer || event.pointerId !== this.touchPointer.id) return;
      this.touchPointer = null;
      this.touchAxis.x = 0;
      this.touchAxis.y = 0;
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearInput);
    this.touchZone?.addEventListener('pointerdown', this.onPointerDown);
    this.touchZone?.addEventListener('pointermove', this.onPointerMove);
    this.touchZone?.addEventListener('pointerup', this.onPointerEnd);
    this.touchZone?.addEventListener('pointercancel', this.onPointerEnd);
  },

  getVRAxis() {
    if (!this.el.sceneEl.is('vr-mode')) return null;
    const session = this.el.sceneEl.renderer?.xr?.getSession?.();
    const source = session?.inputSources?.find(input => input.handedness === 'left' && input.gamepad);
    if (!source) return null;

    const axes = source.gamepad.axes;
    const axisX = axes.length >= 4 ? axes[2] : axes[0];
    const axisY = axes.length >= 4 ? axes[3] : axes[1];
    return {
      x: Math.abs(axisX) < 0.18 ? 0 : axisX,
      y: Math.abs(axisY) < 0.18 ? 0 : -axisY
    };
  },

  tick(time, delta) {
    let strafe = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    let forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));

    if (this.touchPointer) {
      strafe = this.touchAxis.x;
      forward = this.touchAxis.y;
    }

    const vrAxis = this.getVRAxis();
    if (vrAxis) {
      strafe = vrAxis.x;
      forward = vrAxis.y;
    }

    const inputLength = Math.hypot(strafe, forward);
    if (inputLength > 1) {
      strafe /= inputLength;
      forward /= inputLength;
    }

    const cameraObject = this.camera.object3D;
    let yaw;
    if (this.el.sceneEl.is('vr-mode')) {
      cameraObject.getWorldDirection(this.direction);
      yaw = Math.atan2(-this.direction.x, -this.direction.z);
    } else {
      yaw = this.camera.components['look-controls'].yawObject.rotation.y;
    }

    const step = this.data.speed * Math.min(delta || 0, 50) / 1000;
    const dx = (strafe * Math.cos(yaw) - forward * Math.sin(yaw)) * step;
    const dz = (strafe * Math.sin(yaw) - forward * Math.cos(yaw)) * step;
    this.el.components['room-collision'].move(dx, dz);
    this.el.components['room-collision'].constrainTrackedCamera(this.camera);
  },

  remove() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearInput);
    this.touchZone?.removeEventListener('pointerdown', this.onPointerDown);
    this.touchZone?.removeEventListener('pointermove', this.onPointerMove);
    this.touchZone?.removeEventListener('pointerup', this.onPointerEnd);
    this.touchZone?.removeEventListener('pointercancel', this.onPointerEnd);
  }
});

AFRAME.registerComponent('room-collision', {
  schema: {radius: {default: 0.18}},

  init() {
    this.cameraPosition = new THREE.Vector3();
    this.scene = this.el.sceneEl;
  },

  getRoomShell() {
    return this.scene.components['room-shell'];
  },

  canOccupy(x, z) {
    const shell = this.getRoomShell();
    const bounds = shell.playerBounds;
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return false;

    const feetY = this.el.object3D.position.y - 0.05;
    const headY = feetY + 1.8;

    return !shell.colliders.some(box => {
      const editor = this.scene.components['furniture-editor'];
      if (box.itemId && box.itemId === editor?.grabbedItem?.id) return false;
      if (box.maxY <= feetY || box.minY >= headY) return false;
      const closestX = clamp(x, box.minX, box.maxX);
      const closestZ = clamp(z, box.minZ, box.maxZ);
      const dx = x - closestX;
      const dz = z - closestZ;
      return dx * dx + dz * dz < this.data.radius * this.data.radius;
    });
  },

  move(dx, dz) {
    const position = this.el.object3D.position;
    const vr = this.el.sceneEl.is('vr-mode');
    let baseX = position.x;
    let baseZ = position.z;
    if (vr) {
      this.scene.object3D.updateMatrixWorld(true);
      this.cameraPosition.setFromMatrixPosition(this.scene.querySelector('#player-camera').object3D.matrixWorld);
      baseX = this.cameraPosition.x;
      baseZ = this.cameraPosition.z;
    }

    if (!this.canOccupy(baseX, baseZ)) {
      const free = this.findNearestFreePosition(baseX, baseZ);
      if (free) {
        position.x += free.x - baseX;
        position.z += free.z - baseZ;
        baseX = free.x;
        baseZ = free.z;
      }
    }

    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (this.data.radius * 0.5)));
    let movedX = 0;
    let movedZ = 0;
    for (let index = 0; index < steps; index++) {
      const stepX = dx / steps;
      const stepZ = dz / steps;
      if (this.canOccupy(baseX + movedX + stepX, baseZ + movedZ)) movedX += stepX;
      if (this.canOccupy(baseX + movedX, baseZ + movedZ + stepZ)) movedZ += stepZ;
    }
    position.x += movedX;
    position.z += movedZ;
  },

  constrainTrackedCamera(camera) {
    const scene = this.el.sceneEl;
    scene.object3D.updateMatrixWorld(true);
    camera.object3D.getWorldPosition(this.cameraPosition);
    const shell = this.getRoomShell();
    const bounds = shell.playerBounds;
    const x = clamp(this.cameraPosition.x, bounds.minX, bounds.maxX);
    const z = clamp(this.cameraPosition.z, bounds.minZ, bounds.maxZ);
    const safe = this.canOccupy(x, z) ? {x, z} : this.findNearestFreePosition(x, z, 1.25);
    if (!safe) return;
    this.el.object3D.position.x += safe.x - this.cameraPosition.x;
    this.el.object3D.position.z += safe.z - this.cameraPosition.z;
  },

  findNearestFreePosition(x, z, maxDistance = 1.5) {
    if (this.canOccupy(x, z)) return {x, z};
    const step = Math.max(0.06, this.data.radius * 0.4);
    for (let distance = step; distance <= maxDistance; distance += step) {
      const count = Math.max(16, Math.ceil(Math.PI * 2 * distance / step));
      for (let index = 0; index < count; index++) {
        const angle = index * Math.PI * 2 / count;
        const candidateX = x + Math.cos(angle) * distance;
        const candidateZ = z + Math.sin(angle) * distance;
        if (this.canOccupy(candidateX, candidateZ)) return {x: candidateX, z: candidateZ};
      }
    }
    return null;
  }
});

AFRAME.registerComponent('room-shell', {
  init() {
    this.playerBounds = {
      minX: ROOM_LAYOUT.inside.minX + 0.18,
      maxX: ROOM_LAYOUT.inside.maxX - 0.18,
      minZ: ROOM_LAYOUT.inside.minZ + 0.18,
      maxZ: ROOM_LAYOUT.inside.maxZ - 0.18
    };
    this.colliders = [];
    this.walls = [];
    this.furnitureParts = [];
    this.collisionSetupStarted = false;
    this.collisionReady = false;
    const params = new URLSearchParams(location.search);
    this.debug = params.get('collisionDebug') === '1' || params.get('wallDebug') === '1';
    this.debugHelpers = [];

    const scene = this.el;
    this.startWhenSceneLoaded = () => {
      const model = scene.querySelector('#living-room');
      if (!model) {
        console.error('[LivingRoom] Cannot create wall extensions: #living-room was not found.');
        return;
      }
      const finish = () => {
        if (this.collisionSetupStarted) return;
        this.collisionSetupStarted = true;
        requestAnimationFrame(() => {
          try {
            if (!model.getObject3D('mesh')) throw new Error('Living room GLB mesh is not ready.');
            this.createExtensions();
            requestAnimationFrame(() => {
              try {
                this.finishExtensions(model);
                this.collisionReady = true;
              } catch (error) {
                this.collisionSetupStarted = false;
                console.error('[LivingRoom] Could not finish room collision setup:', error);
              }
            });
          } catch (error) {
            this.collisionSetupStarted = false;
            console.error('[LivingRoom] Could not create room collision setup:', error);
          }
        });
      };
      if (model.components['gltf-model']?.model || model.getObject3D('mesh')) finish();
      else model.addEventListener('model-loaded', finish, {once: true});
    };
    if (scene.hasLoaded) this.startWhenSceneLoaded();
    else scene.addEventListener('loaded', this.startWhenSceneLoaded, {once: true});

    scene.addEventListener('enter-vr', () => document.body.classList.add('in-vr'));
    scene.addEventListener('exit-vr', () => document.body.classList.remove('in-vr'));
    if (navigator.xr?.isSessionSupported) {
      navigator.xr.isSessionSupported('immersive-vr').then(supported => {
        document.body.classList.toggle('xr-capable', supported);
      }).catch(() => document.body.classList.remove('xr-capable'));
    }
  },

  createExtensions() {
    const centerY = (ROOM_LAYOUT.floorY + ROOM_LAYOUT.ceilingY) / 2;
    const height = ROOM_LAYOUT.ceilingY - ROOM_LAYOUT.floorY;
    const width = ROOM_LAYOUT.wallThickness;

    for (const opening of ROOM_LAYOUT.openings) {
      const wall = document.createElement('a-box');
      const length = opening.end - opening.start;
      const center = (opening.start + opening.end) / 2;
      const isXSide = opening.side === 'right' || opening.side === 'left';
      const wallX = isXSide
        ? opening.line + (opening.side === 'right' ? width / 2 : -width / 2)
        : center;
      const wallZ = isXSide
        ? center
        : opening.line + (opening.side === 'front' ? width / 2 : -width / 2);
      const wallWidth = isXSide ? width : length;
      const wallDepth = isXSide ? length : width;

      wall.id = `room-wall-${opening.side}`;
      wall.setAttribute('position', `${wallX} ${centerY} ${wallZ}`);
      wall.setAttribute('width', wallWidth);
      wall.setAttribute('height', height);
      wall.setAttribute('depth', wallDepth);
      wall.setAttribute('material', 'color: #ffffff; roughness: 0.85; metalness: 0; side: double');
      sceneAppend(this.el, wall);
      this.walls.push({wall, opening, centerY, height, width: wallWidth, depth: wallDepth});
    }

    this.createPerimeterColliders();
  },

  finishExtensions(model) {
    const source = this.findWallMaterial(model.getObject3D('mesh'));
    for (const {wall} of this.walls) {
      const target = wall.getObject3D('mesh')?.material;
      if (!target || !source?.map) continue;
      const map = source.map.clone();
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(Math.max(1, wall.depth / 1.5), Math.max(1, wall.height / 1.5));
      map.needsUpdate = true;
      target.map = map;
      target.color.set('#ffffff');
      target.roughness = 0.85;
      target.metalness = 0;
      target.side = THREE.DoubleSide;
      target.needsUpdate = true;
    }

    this.createFurnitureColliders(model);
    this.createDebugHelpers();
    const collision = this.el.querySelector('#player-rig')?.components['room-collision'];
    const position = this.el.querySelector('#player-rig')?.object3D.position;
    if (collision && position && !collision.canOccupy(position.x, position.z)) {
      const free = collision.findNearestFreePosition(position.x, position.z);
      if (free) {
        position.x = free.x;
        position.z = free.z;
        console.warn('[LivingRoom] Player spawn moved to the nearest clear point.', free);
      }
    }

    const panel = document.getElementById('collision-debug-panel');
    const wallCount = this.colliders.filter(box => box.kind === 'wall').length;
    const furnitureCount = this.colliders.filter(box => box.kind === 'furniture').length;
    const gaps = this.findPerimeterGaps();
    if (panel) {
      panel.hidden = !this.debug;
      panel.textContent = `DEBUG COLLISION: ON · Dinding: ${wallCount}/4 · Furnitur: ${furnitureCount} · Celah perimeter: ${gaps.length}`;
    }
    if (this.debug && gaps.length) console.warn('[LivingRoom] Uncovered perimeter sections:', gaps);
    console.info('[LivingRoom] Wall, furniture, and player collision are ready.', {
      modelInteriorBounds: ROOM_LAYOUT.inside,
      playerBounds: this.playerBounds,
      wallColliders: this.colliders.filter(box => box.kind === 'wall'),
      furnitureColliders: furnitureCount,
      uncoveredPerimeter: gaps,
      debug: this.debug,
      inputModes: ['desktop WASD', 'mobile touch', 'WebXR left stick and tracked head']
    });
  },

  createPerimeterColliders() {
    const room = ROOM_LAYOUT.inside;
    const thickness = ROOM_LAYOUT.wallThickness;
    const bottom = ROOM_LAYOUT.floorY;
    const top = ROOM_LAYOUT.ceilingY;
    const definitions = [
      {side: 'left', minX: room.minX - thickness, maxX: room.minX, minZ: room.minZ, maxZ: room.maxZ},
      {side: 'right', minX: room.maxX, maxX: room.maxX + thickness, minZ: room.minZ, maxZ: room.maxZ},
      {side: 'back', minX: room.minX, maxX: room.maxX, minZ: room.minZ - thickness, maxZ: room.minZ},
      {side: 'front', minX: room.minX, maxX: room.maxX, minZ: room.maxZ, maxZ: room.maxZ + thickness}
    ];
    for (const wall of definitions) {
      this.colliders.push({...wall, minY: bottom, maxY: top, kind: 'wall', name: `wall-${wall.side}`});
    }
  },

  createFurnitureColliders(model) {
    const root = model.getObject3D('mesh');
    if (!root) return;
    root.updateMatrixWorld(true);

    const room = ROOM_LAYOUT.inside;
    const position = new THREE.Vector3();
    const components = [];
    root.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
      const geometry = mesh.geometry;
      const vertices = geometry.attributes.position;
      const index = geometry.index?.array;
      const triangleCount = Math.floor((index ? index.length : vertices.count) / 3);
      if (triangleCount < 20) return;

      const parents = new Int32Array(triangleCount);
      const rank = new Uint8Array(triangleCount);
      for (let triangle = 0; triangle < triangleCount; triangle++) parents[triangle] = triangle;
      const find = value => {
        let rootIndex = value;
        while (parents[rootIndex] !== rootIndex) rootIndex = parents[rootIndex];
        while (parents[value] !== value) {
          const next = parents[value];
          parents[value] = rootIndex;
          value = next;
        }
        return rootIndex;
      };
      const union = (left, right) => {
        let rootLeft = find(left);
        let rootRight = find(right);
        if (rootLeft === rootRight) return;
        if (rank[rootLeft] < rank[rootRight]) [rootLeft, rootRight] = [rootRight, rootLeft];
        parents[rootRight] = rootLeft;
        if (rank[rootLeft] === rank[rootRight]) rank[rootLeft]++;
      };

      const vertexOwner = new Map();
      const triangleVertices = new Uint32Array(triangleCount * 3);
      for (let triangle = 0; triangle < triangleCount; triangle++) {
        for (let corner = 0; corner < 3; corner++) {
          const offset = triangle * 3 + corner;
          const vertexIndex = index ? index[offset] : offset;
          triangleVertices[offset] = vertexIndex;
          const key = `${Math.round(vertices.getX(vertexIndex) * 10000)},${Math.round(vertices.getY(vertexIndex) * 10000)},${Math.round(vertices.getZ(vertexIndex) * 10000)}`;
          const owner = vertexOwner.get(key);
          if (owner === undefined) vertexOwner.set(key, triangle);
          else union(triangle, owner);
        }
      }

      const groups = new Map();
      mesh.updateWorldMatrix(true, false);
      for (let triangle = 0; triangle < triangleCount; triangle++) {
        const component = find(triangle);
        let bounds = groups.get(component);
        if (!bounds) {
          bounds = {minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, triangles: 0, triangleIds: []};
          groups.set(component, bounds);
        }
        bounds.triangles++;
        bounds.triangleIds.push(triangle);
        for (let corner = 0; corner < 3; corner++) {
          const vertexIndex = triangleVertices[triangle * 3 + corner];
          position.set(vertices.getX(vertexIndex), vertices.getY(vertexIndex), vertices.getZ(vertexIndex)).applyMatrix4(mesh.matrixWorld);
          bounds.minX = Math.min(bounds.minX, position.x);
          bounds.minY = Math.min(bounds.minY, position.y);
          bounds.minZ = Math.min(bounds.minZ, position.z);
          bounds.maxX = Math.max(bounds.maxX, position.x);
          bounds.maxY = Math.max(bounds.maxY, position.y);
          bounds.maxZ = Math.max(bounds.maxZ, position.z);
        }
      }
      for (const bounds of groups.values()) components.push({bounds, source: mesh.name || 'model-mesh', mesh});
    });

    let id = 0;
    for (const {bounds, source, mesh} of components) {
      const sizeX = bounds.maxX - bounds.minX;
      const sizeY = bounds.maxY - bounds.minY;
      const sizeZ = bounds.maxZ - bounds.minZ;
      // Skip the floor, ceiling, and broad structural walls; those are covered by the perimeter boxes.
      if (bounds.triangles < 20 || bounds.minY > 0.55 || bounds.maxY < 0.25 || sizeY < 0.2 || sizeY > 3.25 || sizeX > 3.8 || sizeZ > 3.8) continue;
      const minX = Math.max(room.minX, bounds.minX - 0.035);
      const maxX = Math.min(room.maxX, bounds.maxX + 0.035);
      const minZ = Math.max(room.minZ, bounds.minZ - 0.035);
      const maxZ = Math.min(room.maxZ, bounds.maxZ + 0.035);
      if (maxX - minX < 0.12 || maxZ - minZ < 0.12 || maxX <= room.minX || minX >= room.maxX || maxZ <= room.minZ || minZ >= room.maxZ) continue;
      const furnitureId = `furniture-${++id}`;
      const collider = {
        minX, maxX, minY: bounds.minY, maxY: bounds.maxY, minZ, maxZ,
        kind: 'furniture', id: furnitureId, itemId: furnitureId, name: `${source}-${id}`, source
      };
      this.colliders.push(collider);
      this.furnitureParts.push({
        id: furnitureId,
        name: collider.name,
        source,
        sourceMesh: mesh,
        triangleIds: bounds.triangleIds,
        bounds: {
          minX: bounds.minX, maxX: bounds.maxX,
          minY: bounds.minY, maxY: bounds.maxY,
          minZ: bounds.minZ, maxZ: bounds.maxZ
        },
        collider
      });
    }
  },

  createDebugHelpers() {
    if (!this.debug) return;
    for (const box of this.colliders) this.addDebugBox(box, box.kind === 'wall' ? '#00d9ff' : '#ff9c38', `${box.name}-debug`);
    for (const gap of this.findPerimeterGaps()) this.addDebugBox(gap.box, '#ff1744', `uncovered-${gap.side}-debug`);
  },

  addDebugBox(box, color, id) {
    const helper = document.createElement('a-box');
    helper.id = id;
    helper.setAttribute('position', `${(box.minX + box.maxX) / 2} ${(box.minY + box.maxY) / 2} ${(box.minZ + box.maxZ) / 2}`);
    helper.setAttribute('width', Math.max(0.02, box.maxX - box.minX));
    helper.setAttribute('height', Math.max(0.02, box.maxY - box.minY));
    helper.setAttribute('depth', Math.max(0.02, box.maxZ - box.minZ));
    helper.setAttribute('material', `color: ${color}; transparent: true; opacity: 0.27; depthWrite: false; side: double`);
    helper.setAttribute('visible', true);
    sceneAppend(this.el, helper);
    this.debugHelpers.push(helper);
  },

  findPerimeterGaps() {
    const room = ROOM_LAYOUT.inside;
    const sides = [
      {side: 'left', min: room.minZ, max: room.maxZ, axis: 'z'},
      {side: 'right', min: room.minZ, max: room.maxZ, axis: 'z'},
      {side: 'back', min: room.minX, max: room.maxX, axis: 'x'},
      {side: 'front', min: room.minX, max: room.maxX, axis: 'x'}
    ];
    const gaps = [];
    for (const side of sides) {
      const covered = this.colliders.filter(box => box.kind === 'wall' && box.side === side.side)
        .map(box => side.axis === 'x' ? [box.minX, box.maxX] : [box.minZ, box.maxZ])
        .sort((a, b) => a[0] - b[0]);
      let cursor = side.min;
      for (const [start, end] of covered) {
        if (start > cursor + 0.01) gaps.push({side: side.side, start: cursor, end: start, box: this.gapBox(side.side, cursor, start)});
        cursor = Math.max(cursor, end);
      }
      if (cursor < side.max - 0.01) gaps.push({side: side.side, start: cursor, end: side.max, box: this.gapBox(side.side, cursor, side.max)});
    }
    return gaps;
  },

  gapBox(side, start, end) {
    const room = ROOM_LAYOUT.inside;
    const half = ROOM_LAYOUT.wallThickness / 2;
    const common = {minY: ROOM_LAYOUT.floorY, maxY: ROOM_LAYOUT.ceilingY};
    if (side === 'left') return {...common, minX: room.minX - half, maxX: room.minX + half, minZ: start, maxZ: end};
    if (side === 'right') return {...common, minX: room.maxX - half, maxX: room.maxX + half, minZ: start, maxZ: end};
    if (side === 'back') return {...common, minX: start, maxX: end, minZ: room.minZ - half, maxZ: room.minZ + half};
    return {...common, minX: start, maxX: end, minZ: room.maxZ - half, maxZ: room.maxZ + half};
  },

  findWallMaterial(root) {
    let source = null;
    root.traverse(object => {
      if (source || !object.isMesh || !object.name.startsWith('Plane001')) return;
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      if (material?.map) source = material;
    });
    return source;
  }
});

function sceneAppend(scene, element) {
  scene.appendChild(element);
}

AFRAME.registerComponent('room-lighting', {
  init() {
    const scene = this.el;
    const setEnvironment = () => {
      if (!scene.renderer) {
        requestAnimationFrame(setEnvironment);
        return;
      }

      // The model's highly metallic floor needs an environment reflection to stay visible.
      const faces = Array.from({length: 6}, (_, index) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const context = canvas.getContext('2d');
        const gradient = context.createLinearGradient(0, 0, 0, 64);
        gradient.addColorStop(0, index === 3 ? '#77776c' : '#d5dfdf');
        gradient.addColorStop(0.6, '#a3b0ac');
        gradient.addColorStop(1, '#666b61');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 64, 64);
        return canvas;
      });

      const cube = new THREE.CubeTexture(faces);
      cube.colorSpace = THREE.SRGBColorSpace;
      cube.needsUpdate = true;
      const generator = new THREE.PMREMGenerator(scene.renderer);
      const environment = generator.fromCubemap(cube);
      scene.object3D.environment = environment.texture;
      scene.object3D.environmentIntensity = 0.65;
      cube.dispose();
      generator.dispose();
    };

    setEnvironment();
  }
});
