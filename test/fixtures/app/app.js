const status = document.querySelector('#status');
const clickCount = document.querySelector('#click-count');
const submittedMessage = document.querySelector('#submitted-message');
let count = 0;

function setStatus(state, message) {
  status.dataset.state = state;
  status.textContent = message;
}

document.querySelector('#click-target').addEventListener('click', () => {
  count += 1;
  clickCount.value = String(count);
  setStatus('clicked', `Counter incremented to ${count}`);
  console.info('fixture:counter', { count });
});

document.querySelector('#cover-click-target').addEventListener('click', () => {
  const target = document.querySelector('#click-target');
  const bounds = target.getBoundingClientRect();
  const overlay = document.createElement('button');
  overlay.id = 'click-overlay';
  overlay.type = 'button';
  overlay.textContent = 'Remove counter cover';
  Object.assign(overlay.style, {
    position: 'fixed',
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    zIndex: '9999',
  });
  overlay.addEventListener('click', () => overlay.remove());
  document.body.append(overlay);
});

document.querySelector('#message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const message = new FormData(event.currentTarget).get('message');
  submittedMessage.hidden = false;
  submittedMessage.textContent = `Submitted: ${message}`;
  setStatus('submitted', `Submitted message: ${message}`);
  console.info('fixture:submitted', { message });
});

async function request(path, successState) {
  setStatus('loading', `Requesting ${path}`);
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const payload = await response.json();
    setStatus(successState, payload.message);
  } catch (error) {
    setStatus('request-failed', `${error.name}: ${error.message}`);
    console.error('fixture:request-failed', error);
  }
}

document.querySelector('#request-ok').addEventListener('click', () => {
  void request('/api/ok', 'request-succeeded');
});

document.querySelector('#request-http-error').addEventListener('click', () => {
  void request('/api/http-error', 'unexpected-success');
});

document.querySelector('#request-network-failure').addEventListener('click', () => {
  void request('/api/disconnect', 'unexpected-success');
});

document.querySelector('#console-error').addEventListener('click', () => {
  console.error('fixture:deliberate-console-error', { source: 'console-error button' });
  setStatus('console-error', 'A deliberate console error was logged');
});

document.querySelector('#runtime-error').addEventListener('click', () => {
  setStatus('runtime-error', 'A deliberate runtime error was thrown');
  throw new Error('fixture:deliberate-runtime-error');
});

document.querySelector('#reload-page').addEventListener('click', () => {
  setTimeout(() => window.location.reload(), 50);
});

document.querySelector('#flood-errors').addEventListener('click', () => {
  const payload = 'x'.repeat(2048);
  for (let index = 0; index < 80; index += 1) {
    console.error(`fixture:flood:${index}:${payload}`);
  }
  console.error(`fixture:oversized:${'\u{1F642}'.repeat(12000)}`);
  setStatus('flooded', 'Generated oversized and bounded-retention test errors');
});

window.fixtureReady = true;
console.info('fixture:ready');
