import { useEffect, useState } from 'react';
import { api, type ConceptMap } from '../api';
import MasteryBar from '../components/MasteryBar';
import { Loading, EmptyState, ErrorState } from '../components/Feedback';

interface PlanTask {
  type: string;
  nodeId: string;
  duration: number;
}

interface PlanDay {
  date: string;
  tasks: PlanTask[];
  isRest?: boolean;
}

interface PlanPhase {
  name: string;
  startDay: number;
  endDay: number;
}

interface PlanMaster {
  schedule: PlanDay[];
  phases: PlanPhase[];
  examDate?: string;
  dailyMinutes?: number;
  version?: number;
}

const PHASE_LABELS: Record<string, string> = {
  learn: '学习期',
  consolidation: '巩固期',
  sprint: '冲刺期',
};

const TASK_LABELS: Record<string, string> = {
  learn: '学习',
  review: '复习',
  quiz: '测验',
  sprint: '冲刺',
};

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export default function PlanView() {
  const [concepts, setConcepts] = useState<ConceptMap | null>(null);
  const [plan, setPlan] = useState<PlanMaster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<ConceptMap>('/concepts'),
      api.get<PlanMaster | null>('/plan/master'),
    ]).then(([c, p]) => {
      setConcepts(c);
      setPlan(p);
      setLoading(false);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });
  }, []);

  if (loading) return <Loading />;

  // Defensive: never let a malformed payload blank the whole page.
  const phases = (plan?.phases ?? []).filter(
    (p) => p && typeof p.startDay === 'number' && typeof p.endDay === 'number',
  );
  const schedule = Array.isArray(plan?.schedule) ? plan!.schedule : [];
  const conceptList = concepts?.concepts ?? [];

  if (error && !plan && conceptList.length === 0) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  }

  if (!plan && conceptList.length === 0 && !error) {
    return (
      <EmptyState
        mood="waiting"
        title="暂无学习计划"
        hint="先创建考试项目并生成计划，搭子会帮你排好每天的内容。"
      />
    );
  }

  return (
    <div>
      <h2 className="page-title">学习计划</h2>

      {error && (
        <div className="card error-text">
          部分数据加载失败：{error}
        </div>
      )}

      {plan && phases.length > 0 && (
        <>
          <h3 className="section-title">
            阶段概览（共 {schedule.length} 天）
          </h3>
          {phases.map((phase, idx) => {
            const days = phase.endDay - phase.startDay + 1;
            const label = PHASE_LABELS[phase.name] ?? phase.name;
            return (
              <div className="card" key={`${phase.name}-${idx}`}>
                <div className="row-between">
                  <span className="row-title">{label}</span>
                  <span className="row-meta">
                    第 {phase.startDay + 1}–{phase.endDay + 1} 天 · {days} 天
                  </span>
                </div>
              </div>
            );
          })}
        </>
      )}

      {schedule.length > 0 && (
        <>
          <h3 className="section-title">每日安排</h3>
          {schedule.map((day) => {
            const d = new Date(day.date + 'T00:00:00');
            const weekday = WEEKDAY_LABELS[d.getDay()] ?? '?';
            const taskSummary = (day.tasks ?? [])
              .map((t) => `${TASK_LABELS[t.type] ?? t.type} ${t.duration}分`)
              .join('、');
            return (
              <div className="card plan-day" key={day.date}>
                <div className="row-between">
                  <span className="row-title">
                    {day.date}（周{weekday}）
                  </span>
                  {day.isRest && (
                    <span className="row-meta">休息</span>
                  )}
                </div>
                <p className="row-detail">
                  {taskSummary || '（无任务）'}
                </p>
              </div>
            );
          })}
        </>
      )}

      {conceptList.length > 0 && (
        <>
          <h3 className="section-title">知识点掌握度</h3>
          {conceptList.map((node, i) => (
            <div key={node.id} className="mastery-row stagger" style={{ ['--i' as string]: i }}>
              <MasteryBar value={node.mastery} label={node.name} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
