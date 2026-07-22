import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Quiz } from '../api';
import QuizCard from '../components/QuizCard';

export default function QuizPage() {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<Quiz | null>('/quiz/today').then((q) => {
      setQuiz(q);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const q = await api.post<Quiz>('/quiz/generate', { count: 5, allowMulti: true });
      setQuiz(q);
    } catch { /* ignore */ }
    setGenerating(false);
  };

  const handleSelect = (questionId: string, optionIndex: number, isMulti: boolean) => {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      if (isMulti) {
        const idx = current.indexOf(optionIndex);
        if (idx >= 0) {
          return { ...prev, [questionId]: current.filter((i) => i !== optionIndex) };
        }
        return { ...prev, [questionId]: [...current, optionIndex] };
      }
      return { ...prev, [questionId]: [optionIndex] };
    });
  };

  const handleSubmit = async () => {
    if (!quiz) return;
    setSubmitting(true);
    const userAnswers = quiz.questions.map((q) => ({
      questionId: q.id,
      selected: answers[q.id] ?? [],
    }));
    try {
      const result = await api.post('/grade', { answers: userAnswers });
      // Store result in sessionStorage for GradeReport page
      sessionStorage.setItem('gradeResult', JSON.stringify({ result, quiz, answers }));
      navigate('/grade');
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  if (loading) return <p>加载中...</p>;

  if (!quiz) {
    return (
      <div>
        <h2 className="page-title">测验</h2>
        <div className="card">
          <p style={{ marginBottom: 16 }}>今天还没有测验，点击下方按钮生成一份。</p>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? '生成中...' : '生成测验'}
          </button>
        </div>
      </div>
    );
  }

  const answeredCount = quiz.questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length;

  return (
    <div>
      <h2 className="page-title">测验</h2>
      <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
        已答 {answeredCount}/{quiz.questions.length} 题
      </p>

      {quiz.questions.map((q, i) => (
        <QuizCard
          key={q.id}
          question={q}
          index={i}
          selected={answers[q.id] ?? []}
          onSelect={(opt) => handleSelect(q.id, opt, q.type === 'multi_choice')}
        />
      ))}

      <div style={{ marginTop: 16 }}>
        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={answeredCount < quiz.questions.length || submitting}
        >
          {submitting ? '提交中...' : `提交答案（${answeredCount}/${quiz.questions.length}）`}
        </button>
      </div>
    </div>
  );
}
