import { describe, it, expect } from 'vitest';
import { gradeQuiz } from '../../src/agents/grader.js';
import type { Quiz } from '../../src/agents/quiz_generator.js';

describe('grader', () => {
  it('should grade quiz correctly', () => {
    const quiz: Quiz = {
      id: 'quiz_1',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice', stem: 'Q1', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'node_1', difficulty: 'medium' },
        { id: 'q_2', type: 'single_choice', stem: 'Q2', options: ['A', 'B'], answer: 1, explanation: '', nodeId: 'node_2', difficulty: 'medium' },
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

  it('should give full marks for exact multi-choice match', () => {
    const quiz: Quiz = {
      id: 'quiz_1',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'multi_choice', stem: 'MC', options: ['A', 'B', 'C', 'D'], answer: [0, 2], explanation: '', nodeId: 'node_1', difficulty: 'hard' },
      ],
    };
    const answers = [{ questionId: 'q_1', answer: [0, 2] }];
    const result = gradeQuiz(quiz, answers);
    expect(result.details[0].isCorrect).toBe(true);
    expect(result.details[0].score).toBe(100);
    expect(result.totalScore).toBe(100);
  });

  it('should give partial credit (50) for subset with no wrong selections', () => {
    const quiz: Quiz = {
      id: 'quiz_1',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'multi_choice', stem: 'MC', options: ['A', 'B', 'C', 'D'], answer: [0, 2, 3], explanation: '', nodeId: 'node_1', difficulty: 'hard' },
      ],
    };
    // User selects [0, 2] — subset of correct [0, 2, 3], no wrong picks
    const answers = [{ questionId: 'q_1', answer: [0, 2] }];
    const result = gradeQuiz(quiz, answers);
    expect(result.details[0].isCorrect).toBe(false);
    expect(result.details[0].score).toBe(50);
    expect(result.totalScore).toBe(50);
  });

  it('should give zero for multi-choice with wrong selection', () => {
    const quiz: Quiz = {
      id: 'quiz_1',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'multi_choice', stem: 'MC', options: ['A', 'B', 'C', 'D'], answer: [0, 2], explanation: '', nodeId: 'node_1', difficulty: 'hard' },
      ],
    };
    // User selects [0, 1] — 1 is wrong
    const answers = [{ questionId: 'q_1', answer: [0, 1] }];
    const result = gradeQuiz(quiz, answers);
    expect(result.details[0].isCorrect).toBe(false);
    expect(result.details[0].score).toBe(0);
  });

  it('should handle unsorted user answer for multi-choice', () => {
    const quiz: Quiz = {
      id: 'quiz_1',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'multi_choice', stem: 'MC', options: ['A', 'B', 'C', 'D'], answer: [1, 3], explanation: '', nodeId: 'node_1', difficulty: 'medium' },
      ],
    };
    // User gives [3, 1] — should still match after sorting
    const answers = [{ questionId: 'q_1', answer: [3, 1] }];
    const result = gradeQuiz(quiz, answers);
    expect(result.details[0].isCorrect).toBe(true);
    expect(result.details[0].score).toBe(100);
  });

  it('should compute perConceptScore', () => {
    const quiz: Quiz = {
      id: 'quiz_1',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice', stem: 'Q1', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'node_1', difficulty: 'easy' },
        { id: 'q_2', type: 'single_choice', stem: 'Q2', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'node_1', difficulty: 'easy' },
        { id: 'q_3', type: 'single_choice', stem: 'Q3', options: ['A', 'B'], answer: 1, explanation: '', nodeId: 'node_2', difficulty: 'easy' },
      ],
    };
    const answers = [
      { questionId: 'q_1', answer: 0 },
      { questionId: 'q_2', answer: 1 }, // wrong
      { questionId: 'q_3', answer: 1 },
    ];
    const result = gradeQuiz(quiz, answers);
    expect(result.perConceptScore['node_1']).toEqual({ correct: 1, total: 2 });
    expect(result.perConceptScore['node_2']).toEqual({ correct: 1, total: 1 });
  });

  it('should pass through sourceChunkId', () => {
    const quiz: Quiz = {
      id: 'quiz_1',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice', stem: 'Q1', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'node_1', difficulty: 'easy', sourceChunkId: 'chunk_x' },
      ],
    };
    const answers = [{ questionId: 'q_1', answer: 0 }];
    const result = gradeQuiz(quiz, answers);
    expect(result.details[0].sourceChunkId).toBe('chunk_x');
  });
});
