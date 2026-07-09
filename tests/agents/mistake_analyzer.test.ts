import { describe, it, expect } from 'vitest';
import { analyzeMistakes } from '../../src/agents/mistake_analyzer.js';

describe('mistake_analyzer', () => {
  it('should extract weak nodes from result', () => {
    const result = {
      quizId: 'q1',
      date: '2026-07-10',
      totalScore: 50,
      details: [],
      mistakes: [
        {
          question: { id: 'q_1', type: 'single_choice' as const, stem: '', options: [], answer: 0, explanation: '', nodeId: 'node_1' },
          userAnswer: 1,
          isCorrect: false,
          score: 0,
        },
      ],
    };
    const mistakes = analyzeMistakes(result);
    expect(mistakes[0].nodeId).toBe('node_1');
    expect(mistakes[0].nextReview).toBe('2026-07-11');
  });
});
