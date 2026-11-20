const LIGHTING_SCORES = {25: 35, 50: 75, 75: 100, 100: 40};
const LIGHT_LEVELS = {25: 0.34, 50: 0.67, 75: 1, 100: 1.34};

AFRAME.registerComponent('ergonomics-gameplay', {
  init() {
    this.audioState = {
      tvOn: false,
      tvVolume: 0,
      speakerLeftOn: true,
      speakerLeftVolume: 70,
      speakerRightOn: true,
      speakerRightVolume: 70,
      acOn: true,
      acMode: 'turbo',
      acError: true,
      phoneOn: true
    };
    this.lightOn = false;
    this.brightness = 75;
    this.acInspected = false;
    this.activeTarget = null;
    this.moveItem = null;
    this.appliedTV = null;
    this.lastTargetCheck = 0;
    this.rotationBlockedUntil = 0;
    this.panelHadPointerLock = false;
    this.scoringReady = false;
    this.runtimeItems = new WeakMap();
    this.panel = document.getElementById('interaction-panel');
    this.title = document.getElementById('interaction-title');
    this.controls = document.getElementById('interaction-controls');
    this.missionText = document.getElementById('mission-text');
    this.hint = document.getElementById('gameplay-hint');
    this.crosshair = document.getElementById('crosshair');
    if (this.panel) document.body.appendChild(this.panel);
    this.onKeyDown = event => {
      if (document.body.classList.contains('is-start-menu-open')) return;
      const panelOpen = !!this.panel && !this.panel.hidden;
      const target = this.activeTarget;
      if (panelOpen && event.code === 'Escape') {
        event.preventDefault();
        this.applyAction('close');
        return;
      }
      if (event.code === 'KeyF') {
        if (event.repeat || (event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName))) return;
        event.preventDefault();
        if (panelOpen && target?.kind === 'lamp') this.stepBrightness(1);
        else if (panelOpen && target?.kind === 'ac' && this.acInspected) {
          this.audioState.acOn = !this.audioState.acOn;
          this.audioState.acError = false;
          this.renderPanel();
          this.refreshScores();
        } else this.interact();
        return;
      }
      if (event.repeat && (event.code === 'KeyQ' || event.code === 'KeyR')) return;
      if (panelOpen && event.target instanceof HTMLInputElement && event.code.startsWith('Arrow')) {
        event.stopImmediatePropagation();
        return;
      }
      if (!panelOpen || (event.target instanceof HTMLElement && event.target.tagName === 'INPUT')) return;
      if (target?.kind === 'speaker' && event.code === 'KeyQ') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.rotateSpeaker(-15);
      } else if (target?.kind === 'speaker' && event.code === 'KeyR') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.rotateSpeaker(15);
      } else if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const step = event.code === 'ArrowLeft' || event.code === 'ArrowDown' ? -1 : 1;
        if (target?.kind === 'lamp') this.stepBrightness(step);
        else if (target?.kind === 'tv' || target?.kind === 'speaker') this.adjustVolume(step * 5);
        else if (target?.kind === 'ac') this.stepACMode(step);
      }
    };
    this.onPanelClick = event => {
      const button = event.target.closest('button[data-action]');
      if (!button || !this.panel.contains(button)) return;
      event.preventDefault();
      this.applyAction(button.dataset.action, button);
    };
    this.onPanelInput = event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'range') return;
      const value = Number(input.value);
      this.setVolume(input.dataset.volumeKey, value);
      const output = input.parentElement.querySelector('output');
      if (output) output.value = `${value}%`;
    };
    window.addEventListener('keydown', this.onKeyDown, true);
    this.panel?.addEventListener('click', this.onPanelClick);
    this.panel?.addEventListener('input', this.onPanelInput);
    this.applyLighting();
  },

  tick(time) {
    const editor = this.el.components['furniture-editor'];
    const loader = this.el.components['auto-furniture-loader'];
    if (!this.readyForScoring(editor, loader)) {
      this.hint.textContent = 'Menyiapkan objek ruangan...';
      this.crosshair?.classList.remove('is-target');
      return;
    }
    this.scoringReady = true;
    const tv = this.getRuntimeModelItems(loader).find(item => item.role === 'tv') ||
      editor.items.find(item => item.role === 'tv');
    if (tv && tv !== this.appliedTV) {
      this.updateTVAppearance(tv);
      this.appliedTV = tv;
    }

    if (time - this.lastTargetCheck < 80) return;
    this.lastTargetCheck = time;
    const target = this.findTarget();
    if (!this.panel || this.panel.hidden) this.activeTarget = target;
    this.crosshair?.classList.toggle('is-target', !!target);
    this.hint.textContent = this.rotationBlockedUntil > performance.now()
      ? 'Rotasi dihentikan agar speaker tidak menembus furnitur.'
      : this.moveItem
        ? 'Tekan F untuk menyelesaikan penataan'
        : target
          ? `Tekan F untuk berinteraksi · ${target.label}`
          : '';
    this.applyLighting();
  },

  readyForScoring(editor, loader) {
    const shell = this.el.components['room-shell'];
    const models = loader?.placedModels || [];
    const speakerCount = models.filter(item => item.role.type === 'speaker').length;
    return !!editor?.ready &&
      !!loader?.started &&
      !loader.loading &&
      loader.queue.length === 0 &&
      editor.items.some(item => item.role === 'sofa') &&
      models.some(item => item.role.type === 'tv') &&
      speakerCount >= 2 &&
      editor.items.some(item => item.id === 'MEJA') &&
      shell?.colliders.some(collider => collider.id === 'TELEPHONE');
  },

  getRuntimeModelItems(loader = this.el.components['auto-furniture-loader']) {
    return (loader?.placedModels || [])
      .filter(model => ['tv', 'speaker'].includes(model.role.type))
      .map(model => {
        let item = this.runtimeItems.get(model.entity);
        if (!item) {
          item = {
            id: model.entity.id,
            label: model.role.type === 'tv'
              ? 'TV'
              : model.side === 'right' ? 'Speaker Kanan' : 'Speaker Kiri',
            role: model.role.type,
            entity: model.entity,
            transform: model.entity,
            collider: model.collider,
            side: model.side,
            materials: this.collectMaterialStates(model.root)
          };
          this.runtimeItems.set(model.entity, item);
        }
        return item;
      });
  },

  collectMaterialStates(root) {
    const materials = [];
    root?.traverse(object => {
      if (!object.isMesh) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material || materials.some(state => state.material === material)) continue;
        materials.push({
          material,
          color: material.color?.clone(),
          emissive: material.emissive?.clone(),
          emissiveIntensity: material.emissiveIntensity
        });
      }
    });
    return materials;
  },

  getLightingScore() {
    return this.lightOn ? LIGHTING_SCORES[this.brightness] : 20;
  },

  getComfortScore() {
    if (this.audioState.acError) return 40;
    if (!this.audioState.acOn) return 70;
    return this.audioState.acMode === 'silent' ? 70 : 90;
  },

  findTarget() {
    const editor = this.el.components['furniture-editor'];
    const camera = document.getElementById('player-camera');
    if (!editor || !camera) return null;

    this.el.object3D.updateMatrixWorld(true);
    const origin = camera.object3D.getWorldPosition(new THREE.Vector3());
    const cameraObject = camera.getObject3D('camera');
    const direction = cameraObject
      ? cameraObject.getWorldDirection(new THREE.Vector3())
      : camera.object3D.getWorldDirection(new THREE.Vector3()).negate();
    const ray = new THREE.Ray(origin, direction);
    let nearest = null;
    let nearestDistance = 3.5;

    const consider = (target, box) => {
      if (!box || box.isEmpty()) return;
      const hit = ray.intersectBox(box, new THREE.Vector3());
      if (!hit) return;
      const distance = origin.distanceTo(hit);
      if (distance < nearestDistance) {
        nearest = target;
        nearestDistance = distance;
      }
    };

    for (const item of editor.items) {
      let kind = null;
      if (item.id === 'MEJA') kind = 'phone-table';
      else if (item.role === 'sofa') kind = 'sofa';
      else if (item.role === 'speaker') kind = 'speaker';
      else if (item.role === 'tv') kind = 'tv';
      else if (item.role === 'lamp') kind = 'lamp';
      if (!kind || !item.collider) continue;
      consider(
        {kind, label: item.label, item},
        new THREE.Box3(
          new THREE.Vector3(item.collider.minX, item.collider.minY, item.collider.minZ),
          new THREE.Vector3(item.collider.maxX, item.collider.maxY, item.collider.maxZ)
        )
      );
    }

    for (const item of this.getRuntimeModelItems()) {
      if (!item.collider) continue;
      consider(
        {kind: item.role === 'speaker' ? 'speaker' : 'tv', label: item.label, item},
        new THREE.Box3(
          new THREE.Vector3(item.collider.minX, item.collider.minY, item.collider.minZ),
          new THREE.Vector3(item.collider.maxX, item.collider.maxY, item.collider.maxZ)
        )
      );
    }

    const entityTargets = [
      {selector: '#saklar, [data-model-role="switch"]', kind: 'switch', label: 'Saklar Lampu'},
      {selector: '#ac, [data-model-role="air-conditioner"]', kind: 'ac', label: 'AC'},
      {selector: '#lampugantung, [data-model-role="ceiling-lamp"]', kind: 'lamp', label: 'Lampu Plafon'},
      {selector: '#TELEPHONE', kind: 'phone', label: 'Telepon'}
    ];
    for (const descriptor of entityTargets) {
      const entity = this.el.querySelector(descriptor.selector);
      if (!entity?.object3D) continue;
      const mesh = entity.getObject3D('mesh');
      if (!mesh) continue;
      const box = new THREE.Box3().setFromObject(mesh);
      consider({kind: descriptor.kind, label: descriptor.label, entity}, box);
    }

    return nearest;
  },

  interact() {
    if (!this.scoringReady) return;
    const editor = this.el.components['furniture-editor'];
    if (editor?.grabbedItem) {
      editor.toggleGrab();
      this.moveItem = null;
      this.renderPanel();
      return;
    }

    const target = this.findTarget();
    if (!target) return;
    this.activeTarget = target;
    if (target.kind === 'sofa' || target.kind === 'phone-table') {
      if (!target.item || !editor) return;
      editor.nearbyItem = target.item;
      editor.toggleGrab();
      this.moveItem = target.item;
      this.openPanel(target);
      return;
    }

    this.openPanel(target);
    if (target.kind === 'switch') this.toggleLight();
    else if (target.kind === 'tv') {
      this.audioState.tvOn = !this.audioState.tvOn;
      this.updateTVAppearance();
    } else if (target.kind === 'phone') {
      this.audioState.phoneOn = !this.audioState.phoneOn;
    } else if (target.kind === 'ac' && !this.acInspected) {
      this.acInspected = true;
    }
    this.refreshScores();
    this.renderPanel();
  },

  openPanel(target) {
    this.activeTarget = target;
    if (this.panel) this.panel.hidden = false;
    document.body.classList.add('is-interaction-panel-open');
    this.panelHadPointerLock = document.pointerLockElement === this.el.canvas;
    if (this.panelHadPointerLock) {
      document.getElementById('player-rig')
        ?.components['fps-controls']?.desktopController?.exitPointerLock();
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.renderPanel();
    this.panel?.querySelector('button[data-action="close"]')?.focus();
  },

  toggleLight() {
    this.lightOn = !this.lightOn;
    this.applyLighting();
    if (this.lightOn && this.missionText) {
      this.missionText.textContent = 'Misi 2: Periksa dan perbaiki kondisi ergonomi ruangan.';
    }
    this.refreshScores();
  },

  applyLighting() {
    const lighting = this.el.components['room-point-lighting'];
    if (lighting && lighting.data.ceilingOn !== this.lightOn) {
      this.el.setAttribute('room-point-lighting', 'ceilingOn', this.lightOn);
    }
    if (lighting && lighting.data.interiorOn !== this.lightOn) {
      this.el.setAttribute('room-point-lighting', 'interiorOn', this.lightOn);
    }
    const lights = this.el.querySelectorAll('[data-light-group="ceiling"]');
    for (const light of lights) {
      const settings = light.getAttribute('light');
      if (!settings) continue;
      const intensity = Number(settings.intensity) || 0;
      const base = Number(light.dataset.baseIntensity) || intensity || 2.2;
      const target = this.lightOn ? base * LIGHT_LEVELS[this.brightness] : 0;
      if (Math.abs(intensity - target) > 0.001) light.setAttribute('light', 'intensity', target);
    }
  },

  setVolume(key, value) {
    if (!key || !Object.prototype.hasOwnProperty.call(this.audioState, key) || !Number.isFinite(value)) return;
    this.audioState[key] = Math.max(0, Math.min(100, Math.round(value)));
    this.refreshScores();
  },

  refreshScores() {
    if (!this.scoringReady) return;
    const evaluator = this.el.components['ergonomics-evaluator'];
    const editor = this.el.components['furniture-editor'];
    const shell = this.el.components['room-shell'];
    evaluator?.updateScores(editor?.items || [], shell);
  },

  adjustVolume(delta) {
    const target = this.activeTarget;
    const isLeftSpeaker = target?.item?.side === 'left' ||
      target?.item?.id === 'speaker-left' ||
      target?.item?.id?.includes('kiri');
    const key = target?.kind === 'tv'
      ? 'tvVolume'
      : isLeftSpeaker
        ? 'speakerLeftVolume'
        : 'speakerRightVolume';
    this.setVolume(key, this.audioState[key] + delta);
    const input = this.controls?.querySelector(`[data-volume-key="${key}"]`);
    if (input) {
      input.value = String(this.audioState[key]);
      const output = input.parentElement.querySelector('output');
      if (output) output.value = `${this.audioState[key]}%`;
    }
  },

  stepBrightness(direction) {
    const values = [25, 50, 75, 100];
    const currentIndex = values.indexOf(this.brightness);
    this.brightness = values[(currentIndex + direction + values.length) % values.length];
    this.applyLighting();
    this.renderPanel();
    this.refreshScores();
  },

  stepACMode(direction) {
    const modes = ['off', 'turbo', 'silent'];
    const current = !this.audioState.acOn ? 'off' : this.audioState.acMode;
    const currentIndex = modes.indexOf(current);
    const next = modes[(currentIndex + direction + modes.length) % modes.length];
    this.audioState.acOn = next !== 'off';
    if (next !== 'off') this.audioState.acMode = next;
    this.audioState.acError = false;
    this.renderPanel();
    this.refreshScores();
  },

  rotateSpeaker(degrees) {
    const item = this.activeTarget?.item;
    if (item?.role !== 'speaker') return;
    const transform = item.transform.object3D;
    const editor = this.el.components['furniture-editor'];
    const previousPosition = transform.position.clone();
    const previousRotation = transform.rotation.clone();
    const previousRotationY = item.rotationY;
    if (!item.rotationPivot) {
      item.rotationPivot = this.getEntityLocalBoundsCenter(item.entity);
      if (!item.rotationPivot) {
        console.error(`[Gameplay] Could not measure ${item.label} for rotation.`);
        return;
      }
    }

    const parent = transform.parent;
    transform.updateWorldMatrix(true, false);
    const centerBefore = transform.localToWorld(item.rotationPivot.clone());
    transform.rotation.y = THREE.MathUtils.euclideanModulo(
      transform.rotation.y + THREE.MathUtils.degToRad(degrees),
      Math.PI * 2
    );
    transform.updateMatrix();
    transform.updateWorldMatrix(true, false);
    const centerAfter = transform.localToWorld(item.rotationPivot.clone());
    const parentCenterBefore = parent ? parent.worldToLocal(centerBefore) : centerBefore;
    const parentCenterAfter = parent ? parent.worldToLocal(centerAfter) : centerAfter;
    transform.position.add(parentCenterBefore.sub(parentCenterAfter));
    transform.updateMatrix();
    transform.updateWorldMatrix(true, true);

    if (editor?.items.includes(item)) {
      editor.updateFurnitureColliders();
      if (!editor.isValidPlacement(item, item.collider)) {
        transform.position.copy(previousPosition);
        transform.rotation.copy(previousRotation);
        transform.updateMatrix();
        editor.updateFurnitureColliders();
        item.rotationY = previousRotationY;
        this.showRotationBlockedHint();
        return;
      }
    } else if (item.collider && editor?.shell) {
      const bounds = new THREE.Box3().setFromObject(item.entity.getObject3D('mesh') || transform);
      const obstacle = editor.shell.colliders.find(collider =>
        collider !== item.collider && editor.collidesWithBox(bounds, collider)
      );
      if (obstacle) {
        transform.position.copy(previousPosition);
        transform.rotation.copy(previousRotation);
        transform.updateMatrix();
        transform.updateWorldMatrix(true, true);
        item.rotationY = previousRotationY;
        this.showRotationBlockedHint();
        return;
      }
      Object.assign(item.collider, {
        minX: bounds.min.x,
        maxX: bounds.max.x,
        minY: bounds.min.y,
        maxY: bounds.max.y,
        minZ: bounds.min.z,
        maxZ: bounds.max.z
      });
    }

    item.rotationY = transform.rotation.y;
    this.el.object3D.updateMatrixWorld(true);
    this.refreshScores();
  },

  showRotationBlockedHint() {
    this.rotationBlockedUntil = performance.now() + 1600;
    this.hint.textContent = 'Rotasi dihentikan agar speaker tidak menembus furnitur.';
  },

  getEntityLocalBoundsCenter(entity) {
    const transform = entity?.object3D;
    if (!transform) return null;

    transform.updateWorldMatrix(true, true);
    const inverse = transform.matrixWorld.clone().invert();
    const bounds = new THREE.Box3();
    const localMatrix = new THREE.Matrix4();
    const root = entity.getObject3D('mesh') || transform;
    root.traverse(object => {
      if (!object.isMesh || !object.geometry?.attributes?.position) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      localMatrix.multiplyMatrices(inverse, object.matrixWorld);
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(localMatrix));
    });
    return bounds.isEmpty() ? null : bounds.getCenter(new THREE.Vector3());
  },

  updateTVAppearance(item = this.activeTarget?.item) {
    if (!item || item.role !== 'tv') return;
    for (const state of item.materials) {
      if (!state.material.emissive) continue;
      if (this.audioState.tvOn) {
        state.material.emissive.copy(state.emissive || new THREE.Color('#000000'));
        state.material.emissiveIntensity = Number.isFinite(state.emissiveIntensity) ? state.emissiveIntensity : 1;
      } else {
        state.material.emissive.set('#000000');
        state.material.emissiveIntensity = 0;
      }
      state.material.needsUpdate = true;
    }
  },

  applyAction(action, control = null) {
    const target = this.activeTarget;
    const editor = this.el.components['furniture-editor'];
    switch (action) {
      case 'close':
        if (this.panel) this.panel.hidden = true;
        document.body.classList.remove('is-interaction-panel-open');
        if (this.panelHadPointerLock && control) {
          document.getElementById('player-rig')
            ?.components['fps-controls']?.desktopController?.requestPointerLock();
        }
        this.panelHadPointerLock = false;
        return;
      case 'light-toggle':
        this.toggleLight();
        break;
      case 'brightness':
        this.brightness = Number(control?.value || this.brightness);
        this.applyLighting();
        break;
      case 'tv-power':
        this.audioState.tvOn = !this.audioState.tvOn;
        this.updateTVAppearance();
        break;
      case 'speaker-rotate-left':
        this.rotateSpeaker(-15);
        break;
      case 'speaker-rotate-right':
        this.rotateSpeaker(15);
        break;
      case 'speaker-power':
        if (target?.item?.side === 'left' || target?.item?.id?.includes('kiri')) {
          this.audioState.speakerLeftOn = !this.audioState.speakerLeftOn;
        } else {
          this.audioState.speakerRightOn = !this.audioState.speakerRightOn;
        }
        break;
      case 'ac-power':
        this.audioState.acOn = !this.audioState.acOn;
        this.audioState.acError = false;
        break;
      case 'ac-turbo':
        this.audioState.acMode = 'turbo';
        this.audioState.acOn = true;
        this.audioState.acError = false;
        break;
      case 'ac-silent':
        this.audioState.acMode = 'silent';
        this.audioState.acOn = true;
        this.audioState.acError = false;
        break;
      case 'phone-on':
        this.audioState.phoneOn = true;
        break;
      case 'phone-off':
        this.audioState.phoneOn = false;
        break;
      case 'furniture-move':
        if (!target?.item || !editor) return;
        if (editor.grabbedItem) editor.toggleGrab();
        else {
          editor.nearbyItem = target.item;
          editor.toggleGrab();
        }
        this.moveItem = editor.grabbedItem ? target.item : null;
        break;
      case 'furniture-rotate-left':
        editor?.rotateGrabbed(-15);
        break;
      case 'furniture-rotate-right':
        editor?.rotateGrabbed(15);
        break;
    }
    this.applyLighting();
    this.renderPanel();
    this.refreshScores();
  },

  makeButton(label, action, active = false, toggle = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = label;
    if (active) button.classList.add('is-active');
    if (toggle) button.setAttribute('aria-pressed', String(active));
    return button;
  },

  addVolumeControl(label, key, value) {
    const row = document.createElement('label');
    row.className = 'interaction-control';
    const title = document.createElement('span');
    title.textContent = label;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = String(value);
    range.dataset.volumeKey = key;
    const output = document.createElement('output');
    output.value = `${value}%`;
    row.append(title, range, output);
    this.controls.appendChild(row);
  },

  renderPanel() {
    if (!this.panel || !this.controls || !this.activeTarget) return;
    this.controls.replaceChildren();
    const {kind, item} = this.activeTarget;
    this.title.textContent = this.activeTarget.label;
    if (kind === 'switch') {
      this.controls.appendChild(this.makeButton(
        this.lightOn ? 'Matikan lampu' : 'Nyalakan lampu',
        'light-toggle',
        this.lightOn,
        true
      ));
    } else if (kind === 'lamp') {
      const title = document.createElement('p');
      title.className = 'interaction-control__label';
      title.textContent = `Brightness · ${this.brightness}%`;
      this.controls.appendChild(title);
      for (const value of [25, 50, 75, 100]) {
        const label = {25: 'Kurang', 50: 'Baik', 75: 'Ideal', 100: 'Terlalu Terang'}[value];
        const button = this.makeButton(`${value}% · ${label}`, 'brightness', value === this.brightness, true);
        button.value = String(value);
        this.controls.appendChild(button);
      }
    } else if (kind === 'tv') {
      this.controls.appendChild(this.makeButton(
        this.audioState.tvOn ? 'Power: ON' : 'Power: OFF',
        'tv-power',
        this.audioState.tvOn,
        true
      ));
      this.addVolumeControl('Volume TV', 'tvVolume', this.audioState.tvVolume);
    } else if (kind === 'speaker') {
      const isLeft = item.side === 'left' || item.id === 'speaker-left' || item.id?.includes('kiri');
      const key = isLeft ? 'speakerLeftVolume' : 'speakerRightVolume';
      this.controls.appendChild(this.makeButton(
        `Power: ${this.audioState[isLeft ? 'speakerLeftOn' : 'speakerRightOn'] ? 'ON' : 'OFF'}`,
        'speaker-power',
        this.audioState[isLeft ? 'speakerLeftOn' : 'speakerRightOn'],
        true
      ));
      this.addVolumeControl(`Volume ${isLeft ? 'Speaker Kiri' : 'Speaker Kanan'}`, key, this.audioState[key]);
      this.controls.append(
        this.makeButton('Rotate Left · 15°', 'speaker-rotate-left'),
        this.makeButton('Rotate Right · 15°', 'speaker-rotate-right')
      );
    } else if (kind === 'ac') {
      if (this.audioState.acError) {
        const warning = document.createElement('p');
        warning.className = 'interaction-panel__warning';
        warning.textContent = 'ERROR TERDETEKSI · Mode awal Turbo';
        this.controls.appendChild(warning);
      }
      this.controls.append(
        this.makeButton(this.audioState.acOn ? 'AC: ON' : 'AC: OFF', 'ac-power', this.audioState.acOn, true),
        this.makeButton('Turbo Mode', 'ac-turbo', this.audioState.acMode === 'turbo', true),
        this.makeButton('Silent Mode', 'ac-silent', this.audioState.acMode === 'silent', true)
      );
    } else if (kind === 'phone') {
      this.controls.append(
        this.makeButton('ON', 'phone-on', this.audioState.phoneOn, true),
        this.makeButton('OFF', 'phone-off', !this.audioState.phoneOn, true)
      );
    } else if (kind === 'sofa' || kind === 'phone-table') {
      const editor = this.el.components['furniture-editor'];
      const isMoving = editor?.grabbedItem === item;
      this.controls.append(
        this.makeButton(isMoving ? 'Selesai Move Mode' : 'Move Mode', 'furniture-move', isMoving, true),
        this.makeButton('Rotate Left · 15°', 'furniture-rotate-left'),
        this.makeButton('Rotate Right · 15°', 'furniture-rotate-right')
      );
    }
  },

  remove() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.panel?.removeEventListener('click', this.onPanelClick);
    this.panel?.removeEventListener('input', this.onPanelInput);
    document.body.classList.remove('is-interaction-panel-open');
  }
});
