import type { LLMClient } from '../core/llm.js';
import type { Character } from '../core/character.js';
import type { StudyContext } from '../core/context_reader.js';
import type { BuddyState } from '../domain/buddy.js';

// ── Types ────────────────────────────────────────────────────────────

export type InterventionMoment =
  | 'exam_created'      // 建档
  | 'plan_confirmed'    // 计划确认
  | 'task_start'        // 开始任务
  | 'task_skipped'      // 跳过任务
  | 'streak_milestone'  // 连续完成 (3/7/14 days)
  | 'low_score'         // 低分 (< 50)
  | 'improvement'       // 进步 (mastery up 0.1+)
  | 'exam_approaching'; // 临考 (<= 7 days)

export interface InterventionContext {
  /** Extra data relevant to the moment. */
  score?: number;
  masteryDelta?: number;
  taskId?: string;
  taskNodeName?: string;
  examName?: string;
  planDays?: number;
}

// ── Trigger Rules ────────────────────────────────────────────────────

const STREAK_MILESTONES = [3, 7, 14, 30];

/**
 * Rule-based trigger: should the buddy intervene at this moment?
 * Pure function — no side effects.
 */
export function shouldIntervene(
  moment: InterventionMoment,
  state: BuddyState,
  ctx: StudyContext,
  extra?: InterventionContext
): boolean {
  switch (moment) {
    case 'exam_created':
    case 'plan_confirmed':
      // Always intervene on these milestones
      return true;

    case 'task_start':
      // Intervene on first task of the day or after streak milestone
      return state.streakDays === 0 || STREAK_MILESTONES.includes(state.streakDays);

    case 'task_skipped':
      // Only intervene if reminder intensity is strict or normal
      return state.preferences.reminderIntensity !== 'gentle';

    case 'streak_milestone':
      return STREAK_MILESTONES.includes(state.streakDays);

    case 'low_score':
      return (extra?.score ?? 100) < 50;

    case 'improvement':
      return (extra?.masteryDelta ?? 0) >= 0.1;

    case 'exam_approaching':
      return ctx.daysToExam !== null && ctx.daysToExam <= 7 && ctx.daysToExam > 0;

    default:
      return false;
  }
}

// ── Moment Descriptions ──────────────────────────────────────────────

function momentDescription(moment: InterventionMoment, extra?: InterventionContext, ctx?: StudyContext): string {
  switch (moment) {
    case 'exam_created':
      return `学生刚创建了考试项目「${extra?.examName ?? '新考试'}」的备考档案`;
    case 'plan_confirmed':
      return `学生刚确认了 ${extra?.planDays ?? ''} 天的学习计划`;
    case 'task_start':
      return `学生准备开始今天的学习任务${extra?.taskNodeName ? `：${extra.taskNodeName}` : ''}`;
    case 'task_skipped':
      return `学生跳过了一个任务${extra?.taskNodeName ? `：${extra.taskNodeName}` : ''}`;
    case 'streak_milestone':
      return `学生已经连续学习 ${extra?.score ?? 0} 天了`;
    case 'low_score':
      return `学生刚批改完测验，得分只有 ${extra?.score ?? 0}/100`;
    case 'improvement':
      return `学生的掌握度提升了 ${((extra?.masteryDelta ?? 0) * 100).toFixed(0)} 个百分点`;
    case 'exam_approaching':
      return `距离考试只剩 ${ctx?.daysToExam ?? 7} 天了`;
    default:
      return '学生正在学习';
  }
}

// ── Memory Recall ────────────────────────────────────────────────────

function buildMemoryBlock(state: BuddyState): string {
  const parts: string[] = [];

  // Recent memories (last 3)
  const recentMemories = state.memories.slice(-3);
  if (recentMemories.length > 0) {
    parts.push('【近期重要记忆】');
    for (const m of recentMemories) {
      parts.push(`- [${m.date}] ${m.content}`);
    }
  }

  // Unfulfilled commitments
  const pending = state.commitments.filter((c) => !c.fulfilled);
  if (pending.length > 0) {
    parts.push('【未完成的承诺】');
    for (const c of pending.slice(-3)) {
      parts.push(`- ${c.text}（${c.date}）`);
    }
  }

  return parts.join('\n');
}

// ── Generation ───────────────────────────────────────────────────────

/**
 * Generate an in-character intervention line for the given moment.
 * References real learning state — never fabricates data.
 */
export async function generateIntervention(
  moment: InterventionMoment,
  character: Character,
  state: BuddyState,
  ctx: StudyContext,
  llm: LLMClient,
  extra?: InterventionContext
): Promise<string> {
  const persona = [
    `【你的角色】`,
    `名字：${character.name}`,
    `性格：${character.personality}`,
    `说话风格：${character.speechStyle}`,
    `称呼对方：${state.preferences.formOfAddress ?? character.formOfAddress}`,
    `自称：${character.selfAddress}`,
    `口头禅（选其一自然使用）：${character.catchphrases.join(' / ')}`,
    `情感风格：${state.preferences.emotionalStyle}`,
    `关系等级：${state.relationshipLevel}/100`,
  ].join('\n');

  const ctxLines: string[] = [];
  if (ctx.daysToExam !== null) ctxLines.push(`距考试还有 ${ctx.daysToExam} 天`);
  if (ctx.avgMastery > 0) ctxLines.push(`整体掌握度 ${(ctx.avgMastery * 100).toFixed(0)}%`);
  if (ctx.weakNodeNames.length > 0) ctxLines.push(`薄弱知识点：${ctx.weakNodeNames.join('、')}`);
  if (ctx.recentScore !== null) ctxLines.push(`最近测验得分 ${ctx.recentScore}/100`);
  if (state.streakDays > 0) ctxLines.push(`连续学习 ${state.streakDays} 天`);

  const contextBlock = ctxLines.length > 0
    ? `【学生当前情境】\n${ctxLines.join('\n')}`
    : '【学生当前情境】\n（暂无学习数据）';

  const memoryBlock = buildMemoryBlock(state);
  const momentDesc = momentDescription(moment, extra, ctx);

  const user = [
    persona,
    contextBlock,
    memoryBlock,
    `【当前时刻】${momentDesc}`,
    `请用你的语气说一句简短的话（30 字以内），回应这个时刻。必须基于上述真实数据，不要编造。`,
  ].filter(Boolean).join('\n\n');

  const system = `You are a study companion (备考搭子). Speak in character, in Chinese, 1-2 sentences. Return JSON: { "reply": "..." }. Respond with JSON only.`;

  try {
    const result = await llm.completeJSON<{ reply: string }>(system, user, {
      temperature: 0.9,
      retries: 1,
    });
    return result.reply ?? '';
  } catch {
    return '';
  }
}
