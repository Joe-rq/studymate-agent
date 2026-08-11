import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BuddyStateResponse } from '../api';
import Mascot, { type Mood } from './Mascot';
import { subscribeRequestState } from '../lib/requestState';
import { ROLE_LINES, sceneFromPath } from '../lib/roleLines';

export type CompanionMode = 'companion' | 'quiet' | 'off' | 'active';
export type Activity = 'off' | 'quiet' | 'companion' | 'active';

/** 桌宠渲染尺寸（角色图）。 */
const PET_SIZE = 84;
/** 可点击/拖拽热区尺寸。 */
const PET_HOTZONE = 104;
const STORAGE_KEY = 'studymate-pet-pos';
const STORAGE_PET_KEY = 'studymate-pet-id';

/** 各请求状态下桌宠的气泡提示文字。 */
const STATUS_TEXT: Record<string, string> = {
  thinking: '让我想想…',
  happy: '完成啦！',
  concern: '网络开小差了…',
};

/** 气泡时长分档（active 更持久）。 */
const BUBBLE_MS: Record<'companion' | 'active', { intervene: number; happy: number; speak: number }> = {
  companion: { intervene: 6000, happy: 2500, speak: 4000 },
  active: { intervene: 8000, happy: 3500, speak: 5000 },
};

/** 连续学习里程碑（与后端 STREAK_MILESTONES 对齐）。 */
const STREAK_MILESTONES = [3, 7, 14, 30];

/**
 * 浮动陪伴层：右下角常驻的桌宠 + 状态气泡 + 就地控制。
 *
 * - 状态驱动：请求中 → thinking；完成 → happy/celebrating；失败 → concern。
 * - 活跃度分级（后端派生 activity）：companion 连续学习 ≥3 天自动升级 active，
 *   手动 quiet/off 覆盖；active 更主动（气泡更持久、里程碑台词、完成庆祝）。
 * - 里程碑庆祝：完成学习/连续达标时桌宠 celebrating 帧 + 弹跳 + 台词。
 * - 可拖拽：位置持久化到 localStorage；拖拽与点击自动区分。
 */
export default function PetLayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const [characterId, setCharacterId] = useState<string | undefined>(() => {
    // 从 localStorage 恢复角色 id，避免首帧闪默认主题
    try {
      return window.localStorage.getItem(STORAGE_PET_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [characterName, setCharacterName] = useState('搭子');
  const [companionMode, setCompanionMode] = useState<CompanionMode>('companion');
  const [activity, setActivity] = useState<Activity>('companion');
  const [bubble, setBubble] = useState('');
  const [visible, setVisible] = useState(false);
  const [mood, setMood] = useState<Mood>('idle');
  const [quiet, setQuiet] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const resultTimer = useRef<number | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const celebrateTimerRef = useRef<number | null>(null);
  const celebrateRef = useRef(false);

  // 拖拽位置：null = 默认右下角；否则按 left/top 定位
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const posRef = useRef(pos);
  posRef.current = pos;
  const justDraggedRef = useRef(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  // 供异步回调读取最新状态
  const companionModeRef = useRef(companionMode);
  companionModeRef.current = companionMode;
  const quietRef = useRef(quiet);
  quietRef.current = quiet;
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const characterIdRef = useRef(characterId);
  characterIdRef.current = characterId;
  // companion 或 active 时允许气泡/动画
  const activeOkRef = useRef(activity === 'companion' || activity === 'active');
  activeOkRef.current = activity === 'companion' || activity === 'active';

  // 恢复上次拖拽位置
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setPos(JSON.parse(saved));
    } catch {
      /* 忽略损坏的缓存 */
    }
  }, []);

  // 显示气泡文字；durationMs 省略则常驻，直到被下一条状态替换或收起
  const showBubbleText = useCallback((text: string, durationMs?: number) => {
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
    if (!activeOkRef.current) return; // quiet/off 不弹
    setBubble(text);
    setVisible(true);
    if (durationMs) {
      bubbleTimerRef.current = window.setTimeout(() => setVisible(false), durationMs);
    }
  }, []);

  // 加载角色 + 桌宠模式 + 开场问候 + 里程碑台词
  const loadBuddy = useCallback(() => {
    api
      .get<BuddyStateResponse>('/buddy/state')
      .then((data) => {
        setCharacterId(data.character?.id);
        setCharacterName(data.character?.name ?? '搭子');
        setCompanionMode(data.state.preferences.companionMode ?? 'companion');
        setActivity(data.activity ?? 'companion');
        const ms = data.activity === 'active' ? BUBBLE_MS.active.intervene : BUBBLE_MS.companion.intervene;
        if (data.character?.tagline) showBubbleText(data.character.tagline, ms);
        // active 且连续学习命中里程碑 → 追加里程碑台词
        if (data.activity === 'active' && STREAK_MILESTONES.includes(data.state.streakDays)) {
          api
            .get<{ shouldIntervene: boolean; line: string }>('/buddy/intervene/streak_milestone')
            .then((r) => {
              if (r.shouldIntervene && r.line) showBubbleText(r.line, BUBBLE_MS.active.intervene);
            })
            .catch(() => {});
        }
        try {
          window.localStorage.setItem(STORAGE_PET_KEY, data.character?.id ?? '');
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }, [showBubbleText]);

  // 路由变化时重新同步（含设置页切到其他页）
  useEffect(() => {
    loadBuddy();
  }, [loadBuddy, location.pathname]);

  // 设置页切换搭子后（studymate:buddy-changed）即时同步
  useEffect(() => {
    const onBuddyChanged = () => loadBuddy();
    window.addEventListener('studymate:buddy-changed', onBuddyChanged);
    return () => window.removeEventListener('studymate:buddy-changed', onBuddyChanged);
  }, [loadBuddy]);

  // 首句陪伴干预（仅挂载时一次）
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ shouldIntervene: boolean; line: string }>('/buddy/intervene/task_start')
      .then((r) => {
        if (!cancelled && r.shouldIntervene && r.line) showBubbleText(r.line, 6000);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showBubbleText]);

  // 请求生命周期驱动桌宠状态与提示文字（active 成功时庆祝）
  useEffect(() => {
    const unsubscribe = subscribeRequestState((activeReq, lastResult) => {
      if (celebrateRef.current) return; // 庆祝中跳过请求层状态
      if (resultTimer.current) window.clearTimeout(resultTimer.current);
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
      if (activeReq > 0) {
        setMood('thinking');
        showBubbleText(STATUS_TEXT.thinking); // 请求期间常驻
        return;
      }
      const isError = lastResult === 'error';
      const isActive = activityRef.current === 'active';
      const next: Mood = isError ? 'concern' : isActive ? 'celebrating' : 'happy';
      setMood(next);
      if (next === 'celebrating') setCelebrating(true);
      const ms = isActive ? BUBBLE_MS.active.happy : BUBBLE_MS.companion.happy;
      showBubbleText(isError ? STATUS_TEXT.concern : STATUS_TEXT.happy, ms);
      resultTimer.current = window.setTimeout(() => {
        setMood('idle');
        setCelebrating(false);
      }, ms);
    });
    return () => {
      unsubscribe();
      if (resultTimer.current) window.clearTimeout(resultTimer.current);
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
      if (celebrateTimerRef.current) window.clearTimeout(celebrateTimerRef.current);
    };
  }, [showBubbleText]);

  // 里程碑/完成庆祝（StudioPage complete 后 dispatch studymate:celebrate）
  useEffect(() => {
    const onCelebrate = (e: Event) => {
      const detail = (e as CustomEvent<{ kind: 'streak_milestone' | 'session_complete'; streakDays: number }>).detail;
      if (!activeOkRef.current || quietRef.current) return;
      if (celebrateRef.current) return;
      celebrateRef.current = true;
      if (resultTimer.current) window.clearTimeout(resultTimer.current);
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
      setMood('celebrating');
      setCelebrating(true);
      if (detail.kind === 'streak_milestone') {
        api
          .get<{ shouldIntervene: boolean; line: string }>('/buddy/intervene/streak_milestone')
          .then((r) => {
            showBubbleText(r.shouldIntervene && r.line ? r.line : `连续学习 ${detail.streakDays} 天啦！`, 4500);
          })
          .catch(() => showBubbleText(`连续学习 ${detail.streakDays} 天啦！`, 4500));
      } else {
        const lines = ROLE_LINES[characterIdRef.current ?? ''] ?? ROLE_LINES.tuanzi;
        showBubbleText(lines.reflect, 4500);
      }
      celebrateTimerRef.current = window.setTimeout(() => {
        celebrateRef.current = false;
        setMood('idle');
        setCelebrating(false);
        if (resultTimer.current) window.clearTimeout(resultTimer.current);
      }, 4500);
    };
    window.addEventListener('studymate:celebrate', onCelebrate);
    return () => window.removeEventListener('studymate:celebrate', onCelebrate);
  }, [showBubbleText]);

  // 角色 → 整页 Ambient 主题注入（<html data-pet>，与 data-theme 正交）
  useEffect(() => {
    if (characterId) {
      document.documentElement.dataset.pet = characterId;
    } else {
      delete document.documentElement.dataset.pet;
    }
  }, [characterId]);

  if (companionMode === 'off') return null;

  const activeOk = activity === 'companion' || activity === 'active';
  const showBubble = visible && bubble && activeOk && !quiet;
  // idle 用静态帧 + CSS 呼吸微动；有请求/结果时用对应状态帧；安静时静止
  const mascotMood = activeOk ? (quiet ? 'default' : mood === 'idle' ? 'default' : mood) : 'default';
  const alive = activeOk && !quiet && mood === 'idle' && !dragging;
  const scene = sceneFromPath(location.pathname);
  const statusText = quiet
    ? '安静模式'
    : activity === 'active'
      ? `${characterName} · 活跃陪伴中`
      : `${characterName} · ${scene === 'focus' ? '专注中' : '陪伴中'}`;

  // 就地控制：说一句（当前场景台词，active 更持久）
  const handleSpeak = () => {
    const lines = ROLE_LINES[characterId ?? ''] ?? ROLE_LINES.tuanzi;
    const ms = activity === 'active' ? BUBBLE_MS.active.speak : BUBBLE_MS.companion.speak;
    showBubbleText(lines[scene], ms);
  };

  // 就地控制：安静模式（会话级）
  const handleToggleQuiet = () => {
    setQuiet((q) => !q);
    if (quietRef.current) {
      // 从安静切回：恢复当前场景台词
      const lines = ROLE_LINES[characterId ?? ''] ?? ROLE_LINES.tuanzi;
      showBubbleText(lines[scene], 4000);
    }
  };

  // ── 拖拽（Pointer Events，鼠标/触屏通用）────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
      moved: false,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    if (d.moved) {
      const maxX = Math.max(0, window.innerWidth - PET_HOTZONE);
      const maxY = Math.max(0, window.innerHeight - PET_HOTZONE);
      setPos({
        x: Math.min(maxX, Math.max(0, d.origX + dx)),
        y: Math.min(maxY, Math.max(0, d.origY + dy)),
      });
    }
  };

  const handlePointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (d?.moved) {
      justDraggedRef.current = true;
      try {
        if (posRef.current) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(posRef.current));
        }
      } catch {
        /* 忽略存储失败 */
      }
    }
  };

  // 点击进聊天；拖动结束后忽略本次点击
  const handleClick = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    navigate('/chat');
  };

  const layerStyle = pos
    ? { left: pos.x, top: pos.y, right: 'auto' as const, bottom: 'auto' as const }
    : undefined;

  return (
    <div
      className={`pet-layer${alive ? ' pet-alive' : ''}${dragging ? ' pet-dragging' : ''}`}
      style={layerStyle}
    >
      {showBubble && (
        <button
          className="pet-bubble"
          onClick={() => setVisible(false)}
          aria-label="关闭陪伴气泡"
        >
          {bubble}
        </button>
      )}
      <div className="pet-status">{statusText}</div>
      <button
        className={`pet-fab${celebrating ? ' pet-celebrate' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        aria-label={`和${characterName}聊天（可拖拽）`}
        title={`和${characterName}聊天（可拖拽）`}
      >
        <Mascot characterId={characterId} mood={mascotMood} size={PET_SIZE} />
      </button>
      <div className="pet-controls">
        <button onClick={handleSpeak} title="说一句" aria-label="说一句">
          💬
        </button>
        <button onClick={handleToggleQuiet} title={quiet ? '退出安静模式' : '安静模式'} aria-label="安静模式">
          ◌
        </button>
      </div>
    </div>
  );
}
