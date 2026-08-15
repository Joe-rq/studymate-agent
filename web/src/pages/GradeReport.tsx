import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GradeResult, Quiz } from '../api';
import GradeSummary from '../components/GradeSummary';
import { EmptyState } from '../components/Feedback';

interface StoredData {
  result: GradeResult;
  quiz: Quiz;
  answers: Record<string, number[]>;
}

export default function GradeReport() {
  const [data, setData] = useState<StoredData | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const raw = sessionStorage.getItem('gradeResult');
    if (raw) {
      try {
        setData(JSON.parse(raw));
      } catch { /* ignore */ }
    }
  }, []);

  if (!data) {
    return (
      <EmptyState
        mood="encouraging"
        title="暂无批改结果"
        hint="先完成一次测验，这里会显示逐题分析。"
        action={
          <button className="btn btn-primary" onClick={() => navigate('/quiz')}>
            去测验
          </button>
        }
      />
    );
  }

  return (
    <div>
      <h2 className="page-title">批改结果</h2>
      <GradeSummary result={data.result} quiz={data.quiz} answers={data.answers} />
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/quiz')}>
        再来一次
      </button>
    </div>
  );
}
