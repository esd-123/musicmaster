"use client";

import { useEffect, useRef, useState } from "react";

type Axes = { approachability: number; valence: number; density: number };

const AXES: { key: keyof Axes; low: string; high: string }[] = [
  { key: "approachability", low: "Challenging", high: "Easy-listening" },
  { key: "valence", low: "Dark", high: "Bright" },
  { key: "density", low: "Ambient", high: "Energetic" },
];

export function MoodAxesEditor({
  releaseId,
  initialAxes,
}: {
  releaseId: number;
  initialAxes: Axes;
}) {
  const [axes, setAxes] = useState(initialAxes);
  const [saving, setSaving] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, []);

  function update(key: keyof Axes, value: number) {
    const next = { ...axes, [key]: value };
    setAxes(next);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/releases/${releaseId}/mood-axes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
      } finally {
        setSaving(false);
      }
    }, 400);
  }

  return (
    <div className={`space-y-3 ${saving ? "opacity-70" : ""}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Mood axes
      </h2>
      {AXES.map(({ key, low, high }) => (
        <div key={key} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-right text-zinc-500">{low}</span>
          <div className="relative flex-1">
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={axes[key]}
              onChange={(e) => update(key, Number(e.target.value))}
              className="w-full accent-zinc-900 dark:accent-zinc-100"
            />
            <div className="pointer-events-none absolute left-1/2 top-full h-1.5 w-px -translate-x-1/2 bg-zinc-500" />
          </div>
          <span className="w-28 shrink-0 text-zinc-500">{high}</span>
          <span className="w-10 shrink-0 text-right tabular-nums text-zinc-400">
            {axes[key].toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}
