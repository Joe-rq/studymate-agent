import type { ReactNode } from 'react';
import Mascot from './Mascot';

/* ── Spinner ─────────────────────────────────────────────────────── */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" aria-label="加载中" role="status" />
      {label && <span className="spinner-label">{label}</span>}
    </div>
  );
}

/* ── Page-level loading: centered spinner ────────────────────────── */
export function Loading({ label = '加载中...' }: { label?: string }) {
  return (
    <div className="state-block">
      <Spinner label={label} />
    </div>
  );
}

/* ── Skeleton card (for stat grids / lists while fetching) ───────── */
export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-line skeleton-line-lg" />
      <div className="skeleton-line skeleton-line-sm" />
    </div>
  );
}

export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="stat-grid">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────── */
export function EmptyState({
  characterId,
  mood = 'waiting',
  title,
  hint,
  action,
}: {
  characterId?: string;
  mood?: 'waiting' | 'thinking' | 'encouraging';
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-block">
      <div className="state-mascot">
        <Mascot characterId={characterId} mood={mood} size={104} />
      </div>
      <p className="state-title">{title}</p>
      {hint && <p className="state-hint">{hint}</p>}
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}

/* ── Error state ─────────────────────────────────────────────────── */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-block">
      <div className="state-mascot">
        <Mascot mood="encouraging" size={104} />
      </div>
      <p className="state-title">出小问题了</p>
      <p className="state-hint error-text">{message}</p>
      {onRetry && (
        <div className="state-action">
          <button className="btn btn-outline" onClick={onRetry}>
            重试
          </button>
        </div>
      )}
    </div>
  );
}
