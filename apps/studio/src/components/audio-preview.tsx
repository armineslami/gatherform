import { useEffect, useRef, useState } from "react";
import type { en } from "@/i18n/locales";

export function AudioPreview({
  t,
  onLevel,
  onError,
}: {
  t: typeof en;
  onLevel: (level: number) => void;
  onError: (error: Error) => void;
}) {
  // ---------------------------------------------------------
  // State and refs
  // ---------------------------------------------------------

  const [source, setSource] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);

  const contextRef = useRef<AudioContext | null>(null);

  const analyserRef = useRef<AnalyserNode | null>(null);

  const samplesRef = useRef(new Uint8Array(128));

  const frameRef = useRef(0);

  const callbacksRef = useRef({ onLevel, onError });

  // ---------------------------------------------------------
  // Effects
  // ---------------------------------------------------------

  useEffect(() => {
    callbacksRef.current = { onLevel, onError };
  });

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      void contextRef.current?.close();
    },
    [],
  );

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );

  // ---------------------------------------------------------
  // Actions
  // ---------------------------------------------------------

  const stopAnalysis = () => {
    cancelAnimationFrame(frameRef.current);
    callbacksRef.current.onLevel(0);
  };

  const connectAudio = async () => {
    try {
      if (!audioRef.current) return;
      if (!contextRef.current) {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaElementSource(audioRef.current).connect(analyser);
        analyser.connect(context.destination);
        contextRef.current = context;
        analyserRef.current = analyser;
      }
      await contextRef.current.resume();
      cancelAnimationFrame(frameRef.current);

      const draw = () => {
        const analyser = analyserRef.current;
        if (!analyser || !audioRef.current || audioRef.current.paused) {
          stopAnalysis();
          return;
        }
        const samples = samplesRef.current;
        // Average the bass bins into the same 0–1 signal accepted by the player API.
        analyser.getByteFrequencyData(samples);
        let total = 0;
        for (let index = 0; index < 32; index++) total += samples[index];
        callbacksRef.current.onLevel(total / (32 * 255));
        frameRef.current = requestAnimationFrame(draw);
      };
      frameRef.current = requestAnimationFrame(draw);
    } catch (error) {
      callbacksRef.current.onError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };

  return (
    <div className="audio-preview">
      <label className="file-button">
        {t.addAudio}
        <input
          type="file"
          accept="audio/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && file.size <= 50 * 1024 * 1024)
              setSource(URL.createObjectURL(file));
            else if (file)
              onError(new Error("Choose audio smaller than 50 MB."));
            event.target.value = "";
          }}
        />
      </label>
      <audio
        ref={audioRef}
        src={source ?? undefined}
        controls={Boolean(source)}
        onPlay={() => void connectAudio()}
        onPause={stopAnalysis}
        onEnded={stopAnalysis}
        aria-label={t.audio}
      />
      <p className="help">{t.audioHint}</p>
    </div>
  );
}
