AFRAME.registerComponent('model-hitbox-visuals', {
  init() {
    this.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.material = new THREE.LineBasicMaterial({
      color: '#39ff68',
      transparent: true,
      opacity: 0.8,
      depthTest: true,
      toneMapped: false
    });

    this.outline = new THREE.LineSegments(this.geometry, this.material);
    this.outline.name = 'crosshair-target-hitbox-outline';
    this.outline.visible = false;
    this.el.object3D.add(this.outline);
    this.updateFrame = 0;
  },

  tick(time) {
    if (time - this.updateFrame < 80) return;
    this.updateFrame = time;

    this.el.object3D.updateMatrixWorld(true);
    const gameplay = this.el.components['ergonomics-gameplay'];
    const interactionPanel = document.getElementById('interaction-panel');
    const fPopup = document.getElementById('f-interaction-popup');
    const interactionBlocked = document.body.classList.contains('is-start-menu-open') ||
      Boolean(interactionPanel && !interactionPanel.hidden) ||
      Boolean(fPopup && !fPopup.hidden);
    const target = interactionBlocked ? null : gameplay?.findTarget();
    const targetEntity = target?.entity || target?.item?.entity;
    if (!targetEntity) {
      this.outline.visible = false;
      return;
    }

    targetEntity.object3D.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(targetEntity.object3D);
    if (bounds.isEmpty()) {
      this.outline.visible = false;
      return;
    }

    this.outline.position.copy(bounds.getCenter(new THREE.Vector3()));
    this.outline.scale.copy(bounds.getSize(new THREE.Vector3()).multiplyScalar(1.015));
    this.outline.visible = true;
    this.outline.updateMatrixWorld(true);
  },

  remove() {
    this.outline.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
});
