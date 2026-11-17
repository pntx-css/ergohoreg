type FpsControls = {
  mobileController?: MobileController | null;
};

export class MobileController {
  private readonly touchZone: HTMLElement | null;
  private readonly keys = new Set<string>();
  private touchAxis = { x: 0, y: 0 };
  private touchPointer: { id: number; x: number; y: number } | null = null;
  private readonly fpsControls: FpsControls;
  private initialized = false;

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    this.touchPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.touchZone?.setPointerCapture?.(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.touchPointer || event.pointerId !== this.touchPointer.id) return;
    event.preventDefault();
    event.stopPropagation();
    this.touchAxis = {
      x: Math.max(-1, Math.min(1, (event.clientX - this.touchPointer.x) / 70)),
      y: Math.max(-1, Math.min(1, (this.touchPointer.y - event.clientY) / 70))
    };
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (!this.touchPointer || event.pointerId !== this.touchPointer.id) return;
    this.touchPointer = null;
    this.touchAxis = { x: 0, y: 0 };
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const allowed = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!allowed.includes(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.touchPointer = null;
    this.touchAxis = { x: 0, y: 0 };
  };

  constructor(fpsControls: FpsControls) {
    this.touchZone = document.getElementById('touch-move');
    this.fpsControls = fpsControls;
    this.fpsControls.mobileController = this;
    this.init();
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.touchZone?.addEventListener('pointerdown', this.onPointerDown);
    this.touchZone?.addEventListener('pointermove', this.onPointerMove);
    this.touchZone?.addEventListener('pointerup', this.onPointerEnd);
    this.touchZone?.addEventListener('pointercancel', this.onPointerEnd);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  public getTouchAxis(): { x: number; y: number } | null {
    return this.touchPointer ? { ...this.touchAxis } : null;
  }

  public getKeys(): ReadonlySet<string> {
    return this.keys;
  }

  public dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;
    this.touchZone?.removeEventListener('pointerdown', this.onPointerDown);
    this.touchZone?.removeEventListener('pointermove', this.onPointerMove);
    this.touchZone?.removeEventListener('pointerup', this.onPointerEnd);
    this.touchZone?.removeEventListener('pointercancel', this.onPointerEnd);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.fpsControls.mobileController = null;
    this.onBlur();
  }
}
