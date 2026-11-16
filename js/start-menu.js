(() => {
  const menu = document.getElementById('start-menu');
  const dialog = document.getElementById('settings-dialog');
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsClose = document.getElementById('settings-close');
  const volume = document.getElementById('volume-control');
  const volumeOutput = volume?.nextElementSibling;

  const closeSettings = () => {
    dialog.hidden = true;
    settingsToggle.setAttribute('aria-expanded', 'false');
  };

  settingsToggle.addEventListener('click', () => {
    dialog.hidden = false;
    settingsToggle.setAttribute('aria-expanded', 'true');
    settingsClose.focus();
  });
  settingsClose.addEventListener('click', closeSettings);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeSettings();
  });
  volume?.addEventListener('input', () => {
    volumeOutput.value = `${volume.value}%`;
    volumeOutput.textContent = `${volume.value}%`;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !dialog.hidden) closeSettings();
  });

  document.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      document.body.dataset.mode = mode;
      document.body.classList.remove('is-start-menu-open');
      menu.setAttribute('aria-hidden', 'true');
      closeSettings();

      if (mode === 'vr') {
        const scene = document.querySelector('a-scene');
        if (scene?.enterVR) scene.enterVR();
      }
    });
  });
})();
