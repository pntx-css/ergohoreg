const ERGONOMY_METRICS = [
  ['viewingDistance', 'Viewing Distance'],
  ['noiseControl', 'Noise Control'],
  ['lighting', 'Lighting'],
  ['comfort', 'Comfort'],
  ['roomLayout', 'Room Layout']
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
      comfort: 40,
      roomLayout: 50
    };
    this.finalScore = 36;
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
    const shell = this.el.components['room-shell'];
    if (gameplay?.scoringReady) this.updateScores(editor?.items || [], shell);
  },

  setInteractionHint(message) {
    if (this.interactionHint === message) return;
    this.interactionHint = message;
    this.renderVRPanel();
  },

  updateScores(items, shell) {
    const now = performance.now();
    if (now - this.lastUpdate < 120) return;
    this.lastUpdate = now;
    const gameplay = this.el.components['ergonomics-gameplay'];
    const loader = this.el.components['auto-furniture-loader'];
    if (!gameplay?.scoringReady || !shell) return;
    const raw = {
      viewingDistance: this.scoreViewingDistance(items, loader),
      noiseControl: this.scoreNoiseControl(items, gameplay, loader),
      roomLayout: this.scoreRoomLayout(shell, items, loader)
    };
    if (!this.baselines) this.baselines = raw;
    this.scores = {
      viewingDistance: scoreClamp(40 + (raw.viewingDistance - this.baselines.viewingDistance) * 4),
      noiseControl: scoreClamp(30 + (raw.noiseControl - this.baselines.noiseControl) * 1.5),
      lighting: gameplay.getLightingScore(),
      comfort: gameplay.getComfortScore(),
      roomLayout: scoreClamp(50 + (raw.roomLayout - this.baselines.roomLayout) * 2.15)
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
    const distance = itemCenter(tv).distanceTo(itemCenter(sofa));
    const screenHeight = itemCenter(tv).y;
    const distanceScore = 100 - Math.abs(distance - 2.8) * 35;
    const heightScore = 100 - Math.abs(screenHeight - 1.1) * 55;
    return scoreClamp(distanceScore * 0.7 + heightScore * 0.3);
  },

  scoreNoiseControl(items, gameplay, loader) {
    const sofa = items.find(item => item.role === 'sofa');
    const speakers = loader?.placedModels.filter(item => item.role.type === 'speaker') || [];
    if (!sofa || !speakers.length) return 30;
    const sofaCenter = itemCenter(sofa);
    let penalty = gameplay.audioState.tvOn ? gameplay.audioState.tvVolume * 0.35 : 0;
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

  scoreRoomLayout(shell, items, loader) {
    const bounds = shell.playerBounds;
    const cell = 0.35;
    const cols = Math.max(1, Math.floor((bounds.maxX - bounds.minX) / cell));
    const rows = Math.max(1, Math.floor((bounds.maxZ - bounds.minZ) / cell));
    const blocked = new Uint8Array(cols * rows);
    let freeCount = 0;
    let laneCells = 0;
    let clearLaneCells = 0;
    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        const worldX = bounds.minX + (x + 0.5) * cell;
        const worldZ = bounds.minZ + (z + 0.5) * cell;
        const occupied = shell.colliders.some(box => box.kind === 'furniture' && worldX >= box.minX && worldX <= box.maxX && worldZ >= box.minZ && worldZ <= box.maxZ);
        if (occupied) blocked[z * cols + x] = 1;
        else freeCount++;
        if (worldX >= -0.45 && worldX <= 0.45 && worldZ >= 0.45 && worldZ <= 1.85) {
          laneCells++;
          if (!occupied) clearLaneCells++;
        }
      }
    }

    const visited = new Uint8Array(blocked.length);
    let largestArea = 0;
    for (let start = 0; start < blocked.length; start++) {
      if (blocked[start] || visited[start]) continue;
      let area = 0;
      const queue = [start];
      visited[start] = 1;
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const current = queue[cursor];
        area++;
        const x = current % cols;
        const z = Math.floor(current / cols);
        const neighbors = [x > 0 ? current - 1 : -1, x + 1 < cols ? current + 1 : -1, z > 0 ? current - cols : -1, z + 1 < rows ? current + cols : -1];
        for (const next of neighbors) {
          if (next < 0 || blocked[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
      largestArea = Math.max(largestArea, area);
    }
    if (!freeCount) return 0;
    const freeRatio = freeCount / blocked.length;
    const connectedRatio = largestArea / freeCount;
    const clearLaneRatio = laneCells ? clearLaneCells / laneCells : 1;
    const openSpaceScore = 100 * (freeRatio * 0.25 + connectedRatio * 0.5 + clearLaneRatio * 0.25);
    const sofa = items.find(item => item.role === 'sofa');
    const table = items.find(item => item.id === 'MEJA');
    const tv = loader?.placedModels.find(item => item.role.type === 'tv');
    const phone = shell.colliders.find(item => item.id === 'TELEPHONE');
    if (!sofa || !table || !tv || !phone) return scoreClamp(openSpaceScore);

    const sofaViewingDistance = itemCenter(sofa).distanceTo(itemCenter(tv));
    const tableToPhoneDistance = Math.hypot(
      itemCenter(table).x - itemCenter({collider: phone}).x,
      itemCenter(table).z - itemCenter({collider: phone}).z
    );
    const sofaPlacementScore = Math.max(0, 100 - Math.abs(sofaViewingDistance - 2.8) * 28);
    const tablePlacementScore = Math.max(0, 100 - Math.max(0, tableToPhoneDistance - 1.8) * 18);
    return scoreClamp(openSpaceScore * 0.4 + sofaPlacementScore * 0.3 + tablePlacementScore * 0.3);
  },

  renderScores() {
    if (this.panel) {
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
