type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
};

const MOBILE_DEVICE_PATTERN = /Android|iPhone|iPad|iPod|IEMobile|Windows Phone|Mobile/i;

export function isMobileDevice(): boolean {
  const userAgent = navigator.userAgent;
  const isTouchIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const hasCoarseTouch = navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
  return MOBILE_DEVICE_PATTERN.test(userAgent) || isTouchIPad || hasCoarseTouch;
}

export class MobileDisplayController {
  private readonly fullscreenButtons: HTMLButtonElement[];
  private readonly orientationHint: HTMLElement | null;
  private readonly fullscreenHint: HTMLElement | null;
  private readonly screenOrientation: ScreenOrientationWithLock;
  private active = false;
  private requestedFullscreen = false;

  private readonly onResize = (): void => this.updateDisplayState();
  private readonly onFullscreenChange = (): void => this.updateDisplayState();
  private readonly onOrientationChange = (): void => this.updateDisplayState();
  private readonly onFullscreenClick = (): void => {
    void this.requestFullscreenAndLandscape();
  };

  constructor() {
    this.fullscreenButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-mobile-fullscreen]')
    );
    this.orientationHint = document.getElementById('mobile-orientation-hint');
    this.fullscreenHint = document.getElementById('mobile-fullscreen-hint');
    this.screenOrientation = screen.orientation as ScreenOrientationWithLock;

    if (!isMobileDevice()) return;
    this.active = true;
    document.body.classList.add('is-mobile-device');
    this.fullscreenButtons.forEach(button => button.addEventListener('click', this.onFullscreenClick));
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onOrientationChange);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.screenOrientation?.addEventListener?.('change', this.onOrientationChange);
    this.updateDisplayState();
    void this.requestFullscreenAndLandscape();
  }

  public dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.fullscreenButtons.forEach(button => button.removeEventListener('click', this.onFullscreenClick));
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onOrientationChange);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.screenOrientation?.removeEventListener?.('change', this.onOrientationChange);
    document.body.classList.remove('is-mobile-device', 'is-mobile-portrait', 'is-mobile-fullscreen');
    this.screenOrientation?.unlock?.();

    if (this.requestedFullscreen && document.fullscreenElement) {
      void document.exitFullscreen().catch(error => {
        console.warn('[MobileDisplayController] Could not exit fullscreen.', error);
      });
    }
  }

  private async requestFullscreenAndLandscape(): Promise<void> {
    if (!this.active) return;
    let fullscreenFailure: unknown = null;
    if (!document.fullscreenElement) {
      const requestFullscreen = document.documentElement.requestFullscreen;
      if (!requestFullscreen) {
        fullscreenFailure = new Error('Fullscreen API is not supported by this browser.');
      } else {
        try {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
          this.requestedFullscreen = true;
        } catch (error) {
          fullscreenFailure = error;
        }
      }
    }

    let orientationFailure: unknown = null;
    if (this.screenOrientation?.lock) {
      try {
        await this.screenOrientation.lock('landscape');
      } catch (error) {
        orientationFailure = error;
      }
    } else {
      orientationFailure = new Error('Screen Orientation API is not supported by this browser.');
    }

    if (fullscreenFailure) {
      this.setFullscreenHint('Fullscreen tidak tersedia otomatis. Gunakan tombol ini atau menu browser.');
      console.info('[MobileDisplayController] Fullscreen requires browser support or user activation.', fullscreenFailure);
    } else if (orientationFailure) {
      this.setOrientationHint('Putar perangkat secara manual ke posisi landscape.');
      console.info('[MobileDisplayController] Landscape lock is unavailable; manual rotation is required.', orientationFailure);
    }
    this.updateDisplayState();
  }

  private updateDisplayState(): void {
    if (!this.active) return;
    const portrait = window.matchMedia('(orientation: portrait)').matches ||
      window.innerHeight > window.innerWidth;
    const fullscreen = !!document.fullscreenElement;
    document.body.classList.toggle('is-mobile-portrait', portrait);
    document.body.classList.toggle('is-mobile-fullscreen', fullscreen);

    this.fullscreenButtons.forEach(button => {
      button.hidden = fullscreen;
    });
    if (!portrait) this.setOrientationHint('Putar perangkat secara manual ke posisi landscape.');
    if (fullscreen) this.setFullscreenHint('');
  }

  private setOrientationHint(message: string): void {
    if (this.orientationHint) this.orientationHint.textContent = message;
  }

  private setFullscreenHint(message: string): void {
    if (this.fullscreenHint) this.fullscreenHint.textContent = message;
  }
}
