import type { Entity } from 'aframe';

type LookControls = {
  yawObject?: { rotation: { y: number } };
  pitchObject?: { rotation: { x: number } };
};

type CameraEntity = Entity & {
  components: Entity['components'] & {
    'look-controls'?: LookControls;
  };
};

export class PointerLockController {
  private locked = false;
  private initialized = false;
  private errorReported = false;
  private requestInProgress = false;

  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (
      event.detail < 2 ||
      this.locked ||
      document.body.dataset.mode !== 'desktop' ||
      document.body.classList.contains('is-start-menu-open')
    ) return;

    const bounds = this.viewport.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom ||
      (event.target instanceof Element &&
        event.target.closest('button, input, textarea, select, a, [role="dialog"]')) ||
      this.isOverUi(event.clientX, event.clientY)
    ) return;

    this.requestLock();
  };

  private readonly onPointerLockChange = (): void => {
    const isLocked = document.pointerLockElement === this.viewport;
    if (this.locked === isLocked) return;

    this.locked = isLocked;
    this.requestInProgress = false;
    this.errorReported = false;
    this.onLockChange(isLocked);
  };

  private readonly onPointerLockError = (event: Event): void => {
    this.reportError(event);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.updateLook(event.movementX, event.movementY);
  };

  private updateLook(deltaX: number, deltaY: number): void {
    const look = (this.camera as CameraEntity).components['look-controls'];
    if (!look?.yawObject || !look.pitchObject) return;

    const sensitivity = 0.0022;
    look.yawObject.rotation.y -= deltaX * sensitivity;
    look.pitchObject.rotation.x -= deltaY * sensitivity;

    const maxPitch = Math.PI / 2 - 0.05;
    look.pitchObject.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, look.pitchObject.rotation.x));
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.locked) return;
    event.preventDefault();

    const look = (this.camera as CameraEntity).components['look-controls'];
    if (!look?.yawObject || !look.pitchObject) return;

    const sensitivity = 0.0018;
    look.yawObject.rotation.y -= event.deltaX * sensitivity;
    look.pitchObject.rotation.x -= event.deltaY * sensitivity;
    const maxPitch = Math.PI / 2 - 0.05;
    look.pitchObject.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, look.pitchObject.rotation.x));
  };

  constructor(
    private readonly camera: Entity,
    private readonly viewport: HTMLCanvasElement,
    private readonly onLockChange: (isLocked: boolean) => void,
    private readonly onError: (error: Event | Error) => void
  ) {
    this.init();
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;

    document.addEventListener('click', this.onDoubleClick);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('wheel', this.onWheel, { passive: false });
  }

  public requestLock(): void {
    if (this.locked || this.requestInProgress || document.pointerLockElement) return;
    this.errorReported = false;
    this.requestInProgress = true;

    try {
      const requestPointerLock = this.viewport.requestPointerLock as () => Promise<void> | void;
      const request = requestPointerLock.call(this.viewport);
      if (request && typeof request.catch === 'function') {
        request.catch(error => this.reportError(error instanceof Error ? error : new Error(String(error))));
      }
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public exitLock(): void {
    if (document.pointerLockElement === this.viewport) {
      document.exitPointerLock();
    }
  }

  public getIsLocked(): boolean {
    return this.locked;
  }

  public dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;

    document.removeEventListener('click', this.onDoubleClick);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('wheel', this.onWheel);
    this.exitLock();
  }

  private isOverUi(x: number, y: number): boolean {
    const overlayIds = [
      'start-menu',
      'settings-dialog',
      'interaction-panel',
      'door-confirmation-dialog',
      'game-completion-popup',
      'enjoy-film-popup',
      'f-interaction-popup',
      'ergonomics-panel',
      'position-coordinates',
      'grab-controls',
      'controller-status',
      'mobile-controls',
      'mobile-orientation-overlay',
      'mobile-fullscreen-prompt'
    ];

    return overlayIds.some(id => {
      const element = document.getElementById(id);
      if (!element || element.hidden) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const bounds = element.getBoundingClientRect();
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    });
  }

  private reportError(error: Event | Error): void {
    if (this.errorReported) return;
    this.errorReported = true;
    this.requestInProgress = false;
    console.warn('[PointerLockController] Browser rejected pointer lock.', error);
    this.onError(error);
  }
}
