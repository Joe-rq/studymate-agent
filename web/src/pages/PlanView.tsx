import { useEffect, useState } from 'react';
import { api, type ConceptMap } from '../api';
import MasteryBar from '../components/MasteryBar';

interface PlanMaster {
  phases: Array<{
    id: string;
    name: string;
    days: number;
    topics: string[];
  }>;
  totalDays: number;
}

export default function PlanView() {
  const [concepts, setConcepts] = useState<ConceptMap | null>(null);
  const [plan, setPlan] = useState<PlanMaster | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<ConceptMap>('/concepts'),
      api.get<PlanMaster | null>('/plan/master'),
    ]).then(([c, p]) => {
      setConcepts(c);
      setPlan(p);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <p>加载中...</p>;

  return (
    <div>
      <h2 className="page-title">学习计划</h2>

      {plan && plan.phases && (
        <>
          <h3 style={{ fontSize: '1.1rem', margin: '16px 0 12px' }}>阶段概览（共 {plan.totalDays} 天）</h3>
          {plan.phases.map((phase) => (
            <div className="card" key={phase.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{phase.name}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{phase.days} 天</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {phase.topics.join('、')}
              </p>
            </div>
          ))}
        </>
      )}

      {concepts && concepts.concepts.length > 0 && (
        <>
          <h3 style={{ fontSize: '1.1rem', margin: '24px 0 12px' }}>知识点掌握度</h3>
          {concepts.concepts.map((node) => (
            <div key={node.id} style={{ marginBottom: 12 }}>
              <MasteryBar value={node.mastery} label={node.name} />
            </div>
          ))}
        </>
      )}

      {!plan && !concepts?.concepts.length && (
        <div className="card">
          <p>暂无学习计划，请先创建考试项目并生成计划。</p>
        </div>
      )}
    </div>
  );
}
