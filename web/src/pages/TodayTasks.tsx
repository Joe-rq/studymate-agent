import { useEffect, useState, useCallback } from 'react';
import { api, type TodayPlan } from '../api';
import TaskCard from '../components/TaskCard';

export default function TodayTasks() {
  const [plan, setPlan] = useState<TodayPlan | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api.get<TodayPlan>('/plan/today').then((p) => {
      setPlan(p);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDone = async (id: string) => {
    await api.post(`/task/${id}/done`);
    load();
  };

  const handleSkip = async (id: string) => {
    await api.post(`/task/${id}/skip`);
    load();
  };

  if (loading) return <p>加载中...</p>;

  const tasks = plan?.tasks ?? [];
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <div>
      <h2 className="page-title">今日任务</h2>
      <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
        {plan?.date ?? ''} · 完成 {doneCount}/{tasks.length}
      </p>

      {tasks.length === 0 ? (
        <div className="card">
          <p>今天没有安排任务，去生成计划吧！</p>
        </div>
      ) : (
        tasks.map((task) => (
          <TaskCard key={task.id} task={task} onDone={handleDone} onSkip={handleSkip} />
        ))
      )}
    </div>
  );
}
