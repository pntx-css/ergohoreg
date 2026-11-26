const ERGONOMY_METRICS = [
  ['viewingDistance', 'Viewing Distance'],
  ['noiseControl', 'Noise Control'],
  ['lighting', 'Lighting'],
  ['comfort', 'Comfort']
];

const scoreClamp = value => Math.max(0, Math.min(100, Math.round(value)));
const IDEAL_VIEWING_DISTANCE = {min: 3.1, max: 3.7};
const IDEAL_SOFA_TABLE_CLEARANCE = {min: 0.5, max: 0.7};
const SPEAKER_FACING_DOT_THRESHOLD = Math.cos(THREE.MathUtils.degToRad(60));
// Half the diagonal of the furniture editor's 0.1 m grid, plus rounding tolerance.
const FURNITURE_ALIGNMENT_TOLERANCE = 0.08;
const IDEAL_SOFA_FACING_DOT = Math.cos(THREE.MathUtils.degToRad(20));
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
    this.lastViewingDistanceDebugKey = '';
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
    const status = this.getViewingDistanceStatus(items, loader);
    this.logViewingDistanceDebug(status);
    return status.score;
  },

  getViewingDistanceStatus(items, loader) {
    const tv = items.find(item => item.role === 'tv') ||
      loader?.placedModels.find(item => item.role.type === 'tv');
    const sofa = items.find(item => item.role === 'sofa');
    const coffeeTable = items.find(item => item.id === 'MEJA') ||
      items.find(item => item.role === 'table');
    const rug = loader?.placedModels.find(item => item.role.type === 'rug' && item.bounds);
    if (!tv?.collider || !sofa?.collider || !sofa.transform?.object3D ||
        !coffeeTable?.collider || !rug?.bounds) {
      return {
        angleDegrees: null,
        distance: null,
        sofaCoffeeTableClearance: null,
        sofaTableAligned: false,
        coffeeTableSuitable: false,
        coffeeTableOnRugCenter: false,
        facingTV: false,
        distanceIdeal: false,
        score: 0
      };
    }

    const tvCenter = itemCenter(tv);
    const sofaCenter = itemCenter(sofa);
    const toTV = tvCenter.sub(sofaCenter);
    toTV.y = 0;
    const distance = toTV.length();
    const directionToTV = distance > 0.001 ? toTV.clone().normalize() : new THREE.Vector3();
    const sofaYaw = this.el.components['furniture-editor']?.getItemWorldPose(sofa)?.yaw ??
      sofa.transform.object3D.rotation.y;
    const sofaForward = new THREE.Vector3(-1, 0, 0)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), sofaYaw);
    const facingDot = distance > 0.001 ? sofaForward.dot(directionToTV) : -1;
    const angleDegrees = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(facingDot, -1, 1)));
    const facingTV = facingDot >= IDEAL_SOFA_FACING_DOT;
    const distanceIdeal = distance >= IDEAL_VIEWING_DISTANCE.min &&
      distance <= IDEAL_VIEWING_DISTANCE.max;

    const tableOffset = itemCenter(coffeeTable).sub(sofaCenter);
    tableOffset.y = 0;
    const tableForwardDistance = tableOffset.dot(directionToTV);
    const tableLateralDistance = Math.abs(
      tableOffset.x * directionToTV.z - tableOffset.z * directionToTV.x
    );
    const sofaTableAligned = tableLateralDistance <= FURNITURE_ALIGNMENT_TOLERANCE;
    const coffeeTableCenter = itemCenter(coffeeTable);
    const rugCenter = rug.bounds.getCenter(new THREE.Vector3());
    const tableToRugCenter = coffeeTableCenter.sub(rugCenter);
    tableToRugCenter.y = 0;
    const rugLateralOffset = Math.abs(
      tableToRugCenter.x * directionToTV.z - tableToRugCenter.z * directionToTV.x
    );
    const rugForwardOffset = Math.abs(tableToRugCenter.dot(directionToTV));
    const rugCenterOffset = Math.hypot(rugLateralOffset, rugForwardOffset);
    const coffeeTableFitsOnRug =
      coffeeTable.collider.minX >= rug.bounds.min.x &&
      coffeeTable.collider.maxX <= rug.bounds.max.x &&
      coffeeTable.collider.minZ >= rug.bounds.min.z &&
      coffeeTable.collider.maxZ <= rug.bounds.max.z;
    const coffeeTableOnRugCenter = coffeeTableFitsOnRug &&
      rugLateralOffset <= FURNITURE_ALIGNMENT_TOLERANCE &&
      rugForwardOffset <= FURNITURE_ALIGNMENT_TOLERANCE;
    const sofaHalfExtent = Math.abs(directionToTV.x) * (sofa.collider.maxX - sofa.collider.minX) / 2 +
      Math.abs(directionToTV.z) * (sofa.collider.maxZ - sofa.collider.minZ) / 2;
    const tableHalfExtent = Math.abs(directionToTV.x) * (coffeeTable.collider.maxX - coffeeTable.collider.minX) / 2 +
      Math.abs(directionToTV.z) * (coffeeTable.collider.maxZ - coffeeTable.collider.minZ) / 2;
    const sofaCoffeeTableClearance = tableForwardDistance - sofaHalfExtent - tableHalfExtent;
    const tableFitsBeforeTV = tableForwardDistance + tableHalfExtent <= distance - 0.35;
    const coffeeTableSuitable = sofaCoffeeTableClearance >= IDEAL_SOFA_TABLE_CLEARANCE.min &&
      sofaCoffeeTableClearance <= IDEAL_SOFA_TABLE_CLEARANCE.max &&
      tableFitsBeforeTV &&
      tableForwardDistance > 0 &&
      sofaTableAligned &&
      coffeeTableOnRugCenter;

    const distanceQuality = distanceIdeal
      ? 100
      : Math.max(0, 100 - Math.max(
        IDEAL_VIEWING_DISTANCE.min - distance,
        distance - IDEAL_VIEWING_DISTANCE.max,
        0
      ) * 45);
    const facingQuality = Math.max(0, Math.min(
      100,
      100 * (facingDot + 1) / (IDEAL_SOFA_FACING_DOT + 1)
    ));
    const clearanceQuality = sofaCoffeeTableClearance <= 0
      ? Math.max(40, 60 + sofaCoffeeTableClearance * 50)
      : sofaCoffeeTableClearance < IDEAL_SOFA_TABLE_CLEARANCE.min
        ? Math.max(0, 90 - (IDEAL_SOFA_TABLE_CLEARANCE.min - sofaCoffeeTableClearance) * 100)
        : sofaCoffeeTableClearance < IDEAL_SOFA_TABLE_CLEARANCE.max
          ? 90 + (sofaCoffeeTableClearance - IDEAL_SOFA_TABLE_CLEARANCE.min) /
            (IDEAL_SOFA_TABLE_CLEARANCE.max - IDEAL_SOFA_TABLE_CLEARANCE.min) * 10
          : Math.max(0, 100 - (sofaCoffeeTableClearance - IDEAL_SOFA_TABLE_CLEARANCE.max) * 50);
    const tableQuality = Math.min(
      clearanceQuality,
      Math.max(0, 100 - Math.max(0, tableLateralDistance - FURNITURE_ALIGNMENT_TOLERANCE) * 55),
      tableFitsBeforeTV ? 100 : 0
    );
    const rugQuality = Math.min(
      coffeeTableFitsOnRug ? 100 : 0,
      Math.max(0, 100 - rugCenterOffset * 100)
    );
    const score = facingTV && distanceIdeal && coffeeTableSuitable
      ? 100
      : scoreClamp(Math.min(
        99,
        clearanceQuality,
        facingQuality * 0.3 + distanceQuality * 0.35 + tableQuality * 0.2 + rugQuality * 0.15
      ));

    return {
      angleDegrees,
      distance,
      sofaCoffeeTableClearance,
      sofaTableAligned,
      coffeeTableSuitable,
      coffeeTableOnRugCenter,
      facingTV,
      distanceIdeal,
      score
    };
  },

  logViewingDistanceDebug(status) {
    const logData = {
      sofaAngleToTV: status.angleDegrees === null ? null : Number(status.angleDegrees.toFixed(1)),
      sofaDistanceToTV: status.distance === null ? null : Number(status.distance.toFixed(2)),
      sofaCoffeeTableClearance: status.sofaCoffeeTableClearance === null
        ? null
        : Number(status.sofaCoffeeTableClearance.toFixed(2)),
      sofaTableAligned: status.sofaTableAligned,
      coffeeTableSuitable: status.coffeeTableSuitable,
      coffeeTableOnRugCenter: status.coffeeTableOnRugCenter,
      viewingDistance: status.score
    };
    const key = JSON.stringify(logData);
    if (key === this.lastViewingDistanceDebugKey) return;
    this.lastViewingDistanceDebugKey = key;
    console.info('[Viewing Distance Debug]', logData);
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
        penalty += Math.max(0, SPEAKER_FACING_DOT_THRESHOLD - forward.dot(toSofa)) * 12;
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
