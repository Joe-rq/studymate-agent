import { useEffect, useState } from 'react';

/**
 * Mood the mascot should express. When `idle`, the full 8-frame sprite sheet
 * loops as a breathing animation; otherwise the mascot freezes on the frame
 * that best matches the requested mood.
 */
export type Mood =
  | 'idle'
  | 'default'
  | 'happy'
  | 'celebrating'
  | 'encouraging'
  | 'thinking'
  | 'waiting';

/** Map a backend character id to its sprite sheet filename. */
const SPRITE_BY_CHARACTER: Record<string, string> = {
  lu_xingye: 'warm_boy_sprite_8x256.png',
  shen_ye: 'cool_scholar_sprite_8x256.png',
  su_nian: 'energy_girl_sprite_8x256.png',
  tuanzi: 'sprout_mascot_sprite_8x256.png',
};

const FALLBACK_SPRITE = 'sprout_mascot_sprite_8x256.png';

/**
 * Frame index (0-7) for each non-idle mood. Derived from pixel analysis of the
 * sprite sheets: early frames are subtle expression shifts, later frames show
 * larger pose changes (f5 = arms open, f7 = center-of-mass drops / resting).
 */
const FRAME_BY_MOOD: Record<Exclude<Mood, 'idle'>, number> = {
  default: 0,
  happy: 1,
  thinking: 2,
  encouraging: 6,
  celebrating: 5,
  waiting: 7,
};

const FRAMES = 8;

export interface MascotProps {
  /** Backend character id (e.g. "lu_xingye"). Falls back to the sprout mascot. */
  characterId?: string;
  /** Mood to express. `idle` (default) plays the full loop. */
  mood?: Mood;
  /** Rendered size in px (square). Default 96. */
  size?: number;
  /** Extra class names (e.g. for chat-row avatars). */
  className?: string;
}

export default function Mascot({
  characterId,
  mood = 'idle',
  size = 96,
  className,
}: MascotProps) {
  const sprite =
    (characterId && SPRITE_BY_CHARACTER[characterId]) || FALLBACK_SPRITE;
  const isIdle = mood === 'idle';

  // The sprite displays exactly one 1/8 slice at a time via background-size 800%
  // and shifting background-position-x across 8 stops.
  const frame = isIdle ? 0 : FRAME_BY_MOOD[mood];

  // For idle mode we animate background-position-x with steps(8). Because the
  // animation is defined per-instance via inline keyframes would be heavy, we
  // toggle a CSS class and let global.css handle the keyframes. To keep each
  // instance independent we just set the static styles here and rely on the
  // `.mascot.idle` rule in global.css for the loop.
  return (
    <div
      className={`mascot-sprite${isIdle ? ' idle' : ''}${className ? ' ' + className : ''}`}
      role="img"
      aria-label="study buddy"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(/mascot/${sprite})`,
        backgroundSize: `${FRAMES * 100}% 100%`,
        backgroundPositionX: `${(frame / (FRAMES - 1)) * 100}%`,
        backgroundRepeat: 'no-repeat',
        imageRendering: 'auto',
      }}
    />
  );
}

/**
 * Derive a mood from observable buddy signals. Used by BuddyPanel / BuddyChat
 * so they don't have to know the frame mapping.
 */
export function deriveMood(opts: {
  streakDays?: number;
  recentScore?: number | null;
  hasExam?: boolean;
}): Mood {
  const { streakDays = 0, recentScore = null, hasExam = true } = opts;
  if (!hasExam) return 'waiting';
  if (recentScore !== null && recentScore < 60) return 'encouraging';
  if (streakDays >= 7) return 'celebrating';
  if (streakDays >= 3) return 'happy';
  if (streakDays < 1) return 'waiting';
  return 'idle';
}

// Re-exported for callers that want to preload all sprites on first paint.
export function usePreloadSprites() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let pending = Object.values(SPRITE_BY_CHARACTER).length;
    if (pending === 0) return setReady(true);
    Object.values(SPRITE_BY_CHARACTER).forEach((file) => {
      const img = new Image();
      img.onload = img.onerror = () => {
        pending -= 1;
        if (pending === 0) setReady(true);
      };
      img.src = `/mascot/${file}`;
    });
  }, []);
  return ready;
}
