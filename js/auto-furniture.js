const AUTO_PLACEMENT_MARGIN = 0.045;
const AUTO_PLACEMENT_FLOOR_GAP = 0.015;
const SOFA_SET_FLOOR_GAP = 0.005;
const AUTO_PLACEMENT_STEP = 0.18;

function classifyAutoModel(filename) {
  const name = filename.toLowerCase().replace(/[_-]+/g, " ");
  if (/speaker|soundbar|audio/.test(name)) {
    return /duo|pair|set|twin/.test(name)
      ? { type: "speaker-pair", label: "Speaker pair" }
      : { type: "speaker", label: "Speaker" };
  }
  if (/air purifier|air cleaner|aircleaner|purifier/.test(name))
    return { type: "purifier", label: "Air Purifier" };
  if (/sofa set|set sofa|living room set/.test(name))
    return { type: "sofa-set", label: "Sofa set" };
  if (/sofa|couch|loveseat/.test(name)) return { type: "sofa", label: "Sofa" };
  if (/lamp|floor light|standing light/.test(name))
    return { type: "lamp", label: "Lamp" };
  if (/tv stand|tv bench|tv table|tv console|meja tv/.test(name))
    return { type: "tv-stand", label: "TV stand" };
  if (/table|meja|coffee table/.test(name))
    return { type: "table", label: "Table" };
  if (/chair|armchair|recliner/.test(name))
    return { type: "chair", label: "Chair" };
  if (/cabinet|console|shelf|rak/.test(name))
    return { type: "cabinet", label: "Cabinet" };
  if (/\btv\b|television|monitor|display/.test(name))
    return { type: "tv", label: "TV" };
  return { type: "generic", label: "Furniture" };
}

function autoModelPriority(type) {
  return (
    {
      "tv-stand": 0,
      tv: 1,
      sofa: 2,
      "sofa-set": 2,
      "speaker-pair": 3,
      speaker: 3,
      table: 4,
      cabinet: 5,
      chair: 6,
      lamp: 7,
      purifier: 8,
      generic: 9,
    }[type] ?? 10
  );
}

function vectorData(vector, digits = 3) {
  return {
    x: Number(vector.x.toFixed(digits)),
    y: Number(vector.y.toFixed(digits)),
    z: Number(vector.z.toFixed(digits)),
  };
}

AFRAME.registerComponent("auto-furniture-loader", {
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
    window.addEventListener(
      "living-room-model-catalog-ready",
      this.onCatalogReady,
    );
  },

  tick() {
    if (this.started || !this.catalogReady) return;
    const shell = this.scene.components["room-shell"];
    const editor = this.scene.components["furniture-editor"];
    if (!shell?.collisionReady || !editor?.furnitureInitialized) return;

    this.shell = shell;
    this.started = true;
    this.enqueueCatalog(this.catalog);
    if (!this.queue.length) {
      console.info("[Models] No eligible .glb files found in models/.");
      return;
    }
    console.info("[Models] Automatic furniture loading started.");
    this.loadNextModel();
  },

  enqueueCatalog(catalog) {
    const entries = catalog
      .filter((item) => item && item.path && /\.glb(?:$|\?)/i.test(item.path))
      .map((item) => {
        const role = classifyAutoModel(
          item.filename || item.path.split("/").pop(),
        );
        return { ...item, role, priority: autoModelPriority(role.type) };
      })
      .sort((a, b) => a.priority - b.priority);

    for (const item of entries) {
      if (this.seenPaths.has(item.path)) continue;
      this.seenPaths.add(item.path);
      if (item.role.type === "speaker-pair") {
        const pairKey = item.filename || item.path;
        if (this.speakerPairSupport.has(pairKey)) continue;
        this.speakerPairSupport.set(pairKey, true);
      }
      this.queue.push(item);
    }
    this.queue.sort((a, b) => a.priority - b.priority);
  },

  loadNextModel() {
    if (this.loading || !this.queue.length) return;
    this.loading = true;
    const descriptor = this.queue.shift();

    this.loadModel(descriptor)
      .then(() => {
        this.loading = false;
        this.loadNextModel();
      })
      .catch((error) => {
        console.error("[Models] Failed to load model:", descriptor.path, error);
        this.loading = false;
        this.loadNextModel();
      });
  },

  loadModel(descriptor) {
    return new Promise((resolve, reject) => {
      const entity = document.createElement("a-entity");
      entity.setAttribute("gltf-model", descriptor.path);
      entity.addEventListener(
        "model-loaded",
        () => {
          try {
            this.placeModel(entity, descriptor);
            resolve(entity);
          } catch (error) {
            entity.remove();
            reject(error);
          }
        },
        { once: true },
      );
      entity.addEventListener(
        "model-error",
        (event) => {
          entity.remove();
          reject(event.detail?.src || new Error("Model loading error."));
        },
        { once: true },
      );
      this.scene.appendChild(entity);
    });
  },

  getModelBox(entity) {
    this.scene.object3D.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(entity.object3D);
    if (box.isEmpty()) throw new Error("Model has no measurable geometry.");
    return box;
  },

  getRoom() {
    const room = window.LivingRoom?.layout;
    if (!room) throw new Error("Living Room dimensions are unavailable.");
    return room;
  },

  getFloorY() {
    return Math.max(0, this.getRoom().floorY);
  },

  getPlacedModel(type) {
    return (
      this.placedModels.find(
        (item) =>
          item.role.type === type ||
          (type === "sofa" && item.role.type === "sofa-set"),
      ) || null
    );
  },

  boxCenter(box) {
    return box.getCenter(new THREE.Vector3());
  },

  preferredYaw(item) {
    if (item.role.type === "sofa" || item.role.type === "sofa-set")
      return Math.PI;
    // Rotate the speaker and TV stand on the horizontal (Y) axis.
    if (item.role.type === "tv-stand") return -Math.PI / 2;
    if (item.role.type === "speaker" || item.role.type === "speaker-pair")
      return -Math.PI / 2;
    if (item.role.type === "tv") return 0;
    if (item.role.type === "chair") return Math.PI;
    if (item.role.type === "cabinet") return -Math.PI / 2;
    return 0;
  },

  preferredCenter(item, box) {
    const room = this.getRoom();
    const size = box.getSize(new THREE.Vector3());
    const sofa = this.getPlacedModel("sofa");
    const tv = this.getPlacedModel("tv");
    const tvStand = this.getPlacedModel("tv-stand");
    const sofaBox = sofa?.bounds;
    const tvBox = tv?.bounds;
    const roomCenterX = (room.inside.minX + room.inside.maxX) / 2;
    const roomCenterZ = (room.inside.minZ + room.inside.maxZ) / 2;
    const backZ = room.inside.minZ;

    switch (item.role.type) {
      case "tv":
        if (tvStand) {
          const standCenter = this.boxCenter(tvStand.bounds);
          return new THREE.Vector3(
            standCenter.x,
            this.getFloorY(),
            standCenter.z,
          );
        }
        return new THREE.Vector3(
          roomCenterX,
          this.getFloorY(),
          backZ + size.z / 2 + 0.08,
        );
      case "tv-stand":
        return new THREE.Vector3(
          roomCenterX,
          this.getFloorY(),
          backZ + size.z / 2 + 0.08,
        );
      case "speaker-pair":
        return new THREE.Vector3(
          roomCenterX,
          this.getFloorY(),
          tvBox ? this.boxCenter(tvBox).z : backZ + 0.5,
        );
      case "speaker": {
        const sideSign = item.side === "left" ? -1 : 1;
        const tvCenter = tvBox
          ? this.boxCenter(tvBox)
          : new THREE.Vector3(roomCenterX, this.getFloorY(), backZ + 0.5);
        const speakerWidth = Math.max(size.x, size.z);
        const standBox = tvStand?.bounds;
        const tvWidth = tvBox
          ? Math.max(tvBox.max.x - tvBox.min.x, tvBox.max.z - tvBox.min.z)
          : 1.55;
        const standWidth = standBox
          ? Math.max(
              standBox.max.x - standBox.min.x,
              standBox.max.z - standBox.min.z,
            )
          : 0;
        const systemWidth = Math.max(tvWidth, standWidth);
        const x =
          tvCenter.x + sideSign * (systemWidth / 2 + speakerWidth / 2 + 0.12);
        return new THREE.Vector3(x, this.getFloorY(), tvCenter.z);
      }
      case "sofa":
        return new THREE.Vector3(
          roomCenterX,
          this.getFloorY(),
          backZ + size.z / 2 + 0.28,
        );
      case "sofa-set": {
        const tvFront = tvBox ? tvBox.max.z : backZ + 0.6;
        const viewingClearance = 0.7;
        return new THREE.Vector3(
          roomCenterX,
          this.getFloorY(),
          tvFront + size.z / 2 + viewingClearance,
        );
      }
      case "table": {
        const z = sofaBox
          ? sofaBox.max.z + size.z / 2 + 0.35
          : roomCenterZ - 0.55;
        const x = sofaBox ? this.boxCenter(sofaBox).x : roomCenterX;
        return new THREE.Vector3(x, this.getFloorY(), z);
      }
      case "lamp": {
        if (sofaBox)
          return new THREE.Vector3(
            sofaBox.min.x - size.x / 2 - 0.18,
            this.getFloorY(),
            this.boxCenter(sofaBox).z,
          );
        return new THREE.Vector3(
          room.inside.minX + size.x / 2 + 0.22,
          this.getFloorY(),
          backZ + size.z / 2 + 0.5,
        );
      }
      case "purifier":
        return new THREE.Vector3(
          room.inside.maxX - size.x / 2 - 0.16,
          this.getFloorY(),
          backZ + size.z / 2 + 0.16,
        );
      case "cabinet":
        return new THREE.Vector3(
          room.inside.minX + size.x / 2 + 0.16,
          this.getFloorY(),
          roomCenterZ,
        );
      case "chair": {
        if (sofaBox)
          return new THREE.Vector3(
            sofaBox.max.x + size.x / 2 + 0.35,
            this.getFloorY(),
            this.boxCenter(sofaBox).z + size.z * 0.25,
          );
        return new THREE.Vector3(
          roomCenterX + 1.1,
          this.getFloorY(),
          roomCenterZ - 0.7,
        );
      }
      default:
        return new THREE.Vector3(roomCenterX, this.getFloorY(), roomCenterZ);
    }
  },

  candidateBox(baseBox, centerX, centerZ, baseY, item) {
    const center = baseBox.getCenter(new THREE.Vector3());
    const floorGap =
      item.role.type === "sofa-set"
        ? SOFA_SET_FLOOR_GAP
        : AUTO_PLACEMENT_FLOOR_GAP;
    const delta = new THREE.Vector3(
      centerX - center.x,
      baseY + floorGap - baseBox.min.y,
      centerZ - center.z,
    );
    return { box: baseBox.clone().translate(delta), delta };
  },

  collidesWithBox(box, collider) {
    if (!Number.isFinite(collider.minX) || !Number.isFinite(collider.maxX))
      return false;
    const verticalOverlap =
      Math.min(box.max.y, collider.maxY) - Math.max(box.min.y, collider.minY);
    const xOverlap =
      Math.min(box.max.x, collider.maxX) - Math.max(box.min.x, collider.minX);
    const zOverlap =
      Math.min(box.max.z, collider.maxZ) - Math.max(box.min.z, collider.minZ);
    return verticalOverlap > 0.02 && xOverlap > 0.025 && zOverlap > 0.025;
  },

  isValidCandidate(box, item) {
    const room = this.getRoom();
    const inside = room.inside;
    const margin = AUTO_PLACEMENT_MARGIN;

    if (
      box.min.x < inside.minX + margin ||
      box.max.x > inside.maxX - margin ||
      box.min.z < inside.minZ + margin ||
      box.max.z > inside.maxZ - margin
    )
      return false;

    const ownColliders = item.colliders || [];
    for (const collider of this.shell.colliders) {
      if (ownColliders.includes(collider)) continue;
      if (this.collidesWithBox(box, collider)) return false;
    }
    return true;
  },

  findNearestFreePosition(baseBox, desired, item) {
    const room = this.getRoom();
    const center = this.boxCenter(baseBox);
    const maxRadius = Math.max(
      room.inside.maxX - room.inside.minX,
      room.inside.maxZ - room.inside.minZ,
    );
    const directions = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];

    for (let radius = 0; radius <= maxRadius; radius += AUTO_PLACEMENT_STEP) {
      for (const [dx, dz] of directions) {
        const x = desired.x + dx * radius;
        const z = desired.z + dz * radius;
        const candidate = this.candidateBox(baseBox, x, z, item.baseY, item);
        if (this.isValidCandidate(candidate.box, item)) return candidate;
      }
    }
    return null;
  },

  fitInsideRoom(entity) {
    const room = this.getRoom();
    const box = this.getModelBox(entity);
    const size = box.getSize(new THREE.Vector3());
    const maxWidth =
      room.inside.maxX - room.inside.minX - AUTO_PLACEMENT_MARGIN * 2;
    const maxDepth =
      room.inside.maxZ - room.inside.minZ - AUTO_PLACEMENT_MARGIN * 2;
    const factor = Math.min(1, maxWidth / size.x, maxDepth / size.z);

    if (factor < 1) {
      entity.object3D.scale.multiplyScalar(factor);
      this.scene.object3D.updateMatrixWorld(true);
      return this.getModelBox(entity);
    }
    return box;
  },

  fitModelScale(entity, role, box) {
    const size = box.getSize(new THREE.Vector3());
    const maxDimensions = {
      tv: 2.2,
      "tv-stand": 2.8,
      sofa: 3.2,
      "sofa-set": 4.5,
      speaker: 0.8,
      "speaker-pair": 1.4,
      table: 1.8,
      cabinet: 2.2,
      chair: 1.2,
      lamp: 0.8,
      purifier: 0.8,
      generic: 1.8,
    };
    const maxSize = maxDimensions[role.type] || 1.8;
    const longest = Math.max(size.x, size.z);
    const factor = longest > maxSize ? maxSize / longest : 1;

    if (factor < 1) {
      entity.object3D.scale.multiplyScalar(factor);
      this.scene.object3D.updateMatrixWorld(true);
      return this.getModelBox(entity);
    }
    return box;
  },

  createSofaSetColliders(entity, descriptor) {
    const box = this.getModelBox(entity);
    const size = box.getSize(new THREE.Vector3());
    const center = this.boxCenter(box);
    const colliders = [];

    const collider = {
      kind: "auto-model",
      name: entity.id || descriptor.filename,
      modelName: descriptor.filename,
      modelPath: descriptor.path,
      minX: box.min.x,
      maxX: box.max.x,
      minY: box.min.y,
      maxY: box.max.y,
      minZ: box.min.z,
      maxZ: box.max.z,
    };
    colliders.push(collider);

    return colliders;
  },

  placeModel(entity, descriptor) {
    const uprightX = descriptor.uprightX || 0;
    const root = entity.object3D;
    const role = descriptor.role;
    const tvStand = role.type === "tv" ? this.getPlacedModel("tv-stand") : null;
    const item = {
      entity,
      root,
      descriptor,
      role,
      side: descriptor.side,
      bounds: null,
      collider: null,
      baseY: tvStand ? tvStand.bounds.max.y : this.getFloorY(),
    };
    let box = this.getModelBox(entity);
    const rawSize = box.getSize(new THREE.Vector3());
    box = this.fitModelScale(entity, item.role, box);
    const yaw = this.preferredYaw(item);
    entity.object3D.rotation.order = uprightX ? "YXZ" : "XYZ";
    entity.object3D.rotation.set(uprightX, yaw, 0);
    this.scene.object3D.updateMatrixWorld(true);
    box = this.fitInsideRoom(entity);

    let desired = this.preferredCenter(item, box);
    const relationalPlacement = [
      "tv",
      "tv-stand",
      "speaker",
      "speaker-pair",
    ].includes(role.type);
    let placement = relationalPlacement
      ? this.candidateBox(box, desired.x, desired.z, item.baseY, item)
      : this.findNearestFreePosition(box, desired, item);
    let crowdScale = 1;
    while (!placement && !relationalPlacement && crowdScale > 0.35) {
      crowdScale *= 0.85;
      entity.object3D.scale.multiplyScalar(0.85);
      box = this.fitInsideRoom(entity);
      desired = this.preferredCenter(item, box);
      placement = this.findNearestFreePosition(box, desired, item);
    }
    if (!placement)
      throw new Error("No collision-free position was found inside the room.");

    entity.object3D.position.add(placement.delta);
    this.scene.object3D.updateMatrixWorld(true);
    item.bounds = this.getModelBox(entity);
    item.bounds.getSize(this.size);
    const finalCenter = this.boxCenter(item.bounds);
    const relocated =
      Math.hypot(finalCenter.x - desired.x, finalCenter.z - desired.z) > 0.08;
    item.collider = {
      kind: "auto-model",
      name: entity.id,
      modelName: descriptor.filename,
      modelPath: descriptor.path,
      minX: item.bounds.min.x,
      maxX: item.bounds.max.x,
      minY: item.bounds.min.y,
      maxY: item.bounds.max.y,
      minZ: item.bounds.min.z,
      maxZ: item.bounds.max.z,
    };
    item.colliders =
      role.type === "sofa-set"
        ? this.createSofaSetColliders(entity, descriptor)
        : [item.collider];
    this.shell.colliders.push(...item.colliders);
    if (this.shell.debug) {
      for (const collider of item.colliders) {
        this.shell.addDebugBox(collider, "#ff9c38", `${collider.name}-debug`);
      }
      const panel = document.getElementById("collision-debug-panel");
      if (panel) {
        const wallCount = this.shell.colliders.filter(
          (box) => box.kind === "wall",
        ).length;
        const furnitureCount = this.shell.colliders.filter(
          (box) => box.kind === "furniture",
        ).length;
        panel.textContent = `DEBUG COLLISION: ON · Dinding: ${wallCount}/4 · Furnitur: ${furnitureCount}`;
      }
    }
    this.placedModels.push(item);

    const rotation = entity.object3D.rotation;
    const report = {
      modelName: descriptor.instanceName,
      path: descriptor.path,
      dimensionsBeforeScale: {
        width: Number(Math.max(rawSize.x, rawSize.z).toFixed(3)),
        height: Number(rawSize.y.toFixed(3)),
        length: Number(Math.min(rawSize.x, rawSize.z).toFixed(3)),
      },
      dimensionsAfterScale: {
        width: Number(Math.max(this.size.x, this.size.z).toFixed(3)),
        height: Number(this.size.y.toFixed(3)),
        length: Number(Math.min(this.size.x, this.size.z).toFixed(3)),
      },
      position: vectorData(entity.object3D.position),
      rotation: {
        x: Number(THREE.MathUtils.radToDeg(rotation.x).toFixed(1)),
        y: Number(THREE.MathUtils.radToDeg(rotation.y).toFixed(1)),
        z: Number(THREE.MathUtils.radToDeg(rotation.z).toFixed(1)),
      },
      scale: vectorData(entity.object3D.scale),
      collider: { ...item.collider },
    };
    if (role.type === "sofa-set") {
      report.colliders = item.colliders.map((collider) => ({
        name: collider.name,
        bounds: {
          min: [collider.minX, collider.minY, collider.minZ].map((value) =>
            Number(value.toFixed(3)),
          ),
          max: [collider.maxX, collider.maxY, collider.maxZ].map((value) =>
            Number(value.toFixed(3)),
          ),
        },
      }));
    }
    console.info("Model Loaded Successfully", {
      modelName: descriptor.instanceName,
      path: descriptor.path,
    });
    console.info("Model Name Position Rotation Scale", report);
    if (relocated) {
      console.info(
        "[Models] Preferred spot was occupied; nearest clear position selected.",
        {
          modelName: descriptor.instanceName,
          preferredCenter: vectorData(desired),
          finalCenter: vectorData(finalCenter),
        },
      );
    }
    if (!this.isValidCandidate(item.bounds, item)) {
      console.warn("[Models] Collision validation failed after placement.", {
        modelName: descriptor.instanceName,
        path: descriptor.path,
        bounds: item.bounds.clone(),
      });
    }
  },

  remove() {
    window.removeEventListener(
      "living-room-model-catalog-ready",
      this.onCatalogReady,
    );
  },
});
