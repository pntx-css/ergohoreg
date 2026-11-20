
const ROOM_LIGHT_SOURCES = [
  { id: 'ceiling-left', position: '-1.6 3.8 -0.8', intensity: 2.2, distance: 7, group: 'ceiling' },
  { id: 'ceiling-center', position: '0 3.8 -0.8', intensity: 2.2, distance: 7, group: 'ceiling' },
  { id: 'ceiling-right', position: '1.6 3.8 -0.8', intensity: 2.2, distance: 7, group: 'ceiling' },
  { id: 'floor-lamp', position: '1.2 1.8 -1.2', intensity: 0.45, distance: 3.5, color: '#ffd49a', group: 'interior' },
  { id: 'ambient-fill', type: 'ambient', intensity: 0.35, color: '#d5dfdf', group: 'interior' },
  { id: 'door', targetId: 'pintu', intensity: 0.8, group: 'interior' },
  { id: 'hanging-lamp', targetId: 'lampugantung', intensity: 1.0, group: 'ceiling' }
];

AFRAME.registerComponent('room-point-lighting', {
  schema: {
    ceilingOn: { type: 'boolean', default: false },
    interiorOn: { type: 'boolean', default: false }
  },

  init() {
    this.lights = ROOM_LIGHT_SOURCES.map(source => {
      let light;

      if (!source.targetId) {
        light = document.createElement('a-entity');
        light.id = `room-light-${source.id}`;
        if (source.position) light.setAttribute('position', source.position);
        light.dataset.baseIntensity = String(source.intensity);

        light.setAttribute('light', {
          type: source.type || 'point',
          color: source.color || '#fff1d8',
          intensity: source.intensity,
          distance: source.distance || 0,
          decay: 2,
          castShadow: false
        });

        this.el.appendChild(light);
      } else {
        light = document.getElementById(`room-light-${source.id}`);

        if (!light) {
          console.error(`[Lighting] Missing A-Frame point light entity: room-light-${source.id}`);
          return null;
        }

        if (source.intensity !== undefined) {
          light.dataset.baseIntensity = String(source.intensity);
        }
      }

      if (source.group) light.dataset.lightGroup = source.group;
      return { source, entity: light };
    }).filter(Boolean);

    this.updateFrame = 0;
    this.updateCeilingLights();
    this.updateInteriorLights();
  },

  update(oldData) {
    if (oldData.ceilingOn !== this.data.ceilingOn) {
      this.updateCeilingLights();
    }
    if (oldData.interiorOn !== this.data.interiorOn) {
      this.updateInteriorLights();
    }
  },

  updateCeilingLights() {
    for (const entry of this.lights || []) {
      if (entry.source.group !== 'ceiling') continue;

      const light = entry.entity;
      const baseIntensity = Number(light.dataset.baseIntensity);

      light.setAttribute(
        'light',
        'intensity',
        this.data.ceilingOn ? baseIntensity : 0
      );
    }
  },

  updateInteriorLights() {
    for (const entry of this.lights || []) {
      if (entry.source.group !== 'interior') continue;

      const light = entry.entity;
      const baseIntensity = Number(light.dataset.baseIntensity);
      const dimIntensity = entry.source.type === 'ambient' ? baseIntensity * 0.15 : 0;

      light.setAttribute(
        'light',
        'intensity',
        this.data.interiorOn ? baseIntensity : dimIntensity
      );
    }
  },

  tick(time) {
    if (time - this.updateFrame < 100) return;
    this.updateFrame = time;

    this.el.object3D.updateMatrixWorld(true);

    for (const entry of this.lights) {
      const source = entry.source;

      if (!source.targetId) continue;

      const entity = document.getElementById(source.targetId);
      const root = entity?.getObject3D('mesh');

      if (!entity || !root) continue;

      entity.object3D.updateWorldMatrix(true, true);

      const bounds = new THREE.Box3().setFromObject(root);

      if (bounds.isEmpty()) continue;

      const center = bounds.getCenter(new THREE.Vector3());

      if (source.id === 'hanging-lamp') {
        center.y = Math.min(
          bounds.max.y - 0.2,
          bounds.min.y + 0.28
        );
      }

      entry.entity.object3D.position.copy(center);
      entry.entity.object3D.updateMatrix();
    }
  },

  remove() {
    for (const entry of this.lights) {
      if (!entry.source.targetId) entry.entity.remove();
    }
  }
});
