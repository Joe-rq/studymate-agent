import { useTheme, type ThemeMode } from '../theme/ThemeContext';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

const OPTIONS: { mode: ThemeMode; icon: JSX.Element; label: string }[] = [
  { mode: 'light', icon: <SunIcon />, label: '浅色' },
  { mode: 'dark', icon: <MoonIcon />, label: '深色' },
  { mode: 'system', icon: <MonitorIcon />, label: '跟随系统' },
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
          aria-label={opt.label}
          aria-pressed={mode === opt.mode}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
