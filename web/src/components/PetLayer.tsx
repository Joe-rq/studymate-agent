import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BuddyStateResponse } from '../api';
import Mascot, { type Mood } from './Mascot';
import { subscribeRequestState } from '../lib/requestState';

export type CompanionMode = 'companion' | 'quiet' | 'off';

/** 桌宠渲染尺寸（角色图）。 */
const PET_SIZE = 84;
/** 可点击/拖拽热区尺寸。 */
const PET_HOTZONE = 104;
const STORAGE_KEY = 'studymate-pet-pos';

/** 各请求状态下桌宠的气泡提示文字。 */
const STATUS_TEXT: Record<string, string> = {
  thinking: '让我想想…',
  happy: '完成啦！',
  concern: '网络开小差了…',
};

/** 角色专属的场景台词（参考桌面宠物设计：ready/focus/reflect 三态）。 */
interface RoleLines {
  label: string;
  ready: string;
  focus: string;
  reflect: string;
}

const ROLE_LINES: Record<string, RoleLines> = {
  tuanzi: {
    label: '林间书桌 · 芽团',
    ready: '先把这一小节做完，其他的晚点再管。',
    focus: '芽团在旁边。你学你的。',
    reflect: '今天又多记住了一点。',
  },
  lu_xingye: {
    label: '午后图书馆 · 晴川',
    ready: '别急，先把眼前这节吃透。',
    focus: '这部分慢一点没关系。',
    reflect: '今天推进得很稳。',
  },
  shen_ye: {
    label: '午夜自习室 · 凛川',
    ready: '别切页面。先把这题弄懂。',
    focus: '这题上次也错过。再来。',
    reflect: '这次记住了。',
  },
  su_nian: {
    label: '清晨校园 · 柚宁',
    ready: '搭档，先搞定第一项！',
    focus: '稳住稳住，马上就过这节！',
    reflect: '搞定！今天进度漂亮。',
  },
};

/** 按路由推断当前学习场景。 */
function sceneFromPath(path: string): keyof Omit<RoleLines, 'label'> {
  if (path.startsWith('/tasks') || path.startsWith('/quiz') || path.startsWith('/grade')) {
    return 'focus';
  }
  return 'ready';
}

/**
 * 浮动陪伴层：右下角常驻的桌宠 + 状态气泡 + 就地控制。
 *
 * - 状态驱动：请求中 → thinking「让我想想…」；完成 → happy「完成啦！」；失败 → concern「网络开小差了…」。
 * - 场景台词：💬 说一句时按当前场景（ready/focus/reflect）显示角色专属台词。
 * - 状态标签：桌宠旁显示「角色 · 陪伴中/专注中/安静模式」。
 * - 控制按钮：💬 说一句 / ◌ 安静模式（会话级，不弹气泡 + 静止）。
 * - 可拖拽：位置持久化到 localStorage，刷新保留；拖拽与点击自动区分。
 */
export default function PetLayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const [characterId, setCharacterId] = useState<string | undefined>(undefined);
  const [characterName, setCharacterName] = useState('搭子');
  const [companionMode, setCompanionMode] = useState<CompanionMode>('companion');
  const [bubble, setBubble] = useState('');
  const [visible, setVisible] = useState(false);
  const [mood, setMood] = useState<Mood>('idle');
  const [quiet, setQuiet] = useState(false);
  const resultTimer = useRef<number | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);

  // 拖拽位置：null = 默认右下角；否则按 left/top 定位
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const posRef = useRef(pos);
  posRef.current = pos;
  const justDraggedRef = useRef(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  // 供异步回调读取最新 companionMode / quiet
  const companionModeRef = useRef(companionMode);
  companionModeRef.current = companionMode;
  const quietRef = useRef(quiet);
  quietRef.current = quiet;

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
    if (companionModeRef.current !== 'companion') return;
    setBubble(text);
    setVisible(true);
    if (durationMs) {
      bubbleTimerRef.current = window.setTimeout(() => setVisible(false), durationMs);
    }
  }, []);

  // 加载角色 + 桌宠模式 + 开场问候
  const loadBuddy = useCallback(() => {
    api
      .get<BuddyStateResponse>('/buddy/state')
      .then((data) => {
        setCharacterId(data.character?.id);
        setCharacterName(data.character?.name ?? '搭子');
        setCompanionMode(data.state.preferences.companionMode ?? 'companion');
        if (data.character?.tagline) showBubbleText(data.character.tagline, 6000);
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

  // 请求生命周期驱动桌宠状态与提示文字
  useEffect(() => {
    const unsubscribe = subscribeRequestState((active, lastResult) => {
      if (resultTimer.current) window.clearTimeout(resultTimer.current);
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
      if (active > 0) {
        setMood('thinking');
        showBubbleText(STATUS_TEXT.thinking); // 请求期间常驻
        return;
      }
      const isError = lastResult === 'error';
      setMood(isError ? 'concern' : 'happy');
      showBubbleText(isError ? STATUS_TEXT.concern : STATUS_TEXT.happy, 2500);
      resultTimer.current = window.setTimeout(() => setMood('idle'), 2500);
    });
    return () => {
      unsubscribe();
      if (resultTimer.current) window.clearTimeout(resultTimer.current);
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
    };
  }, [showBubbleText]);

  if (companionMode === 'off') return null;

  const isCompanion = companionMode === 'companion';
  const showBubble = visible && bubble && isCompanion && !quiet;
  // idle 用静态帧 + CSS 呼吸微动；有请求/结果时用对应状态帧；安静时静止
  const mascotMood = isCompanion ? (quiet ? 'default' : mood === 'idle' ? 'default' : mood) : 'default';
  const alive = isCompanion && !quiet && mood === 'idle' && !dragging;
  const scene = sceneFromPath(location.pathname);
  const statusText = quiet
    ? '安静模式'
    : `${characterName} · ${scene === 'focus' ? '专注中' : '陪伴中'}`;

  // 就地控制：说一句（当前场景台词）
  const handleSpeak = () => {
    const lines = ROLE_LINES[characterId ?? ''] ?? ROLE_LINES.tuanzi;
    showBubbleText(lines[scene], 4000);
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
        className="pet-fab"
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
