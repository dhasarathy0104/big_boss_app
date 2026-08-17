const AGENT_URL = 'http://127.0.0.1:34909';

const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');

fetch(`${AGENT_URL}/status`)
  .then((r) => r.json())
  .then((data) => {
    dot.className = 'dot on';
    statusText.textContent = data.enrolledAs
      ? `Connected — tracking as ${data.enrolledAs}`
      : 'Connected';
  })
  .catch(() => {
    dot.className = 'dot off';
    statusText.textContent = 'Agent not running on this computer';
  });
