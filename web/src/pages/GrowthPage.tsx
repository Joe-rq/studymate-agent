import { useCallback, useEffect, useState } from 'react';
import { api, type SessionsResponse } from '../api';
import SessionTrends from '../components/SessionTrends';
import { Loading, ErrorState, EmptyState } from '../components/Feedback';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

/** 成长数据：已完成 Session 的汇总 + 趋势 + 历史列表。 */
export default function GrowthPage() {
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get<SessionsResponse>('/sessions')
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (loading || !data) return <Loading />;

  const { sessions, trend, totals } = data;

  if (sessions.length === 0) {
    return (
      <div>
        <h2 className="page-title">成长数据</h2>
        <EmptyState
          mood="encouraging"
          title="还没有学习记录"
          hint="完成一次学习闭环后，这里会记录你的每次 Session。"
        />
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">成长数据</h2>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{totals.sessionCount}</div>
          <div className="stat-label">完成 Session</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totals.totalMinutes}分</div>
          <div className="stat-label">累计专注</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{Math.round(totals.avgAccuracy * 100)}%</div>
          <div className="stat-label">平均正确率</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{Math.round(totals.avgScore)}</div>
          <div className="stat-label">平均得分</div>
        </div>
      </div>

      <div className="card">
        <SessionTrends
          accuracyTrend={trend.map((t) => ({ date: t.date, avgAccuracy: t.avgAccuracy }))}
          durationTrend={trend.map((t) => ({ date: t.date, totalMinutes: t.totalMinutes }))}
        />
      </div>

      <h3 className="section-title">历史记录</h3>
      {sessions.map((s) => (
        <div className="card stagger" key={s.sessionId}>
          <div className="row-between">
            <span className="row-title">
              {s.date} · {s.nodeName}
            </span>
            <span className={`badge ${s.accuracy >= 0.6 ? 'badge-done' : 'badge-skipped'}`}>
              {Math.round(s.accuracy * 100)}% 正确
            </span>
          </div>
          <p className="row-detail muted" style={{ marginTop: 6 }}>
            {formatDuration(s.durationSeconds)} · {s.answeredQuestions} 题 · 得分 {s.score}
            {s.masteryDeltaSum !== 0 && (
              <span>
                {' '}· 掌握度{' '}
                <em className={s.masteryDeltaSum >= 0 ? 'delta-up' : 'delta-down'}>
                  {s.masteryDeltaSum >= 0 ? '+' : ''}
                  {Math.round(s.masteryDeltaSum * 100)}%
                </em>
              </span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}
