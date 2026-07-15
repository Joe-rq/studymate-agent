import fs from 'fs/promises';
import path from 'path';
import type { LLMClient } from '../core/llm.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths, PROMPTS_SOURCE } from '../core/paths.js';
import type { Character } from '../core/character.js';
import type { StudyContext } from '../core/context_reader.js';

/** 搭子对话的单条历史记录。 */
export interface ChatTurn {
  role: 'user' | 'buddy';
  content: string;
  timestamp: string;
}

/** LLM 返回的对话结构。 */
interface BuddyReply {
  reply: string;
}

/** 关键时刻台词的事件类型。 */
export type InterjectEvent = 'today' | 'quiz' | 'grade';

const PROMPT_FILE = 'buddy_dialogue.txt';
const FALLBACK_SYSTEM = `You are a study companion (备考搭子). Speak in character, in Chinese, 1-3 sentences. Return JSON: { "reply": "..." }. Respond with JSON only, no markdown fences.`;

/** 加载搭子系统提示，失败则用内联 fallback（沿用现有 agent 约定）。 */
async function loadSystemPrompt(): Promise<string> {
  try {
    return await fs.readFile(path.join(PROMPTS_SOURCE, PROMPT_FILE), 'utf-8');
  } catch {
    return FALLBACK_SYSTEM;
  }
}

/** 把角色人设 + 情境拼成结构化的 user 消息上下文。 */
function buildPersonaBlock(character: Character, ctx: StudyContext, history: ChatTurn[]): string {
  const ctxLines: string[] = [];
  if (ctx.daysToExam !== null) {
    ctxLines.push(`距考试还有 ${ctx.daysToExam} 天`);
  }
  if (ctx.avgMastery > 0) {
    ctxLines.push(`整体掌握度 ${(ctx.avgMastery * 100).toFixed(0)}%`);
  }
  if (ctx.weakNodeNames.length > 0) {
    ctxLines.push(`薄弱知识点：${ctx.weakNodeNames.join('、')}`);
  }
  if (ctx.recentScore !== null) {
    ctxLines.push(`最近测验得分 ${ctx.recentScore}/100`);
  }
  if (ctx.tasksToday > 0) {
    ctxLines.push(`今日任务 ${ctx.tasksToday} 项`);
  }

  const persona = [
    `【你的角色】`,
    `名字：${character.name}`,
    `性格：${character.personality}`,
    `说话风格：${character.speechStyle}`,
    `称呼对方：${character.formOfAddress}`,
    `自称：${character.selfAddress}`,
    `口头禅（选其一自然使用）：${character.catchphrases.join(' / ')}`,
  ].join('\n');

  const contextBlock =
    ctxLines.length > 0
      ? `【学生当前情境】\n${ctxLines.join('\n')}`
      : '【学生当前情境】\n（刚开始使用，暂无学习数据）';

  const historyBlock =
    history.length > 0
      ? `【最近对话】\n${history
          .slice(-6)
          .map((t) => `${t.role === 'user' ? '学生' : character.name}：${t.content}`)
          .join('\n')}`
      : '';

  return [persona, contextBlock, historyBlock].filter(Boolean).join('\n\n');
}

/**
 * 备考搭子多轮对话。读取情境 + 最近对话历史，调用 LLM 生成符合人设的回复，
 * 追加对话历史与事件日志。
 *
 * @param userMessage 用户本轮输入
 * @param character 当前选中的角色
 * @param ctx 学习情境
 * @param llm LLM 客户端
 * @param eventLogFile 事件日志路径
 * @param chatHistoryFile 对话历史路径
 */
export async function buddyChat(
  userMessage: string,
  character: Character,
  ctx: StudyContext,
  llm: LLMClient,
  eventLogFile: string,
  chatHistoryFile: string = Paths.buddyChatHistory
): Promise<string> {
  const system = await loadSystemPrompt();
  const history = await loadChatHistory(chatHistoryFile);

  const user = `${buildPersonaBlock(character, ctx, history)}\n\n【学生的话】\n${userMessage}`;

  const result = await llm.completeJSON<BuddyReply>(system, user, {
    temperature: 0.8,
    retries: 2,
  });

  if (!result.reply || typeof result.reply !== 'string') {
    throw new Error('Buddy returned no reply');
  }

  // 追加对话历史
  const now = new Date().toISOString();
  await appendChatTurn(chatHistoryFile, { role: 'user', content: userMessage, timestamp: now });
  await appendChatTurn(chatHistoryFile, { role: 'buddy', content: result.reply, timestamp: now });

  // 事件日志
  const event: Event = {
    id: createEventId(),
    timestamp: now,
    agent: 'study_buddy',
    action: 'buddy_chat',
    input: { characterId: character.id, userMessage: userMessage.slice(0, 100) },
    output: { reply: result.reply.slice(0, 100) },
  };
  await appendEvent(eventLogFile, event);

  return result.reply;
}

/**
 * 关键时刻台词：在 today/quiz/grade 流程末尾生成一句简短的搭子点评。
 * 单次 LLM 调用，失败时返回空字符串（调用方静默跳过，不阻塞主流程）。
 *
 * @param event 触发场景
 * @param extra 额外情境（如 grade 时的分数），可选
 */
export async function buddyInterject(
  event: InterjectEvent,
  character: Character,
  ctx: StudyContext,
  llm: LLMClient,
  extra?: { score?: number },
  eventLogFile: string = Paths.eventLog
): Promise<string> {
  const system = await loadSystemPrompt();

  const eventDesc: Record<InterjectEvent, string> = {
    today: '学生刚看到今天的学习任务',
    quiz: '学生刚生成完今天的测验题',
    grade: '学生刚批改完测验',
  };

  const extraLine =
    event === 'grade' && extra?.score !== undefined
      ? `\n学生本次得分 ${extra.score}/100`
      : '';

  const user =
    `${buildPersonaBlock(character, ctx, [])}\n\n` +
    `【当前时刻】${eventDesc[event]}${extraLine}\n` +
    `请用你的语气说一句简短的话（20 字以内），回应这个时刻。`;

  try {
    const result = await llm.completeJSON<BuddyReply>(system, user, {
      temperature: 0.9,
      retries: 1,
    });
    if (!result.reply || typeof result.reply !== 'string') return '';

    const event2: Event = {
      id: createEventId(),
      timestamp: new Date().toISOString(),
      agent: 'study_buddy',
      action: `buddy_interject_${event}`,
      input: { characterId: character.id, score: extra?.score },
      output: { line: result.reply },
    };
    await appendEvent(eventLogFile, event2);

    return result.reply;
  } catch {
    return '';
  }
}

/** 读取对话历史；文件不存在返回空数组。 */
export async function loadChatHistory(chatHistoryFile: string = Paths.buddyChatHistory): Promise<ChatTurn[]> {
  try {
    const content = await fs.readFile(chatHistoryFile, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ChatTurn);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}

/** 追加一条对话记录到 JSONL。 */
export async function appendChatTurn(
  chatHistoryFile: string,
  turn: ChatTurn
): Promise<void> {
  await fs.mkdir(path.dirname(chatHistoryFile), { recursive: true });
  await fs.appendFile(chatHistoryFile, JSON.stringify(turn) + '\n', 'utf-8');
}
