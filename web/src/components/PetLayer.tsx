import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BuddyStateResponse } from '../api';
import Mascot, { type Mood } from './Mascot';
import { subscribeRequestState } from '../lib/requestState';

export type CompanionMode = 'companion' | 'quiet' | 'off';

/**
 * 浮动陪伴层：右下角常驻的桌宠 + 一句陪伴气泡。
 *
 * 替代被移除的右侧常驻 BuddyPanel，只承担「陪伴感」这一层：
 * - 桌宠状态由真实请求生命周期驱动：请求进行中 → thinking，完成 → happy，
 *   失败（网络 / LLM）→ concern，短暂展示后回到 idle，不制造虚假的「正在学习」状态。
 * - 三模式：陪伴（默认，气泡 + 动态）、安静（静止帧、不弹气泡）、关闭（不渲染）。
 * - 点击桌宠进入 /chat 完整搭子页（关系、记忆、聊天都在那里）。
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
  const resultTimer = useRef<number | null>(null);

  // 角色 + 桌宠模式：路由变化时重新同步，设置页改完回来即生效
  useEffect(() => {
    let cancelled = false;
    api
      .get<BuddyStateResponse>('/buddy/state')
      .then((data) => {
        if (cancelled) return;
        setCharacterId(data.character?.id);
        setCharacterName(data.character?.name ?? '搭子');
        setCompanionMode(data.state.preferences.companionMode ?? 'companion');
        setBubble((prev) => prev || data.character?.tagline || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  // 首句陪伴干预（仅挂载时一次）
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ shouldIntervene: boolean; line: string }>('/buddy/intervene/task_start')
      .then((r) => {
        if (!cancelled && r.shouldIntervene && r.line) setBubble((prev) => prev || r.line);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 请求生命周期驱动桌宠状态
  useEffect(() => {
    const unsubscribe = subscribeRequestState((active, lastResult) => {
      if (resultTimer.current) window.clearTimeout(resultTimer.current);
      if (active > 0) {
        setMood('thinking');
        return;
      }
      setMood(lastResult === 'error' ? 'concern' : 'happy');
      resultTimer.current = window.setTimeout(() => setMood('idle'), 2500);
    });
    return () => {
      unsubscribe();
      if (resultTimer.current) window.clearTimeout(resultTimer.current);
    };
  }, []);

  // 气泡出现后 6 秒自动收起（安静模式下不弹）
  useEffect(() => {
    if (!bubble || companionMode !== 'companion') return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [bubble, companionMode]);

  if (companionMode === 'off') return null;

  const showBubble = visible && bubble && companionMode === 'companion';
  const displayMood = companionMode === 'quiet' ? 'default' : mood;

  return (
    <div className="pet-layer">
      {showBubble && (
        <button
          className="pet-bubble"
          onClick={() => setVisible(false)}
          aria-label="关闭陪伴气泡"
        >
          {bubble}
        </button>
      )}
      <button
        className="pet-fab"
        onClick={() => navigate('/chat')}
        aria-label={`和${characterName}聊天`}
        title={`和${characterName}聊天`}
      >
        <Mascot characterId={characterId} mood={displayMood} size={60} />
      </button>
    </div>
  );
}
