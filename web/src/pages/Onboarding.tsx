import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  onboarding,
  type SourceRecord,
  type ResearchResult,
  type KnowledgeStatus,
  type StudyPlan,
} from '../api';
import Mascot from '../components/Mascot';

type Step = 1 | 2 | 3 | 4;

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Create exam
  const [name, setName] = useState('');
  const [examDate, setExamDate] = useState('');
  const [subjects, setSubjects] = useState('');
  const [dailyMinutes, setDailyMinutes] = useState(60);
  const [baseline, setBaseline] = useState('beginner');
  const [unavailableDates, setUnavailableDates] = useState('');

  // Step 2: Research
  const [research, setResearch] = useState<ResearchResult | null>(null);

  // Step 3: Approve sources
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Step 4: Knowledge + Plan
  const [knowledge, setKnowledge] = useState<KnowledgeStatus | null>(null);
  const [planProposal, setPlanProposal] = useState<StudyPlan | null>(null);

  const parsedUnavailableDates = unavailableDates
    .split(/[\s,，]+/)
    .map((date) => date.trim())
    .filter(Boolean);

  const handleCreateExam = async () => {
    if (!name || !examDate || !subjects) {
      setError('请填写考试名称、日期和科目');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onboarding.createExam({
        name,
        examDate,
        subjects,
        dailyMinutes,
        baseline,
        unavailableDates: parsedUnavailableDates,
      });
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleResearch = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await onboarding.runResearch();
      setResearch(result);
      // Pre-select all sources
      setSelectedIds(new Set(result.sources.map((s) => s.id)));
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleApproveSources = async () => {
    if (selectedIds.size === 0) {
      setError('请至少选择一个来源');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onboarding.approveSources([...selectedIds]);
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleSource = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBuildAndPlan = async () => {
    setLoading(true);
    setError('');
    try {
      if (!knowledge) {
        await onboarding.buildKnowledge();
        const status = await onboarding.getKnowledgeStatus();
        setKnowledge(status);
      }

      const plan = await onboarding.generatePlan(
        examDate,
        dailyMinutes,
        parsedUnavailableDates
      );
      setPlanProposal(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleApprovePlan = async () => {
    setLoading(true);
    setError('');
    try {
      await onboarding.approvePlan();
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const stepLabels = ['创建考试', '搜索调研', '确认来源', '构建知识 & 生成计划'];

  return (
    <div className="onboarding">
      <div className="onboarding-hero">
        <Mascot mood="idle" size={80} />
        <h2 className="page-title">建档向导</h2>
      </div>

      {/* Step indicator */}
      <div className="step-indicator">
        {stepLabels.map((label, i) => (
          <div
            key={i}
            className={`step-pill${step === i + 1 ? ' active' : ''}`}
          >
            {i + 1}. {label}
          </div>
        ))}
      </div>

      {error && (
        <div className="alert alert-error">{error}</div>
      )}

      {/* Step 1: Create Exam */}
      {step === 1 && (
        <div className="form-stack">
          <h3 className="section-title">创建考试项目</h3>
          <div className="form-group">
            <label>考试名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：2026年初级会计资格考试"
            />
          </div>
          <div className="form-group">
            <label>考试日期</label>
            <input
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>科目（逗号分隔）</label>
            <input
              value={subjects}
              onChange={(e) => setSubjects(e.target.value)}
              placeholder="例如：经济学基础, 会计学"
            />
          </div>
          <div className="form-group">
            <label>每日学习时长（分钟）</label>
            <input
              type="number"
              value={dailyMinutes}
              onChange={(e) => setDailyMinutes(Number(e.target.value))}
              min={10}
              max={480}
            />
          </div>
          <div className="form-group">
            <label>基础水平</label>
            <select
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
            >
              <option value="beginner">初学者</option>
              <option value="intermediate">有一定基础</option>
              <option value="advanced">基础扎实</option>
            </select>
          </div>
          <div className="form-group">
            <label>不可学习日期（可选，逗号分隔）</label>
            <input
              value={unavailableDates}
              onChange={(e) => setUnavailableDates(e.target.value)}
              placeholder="例如：2026-08-01, 2026-08-08"
            />
          </div>
          <button className="btn btn-primary" onClick={handleCreateExam} disabled={loading}>
            {loading ? '创建中...' : '创建考试项目'}
          </button>
        </div>
      )}

      {/* Step 2: Research */}
      {step === 2 && (
        <div className="form-stack">
          <h3 className="section-title">搜索调研</h3>
          <p className="muted">系统将根据「{name}」搜索官方大纲、备考经验和推荐资料。</p>
          {research ? (
            <>
              <div className="alert alert-success">
                发现 <strong>{research.sourceCount}</strong> 个来源，使用了 <strong>{research.queryCount}</strong> 个搜索查询。
              </div>
              {research.summary.examFacts && (
                <div className="card">
                  <strong>考试事实：</strong>
                  <p style={{ margin: '4px 0 0' }}>{research.summary.examFacts}</p>
                  <small className="muted">
                    来源：
                    {research.summary.citations?.examFacts.length
                      ? research.summary.citations.examFacts.join(', ')
                      : '无有效引用'}
                  </small>
                </div>
              )}
            </>
          ) : (
            <button className="btn btn-primary" onClick={handleResearch} disabled={loading}>
              {loading ? '调研中（可能需要 10-30 秒）...' : '开始调研'}
            </button>
          )}
          {research && (
            <button className="btn btn-primary" onClick={() => setStep(3)}>
              下一步：确认来源
            </button>
          )}
        </div>
      )}

      {/* Step 3: Approve Sources */}
      {step === 3 && research && (
        <div className="form-stack">
          <h3 className="section-title">确认来源</h3>
          <p className="muted">勾选可信的来源，确认后才会进入知识库。</p>
          <div className="source-list">
            {research.sources.map((source: SourceRecord) => (
              <label
                key={source.id}
                className={`source-item${selectedIds.has(source.id) ? ' selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(source.id)}
                  onChange={() => toggleSource(source.id)}
                />
                <div className="source-body">
                  <div className="source-title">{source.title}</div>
                  <div className="source-meta">
                    [{source.sourceType} | {source.confidenceLevel}]
                  </div>
                  <div className="source-summary">{source.summary}</div>
                  {source.url && (
                    <a href={source.url} target="_blank" rel="noreferrer" className="source-link">
                      {source.url}
                    </a>
                  )}
                </div>
              </label>
            ))}
          </div>
          <div className="action-row">
            <button className="btn btn-outline" onClick={() => setStep(2)}>上一步</button>
            <button className="btn btn-primary" onClick={handleApproveSources} disabled={loading}>
              {loading ? '确认中...' : `确认选中来源 (${selectedIds.size})`}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Build Knowledge + Plan */}
      {step === 4 && (
        <div className="form-stack">
          <h3 className="section-title">构建知识 & 生成计划</h3>
          {knowledge ? (
            <div className="alert alert-success">
              <strong>知识库已构建！</strong>
              <br />
              提取了 <strong>{knowledge.conceptCount}</strong> 个概念。
              {knowledge.concepts.length > 0 && (
                <div className="concept-chips">
                  {knowledge.concepts.slice(0, 8).map((c) => (
                    <span key={c.id} className="badge badge-new">{c.name}</span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="muted">系统将抓取已确认来源的内容，提取概念，然后生成学习计划。</p>
          )}
          {planProposal ? (
            <>
              <div className="alert alert-info">
                <strong>计划待确认</strong>
                <p style={{ margin: '6px 0 0' }}>
                  共 {planProposal.schedule.length} 天，每日上限 {planProposal.dailyMinutes} 分钟，
                  休息/不可用日期 {planProposal.schedule.filter((day) => day.isRest).length} 天。
                </p>
              </div>
              <button className="btn btn-primary" onClick={handleApprovePlan} disabled={loading}>
                {loading ? '确认中...' : '确认计划并开始学习'}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={handleBuildAndPlan} disabled={loading}>
              {loading ? '构建中（可能需要 30-60 秒）...' : knowledge ? '生成计划供确认' : '构建知识 & 生成计划'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
