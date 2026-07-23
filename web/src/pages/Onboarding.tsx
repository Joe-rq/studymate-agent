import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onboarding, type SourceRecord, type ResearchResult, type KnowledgeStatus } from '../api';

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

  // Step 2: Research
  const [research, setResearch] = useState<ResearchResult | null>(null);

  // Step 3: Approve sources
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Step 4: Knowledge + Plan
  const [knowledge, setKnowledge] = useState<KnowledgeStatus | null>(null);

  const handleCreateExam = async () => {
    if (!name || !examDate || !subjects) {
      setError('请填写考试名称、日期和科目');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onboarding.createExam({ name, examDate, subjects, dailyMinutes, baseline });
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
      // Build knowledge from approved sources
      await onboarding.buildKnowledge();
      const status = await onboarding.getKnowledgeStatus();
      setKnowledge(status);

      // Generate plan
      await onboarding.generatePlan(examDate, dailyMinutes);

      // Done — go to dashboard
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const stepLabels = ['创建考试', '搜索调研', '确认来源', '构建知识 & 生成计划'];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h2 className="page-title">建档向导</h2>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {stepLabels.map((label, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '8px 4px',
              borderRadius: 6,
              background: step === i + 1 ? 'var(--primary, #4f46e5)' : '#e5e7eb',
              color: step === i + 1 ? '#fff' : '#6b7280',
              fontWeight: step === i + 1 ? 600 : 400,
              fontSize: 13,
            }}
          >
            {i + 1}. {label}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Step 1: Create Exam */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3>创建考试项目</h3>
          <label>
            考试名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：2026年初级会计资格考试"
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            />
          </label>
          <label>
            考试日期
            <input
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            />
          </label>
          <label>
            科目（逗号分隔）
            <input
              value={subjects}
              onChange={(e) => setSubjects(e.target.value)}
              placeholder="例如：经济学基础, 会计学"
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            />
          </label>
          <label>
            每日学习时长（分钟）
            <input
              type="number"
              value={dailyMinutes}
              onChange={(e) => setDailyMinutes(Number(e.target.value))}
              min={10}
              max={480}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            />
          </label>
          <label>
            基础水平
            <select
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            >
              <option value="beginner">初学者</option>
              <option value="intermediate">有一定基础</option>
              <option value="advanced">基础扎实</option>
            </select>
          </label>
          <button className="btn btn-primary" onClick={handleCreateExam} disabled={loading}>
            {loading ? '创建中...' : '创建考试项目'}
          </button>
        </div>
      )}

      {/* Step 2: Research */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3>搜索调研</h3>
          <p>系统将根据「{name}」搜索官方大纲、备考经验和推荐资料。</p>
          {research ? (
            <>
              <div style={{ padding: 12, background: '#f0fdf4', borderRadius: 6 }}>
                发现 <strong>{research.sourceCount}</strong> 个来源，使用了 <strong>{research.queryCount}</strong> 个搜索查询。
              </div>
              {research.summary.examFacts && (
                <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6 }}>
                  <strong>考试事实：</strong>
                  <p style={{ margin: '4px 0 0' }}>{research.summary.examFacts}</p>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3>确认来源</h3>
          <p>勾选可信的来源，确认后才会进入知识库。</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {research.sources.map((source: SourceRecord) => (
              <label
                key={source.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: 12,
                  borderRadius: 6,
                  border: selectedIds.has(source.id) ? '2px solid var(--primary, #4f46e5)' : '1px solid #e5e7eb',
                  cursor: 'pointer',
                  alignItems: 'flex-start',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(source.id)}
                  onChange={() => toggleSource(source.id)}
                  style={{ marginTop: 2 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{source.title}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    [{source.sourceType} | {source.confidenceLevel}]
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{source.summary}</div>
                  {source.url && (
                    <a href={source.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>
                      {source.url}
                    </a>
                  )}
                </div>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={() => setStep(2)}>上一步</button>
            <button className="btn btn-primary" onClick={handleApproveSources} disabled={loading}>
              {loading ? '确认中...' : `确认选中来源 (${selectedIds.size})`}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Build Knowledge + Plan */}
      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3>构建知识 & 生成计划</h3>
          {knowledge ? (
            <div style={{ padding: 12, background: '#f0fdf4', borderRadius: 6 }}>
              <strong>知识库已构建！</strong>
              <br />
              提取了 <strong>{knowledge.conceptCount}</strong> 个概念。
              {knowledge.concepts.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {knowledge.concepts.slice(0, 8).map((c) => (
                    <span
                      key={c.id}
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        margin: '2px 4px',
                        background: '#e0e7ff',
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p>系统将抓取已确认来源的内容，提取概念，然后生成学习计划。</p>
          )}
          <button className="btn btn-primary" onClick={handleBuildAndPlan} disabled={loading}>
            {loading ? '构建中（可能需要 30-60 秒）...' : knowledge ? '生成计划并开始学习' : '构建知识 & 生成计划'}
          </button>
        </div>
      )}
    </div>
  );
}
