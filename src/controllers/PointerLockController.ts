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
    const target = event.target;
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom ||
      (target instanceof Element &&
        target.closest('button, input, textarea, select, a, [role="dialog"], [role="alertdialog"]'))
    ) return;

    this.requestLock();
  };

  private readonly onPointerLockChange = (): void => {
    const isLocked = document.pointerLockElement === this.viewport;
    this.requestInProgress = false;
    if (this.locked === isLocked) return;

    this.locked = isLocked;
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
    if (this.locked || this.requestInProgress) return;
    this.errorReported = false;
    if (document.pointerLockElement === this.viewport) {
      this.onPointerLockChange();
      return;
    }
    if (document.pointerLockElement) {
      this.reportError(new Error('Pointer Lock is already owned by another element.'));
      return;
    }
    if (typeof this.viewport.requestPointerLock !== 'function') {
      this.reportError(new Error('Pointer Lock API is not supported by this browser.'));
      return;
    }
    this.requestInProgress = true;

    try {
      const request = this.viewport.requestPointerLock();
      if (request && typeof request.then === 'function') {
        request.then(
          () => {
            this.requestInProgress = false;
            this.onPointerLockChange();
          },
          error => this.reportError(error instanceof Error ? error : new Error(String(error)))
        );
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

  private reportError(error: Event | Error): void {
    if (this.errorReported) return;
    this.errorReported = true;
    this.requestInProgress = false;
    console.warn('[PointerLockController] Browser rejected pointer lock.', error);
    this.onError(error);
  }
}
