import { useState } from 'react';
import { Clock, PlayCircle, CalendarCheck, LogOut, KanbanSquare } from 'lucide-react';
import { todayStr } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import TimelineView from './TimelineView.jsx';
import LogTimeView from './LogTimeView.jsx';
import AttendanceView from './AttendanceView.jsx';
import MyTasksView from './MyTasksView.jsx';

const TABS = [
  { key: 'timeline', label: 'My Timeline', icon: Clock },
  { key: 'projects', label: 'Projects', icon: KanbanSquare },
  { key: 'logtime', label: 'Log Time', icon: PlayCircle },
  { key: 'attendance', label: 'Attendance & Leave', icon: CalendarCheck },
];

export default function EmployeeDashboard({ employee, onLogout }) {
  const [date, setDate] = useState(todayStr());
  const [activeTab, setActiveTab] = useState('timeline');

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="eyeGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#3987e5" />
                  <stop offset="1" stopColor="#9085e9" />
                </linearGradient>
              </defs>
              <polygon points="50,7.8 8.8,89.8 91.2,89.8" fill="url(#eyeGrad)" />
              <ellipse cx="50" cy="68.4" rx="27.3" ry="7.6" fill="#f5f8fc" />
              <circle cx="50" cy="68.4" r="8.4" fill="#18203a" />
              <circle cx="50" cy="68.4" r="7.3" fill="none" stroke="#5878dc" strokeWidth="0.6" />
              <circle cx="50" cy="68.4" r="4.2" fill="#06080f" />
              <circle cx="47.75" cy="66.15" r="1.37" fill="#fff" />
              <circle cx="51.66" cy="70.06" r="0.68" fill="#fff" />
            </svg>
          </div>
          <div className="brand-name">BIG BOSS</div>
        </div>

        <div className="sidebar-section">
          <h1>Signed in as</h1>
          <div className="user-item selected" style={{ cursor: 'default', marginBottom: 8 }}>
            <Avatar name={employee.name} size={26} />
            {employee.name}
          </div>
          <button className="btn-small" onClick={onLogout} style={{ width: '100%' }}>
            <LogOut size={12} style={{ marginRight: 4, verticalAlign: -1 }} />Log out
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="tabs">
          {TABS.map((t) => (
            <div
              key={t.key}
              className={`tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <t.icon size={15} />
              {t.label}
            </div>
          ))}
        </div>

        {activeTab === 'timeline' && (
          <TimelineView selectedUserId={employee.id} date={date} setDate={setDate} />
        )}
        {activeTab === 'projects' && <MyTasksView userId={employee.id} />}
        {activeTab === 'logtime' && (
          <LogTimeView userId={employee.id} managerId={employee.managerId} />
        )}
        {activeTab === 'attendance' && <AttendanceView userId={employee.id} />}
      </main>
    </div>
  );
}
