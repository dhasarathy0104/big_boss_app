import { useState } from 'react';
import { Clock, PlayCircle, CalendarCheck, LogOut } from 'lucide-react';
import { todayStr } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import TimelineView from './TimelineView.jsx';
import LogTimeView from './LogTimeView.jsx';
import AttendanceView from './AttendanceView.jsx';

const TABS = [
  { key: 'timeline', label: 'My Timeline', icon: Clock },
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
          <div className="brand-mark">D</div>
          <div className="brand-name">Desklog</div>
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
        {activeTab === 'logtime' && (
          <LogTimeView userId={employee.id} managerId={employee.managerId} />
        )}
        {activeTab === 'attendance' && <AttendanceView userId={employee.id} />}
      </main>
    </div>
  );
}
