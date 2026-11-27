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
  private dragPointer: {id: number; x: number; y: number} | null = null;

  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (event.target !== this.viewport || this.locked || this.isOverUi(event.clientX, event.clientY)) return;
    this.requestLock();
  };

  private readonly onPointerLockChange = (): void => {
    const isLocked = document.pointerLockElement === this.viewport;
    if (this.locked === isLocked) return;

    this.locked = isLocked;
    this.requestInProgress = false;
    this.errorReported = false;
    this.dragPointer = null;
    this.onLockChange(isLocked);
  };

  private readonly onPointerLockError = (event: Event): void => {
    this.reportError(event);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.updateLook(event.movementX, event.movementY);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (
      this.locked ||
      event.pointerType !== 'mouse' ||
      event.button !== 0 ||
      event.target !== this.viewport ||
      document.body.dataset.mode !== 'desktop' ||
      document.body.classList.contains('is-start-menu-open')
    ) return;
    this.dragPointer = {id: event.pointerId, x: event.clientX, y: event.clientY};
    this.viewport.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.locked || !this.dragPointer || event.pointerId !== this.dragPointer.id) return;
    this.updateLook(event.clientX - this.dragPointer.x, event.clientY - this.dragPointer.y);
    this.dragPointer.x = event.clientX;
    this.dragPointer.y = event.clientY;
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (this.dragPointer?.id === event.pointerId) this.dragPointer = null;
  };

  private updateLook(deltaX: number, deltaY: number): void {
    const look = (this.camera as CameraEntity).components['look-controls'];
    if (!look?.yawObject || !look.pitchObject) return;

    const sensitivity = 0.003;
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

    this.viewport.addEventListener('dblclick', this.onDoubleClick);
    this.viewport.addEventListener('pointerdown', this.onPointerDown);
    this.viewport.addEventListener('pointermove', this.onPointerMove);
    this.viewport.addEventListener('pointerup', this.onPointerEnd);
    this.viewport.addEventListener('pointercancel', this.onPointerEnd);
    this.viewport.addEventListener('lostpointercapture', this.onPointerEnd);
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

    this.viewport.removeEventListener('dblclick', this.onDoubleClick);
    this.viewport.removeEventListener('pointerdown', this.onPointerDown);
    this.viewport.removeEventListener('pointermove', this.onPointerMove);
    this.viewport.removeEventListener('pointerup', this.onPointerEnd);
    this.viewport.removeEventListener('pointercancel', this.onPointerEnd);
    this.viewport.removeEventListener('lostpointercapture', this.onPointerEnd);
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
      'ergonomics-panel',
      'position-coordinates',
      'grab-controls',
      'controller-status'
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
