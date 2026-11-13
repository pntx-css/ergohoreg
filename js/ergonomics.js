const ERGONOMY_METRICS = [
  ['viewingDistance', 'Viewing Distance'],
  ['noiseControl', 'Noise Control'],
  ['lighting', 'Lighting'],
  ['roomLayout', 'Room Layout'],
  ['airQuality', 'Air Quality']
];

const scoreClamp = value => Math.max(0, Math.min(100, Math.round(value)));
const itemCenter = item => new THREE.Vector3(
  (item.collider.minX + item.collider.maxX) / 2,
  (item.collider.minY + item.collider.maxY) / 2,
  (item.collider.minZ + item.collider.maxZ) / 2
);

AFRAME.registerComponent('ergonomics-evaluator', {
  init() {
    this.lastUpdate = 0;
    this.scores = Object.fromEntries(ERGONOMY_METRICS.map(([key]) => [key, 70]));
    this.finalScore = 70;
    this.interactionHint = '';
    this.panel = document.getElementById('ergonomics-panel');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 470;
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
    this.scores = {
      viewingDistance: this.scoreViewingDistance(items),
      noiseControl: this.scoreNoiseControl(items),
      lighting: this.scoreLighting(items),
      roomLayout: this.scoreRoomLayout(shell),
      airQuality: this.scoreAirQuality(items)
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

  scoreNoiseControl(items) {
    const sofa = items.find(item => item.role === 'sofa');
    const speakers = items.filter(item => item.role === 'speaker');
    if (!sofa || !speakers.length) return 70;
    const sofaCenter = itemCenter(sofa);
    const distances = speakers.map(item => itemCenter(item).distanceTo(sofaCenter));
    const average = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
    const distanceScore = 100 - Math.abs(average - 2.5) * 25;
    if (speakers.length < 2) return scoreClamp(distanceScore);
    const speakerCenters = speakers.map(itemCenter).sort((a, b) => a.x - b.x);
    const spread = speakerCenters[0].distanceTo(speakerCenters[speakerCenters.length - 1]);
    const symmetry = 100 - Math.abs(distances[0] - distances[1]) * 35;
    const spreadScore = 100 - Math.abs(spread - 1.8) * 25;
    return scoreClamp(distanceScore * 0.35 + symmetry * 0.4 + spreadScore * 0.25);
  },

  scoreLighting(items) {
    const lamp = items.find(item => item.role === 'lamp');
    const tv = items.find(item => item.role === 'tv');
    if (!lamp || !tv) return 70;
    const from = itemCenter(lamp);
    const toTV = itemCenter(tv).sub(from);
    toTV.y = 0;
    if (toTV.lengthSq() < 0.001) return 40;
    toTV.normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), lamp.entity.object3D.rotation.y);
    forward.y = 0;
    forward.normalize();
    const facingTV = forward.dot(toTV);
    return scoreClamp(facingTV > 0.72 ? 35 : 96 - Math.max(0, facingTV) * 12);
  },

  scoreRoomLayout(shell) {
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
    return scoreClamp(100 * (freeRatio * 0.25 + connectedRatio * 0.5 + clearLaneRatio * 0.25));
  },

  scoreAirQuality(items) {
    const purifier = items.find(item => item.role === 'airPurifier');
    if (!purifier) return 70;
    const box = purifier.collider;
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const neighbors = items.filter(item => item !== purifier && item.collider.minY < box.maxY && item.collider.maxY > box.minY).filter(item => {
      const x = clamp(cx, item.collider.minX, item.collider.maxX);
      const z = clamp(cz, item.collider.minZ, item.collider.maxZ);
      return Math.hypot(cx - x, cz - z) < 0.75;
    }).length;
    return scoreClamp(100 - neighbors * 24);
  },

  renderScores() {
    if (this.panel) {
      for (const [key] of ERGONOMY_METRICS) {
        const value = this.panel.querySelector(`[data-value="${key}"]`);
        const bar = this.panel.querySelector(`[data-bar="${key}"]`);
        if (value) value.textContent = `${this.scores[key]}%`;
        if (bar) bar.style.width = `${this.scores[key]}%`;
      }
      const total = this.panel.querySelector('[data-final-score]');
      if (total) total.textContent = `${this.finalScore}%`;
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
    context.fillText(`FINAL SCORE  ${this.finalScore}%`, 32, 408);
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
