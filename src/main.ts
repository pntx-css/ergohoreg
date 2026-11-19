import type { Entity, Scene } from 'aframe';
import '../public/js/gameplay.js';
import { DesktopController } from './controllers/DesktopController';
import { MobileController } from './controllers/MobileController';
import { VRController } from './controllers/VRController';

type GameMode = 'desktop' | 'mobile' | 'vr';

type FpsControls = {
  desktopController?: DesktopController | null;
  mobileController?: MobileController | null;
  vrController?: VRController | null;
};

const GameMode = {
  Desktop: 'desktop',
  Mobile: 'mobile',
  VR: 'vr'
} as const;

const sceneEl = document.querySelector('a-scene') as Scene | null;
const cameraEl = document.getElementById('player-camera') as Entity | null;
const playerRig = document.getElementById('player-rig') as Entity | null;
const statusEl = document.getElementById('controller-status');
let currentMode: GameMode = GameMode.Desktop;
let currentDesktopController: DesktopController | null = null;
let currentMobileController: MobileController | null = null;
let currentVRController: VRController | null = null;
let controllersInitialized = false;

function updateDesktopStatus(isLocked: boolean): void {
  if (!statusEl) return;
  statusEl.hidden = currentMode !== GameMode.Desktop || document.body.classList.contains('is-start-menu-open');
  statusEl.textContent = isLocked
    ? 'Kontrol aktif · Esc untuk keluar'
    : 'Double-klik viewport untuk mengaktifkan mouse · WASD bergerak';
  statusEl.classList.toggle('is-active', isLocked);
}

function disposeControllers(): void {
  const fpsControls = playerRig?.components['fps-controls'] as FpsControls | undefined;
  currentDesktopController?.dispose();
  currentMobileController?.dispose();
  currentVRController?.dispose();
  if (fpsControls) fpsControls.vrController = null;
  currentDesktopController = null;
  currentMobileController = null;
  currentVRController = null;
}

function startActiveController(): void {
  if (!sceneEl || !cameraEl || !playerRig || !sceneEl.canvas || controllersInitialized) return;

  const fpsControls = playerRig.components['fps-controls'] as FpsControls | undefined;
  if (!fpsControls) {
    console.error('[main] fps-controls component is missing from #player-rig.');
    return;
  }

  controllersInitialized = true;
  switch (currentMode) {
    case GameMode.Desktop:
      currentDesktopController = new DesktopController(
        cameraEl,
        sceneEl,
        fpsControls,
        updateDesktopStatus,
        error => console.error('[main] Pointer Lock could not be activated.', error)
      );
      updateDesktopStatus(false);
      break;
    case GameMode.Mobile:
      statusEl && (statusEl.hidden = true);
      currentMobileController = new MobileController(fpsControls);
      break;
    case GameMode.VR:
      statusEl && (statusEl.hidden = true);
      currentVRController = new VRController(sceneEl);
      fpsControls.vrController = currentVRController;
      currentVRController.init();
      break;
  }
}

function initAppMode(mode: GameMode): void {
  disposeControllers();
  controllersInitialized = false;
  currentMode = mode;
  document.body.dataset.mode = mode;
  startActiveController();
}

function handleModeSelect(mode: string): void {
  if (!Object.values(GameMode).includes(mode as GameMode)) return;

  const selectedMode = mode as GameMode;
  document.body.classList.remove('is-start-menu-open');
  document.getElementById('start-menu')?.setAttribute('aria-hidden', 'true');

  const settingsDialog = document.getElementById('settings-dialog');
  if (settingsDialog) settingsDialog.hidden = true;
  document.getElementById('settings-toggle')?.setAttribute('aria-expanded', 'false');

  initAppMode(selectedMode);
  if (selectedMode === GameMode.VR) {
    const enteringVR = sceneEl?.enterVR();
    if (enteringVR instanceof Promise) {
      enteringVR.catch(error => console.error('[main] Failed to enter VR mode.', error));
    }
  }
}

function initModePicker(): void {
  document.querySelectorAll<HTMLButtonElement>('.mode-card[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.mode) handleModeSelect(button.dataset.mode);
    });
  });
}

function onSceneLoaded(): void {
  sceneEl?.removeEventListener('loaded', onSceneLoaded);
  startActiveController();
}

initModePicker();
sceneEl?.setAttribute('ergonomics-gameplay', '');
if (sceneEl?.hasLoaded) {
  startActiveController();
} else {
  sceneEl?.addEventListener('loaded', onSceneLoaded);
}

export { handleModeSelect, initAppMode, GameMode };
