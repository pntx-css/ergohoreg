import type { Entity } from 'aframe';

type LookControls = {
  data?: { touchEnabled?: boolean };
  yawObject?: { rotation: { y: number } };
  pitchObject?: { rotation: { x: number } };
};

type CameraEntity = Entity & {
  components: Entity['components'] & {
    'look-controls'?: LookControls;
  };
};

type FpsControls = {
  mobileController?: MobileController | null;
};

const LOOK_SENSITIVITY = 0.004;
const MAX_PITCH = Math.PI / 2 - 0.05;

export class MobileController {
  private readonly camera: CameraEntity;
  private readonly touchZone: HTMLElement | null;
  private readonly controls: HTMLElement | null;
  private readonly interactionButton: HTMLButtonElement | null;
  private readonly keys = new Set<string>();
  private readonly activeButtons = new Map<number, string>();
  private touchPointer: { id: number; x: number; y: number } | null = null;
  private readonly fpsControls: FpsControls;
  private readonly originalTouchEnabled: boolean;
  private initialized = false;

  private readonly onLookPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' || this.touchPointer) return;
    event.preventDefault();
    this.touchPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.touchZone?.setPointerCapture(event.pointerId);
  };

  private readonly onLookPointerMove = (event: PointerEvent): void => {
    if (!this.touchPointer || event.pointerId !== this.touchPointer.id) return;
    event.preventDefault();

    const look = this.camera.components['look-controls'];
    if (!look?.yawObject || !look.pitchObject) return;

    look.yawObject.rotation.y -= (event.clientX - this.touchPointer.x) * LOOK_SENSITIVITY;
    look.pitchObject.rotation.x -= (event.clientY - this.touchPointer.y) * LOOK_SENSITIVITY;
    look.pitchObject.rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, look.pitchObject.rotation.x));
    this.touchPointer.x = event.clientX;
    this.touchPointer.y = event.clientY;
  };

  private readonly onControlPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('[data-key]');
    if (!button || !this.controls?.contains(button)) return;

    event.preventDefault();
    event.stopPropagation();
    const key = button.dataset.key;
    if (!key) return;

    this.activeButtons.set(event.pointerId, key);
    this.keys.add(key);
    button.classList.add('is-pressed');
    button.setAttribute('aria-pressed', 'true');
    button.setPointerCapture(event.pointerId);
  };

  private readonly onControlPointerEnd = (event: PointerEvent): void => {
    const target = event.target;
    const key = this.activeButtons.get(event.pointerId);
    if (key) {
      this.activeButtons.delete(event.pointerId);
      if (![...this.activeButtons.values()].includes(key)) this.keys.delete(key);
      if (target instanceof HTMLButtonElement) {
        target.classList.remove('is-pressed');
        target.setAttribute('aria-pressed', 'false');
      }
    }

    if (this.touchPointer?.id === event.pointerId) this.touchPointer = null;
  };

  private readonly onInteractionPointerDown = (event: PointerEvent): void => {
    this.interactionButton?.classList.add('is-pressed');
    this.interactionButton?.setPointerCapture(event.pointerId);
  };

  private readonly onInteractionPointerEnd = (): void => {
    this.interactionButton?.classList.remove('is-pressed');
  };

  private readonly onInteractionClick = (event: MouseEvent): void => {
    event.preventDefault();
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f',
      code: 'KeyF',
      bubbles: true,
      cancelable: true
    }));
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.activeButtons.clear();
    this.controls?.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button => {
      button.classList.remove('is-pressed');
      button.setAttribute('aria-pressed', 'false');
    });
    this.interactionButton?.classList.remove('is-pressed');
    this.touchPointer = null;
  };

  constructor(camera: Entity, fpsControls: FpsControls) {
    this.camera = camera as CameraEntity;
    this.touchZone = document.getElementById('touch-look');
    this.controls = document.getElementById('mobile-controls');
    this.interactionButton = document.querySelector<HTMLButtonElement>('#mobile-interact');
    this.fpsControls = fpsControls;
    this.fpsControls.mobileController = this;
    this.originalTouchEnabled = this.camera.components['look-controls']?.data?.touchEnabled ?? true;
    this.camera.setAttribute('look-controls', 'touchEnabled', false);
    this.init();
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.touchZone?.addEventListener('pointerdown', this.onLookPointerDown);
    this.touchZone?.addEventListener('pointermove', this.onLookPointerMove);
    this.touchZone?.addEventListener('pointerup', this.onControlPointerEnd);
    this.touchZone?.addEventListener('pointercancel', this.onControlPointerEnd);
    this.touchZone?.addEventListener('lostpointercapture', this.onControlPointerEnd);
    this.controls?.addEventListener('pointerdown', this.onControlPointerDown);
    this.controls?.addEventListener('pointerup', this.onControlPointerEnd);
    this.controls?.addEventListener('pointercancel', this.onControlPointerEnd);
    this.controls?.addEventListener('lostpointercapture', this.onControlPointerEnd);
    this.interactionButton?.addEventListener('pointerdown', this.onInteractionPointerDown);
    this.interactionButton?.addEventListener('pointerup', this.onInteractionPointerEnd);
    this.interactionButton?.addEventListener('pointercancel', this.onInteractionPointerEnd);
    this.interactionButton?.addEventListener('lostpointercapture', this.onInteractionPointerEnd);
    this.interactionButton?.addEventListener('click', this.onInteractionClick);
    window.addEventListener('blur', this.onBlur);
  }

  public getKeys(): ReadonlySet<string> {
    return this.keys;
  }

  public dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;
    this.touchZone?.removeEventListener('pointerdown', this.onLookPointerDown);
    this.touchZone?.removeEventListener('pointermove', this.onLookPointerMove);
    this.touchZone?.removeEventListener('pointerup', this.onControlPointerEnd);
    this.touchZone?.removeEventListener('pointercancel', this.onControlPointerEnd);
    this.touchZone?.removeEventListener('lostpointercapture', this.onControlPointerEnd);
    this.controls?.removeEventListener('pointerdown', this.onControlPointerDown);
    this.controls?.removeEventListener('pointerup', this.onControlPointerEnd);
    this.controls?.removeEventListener('pointercancel', this.onControlPointerEnd);
    this.controls?.removeEventListener('lostpointercapture', this.onControlPointerEnd);
    this.interactionButton?.removeEventListener('pointerdown', this.onInteractionPointerDown);
    this.interactionButton?.removeEventListener('pointerup', this.onInteractionPointerEnd);
    this.interactionButton?.removeEventListener('pointercancel', this.onInteractionPointerEnd);
    this.interactionButton?.removeEventListener('lostpointercapture', this.onInteractionPointerEnd);
    this.interactionButton?.removeEventListener('click', this.onInteractionClick);
    window.removeEventListener('blur', this.onBlur);
    this.camera.setAttribute('look-controls', 'touchEnabled', this.originalTouchEnabled);
    this.fpsControls.mobileController = null;
    this.onBlur();
  }
}
