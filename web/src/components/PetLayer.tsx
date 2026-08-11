import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BuddyStateResponse } from '../api';
import Mascot, { type Mood } from './Mascot';
import { subscribeRequestState } from '../lib/requestState';

export type CompanionMode = 'companion' | 'quiet' | 'off';

/**
 * 浮动陪伴层：右下角常驻的桌宠 + 一句陪伴气泡。
 *
 * - 桌宠状态由真实请求生命周期驱动：请求中 → thinking，完成 → happy，
 *   失败（网络 / LLM）→ concern，短暂展示后回到 idle。
 * - idle 时用静态帧 + CSS 呼吸微动（pet-alive），避免精灵帧循环的跳变生硬感。
 * - 三模式：陪伴（默认，气泡 + 动态）、安静（静止帧、不弹气泡）、关闭（不渲染）。
 * - 角色与偏好随路由变化 / 设置页切换搭子事件即时刷新。
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

  // 加载角色 + 桌宠模式
  const loadBuddy = useCallback(() => {
    api
      .get<BuddyStateResponse>('/buddy/state')
      .then((data) => {
        setCharacterId(data.character?.id);
        setCharacterName(data.character?.name ?? '搭子');
        setCompanionMode(data.state.preferences.companionMode ?? 'companion');
        setBubble(data.character?.tagline ?? '');
      })
      .catch(() => {});
  }, []);

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

  const isCompanion = companionMode === 'companion';
  const showBubble = visible && bubble && isCompanion;
  // idle 用静态帧 + CSS 呼吸微动；有请求/结果时用对应状态帧
  const mascotMood = isCompanion ? (mood === 'idle' ? 'default' : mood) : 'default';
  const alive = isCompanion && mood === 'idle';

  return (
    <div className={`pet-layer${alive ? ' pet-alive' : ''}`}>
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
        <Mascot characterId={characterId} mood={mascotMood} size={60} />
      </button>
    </div>
  );
}
