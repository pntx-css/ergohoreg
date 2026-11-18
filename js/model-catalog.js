import telephoneModelUrl from '../models/telephone_on_a_table.glb?url';
import coffeeTableModelUrl from '../models/coffee_table_-_living_room.glb?url';

function publishModelCatalog(catalog) {
  window.LivingRoomModelCatalog = catalog;
  window.LivingRoomModelCatalogReady = true;
  window.dispatchEvent(new Event('living-room-model-catalog-ready'));
}

function buildModelCatalog(urls) {
  return Object.entries(urls)
    .map(([modulePath, url]) => {
      let filename = modulePath.split('/').pop();
      try { filename = decodeURIComponent(filename); } catch (_) {}
      return {filename, path: `./models/${filename}`, url};
    })
    .filter(model => !/^living_room_interior_free(?:\.original)?\.glb$/i.test(model.filename))
    .filter(model => !/\.original\.glb$/i.test(model.filename))
    .filter(model => !/^lamp\.glb$/i.test(model.filename))
    .filter(model => !/^telephone_on_a_table\.glb$/i.test(model.filename))
    .filter(model => !/^coffee_table_-_living_room\.glb$/i.test(model.filename))
    .sort((left, right) => left.filename.localeCompare(right.filename));
}

let modelUrls = {};
try {
  // Vite expands this at startup and refreshes the list when a GLB is added during development.
  modelUrls = import.meta.glob([
    '../models/*.glb',
    '!../models/living_room_interior_free*.glb',
    '!../models/*.original.glb',
    '!../models/lamp.glb',
    '!../models/telephone_on_a_table.glb',
    '!../models/coffee_table_-_living_room.glb'
  ], {
    eager: true,
    query: '?url',
    import: 'default'
  });
} catch (error) {
  console.error('[Models] Could not scan models/*.glb. Run the project with Vite to discover model files.', error);
}

export const catalog = buildModelCatalog(modelUrls);
const telephoneEntity = document.getElementById('TELEPHONE');
if (telephoneEntity) telephoneEntity.setAttribute('gltf-model', telephoneModelUrl);
else console.error('[Models] The #TELEPHONE entity is missing.');
const coffeeTableEntity = document.getElementById('MEJA');
if (coffeeTableEntity) coffeeTableEntity.setAttribute('gltf-model', coffeeTableModelUrl);
else console.error('[Models] The #MEJA entity is missing.');
publishModelCatalog(catalog);

if (import.meta.hot) {
  import.meta.hot.accept(updated => {
    if (updated?.catalog) publishModelCatalog(updated.catalog);
  });
}
