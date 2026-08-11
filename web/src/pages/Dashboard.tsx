import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type StatusResponse, type BuddyStateResponse, type TodayPlan } from '../api';
import { ROLE_LINES } from '../lib/roleLines';
import { SkeletonGrid, EmptyState, ErrorState } from '../components/Feedback';

interface LearnerInsightsResponse {
  insights: Array<{ id: string; date: string; type: string; content: string; confidence: number }>;
}

interface Insight {
  text: string;
  source: string;
}

const INSIGHT_SOURCE: Record<string, string> = {
  strength: '优势洞察',
  weakness: '薄弱点洞察',
  pattern: '学习规律',
  recommendation: '行动建议',
};

/** 选一条可解释的 Agent Insight：优先最新学习洞察，其次最近测验得分，最后通用文案。 */
function pickInsight(
  insights: LearnerInsightsResponse['insights'],
  status: StatusResponse
): Insight {
  if (insights.length > 0) {
    const latest = insights[insights.length - 1];
    return {
      text: latest.content,
      source: INSIGHT_SOURCE[latest.type] ?? '学习洞察',
    };
  }
  if (status.recentScore !== null) {
    return {
      text: `最近一次测验得分 ${status.recentScore}/100。`,
      source: '最近测验',
    };
  }
  return {
    text: '完成学习和测验后，搭子会帮你总结学习规律与薄弱点。',
    source: '学习洞察',
  };
}

/** 从今日任务里找 Focus：第一个未完成的 learn/review 任务；只剩 quiz 时直接进入测验阶段。 */
function pickFocus(today: TodayPlan) {
  const pending = today.tasks.filter((t) => t.status === 'pending');
  const learnReview = pending.find((t) => t.type === 'learn' || t.type === 'review') ?? null;
  const quizOnly = pending.length > 0 && pending.every((t) => t.type === 'quiz');
  return { learnReview, quizOnly, pendingCount: pending.length };
}

/** 按时段生成大字问候。 */
function greeting(hasFocus: boolean): string {
  const h = new Date().getHours();
  const part = h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
  return hasFocus
    ? `${part}，先把今天最重要的一节学完。`
    : `${part}，今天任务都完成了，做套测验巩固吧。`;
}

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [buddy, setBuddy] = useState<BuddyStateResponse | null>(null);
  const [today, setToday] = useState<TodayPlan | null>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    setError('');
    setStatus(null);
    Promise.all([
      api.get<StatusResponse>('/status'),
      api.get<BuddyStateResponse>('/buddy/state'),
      api.get<TodayPlan>('/plan/today'),
      api.get<LearnerInsightsResponse>('/learner/insights'),
    ])
      .then(([s, b, t, i]) => {
        setStatus(s);
        setBuddy(b);
        setToday(t);
        setInsight(pickInsight(i.insights, s));
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!status) return <SkeletonGrid count={3} />;

  // No exam project — show onboarding prompt
  if (!status.exam) {
    return (
      <EmptyState
        characterId={buddy?.character?.id}
        mood="waiting"
        title="还没有考试项目"
        hint="创建你的第一个考试项目，搭子会陪你一起备考。"
        action={
          <button className="btn btn-primary" onClick={() => navigate('/onboarding')}>
            创建考试项目
          </button>
        }
      />
    );
  }

  const roleLines = ROLE_LINES[buddy?.character?.id ?? ''] ?? ROLE_LINES.tuanzi;
  const focus = today ? pickFocus(today) : null;
  const doneCount = today ? today.tasks.filter((t) => t.status === 'done').length : 0;
  const totalTasks = today?.tasks.length ?? 0;
  const allDone = totalTasks > 0 && doneCount >= totalTasks;
  const totalMinutes = today?.tasks.reduce((s, t) => s + t.duration, 0) ?? 0;

  // 主 CTA：有 learn/review 任务 → 去今日任务；只剩测验或全完成 → 去测验；无任务 → 去计划
  let ctaTo = '/studio';
  let ctaLabel = '继续学习';
  if (focus && !focus.learnReview) {
    if (allDone) {
      ctaTo = '/studio';
      ctaLabel = '开始测验巩固';
    } else if (focus.quizOnly) {
      ctaTo = '/studio';
      ctaLabel = '开始测验';
    } else {
      ctaTo = '/plan';
      ctaLabel = '查看学习计划';
    }
  }

  const progressPct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;
  const focusTitle = focus?.learnReview?.nodeName
    ?? (allDone ? '今日任务已完成' : focus?.quizOnly ? '只剩一套测验' : '今天还没有安排任务');
  const focusSub = focus?.learnReview
    ? `预计 ${focus.learnReview.duration} 分钟 · 今天还有 ${focus.pendingCount} 项待完成`
    : allDone
      ? '来做套测验，把今天的掌握度巩固下来。'
      : focus?.quizOnly
        ? '直接开测，测完搭子帮你复盘。'
        : '去生成学习计划，搭子会帮你排好每天的内容。';

  return (
    <div>
      {/* 顶部：空间名 + 大字问候 + 考试标签 */}
      <div className="lobby-header fade-in-up">
        <div>
          <div className="eyebrow">{roleLines.label}</div>
          <h1 className="lobby-title">{greeting(!!focus?.learnReview)}</h1>
          <p className="muted">今日约 {totalMinutes} 分钟 · 距离考试还有 {status.daysToExam} 天</p>
        </div>
        <div className="exam-chip">{status.exam.name}</div>
      </div>

      {/* Today Focus 大卡 */}
      <section className="card lobby-hero fade-in-up">
        <div className="kicker">TODAY FOCUS</div>
        <h2>{focusTitle}</h2>
        <p className="sub">{focusSub}</p>
        <div className="hero-actions">
          <div className="progress">
            <i style={{ width: `${progressPct}%` }} />
          </div>
          <strong>{doneCount} / {totalTasks}</strong>
          <button className="btn btn-primary btn-lg" onClick={() => navigate(ctaTo)}>
            {ctaLabel} →
          </button>
        </div>
      </section>

      {/* 紧凑统计 */}
      <div className="lobby-stats fade-in-up">
        <div className="stat">
          <b>{Math.round(status.avgMastery * 100)}%</b>
          <span>平均掌握度</span>
        </div>
        <div className="stat">
          <b>{status.streakDays} 天</b>
          <span>连续学习</span>
        </div>
        <div className="stat">
          <b>{status.recentScore ?? '--'}</b>
          <span>最近测验</span>
        </div>
        <div className="stat">
          <b>{status.daysToExam} 天</b>
          <span>距离考试</span>
        </div>
      </div>

      {/* 下方：今日任务 + 搭子观察 */}
      <div className="lobby-lower fade-in-up">
        <section className="card lobby-tasks">
          <div className="card-head">
            <h3>今天</h3>
            <span>{allDone ? '全部完成' : `剩余 ${totalTasks - doneCount} 项`}</span>
          </div>
          {today && today.tasks.length > 0 ? (
            today.tasks.slice(0, 4).map((task) => (
              <div key={task.id} className="task">
                <span className={`check${task.status === 'done' ? ' done' : ''}`}>
                  {task.status === 'done' ? '✓' : ''}
                </span>
                <div>
                  <strong>{task.nodeName}</strong>
                  <small>
                    {task.status === 'done' ? '已完成' : task.status === 'skipped' ? '已跳过' : '待完成'}
                  </small>
                </div>
                <em>{task.duration}m</em>
              </div>
            ))
          ) : (
            <p className="muted" style={{ margin: 0 }}>今天还没有安排任务。</p>
          )}
        </section>

        {insight && (
          <section className="card lobby-insight">
            <div className="insight-icon">✦</div>
            <h3>搭子的观察</h3>
            <p>{insight.text}</p>
            <div className="link">{insight.source}</div>
          </section>
        )}
      </div>
    </div>
  );
}
