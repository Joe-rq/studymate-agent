import { useEffect, useState } from 'react';
import { api, type Quiz, type GradeResult } from '../api';
import QuizCard from './QuizCard';
import { Loading, EmptyState } from './Feedback';

export interface GradedPayload {
  result: GradeResult;
  quiz: Quiz;
  answers: Record<string, number[]>;
}

interface Props {
  /** 提交批改完成后的回调（QuizPage 存 sessionStorage + 跳转；StudioPage 推进阶段）。 */
  onGraded: (payload: GradedPayload) => void;
}

/**
 * 测验核心：加载/生成 → 答题 → 提交批改。
 * QuizPage 与 StudioPage 的测验阶段共用。
 */
export default function QuizRunner({ onGraded }: Props) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<Quiz | null>('/quiz/today')
      .then((q) => {
        setQuiz(q);
        setLoading(false);
      })
      .catch(() => setLoading(false));
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
      const result = await api.post<GradeResult>('/grade', { answers: userAnswers });
      onGraded({ result, quiz, answers });
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  if (loading) return <Loading />;

  if (!quiz) {
    return (
      <EmptyState
        mood="thinking"
        title="今天还没有测验"
        hint="点下方按钮，搭子帮你出一份练习。"
        action={
          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? '生成中...' : '生成测验'}
          </button>
        }
      />
    );
  }

  const answeredCount = quiz.questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16 }}>
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
