import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import type { LLMClient } from '../../src/core/llm.js';
import type { Character } from '../../src/core/character.js';
import type { StudyContext } from '../../src/core/context_reader.js';
import { buddyChat, buddyInterject, loadChatHistory } from '../../src/agents/study_buddy.js';
import { loadEvents } from '../../src/core/event_log.js';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_buddy');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');
const TEST_HISTORY = path.join(TEST_DIR, 'buddy', 'chat_history.jsonl');

const mockCharacter: Character = {
  id: 'shen_ye',
  name: '沈夜',
  gender: 'male',
  avatar: '🌙',
  tagline: '高冷学霸',
  personality: '毒舌但用心',
  speechStyle: '短句、怼人',
  formOfAddress: '笨蛋',
  selfAddress: '我',
  catchphrases: ['别废话，先做。'],
  greetingTemplates: ['又来了？'],
};

const mockContext: StudyContext = {
  daysToExam: 30,
  avgMastery: 0.5,
  weakNodeNames: ['需求曲线'],
  recentScore: 70,
  masteryTrend: 'up',
  tasksToday: 3,
};

beforeEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

/** 记录每次 LLM 调用，方便断言 system/user 内容 */
function makeMockLLM(reply: string, onCall?: (sys: string, user: string) => void): LLMClient {
  return {
    complete: async () => JSON.stringify({ reply }),
    completeJSON: async (sys: string, user: string) => {
      onCall?.(sys, user);
      return { reply } as unknown as Awaited<ReturnType<LLMClient['completeJSON']>>;
    },
  } as LLMClient;
}

describe('buddyChat', () => {
  it('returns the reply and writes history + event log', async () => {
    const llm = makeMockLLM('哼，别磨蹭，先把题做完。');
    const reply = await buddyChat('我不想学了', mockCharacter, mockContext, llm, TEST_LOG, TEST_HISTORY);

    expect(reply).toBe('哼，别磨蹭，先把题做完。');

    // 对话历史：user + buddy 两轮
    const history = await loadChatHistory(TEST_HISTORY);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('我不想学了');
    expect(history[1].role).toBe('buddy');
    expect(history[1].content).toBe('哼，别磨蹭，先把题做完。');

    // 事件日志
    const events = await loadEvents(TEST_LOG);
    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe('study_buddy');
    expect(events[0].action).toBe('buddy_chat');
  });

  it('includes character persona and study context in the LLM user message', async () => {
    let capturedUser = '';
    const llm = makeMockLLM('ok', (sys, user) => (capturedUser = user));
    await buddyChat('你好', mockCharacter, mockContext, llm, TEST_LOG, TEST_HISTORY);

    expect(capturedUser).toContain('沈夜');
    expect(capturedUser).toContain('毒舌但用心');
    expect(capturedUser).toContain('笨蛋');
    expect(capturedUser).toContain('距考试还有 30 天');
    expect(capturedUser).toContain('需求曲线');
    expect(capturedUser).toContain('你好');
  });

  it('accumulates history across turns and feeds it back', async () => {
    let callCount = 0;
    let lastUser = '';
    const llm = makeMockLLM('回复', (sys, user) => {
      callCount++;
      lastUser = user;
    });
    await buddyChat('第一句', mockCharacter, mockContext, llm, TEST_LOG, TEST_HISTORY);
    await buddyChat('第二句', mockCharacter, mockContext, llm, TEST_LOG, TEST_HISTORY);

    expect(callCount).toBe(2);
    // 第二轮的 user 消息应包含第一轮的历史
    expect(lastUser).toContain('第一句');
  });

  it('throws when LLM returns no reply', async () => {
    const llm = makeMockLLM('', () => {});
    // completeJSON 返回 { reply: '' }，buddyChat 应判定无 reply 而抛错
    await expect(
      buddyChat('hi', mockCharacter, mockContext, llm, TEST_LOG, TEST_HISTORY)
    ).rejects.toThrow();
  });
});

describe('buddyInterject', () => {
  it('returns a short line and logs the interject event', async () => {
    const llm = makeMockLLM('别紧张，放轻松考。');
    const line = await buddyInterject('grade', mockCharacter, mockContext, llm, { score: 85 }, TEST_LOG);
    expect(line).toBe('别紧张，放轻松考。');

    const events = await loadEvents(TEST_LOG);
    expect(events[0].action).toBe('buddy_interject_grade');
    expect(events[0].output).toEqual({ line: '别紧张，放轻松考。' });
  });

  it('includes the score for grade events in the user message', async () => {
    let capturedUser = '';
    const llm = makeMockLLM('x', (sys, user) => (capturedUser = user));
    await buddyInterject('grade', mockCharacter, mockContext, llm, { score: 42 }, TEST_LOG);
    expect(capturedUser).toContain('42');
  });

  it('returns empty string on LLM failure without throwing', async () => {
    const llm: LLMClient = {
      complete: async () => '',
      completeJSON: async () => {
        throw new Error('LLM down');
      },
    } as LLMClient;
    const line = await buddyInterject('today', mockCharacter, mockContext, llm, undefined, TEST_LOG);
    expect(line).toBe('');
  });

  it('writes event log for today and quiz events too', async () => {
    const llm = makeMockLLM('加油');
    await buddyInterject('today', mockCharacter, mockContext, llm, undefined, TEST_LOG);
    await buddyInterject('quiz', mockCharacter, mockContext, llm, undefined, TEST_LOG);
    const events = await loadEvents(TEST_LOG);
    const actions = events.map((e) => e.action);
    expect(actions).toContain('buddy_interject_today');
    expect(actions).toContain('buddy_interject_quiz');
  });
});
