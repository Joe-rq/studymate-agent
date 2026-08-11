import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type StudioResponse, type ExplainResult } from '../api';
import QuizRunner, { type GradedPayload } from '../components/QuizRunner';
import GradeSummary from '../components/GradeSummary';
import { Loading, ErrorState } from '../components/Feedback';

const STUDIO_GRADE_KEY = 'studioGrade';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

/**
 * 学习闭环：学习材料 → Recall → Quiz → Feedback → Reflect。
 * 后端 session 是唯一事实源，每次动作后用响应覆盖本地，刷新可恢复。
 */
export default function StudioPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<StudioResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [explanation, setExplanation] = useState<ExplainResult | null>(null);
  const [recallRevealed, setRecallRevealed] = useState(false);
  const [gradePayload, setGradePayload] = useState<GradedPayload | null>(null);

  // 恢复批改详情（feedback 阶段刷新后仍可见逐题分析）
  useEffect(() => {
    const raw = sessionStorage.getItem(STUDIO_GRADE_KEY);
    if (raw) {
      try {
        setGradePayload(JSON.parse(raw));
      } catch { /* ignore */ }
    }
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api.get<StudioResponse>('/studio')
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<StudioResponse>) => {
    setBusy(true);
    try {
      const d = await fn();
      setData(d);
      setExplanation(null);
      setRecallRevealed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (loading || !data) return <Loading />;

  // ── Launcher（无 session）───────────────────────────────────────
  if (!data.session) {
    return (
      <div>
        <h2 className="page-title">学习闭环</h2>
        {data.candidates.length > 0 ? (
          <div className="card fade-in-up">
            <p className="card-title">今日学习</p>
            <div className="focus-task">
              <div className="focus-task-name">
                <span className={`badge ${data.candidates[0].type === 'learn' ? 'badge-new' : 'badge-review'}`}>
                  {data.candidates[0].type === 'learn' ? '学习' : '复习'}
                </span>
                <span>{data.candidates[0].nodeName}</span>
              </div>
              <p className="focus-task-detail">预计 {data.candidates[0].duration} 分钟</p>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.post('/studio/start', {}))}>
                开始学习
              </button>
            </div>
          </div>
        ) : data.quizOnly ? (
          <div className="card fade-in-up">
            <p className="card-title">今天只剩测验</p>
            <p className="muted" style={{ margin: 0 }}>先测一套，测完搭子帮你复盘。</p>
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.post('/studio/start', {}))}>
                开始测验
              </button>
            </div>
          </div>
        ) : (
          <div className="card fade-in-up">
            <p className="muted" style={{ margin: 0 }}>{data.message}</p>
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-outline" onClick={() => navigate('/plan')}>查看学习计划</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const current = data.session;
  const focus = data.focus;
  const nodeName = data.currentTask?.nodeName ?? '';

  // ── Focus（学习材料 + AI 解释）────────────────────────────────
  if (current.stage === 'focus') {
    const handleExplain = () => {
      if (!data.currentTask?.nodeId) return;
      api.post<ExplainResult>('/studio/explain', { conceptId: data.currentTask.nodeId })
        .then(setExplanation)
        .catch(() => setExplanation({ explanation: null, refChunkIds: [], degraded: true }));
    };

    return (
      <div>
        <h2 className="page-title">学习材料</h2>
        {focus?.concept && (
          <div className="card fade-in-up">
            <p className="card-title">概念 · {focus.concept.name}</p>
            <p style={{ fontSize: '0.95rem', lineHeight: 1.7, margin: 0 }}>{focus.concept.definition}</p>
          </div>
        )}
        {focus?.chunks.map((chunk) => (
          <div className="card fade-in-up" key={chunk.id}>
            <p className="card-title">{chunk.title}</p>
            <pre className="chunk-content">{chunk.content}</pre>
          </div>
        ))}
        {(!focus || (!focus.concept && focus.chunks.length === 0)) && (
          <div className="card fade-in-up">
            <p className="muted" style={{ margin: 0 }}>暂无材料，读完定义后直接进入回忆。</p>
          </div>
        )}

        <div style={{ margin: '16px 0' }}>
          <button className="btn btn-outline" onClick={handleExplain}>
            让搭子讲解这个概念
          </button>
          {explanation && !explanation.degraded && explanation.explanation && (
            <div className="card" style={{ marginTop: 12 }}>
              <p className="card-title">搭子的讲解</p>
              <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{explanation.explanation}</p>
              {explanation.refChunkIds.length > 0 && (
                <p className="row-detail muted">依据原文：{explanation.refChunkIds.join('、')}</p>
              )}
            </div>
          )}
          {explanation?.degraded && (
            <p className="muted" style={{ marginTop: 8 }}>讲解暂不可用，继续阅读原文即可。</p>
          )}
        </div>

        <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.post('/studio/advance', { fromStage: 'focus' }))}>
          已完成阅读，进入回忆
        </button>
      </div>
    );
  }

  // ── Recall（主动回忆）─────────────────────────────────────────
  if (current.stage === 'recall') {
    return (
      <div>
        <h2 className="page-title">回忆一下</h2>
        <div className="card fade-in-up">
          <p className="card-title">用自己的话解释「{nodeName}」</p>
          <p className="muted" style={{ margin: 0 }}>先在心里复述一遍，再展开答案对照。</p>
          <div style={{ marginTop: 16 }}>
            {!recallRevealed ? (
              <button className="btn btn-outline" onClick={() => setRecallRevealed(true)}>我回忆好了，看看答案</button>
            ) : (
              <div>
                {focus?.concept && (
                  <p style={{ margin: '0 0 12px', lineHeight: 1.7 }}>{focus.concept.definition}</p>
                )}
                {focus?.chunks.map((chunk) => (
                  <p key={chunk.id} className="row-detail muted" style={{ marginBottom: 6 }}>
                    · {chunk.content}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button
            className="btn btn-primary"
            disabled={busy || !recallRevealed}
            onClick={() => act(() => api.post('/studio/advance', { fromStage: 'recall' }))}
          >
            进入测验
          </button>
        </div>
      </div>
    );
  }

  // ── Quiz（复用测验核心）───────────────────────────────────────
  if (current.stage === 'quiz') {
    return (
      <div>
        <h2 className="page-title">测验 · {nodeName}</h2>
        <QuizRunner
          onGraded={({ result, quiz, answers }) => {
            const payload: GradedPayload = { result, quiz, answers };
            sessionStorage.setItem(STUDIO_GRADE_KEY, JSON.stringify(payload));
            setGradePayload(payload);
            act(() =>
              api.post('/studio/advance', {
                fromStage: 'quiz',
                grade: {
                  score: result.score,
                  total: result.total,
                  correct: result.correct,
                  correlationId: result.correlationId,
                },
                masteryChanges: result.masteryChanges,
              })
            );
          }}
        />
      </div>
    );
  }

  // ── Feedback（复用批改展示）───────────────────────────────────
  if (current.stage === 'feedback') {
    return (
      <div>
        <h2 className="page-title">反馈</h2>
        {gradePayload ? (
          <GradeSummary result={gradePayload.result} quiz={gradePayload.quiz} answers={gradePayload.answers} />
        ) : (
          <div className="card fade-in-up">
            <p className="muted" style={{ margin: 0 }}>本次测验已批改完成，逐题分析见同会话反馈。</p>
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.post('/studio/advance', { fromStage: 'feedback' }))}>
            查看复盘
          </button>
        </div>
      </div>
    );
  }

  // ── Reflect（复盘 + 明日首项）─────────────────────────────────
  if (current.stage === 'reflect' || current.stage === 'completed') {
    const summary = data.reflect?.summary;
    const accuracy = Math.round((summary?.accuracy ?? 0) * 100);
    return (
      <div>
        <h2 className="page-title">今日复盘</h2>
        <div className="card fade-in-up">
          <div className="stats-grid-2">
            <div><b>{formatDuration(summary?.durationSeconds ?? 0)}</b><span>专注时间</span></div>
            <div><b>{summary?.knowledgePoints ?? 0}</b><span>知识点</span></div>
            <div><b>{summary?.answeredQuestions ?? 0}</b><span>答题</span></div>
            <div><b>{accuracy}%</b><span>正确率</span></div>
          </div>
        </div>
        {summary?.masteryChanges && summary.masteryChanges.length > 0 && (
          <div className="card fade-in-up">
            <p className="card-title">掌握度变化</p>
            {summary.masteryChanges.map((m) => {
              const delta = m.newMastery - m.oldMastery;
              return (
                <div key={m.nodeId} className="row-between" style={{ padding: '8px 0' }}>
                  <span className="row-title">{m.nodeName ?? m.nodeId}</span>
                  <span className="row-detail">
                    {Math.round(m.oldMastery * 100)}% → {Math.round(m.newMastery * 100)}%{' '}
                    <em className={delta >= 0 ? 'delta-up' : 'delta-down'}>
                      {delta >= 0 ? '+' : ''}
                      {Math.round(delta * 100)}%
                    </em>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {data.reflect?.nextFirstTask && (
          <div className="card fade-in-up">
            <p className="card-title">明天从这里开始</p>
            <p style={{ margin: 0 }}>
              {data.reflect.nextFirstTask.nodeName} · 预计 {data.reflect.nextFirstTask.duration} 分钟
            </p>
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          {current.stage === 'reflect' ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.post('/studio/complete', {}))}>
              完成本次学习
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate('/')}>回首页</button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
