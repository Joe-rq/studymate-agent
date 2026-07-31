import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import TodayTasks from './pages/TodayTasks';
import QuizPage from './pages/QuizPage';
import GradeReport from './pages/GradeReport';
import PlanView from './pages/PlanView';
import BuddyChat from './pages/BuddyChat';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';
import BuddyPanel from './components/BuddyPanel';
import ThemeToggle from './components/ThemeToggle';

const navItems = [
  { to: '/', label: '首页' },
  { to: '/tasks', label: '今日任务' },
  { to: '/quiz', label: '测验' },
  { to: '/plan', label: '计划' },
  { to: '/chat', label: '搭子' },
  { to: '/settings', label: '设置' },
];

export default function App() {
  return (
    <div className="app-layout">
      <nav className="sidebar">
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
        <div className="sidebar-footer">
          <ThemeToggle />
        </div>
      </nav>
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
      <aside className="buddy-sidebar">
        <BuddyPanel />
      </aside>
    </div>
  );
}
