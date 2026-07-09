import type { LLMClient, LLMOptions } from './llm.js';

export function createMockLLMClient(): LLMClient {
  return {
    async complete(system: string, _user: string, _options?: LLMOptions): Promise<string> {
      if (system.includes('exam question generator') || system.includes('multiple-choice questions')) {
        return JSON.stringify({
          questions: [
            {
              id: 'q_1',
              type: 'single_choice',
              stem: '需求曲线通常向哪个方向倾斜？',
              options: ['右上方', '右下方', '水平', '垂直'],
              answer: 1,
              explanation: '需求曲线向右下方倾斜表示价格越高需求量越低。',
              nodeId: 'node_1',
            },
            {
              id: 'q_2',
              type: 'single_choice',
              stem: '当需求价格弹性大于 1 时，价格上升会导致什么？',
              options: ['总收入增加', '总收入减少', '总收入不变', '无法确定'],
              answer: 1,
              explanation: '弹性大于 1 意味着需求量变动百分比大于价格变动百分比。',
              nodeId: 'node_4',
            },
            {
              id: 'q_3',
              type: 'single_choice',
              stem: '市场均衡发生在什么时候？',
              options: ['价格最高时', '需求量等于供给量时', '政府干预时', '库存最多时'],
              answer: 1,
              explanation: '均衡是需求量等于供给量时的状态。',
              nodeId: 'node_3',
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

      return JSON.stringify({ ok: true });
    },
    async completeJSON<T>(system: string, user: string, options?: LLMOptions): Promise<T> {
      const content = await this.complete(system, user, options);
      return JSON.parse(content) as T;
    },
  };
}
