import { useState } from 'react';
import { todayStr } from '../format.js';
import TimelineView from './TimelineView.jsx';
import LogTimeView from './LogTimeView.jsx';

const TABS = [
  { key: 'timeline', label: 'My Timeline' },
  { key: 'logtime', label: 'Log Time' },
];

export default function EmployeeDashboard({ employee, employees, onEmployeeChange }) {
  const [date, setDate] = useState(todayStr());
  const [activeTab, setActiveTab] = useState('timeline');

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Signed in as</h1>
        <select
          value={employee?.id ?? ''}
          onChange={(e) => onEmployeeChange(Number(e.target.value))}
          style={{ width: '100%', marginBottom: 20 }}
        >
          {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </select>

        <h1>Manager</h1>
        <div className="empty">{employee?.managerName ?? 'Unassigned'}</div>
      </aside>

      <main className="main">
        <div className="tabs">
          {TABS.map((t) => (
            <div
              key={t.key}
              className={`tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
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
      </main>
    </div>
  );
}
