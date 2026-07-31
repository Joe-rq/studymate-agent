import { useEffect, useState } from 'react';
import { api, type BuddyStateResponse } from '../api';

export default function BuddyPanel() {
  const [data, setData] = useState<BuddyStateResponse | null>(null);
  const [intervention, setIntervention] = useState('');

  useEffect(() => {
    api.get<BuddyStateResponse>('/buddy/state').then(setData).catch(() => {});
    // Try to get a greeting intervention
    api
      .get<{ shouldIntervene: boolean; line: string }>('/buddy/intervene/task_start')
      .then((r) => {
        if (r.shouldIntervene && r.line) setIntervention(r.line);
      })
      .catch(() => {});
  }, []);

  const character = data?.character;
  const mood = getMood(data?.state.streakDays ?? 0);

  return (
    <div>
      <div className="buddy-avatar">{mood.emoji}</div>
      <div className="buddy-name">{character?.name ?? '搭子'}</div>
      <div className="buddy-mood">
        {character ? `${character.personality}` : '加载中...'}
      </div>

      {intervention && <div className="buddy-message">{intervention}</div>}

      {data?.state && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <p>关系等级：{data.state.relationshipLevel}/100</p>
          <p>连续学习：{data.state.streakDays} 天</p>
          {data.state.memories.length > 0 && (
            <p>记忆：{data.state.memories.length} 条</p>
          )}
        </div>
      )}
    </div>
  );
}

function getMood(streak: number): { emoji: string; label: string } {
  if (streak >= 7) return { emoji: '🎉', label: 'celebrating' };
  if (streak >= 3) return { emoji: '😊', label: 'happy' };
  if (streak >= 1) return { emoji: '🙂', label: 'neutral' };
  return { emoji: '😴', label: 'waiting' };
}
