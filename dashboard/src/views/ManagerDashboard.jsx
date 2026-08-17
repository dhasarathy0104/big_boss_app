import { useEffect, useState } from 'react';
import { todayStr } from '../format.js';
import TimelineView from './TimelineView.jsx';
import TeamView from './TeamView.jsx';
import ProjectsView from './ProjectsView.jsx';
import TimesheetReviewView from './TimesheetReviewView.jsx';

const TABS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'projects', label: 'Projects' },
  { key: 'timesheet', label: 'Timesheet' },
  { key: 'team', label: 'Team & Invite' },
];

export default function ManagerDashboard({ managerId, managers, onManagerChange }) {
  const [team, setTeam] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [activeTab, setActiveTab] = useState('timeline');

  useEffect(() => {
    if (!managerId) return;
    fetch(`/api/managers/${managerId}/team`).then((r) => r.json()).then((data) => {
      setTeam(data);
      if (data.length && !data.some((u) => u.id === selectedUserId)) {
        setSelectedUserId(data[0].id);
      }
      if (data.length === 0) setSelectedUserId(null);
    });
  }, [managerId, activeTab]);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Signed in as</h1>
        <select
          value={managerId ?? ''}
          onChange={(e) => onManagerChange(Number(e.target.value))}
          style={{ width: '100%', marginBottom: 20 }}
        >
          {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        <h1>Team</h1>
        {team.length === 0 && <div className="empty">Nobody has joined yet — see the Team &amp; Invite tab.</div>}
        {team.map((u) => (
          <div
            key={u.id}
            className={`user-item ${u.id === selectedUserId ? 'selected' : ''}`}
            onClick={() => setSelectedUserId(u.id)}
          >
            {u.name}
          </div>
        ))}
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
          <TimelineView selectedUserId={selectedUserId} date={date} setDate={setDate} />
        )}
        {activeTab === 'projects' && <ProjectsView managerId={managerId} team={team} />}
        {activeTab === 'timesheet' && <TimesheetReviewView managerId={managerId} />}
        {activeTab === 'team' && <TeamView managerId={managerId} team={team} />}
      </main>
    </div>
  );
}
