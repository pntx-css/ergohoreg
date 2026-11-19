const ERGONOMY_METRICS = [
  ['viewingDistance', 'Viewing Distance'],
  ['noiseControl', 'Noise Control'],
  ['lighting', 'Lighting'],
  ['comfort', 'Comfort'],
  ['roomLayout', 'Room Layout']
];

const scoreClamp = value => Math.max(0, Math.min(100, Math.round(value)));
const SCORE_COLORS = {
  red: '#ff626b',
  orange: '#ff9c4a',
  yellow: '#f1ca58',
  green: '#53d997'
};
const scoreBand = score => score < 40 ? 'red' : score < 60 ? 'orange' : score < 80 ? 'yellow' : 'green';
const scoreStatus = score => {
  if (score >= 90) return {label: 'Sangat Baik', band: 'excellent'};
  if (score >= 75) return {label: 'Baik', band: 'good'};
  if (score >= 60) return {label: 'Cukup', band: 'fair'};
  return {label: 'Perlu Perbaikan', band: 'improve'};
};
const itemCenter = item => new THREE.Vector3(
  (item.collider.minX + item.collider.maxX) / 2,
  (item.collider.minY + item.collider.maxY) / 2,
  (item.collider.minZ + item.collider.maxZ) / 2
);

AFRAME.registerComponent('ergonomics-evaluator', {
  init() {
    this.lastUpdate = 0;
    this.scores = {
      viewingDistance: 40,
      noiseControl: 30,
      lighting: 20,
      comfort: 40,
      roomLayout: 50
    };
    this.finalScore = 36;
    this.baselines = null;
    this.valueAnimations = new WeakMap();
    this.interactionHint = '';
    this.panel = document.getElementById('ergonomics-panel');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 520;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.vrPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.08, 0.88),
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
    if (this.panelAttached) return;
    this.camera = document.getElementById('player-camera');
    if (!this.camera) return;
    this.camera.object3D.add(this.vrPanel);
    this.vrPanel.visible = this.el.is('vr-mode');
    this.panelAttached = true;
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
    if (!gameplay?.readyForScoring(this.el.components['furniture-editor'], this.el.components['auto-furniture-loader'])) return;

    if (!this.baselines) {
      this.baselines = {
        viewingDistance: this.scoreViewingDistance(items),
        noiseControl: this.scoreNoiseControl(items, gameplay, this.el.components['auto-furniture-loader']),
        roomLayout: this.scoreRoomLayout(shell, items)
      };
      this.renderScores();
      return;
    }

    this.scores = {
      viewingDistance: scoreClamp(40 + this.scoreViewingDistance(items) - this.baselines.viewingDistance),
      noiseControl: scoreClamp(30 + this.scoreNoiseControl(items, gameplay, this.el.components['auto-furniture-loader']) - this.baselines.noiseControl),
      lighting: gameplay.getLightingScore(),
      comfort: gameplay.getComfortScore(),
      roomLayout: scoreClamp(50 + this.scoreRoomLayout(shell, items) - this.baselines.roomLayout)
    };
    this.finalScore = scoreClamp(Object.values(this.scores).reduce((sum, score) => sum + score, 0) / ERGONOMY_METRICS.length);
    this.renderScores();
  },

  scoreViewingDistance(items) {
    const tv = items.find(item => item.role === 'tv');
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
    const speakers = items.filter(item => item.role === 'speaker').length >= 2
      ? items.filter(item => item.role === 'speaker')
      : (loader?.placedModels || [])
        .filter(item => item.role.type === 'speaker')
        .map(item => ({id: item.entity.id, role: 'speaker', transform: item.entity, collider: item.collider}));
    const audio = gameplay.audioState;
    let penalty = (audio.tvOn ? audio.tvVolume * 0.25 : 0) +
      audio.speakerLeftVolume * 0.2 +
      audio.speakerRightVolume * 0.2 +
      (audio.acOn ? audio.acMode === 'turbo' ? 25 : 5 : 0) +
      (audio.phoneOn ? 17 : 0);

    if (sofa) {
      const sofaCenter = itemCenter(sofa);
      for (const speaker of speakers) {
        const speakerCenter = itemCenter(speaker);
        const toSofa = sofaCenter.sub(speakerCenter);
        toSofa.y = 0;
        if (toSofa.lengthSq() < 0.001) continue;
        toSofa.normalize();
        const rotation = speaker.transform.object3D.getWorldQuaternion(new THREE.Quaternion());
        const yaw = new THREE.Euler().setFromQuaternion(rotation, 'YXZ').y;
        const facing = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        penalty += (1 - Math.max(-1, Math.min(1, facing.dot(toSofa)))) * 8;
      }
    }
    return scoreClamp(100 - penalty);
  },

  scoreRoomLayout(shell, items) {
    const bounds = shell.playerBounds;
    const layoutColliders = items
      .filter(item => item.role === 'sofa' || item.id === 'MEJA')
      .map(item => item.collider);
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
        const occupied = layoutColliders.some(box => worldX >= box.minX && worldX <= box.maxX && worldZ >= box.minZ && worldZ <= box.maxZ);
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
    return scoreClamp(100 * (freeRatio * 0.25 + connectedRatio * 0.5 + clearLaneRatio * 0.25));
  },

  renderScores() {
    if (this.panel) {
      for (const [key] of ERGONOMY_METRICS) {
        const score = scoreClamp(this.scores[key]);
        const value = this.panel.querySelector(`[data-value="${key}"]`);
        const bar = this.panel.querySelector(`[data-bar="${key}"]`);
        const track = bar?.parentElement;
        const row = value?.closest('.metric-row');
        const band = scoreBand(score);
        if (value) this.animateNumber(value, score);
        if (track) track.setAttribute('aria-valuenow', String(score));
        if (row && row.dataset.scoreBand !== band) row.dataset.scoreBand = band;
        if (bar) {
          bar.style.width = `${score}%`;
          bar.style.setProperty('--score-color', SCORE_COLORS[band]);
        }
      }
      const finalScore = scoreClamp(this.finalScore);
      const total = this.panel.querySelector('[data-final-score]');
      const finalPanel = total?.closest('.final-score');
      const statusElement = this.panel.querySelector('[data-final-status]');
      const status = scoreStatus(finalScore);
      if (total) this.animateNumber(total, finalScore);
      if (finalPanel) {
        finalPanel.dataset.scoreBand = scoreBand(finalScore);
        finalPanel.dataset.statusBand = status.band;
        finalPanel.style.setProperty('--score-color', SCORE_COLORS[scoreBand(finalScore)]);
      }
      if (statusElement && statusElement.textContent !== status.label) statusElement.textContent = status.label;
    }
    this.renderVRPanel();
  },

  animateNumber(element, target) {
    const targetText = String(target);
    if (element.dataset.scoreTarget === targetText) return;
    element.dataset.scoreTarget = targetText;

    const current = Number.parseInt(element.textContent, 10);
    const previousFrame = this.valueAnimations.get(element);
    if (previousFrame) cancelAnimationFrame(previousFrame);
    if (!Number.isFinite(current) || current === target ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.textContent = `${target}%`;
      this.valueAnimations.delete(element);
      return;
    }

    const startedAt = performance.now();
    const duration = 220;
    const animate = now => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      element.textContent = `${Math.round(current + (target - current) * eased)}%`;
      if (progress < 1) this.valueAnimations.set(element, requestAnimationFrame(animate));
      else this.valueAnimations.delete(element);
    };
    this.valueAnimations.set(element, requestAnimationFrame(animate));
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
    context.fillStyle = '#83d9bb';
    context.font = 'bold 14px Arial';
    context.fillText('ROOM ANALYTICS', 32, 34);
    context.fillStyle = '#f3f8f8';
    context.font = 'bold 30px Arial';
    context.fillText('Ergonomic Score', 32, 68);
    let y = 112;
    for (const [key, label] of ERGONOMY_METRICS) {
      const value = this.scores[key];
      context.fillStyle = '#dce8e9';
      context.font = '23px Arial';
      context.fillText(label, 32, y);
      context.textAlign = 'right';
      context.fillStyle = '#ffffff';
      context.fillText(`${value}%`, width - 32, y);
      context.textAlign = 'left';
      context.fillStyle = 'rgba(255,255,255,0.14)';
      context.fillRect(32, y + 12, width - 64, 10);
      context.fillStyle = SCORE_COLORS[scoreBand(value)];
      context.fillRect(32, y + 12, (width - 64) * value / 100, 10);
      y += 52;
    }
    context.strokeStyle = 'rgba(255,255,255,0.14)';
    context.beginPath();
    context.moveTo(32, 373);
    context.lineTo(width - 32, 373);
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = 'bold 18px Arial';
    context.fillText('FINAL SCORE', 32, 410);
    context.textAlign = 'right';
    context.fillStyle = SCORE_COLORS[scoreBand(this.finalScore)];
    context.font = 'bold 34px Arial';
    context.fillText(`${this.finalScore}%`, width - 32, 414);
    context.textAlign = 'left';
    context.fillStyle = '#a7bbb9';
    context.font = '19px Arial';
    context.fillText('STATUS', 32, 453);
    const status = scoreStatus(this.finalScore);
    context.textAlign = 'right';
    context.fillStyle = status.band === 'improve' ? '#ff858a' : status.band === 'fair' ? '#f1ca58' : '#83e8b3';
    context.font = 'bold 19px Arial';
    context.fillText(status.label.toUpperCase(), width - 32, 453);
    context.textAlign = 'left';
    if (this.interactionHint) {
      context.fillStyle = '#9de8ff';
      context.font = '16px Arial';
      context.fillText(this.interactionHint.slice(0, 55), 32, 493);
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
