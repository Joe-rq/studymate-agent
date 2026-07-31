import { describe, it, expect } from 'vitest';
import { createMockLLMClient } from '../../src/core/mock_llm.js';

/**
 * 验证 mock LLM 的备考搭子分支能根据「角色 × 时刻 × 分数」
 * 返回不同的情境台词，使离线 demo 也能演示情境感知差异。
 *
 * 注：study_buddy.test.ts 用的是 inline mock 验证 agent 逻辑，
 * 这里专门验证 createMockLLMClient 本身的行为。
 */

const BUDDY_SYSTEM = 'You are a study companion (备考搭子).';

/** 构造 study_buddy 传给 LLM 的 user 消息（与 study_buddy.ts 的格式一致）。 */
function makeUserMessage(opts: {
  name: string;
  moment: 'today' | 'quiz' | 'grade';
  score?: number;
}): string {
  const eventDesc = {
    today: '学生刚看到今天的学习任务',
    quiz: '学生刚生成完今天的测验题',
    grade: '学生刚批改完测验',
  }[opts.moment];
  const scoreLine =
    opts.moment === 'grade' && opts.score !== undefined
      ? `\n学生本次得分 ${opts.score}/100`
      : '';
  return (
    `【你的角色】\n名字：${opts.name}\n性格：测试用\n说话风格：测试用\n称呼对方：你\n自称：我\n口头禅：嗯\n\n` +
    `【当前时刻】${eventDesc}${scoreLine}\n` +
    `请用你的语气说一句简短的话。`
  );
}

describe('mock buddy: situational lines by character × moment × score', () => {
  const mock = createMockLLMClient();

  it('grade 场景：高分与低分返回不同台词（沈夜）', async () => {
    const high = await mock.completeJSON<{ reply: string }>(
      BUDDY_SYSTEM,
      makeUserMessage({ name: '沈夜', moment: 'grade', score: 95 })
    );
    const low = await mock.completeJSON<{ reply: string }>(
      BUDDY_SYSTEM,
      makeUserMessage({ name: '沈夜', moment: 'grade', score: 20 })
    );
    expect(high.reply).not.toBe(low.reply);
    // 高分应有肯定意味（沈夜的傲娇式认可）
    expect(high.reply).toContain('没我想的那么笨');
    // 低分应有严厉但关心的意味
    expect(low.reply).toContain('笨蛋');
  });

  it('同一角色同一分数档返回稳定台词（确定性）', async () => {
    const a = await mock.completeJSON<{ reply: string }>(
      BUDDY_SYSTEM,
      makeUserMessage({ name: '陆星野', moment: 'grade', score: 90 })
    );
    const b = await mock.completeJSON<{ reply: string }>(
      BUDDY_SYSTEM,
      makeUserMessage({ name: '陆星野', moment: 'grade', score: 85 })
    );
    // 90 和 85 都属于 high 档（≥80），应返回同一句
    expect(a.reply).toBe(b.reply);
  });

  it('中等分数（60-79）走 mid 档', async () => {
    const mid = await mock.completeJSON<{ reply: string }>(
      BUDDY_SYSTEM,
      makeUserMessage({ name: '苏念', moment: 'grade', score: 65 })
    );
    const high = await mock.completeJSON<{ reply: string }>(
      BUDDY_SYSTEM,
      makeUserMessage({ name: '苏念', moment: 'grade', score: 95 })
    );
    expect(mid.reply).not.toBe(high.reply);
  });

  it('today 和 quiz 场景不受分数影响', async () => {
    const today = await mock.completeJSON<{ reply: string }>(
      BUDDY_SYSTEM,
      makeUserMessage({ name: '团子', moment: 'today' })
    );
    const quiz = await mock.completeJSON<{ reply: string }>(
      BUDDY_SYSTEM,
      makeUserMessage({ name: '团子', moment: 'quiz' })
    );
    // 非 grade 场景不应包含分数相关措辞，且回复非空
    expect(today.reply).toBeTruthy();
    expect(quiz.reply).toBeTruthy();
    expect(today.reply).not.toContain('得分');
  });

  it('不同角色对同一情境返回不同语气', async () => {
    const shen = await mock.completeJSON<{ reply: string }>(
      BUDDY_SYSTEM,
      makeUserMessage({ name: '沈夜', moment: 'grade', score: 90 })
    );
    const tuanzi = await mock.completeJSON<{ reply: string }>(
      BUDDY_SYSTEM,
      makeUserMessage({ name: '团子', moment: 'grade', score: 90 })
    );
    expect(shen.reply).not.toBe(tuanzi.reply);
    // 沈夜毒舌、团子萌系，措辞风格应明显不同
    expect(shen.reply.length).toBeGreaterThan(0);
    expect(tuanzi.reply).toContain('团子');
  });
});
