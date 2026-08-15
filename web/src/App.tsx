import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import TodayTasks from './pages/TodayTasks';
import QuizPage from './pages/QuizPage';
import GradeReport from './pages/GradeReport';
import PlanView from './pages/PlanView';
import BuddyChat from './pages/BuddyChat';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';
import StudioPage from './pages/StudioPage';
import GrowthPage from './pages/GrowthPage';
import PetLayer from './components/PetLayer';
import Topbar from './components/Topbar';
import { ToastHost } from './components/Toast';
import { AUTH_REQUIRED_EVENT, setAccessToken } from './api';

const navItems = [
  { to: '/', label: '首页' },
  { to: '/tasks', label: '今日任务' },
  { to: '/studio', label: '学习' },
  { to: '/quiz', label: '测验' },
  { to: '/plan', label: '计划' },
  { to: '/growth', label: '成长' },
  { to: '/chat', label: '搭子' },
  { to: '/settings', label: '设置' },
];

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [needsToken, setNeedsToken] = useState(false);
  const location = useLocation();

  // Close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // 任一 API 返回 401 时弹出令牌输入门禁
  useEffect(() => {
    const handler = () => setNeedsToken(true);
    window.addEventListener(AUTH_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handler);
  }, []);

  return (
    <div className="app-layout">
      {/* Desktop sidebar (also slides in as drawer on mobile) */}
      <nav className={`sidebar${drawerOpen ? ' open' : ''}`}>
        <h1 className="logo">
          <img className="logo-mark" src="/logo.png" alt="" />
          <span>StudyMate</span>
        </h1>
        <ul>
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.to === '/'}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Click-away backdrop for mobile drawer */}
      {drawerOpen && (
        <div
          className="drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="main-area">
        <Topbar onMenuClick={() => setDrawerOpen((v) => !v)} />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/tasks" element={<TodayTasks />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/quiz" element={<QuizPage />} />
            <Route path="/grade" element={<GradeReport />} />
            <Route path="/growth" element={<GrowthPage />} />
            <Route path="/plan" element={<PlanView />} />
            <Route path="/chat" element={<BuddyChat />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>

      <PetLayer />

      <ToastHost />

      {needsToken && (
        <TokenGate
          onDone={() => {
            setNeedsToken(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

function TokenGate({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  const submit = () => {
    if (!value.trim()) return;
    setAccessToken(value.trim());
    onDone();
  };
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div className="card" style={{ maxWidth: 360, width: '90%' }}>
        <h3>需要访问令牌</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          服务已启用访问认证。请输入访问令牌以继续（仅本次会话有效）。
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="访问令牌"
          autoFocus
          style={{ width: '100%', marginBottom: 12 }}
        />
        <button className="btn btn-primary" onClick={submit} style={{ width: '100%' }}>
          确认
        </button>
      </div>
    </div>
  );
}
