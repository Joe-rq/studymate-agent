import { describe, it, expect } from 'vitest';
import { updateMastery, DEFAULT_MASTERY_ALPHA } from '../../src/agents/mastery_tracker.js';
import type { ConceptMap } from '../../src/agents/concept_mapper.js';
import type { QuizResult } from '../../src/agents/grader.js';

/** 构造一个最小概念图，便于测试。 */
function makeConceptMap(masteries: Record<string, number>): ConceptMap {
  const concepts = Object.entries(masteries).map(([id, mastery]) => ({
    id,
    name: id,
    definition: '',
    prerequisiteIds: [],
    relatedChunks: [],
    mastery,
  }));
  return { concepts, learningOrder: Object.keys(masteries) };
}

/**
 * 构造一个批改结果，指定每个概念答对/答错的情况。
 * @param outcomes Record<nodeId, boolean[]>  该概念每题是否答对
 */
function makeResult(outcomes: Record<string, boolean[]>): QuizResult {
  const details = [];
  let qIdx = 0;
  for (const [nodeId, answers] of Object.entries(outcomes)) {
    for (const isCorrect of answers) {
      details.push({
        question: {
          id: `q_${qIdx++}`,
          type: 'single_choice' as const,
          stem: '',
          options: [],
          answer: 0,
          explanation: '',
          nodeId,
        },
        userAnswer: isCorrect ? 0 : 1,
        isCorrect,
        score: isCorrect ? 100 : 0,
      });
    }
  }
  return {
    quizId: 'q1',
    date: '2026-07-10',
    totalScore: 0,
    mistakes: details.filter((d) => !d.isCorrect),
    details,
  };
}

describe('mastery_tracker', () => {
  it('未被考到的概念 mastery 保持不变', () => {
    const map = makeConceptMap({ node_1: 0.5, node_2: 0.8 });
    const result = makeResult({ node_1: [true, true] }); // 只考了 node_1
    const { changes, conceptMap } = updateMastery(map, result);

    expect(changes).toHaveLength(1);
    expect(changes[0].nodeId).toBe('node_1');
    // node_2 未被考到，mastery 不变
    const node2 = conceptMap.concepts.find((c) => c.id === 'node_2');
    expect(node2?.mastery).toBe(0.8);
  });

  it('全对时 mastery 上升，全错时 mastery 下降', () => {
    // oldMastery = 0.5, alpha = 0.4
    // 全对: sessionScore=1 → new = 0.5×0.6 + 1×0.4 = 0.7
    const mapUp = makeConceptMap({ node_1: 0.5 });
    const resultUp = makeResult({ node_1: [true, true] });
    const up = updateMastery(mapUp, resultUp);
    expect(up.changes[0].newMastery).toBeCloseTo(0.7, 5);
    expect(up.conceptMap.concepts[0].mastery).toBeCloseTo(0.7, 5);

    // 全错: sessionScore=0 → new = 0.5×0.6 + 0×0.4 = 0.3
    const mapDown = makeConceptMap({ node_1: 0.5 });
    const resultDown = makeResult({ node_1: [false, false] });
    const down = updateMastery(mapDown, resultDown);
    expect(down.changes[0].newMastery).toBeCloseTo(0.3, 5);
  });

  it('EMA 累积：两次 session 后 mastery 介于初值和最新 sessionScore 之间', () => {
    // 从 0 出发，两次都答对 80% (sessionScore=0.8)
    let map = makeConceptMap({ node_1: 0 });
    const result = makeResult({ node_1: [true, true, true, false] }); // 3/4 对... 用 0.75 近似
    // 改用精确 4 题对 4 题答对 80% 不方便，直接用 4 题里 3 对 1 错 = 0.75
    // 第一次: new = 0×0.6 + 0.75×0.4 = 0.3
    const first = updateMastery(map, result);
    expect(first.changes[0].newMastery).toBeCloseTo(0.3, 5);

    // 第二次: new = 0.3×0.6 + 0.75×0.4 = 0.18 + 0.3 = 0.48
    const second = updateMastery(first.conceptMap, result);
    expect(second.changes[0].newMastery).toBeCloseTo(0.48, 5);

    // 累积两次后，mastery 在初值(0)和 sessionScore(0.75)之间
    expect(second.changes[0].newMastery).toBeGreaterThan(0);
    expect(second.changes[0].newMastery).toBeLessThan(0.75);
  });

  it('mastery 始终在 [0, 1] 区间内', () => {
    // 极端：初值 0.99 全错，和初值 0.01 全对
    const map = makeConceptMap({ a: 0.99, b: 0.01 });
    const result = makeResult({ a: [false], b: [true] });
    const { conceptMap } = updateMastery(map, result);
    for (const c of conceptMap.concepts) {
      expect(c.mastery).toBeGreaterThanOrEqual(0);
      expect(c.mastery).toBeLessThanOrEqual(1);
    }
  });

  it('使用自定义 alpha', () => {
    // alpha=1: newMastery = sessionScore（完全用本次结果）
    const map = makeConceptMap({ node_1: 0.9 });
    const result = makeResult({ node_1: [false, false] });
    const { changes } = updateMastery(map, result, 1);
    expect(changes[0].newMastery).toBe(0);
  });

  it('默认 alpha 等于 DEFAULT_MASTERY_ALPHA', () => {
    const map = makeConceptMap({ node_1: 0 });
    const result = makeResult({ node_1: [true] });
    const { changes } = updateMastery(map, result);
    // new = 0×0.6 + 1×0.4 = 0.4
    expect(changes[0].newMastery).toBeCloseTo(DEFAULT_MASTERY_ALPHA, 5);
  });
});
