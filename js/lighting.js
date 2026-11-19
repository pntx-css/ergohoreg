const ROOM_LIGHT_SOURCES = [
  {id: 'ceiling-left', position: '-1.6 3.8 -0.8', intensity: 2.2, distance: 7, group: 'ceiling'},
  {id: 'ceiling-center', position: '0 3.8 -0.8', intensity: 2.2, distance: 7, group: 'ceiling'},
  {id: 'ceiling-right', position: '1.6 3.8 -0.8', intensity: 2.2, distance: 7, group: 'ceiling'},
  {id: 'floor-lamp', position: '1.2 1.8 -1.2', intensity: 0.45, distance: 3.5, color: '#ffd49a'},
  {id: 'ambient-fill', type: 'ambient', intensity: 0.35, color: '#d5dfdf'}
];

AFRAME.registerComponent('room-point-lighting', {
  schema: {
    ceilingOn: {type: 'boolean', default: false}
  },

  init() {
    this.lights = ROOM_LIGHT_SOURCES.map(source => {
      const light = document.createElement('a-entity');
      light.id = `room-light-${source.id}`;
      if (source.position) light.setAttribute('position', source.position);
      light.dataset.baseIntensity = String(source.intensity);
      light.setAttribute('light', {
        type: source.type || 'point',
        color: source.color || '#fff1d8',
        intensity: source.intensity,
        distance: source.distance,
        decay: 2,
        castShadow: false
      });
      this.el.appendChild(light);
      return light;
    });
    this.updateCeilingLights();
  },

  update(oldData) {
    if (oldData.ceilingOn !== this.data.ceilingOn) this.updateCeilingLights();
  },

  updateCeilingLights() {
    for (const light of this.lights || []) {
      if (!light.id.startsWith('room-light-ceiling-')) continue;
      const baseIntensity = Number(light.dataset.baseIntensity);
      light.setAttribute('light', 'intensity', this.data.ceilingOn ? baseIntensity : 0);
    }
  },

  remove() {
    for (const light of this.lights) light.remove();
  }
});
