import * as THREE from "three";
import { advanceZoom } from "./camera-zoom.js";
import { nextFrameDeadline } from "./frame-timing.js";
import { createTrailGeometry } from "./trail-geometry.js";
import { advanceRotationAngle } from "./camera-rotation.js";
import { createParticleSeeds } from "./particle-seeds.js";
import {
  particleFragmentShader,
  particleVertexShader,
} from "./particle-shaders.js";
import {
  validateInteractions,
  validateScene,
  validateSettings,
  type GatherformScene,
  type Interactions,
  type Settings,
} from "../scene/scene.js";

export interface PlayerOptions {
  settings?: Partial<Settings>;
  interactions?: Partial<Interactions>;
  paused?: boolean;
  /** Upper bounds for drawing frequency (60 by default) and screen density. */
  maxFps?: 30 | 60;
  maxPixelRatio?: number;
  onTransitionEnd?: (imageIndex: number) => void;
  /** Reports the visible light pulse, including keyboard and imperative triggers. */
  onLightPulseChange?: (active: boolean) => void;
  onError?: (error: Error) => void;
}

/** Owns one canvas and its GPU resources. Call dispose when its host is removed. */
export class GatherformPlayer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private readonly group = new THREE.Group();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly depthMaterial: THREE.ShaderMaterial;
  private readonly trailMaterial: THREE.ShaderMaterial;
  private trailLines: THREE.LineSegments | null = null;
  private readonly cloudCenters: THREE.Vector3[];
  private readonly overlay = document.createElement("canvas");
  private readonly overlayContext: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly motionPreference = matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private readonly eventController = new AbortController();
  private settings: Settings;
  private interactions: Interactions;
  private activeImage: number;
  private previousImage: number;
  private clockSeconds = 0;
  private driftClockSeconds = 0;
  private transitionStartSeconds = -10;
  private transitionDurationSeconds = 1;
  private transitioning = false;
  private scatterAmount = 0;
  private scatterTarget = 0;
  private lightStartSeconds = -10;
  private lightPulseActive = false;
  private animationFrame = 0;
  private lastFrameMilliseconds = 0;
  private frameDeadlineMilliseconds = 0;
  private visible = true;
  private paused = false;
  private disposed = false;
  private dragging: {
    id: number;
    x: number;
    y: number;
    moved: boolean;
  } | null = null;
  private rotationTarget = new THREE.Vector2();
  private pointer = new THREE.Vector2(100, 100);
  private readonly pointerWakes = Array.from(
    { length: 6 },
    () => new THREE.Vector4(100, 100, 0, 0),
  );
  private pointerWakeIndex = 0;
  private readonly pointerVelocity = new THREE.Vector2();
  private pointerUpdatedMilliseconds = 0;
  private zoom = 1;
  private width = 1;
  private height = 1;
  private audioLevel = 0;
  private lastOverlaySeconds = -1;
  private readonly pointerNormalized = new THREE.Vector2();
  private readonly overlayPoint = new THREE.Vector3();
  private readonly overlayTarget = new THREE.Vector3();
  private readonly overlayAnchors = Array.from(
    { length: 28 },
    () => new THREE.Vector3(),
  );
  private pointCountLabel = "";
  private particleSeeds: Float32Array | null = null;
  private options: PlayerOptions;

  constructor(
    private readonly host: HTMLElement,
    private readonly data: GatherformScene,
    options: PlayerOptions = {},
  ) {
    validateScene(data);
    if (
      options.maxFps !== undefined &&
      options.maxFps !== 30 &&
      options.maxFps !== 60
    )
      throw new Error("Frame rate must be 30 or 60.");
    if (
      options.maxPixelRatio !== undefined &&
      (!Number.isFinite(options.maxPixelRatio) ||
        options.maxPixelRatio < 0.5 ||
        options.maxPixelRatio > 2)
    )
      throw new Error("Pixel ratio must be between 0.5 and 2.");

    this.settings = validateSettings({ ...data.settings, ...options.settings });
    this.interactions = validateInteractions({
      ...data.interactions,
      ...options.interactions,
    });
    // Compute a fixed pivot once, before drift or pointer movement changes the display.
    this.cloudCenters = data.clouds.map((cloud) =>
      new THREE.Box3()
        .setFromBufferAttribute(new THREE.BufferAttribute(cloud.positions, 3))
        .getCenter(new THREE.Vector3()),
    );
    this.activeImage = data.activeImage;
    this.previousImage = data.activeImage;
    this.options = options;
    this.paused = options.paused ?? false;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, options.maxPixelRatio ?? 1.5),
    );
    this.renderer.setClearColor(0, 0);
    this.renderer.domElement.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;touch-action:pan-y;";
    this.overlay.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    this.overlay.setAttribute("aria-hidden", "true");
    const overlayContext = this.overlay.getContext("2d");
    if (!overlayContext) {
      this.renderer.dispose();
      throw new Error("Canvas rendering is unavailable.");
    }
    this.overlayContext = overlayContext;

    this.material = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: {
        depthPass: { value: 0 },
        trailPass: { value: 0 },
        scanPlane: { value: new THREE.Vector2(0, 0) },
        elapsedSeconds: { value: 0 },
        driftElapsedSeconds: { value: 0 },
        transitionProgress: { value: 1 },
        scatterAmount: { value: 0 },
        depthStrength: { value: 1 },
        driftStrength: { value: 0 },
        driftSpread: { value: 0.75 },
        splashStrength: { value: 1 },
        pointSize: { value: 1 },
        pixelRatio: { value: this.renderer.getPixelRatio() },
        grainScale: { value: 1 },
        opacity: { value: 1 },
        lightPaper: { value: 0 },
        pointerStrength: { value: 0 },
        pointerRadius: { value: 0.2 },
        pointerWakes: { value: this.pointerWakes },
        viewportAspect: { value: 1 },
        sourceCenter: { value: this.cloudCenters[this.activeImage] },
        targetCenter: { value: this.cloudCenters[this.activeImage] },
        driftLine: { value: new THREE.Vector3() },
        driftSide: { value: 1 },
        swarm: { value: 1 },
        audioLevel: { value: 0 },
        lightPulse: { value: 0 },
        lightColor: { value: new THREE.Color() },
        tone: { value: 0 },
      },
    });
    Object.assign(this.material.defaultAttributeValues, { trailEnd: [0] });
    this.trailMaterial = this.material.clone();
    this.trailMaterial.uniforms = {
      ...this.material.uniforms,
      trailPass: { value: 1 },
    };
    this.setCloudAttributes(this.activeImage, this.activeImage);
    // Share point buffers and motion uniforms; the first pass only records solid grain depth.
    this.depthMaterial = this.material.clone();
    this.depthMaterial.uniforms = {
      ...this.material.uniforms,
      depthPass: { value: 1 },
    };
    this.depthMaterial.transparent = false;
    this.depthMaterial.depthWrite = true;
    this.depthMaterial.colorWrite = false;
    this.depthMaterial.blending = THREE.NoBlending;
    const depthPoints = new THREE.Points(this.geometry, this.depthMaterial);
    const colorPoints = new THREE.Points(this.geometry, this.material);
    colorPoints.renderOrder = 1;
    this.group.add(depthPoints, colorPoints);
    this.scene.add(this.group);
    this.host.append(this.renderer.domElement, this.overlay);

    const signal = this.eventController.signal;
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.handlePointerDown, { signal });
    canvas.addEventListener("pointermove", this.handlePointerMove, { signal });
    canvas.addEventListener("pointerup", this.handlePointerUp, { signal });
    canvas.addEventListener("pointercancel", this.handlePointerCancel, {
      signal,
    });
    canvas.addEventListener(
      "pointerleave",
      () => {
        this.pointerUpdatedMilliseconds = 0;
        this.requestFrame();
      },
      { signal },
    );
    canvas.addEventListener("wheel", this.handleWheel, {
      signal,
      passive: false,
    });
    canvas.addEventListener("webglcontextlost", this.handleContextLost, {
      signal,
    });
    document.addEventListener(
      "visibilitychange",
      () => {
        this.lastFrameMilliseconds = 0;
        this.requestFrame();
      },
      {
        signal,
      },
    );
    this.motionPreference.addEventListener("change", this.requestFrame, {
      signal,
    });

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.requestFrame();
    });
    this.intersectionObserver.observe(host);
    this.update(options);
    this.resize();
  }

  // ---------------------------------------------------------
  // Public controls
  // ---------------------------------------------------------

  update(options: PlayerOptions): void {
    if (
      options.maxFps !== undefined &&
      options.maxFps !== 30 &&
      options.maxFps !== 60
    )
      throw new Error("Frame rate must be 30 or 60.");
    if (
      options.maxPixelRatio !== undefined &&
      (!Number.isFinite(options.maxPixelRatio) ||
        options.maxPixelRatio < 0.5 ||
        options.maxPixelRatio > 2)
    )
      throw new Error("Pixel ratio must be between 0.5 and 2.");

    this.settings = validateSettings({
      ...this.data.settings,
      ...options.settings,
    });
    this.interactions = validateInteractions({
      ...this.data.interactions,
      ...options.interactions,
    });
    this.syncTrails();
    this.options = options;
    this.paused = options.paused ?? false;
    this.lastOverlaySeconds = -1;
    const pixelRatio = Math.min(devicePixelRatio, options.maxPixelRatio ?? 1.5);
    if (this.renderer.getPixelRatio() !== pixelRatio) {
      this.renderer.setPixelRatio(pixelRatio);
      this.material.uniforms.pixelRatio.value = pixelRatio;
      this.resize();
    }

    // Revoked controls cannot leave an old drag or pointer effect active.
    if (!this.interactions.pointer) this.pointer.set(100, 100);
    if (!this.interactions.rotate) this.rotationTarget.set(0, 0);
    if (!this.interactions.zoom) this.zoom = 1;
    this.renderer.domElement.style.touchAction =
      this.interactions.rotate || this.interactions.pan ? "none" : "pan-y";
    this.requestFrame();
  }

  transitionTo(imageIndex: number, replay = false): void {
    if (
      !Number.isInteger(imageIndex) ||
      imageIndex < 0 ||
      imageIndex >= this.data.clouds.length
    )
      throw new Error("Unknown picture.");
    if (this.transitioning || (imageIndex === this.activeImage && !replay))
      return;

    this.previousImage = this.activeImage;
    this.activeImage = imageIndex;
    this.setCloudAttributes(this.previousImage, imageIndex);
    this.transitionStartSeconds = this.clockSeconds;
    this.transitionDurationSeconds = 0.5 + (1 - this.settings.gather) * 4;
    this.transitioning = true;
    this.scatterTarget = 0;
    this.requestFrame();
  }

  next(): void {
    this.transitionTo((this.activeImage + 1) % this.data.clouds.length, true);
  }

  scatter(): void {
    this.scatterTarget = 1;
    this.requestFrame();
  }

  gather(): void {
    this.scatterTarget = 0;
    this.requestFrame();
  }

  light(): void {
    this.lightStartSeconds = this.lightPulseActive ? -10 : this.clockSeconds;
    if (this.lightPulseActive) {
      this.lightPulseActive = false;
      this.options.onLightPulseChange?.(false);
      this.requestFrame();
      return;
    }
    if (
      !this.lightPulseActive &&
      !this.paused &&
      !this.motionPreference.matches
    ) {
      this.lightPulseActive = true;
      this.options.onLightPulseChange?.(true);
    }
    this.requestFrame();
  }

  /** A normalized audio envelope supplied by the host. The player never opens a microphone. */
  setAudioLevel(level: number): void {
    if (!Number.isFinite(level) || level < 0 || level > 1)
      throw new Error("Audio level must be between zero and one.");
    if (this.audioLevel === level) return;
    this.audioLevel = level;
    this.requestFrame();
  }

  /** Multiply zoom within 0.5–2×; respects the scene’s zoom permission. */
  zoomBy(factor: number): void {
    const zoom = advanceZoom(this.zoom, factor);
    if (!this.interactions.zoom) return;
    this.zoom = zoom;
    this.requestFrame();
  }

  resetCamera(): void {
    this.rotationTarget.set(0, 0);
    this.group.position.set(0, 0, 0);
    this.zoom = 1;
    this.requestFrame();
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    if (this.lightPulseActive) this.options.onLightPulseChange?.(false);
    cancelAnimationFrame(this.animationFrame);
    this.eventController.abort();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.trailMaterial.dispose();
    this.trailLines?.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }

  // ---------------------------------------------------------
  // Prepared geometry
  // ---------------------------------------------------------

  private setCloudAttributes(fromIndex: number, toIndex: number): void {
    const from = this.data.clouds[fromIndex];
    const to = this.data.clouds[toIndex];
    this.material.uniforms.sourceCenter.value = this.cloudCenters[fromIndex];
    this.material.uniforms.targetCenter.value = this.cloudCenters[toIndex];
    const count = from.positions.length / 3;
    this.pointCountLabel = `${count.toLocaleString()} PTS`;
    const seeds = (this.particleSeeds ??= createParticleSeeds(count));

    this.geometry.dispose();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(from.positions, 3),
    );
    this.geometry.setAttribute(
      "targetPosition",
      from === to
        ? this.geometry.getAttribute("position")
        : new THREE.BufferAttribute(to.positions, 3),
    );
    this.geometry.setAttribute(
      "pointColor",
      new THREE.BufferAttribute(from.colors, 4, true),
    );
    this.geometry.setAttribute(
      "targetColor",
      from === to
        ? this.geometry.getAttribute("pointColor")
        : new THREE.BufferAttribute(to.colors, 4, true),
    );
    this.geometry.setAttribute(
      "pointSeed",
      new THREE.BufferAttribute(seeds, 1),
    );
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    this.trailLines?.geometry.dispose();
    if (this.trailLines) this.group.remove(this.trailLines);
    this.trailLines = null;
    this.syncTrails();
  }

  private syncTrails(): void {
    if (!this.settings.trails) {
      if (this.trailLines) {
        this.group.remove(this.trailLines);
        this.trailLines.geometry.dispose();
        this.trailLines = null;
      }
      return;
    }
    if (this.trailLines) return;

    // Disabled trails keep no extra point buffers on either the CPU or graphics card.
    this.trailLines = new THREE.LineSegments(
      createTrailGeometry(this.geometry),
      this.trailMaterial,
    );
    this.trailLines.renderOrder = 2;
    this.group.add(this.trailLines);
  }

  // ---------------------------------------------------------
  // Input
  // ---------------------------------------------------------

  private handlePointerDown = (event: PointerEvent): void => {
    if (
      !this.interactions.rotate &&
      !this.interactions.pan &&
      !this.interactions.clickToScatter
    )
      return;
    this.dragging = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const rectangle = this.renderer.domElement.getBoundingClientRect();
    if (this.interactions.pointer) {
      this.pointerNormalized.set(
        ((event.clientX - rectangle.left) / rectangle.width) * 2 - 1,
        1 - ((event.clientY - rectangle.top) / rectangle.height) * 2,
      );
      if (this.pointerUpdatedMilliseconds > 0 && !this.dragging) {
        this.pointerVelocity
          .copy(this.pointerNormalized)
          .sub(this.pointer)
          .clampLength(0, 0.2);
        if (this.pointerVelocity.lengthSq() > 0.000001) {
          this.pointerWakes[this.pointerWakeIndex].set(
            this.pointerNormalized.x,
            this.pointerNormalized.y,
            this.pointerVelocity.x,
            this.pointerVelocity.y,
          );
          this.pointerWakeIndex =
            (this.pointerWakeIndex + 1) % this.pointerWakes.length;
        }
      }
      this.pointerUpdatedMilliseconds = event.timeStamp;
      this.pointer.copy(this.pointerNormalized);
    }

    if (this.dragging?.id === event.pointerId) {
      const deltaX = event.clientX - this.dragging.x;
      const deltaY = event.clientY - this.dragging.y;
      this.dragging.moved ||= Math.abs(deltaX) + Math.abs(deltaY) > 2;
      if (
        this.interactions.pan &&
        (event.shiftKey || !this.interactions.rotate)
      ) {
        this.group.position.x = THREE.MathUtils.clamp(
          this.group.position.x + (deltaX / rectangle.width) * 3,
          -2,
          2,
        );
        this.group.position.y = THREE.MathUtils.clamp(
          this.group.position.y - (deltaY / rectangle.height) * 3,
          -2,
          2,
        );
      } else if (this.interactions.rotate) {
        this.rotationTarget.x = advanceRotationAngle(
          this.rotationTarget.x,
          deltaY * 0.005,
          this.interactions.rotationLimitDegrees,
        );
        this.rotationTarget.y = advanceRotationAngle(
          this.rotationTarget.y,
          deltaX * 0.005,
          this.interactions.rotationLimitDegrees,
        );
      }
      this.dragging.x = event.clientX;
      this.dragging.y = event.clientY;
    }
    this.requestFrame();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.dragging?.id !== event.pointerId) return;
    if (!this.dragging.moved && this.interactions.clickToScatter) this.next();
    this.handlePointerCancel(event);
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    if (this.dragging?.id !== event.pointerId) return;
    this.dragging = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId))
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    if (this.interactions.returnOnRelease) this.rotationTarget.set(0, 0);
    this.requestFrame();
  };

  private handleWheel = (event: WheelEvent): void => {
    if (!this.interactions.zoom) return;
    event.preventDefault();
    this.zoomBy(
      Math.exp(THREE.MathUtils.clamp(-event.deltaY * 0.001, -20, 20)),
    );
  };

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.options.onError?.(
      new Error(
        "The graphics context was lost. Reload the scene to restore it.",
      ),
    );
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  };

  // ---------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------

  private resize = (): void => {
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    const overlayPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(this.width * overlayPixelRatio);
    this.overlay.height = Math.round(this.height * overlayPixelRatio);
    this.overlayContext.setTransform(
      overlayPixelRatio,
      0,
      0,
      overlayPixelRatio,
      0,
      0,
    );
    this.camera.aspect = this.width / this.height;
    this.camera.position.z = Math.max(3.4, 3.4 / this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.requestFrame();
  };

  private requestFrame = (): void => {
    if (this.disposed || this.animationFrame) return;
    this.animationFrame = requestAnimationFrame(this.draw);
  };

  private draw = (milliseconds: number): void => {
    this.animationFrame = 0;
    if (this.disposed || document.hidden || !this.visible) {
      this.lastFrameMilliseconds = 0;
      return;
    }

    const deadline = nextFrameDeadline(
      milliseconds,
      this.lastFrameMilliseconds ? this.frameDeadlineMilliseconds : 0,
      this.options.maxFps ?? 60,
    );
    if (deadline === null) {
      this.requestFrame();
      return;
    }
    this.frameDeadlineMilliseconds = deadline;

    const elapsedSeconds = this.lastFrameMilliseconds
      ? (milliseconds - this.lastFrameMilliseconds) / 1000
      : 0;
    this.lastFrameMilliseconds = milliseconds;
    const still = this.paused || this.motionPreference.matches;
    // Animation follows elapsed time even when a frame takes longer to draw.
    if (!still) {
      this.clockSeconds += elapsedSeconds;
      // Accumulate scaled time so changing speed never jumps the drift to another phase.
      this.driftClockSeconds += elapsedSeconds * this.settings.driftSpeed;
    }
    const pulseVisible =
      !still && this.clockSeconds - this.lightStartSeconds < 2;
    if (pulseVisible !== this.lightPulseActive) {
      this.lightPulseActive = pulseVisible;
      this.options.onLightPulseChange?.(pulseVisible);
    }
    // Limit camera easing after a slow frame while keeping animation clocks on elapsed time.
    const smoothingSeconds = Math.min(elapsedSeconds, 0.1);
    this.scatterAmount = still
      ? this.scatterTarget
      : THREE.MathUtils.damp(
          this.scatterAmount,
          this.scatterTarget,
          3,
          smoothingSeconds,
        );
    let progress = this.transitioning
      ? Math.min(
          1,
          (this.clockSeconds - this.transitionStartSeconds) /
            this.transitionDurationSeconds,
        )
      : 1;
    if (this.motionPreference.matches) progress = 1;
    if (this.transitioning && progress === 1) {
      this.transitioning = false;
      this.options.onTransitionEnd?.(this.activeImage);
    }
    const sway =
      this.settings.drift > 0 && !this.motionPreference.matches ? 1 : 0;
    const idlePitch = Math.sin(this.clockSeconds * 0.17 + 1) * 0.05 * sway;
    const idleYaw = Math.sin(this.clockSeconds * 0.23) * 0.16 * sway;
    this.group.rotation.x = THREE.MathUtils.damp(
      this.group.rotation.x,
      this.rotationTarget.x + idlePitch,
      9,
      smoothingSeconds || 1 / 60,
    );
    this.group.rotation.y = THREE.MathUtils.damp(
      this.group.rotation.y,
      this.rotationTarget.y + idleYaw,
      9,
      smoothingSeconds || 1 / 60,
    );
    this.pointerVelocity.set(0, 0);
    for (const wake of this.pointerWakes) {
      const decay = Math.exp(-4 * smoothingSeconds);
      wake.z *= decay;
      wake.w *= decay;
      this.pointerVelocity.x += Math.abs(wake.z);
      this.pointerVelocity.y += Math.abs(wake.w);
    }
    if (
      this.pointerUpdatedMilliseconds === 0 &&
      this.pointerVelocity.lengthSq() < 0.0001
    )
      this.pointer.set(100, 100);
    if (this.camera.zoom !== this.zoom) {
      this.camera.zoom = this.zoom;
      this.camera.updateProjectionMatrix();
    }
    this.group.updateMatrixWorld();

    const uniforms = this.material.uniforms;
    uniforms.elapsedSeconds.value = this.clockSeconds;
    uniforms.driftElapsedSeconds.value = this.driftClockSeconds;
    uniforms.transitionProgress.value = progress;
    uniforms.scatterAmount.value = this.scatterAmount;
    uniforms.depthStrength.value = this.settings.depth * 1.875;
    uniforms.driftSpread.value = this.settings.driftSpread;
    uniforms.driftStrength.value = this.motionPreference.matches
      ? 0
      : this.settings.drift;
    uniforms.splashStrength.value = this.settings.splash;
    uniforms.pointSize.value = this.settings.pointSize;
    // Projection zoom changes positions, but WebGL point sprites need their own scale.
    uniforms.grainScale.value =
      this.zoom * 1.2 * Math.max(0.75, Math.min(2, this.height / 720));
    uniforms.opacity.value = this.settings.opacity;
    uniforms.lightPaper.value = this.settings.paper === "light" ? 1 : 0;
    this.trailMaterial.blendSrc =
      this.settings.paper === "light" ? THREE.ZeroFactor : THREE.OneFactor;
    this.trailMaterial.blendDst =
      this.settings.paper === "light"
        ? THREE.SrcColorFactor
        : THREE.OneMinusSrcAlphaFactor;
    if (this.trailLines)
      this.trailLines.visible = this.settings.trails && this.settings.drift > 0;
    const scanPhase = (this.clockSeconds % 8) / 8;
    const scanActive = this.settings.scan && !still && scanPhase < 0.7;
    uniforms.scanPlane.value.set(
      (0.6 - (scanPhase / 0.7) * 1.2) * this.settings.depth * 1.875,
      scanActive ? Math.sin((Math.PI * scanPhase) / 0.7) : 0,
    );
    this.material.blendSrc =
      this.settings.paper === "light" ? THREE.ZeroFactor : THREE.OneFactor;
    this.material.blendDst =
      this.settings.paper === "light"
        ? THREE.SrcColorFactor
        : THREE.OneMinusSrcAlphaFactor;
    uniforms.pointerStrength.value =
      this.interactions.pointer &&
      this.pointerVelocity.lengthSq() > 0.00000001 &&
      !this.dragging &&
      !this.motionPreference.matches
        ? this.interactions.pointerStrength
        : 0;
    uniforms.pointerRadius.value = this.interactions.pointerRadius;
    uniforms.viewportAspect.value = this.width / this.height;
    uniforms.driftLine.value.set(
      Math.cos(this.settings.lineAngle),
      this.settings.lineOffset,
      Math.sin(this.settings.lineAngle),
    );
    uniforms.driftSide.value = this.settings.lineSide;
    uniforms.swarm.value = this.settings.travel === "swarm" ? 1 : 0;
    uniforms.audioLevel.value = still ? 0 : this.audioLevel;
    uniforms.lightPulse.value = still
      ? 0
      : Math.max(0, 1 - (this.clockSeconds - this.lightStartSeconds) / 2);
    uniforms.lightColor.value
      .set(this.settings.lightColor)
      .convertLinearToSRGB();
    uniforms.tone.value =
      this.settings.tone === "negative"
        ? 1
        : this.settings.tone === "mono"
          ? 2
          : 0;
    this.renderer.setClearColor(
      this.settings.paper === "light" ? "#f2f0e8" : this.settings.background,
      1,
    );
    this.renderer.render(this.scene, this.camera);
    if (
      this.lastOverlaySeconds < 0 ||
      this.clockSeconds - this.lastOverlaySeconds >= 1 / 15 ||
      still
    ) {
      this.drawOverlay(progress);
      this.lastOverlaySeconds = this.clockSeconds;
    }

    const cameraMoving =
      Math.abs(this.group.rotation.x - this.rotationTarget.x - idlePitch) +
        Math.abs(this.group.rotation.y - this.rotationTarget.y - idleYaw) >
      0.001;
    // Request another frame only while an effect or camera movement still needs one.
    const moving =
      this.settings.drift > 0 ||
      this.settings.scan ||
      this.transitioning ||
      Math.abs(this.scatterAmount - this.scatterTarget) > 0.001 ||
      this.clockSeconds - this.lightStartSeconds < 2 ||
      this.audioLevel > 0 ||
      this.pointerVelocity.lengthSq() > 0.0001;
    if ((!still && moving) || cameraMoving) this.requestFrame();
    else this.lastFrameMilliseconds = 0;
  };

  private drawOverlay(progress: number): void {
    const context = this.overlayContext;
    context.clearRect(0, 0, this.width, this.height);
    const foreground =
      this.settings.paper === "light" ? "20,25,30" : "190,205,210";
    context.strokeStyle = `rgba(${foreground},0.24)`;
    context.fillStyle = `rgba(${foreground},0.6)`;
    context.font = "11px ui-monospace, monospace";
    context.lineWidth = 0.6;

    if (this.settings.marks) {
      const corners = [
        [-1.25, 1.15],
        [1.25, 1.15],
        [1.25, -1.15],
        [-1.25, -1.15],
      ].map(([x, y]) => {
        const point = this.overlayTarget.set(x, y, 0);
        this.group.localToWorld(point);
        point.project(this.camera);
        return {
          x: ((point.x + 1) * this.width) / 2,
          y: ((1 - point.y) * this.height) / 2,
        };
      });
      for (let edge = 0; edge < 4; edge++) {
        const start = corners[edge];
        const end = corners[(edge + 1) % 4];
        const distance = Math.hypot(end.x - start.x, end.y - start.y) || 1;
        for (let index = 0; index <= 40; index++) {
          const x = start.x + ((end.x - start.x) * index) / 40;
          const y = start.y + ((end.y - start.y) * index) / 40;
          const length = index % 5 === 0 ? 10 : 4;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(
            x - ((end.y - start.y) / distance) * length,
            y + ((end.x - start.x) / distance) * length,
          );
          context.stroke();
        }
        context.beginPath();
        context.moveTo(start.x - 10, start.y);
        context.lineTo(start.x + 10, start.y);
        context.moveTo(start.x, start.y - 10);
        context.lineTo(start.x, start.y + 10);
        context.stroke();
      }
      context.fillText(
        `${this.activeImage + 1} / ${this.data.clouds.length}    ${this.data.clouds[this.activeImage].name.toUpperCase()}`,
        corners[0].x,
        corners[0].y - 16,
      );
      context.fillText(this.pointCountLabel, corners[3].x, corners[3].y + 24);
    }

    if (!this.settings.track && !this.settings.links) return;

    const source = this.data.clouds[this.previousImage];
    const target = this.data.clouds[this.activeImage];
    const count = this.settings.dense ? 28 : 10;
    const anchors = this.overlayAnchors;
    for (let index = 0; index < count; index++) {
      const pointIndex =
        Math.floor((((index + 0.5) / count) * target.positions.length) / 3) * 3;
      const point = this.overlayPoint
        .fromArray(source.positions, pointIndex)
        .sub(this.cloudCenters[this.previousImage])
        .lerp(
          this.overlayTarget
            .fromArray(target.positions, pointIndex)
            .sub(this.cloudCenters[this.activeImage]),
          progress,
        );
      point.z *= this.settings.depth * 1.875;
      const coordinates = `${point.x.toFixed(2)} ${point.y.toFixed(2)} ${point.z.toFixed(2)}`;
      this.group.localToWorld(point);
      point.project(this.camera);
      point.x = ((point.x + 1) * this.width) / 2;
      point.y = ((1 - point.y) * this.height) / 2;
      anchors[index].copy(point);
      if (this.settings.track) {
        context.strokeRect(point.x - 9, point.y - 9, 18, 18);
        context.fillText(
          `${String(index + 1).padStart(2, "0")} ${coordinates}`,
          point.x + 14,
          point.y - 5,
        );
      }
      if (this.settings.links && index > 0) {
        const previous = anchors[index - 1];
        if (point.distanceTo(previous) < this.width * 0.25) {
          context.beginPath();
          context.moveTo(previous.x, previous.y);
          context.lineTo(point.x, point.y);
          context.stroke();
        }
      }
    }
  }
}
