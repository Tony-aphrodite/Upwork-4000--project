"use client";

/** A small bar chart in plain SVG: no chart library to download on 3G. */
export function Bars({ data, format, label, height = 120 }: { data: { key: string; label: string; value: number }[]; format: (v: number) => string; label: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" className="h-[120px] w-full" role="img" aria-label={label}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 3 - 2);
          return (
            <rect key={d.key} x={i * w + w * 0.15} y={height / 3 - h} width={w * 0.7} height={Math.max(h, d.value > 0 ? 0.6 : 0)} rx={0.8} fill="var(--brand)" opacity={i === data.length - 1 ? 1 : 0.75}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-ink-3">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}
