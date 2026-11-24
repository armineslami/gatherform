"use client";

import {
  createElement,
  forwardRef,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  GatherformPlayer,
  loadScene,
  type GatherformScene,
  type Interactions,
  type Settings,
} from "@armin-eslami/gatherform-core";

// Let hosts start a scene download early without importing the core package.
export { preloadScene } from "@armin-eslami/gatherform-core";

export interface GatherformHandle {
  scatter(): void;
  gather(): void;
  next(): void;
  light(): void;
  transitionTo(imageIndex: number): void;
  resetCamera(): void;
  /** Scatter at once, then gather after the scene's gatherDelay. */
  replayIntro(): void;
  zoomBy(factor: number): void;
  setAudioLevel(level: number): void;
}

interface SharedProps {
  settings?: Partial<Settings>;
  interactions?: Partial<Interactions>;
  paused?: boolean;
  maxFps?: 30 | 60;
  maxPixelRatio?: number;
  /** Normalized host audio envelope, from zero to one. */
  audioLevel?: number;
  className?: string;
  style?: CSSProperties;
  label?: string;
  /**
   * Shown while the scene downloads and decodes, for example a static logo image.
   * Accepts an element (`<Loader />`) or a component without required props (`Loader`).
   */
  placeholder?: ReactNode | ComponentType;
  fallback?: ReactNode;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onTransitionEnd?: (imageIndex: number) => void;
  onLightPulseChange?: (active: boolean) => void;
}

export type GatherformProps = SharedProps &
  ({ scene: GatherformScene; src?: never } | { src: string; scene?: never });

/** Loads a prepared scene. Image preparation and AI dependencies stay in Studio. */
export const Gatherform = forwardRef<GatherformHandle, GatherformProps>(
  function Gatherform(props, ref) {
    // ---------------------------------------------------------
    // State and refs
    // ---------------------------------------------------------

    const hostRef = useRef<HTMLDivElement>(null);

    const playerRef = useRef<GatherformPlayer | null>(null);

    const callbacksRef = useRef(props);

    const [error, setError] = useState<Error | null>(null);

    const [ready, setReady] = useState(false);

    // ---------------------------------------------------------
    // Public controls
    // ---------------------------------------------------------

    useImperativeHandle(
      ref,
      () => ({
        scatter: () => playerRef.current?.scatter(),
        gather: () => playerRef.current?.gather(),
        next: () => playerRef.current?.next(),
        light: () => playerRef.current?.light(),
        transitionTo: (imageIndex) =>
          playerRef.current?.transitionTo(imageIndex),
        resetCamera: () => playerRef.current?.resetCamera(),
        replayIntro: () => playerRef.current?.replayIntro(),
        zoomBy: (factor) => playerRef.current?.zoomBy(factor),
        setAudioLevel: (level) => playerRef.current?.setAudioLevel(level),
      }),
      [],
    );

    // ---------------------------------------------------------
    // Effects
    // ---------------------------------------------------------

    useEffect(() => {
      callbacksRef.current = props;
    });

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const controller = new AbortController();
      let player: GatherformPlayer | null = null;
      setError(null);
      setReady(false);

      const showError = (cause: unknown) => {
        if (controller.signal.aborted) return;

        const nextError =
          cause instanceof Error ? cause : new Error(String(cause));
        setError(nextError);
        callbacksRef.current.onError?.(nextError);
      };

      async function preparePlayer() {
        try {
          const scene =
            props.scene ?? (await loadScene(props.src!, controller.signal));
          if (controller.signal.aborted || !host) return;

          // Loading may finish after props change; apply the newest controls and callbacks.
          const current = callbacksRef.current;
          player = new GatherformPlayer(host, scene, {
            settings: { ...scene.settings, ...current.settings },
            interactions: { ...scene.interactions, ...current.interactions },
            paused: current.paused,
            maxFps: current.maxFps,
            maxPixelRatio: current.maxPixelRatio,
            onTransitionEnd: (index) =>
              callbacksRef.current.onTransitionEnd?.(index),
            onLightPulseChange: (active) =>
              callbacksRef.current.onLightPulseChange?.(active),
            onError: showError,
          });
          player.setAudioLevel(current.audioLevel ?? 0);
          playerRef.current = player;
          setReady(true);
          current.onReady?.();
        } catch (cause) {
          showError(cause);
        }
      }

      void preparePlayer();

      // An old request must never replace the canvas for a newer source.
      return () => {
        controller.abort();
        player?.dispose();
        if (playerRef.current === player) playerRef.current = null;
      };
      // Geometry changes replace the player. Appearance changes update its uniforms.
    }, [props.src, props.scene?.clouds]);

    useEffect(() => {
      try {
        playerRef.current?.update({
          settings: { ...props.scene?.settings, ...props.settings },
          interactions: { ...props.scene?.interactions, ...props.interactions },
          onLightPulseChange: (active) =>
            callbacksRef.current.onLightPulseChange?.(active),
          paused: props.paused,
          maxFps: props.maxFps,
          maxPixelRatio: props.maxPixelRatio,
          onTransitionEnd: (index) =>
            callbacksRef.current.onTransitionEnd?.(index),
          onError: (nextError) => {
            setError(nextError);
            callbacksRef.current.onError?.(nextError);
          },
        });
        playerRef.current?.setAudioLevel(props.audioLevel ?? 0);
      } catch (cause) {
        const nextError =
          cause instanceof Error ? cause : new Error(String(cause));
        setError(nextError);
        callbacksRef.current.onError?.(nextError);
      }
    }, [
      props.scene?.settings,
      props.scene?.interactions,
      props.settings,
      props.interactions,
      props.paused,
      props.maxFps,
      props.maxPixelRatio,
      props.audioLevel,
    ]);

    useEffect(() => {
      if (props.scene) playerRef.current?.transitionTo(props.scene.activeImage);
    }, [props.scene?.activeImage]);

    // ---------------------------------------------------------
    // Render
    // ---------------------------------------------------------

    return (
      <div
        className={props.className}
        style={{
          width: "100%",
          height: "100%",
          minHeight: 200,
          ...props.style,
          position: "relative",
        }}
        role="group"
        aria-label={props.label ?? "Interactive point cloud"}
      >
        <div
          ref={hostRef}
          style={{ position: "absolute", inset: 0, overflow: "hidden" }}
        />
        {!ready && !error && renderPlaceholder(props.placeholder)}
        {error && <div role="alert">{props.fallback ?? error.message}</div>}
      </div>
    );
  },
);

/** Render a placeholder given as an element or as a component type. */
function renderPlaceholder(
  placeholder: ReactNode | ComponentType | undefined,
): ReactNode {
  // Plain function and class components are functions; memo and forwardRef
  // components are objects tagged by React, unlike elements, arrays and text.
  const isComponent =
    typeof placeholder === "function" ||
    (typeof placeholder === "object" &&
      placeholder !== null &&
      !Array.isArray(placeholder) &&
      !isValidElement(placeholder) &&
      "$$typeof" in placeholder);
  return isComponent
    ? createElement(placeholder as ComponentType)
    : (placeholder as ReactNode);
}
