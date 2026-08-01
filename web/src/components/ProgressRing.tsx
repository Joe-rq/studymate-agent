import { useEffect, useState } from 'react';

/**
 * Circular progress ring with animated fill and color grading.
 * Used for mastery %, quiz scores, etc.
 */
export default function ProgressRing({
  value,
  size = 96,
  stroke = 8,
  label,
  suffix = '%',
  /** 0..1; value will be displayed as Math.round(value*100). */
  displayValue,
}: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  label?: string;
  suffix?: string;
  displayValue?: number; // override the numeric readout (e.g. raw score)
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value));

  // Animate from 0 on mount for a satisfying fill effect.
  const [animatedPct, setAnimatedPct] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimatedPct(pct), 60);
    return () => clearTimeout(t);
  }, [pct]);

  const offset = circumference * (1 - animatedPct);
  const readout = displayValue ?? Math.round(pct * 100);
  const color =
    pct >= 0.7 ? 'var(--success)' : pct >= 0.4 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div className="progress-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="progress-ring-svg">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.3s' }}
        />
      </svg>
      <div className="progress-ring-text">
        <span className="progress-ring-value">{readout}</span>
        {suffix && <span className="progress-ring-suffix">{suffix}</span>}
        {label && <span className="progress-ring-label">{label}</span>}
      </div>
    </div>
  );
}
