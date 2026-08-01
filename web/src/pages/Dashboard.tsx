import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type StatusResponse, type BuddyStateResponse } from '../api';
import Mascot, { deriveMood } from '../components/Mascot';
import ProgressRing from '../components/ProgressRing';
import { SkeletonGrid, EmptyState, ErrorState } from '../components/Feedback';

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [buddy, setBuddy] = useState<BuddyStateResponse | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    setError('');
    setStatus(null);
    Promise.all([
      api.get<StatusResponse>('/status'),
      api.get<BuddyStateResponse>('/buddy/state'),
    ])
      .then(([s, b]) => {
        setStatus(s);
        setBuddy(b);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!status) return <SkeletonGrid count={5} />;

  const character = buddy?.character;
  const mood = deriveMood({
    streakDays: status.streakDays,
    recentScore: status.recentScore,
    hasExam: !!status.exam,
  });

  // No exam project — show onboarding prompt
  if (!status.exam) {
    return (
      <EmptyState
        characterId={character?.id}
        mood="waiting"
        title="还没有考试项目"
        hint="创建你的第一个考试项目，搭子会陪你一起备考。"
        action={
          <button className="btn btn-primary" onClick={() => navigate('/onboarding')}>
            创建考试项目
          </button>
        }
      />
    );
  }

  return (
    <div>
      <div className="dashboard-head fade-in-up">
        <div className="dashboard-mascot">
          <Mascot characterId={character?.id} mood={mood} size={88} />
        </div>
        <div>
          <h2 className="page-title">{status.exam.name}</h2>
          <p className="muted">
            {character
              ? `${character.name} 陪你一起备考 · ${character.tagline ?? character.personality}`
              : '加油，今天也是元气满满的一天！'}
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card stagger" style={{ ['--i' as string]: 0 }}>
          <ProgressRing value={status.avgMastery} size={88} stroke={7} />
          <div className="stat-label">平均掌握度</div>
        </div>
        <div className="stat-card stagger" style={{ ['--i' as string]: 1 }}>
          <div className="stat-value">
            {status.daysToExam !== null ? status.daysToExam : '--'}
          </div>
          <div className="stat-label">距考试（天）</div>
        </div>
        <div className="stat-card stagger" style={{ ['--i' as string]: 2 }}>
          <div className="stat-value">{status.streakDays}</div>
          <div className="stat-label">连续学习（天）</div>
        </div>
        <div className="stat-card stagger" style={{ ['--i' as string]: 3 }}>
          <div className="stat-value">{status.tasksToday}</div>
          <div className="stat-label">今日任务</div>
        </div>
        <div className="stat-card stagger" style={{ ['--i' as string]: 4 }}>
          <ProgressRing
            value={status.recentScore !== null ? status.recentScore / 100 : 0}
            size={88}
            stroke={7}
            suffix="分"
            displayValue={status.recentScore ?? 0}
            label="最近得分"
          />
        </div>
      </div>

      <div className="action-row fade-in-up">
        <button className="btn btn-primary" onClick={() => navigate('/tasks')}>
          查看今日任务
        </button>
        <button className="btn btn-outline" onClick={() => navigate('/quiz')}>
          开始测验
        </button>
        <button className="btn btn-outline" onClick={() => navigate('/chat')}>
          和搭子聊聊
        </button>
      </div>
    </div>
  );
}
