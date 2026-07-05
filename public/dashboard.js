const params = new URLSearchParams(location.search);
const callId = params.get('callId');

const statusText = document.getElementById('status-text');
const statusSub = document.getElementById('status-sub');
const timerEl = document.getElementById('timer');
const pulseEl = document.getElementById('pulse');
const transcriptEl = document.getElementById('transcript');
const reasoningLog = document.getElementById('reasoning-log');
const instructionInput = document.getElementById('instruction-input');
const resultCard = document.getElementById('result-card');
const resultClose = document.getElementById('result-close');
const resultTitle = document.getElementById('result-title');
const resultSummary = document.getElementById('result-summary');
const resultMeta = document.getElementById('result-meta');

resultClose.addEventListener('click', () => { resultCard.hidden = true; });

let startTime = null;
let timerHandle = null;
let agentSpeakingTimeout = null;

if (!callId) {
  statusText.textContent = 'No callId in URL';
} else {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/dashboard/${callId}`);

  ws.addEventListener('message', (msg) => {
    handleEvent(JSON.parse(msg.data));
  });

  ws.addEventListener('close', () => {
    statusSub.textContent = 'Disconnected';
  });

  instructionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && instructionInput.value.trim()) {
      ws.send(JSON.stringify({ type: 'instruction', text: instructionInput.value.trim() }));
      appendBubble('system', `Instruction sent: ${instructionInput.value.trim()}`);
      instructionInput.value = '';
    }
  });
}

function handleEvent(event) {
  switch (event.type) {
    case 'status':
      statusText.textContent = humanizeStatus(event.status);
      statusSub.textContent = humanizeMachine(event.machine);
      if (event.status === 'in_progress' && !startTime) {
        startTime = Date.now();
        timerHandle = setInterval(updateTimer, 1000);
      }
      setPulse('listening');
      break;
    case 'milestone':
      appendBubble('system', event.label);
      break;
    case 'transcript':
      appendBubble(event.entry.role, event.entry.text);
      if (event.entry.role === 'agent') setPulse('agent', 1800);
      else if (event.entry.role === 'other_party') setPulse('listening');
      break;
    case 'reasoning': {
      const div = document.createElement('div');
      div.textContent = event.text;
      reasoningLog.appendChild(div);
      reasoningLog.scrollTop = reasoningLog.scrollHeight;
      break;
    }
    case 'result': {
      clearInterval(timerHandle);
      setPulse('listening');
      const good = event.receipt.outcome === 'goal_met' || event.receipt.outcome === 'voicemail_left';
      document.getElementById('result-icon').textContent = good ? '✓' : '!';
      resultCard.style.borderLeftColor = good ? 'var(--success)' : 'var(--danger)';
      resultTitle.textContent = event.receipt.outcome.replace(/_/g, ' ');
      resultSummary.textContent = event.receipt.summary;
      resultMeta.textContent = `${(event.receipt.durationMs / 1000).toFixed(0)}s` +
        (event.receipt.quotedPrice ? ` · quoted ${event.receipt.quotedPrice}` : '') +
        (event.receipt.confirmedDetail ? ` · ${event.receipt.confirmedDetail}` : '');
      resultCard.hidden = false;
      statusText.textContent = 'Call ended';
      statusSub.textContent = humanizeStatus(event.receipt.outcome);
      break;
    }
  }
}

function setPulse(mode, revertAfterMs) {
  pulseEl.classList.remove('agent', 'listening');
  pulseEl.classList.add(mode);
  if (agentSpeakingTimeout) clearTimeout(agentSpeakingTimeout);
  if (revertAfterMs) {
    agentSpeakingTimeout = setTimeout(() => {
      pulseEl.classList.remove('agent');
      pulseEl.classList.add('listening');
    }, revertAfterMs);
  }
}

function appendBubble(role, text) {
  const div = document.createElement('div');
  div.className = `bubble ${role}`;
  div.textContent = text;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function updateTimer() {
  if (!startTime) return;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
}

function humanizeStatus(status) {
  return String(status || '').replace(/_/g, ' ');
}

function humanizeMachine(machine) {
  return String(machine || '').replace(/_/g, ' ').toLowerCase();
}
