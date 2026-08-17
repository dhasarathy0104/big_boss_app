import { useEffect, useState } from 'react';

const CATEGORIES = ['productive', 'neutral', 'unproductive'];

export default function CategoriesView({ managerId }) {
  const [defaults, setDefaults] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [form, setForm] = useState({ appPattern: '', category: 'productive', isEngagedApp: false, ruleType: 'app' });

  function loadOverrides() {
    fetch(`/api/category-rules?managerId=${managerId}`).then((r) => r.json()).then(setOverrides);
  }

  useEffect(() => {
    fetch('/api/category-rules/defaults').then((r) => r.json()).then(setDefaults);
  }, []);

  useEffect(() => { if (managerId) loadOverrides(); }, [managerId]);

  async function addOverride(e) {
    e.preventDefault();
    if (!form.appPattern.trim()) return;
    await fetch('/api/category-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ managerId, ...form }),
    });
    setForm({ appPattern: '', category: 'productive', isEngagedApp: false, ruleType: form.ruleType });
    loadOverrides();
  }

  async function removeOverride(id) {
    await fetch(`/api/category-rules/${id}`, { method: 'DELETE' });
    loadOverrides();
  }

  const defaultApps = defaults.filter((d) => d.ruleType === 'app');
  const defaultDomains = defaults.filter((d) => d.ruleType === 'domain');

  return (
    <>
      <div className="panel">
        <h2>Add or override a classification</h2>
        <p className="join-sub" style={{ marginTop: 0 }}>
          <strong>App</strong> matches the process name shown in the timeline (e.g. "spotify").
          <strong> Domain</strong> matches a website visited in a tracked browser (e.g. "youtube.com") —
          this is what the browser extension makes possible, since a window title alone can't tell you
          which site someone's actually on. Engaged apps count idle time as work — use it for anything
          where someone might sit still on purpose, like video calls or reading.
        </p>
        <form className="inline-form" onSubmit={addOverride}>
          <select value={form.ruleType} onChange={(e) => setForm({ ...form, ruleType: e.target.value })}>
            <option value="app">App</option>
            <option value="domain">Domain</option>
          </select>
          <input
            placeholder={form.ruleType === 'domain' ? 'Domain (e.g. youtube.com)' : 'App name (e.g. chrome)'}
            value={form.appPattern}
            onChange={(e) => setForm({ ...form, appPattern: e.target.value })}
          />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.isEngagedApp}
              onChange={(e) => setForm({ ...form, isEngagedApp: e.target.checked })}
            />
            Engaged app
          </label>
          <button type="submit">Save</button>
        </form>
      </div>

      <div className="panel">
        <h2>Your overrides ({overrides.length})</h2>
        {overrides.length === 0 ? (
          <div className="empty">No overrides yet — using built-in defaults below.</div>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Pattern</th><th>Category</th><th>Engaged</th><th></th></tr></thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.id}>
                  <td>{o.rule_type}</td>
                  <td>{o.app_pattern}</td>
                  <td className={`cat-${o.category}`}>{o.category}</td>
                  <td>{o.is_engaged_app ? 'Yes' : '—'}</td>
                  <td><button className="btn-small btn-danger" onClick={() => removeOverride(o.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Built-in app defaults ({defaultApps.length})</h2>
        <div className="empty" style={{ marginBottom: 8 }}>Reference only — add an override above to change any of these.</div>
        <table>
          <thead><tr><th>App</th><th>Category</th><th>Engaged</th></tr></thead>
          <tbody>
            {defaultApps.map((d) => (
              <tr key={d.appPattern}>
                <td>{d.appPattern}</td>
                <td className={`cat-${d.category}`}>{d.category}</td>
                <td>{d.isEngagedApp ? 'Yes' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Built-in domain defaults ({defaultDomains.length})</h2>
        <div className="empty" style={{ marginBottom: 8 }}>
          Only applies to time tracked via the browser extension — see the "Team & Invite" tab for the extension setup link.
        </div>
        <table>
          <thead><tr><th>Domain</th><th>Category</th></tr></thead>
          <tbody>
            {defaultDomains.map((d) => (
              <tr key={d.appPattern}>
                <td>{d.appPattern}</td>
                <td className={`cat-${d.category}`}>{d.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
