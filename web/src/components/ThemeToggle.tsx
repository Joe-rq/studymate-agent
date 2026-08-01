import { useTheme, type ThemeMode } from '../theme/ThemeContext';

const OPTIONS: { mode: ThemeMode; icon: string; label: string }[] = [
  { mode: 'light', icon: '☀️', label: '浅色' },
  { mode: 'dark', icon: '🌙', label: '深色' },
  { mode: 'system', icon: '🖥️', label: '跟随系统' },
];

export default function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div className="theme-toggle" role="group" aria-label="主题切换">
      {OPTIONS.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          className={`theme-toggle-btn${mode === opt.mode ? ' active' : ''}`}
          onClick={() => setMode(opt.mode)}
          title={opt.label}
          aria-pressed={mode === opt.mode}
        >
          <span aria-hidden="true">{opt.icon}</span>
        </button>
      ))}
    </div>
  );
}
