const HITBOX_TARGET_IDS = [
  'saklar',
  'pintu',
  'ac',
  'tv',
  'speaker_kanan',
  'speaker_kiri',
  'TELEPHONE'
];

AFRAME.registerComponent('model-hitbox-visuals', {
  init() {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const material = new THREE.LineBasicMaterial({
      color: '#39ff68',
      transparent: true,
      opacity: 0.8,
      depthTest: true,
      toneMapped: false
    });

    this.hitboxes = HITBOX_TARGET_IDS.map(id => {
      const outline = new THREE.LineSegments(geometry, material);
      outline.name = `${id}-hitbox-outline`;
      outline.visible = false;
      this.el.object3D.add(outline);
      return {id, outline};
    });
    this.updateFrame = 0;
  },

  tick(time) {
    if (time - this.updateFrame < 150) return;
    this.updateFrame = time;

    this.el.object3D.updateMatrixWorld(true);
    for (const {id, outline} of this.hitboxes) {
      const entity = document.getElementById(id);
      const model = entity?.getObject3D('mesh');
      if (!entity || !model) {
        outline.visible = false;
        continue;
      }

      entity.object3D.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(model);
      if (bounds.isEmpty()) {
        outline.visible = false;
        continue;
      }

      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(1.015);
      outline.position.copy(center);
      outline.scale.copy(size);
      outline.visible = true;
      outline.updateMatrixWorld(true);
    }
  },

  remove() {
    for (const {outline} of this.hitboxes) outline.removeFromParent();
    this.hitboxes[0]?.outline.geometry.dispose();
    this.hitboxes[0]?.outline.material.dispose();
  }
});
