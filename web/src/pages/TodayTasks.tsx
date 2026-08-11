import { useEffect, useState, useCallback } from 'react';
import { api, type TodayPlan } from '../api';
import TaskCard from '../components/TaskCard';
import { SkeletonCard, EmptyState } from '../components/Feedback';
import { toast } from '../components/Toast';

const ENCOURAGE_LINES = [
  '又搞定一个，搭子为你鼓掌！',
  '稳扎稳打，就这样保持～',
  '一个任务拿下，离目标更近一步！',
  'nice！记得喝口水休息一下呀。',
];

export default function TodayTasks() {
  const [plan, setPlan] = useState<TodayPlan | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get<TodayPlan>('/plan/today').then((p) => {
      setPlan(p);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDone = async (id: string) => {
    // Optimistic pop animation before reload
    const card = document.querySelector(`[data-task-id="${id}"]`);
    card?.classList.add('done-anim');
    toast.push(ENCOURAGE_LINES[Math.floor(Math.random() * ENCOURAGE_LINES.length)], 'encourage');
    setTimeout(() => load(), 350);
    try {
      await api.post(`/task/${id}/done`);
    } catch {
      /* will re-sync on next load */
    }
  };

  const handleSkip = async (id: string) => {
    await api.post(`/task/${id}/skip`);
    load();
  };

  if (loading) {
    return (
      <div>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const tasks = plan?.tasks ?? [];
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <div>
      <h2 className="page-title">今日任务</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        {plan?.date ?? ''} · 完成 {doneCount}/{tasks.length}
      </p>

      {tasks.length === 0 ? (
        <EmptyState
          mood="encouraging"
          title="今天没有安排任务"
          hint="去生成学习计划，搭子会帮你排好每天的内容。"
        />
      ) : (
        tasks.map((task, i) => (
          <div key={task.id} data-task-id={task.id} className="stagger" style={{ ['--i' as string]: i }}>
            <TaskCard task={task} onDone={handleDone} onSkip={handleSkip} />
          </div>
        ))
      )}
    </div>
  );
}
