import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type StatusResponse, type BuddyStateResponse } from '../api';
import Mascot, { deriveMood } from '../components/Mascot';

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [buddy, setBuddy] = useState<BuddyStateResponse | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get<StatusResponse>('/status').then(setStatus).catch((e) => setError(e.message));
    api.get<BuddyStateResponse>('/buddy/state').then(setBuddy).catch(() => {});
  }, []);

  if (error) return <p className="error-text">加载失败：{error}</p>;
  if (!status) return <p className="muted">加载中...</p>;

  const character = buddy?.character;
  const mood = deriveMood({
    streakDays: status.streakDays,
    recentScore: status.recentScore,
    hasExam: !!status.exam,
  });

  // No exam project — show onboarding prompt
  if (!status.exam) {
    return (
      <div>
        <div className="welcome-hero">
          <Mascot characterId={character?.id} mood="waiting" size={120} />
          <div>
            <h2 className="page-title">欢迎使用 StudyMate</h2>
            <p className="muted">还没有考试项目。请先创建考试项目，开始你的备考之旅。</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/onboarding')}>
          创建考试项目
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="dashboard-head">
        <div className="dashboard-mascot">
          <Mascot characterId={character?.id} mood={mood} size={88} />
        </div>
        <div>
          <h2 className="page-title">{status.exam.name}</h2>
          <p className="muted">
            {character
              ? `${character.name} 陪你一起备考 · ${character.tagline}`
              : '加油，今天也是元气满满的一天！'}
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">
            {status.daysToExam !== null ? status.daysToExam : '--'}
          </div>
          <div className="stat-label">距考试（天）</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{Math.round(status.avgMastery * 100)}%</div>
          <div className="stat-label">平均掌握度</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{status.streakDays}</div>
          <div className="stat-label">连续学习（天）</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{status.tasksToday}</div>
          <div className="stat-label">今日任务</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {status.recentScore !== null ? status.recentScore : '--'}
          </div>
          <div className="stat-label">最近得分</div>
        </div>
      </div>

      <div className="action-row">
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
