import { useEffect, useState } from 'react';
import { todayStr } from './format.js';
import TimelineView from './views/TimelineView.jsx';
import TeamView from './views/TeamView.jsx';
import JoinPage from './views/JoinPage.jsx';

const TABS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'team', label: 'Team & Invite' },
];

function ManagerDashboard() {
  const [managers, setManagers] = useState([]);
  const [managerId, setManagerId] = useState(null);
  const [newManagerName, setNewManagerName] = useState('');
  const [team, setTeam] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [activeTab, setActiveTab] = useState('timeline');

  function loadManagers() {
    fetch('/api/managers').then((r) => r.json()).then((data) => {
      setManagers(data);
      if (data.length && !managerId) setManagerId(data[0].id);
    });
  }

  useEffect(loadManagers, []);

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

  async function createManager(e) {
    e.preventDefault();
    if (!newManagerName.trim()) return;
    const res = await fetch('/api/managers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: newManagerName.trim() }),
    });
    const manager = await res.json();
    setNewManagerName('');
    setManagers((prev) => [...prev, manager]);
    setManagerId(manager.id);
  }

  if (managers.length === 0) {
    return (
      <div className="join-page">
        <div className="join-card">
          <h1>Set up your manager account</h1>
          <p className="join-sub">This is the identity your team will see activity reported under.</p>
          <form className="stacked-form" onSubmit={createManager}>
            <input
              placeholder="Your name"
              value={newManagerName}
              onChange={(e) => setNewManagerName(e.target.value)}
            />
            <button type="submit" style={{ alignSelf: 'flex-start' }}>Create account</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Signed in as</h1>
        <select value={managerId ?? ''} onChange={(e) => setManagerId(Number(e.target.value))} style={{ width: '100%', marginBottom: 20 }}>
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
        {activeTab === 'team' && <TeamView managerId={managerId} team={team} />}
      </main>
    </div>
  );
}

export default function App() {
  const path = window.location.pathname;
  const joinMatch = path.match(/^\/join\/([^/]+)/);

  if (joinMatch) {
    return <JoinPage token={joinMatch[1]} />;
  }

  return <ManagerDashboard />;
}
