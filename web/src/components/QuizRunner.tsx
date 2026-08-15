import { useEffect, useState } from 'react';
import { api, type Quiz, type GradeResult, type StudioResponse } from '../api';
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
  /** Studio 模式：Quiz 由服务端按当前 Session 生成并绑定 sessionId，批改走 /studio/grade。 */
  studio?: {
    onAdvanced: (data: StudioResponse) => void;
  };
}

/**
 * 测验核心：加载/生成 → 答题 → 提交批改。
 * QuizPage（全局每日测验）与 StudioPage 的测验阶段共用。
 * Studio 模式下前端只提交 sessionId、quizId 和答案——成绩由服务端批改产生。
 */
export default function QuizRunner({ onGraded, studio }: Props) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (studio) {
      // Session 绑定出题（幂等：已生成则直接返回）
      api.post<Quiz>('/studio/quiz', {})
        .then((q) => {
          setQuiz(q);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      api.get<Quiz | null>('/quiz/today')
        .then((q) => {
          setQuiz(q);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [studio]);

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
      answer: answers[q.id] ?? [],
    }));
    try {
      if (studio && quiz.sessionId) {
        // 服务端原子批改：批改 → 错题 → 掌握度 → 计划调整 → Session 推进
        const res = await api.post<StudioResponse & { grade: GradeResult }>('/studio/grade', {
          sessionId: quiz.sessionId,
          quizId: quiz.id,
          answers: userAnswers,
        });
        onGraded({ result: res.grade, quiz, answers });
        studio.onAdvanced(res);
      } else {
        const result = await api.post<GradeResult>('/grade', { answers: userAnswers });
        onGraded({ result, quiz, answers });
      }
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  if (loading) return <Loading />;

  if (!quiz) {
    return (
      <EmptyState
        mood="thinking"
        title="测验生成失败"
        hint={studio ? '当前概念缺少可用材料，稍后再试或直接跳过测验。' : '点下方按钮，搭子帮你出一份练习。'}
        action={
          !studio ? (
            <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
              {generating ? '生成中...' : '生成测验'}
            </button>
          ) : undefined
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
