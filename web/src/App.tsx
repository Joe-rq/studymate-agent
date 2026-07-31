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
import BuddyPanel from './components/BuddyPanel';
import Topbar from './components/Topbar';
import { ToastHost } from './components/Toast';

const navItems = [
  { to: '/', label: '首页' },
  { to: '/tasks', label: '今日任务' },
  { to: '/quiz', label: '测验' },
  { to: '/plan', label: '计划' },
  { to: '/chat', label: '搭子' },
  { to: '/settings', label: '设置' },
];

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-layout">
      {/* Desktop sidebar (also slides in as drawer on mobile) */}
      <nav className={`sidebar${drawerOpen ? ' open' : ''}`}>
        <h1 className="logo">StudyMate</h1>
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
            <Route path="/quiz" element={<QuizPage />} />
            <Route path="/grade" element={<GradeReport />} />
            <Route path="/plan" element={<PlanView />} />
            <Route path="/chat" element={<BuddyChat />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>

      <aside className="buddy-sidebar">
        <BuddyPanel />
      </aside>

      <ToastHost />
    </div>
  );
}
