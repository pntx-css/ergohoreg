const ROOM_LIGHT_SOURCES = [
  {id: 'ceiling-left', position: '-1.6 3.8 -0.8', intensity: 2.2, distance: 7},
  {id: 'ceiling-center', position: '0 3.8 -0.8', intensity: 2.2, distance: 7},
  {id: 'ceiling-right', position: '1.6 3.8 -0.8', intensity: 2.2, distance: 7},
  {id: 'floor-lamp', position: '1.2 1.8 -1.2', intensity: 1.1, distance: 3.5, color: '#ffd49a'}
];

AFRAME.registerComponent('room-point-lighting', {
  init() {
    this.lights = ROOM_LIGHT_SOURCES.map(source => {
      const light = document.createElement('a-entity');
      light.id = `room-light-${source.id}`;
      light.setAttribute('position', source.position);
      light.setAttribute('light', {
        type: 'point',
        color: source.color || '#fff1d8',
        intensity: source.intensity,
        distance: source.distance,
        decay: 2,
        castShadow: false
      });
      this.el.appendChild(light);
      return light;
    });
  },

  remove() {
    for (const light of this.lights) light.remove();
  }
});
