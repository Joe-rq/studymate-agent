import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GradeResult, Quiz } from '../api';

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
      <div>
        <h2 className="page-title">批改结果</h2>
        <div className="card">
          <p>暂无批改结果，请先完成一次测验。</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/quiz')}>
            去测验
          </button>
        </div>
      </div>
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

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{result.score}</div>
          <div className="stat-label">得分</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{result.correct}/{result.total}</div>
          <div className="stat-label">正确率</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{pct}%</div>
          <div className="stat-label">百分比</div>
        </div>
      </div>

      <h3 style={{ margin: '20px 0 12px', fontSize: '1.1rem' }}>逐题分析</h3>

      {quiz.questions.map((q, i) => {
        const r = result.results[i];
        const userSelected = answers[q.id] ?? [];
        return (
          <div className="card" key={q.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>
                第 {i + 1} 题：{q.stem}
              </span>
              <span className={`badge ${r?.correct ? 'badge-done' : 'badge-skipped'}`}>
                {r?.correct ? '✓ 正确' : '✗ 错误'}
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', marginBottom: 4 }}>
              你的答案：{userSelected.map((s) => String.fromCharCode(65 + s)).join(', ')} | 正确答案：{q.answer.map((a) => String.fromCharCode(65 + a)).join(', ')}
            </p>
            {r?.errorType && (
              <p style={{ fontSize: '0.85rem', color: 'var(--warning)' }}>
                错误类型：{errorLabels[r.errorType] ?? r.errorType}
              </p>
            )}
            {q.explanation && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                解析：{q.explanation}
              </p>
            )}
          </div>
        );
      })}

      {result.weaknessExplanations && Object.keys(result.weaknessExplanations).length > 0 && (
        <>
          <h3 style={{ margin: '20px 0 12px', fontSize: '1.1rem' }}>薄弱知识点</h3>
          {Object.entries(result.weaknessExplanations).map(([nodeId, explanation]) => (
            <div className="card" key={nodeId}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>{nodeId}</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{explanation}</p>
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
