import type { Entity, Scene } from 'aframe';
import type { Intersection, Raycaster } from 'three';

declare const THREE: typeof import('three');

type XRInput = {
  handedness: string;
  gamepad: Gamepad;
};

type XRManager = {
  getSession?: () => { inputSources: Array<{ handedness: string; gamepad?: Gamepad }> } | null;
};

type SceneWithXR = Scene & {
  renderer: Scene['renderer'] & { xr?: XRManager };
};

type RaycastObject = import('three').Object3D & { el?: Entity };

export class VRController {
  private readonly raycaster: Raycaster;
  private camera: Entity | null = null;
  private initialized = false;

  private readonly onEnterVR = (): void => {
    document.exitPointerLock?.();
    document.body.classList.add('in-vr');
  };

  private readonly onExitVR = (): void => {
    document.body.classList.remove('in-vr');
  };

  constructor(private readonly sceneEl: Scene) {
    this.raycaster = new THREE.Raycaster();
    this.camera = document.getElementById('player-camera') as Entity | null;
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.sceneEl.addEventListener('enter-vr', this.onEnterVR);
    this.sceneEl.addEventListener('exit-vr', this.onExitVR);
  }

  public getInputSource(): XRInput | null {
    const session = (this.sceneEl as SceneWithXR).renderer?.xr?.getSession?.();
    const source = session ? Array.from(session.inputSources).find(input => input.handedness && input.gamepad) : undefined;
    if (!source?.gamepad) return null;
    return { handedness: source.handedness, gamepad: source.gamepad };
  }

  public getMovementAxis(): { x: number; y: number } | null {
    if (!this.sceneEl.is('vr-mode')) return null;
    const session = (this.sceneEl as SceneWithXR).renderer?.xr?.getSession?.();
    const source = session
      ? Array.from(session.inputSources).find(input => input.handedness === 'left' && input.gamepad)
      : undefined;
    if (!source?.gamepad) return null;

    const axes = source.gamepad.axes;
    const axisX = axes.length >= 4 ? axes[2] : axes[0] || 0;
    const axisY = axes.length >= 4 ? axes[3] : axes[1] || 0;
    return {
      x: Math.abs(axisX) < 0.18 ? 0 : axisX,
      y: Math.abs(axisY) < 0.18 ? 0 : -axisY
    };
  }

  public raycast(): Intersection[] | null {
    if (!this.camera) return null;

    const origin = this.camera.object3D.getWorldPosition(new THREE.Vector3());
    const direction = this.camera.object3D.getWorldDirection(new THREE.Vector3());
    const objects = Array.from(
      document.querySelectorAll('[furniture-grabbable], [gltf-model]')
    ).map(element => (element as Entity).object3D);
    this.raycaster.set(origin, direction);
    const results = this.raycaster.intersectObjects(objects, true);
    return results.length ? results : null;
  }

  public handleVRInteraction(): void {
    const intersection = this.raycast()?.[0];
    if (!intersection) return;

    let object: RaycastObject | null = intersection.object as RaycastObject;
    while (object) {
      if (object.el?.matches('[furniture-grabbable]')) {
        const editor = document.querySelector('[furniture-editor]') as Entity | null;
        editor?.components['furniture-editor']?.toggleGrab?.();
        return;
      }
      object = object.parent as RaycastObject | null;
    }
  }

  public dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;
    this.sceneEl.removeEventListener('enter-vr', this.onEnterVR);
    this.sceneEl.removeEventListener('exit-vr', this.onExitVR);
    if (this.sceneEl.is('vr-mode')) {
      const exitingVR = this.sceneEl.exitVR();
      if (exitingVR instanceof Promise) {
        exitingVR.catch(error => console.error('[VRController] Failed to exit VR mode.', error));
      }
    }
    document.body.classList.remove('in-vr');
  }
}
