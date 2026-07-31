import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GradeResult, Quiz } from '../api';
import ProgressRing from '../components/ProgressRing';
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

  const { result, quiz, answers } = data;
  const pct = result.total > 0 ? Math.round((result.correct / result.total) * 100) : 0;

  const errorLabels: Record<string, string> = {
    concept_unclear: '概念不清',
    memory_fuzzy: '记忆模糊',
    careless: '粗心',
    multi_partial: '多选部分正确',
  };

  return (
    <div>
      <h2 className="page-title">批改结果</h2>

      <div className="card fade-in-up">
        <div className="ring-row">
          <ProgressRing
            value={result.score / 100}
            size={120}
            stroke={10}
            suffix="分"
            displayValue={result.score}
          />
          <div>
            <p className="row-title">正确 {result.correct} / {result.total}</p>
            <p className="row-detail muted">正确率 {pct}%</p>
            <p className="row-detail muted" style={{ marginTop: 4 }}>
              {pct >= 80 ? '很棒，继续保持！' : pct >= 60 ? '不错，错题再巩固一下。' : '别灰心，把错题吃透就是进步。'}
            </p>
          </div>
        </div>
      </div>

      <h3 className="section-title">逐题分析</h3>

      {quiz.questions.map((q, i) => {
        const r = result.results[i];
        const userSelected = answers[q.id] ?? [];
        return (
          <div className="card stagger" key={q.id} style={{ ['--i' as string]: i }}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="row-title">
                第 {i + 1} 题：{q.stem}
              </span>
              <span className={`badge ${r?.correct ? 'badge-done' : 'badge-skipped'}`}>
                {r?.correct ? '✓ 正确' : '✗ 错误'}
              </span>
            </div>
            <p className="row-detail" style={{ marginBottom: 4 }}>
              你的答案：{userSelected.map((s) => String.fromCharCode(65 + s)).join(', ')} | 正确答案：{q.answer.map((a) => String.fromCharCode(65 + a)).join(', ')}
            </p>
            {r?.errorType && (
              <p className="row-detail warning-text">
                错误类型：{errorLabels[r.errorType] ?? r.errorType}
              </p>
            )}
            {q.explanation && (
              <p className="row-detail muted" style={{ marginTop: 4 }}>
                解析：{q.explanation}
              </p>
            )}
          </div>
        );
      })}

      {result.weaknessExplanations && Object.keys(result.weaknessExplanations).length > 0 && (
        <>
          <h3 className="section-title">薄弱知识点</h3>
          {Object.entries(result.weaknessExplanations).map(([nodeId, explanation], i) => (
            <div className="card stagger" key={nodeId} style={{ ['--i' as string]: i }}>
              <p className="row-title" style={{ marginBottom: 4 }}>{nodeId}</p>
              <p className="row-detail muted">{explanation}</p>
            </div>
          ))}
        </>
      )}

      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/quiz')}>
        再来一次
      </button>
    </div>
  );
}
