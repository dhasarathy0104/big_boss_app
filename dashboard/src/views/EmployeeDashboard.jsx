import { useState } from 'react';
import { Clock, PlayCircle, CalendarCheck, LogOut, KanbanSquare } from 'lucide-react';
import { todayStr } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import DeskIllustration from '../components/DeskIllustration.jsx';
import TimelineView from './TimelineView.jsx';
import LogTimeView from './LogTimeView.jsx';
import AttendanceView from './AttendanceView.jsx';
import MyTasksView from './MyTasksView.jsx';
import { LOGO_DATA_URI } from '../logo.js';

const TABS = [
  { key: 'timeline', label: 'My Timeline', icon: Clock },
  { key: 'projects', label: 'Tasks', icon: KanbanSquare },
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
            <img src={LOGO_DATA_URI} alt="BIG BOSS" width="30" height="30" />
          </div>
          <div className="brand-name">BIG BOSS</div>
        </div>

        <nav className="sidebar-nav">
          {TABS.map((t) => (
            <div
              key={t.key}
              className={`nav-item ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
              title={t.label}
            >
              <t.icon size={16} />
              <span>{t.label}</span>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="profile-card">
            <Avatar name={employee.name} size={38} />
            <div className="profile-info">
              <div className="profile-name">{employee.name}</div>
              <div className="profile-role">Employee</div>
            </div>
          </div>
          <button className="btn-outline profile-logout" onClick={onLogout} title="Log out">
            <LogOut size={13} /><span>Log out</span>
          </button>
          <div className="sidebar-illustration">
            <DeskIllustration />
          </div>
        </div>
      </aside>

      <main className="main">

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
