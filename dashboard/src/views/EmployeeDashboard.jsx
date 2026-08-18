import { useState } from 'react';
import { Clock, PlayCircle, CalendarCheck } from 'lucide-react';
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

export default function EmployeeDashboard({ employee, employees, onEmployeeChange }) {
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
            <Avatar name={employee?.name} size={26} />
            {employee?.name ?? '—'}
          </div>
          <select
            value={employee?.id ?? ''}
            onChange={(e) => onEmployeeChange(Number(e.target.value))}
            style={{ width: '100%' }}
          >
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
        </div>

        <div className="sidebar-section">
          <h1>Manager</h1>
          <div className="empty">{employee?.managerName ?? 'Unassigned'}</div>
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
          <TimelineView selectedUserId={employee?.id} date={date} setDate={setDate} />
        )}
        {activeTab === 'logtime' && (
          <LogTimeView userId={employee?.id} managerId={employee?.managerId} />
        )}
        {activeTab === 'attendance' && <AttendanceView userId={employee?.id} />}
      </main>
    </div>
  );
}
