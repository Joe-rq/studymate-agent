import type { LLMClient, LLMOptions } from './llm.js';

/** 情境分档：高分 / 中等 / 低分（仅 grade 场景使用，today/quiz 统一用 neutral）。 */
type ScoreBand = 'high' | 'mid' | 'low' | 'neutral';
/** 关键时刻类型，与 study_buddy.ts 的 InterjectEvent 对应。 */
type Moment = 'today' | 'quiz' | 'grade' | 'chat';

/**
 * 备考搭子离线台词表。
 * 结构：角色 → 时刻 → 分档 → 台词。
 * 让 mock LLM 在无 API key 时也能演示「分数驱动语气」的情境差异。
 * chat 时刻只有一个分档（neutral），因为多轮对话 mock 不细分情绪。
 */
const BUDDY_LINES: Record<string, Record<Moment, Partial<Record<ScoreBand, string>>>> = {
  lu_xingye: {
    today: {
      neutral: '同学来啦，今天的任务不多，咱们稳稳拿下就好，学长陪你。',
    },
    quiz: {
      neutral: '题出好了，别紧张，读完题再选，学长相信你。',
    },
    grade: {
      high: '漂亮！同学这分数说明功夫没白费，保持住节奏就行。',
      mid: '还行，大部分对了，错的几道学长陪你逐个过一遍。',
      low: '别灰心，同学。这次暴露的问题，正是下次涨分的地方，咱们慢慢来。',
    },
    chat: {
      neutral: '同学，别急，咱们一步步来，学长随时都在。',
    },
  },
  shen_ye: {
    today: {
      neutral: '哼，任务不多，别磨蹭，今天之内做完。',
    },
    quiz: {
      neutral: '题在这儿了。基础题别给我丢人。',
    },
    grade: {
      high: '……还行，没我想的那么笨。别得意，下次继续。',
      mid: '勉强能看。错的几道回去重做，别让我讲第三遍。',
      low: '这种分数？笨蛋，你是故意气我的吧。拿来，我一道道给你讲。',
    },
    chat: {
      neutral: '别废话，有什么不懂的直接问。',
    },
  },
  su_nian: {
    today: {
      neutral: '搭档！今天的任务本姑娘已经看过了，咱们一起冲！',
    },
    quiz: {
      neutral: '题来啦！深呼吸，本姑娘精神上支持你，冲冲冲！',
    },
    grade: {
      high: '哇搭档你太强了！这分数必须庆祝，本姑娘佩服！',
      mid: '没关系没关系，错的地方就是能涨分的地方，咱们一起攻克！',
      low: '搭档别耷拉着脸呀！一次测验而已，本姑娘陪你，下次肯定翻盘！',
    },
    chat: {
      neutral: '搭档你说，本姑娘听着呢！要不要一起刷题？',
    },
  },
  tuanzi: {
    today: {
      neutral: '主人今天也要加油哦，团子给你呼噜呼噜～',
    },
    quiz: {
      neutral: '团子相信主人！做题的时候团子会在旁边陪着的！',
    },
    grade: {
      high: '主人最厉害了！团子崇拜！团子要转圈圈！',
      mid: '主人做得不错呀，团子蹭蹭你，继续加油嘛！',
      low: '主人别难过，团子给你抱抱。歇一会儿，团子陪你。',
    },
    chat: {
      neutral: '主人跟团子说话啦，团子好开心呀～',
    },
  },
};

/** 从 user 消息里识别当前时刻类型。 */
function detectMoment(user: string): Moment {
  if (user.includes('刚批改完测验')) return 'grade';
  if (user.includes('刚生成完今天的测验题')) return 'quiz';
  if (user.includes('刚看到今天的学习任务')) return 'today';
  return 'chat';
}

/** 从 user 消息里提取分数并分档；非 grade 场景返回 neutral。 */
function detectScoreBand(user: string, moment: Moment): ScoreBand {
  if (moment !== 'grade') return 'neutral';
  const match = user.match(/得分\s*(\d+)\s*\/\s*100/);
  if (!match) return 'neutral';
  const score = parseInt(match[1], 10);
  if (score >= 80) return 'high';
  if (score >= 60) return 'mid';
  return 'low';
}

/** 从 user 消息里识别角色名。 */
function detectCharacter(user: string): string {
  for (const name of ['陆星野', '沈夜', '苏念', '团子']) {
    if (user.includes(`名字：${name}`)) {
      const idMap: Record<string, string> = {
        陆星野: 'lu_xingye',
        沈夜: 'shen_ye',
        苏念: 'su_nian',
        团子: 'tuanzi',
      };
      return idMap[name];
    }
  }
  return 'lu_xingye';
}

/**
 * 根据 user 消息里的角色、时刻、分数信号，从台词表里查出一句符合人设的话。
 * 查不到时回退到该角色的 chat 默认台词，再回退到通用兜底。
 */
function pickBuddyLine(user: string): string {
  const charId = detectCharacter(user);
  const moment = detectMoment(user);
  const band = detectScoreBand(user, moment);

  const charLines = BUDDY_LINES[charId];
  const line = charLines?.[moment]?.[band];
  if (line) return line;

  // 回退：该角色的 chat 默认，再回退通用
  return charLines?.chat?.neutral ?? '嗯，别急，咱们一起慢慢来。';
}

export function createMockLLMClient(): LLMClient {
  return {
    async complete(system: string, user: string, _options?: LLMOptions): Promise<string> {
      if (system.includes('exam question generator') || system.includes('multiple-choice questions')) {
        // Extract concept IDs from user prompt (format: ## Name [id])
        const idMatches = [...user.matchAll(/## .+? \[([^\]]+)\]/g)];
        const nodeIds = idMatches.map((m) => m[1]);
        const nid = (i: number) => nodeIds[i % Math.max(1, nodeIds.length)] ?? 'node_1';

        return JSON.stringify({
          questions: [
            {
              id: 'q_1',
              type: 'single_choice',
              stem: '需求曲线通常向哪个方向倾斜？',
              options: ['右上方', '右下方', '水平', '垂直'],
              answer: 1,
              explanation: '需求曲线向右下方倾斜表示价格越高需求量越低。',
              nodeId: nid(0),
              difficulty: 'easy',
            },
            {
              id: 'q_2',
              type: 'multi_choice',
              stem: '以下哪些因素会导致需求曲线移动？',
              options: ['消费者收入变化', '商品价格变化', '偏好变化', '供给量变化'],
              answer: [0, 2],
              explanation: '收入和偏好变化会使需求曲线整体移动，价格变化是沿曲线移动。',
              nodeId: nid(1),
              difficulty: 'medium',
            },
            {
              id: 'q_3',
              type: 'single_choice',
              stem: '市场均衡发生在什么时候？',
              options: ['价格最高时', '需求量等于供给量时', '政府干预时', '库存最多时'],
              answer: 1,
              explanation: '均衡是需求量等于供给量时的状态。',
              nodeId: nid(0),
              difficulty: 'easy',
            },
          ],
        });
      }

      if (system.includes('educational content analyzer') || system.includes('prerequisite relationships')) {
        return JSON.stringify({
          concepts: [
            { id: 'node_1', name: '需求曲线', definition: '价格与需求量的关系曲线', prerequisiteIds: [] },
            { id: 'node_2', name: '供给曲线', definition: '价格与供给量的关系曲线', prerequisiteIds: [] },
            { id: 'node_3', name: '市场均衡', definition: '需求量等于供给量时的状态', prerequisiteIds: ['node_1', 'node_2'] },
            { id: 'node_4', name: '价格弹性', definition: '需求量对价格变动的敏感程度', prerequisiteIds: ['node_1'] },
          ],
        });
      }

      // 备考搭子分支：根据角色 × 时刻 × 分数返回符合人设的情境台词
      if (system.includes('study companion') || system.includes('备考搭子')) {
        return JSON.stringify({ reply: pickBuddyLine(user) });
      }

      return JSON.stringify({ ok: true });
    },
    async completeJSON<T>(system: string, user: string, options?: LLMOptions): Promise<T> {
      const content = await this.complete(system, user, options);
      return JSON.parse(content) as T;
    },
  };
}
