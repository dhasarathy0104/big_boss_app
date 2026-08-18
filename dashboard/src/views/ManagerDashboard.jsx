import { useEffect, useState } from 'react';
import {
  Activity, Camera, KanbanSquare, Clock, CalendarCheck, Receipt, Tags, UserPlus,
} from 'lucide-react';
import { todayStr } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import LiveView from './LiveView.jsx';
import TimelineView from './TimelineView.jsx';
import ScreenshotsView from './ScreenshotsView.jsx';
import TeamView from './TeamView.jsx';
import ProjectsView from './ProjectsView.jsx';
import TimesheetReviewView from './TimesheetReviewView.jsx';
import CategoriesView from './CategoriesView.jsx';
import AttendanceReviewView from './AttendanceReviewView.jsx';
import BillingView from './BillingView.jsx';

const TABS = [
  { key: 'live', label: 'Live', icon: Activity },
  { key: 'timeline', label: 'Timeline', icon: Clock },
  { key: 'screenshots', label: 'Screenshots', icon: Camera },
  { key: 'projects', label: 'Projects', icon: KanbanSquare },
  { key: 'timesheet', label: 'Timesheet', icon: Clock },
  { key: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { key: 'billing', label: 'Billing', icon: Receipt },
  { key: 'categories', label: 'Categories', icon: Tags },
  { key: 'team', label: 'Team & Invite', icon: UserPlus },
];

export default function ManagerDashboard({ managerId, managers, onManagerChange }) {
  const [team, setTeam] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [activeTab, setActiveTab] = useState('live');

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
        <div className="brand">
          <div className="brand-mark">D</div>
          <div className="brand-name">Desklog</div>
        </div>

        <div className="sidebar-section">
          <h1>Signed in as</h1>
          <select
            value={managerId ?? ''}
            onChange={(e) => onManagerChange(Number(e.target.value))}
            style={{ width: '100%' }}
          >
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div className="sidebar-section">
          <h1>Team ({team.length})</h1>
          {team.length === 0 && <div className="empty">Nobody has joined yet — see the Team &amp; Invite tab.</div>}
          {team.map((u) => (
            <div
              key={u.id}
              className={`user-item ${u.id === selectedUserId ? 'selected' : ''}`}
              onClick={() => setSelectedUserId(u.id)}
            >
              <Avatar name={u.name} size={26} />
              {u.name}
            </div>
          ))}
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

        {activeTab === 'live' && (
          <LiveView
            managerId={managerId}
            onSelectMember={(id) => { setSelectedUserId(id); setActiveTab('timeline'); }}
          />
        )}
        {activeTab === 'timeline' && (
          <TimelineView selectedUserId={selectedUserId} date={date} setDate={setDate} />
        )}
        {activeTab === 'screenshots' && <ScreenshotsView selectedUserId={selectedUserId} managerId={managerId} />}
        {activeTab === 'projects' && <ProjectsView managerId={managerId} team={team} />}
        {activeTab === 'timesheet' && <TimesheetReviewView managerId={managerId} />}
        {activeTab === 'attendance' && <AttendanceReviewView managerId={managerId} />}
        {activeTab === 'billing' && <BillingView managerId={managerId} />}
        {activeTab === 'categories' && <CategoriesView managerId={managerId} />}
        {activeTab === 'team' && <TeamView managerId={managerId} team={team} />}
      </main>
    </div>
  );
}
