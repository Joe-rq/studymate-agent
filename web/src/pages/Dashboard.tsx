import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type StatusResponse, type BuddyStateResponse, type TodayPlan } from '../api';
import Mascot, { deriveMood } from '../components/Mascot';
import ProgressRing from '../components/ProgressRing';
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

  const character = buddy?.character;
  const mood = deriveMood({
    streakDays: status.streakDays,
    recentScore: status.recentScore,
    hasExam: !!status.exam,
  });

  // No exam project — show onboarding prompt
  if (!status.exam) {
    return (
      <EmptyState
        characterId={character?.id}
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

  const focus = today ? pickFocus(today) : null;
  const doneCount = today ? today.tasks.filter((t) => t.status === 'done').length : 0;
  const totalTasks = today?.tasks.length ?? 0;
  const allDone = totalTasks > 0 && doneCount >= totalTasks;

  // 主 CTA：有 learn/review 任务 → 去今日任务；只剩测验或全完成 → 去测验；无任务 → 去计划
  let ctaTo = '/tasks';
  let ctaLabel = '开始今日学习';
  if (focus && !focus.learnReview) {
    if (allDone) {
      ctaTo = '/quiz';
      ctaLabel = '开始测验巩固';
    } else if (focus.quizOnly) {
      ctaTo = '/quiz';
      ctaLabel = '开始测验';
    } else {
      ctaTo = '/plan';
      ctaLabel = '查看学习计划';
    }
  }

  let focusText: string | null = null;
  if (focus?.learnReview) {
    focusText = null; // 用结构化块展示
  } else if (allDone) {
    focusText = '今日任务已完成，来做一套测验巩固一下吧。';
  } else if (focus?.quizOnly) {
    focusText = '今天的重点只剩测验了，直接开测。';
  } else if (today && today.tasks.length === 0) {
    focusText = '今天还没有安排任务，去看看学习计划。';
  }

  return (
    <div>
      <div className="dashboard-head fade-in-up">
        <div className="dashboard-mascot">
          <Mascot characterId={character?.id} mood={mood} size={88} />
        </div>
        <div>
          <h2 className="page-title">{status.exam.name}</h2>
          <p className="muted">
            {character
              ? `${character.name} 陪你一起备考 · ${character.tagline ?? character.personality}`
              : '加油，今天也是元气满满的一天！'}
          </p>
        </div>
      </div>

      {/* Today Focus */}
      <section className="card today-focus fade-in-up">
        <p className="card-title">今日 Focus</p>
        {focus?.learnReview ? (
          <div className="focus-task">
            <div className="focus-task-name">
              <span className={`badge ${focus.learnReview.type === 'learn' ? 'badge-new' : 'badge-review'}`}>
                {focus.learnReview.type === 'learn' ? '学习' : '复习'}
              </span>
              <span>{focus.learnReview.nodeName}</span>
            </div>
            <p className="focus-task-detail">
              预计 {focus.learnReview.duration} 分钟 · 今天还有 {focus.pendingCount} 项待完成
            </p>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>{focusText}</p>
        )}
      </section>

      {/* 轻量学习进度 */}
      <section className="today-progress fade-in-up">
        <ProgressRing value={status.avgMastery} size={64} stroke={6} />
        <div className="today-progress-text">
          <p className="progress-main">
            今日完成 {doneCount}/{totalTasks} 项
          </p>
          <p className="muted">平均掌握度 {Math.round(status.avgMastery * 100)}%</p>
        </div>
      </section>

      {/* 可解释的 Agent Insight */}
      {insight && (
        <section className="card insight-card fade-in-up">
          <p className="card-title">搭子的观察</p>
          <p className="insight-text">{insight.text}</p>
          <p className="insight-source">{insight.source}</p>
        </section>
      )}

      {/* 主要 CTA */}
      <div className="action-row fade-in-up">
        <button className="btn btn-primary btn-lg" onClick={() => navigate(ctaTo)}>
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
