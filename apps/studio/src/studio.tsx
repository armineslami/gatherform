import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  encodeCompactScene,
  encodeScene,
  type GatherformScene,
} from "@armin-eslami/gatherform-core";
import type { GatherformHandle } from "@armin-eslami/gatherform-react";
import {
  createPlayerExample,
  type PlayerExample,
} from "@/editor/player-example";
import { useSceneEditor } from "@/editor/use-scene-editor";
import { en, fa } from "@/i18n/locales";
import { ControlSection, RangeControl } from "@/components/controls";
import { SceneControls } from "@/components/scene-controls";
import { AudioPreview } from "@/components/audio-preview";

const GatherformPreview = lazy(() =>
  import("@armin-eslami/gatherform-react").then((module) => ({
    default: module.Gatherform,
  })),
);

async function downloadScene(scene: GatherformScene, compact: boolean) {
  const buffer = compact ? await encodeCompactScene(scene) : encodeScene(scene);
  const url = URL.createObjectURL(
    new Blob([buffer], { type: "application/octet-stream" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${scene.name.replace(/[^\p{L}\p{N}_-]/gu, "-").slice(0, 80) || "scene"}.gatherform`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Studio() {
  // ---------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------

  const editor = useSceneEditor();

  const { scene, setScene, busy } = editor;

  // ---------------------------------------------------------
  // State and refs
  // ---------------------------------------------------------

  const [locale, setLocale] = useState<"en" | "fa">("en");

  const [error, setError] = useState<string | null>(null);

  const [paused, setPaused] = useState(false);

  const [maxFps, setMaxFps] = useState<30 | 60>(60);

  const [lightPulseActive, setLightPulseActive] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);

  const [playerExample, setPlayerExample] = useState<PlayerExample>("basic");

  const playerRef = useRef<GatherformHandle>(null);

  const stageRef = useRef<HTMLDivElement>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);

  const t = locale === "fa" ? fa : en;

  const code = createPlayerExample(
    playerExample,
    maxFps,
    scene?.interactions ?? {},
  );

  // ---------------------------------------------------------
  // Actions
  // ---------------------------------------------------------

  const updateAudioLevel = useCallback(
    (level: number) => playerRef.current?.setAudioLevel(level),
    [],
  );

  const showError = (cause: unknown) => {
    if (cause instanceof DOMException && cause.name === "AbortError") return;
    setError(cause instanceof Error ? cause.message : String(cause));
  };

  const addImages = async (files: File[]) => {
    setError(null);
    try {
      await editor.addImages(files);
    } catch (cause) {
      showError(cause);
    }
  };

  const [compactExport, setCompactExport] = useState(true);

  const save = async () => {
    if (!scene) return;
    try {
      await downloadScene(scene, compactExport);
    } catch (cause) {
      showError(cause);
    }
  };

  const changeImage = (imageIndex: number) => {
    if (!scene) return;
    playerRef.current?.transitionTo(imageIndex);
    setScene({ ...scene, activeImage: imageIndex });
  };

  // ---------------------------------------------------------
  // Effects
  // ---------------------------------------------------------

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
  }, [locale]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (exportOpen) dialog?.showModal();
    else dialog?.close();
  }, [exportOpen]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches("input,select,textarea,button,a") ||
          target.isContentEditable)
      )
        return;
      if (exportOpen || busy) return;
      if (event.code === "Space") {
        event.preventDefault();
        playerRef.current?.next();
      }
      if (event.key.toLowerCase() === "s") playerRef.current?.light();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [exportOpen, busy]);

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------

  return (
    <div className="studio-shell">
      <header className="app-header">
        <a className="brand" href="#">
          <span className="brand-mark" aria-hidden="true">
            g
          </span>
          <span>
            gatherform <small>{t.studio}</small>
          </span>
        </a>
        <div className="header-actions">
          <select
            className="language-select"
            aria-label="Language / زبان"
            value={locale}
            onChange={(event) =>
              setLocale(event.target.value === "fa" ? "fa" : "en")
            }
          >
            <option value="en">EN</option>
            <option value="fa">فا</option>
          </select>
          <label className={`file-button ${busy ? "disabled" : ""}`}>
            {t.openScene}
            <input
              disabled={Boolean(busy)}
              type="file"
              accept=".gatherform"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file || (scene && !window.confirm(t.confirmNew))) return;
                setError(null);
                try {
                  await editor.openScene(file);
                } catch (cause) {
                  showError(cause);
                }
              }}
            />
          </label>
          <button
            disabled={Boolean(busy)}
            onClick={() => {
              if (!scene || window.confirm(t.confirmNew)) editor.newScene();
            }}
          >
            {t.newScene}
          </button>
          <button
            className="primary"
            onClick={() => setExportOpen(true)}
            disabled={!scene || Boolean(busy)}
          >
            {t.exportScene} <span aria-hidden="true">↗︎</span>
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="preview-column" aria-label={t.preview}>
          <div className="stage-caption">
            <span>
              <i className="status-dot" /> {t.preview}
            </span>
            <span>01 — {t.study}</span>
          </div>
          <div
            className={`stage ${scene?.settings.paper === "light" ? "paper-light" : ""}`}
            ref={stageRef}
            style={{
              background:
                scene?.settings.paper === "light"
                  ? "#f2f0e8"
                  : scene?.settings.background,
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void addImages(Array.from(event.dataTransfer.files));
            }}
          >
            {scene ? (
              <Suspense
                fallback={
                  <div className="preparation-indicator" role="status">
                    {t.busy}
                  </div>
                }
              >
                <GatherformPreview
                  ref={playerRef}
                  scene={scene}
                  paused={paused}
                  maxFps={maxFps}
                  onLightPulseChange={setLightPulseActive}
                  onError={showError}
                  onTransitionEnd={(imageIndex) =>
                    setScene((previous) =>
                      previous?.clouds === scene.clouds
                        ? { ...previous, activeImage: imageIndex }
                        : previous,
                    )
                  }
                  label={scene.name}
                />
              </Suspense>
            ) : (
              <div className="empty-state">
                <div className="empty-orbit" aria-hidden="true">
                  g
                </div>
                <h1>{t.empty}</h1>
                <p>{t.sourceHint}</p>
                <button
                  className="primary"
                  disabled={Boolean(busy)}
                  onClick={() => imageInputRef.current?.click()}
                >
                  {t.addImages}
                </button>
                <button
                  className="quiet"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setError(null);
                    void editor.loadDemo().catch(showError);
                  }}
                >
                  {t.demo}
                </button>
              </div>
            )}
            <button
              className="fullscreen-button"
              title={t.fullscreen}
              aria-label={t.fullscreen}
              onClick={() =>
                void stageRef.current?.requestFullscreen().catch(showError)
              }
            >
              ⛶
            </button>
            {busy && (
              <div className="preparation-indicator" role="status">
                <span className="spinner" />
                {busy === "depth" ? t.aiBusy : t.busy}
                <button onClick={editor.cancel}>{t.cancel}</button>
              </div>
            )}
          </div>
          <div className="transport" aria-label={t.controls}>
            <button
              className="transport-main"
              disabled={!scene}
              onClick={() => playerRef.current?.next()}
            >
              <span aria-hidden="true">▷</span> {t.next}
              <kbd>SPACE</kbd>
            </button>
            <button
              disabled={!scene}
              onClick={() => playerRef.current?.scatter()}
            >
              {t.scatter}
            </button>
            <button
              disabled={!scene}
              onClick={() => playerRef.current?.gather()}
            >
              {t.restore}
            </button>
            <button
              disabled={!scene}
              aria-pressed={lightPulseActive}
              onClick={() => playerRef.current?.light()}
            >
              {t.pulse}
              <kbd>S</kbd>
            </button>

            {(["track", "links", "trails", "scan", "marks"] as const).map(
              (key) => (
                <button
                  key={key}
                  disabled={!scene}
                  aria-pressed={scene?.settings[key] ?? false}
                  onClick={() =>
                    scene &&
                    setScene({
                      ...scene,
                      settings: {
                        ...scene.settings,
                        [key]: !scene.settings[key],
                      },
                    })
                  }
                >
                  {t[key]}
                </button>
              ),
            )}
            <div
              className="zoom-controls"
              role="group"
              aria-label={t.zoomControls}
            >
              <button
                aria-label={t.zoomOut}
                title={t.zoomOut}
                disabled={!scene?.interactions.zoom}
                onClick={() => playerRef.current?.zoomBy(1 / 1.2)}
              >
                −
              </button>
              <button
                aria-label={t.zoomIn}
                title={t.zoomIn}
                disabled={!scene?.interactions.zoom}
                onClick={() => playerRef.current?.zoomBy(1.2)}
              >
                +
              </button>
            </div>
            <span className="transport-spacer" />
            <button disabled={!scene} onClick={() => setPaused(!paused)}>
              {paused ? t.resume : t.pause}
            </button>
            <button
              disabled={!scene}
              onClick={() => playerRef.current?.resetCamera()}
            >
              {t.resetCamera}
            </button>
          </div>
          <section className="image-section">
            <div className="section-heading">
              <h2>{t.source}</h2>
              <span>{scene?.clouds.length ?? 0} / 4</span>
            </div>
            <div className="image-rail">
              {scene?.clouds.map((cloud, index) => (
                <div
                  className={`image-card ${index === scene.activeImage ? "selected" : ""}`}
                  key={`${index}-${cloud.name}`}
                >
                  <button
                    disabled={Boolean(busy)}
                    className="image-select"
                    aria-pressed={index === scene.activeImage}
                    onClick={() => changeImage(index)}
                  >
                    <span className="image-number">0{index + 1}</span>
                    <strong>{cloud.name}</strong>
                    <small>
                      {cloud.depthSource === "ai"
                        ? t.aiDepth
                        : t[cloud.depthSource]}
                    </small>
                  </button>
                  <button
                    className="remove-image"
                    title={t.remove}
                    aria-label={`${t.remove} ${index + 1}`}
                    disabled={Boolean(busy)}
                    onClick={() => editor.removeImage(index)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="add-image"
                disabled={Boolean(busy) || scene?.clouds.length === 4}
                onClick={() => imageInputRef.current?.click()}
              >
                <span aria-hidden="true">+</span>
                {t.addImages}
              </button>
            </div>
            <input
              ref={imageInputRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              multiple
              aria-label={t.addImages}
              onChange={(event) => {
                void addImages(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <p className="help">{t.previewHint}</p>
          </section>
          {error && (
            <div className="error-message" role="alert">
              <strong>{t.error}</strong>
              <p>{error}</p>
              <button onClick={() => setError(null)}>{t.close}</button>
            </div>
          )}
        </section>

        <aside className="inspector" aria-label={t.controls}>
          <div className="inspector-heading">
            <span className="eyebrow">GATHERFORM</span>
            <h1>{t.subtitle}</h1>
          </div>
          <fieldset disabled={Boolean(busy)}>
            <ControlSection label={t.preparation}>
              <label className="select-control">
                {t.pointCount}
                <select
                  disabled={Boolean(scene)}
                  value={
                    scene
                      ? scene.clouds[0].positions.length / 3
                      : editor.pointCount
                  }
                  onChange={(event) =>
                    editor.setPointCount(Number(event.target.value))
                  }
                >
                  {[16384, 65536, 131072, 262144, 524288].map((count) => (
                    <option key={count} value={count}>
                      {count.toLocaleString(locale)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="help">{t.qualityHint}</p>
              <RangeControl
                locale={locale}
                label={t.threshold}
                value={editor.threshold}
                onChange={editor.setThreshold}
              />
              <p className="help">{t.thresholdHint}</p>
              <button
                className="wide"
                disabled={!scene}
                onClick={() => {
                  setError(null);
                  void editor.updateDepth().catch(showError);
                }}
              >
                {t.ai} <span aria-hidden="true">✧</span>
              </button>
              <p className="help">{t.aiHint}</p>
              <label className={`file-button wide ${!scene ? "disabled" : ""}`}>
                {t.depthMap}
                <input
                  type="file"
                  accept="image/*"
                  disabled={!scene}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) {
                      setError(null);
                      void editor.updateDepth(file).catch(showError);
                    }
                  }}
                />
              </label>
              <p className="help">{t.depthMapHint}</p>
            </ControlSection>
            {scene && (
              <>
                <ControlSection label={t.playback}>
                  <label className="select-control">
                    <span>{t.frameRate}</span>
                    <select
                      value={maxFps}
                      onChange={(event) =>
                        setMaxFps(event.target.value === "30" ? 30 : 60)
                      }
                    >
                      <option value={60}>{t.smoothFps}</option>
                      <option value={30}>{t.efficientFps}</option>
                    </select>
                  </label>
                  <p className="help">{t.frameRateHint}</p>
                </ControlSection>
                <SceneControls
                  locale={locale}
                  settings={scene.settings}
                  interactions={scene.interactions}
                  t={t}
                  onSettings={(patch) =>
                    setScene({
                      ...scene,
                      settings: { ...scene.settings, ...patch },
                    })
                  }
                  onInteractions={(patch) =>
                    setScene({
                      ...scene,
                      interactions: { ...scene.interactions, ...patch },
                    })
                  }
                />
                <ControlSection label={t.audio} open={false}>
                  <AudioPreview
                    t={t}
                    onLevel={updateAudioLevel}
                    onError={showError}
                  />
                </ControlSection>
              </>
            )}
          </fieldset>
        </aside>
      </main>

      <dialog
        ref={dialogRef}
        className="export-dialog"
        onCancel={() => setExportOpen(false)}
        onClose={() => setExportOpen(false)}
      >
        <div className="dialog-heading">
          <h2>{t.publish}</h2>
          <button aria-label={t.close} onClick={() => setExportOpen(false)}>
            ×
          </button>
        </div>
        <p>{t.exportHint}</p>
        <p className="help">{t.packageStatus}</p>
        <label className="name-control">
          {t.name}
          <input
            maxLength={200}
            value={scene?.name ?? ""}
            onChange={(event) =>
              scene && setScene({ ...scene, name: event.target.value })
            }
          />
        </label>
        <pre>
          <code>pnpm add @armin-eslami/gatherform-react</code>
        </pre>
        <label className="select-control">
          {t.exampleType}
          <select
            value={playerExample}
            onChange={(event) =>
              setPlayerExample(
                event.target.value === "audio"
                  ? "audio"
                  : event.target.value === "controls"
                    ? "controls"
                    : "basic",
              )
            }
          >
            <option value="basic">{t.exampleBasic}</option>
            <option value="controls">{t.exampleControls}</option>
            <option value="audio">{t.exampleAudio}</option>
          </select>
        </label>
        <p className="help">{t.playerControlsHint}</p>
        <p className="help">{t.audioExportHint}</p>
        <pre className="code-preview">
          <code>{code}</code>
        </pre>
        <label>
          <input
            type="checkbox"
            checked={compactExport}
            onChange={(event) => setCompactExport(event.target.checked)}
          />{" "}
          {t.compactExport}
        </label>
        <p className="help">{t.compactHint}</p>
        <div className="dialog-actions">
          <button
            onClick={() =>
              void navigator.clipboard.writeText(code).catch(showError)
            }
          >
            {t.copy}
          </button>
          <button className="primary" onClick={save}>
            {t.exportScene} ↗
          </button>
        </div>
      </dialog>
    </div>
  );
}
