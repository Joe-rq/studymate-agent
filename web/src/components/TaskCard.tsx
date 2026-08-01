import type { Task } from '../api';

interface Props {
  task: Task;
  onDone: (id: string) => void;
  onSkip: (id: string) => void;
}

const typeLabels: Record<string, string> = {
  review: '复习',
  new: '新学',
  quiz: '测验',
  exercise: '练习',
};

export default function TaskCard({ task, onDone, onSkip }: Props) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <span className={`badge badge-${task.type}`}>
          {typeLabels[task.type] ?? task.type}
        </span>
        <span style={{ marginLeft: 8, fontWeight: 500 }}>{task.nodeName}</span>
        <span className={`badge badge-${task.status}`} style={{ marginLeft: 8 }}>
          {task.status === 'done' ? '已完成' : task.status === 'skipped' ? '已跳过' : '待完成'}
        </span>
      </div>
      {task.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-success" onClick={() => onDone(task.id)}>
            完成
          </button>
          <button className="btn btn-outline" onClick={() => onSkip(task.id)}>
            跳过
          </button>
        </div>
      )}
    </div>
  );
}
