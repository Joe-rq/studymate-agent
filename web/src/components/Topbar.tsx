import { useLocation } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

const TITLES: Record<string, string> = {
  '/': '备考面板',
  '/tasks': '今日任务',
  '/quiz': '测验',
  '/plan': '学习计划',
  '/chat': '和搭子聊天',
  '/settings': '设置',
  '/onboarding': '建档向导',
};

export default function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? 'StudyMate';

  return (
    <header className="topbar">
      <button
        type="button"
        className="menu-btn"
        aria-label="打开菜单"
        onClick={onMenuClick}
      >
        <span />
        <span />
        <span />
      </button>
      <h2 className="topbar-title">{title}</h2>
      <div className="topbar-right">
        <ThemeToggle />
      </div>
    </header>
  );
}
