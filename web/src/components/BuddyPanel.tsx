import { useEffect, useState } from 'react';
import { api, type BuddyStateResponse } from '../api';
import Mascot, { deriveMood } from './Mascot';

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
  const streak = data?.state.streakDays ?? 0;
  const mood = deriveMood({ streakDays: streak });

  return (
    <div>
      <div className="buddy-avatar">
        <Mascot characterId={character?.id} mood={mood} size={96} />
      </div>
      <div className="buddy-name">{character?.name ?? '搭子'}</div>
      <div className="buddy-mood">
        {character ? character.tagline : '加载中...'}
      </div>

      {intervention && <div className="buddy-message">{intervention}</div>}

      {data?.state && (
        <div className="buddy-stats">
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
