import { useEffect, useState } from 'react';

const CATEGORIES = ['productive', 'neutral', 'unproductive'];

export default function CategoriesView({ managerId }) {
  const [defaults, setDefaults] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [form, setForm] = useState({ appPattern: '', category: 'productive', isEngagedApp: false });

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
    setForm({ appPattern: '', category: 'productive', isEngagedApp: false });
    loadOverrides();
  }

  async function removeOverride(id) {
    await fetch(`/api/category-rules/${id}`, { method: 'DELETE' });
    loadOverrides();
  }

  return (
    <>
      <div className="panel">
        <h2>Add or override a classification</h2>
        <p className="join-sub" style={{ marginTop: 0 }}>
          App name should match the process name shown in the timeline (e.g. "chrome", "discord").
          Engaged apps count idle time as work — use it for anything where someone might sit still
          on purpose, like video calls or reading.
        </p>
        <form className="inline-form" onSubmit={addOverride}>
          <input
            placeholder="App name (e.g. chrome)"
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
            <thead><tr><th>App</th><th>Category</th><th>Engaged</th><th></th></tr></thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.id}>
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
        <h2>Built-in defaults ({defaults.length})</h2>
        <div className="empty" style={{ marginBottom: 8 }}>Reference only — add an override above to change any of these.</div>
        <table>
          <thead><tr><th>App</th><th>Category</th><th>Engaged</th></tr></thead>
          <tbody>
            {defaults.map((d) => (
              <tr key={d.appPattern}>
                <td>{d.appPattern}</td>
                <td className={`cat-${d.category}`}>{d.category}</td>
                <td>{d.isEngagedApp ? 'Yes' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
