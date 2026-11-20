import type { Entity, Scene } from 'aframe';
import { PointerLockController } from './PointerLockController';

type FpsControls = {
  desktopController?: DesktopController | null;
};

export class DesktopController {
  private readonly keys = new Set<string>();
  private readonly fpsControls: FpsControls;
  private readonly pointerLockController: PointerLockController;
  private active = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || !this.pointerLockController.getIsLocked()) return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return;

    event.preventDefault();
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (!this.active || !this.pointerLockController.getIsLocked()) return;

    event.preventDefault();
    event.stopPropagation();
    const editor = this.sceneEl.components['furniture-editor'];
    if (editor && (editor.grabbedItem || editor.nearbyItem)) editor.toggleGrab();
  };

  private readonly onBlur = (): void => {
    this.clearInput();
  };

  constructor(
    camera: Entity,
    private readonly sceneEl: Scene,
    fpsControls: FpsControls,
    onLockChange: (isLocked: boolean) => void,
    onPointerLockError: (error: Event | Error) => void
  ) {
    this.fpsControls = fpsControls;
    this.fpsControls.desktopController = this;
    this.pointerLockController = new PointerLockController(
      camera,
      sceneEl.canvas,
      isLocked => {
        this.active = isLocked;
        if (!isLocked) this.clearInput();
        onLockChange(isLocked);
      },
      onPointerLockError
    );

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('blur', this.onBlur);
  }

  public getKeys(): ReadonlySet<string> {
    return this.keys;
  }

  public requestPointerLock(): void {
    this.pointerLockController.requestLock();
  }

  public exitPointerLock(): void {
    this.pointerLockController.exitLock();
  }

  public dispose(): void {
    this.clearInput();
    this.active = false;
    this.fpsControls.desktopController = null;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('blur', this.onBlur);
    this.pointerLockController.dispose();
  }

  private clearInput(): void {
    this.keys.clear();
  }
}
