import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { callsRouter } from './routes/calls.js';
import { twimlRouter } from './routes/twiml.js';
import { statusCallbackRouter } from './routes/status-callback.js';
import { subscribeRouter } from './routes/subscribe.js';
import { handleConversationRelayConnection } from './ws/conversation-relay-handler.js';
import { handleDashboardConnection } from './ws/dashboard-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Twilio posts webhooks as application/x-www-form-urlencoded.
app.use('/twiml', express.urlencoded({ extended: false }));
app.use('/status', express.urlencoded({ extended: false }));
app.use('/amd', express.urlencoded({ extended: false }));
// mcp-server posts JSON to trigger a dial.
app.use('/calls', express.json());

app.use(callsRouter);
app.use(twimlRouter);
app.use(statusCallbackRouter);
app.use(subscribeRouter);
app.use(express.static(path.join(__dirname, '../../public')));

app.get('/health', (_req, res) => res.json({ ok: true }));

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '', 'http://localhost');
  const dashboardMatch = url.pathname.match(/^\/ws\/dashboard\/(.+)$/);
  const callMatch = url.pathname.match(/^\/ws\/(.+)$/);

  if (dashboardMatch) {
    const callId = dashboardMatch[1] as string;
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleDashboardConnection(ws, callId);
    });
  } else if (callMatch) {
    const callId = callMatch[1] as string;
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConversationRelayConnection(ws, callId);
    });
  } else {
    socket.destroy();
  }
});

server.listen(config.appServer.port, () => {
  console.log(`app-server listening on :${config.appServer.port}`);
  console.log(`public URL: ${config.appServer.publicUrl}`);
});
