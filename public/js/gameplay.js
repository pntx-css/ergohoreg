import telephoneAudioUrl from '../../assets/telephone.mp3?url';
import acAudioUrl from '../../assets/ac.mp3?url';

const LIGHTING_SCORES = {25: 35, 50: 75, 75: 100, 100: 40};
const LIGHT_LEVELS = {25: 0.34, 50: 0.67, 75: 1, 100: 1.34};
const MISSION_COUNT = 6;
const ERGOSIM_URL = 'https://projek-2-enuma.vercel.app/';

AFRAME.registerComponent('ergonomics-gameplay', {
  init() {
    this.audioState = {
      tvOn: false,
      speakerLeftOn: true,
      speakerLeftVolume: 70,
      speakerRightOn: true,
      speakerRightVolume: 70,
      acOn: true,
      acMode: 'turbo',
      acTemperature: 16,
      acError: true,
      phoneOn: true
    };
    this.audioState.acTemperature ??= 16;
    this.phoneAudio = new Audio(telephoneAudioUrl);
    this.phoneAudio.loop = true;
    this.phoneAudioStarting = false;
    this.onPhoneUserGesture = () => this.syncPhoneAudio();
    document.addEventListener('pointerdown', this.onPhoneUserGesture, true);
    document.addEventListener('keydown', this.onPhoneUserGesture, true);
    this.syncPhoneAudio();
    this.acAudio = new Audio(acAudioUrl);
    this.acAudio.loop = true;
    this.acAudioContext = new AudioContext();
    this.acAudioGain = this.acAudioContext.createGain();
    this.acAudioGain.gain.value = 7;
    this.acAudioContext.createMediaElementSource(this.acAudio).connect(this.acAudioGain);
    this.acAudioGain.connect(this.acAudioContext.destination);
    this.acAudioStarting = false;
    this.gameplayStarted = false;
    this.gameplayStartPending = false;
    this.onACUserGesture = () => this.syncACAudio();
    document.addEventListener('pointerdown', this.onACUserGesture, true);
    document.addEventListener('keydown', this.onACUserGesture, true);
    this.onGameplayStarted = () => {
      if (this.gameplayStarted || this.gameplayStartPending) return;
      this.gameplayStartPending = true;
      const menu = document.getElementById('start-menu');
      const startGameplayAudio = () => {
        if (
          this.gameplayStarted ||
          document.body.classList.contains('is-start-menu-open') ||
          (menu && getComputedStyle(menu).visibility !== 'hidden')
        ) return;
        this.gameplayStartPending = false;
        this.gameplayStarted = true;
        this.syncPhoneAudio();
        this.syncACAudio();
      };
      if (!menu) {
        startGameplayAudio();
        return;
      }

      const onMenuTransitionEnd = event => {
        if (event.target !== menu || event.propertyName !== 'opacity') return;
        menu.removeEventListener('transitionend', onMenuTransitionEnd);
        window.clearTimeout(transitionFallback);
        startGameplayAudio();
      };
      menu.addEventListener('transitionend', onMenuTransitionEnd);
      const transitionFallback = window.setTimeout(() => {
        menu.removeEventListener('transitionend', onMenuTransitionEnd);
        startGameplayAudio();
      }, 400);
    };
    this.el.addEventListener('gameplay-started', this.onGameplayStarted);
    this.lightOn = false;
    this.brightness = 25;
    this.acInspected = false;
    this.brightnessAdjusted = false;
    this.inspectedSpeakers = new Set();
    this.phoneInspected = false;
    this.activeTarget = null;
    this.moveItem = null;
    this.appliedTV = null;
    this.lastTargetCheck = 0;
    this.rotationBlockedUntil = 0;
    this.lastSpeakerMissionDebugKey = '';
    this.panelHadPointerLock = false;
    this.panelPreviousFocus = null;
    this.scoringReady = false;
    this.runtimeItems = new WeakMap();
    this.panel = document.getElementById('interaction-panel');
    this.title = document.getElementById('interaction-title');
    this.controls = document.getElementById('interaction-controls');
    this.missionText = document.getElementById('mission-text');
    this.missionTitle = document.getElementById('mission-title');
    this.missionDescription = document.getElementById('mission-description');
    this.missionCount = document.getElementById('mission-count');
    this.missionStatus = document.getElementById('mission-status');
    this.missionObjectives = document.getElementById('mission-objectives');
    this.missionIndex = 0;
    this.missionComplete = false;
    this.missionAdvanceAt = 0;
    this.missionRenderKey = '';
    this.gameCompleted = false;
    this.completionPopup = document.getElementById('game-completion-popup');
    this.hint = document.getElementById('gameplay-hint');
    this.crosshair = document.getElementById('crosshair');
    this.doorPopup = document.getElementById('door-confirmation-dialog');
    this.doorPopupHadPointerLock = false;
    if (this.panel) document.body.appendChild(this.panel);
    this.onKeyDown = event => {
      if (document.body.classList.contains('is-start-menu-open')) return;
      if (this.doorPopup && !this.doorPopup.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === 'Escape') this.closeDoorPopup();
        return;
      }
      const panelOpen = !!this.panel && !this.panel.hidden;
      const target = this.activeTarget;
      if (panelOpen && event.code === 'Escape') {
        event.preventDefault();
        this.applyAction('close');
        return;
      }
      if (event.target instanceof HTMLElement &&
          event.target.closest('input, select, textarea, button, [contenteditable="true"]')) return;
      if (event.code === 'KeyF') {
        if (event.repeat) return;
        event.preventDefault();
        if (panelOpen && target?.kind === 'lamp') this.stepBrightness(1);
        else if (panelOpen && target?.kind === 'ac' && this.acInspected) {
          this.audioState.acOn = !this.audioState.acOn;
          this.audioState.acError = false;
          this.syncACAudio();
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
        else if (target?.kind === 'speaker') this.adjustVolume(step * 5);
        else if (target?.kind === 'ac') this.stepACMode(step);
      }
    };
    this.onPanelClick = event => {
      const button = event.target.closest('button[data-action]');
      if (!button || !this.panel.contains(button)) return;
      event.preventDefault();
      this.applyAction(button.dataset.action, button);
    };
    this.onCanvasClick = event => {
      const canvas = this.el.canvas;
      const isPointerLocked = document.pointerLockElement === canvas;
      if (
        !canvas ||
        (!isPointerLocked && event.target !== canvas) ||
        document.body.classList.contains('is-start-menu-open') ||
        (this.doorPopup && !this.doorPopup.hidden)
      ) return;

      const loader = this.el.components['auto-furniture-loader'];
      const door = loader?.placedModels.find(item => item.role.type === 'door' && item.collider);
      if (!door?.collider) return;

      const camera = document.getElementById('player-camera')?.getObject3D('camera');
      if (!camera) return;

      const bounds = canvas.getBoundingClientRect();
      const pointer = isPointerLocked
        ? new THREE.Vector2(0, 0)
        : new THREE.Vector2(
            ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
            -((event.clientY - bounds.top) / bounds.height) * 2 + 1
          );
      const raycaster = new THREE.Raycaster();
      this.el.object3D.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      const collider = door.collider;
      const doorBox = new THREE.Box3(
        new THREE.Vector3(collider.minX, collider.minY, collider.minZ),
        new THREE.Vector3(collider.maxX, collider.maxY, collider.maxZ)
      );
      if (!raycaster.ray.intersectBox(doorBox, new THREE.Vector3())) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      this.openDoorPopup();
    };
    this.onDoorPopupClick = event => {
      const button = event.target.closest('button[data-action]');
      if (!button || !this.doorPopup?.contains(button)) return;
      event.preventDefault();
      if (button.dataset.action === 'door-confirm') {
        window.location.assign(ERGOSIM_URL);
      } else {
        this.closeDoorPopup(true);
      }
    };
    this.onPanelInput = event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'range') return;
      const value = Number(input.value);
      if (input.dataset.temperatureKey === 'acTemperature') {
        this.setACTemperature(value);
        const output = input.parentElement.querySelector('output');
        if (output) output.value = `${this.getACTemperature()}°C`;
        return;
      }
      if (!input.dataset.volumeKey) return;
      this.setVolume(input.dataset.volumeKey, value);
      const output = input.parentElement.querySelector('output');
      if (output) output.value = `${value}%`;
    };
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('click', this.onCanvasClick, true);
    this.panel?.addEventListener('click', this.onPanelClick);
    this.panel?.addEventListener('input', this.onPanelInput);
    this.doorPopup?.addEventListener('click', this.onDoorPopupClick);
    this.applyLighting();
    this.renderMission(this.getMissionObjectives(), false);
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
    this.updateMissionProgress(time);
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
      ? this.activeTarget?.kind === 'sofa' || this.activeTarget?.kind === 'coffee-table'
        ? 'Furniture tidak dapat diputar karena ruang putarnya terhalang.'
        : 'Rotasi dihentikan agar speaker tidak menembus furnitur.'
      : this.moveItem
        ? 'WASD untuk menggeser · F untuk menyelesaikan penataan'
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
    const temperatureStatus = this.getTemperatureStatus();
    if (temperatureStatus === 'Nyaman') return 100;
    if (temperatureStatus === 'Agak Dingin' || temperatureStatus === 'Agak Panas') return 75;
    return 40;
  },

  getACTemperature() {
    const temperature = this.audioState?.acTemperature;
    return Number.isFinite(temperature) ? temperature : 24;
  },

  getTemperatureStatus() {
    const temperature = this.getACTemperature();
    if (temperature <= 19) return 'Kedinginan';
    if (temperature <= 21) return 'Agak Dingin';
    if (temperature <= 25) return 'Nyaman';
    if (temperature <= 28) return 'Agak Panas';
    return 'Kepanasan';
  },

  getPlayerComfortStatus() {
    const temperature = this.getACTemperature();
    if (temperature <= 21) return 'Kedinginan';
    if (temperature <= 25) return 'Nyaman';
    return 'Kepanasan';
  },

  updateACTemperatureStatus() {
    const temperatureStatus = this.controls?.querySelector('[data-ac-temperature-status]');
    if (temperatureStatus) temperatureStatus.textContent = `Status suhu: ${this.getTemperatureStatus()}`;
    const playerStatus = this.controls?.querySelector('[data-player-comfort-status]');
    if (playerStatus) playerStatus.textContent = `Kondisi pemain: ${this.getPlayerComfortStatus()}`;
  },

  setACTemperature(value) {
    if (!Number.isFinite(value) || !this.audioState) return;
    this.audioState.acTemperature = Math.max(16, Math.min(30, Math.round(value)));
    this.updateACTemperatureStatus();
    this.refreshScores();
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
    let nearestDistance = Infinity;

    const consider = (target, box, maxDistance = 3.5) => {
      if (!box || box.isEmpty()) return;
      const hit = ray.intersectBox(box, new THREE.Vector3());
      if (!hit) return;
      const distance = origin.distanceTo(hit);
      if (distance < maxDistance && distance < nearestDistance) {
        nearest = target;
        nearestDistance = distance;
      }
    };

    for (const item of editor.items) {
      let kind = null;
      if (item.id === 'MEJA') kind = 'coffee-table';
      else if (item.role === 'sofa') kind = 'sofa';
      else if (item.role === 'speaker') kind = 'speaker';
      else if (item.role === 'tv') kind = 'tv';
      else if (item.role === 'lamp') kind = 'lamp';
      if (!kind || !item.collider) continue;
      consider(
        {kind, label: kind === 'coffee-table' ? 'Meja Depan TV' : item.label, item},
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

    const door = this.el.components['auto-furniture-loader']?.placedModels
      .find(item => item.role.type === 'door' && item.collider);
    if (door?.collider) {
      consider(
        {kind: 'door', label: 'Pintu', item: door},
        new THREE.Box3(
          new THREE.Vector3(door.collider.minX, door.collider.minY, door.collider.minZ),
          new THREE.Vector3(door.collider.maxX, door.collider.maxY, door.collider.maxZ)
        ),
        Infinity
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

  openDoorPopup() {
    if (!this.doorPopup) return;
    this.doorPopupHadPointerLock = document.pointerLockElement === this.el.canvas;
    if (this.doorPopupHadPointerLock) {
      document.getElementById('player-rig')
        ?.components['fps-controls']?.desktopController?.exitPointerLock();
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.doorPopup.hidden = false;
    this.doorPopup.querySelector('button[data-action="door-confirm"]')?.focus();
  },

  closeDoorPopup(restorePointerLock = false) {
    if (!this.doorPopup) return;
    this.doorPopup.hidden = true;
    if (restorePointerLock && this.doorPopupHadPointerLock) {
      document.getElementById('player-rig')
        ?.components['fps-controls']?.desktopController?.requestPointerLock();
    }
    this.doorPopupHadPointerLock = false;
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
    if (target.kind === 'door') {
      this.openDoorPopup();
      return;
    }
    if (target.kind === 'speaker') this.inspectedSpeakers.add(this.getSpeakerSide(target.item));
    if (target.kind === 'phone') this.phoneInspected = true;
    if (target.kind === 'sofa' || target.kind === 'coffee-table') {
      if (!target.item || !editor) return;
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
      this.syncPhoneAudio();
    } else if (target.kind === 'ac' && !this.acInspected) {
      this.acInspected = true;
    }
    this.refreshScores();
    this.renderPanel();
  },

  openPanel(target) {
    const panelWasOpen = !!this.panel && !this.panel.hidden;
    if (!panelWasOpen) {
      this.panelPreviousFocus = document.activeElement;
      this.panelHadPointerLock = document.pointerLockElement === this.el.canvas;
    }
    this.activeTarget = target;
    if (this.panel) this.panel.hidden = false;
    document.body.classList.add('is-interaction-panel-open');
    if (this.panelHadPointerLock) {
      const desktopController = document.getElementById('player-rig')
        ?.components['fps-controls']?.desktopController;
      if (desktopController) desktopController.exitPointerLock();
      else if (document.pointerLockElement) document.exitPointerLock();
    }
    this.renderPanel();
    this.panel?.querySelector('button[data-action="close"]')?.focus();
  },

  toggleLight() {
    this.lightOn = !this.lightOn;
    this.applyLighting();
    this.refreshScores();
  },

  syncPhoneAudio() {
    if (!this.phoneAudio) return;
    if (
      !this.audioState.phoneOn ||
      !this.gameplayStarted ||
      document.body.classList.contains('is-start-menu-open')
    ) {
      this.phoneAudio.pause();
      this.phoneAudio.currentTime = 0;
      return;
    }
    if (this.phoneAudioStarting || !this.phoneAudio.paused) return;

    this.phoneAudioStarting = true;
    this.phoneAudio.play().then(() => {
      if (
        !this.audioState.phoneOn ||
        !this.gameplayStarted ||
        document.body.classList.contains('is-start-menu-open')
      ) {
        this.phoneAudio.pause();
        this.phoneAudio.currentTime = 0;
        return;
      }
      document.removeEventListener('pointerdown', this.onPhoneUserGesture, true);
      document.removeEventListener('keydown', this.onPhoneUserGesture, true);
    }).catch(error => {
      if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') {
        console.error('[gameplay] Telephone audio could not be played.', error);
      }
    }).finally(() => {
      this.phoneAudioStarting = false;
    });
  },

  syncACAudio() {
    if (!this.acAudio) return;
    if (
      !this.gameplayStarted ||
      document.body.classList.contains('is-start-menu-open') ||
      !this.audioState.acOn ||
      this.audioState.acMode !== 'turbo'
    ) {
      this.acAudio.pause();
      this.acAudio.currentTime = 0;
      return;
    }
    if (this.acAudioStarting || !this.acAudio.paused) return;

    this.acAudioStarting = true;
    this.acAudioContext.resume()
      .then(() => {
        if (
          !this.gameplayStarted ||
          document.body.classList.contains('is-start-menu-open') ||
          !this.audioState.acOn ||
          this.audioState.acMode !== 'turbo'
        ) return;
        return this.acAudio.play();
      })
      .then(() => {
        if (this.acAudio.paused) return;
        document.removeEventListener('pointerdown', this.onACUserGesture, true);
        document.removeEventListener('keydown', this.onACUserGesture, true);
      })
      .catch(error => {
        if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') {
          console.error('[gameplay] AC audio could not be played.', error);
        }
      })
      .finally(() => {
        this.acAudioStarting = false;
      });
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
    evaluator?.updateScores(editor?.items || []);
  },

  adjustVolume(delta) {
    const target = this.activeTarget;
    if (target?.kind !== 'speaker') return;
    const isLeftSpeaker = target?.item?.side === 'left' ||
      target?.item?.id === 'speaker-left' ||
      target?.item?.id?.includes('kiri');
    const key = isLeftSpeaker ? 'speakerLeftVolume' : 'speakerRightVolume';
    this.setVolume(key, this.audioState[key] + delta);
    const input = this.controls?.querySelector(`[data-volume-key="${key}"]`);
    if (input) {
      input.value = String(this.audioState[key]);
      const output = input.parentElement.querySelector('output');
      if (output) output.value = `${this.audioState[key]}%`;
    }
  },

  getSpeakerSide(item) {
    return item?.side === 'left' || item?.id === 'speaker-left' || item?.id?.includes('kiri')
      ? 'left'
      : 'right';
  },

  stepBrightness(direction) {
    const values = [25, 50, 75, 100];
    const currentIndex = values.indexOf(this.brightness);
    this.setBrightness(values[(currentIndex + direction + values.length) % values.length]);
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
    this.syncACAudio();
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
        if (this.panelHadPointerLock) {
          document.getElementById('player-rig')
            ?.components['fps-controls']?.desktopController?.requestPointerLock();
        }
        this.panelHadPointerLock = false;
        const focusTarget = this.panelPreviousFocus instanceof HTMLElement &&
          this.panelPreviousFocus !== document.body &&
          this.panelPreviousFocus.isConnected &&
          !this.panel?.contains(this.panelPreviousFocus) &&
          !this.panelPreviousFocus.closest('[hidden]') &&
          getComputedStyle(this.panelPreviousFocus).visibility !== 'hidden'
          ? this.panelPreviousFocus
          : this.el.canvas;
        focusTarget?.focus({preventScroll: true});
        this.panelPreviousFocus = null;
        return;
      case 'light-toggle':
        this.toggleLight();
        break;
      case 'brightness':
        this.setBrightness(Number(control?.value || this.brightness));
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
        this.syncACAudio();
        break;
      case 'ac-turbo':
        this.audioState.acMode = 'turbo';
        this.audioState.acOn = true;
        this.audioState.acError = false;
        this.syncACAudio();
        break;
      case 'ac-silent':
        this.audioState.acMode = 'silent';
        this.audioState.acOn = true;
        this.audioState.acError = false;
        this.syncACAudio();
        break;
      case 'phone-on':
        this.audioState.phoneOn = true;
        this.syncPhoneAudio();
        break;
      case 'phone-off':
        this.audioState.phoneOn = false;
        this.syncPhoneAudio();
        break;
      case 'furniture-move':
        if (!target?.item || !editor) return;
        console.info('[Furniture Move Debug] Move Mode button selected', {
          id: target.item.id,
          alreadyMoving: !!editor.grabbedItem
        });
        if (editor.grabbedItem) editor.toggleGrab();
        else {
          editor.nearbyItem = target.item;
          editor.toggleGrab();
        }
        this.moveItem = editor.grabbedItem ? target.item : null;
        if (editor.grabbedItem === target.item) {
          this.applyAction('close');
          if (document.body.dataset.mode === 'desktop') {
            document.getElementById('player-rig')
              ?.components['fps-controls']?.desktopController?.requestPointerLock();
          }
          return;
        }
        break;
      case 'furniture-rotate-left':
        if (target?.kind === 'sofa' || target?.kind === 'coffee-table') this.rotateFurnitureInPlace(target.item, -15);
        else editor?.rotateGrabbed(-15);
        break;
      case 'furniture-rotate-right':
        if (target?.kind === 'sofa' || target?.kind === 'coffee-table') this.rotateFurnitureInPlace(target.item, 15);
        else editor?.rotateGrabbed(15);
        break;
    }
    this.applyLighting();
    this.renderPanel();
    this.refreshScores();
  },

  rotateFurnitureInPlace(item, degrees) {
    const editor = this.el.components['furniture-editor'];
    if (!['sofa', 'table'].includes(item?.role) || !editor ||
        (editor.grabbedItem && editor.grabbedItem !== item)) return false;
    const transform = item.transform.object3D;
    const previousRotationY = item.rotationY;
    const previousPose = editor.getItemWorldPose(item);
    if (!item.rotationPivotGroup) {
      const pivot = this.getEntityLocalBoundsCenter(item.entity);
      const root = item.entity.getObject3D('mesh');
      if (!pivot || !root) {
        console.error(`[Gameplay] Could not create a rotation pivot for ${item.label}.`);
        return false;
      }

      item.rotationPivotGroup = new THREE.Group();
      item.rotationPivotGroup.position.copy(pivot);
      transform.add(item.rotationPivotGroup);
      item.rotationPivotGroup.attach(root);
    }

    const previousPivotRotation = item.rotationPivotGroup.rotation.y;
    item.rotationPivotGroup.rotation.y += THREE.MathUtils.degToRad(degrees);
    transform.updateWorldMatrix(true, true);
    item.rotationY += THREE.MathUtils.degToRad(degrees);
    editor.updateFurnitureColliders();
    const nextPose = editor.getItemWorldPose(item);

    if (!editor.isPlacementPathValid(item, previousPose, nextPose) ||
        !editor.isValidPlacement(item, item.collider)) {
      item.rotationPivotGroup.rotation.y = previousPivotRotation;
      item.rotationY = previousRotationY;
      transform.updateWorldMatrix(true, true);
      editor.updateFurnitureColliders();
      this.rotationBlockedUntil = performance.now() + 1600;
      return false;
    }

    this.rotationBlockedUntil = 0;
    this.el.object3D.updateMatrixWorld(true);
    if (editor.grabbedItem === item) item.lastValidTransform = editor.captureItemTransform(item);
    this.refreshScores();
    return true;
  },

  setBrightness(value) {
    if (!Object.prototype.hasOwnProperty.call(LIGHTING_SCORES, value)) return;
    if (this.brightness !== value) this.brightnessAdjusted = true;
    this.brightness = value;
  },

  getMissionScores() {
    const scores = this.el.components['ergonomics-evaluator']?.scores || {};
    return {
      noiseControl: scores.noiseControl ?? 30,
      lighting: this.getLightingScore()
    };
  },

  isSpeakerFacingSofa(speaker, sofa) {
    if (!speaker?.transform?.object3D || !speaker.collider || !sofa?.collider) return false;
    const speakerCenter = new THREE.Vector3(
      (speaker.collider.minX + speaker.collider.maxX) / 2,
      (speaker.collider.minY + speaker.collider.maxY) / 2,
      (speaker.collider.minZ + speaker.collider.maxZ) / 2
    );
    const sofaCenter = new THREE.Vector3(
      (sofa.collider.minX + sofa.collider.maxX) / 2,
      (sofa.collider.minY + sofa.collider.maxY) / 2,
      (sofa.collider.minZ + sofa.collider.maxZ) / 2
    );
    const toSofa = sofaCenter.sub(speakerCenter);
    toSofa.y = 0;
    if (toSofa.lengthSq() < 0.001) return false;
    toSofa.normalize();

    const rotation = speaker.transform.object3D.getWorldQuaternion(new THREE.Quaternion());
    const yaw = new THREE.Euler().setFromQuaternion(rotation, 'YXZ').y;
    const facing = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return facing.dot(toSofa) >= 0.7;
  },

  getMissionObjectives() {
    const scores = this.getMissionScores();
    const editor = this.el.components['furniture-editor'];
    const sofa = editor?.items.find(item => item.role === 'sofa');
    const speakers = this.missionIndex === 3
      ? this.getRuntimeModelItems().filter(item => item.role === 'speaker')
      : [];
    const leftSpeaker = speakers.find(item => this.getSpeakerSide(item) === 'left');
    const rightSpeaker = speakers.find(item => this.getSpeakerSide(item) === 'right');
    switch (this.missionIndex) {
      case 0:
        return [
          {label: 'Arahkan crosshair ke saklar lampu dan tekan F untuk menyalakan pencahayaan utama.', done: this.lightOn}
        ];
      case 1:
        return [
          {label: 'Arahkan crosshair ke lampu plafon, tekan F, lalu pilih tingkat brightness.', done: this.brightnessAdjusted},
          {label: 'Capai Lighting Score minimal 75.', done: scores.lighting >= 75}
        ];
      case 2:
        return [
          {label: 'Arahkan crosshair ke AC dan tekan F untuk memeriksa pengaturannya.', done: this.acInspected},
          {label: 'Pilih Silent Mode pada panel AC untuk mengurangi kebisingan.', done: this.audioState.acOn && this.audioState.acMode === 'silent'},
          {label: 'Atur suhu AC ke rentang nyaman 22°C–25°C.', done: this.getACTemperature() >= 22 && this.getACTemperature() <= 25}
        ];
      case 3:
        {
          const leftVolume = this.audioState?.speakerLeftVolume;
          const rightVolume = this.audioState?.speakerRightVolume;
          const volumesEqual = Number.isFinite(leftVolume) && Number.isFinite(rightVolume) && leftVolume === rightVolume;
          const volumesWithinLimit = Number.isFinite(leftVolume) && Number.isFinite(rightVolume) &&
            leftVolume >= 0 && rightVolume >= 0 && leftVolume <= 60 && rightVolume <= 60;
          const volumesValid = this.areSpeakerVolumesValid();
          const leftFacing = this.isSpeakerFacingSofa(leftSpeaker, sofa);
          const rightFacing = this.isSpeakerFacingSofa(rightSpeaker, sofa);
          const missionComplete = volumesValid && leftFacing && rightFacing;
          this.logSpeakerMissionDebug({
            leftVolume,
            rightVolume,
            volumesEqual,
            volumesWithinLimit,
            leftFacing,
            rightFacing,
            missionComplete
          });
          return [
            {
              label: 'Samakan volume speaker kiri dan kanan, maksimal 60% untuk masing-masing.',
              done: volumesValid
            },
            {
              label: 'Putar speaker kiri ke arah area sofa dengan tombol Putar atau Q/R.',
              done: leftFacing
            },
            {
              label: 'Putar speaker kanan ke arah area sofa dengan tombol Putar atau Q/R.',
              done: rightFacing
            }
          ];
        }
      case 4:
        return [
          {label: 'Nyalakan TV sebagai media tampilan visual.', done: this.audioState.tvOn},
          {label: 'Matikan telepon jika masih aktif.', done: !this.audioState.phoneOn},
          {label: 'Tingkatkan Noise Control Score hingga minimal 75.', done: scores.noiseControl >= 75}
        ];
      case 5:
        {
          const loader = this.el.components['auto-furniture-loader'];
          const viewingStatus = this.el.components['ergonomics-evaluator']
            ?.getViewingDistanceStatus(editor?.items || [], loader);
          const sofaFacing = !!viewingStatus?.facingTV;
          const distanceIdeal = !!viewingStatus?.distanceIdeal;
          const coffeeTableSuitable = !!viewingStatus?.coffeeTableSuitable;
          const coffeeTableOnRugCenter = !!viewingStatus?.coffeeTableOnRugCenter;
          const viewingDistanceIdeal = viewingStatus?.score === 100;
          const furniturePlaced = !editor?.grabbedItem;
          return [
            {
              label: 'Putar dan posisikan sofa agar benar-benar menghadap TV.',
              done: sofaFacing
            },
            {
              label: 'Atur jarak sofa ke TV ke rentang ideal 3,1–3,6 m.',
              done: distanceIdeal
            },
            {
              label: 'Letakkan coffee table di antara TV dan sofa, dengan jarak nyaman sekitar satu jengkal dari sofa.',
              done: coffeeTableSuitable
            },
            {
              label: 'Tempatkan coffee table di tengah karpet.',
              done: coffeeTableOnRugCenter
            },
            {
              label: 'Capai Viewing Distance 100.',
              done: viewingDistanceIdeal
            },
            {
              label: 'Letakkan kembali furniture setelah penataan.',
              done: furniturePlaced
            }
          ];
        }
      default:
        return [];
    }
  },

  areSpeakerVolumesValid() {
    const left = this.audioState?.speakerLeftVolume;
    const right = this.audioState?.speakerRightVolume;
    return Number.isFinite(left) && Number.isFinite(right) &&
      left >= 0 && right >= 0 && left <= 60 && right <= 60 && left === right;
  },

  logSpeakerMissionDebug(state) {
    const key = JSON.stringify(state);
    if (key === this.lastSpeakerMissionDebugKey) return;
    this.lastSpeakerMissionDebugKey = key;
    console.info('[Speaker Mission Debug]', {
      speakerLeftVolume: state.leftVolume ?? null,
      speakerRightVolume: state.rightVolume ?? null,
      volumesEqual: state.volumesEqual,
      volumesWithinLimit: state.volumesWithinLimit,
      speakerLeftFacingSofa: state.leftFacing,
      speakerRightFacingSofa: state.rightFacing,
      missionComplete: state.missionComplete
    });
  },

  getMissionContent() {
    return [
      {
        title: 'Nyalakan Pencahayaan Utama',
        description: 'Ruangan terlihat cukup redup sehingga proses evaluasi belum dapat dilakukan dengan optimal. Cari saklar lampu dan nyalakan pencahayaan utama.'
      },
      {
        title: 'Sesuaikan Pencahayaan Ruangan',
        description: 'Lampu sudah menyala, namun tingkat pencahayaan belum tentu nyaman. Periksa lampu plafon dan sesuaikan brightness hingga Lighting Score minimal 75. Lampu mulai dari tingkat yang belum ideal.'
      },
      {
        title: 'Kurangi Kebisingan AC',
        description: 'AC masih berada pada Mode Turbo dan suhu 16°C sehingga ruangan terasa dingin. Periksa AC, pilih Silent Mode, lalu atur suhu ke 22°C–25°C agar ruangan nyaman dan tenang.'
      },
      {
        title: 'Kalibrasi Sistem Audio',
        description: 'Volume speaker kiri dan kanan berbeda, dan keduanya belum menghadap area menonton. Samakan volumenya dan putar kedua speaker agar mengarah ke area sofa.'
      },
      {
        title: 'Kurangi Gangguan Kebisingan',
        description: 'Nyalakan TV untuk menggunakan tampilan hiburan, matikan telepon agar tidak mengganggu, lalu sesuaikan speaker dan perangkat lain hingga Noise Control Score minimal 75. TV hanya menampilkan visual dan tidak menambah kebisingan.'
      },
      {
        title: 'Perbaiki Posisi Sofa',
        description: 'Sofa dan coffee table belum tertata ideal untuk menonton. Putar sofa agar menghadap TV, atur jaraknya, lalu tempatkan coffee table dengan tepat hingga Viewing Distance mencapai 100.'
      }
    ][this.missionIndex];
  },

  renderMission(objectives, complete) {
    if (!this.missionText || !this.missionTitle || !this.missionDescription ||
        !this.missionCount || !this.missionStatus || !this.missionObjectives) return;
    const mission = this.getMissionContent();
    const renderKey = JSON.stringify({
      index: this.missionIndex,
      complete,
      objectives: objectives.map(objective => objective.done)
    });
    if (renderKey === this.missionRenderKey) return;
    this.missionRenderKey = renderKey;
    this.missionCount.textContent = `Misi ${this.missionIndex + 1} dari ${MISSION_COUNT}`;
    this.missionTitle.textContent = mission.title;
    this.missionDescription.textContent = mission.description;
    this.missionStatus.textContent = complete ? 'Selesai' : 'Belum Selesai';
    this.missionStatus.dataset.complete = String(complete);
    this.missionObjectives.replaceChildren();
    for (const objective of objectives) {
      const item = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = objective.label;
      const status = document.createElement('span');
      status.className = 'mission-objective__status';
      status.textContent = objective.done ? 'Selesai' : 'Belum';
      item.dataset.complete = String(objective.done);
      item.append(text, status);
      this.missionObjectives.appendChild(item);
    }
  },

  updateMissionProgress(time) {
    if (this.gameCompleted) return;

    if (this.missionComplete) {
      if (this.missionAdvanceAt && time >= this.missionAdvanceAt) {
        this.missionIndex++;
        this.missionComplete = false;
        this.missionAdvanceAt = 0;
        this.missionRenderKey = '';
      } else {
        this.renderMission(this.getMissionObjectives(), true);
        return;
      }
    }

    const objectives = this.getMissionObjectives();
    if (objectives.every(objective => objective.done)) {
      this.missionComplete = true;
      if (this.missionIndex === MISSION_COUNT - 1) {
        this.gameCompleted = true;
        if (this.completionPopup) {
          this.completionPopup.hidden = false;
          window.setTimeout(() => {
            this.completionPopup.hidden = true;
          }, 3000);
        }
      } else {
        this.missionAdvanceAt = time + 1600;
      }
    }
    this.renderMission(objectives, this.missionComplete);
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
    } else if (kind === 'speaker') {
      const isLeft = this.getSpeakerSide(item) === 'left';
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
      const temperatureRow = document.createElement('label');
      temperatureRow.className = 'interaction-control';
      const temperatureLabel = document.createElement('span');
      temperatureLabel.textContent = 'Suhu AC';
      const temperatureInput = document.createElement('input');
      temperatureInput.type = 'range';
      temperatureInput.min = '16';
      temperatureInput.max = '30';
      temperatureInput.step = '1';
      temperatureInput.value = String(this.getACTemperature());
      temperatureInput.dataset.temperatureKey = 'acTemperature';
      temperatureInput.setAttribute('aria-label', 'Suhu AC');
      const temperatureOutput = document.createElement('output');
      temperatureOutput.value = `${this.getACTemperature()}°C`;
      temperatureRow.append(temperatureLabel, temperatureInput, temperatureOutput);
      const temperatureStatus = document.createElement('p');
      temperatureStatus.className = 'interaction-control__label';
      temperatureStatus.dataset.acTemperatureStatus = '';
      const playerStatus = document.createElement('p');
      playerStatus.className = 'interaction-control__label';
      playerStatus.dataset.playerComfortStatus = '';
      this.controls.append(temperatureRow, temperatureStatus, playerStatus);
      this.updateACTemperatureStatus();
    } else if (kind === 'phone') {
      this.controls.append(
        this.makeButton('ON', 'phone-on', this.audioState.phoneOn, true),
        this.makeButton('OFF', 'phone-off', !this.audioState.phoneOn, true)
      );
    } else if (kind === 'sofa' || kind === 'coffee-table') {
      const editor = this.el.components['furniture-editor'];
      const isMoving = editor?.grabbedItem === item;
      if (kind === 'sofa' && this.missionIndex === 5) {
        const title = document.createElement('p');
        title.className = 'interaction-control__label';
        title.textContent = 'Sesuaikan arah hadap dan posisi sofa, lalu atur coffee table agar Viewing Distance mencapai 100.';
        this.controls.append(
          title,
          this.makeButton(isMoving ? 'Selesai Move Mode' : 'Move Mode', 'furniture-move', isMoving, true),
          this.makeButton('Rotate Left (-15°)', 'furniture-rotate-left'),
          this.makeButton('Rotate Right (+15°)', 'furniture-rotate-right')
        );
      } else {
        this.controls.append(
          this.makeButton(isMoving ? 'Selesai Move Mode' : 'Move Mode', 'furniture-move', isMoving, true),
          this.makeButton('Rotate Left (-15°)', 'furniture-rotate-left'),
          this.makeButton('Rotate Right (+15°)', 'furniture-rotate-right')
        );
      }
    }
  },

  remove() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('click', this.onCanvasClick, true);
    this.panel?.removeEventListener('click', this.onPanelClick);
    this.panel?.removeEventListener('input', this.onPanelInput);
    this.doorPopup?.removeEventListener('click', this.onDoorPopupClick);
    document.body.classList.remove('is-interaction-panel-open');
  }
});
