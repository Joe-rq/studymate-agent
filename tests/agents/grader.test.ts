import { describe, it, expect } from 'vitest';
import { gradeQuiz } from '../../src/agents/grader.js';

describe('grader', () => {
  it('should grade quiz correctly', () => {
    const quiz = {
      id: 'quiz_1',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q1', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'node_1' },
        { id: 'q_2', type: 'single_choice' as const, stem: 'Q2', options: ['A', 'B'], answer: 1, explanation: '', nodeId: 'node_2' },
      ],
    };
    const answers = [
      { questionId: 'q_1', answer: 0 },
      { questionId: 'q_2', answer: 0 },
    ];
    const result = gradeQuiz(quiz, answers);
    expect(result.totalScore).toBe(50);
    expect(result.mistakes).toHaveLength(1);
  });
});
