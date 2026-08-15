import type { QuizQuestion } from '../api';

interface Props {
  question: QuizQuestion;
  index: number;
  selected: number[];
  onSelect: (optionIndex: number) => void;
  showResult?: boolean;
  correctAnswer?: number[];
}

export default function QuizCard({
  question,
  index,
  selected,
  onSelect,
  showResult,
  correctAnswer,
}: Props) {
  const isMulti = question.type === 'multi_choice';

  return (
    <div className="card">
      <div style={{ marginBottom: 12 }}>
        <span className={`badge ${isMulti ? 'badge-quiz' : 'badge-new'}`}>
          {isMulti ? '多选' : '单选'}
        </span>
        <span style={{ marginLeft: 8, fontWeight: 600 }}>
          第 {index + 1} 题
        </span>
      </div>
      <p style={{ marginBottom: 12, fontWeight: 500 }}>{question.stem}</p>
      {question.options.map((opt, i) => {
        let cls = 'quiz-option';
        if (showResult && correctAnswer) {
          if (correctAnswer.includes(i)) cls += ' correct';
          else if (selected.includes(i)) cls += ' wrong';
        } else if (selected.includes(i)) {
          cls += ' selected';
        }
        return (
          <button
            key={i}
            className={cls}
            onClick={() => !showResult && onSelect(i)}
            disabled={showResult}
          >
            {String.fromCharCode(65 + i)}. {opt}
          </button>
        );
      })}
      {showResult && question.explanation && (
        <p style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          解析：{question.explanation}
        </p>
      )}
    </div>
  );
}
