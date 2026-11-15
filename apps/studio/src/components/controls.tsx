import { useId, type ReactNode } from "react";

export function RangeControl({
  locale,
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  locale: "en" | "fa";
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const id = useId();

  return (
    <label className="range-control" htmlFor={id}>
      <span>
        {label}
        <output>{Number(value.toFixed(2)).toLocaleString(locale)}</output>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function ToggleControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-control">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

export function ControlSection({
  label,
  children,
  open = true,
}: {
  label: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="control-section" open={open}>
      <summary>{label}</summary>
      <div className="section-content">{children}</div>
    </details>
  );
}
