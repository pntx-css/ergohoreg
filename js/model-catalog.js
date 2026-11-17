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
    .sort((left, right) => left.filename.localeCompare(right.filename));
}

let modelUrls = {};
try {
  // Vite expands this at startup and refreshes the list when a GLB is added during development.
  modelUrls = import.meta.glob([
    '../models/*.glb',
    '!../models/living_room_interior_free*.glb',
    '!../models/*.original.glb',
    '!../models/lamp.glb'
  ], {
    eager: true,
    query: '?url',
    import: 'default'
  });
} catch (error) {
  console.error('[Models] Could not scan models/*.glb. Run the project with Vite to discover model files.', error);
}

export const catalog = buildModelCatalog(modelUrls);
publishModelCatalog(catalog);

if (import.meta.hot) {
  import.meta.hot.accept(updated => {
    if (updated?.catalog) publishModelCatalog(updated.catalog);
  });
}
