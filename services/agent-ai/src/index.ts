import { config } from 'dotenv';
import express from 'express';
import { startConsumer } from './pipeline/consumer';

config();

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, service: 'agent-ai' }));

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[AGENT-AI] 🧠 Server running on port ${PORT}`);
  startConsumer().catch(err => {
    console.error('[AGENT-AI] ❌ Failed to start consumer:', err);
  });
});
