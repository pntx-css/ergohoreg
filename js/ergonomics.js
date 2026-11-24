const ERGONOMY_METRICS = [
  ['viewingDistance', 'Viewing Distance'],
  ['noiseControl', 'Noise Control'],
  ['lighting', 'Lighting'],
  ['comfort', 'Comfort']
];

const scoreClamp = value => Math.max(0, Math.min(100, Math.round(value)));
const itemCenter = item => new THREE.Vector3(
  (item.collider.minX + item.collider.maxX) / 2,
  (item.collider.minY + item.collider.maxY) / 2,
  (item.collider.minZ + item.collider.maxZ) / 2
);
const scoreCategory = score => score >= 90
  ? 'Sangat Baik'
  : score >= 75
    ? 'Baik'
    : score >= 60
      ? 'Cukup'
      : 'Perlu Perbaikan';

AFRAME.registerComponent('ergonomics-evaluator', {
  init() {
    this.lastUpdate = 0;
    this.baselines = null;
    this.scores = {
      viewingDistance: 40,
      noiseControl: 30,
      lighting: 20,
      comfort: 40
    };
    this.finalScore = 33;
    this.category = 'Perlu Perbaikan';
    this.interactionHint = '';
    this.panel = document.getElementById('ergonomics-panel');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 520;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.vrPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.08, 0.79),
      new THREE.MeshBasicMaterial({map: this.texture, transparent: true, depthTest: false, toneMapped: false})
    );
    this.vrPanel.position.set(-0.7, 0.42, -1.35);
    this.vrPanel.renderOrder = 1000;
    this.camera = null;
    this.panelAttached = false;
    this.onEnterVR = () => { this.vrPanel.visible = true; };
    this.onExitVR = () => { this.vrPanel.visible = false; };
    this.el.addEventListener('enter-vr', this.onEnterVR);
    this.el.addEventListener('exit-vr', this.onExitVR);
    this.vrPanel.visible = false;
    this.renderScores();
  },

  tick() {
    if (!this.panelAttached) {
      this.camera = document.getElementById('player-camera');
      if (this.camera) {
        this.camera.object3D.add(this.vrPanel);
        this.vrPanel.visible = this.el.is('vr-mode');
        this.panelAttached = true;
      }
    }

    const gameplay = this.el.components['ergonomics-gameplay'];
    const editor = this.el.components['furniture-editor'];
    if (gameplay?.scoringReady) this.updateScores(editor?.items || []);
  },

  setInteractionHint(message) {
    if (this.interactionHint === message) return;
    this.interactionHint = message;
    this.renderVRPanel();
  },

  updateScores(items) {
    const now = performance.now();
    if (now - this.lastUpdate < 120) return;
    this.lastUpdate = now;
    const gameplay = this.el.components['ergonomics-gameplay'];
    const loader = this.el.components['auto-furniture-loader'];
    if (!gameplay?.scoringReady) return;
    const raw = {
      viewingDistance: this.scoreViewingDistance(items, loader),
      noiseControl: this.scoreNoiseControl(items, gameplay, loader)
    };
    if (!this.baselines) this.baselines = {noiseControl: raw.noiseControl};
    this.scores = {
      viewingDistance: raw.viewingDistance,
      noiseControl: scoreClamp(30 + (raw.noiseControl - this.baselines.noiseControl) * 1.5),
      lighting: gameplay.getLightingScore(),
      comfort: gameplay.getComfortScore()
    };
    this.finalScore = scoreClamp(Object.values(this.scores).reduce((sum, score) => sum + score, 0) / ERGONOMY_METRICS.length);
    this.category = scoreCategory(this.finalScore);
    this.renderScores();
  },

  scoreViewingDistance(items, loader) {
    const tv = items.find(item => item.role === 'tv') ||
      loader?.placedModels.find(item => item.role.type === 'tv');
    const sofa = items.find(item => item.role === 'sofa');
    if (!tv || !sofa) return 70;
    const tvCenter = itemCenter(tv);
    const sofaCenter = itemCenter(sofa);
    const distance = Math.hypot(tvCenter.x - sofaCenter.x, tvCenter.z - sofaCenter.z);
    return scoreClamp(100 - Math.abs(distance - 2.8) * 35);
  },

  scoreNoiseControl(items, gameplay, loader) {
    const sofa = items.find(item => item.role === 'sofa');
    const speakers = loader?.placedModels.filter(item => item.role.type === 'speaker') || [];
    if (!sofa || !speakers.length) return 30;
    const sofaCenter = itemCenter(sofa);
    let penalty = 0;
    for (const speaker of speakers) {
      const isLeft = speaker.side !== 'right';
      const powered = gameplay.audioState[isLeft ? 'speakerLeftOn' : 'speakerRightOn'];
      const volume = gameplay.audioState[isLeft ? 'speakerLeftVolume' : 'speakerRightVolume'];
      if (!powered) continue;

      penalty += volume * 0.2;
      const speakerPosition = speaker.entity.object3D.getWorldPosition(new THREE.Vector3());
      const toSofa = sofaCenter.clone().sub(speakerPosition);
      toSofa.y = 0;
      if (toSofa.lengthSq() > 0.001) {
        toSofa.normalize();
        const yaw = new THREE.Euler().setFromQuaternion(
          speaker.entity.object3D.getWorldQuaternion(new THREE.Quaternion()),
          'YXZ'
        ).y;
        const forward = new THREE.Vector3(1, 0, 0)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        penalty += Math.max(0, 0.75 - forward.dot(toSofa)) * 12;
      }
    }
    if (gameplay.audioState.acOn && gameplay.audioState.acMode === 'turbo') penalty += 20;
    if (gameplay.audioState.acOn && gameplay.audioState.acMode === 'silent') penalty += 5;
    if (gameplay.audioState.phoneOn) penalty += 12;
    return scoreClamp(100 - penalty);
  },

  renderScores() {
    if (this.panel) {
      const gameplay = this.el.components['ergonomics-gameplay'];
      const comfortStatus = this.panel.querySelector('[data-comfort-status]');
      if (comfortStatus) {
        const playerStatus = gameplay?.getPlayerComfortStatus?.() ?? 'Nyaman';
        comfortStatus.textContent = `Kondisi: ${playerStatus}`;
      }
      for (const [key] of ERGONOMY_METRICS) {
        const value = this.panel.querySelector(`[data-value="${key}"]`);
        const bar = this.panel.querySelector(`[data-bar="${key}"]`);
        if (value) value.textContent = `${this.scores[key]}%`;
        if (bar) bar.style.width = `${this.scores[key]}%`;
        const track = bar?.parentElement;
        if (track) track.setAttribute('aria-valuenow', String(this.scores[key]));
      }
      const total = this.panel.querySelector('[data-final-score]');
      if (total) total.textContent = `${this.finalScore}%`;
      const status = this.panel.querySelector('[data-final-status]');
      if (status) status.textContent = this.category;
    }
    this.renderVRPanel();
  },

  renderVRPanel() {
    const context = this.context;
    if (!context) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(10, 20, 26, 0.9)';
    context.beginPath();
    if (context.roundRect) context.roundRect(8, 8, width - 16, height - 16, 24);
    else context.rect(8, 8, width - 16, height - 16);
    context.fill();
    context.fillStyle = '#f3f8f8';
    context.font = 'bold 34px Arial';
    context.fillText('ERGONOMI RUANG', 32, 54);
    let y = 104;
    for (const [key, label] of ERGONOMY_METRICS) {
      const value = this.scores[key];
      context.fillStyle = '#dce8e9';
      context.font = '25px Arial';
      context.fillText(label, 32, y);
      context.textAlign = 'right';
      context.fillStyle = '#ffffff';
      context.fillText(`${value}%`, width - 32, y);
      context.textAlign = 'left';
      context.fillStyle = 'rgba(255,255,255,0.14)';
      context.fillRect(32, y + 12, width - 64, 10);
      context.fillStyle = value >= 75 ? '#52e58a' : value >= 45 ? '#ffd166' : '#ff5d69';
      context.fillRect(32, y + 12, (width - 64) * value / 100, 10);
      y += 58;
    }
    context.fillStyle = '#ffffff';
    context.font = 'bold 29px Arial';
    context.fillText(`FINAL SCORE  ${this.finalScore}% · ${this.category}`, 32, 408);
    if (this.interactionHint) {
      context.fillStyle = '#9de8ff';
      context.font = '20px Arial';
      context.fillText(this.interactionHint.slice(0, 43), 32, 445);
    }
    this.texture.needsUpdate = true;
  },

  remove() {
    this.el.removeEventListener('enter-vr', this.onEnterVR);
    this.el.removeEventListener('exit-vr', this.onExitVR);
    this.vrPanel?.removeFromParent();
    this.texture?.dispose();
    this.vrPanel?.geometry?.dispose();
  }
});
