import type { Interactions } from "@armin-eslami/gatherform-core";

export type PlayerExample = "basic" | "controls" | "audio";

/** Copy a complete host component; media and playback controls belong to the app. */
export function createPlayerExample(
  kind: PlayerExample,
  maxFps: 30 | 60,
  interactions: Partial<Interactions>,
): string {
  const controlled = kind !== "basic";
  const audio = kind === "audio";
  const hooks = controlled
    ? `import { useEffect, useRef, useState } from "react";\n`
    : "";
  const declarations = controlled
    ? `  const playerRef = useRef<GatherformHandle>(null);
  const [ready, setReady] = useState(false);
  const [loop, setLoop] = useState(false);
${
  audio
    ? `  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState("");
`
    : ""
}
  useEffect(() => {
    if (!loop || !ready) return;
    let scattered = false;
    // Alternate every three seconds; stopping the loop restores the shape.
    const timer = window.setInterval(() => {
      scattered = !scattered;
      if (scattered) playerRef.current?.scatter();
      else playerRef.current?.gather();
    }, 3000);
    return () => {
      window.clearInterval(timer);
      playerRef.current?.gather();
    };
  }, [loop, ready]);
${audio ? audioEffect : ""}
`
    : "";
  const player = `    <Gatherform
${controlled ? "      ref={playerRef}\n      onReady={() => setReady(true)}\n" : ""}      src="/visualizations/logo.gatherform"
      style={{ height: 480 }}
      maxFps={${maxFps}}
      interactions={${JSON.stringify(interactions, null, 2).replaceAll("\n", "\n      ")}}
    />`;
  const buttons = controlled
    ? `
      <button disabled={!ready || loop} onClick={() => playerRef.current?.scatter()}>Scatter</button>
      <button disabled={!ready || loop} onClick={() => playerRef.current?.gather()}>Gather</button>
      <label>
        <input type="checkbox" checked={loop} disabled={!ready} onChange={(event) => setLoop(event.target.checked)} />
        Loop scatter and gather
      </label>${
        audio
          ? `
      {/* Place your track in public/audio/track.mp3. Playback starts when the visitor presses Play. */}
      <audio ref={audioRef} src="/audio/track.mp3" controls preload="none" aria-label="Music" />
      {error && <p role="alert">{error}</p>}`
          : ""
      }`
    : "";
  return `"use client";\n\n${hooks}import { Gatherform${controlled ? ", type GatherformHandle" : ""} } from "@armin-eslami/gatherform-react";\n\nexport function Logo() {\n${declarations}  return (\n${
    controlled
      ? "    <>\n" +
        player
          .split("\n")
          .map((line) => "  " + line)
          .join("\n") +
        buttons +
        "\n    </>"
      : player
  }\n  );\n}\n`;
}

const audioEffect = `
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let frame = 0;
    let disposed = false;
    const samples = new Uint8Array(128);

    const stop = () => {
      cancelAnimationFrame(frame);
      playerRef.current?.setAudioLevel(0);
    };
    const measure = () => {
      if (disposed || audio.paused || !analyser) return;
      // Average bass energy; the scene file contains no audio track or recorded animation.
      analyser.getByteFrequencyData(samples);
      let total = 0;
      for (let index = 0; index < 32; index++) total += samples[index];
      // Update the player directly, without a React render for every audio sample.
      playerRef.current?.setAudioLevel(total / (32 * 255));
      frame = requestAnimationFrame(measure);
    };
    const play = async () => {
      try {
        if (!context) {
          context = new AudioContext();
          analyser = context.createAnalyser();
          analyser.fftSize = 256;
          context.createMediaElementSource(audio).connect(analyser);
          analyser.connect(context.destination);
        }
        await context.resume();
        if (disposed || audio.paused) return;
        setError("");
        cancelAnimationFrame(frame);
        measure();
      } catch (cause) {
        if (disposed) return;
        stop();
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    const start = () => { void play(); };
    audio.addEventListener("play", start);
    audio.addEventListener("pause", stop);
    audio.addEventListener("ended", stop);
    return () => {
      disposed = true;
      audio.removeEventListener("play", start);
      audio.removeEventListener("pause", stop);
      audio.removeEventListener("ended", stop);
      stop();
      void context?.close();
    };
  }, []);
`;
