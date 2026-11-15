import type { Interactions, Settings } from "@armin-eslami/gatherform-core";
import {
  ControlSection,
  RangeControl,
  ToggleControl,
} from "@/components/controls";
import type { en } from "@/i18n/locales";

export function SceneControls({
  locale,
  settings,
  interactions,
  onSettings,
  onInteractions,
  t,
}: {
  locale: "en" | "fa";
  settings: Settings;
  interactions: Interactions;
  onSettings: (patch: Partial<Settings>) => void;
  onInteractions: (patch: Partial<Interactions>) => void;
  t: typeof en;
}) {
  return (
    <>
      <ControlSection label={t.appearance}>
        <RangeControl
          locale={locale}
          label={t.depth}
          value={settings.depth}
          max={2}
          onChange={(depth) => onSettings({ depth })}
        />
        <RangeControl
          locale={locale}
          label={t.pointSize}
          value={settings.pointSize}
          min={0.25}
          max={6}
          step={0.05}
          onChange={(pointSize) => onSettings({ pointSize })}
        />
        <RangeControl
          locale={locale}
          label={t.opacity}
          value={settings.opacity}
          onChange={(opacity) => onSettings({ opacity })}
        />
        <label className="select-control">
          {t.paper}
          <select
            value={settings.paper}
            onChange={(event) =>
              onSettings({
                paper: event.target.value === "light" ? "light" : "dark",
              })
            }
          >
            <option value="dark">{t.dark}</option>
            <option value="light">{t.light}</option>
          </select>
        </label>
        <label className="select-control">
          {t.tone}
          <select
            value={settings.tone}
            onChange={(event) =>
              onSettings({
                tone:
                  event.target.value === "negative"
                    ? "negative"
                    : event.target.value === "mono"
                      ? "mono"
                      : "original",
              })
            }
          >
            <option value="original">{t.original}</option>
            <option value="negative">{t.negative}</option>
            <option value="mono">{t.mono}</option>
          </select>
        </label>
        <label className="select-control">
          {t.lightColor}
          <input
            type="color"
            value={settings.lightColor}
            onChange={(event) => onSettings({ lightColor: event.target.value })}
          />
        </label>
        <label className="select-control">
          {t.background}
          <input
            type="color"
            value={settings.background}
            onChange={(event) => onSettings({ background: event.target.value })}
          />
        </label>
      </ControlSection>
      <ControlSection label={t.motion}>
        <RangeControl
          locale={locale}
          label={t.drift}
          value={settings.drift}
          onChange={(drift) => onSettings({ drift })}
        />
        <RangeControl
          locale={locale}
          label={t.driftSpeed}
          value={settings.driftSpeed}
          max={3}
          step={0.05}
          onChange={(driftSpeed) => onSettings({ driftSpeed })}
        />
        <p className="help">{t.driftSpeedHint}</p>
        <RangeControl
          locale={locale}
          label={t.driftSpread}
          value={settings.driftSpread}
          onChange={(driftSpread) => onSettings({ driftSpread })}
        />
        <RangeControl
          locale={locale}
          label={t.splash}
          value={settings.splash}
          onChange={(splash) => onSettings({ splash })}
        />
        <RangeControl
          locale={locale}
          label={t.gather}
          value={settings.gather}
          onChange={(gather) => onSettings({ gather })}
        />
        <RangeControl
          locale={locale}
          label={t.lineAngle}
          value={settings.lineAngle}
          min={-Math.PI}
          max={Math.PI}
          onChange={(lineAngle) => onSettings({ lineAngle })}
        />
        <RangeControl
          locale={locale}
          label={t.lineOffset}
          value={settings.lineOffset}
          min={-1.5}
          max={1.5}
          onChange={(lineOffset) => onSettings({ lineOffset })}
        />
        <button
          className="quiet"
          onClick={() => onSettings({ lineSide: -settings.lineSide })}
        >
          {t.lineSide}
        </button>
        <label className="select-control">
          {t.travel}
          <select
            value={settings.travel}
            onChange={(event) =>
              onSettings({
                travel: event.target.value === "melt" ? "melt" : "swarm",
              })
            }
          >
            <option value="swarm">{t.swarm}</option>
            <option value="melt">{t.melt}</option>
          </select>
        </label>
      </ControlSection>
      <ControlSection label={t.overlays} open={false}>
        {(["track", "links", "scan", "trails", "marks", "dense"] as const).map(
          (key) => (
            <ToggleControl
              key={key}
              label={t[key]}
              checked={settings[key]}
              onChange={(value) => onSettings({ [key]: value })}
            />
          ),
        )}
      </ControlSection>
      <ControlSection label={t.interaction}>
        {(
          [
            "pointer",
            "rotate",
            "returnOnRelease",
            "zoom",
            "pan",
            "clickToScatter",
          ] as const
        ).map((key) => (
          <ToggleControl
            key={key}
            label={t[key]}
            checked={interactions[key]}
            onChange={(value) => onInteractions({ [key]: value })}
          />
        ))}
        <RangeControl
          locale={locale}
          label={t.pointerStrength}
          value={interactions.pointerStrength}
          max={2}
          onChange={(pointerStrength) => onInteractions({ pointerStrength })}
        />
        <RangeControl
          locale={locale}
          label={t.pointerRadius}
          value={interactions.pointerRadius}
          min={0.01}
          max={2}
          onChange={(pointerRadius) => onInteractions({ pointerRadius })}
        />
        <RangeControl
          locale={locale}
          label={t.rotationLimitDegrees}
          value={interactions.rotationLimitDegrees}
          max={360}
          step={1}
          onChange={(rotationLimitDegrees) =>
            onInteractions({ rotationLimitDegrees })
          }
        />
      </ControlSection>
    </>
  );
}
