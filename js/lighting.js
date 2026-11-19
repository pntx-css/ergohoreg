const ROOM_LIGHT_SOURCES = [
  {id: 'door', targetId: 'pintu'},
  {id: 'hanging-lamp', targetId: 'lampugantung'}
];

AFRAME.registerComponent('room-point-lighting', {
  init() {
    this.lights = ROOM_LIGHT_SOURCES.map(source => {
      const entity = document.getElementById(`room-light-${source.id}`);
      if (!entity) {
        console.error(`[Lighting] Missing A-Frame point light entity: room-light-${source.id}`);
        return null;
      }
      return {source, entity};
    });
    this.lights = this.lights.filter(Boolean);
    this.updateFrame = 0;
  },

  tick(time) {
    if (time - this.updateFrame < 100) return;
    this.updateFrame = time;

    this.el.object3D.updateMatrixWorld(true);
    for (const entry of this.lights) {
      const entity = document.getElementById(entry.source.targetId);
      const root = entity?.getObject3D('mesh');
      if (!entity || !root) continue;

      entity.object3D.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(root);
      if (bounds.isEmpty()) continue;

      const center = bounds.getCenter(new THREE.Vector3());
      if (entry.source.id === 'hanging-lamp') center.y = Math.min(bounds.max.y - 0.2, bounds.min.y + 0.28);
      entry.entity.object3D.position.copy(center);
      entry.entity.object3D.updateMatrix();
    }
  },
});
