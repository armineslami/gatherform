# @armin-eslami/gatherform-react

The React player for exported Gatherform scenes. Requires React 18.3 or 19 from the host app. Core and Three.js install automatically.
Image preparation and editor dependencies are excluded from the player.

After registry publication: `pnpm add @armin-eslami/gatherform-react`.
See the [installation guide](https://github.com/armineslami/gatherform#how-to-install)
and [props, defaults and accepted values](https://github.com/armineslami/gatherform#props).

```tsx
"use client";

import { Gatherform } from "@armin-eslami/gatherform-react";

export function Logo() {
  return (
    <Gatherform
      src="/logo.gatherform"
      style={{ height: 480 }}
      maxFps={30}
      maxPixelRatio={1.5}
      interactions={{ pointer: true, rotate: false, zoom: false, pan: false }}
    />
  );
}
```

Use src or a prepared scene prop. Exported defaults are combined with partial
settings and interaction overrides. Settings preserve the canvas and camera.
The ESM entry preserves use client for Next.js. Public TypeScript declarations
include GatherformProps and GatherformHandle.

A ref exposes scatter, gather, next, light, transitionTo, resetCamera, and
setAudioLevel. Use setAudioLevel for frequent updates without React renders.
onReady, onError, and onTransitionEnd expose lifecycle feedback. The fallback prop
is shown for errors. Provide a descriptive label and a nonzero container height.

The component respects reduced motion, suspends hidden views, aborts superseded
loads, and disposes its GPU resources on removal. WebGL2 is required.
Released under the MIT license. Third-party dependencies retain their own licenses.

The player ref exposes `zoomBy(factor)` for host zoom buttons. Use factors such
as 1.2 and 1 / 1.2; values must be finite and positive. Zoom stays within 0.5–2×
and respects `interactions.zoom`. `maxFps={30}` lowers drawing frequency while
keeping effects, with a visible smoothness tradeoff.

## Scatter, gather and looping

Pass `ref={playerRef}` to Gatherform, with
`const playerRef = useRef<GatherformHandle>(null)`. Once `onReady` fires, call
`playerRef.current?.scatter()` or `.gather()` from your own buttons, page events
or animation schedule. `next()` scatters and gathers while advancing to the next
picture; for one picture it returns to the same picture. These methods are
independent of whether pointer click-to-scatter is enabled.

Studio’s **Scatter, gather and loop** export example includes working buttons and
a checkbox that alternates Scatter/Gather every three seconds. It waits for
`onReady`, clears its timer on stop/unmount and restores the gathered shape.
There is no built-in `loop` prop; the app controls timing. Ordinary drift continues
without this loop unless disabled or paused.

## Audio response

Audio makes particles move in response to a track’s intensity. Studio’s audio
selection previews this; the exported scene does not include the audio file,
audio playback or recorded movement. Host the track separately so apps without
audio do not download it.

Choose **Audio response and controls** in Studio’s export dialog for a complete
React example. Put your track at `public/audio/track.mp3` or change the audio
element’s source. The visitor presses Play; the example reads low-frequency
energy through the browser’s AudioContext and calls
`playerRef.current?.setAudioLevel(level)` with a value from 0 to 1. It resets the
level on pause/end and cleans up its animation frame and audio context on unmount.
Updates go directly to the player without React renders for each sample.

For an existing audio system, supply the same normalized level through the ref
or `audioLevel` prop. Use one update method consistently; prop updates can replace
a level supplied through the ref. Same-origin tracks need no extra setup; external
tracks need the audio element’s crossOrigin attribute and server CORS permission.
No microphone access or automatic sound playback is requested.
