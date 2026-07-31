import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type StatusResponse } from '../api';

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get<StatusResponse>('/status').then(setStatus).catch((e) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: 'var(--danger)' }}>加载失败：{error}</p>;
  if (!status) return <p>加载中...</p>;

  // No exam project — show onboarding prompt
  if (!status.exam) {
    return (
      <div>
        <h2 className="page-title">欢迎使用 StudyMate</h2>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>
          还没有考试项目。请先创建考试项目，开始你的备考之旅。
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/onboarding')}>
          创建考试项目
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">
        {status.exam ? status.exam.name : '备考面板'}
      </h2>

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

      <div style={{ display: 'flex', gap: 12 }}>
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
