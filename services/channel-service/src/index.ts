import { config } from 'dotenv';
import express from 'express';
import { setupRoutes } from './routes';
import { startTelegramPolling } from './services/telegram';

// Carrega variáveis de ambiente
config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Setup routes
setupRoutes(app);

const INTERNAL_PORT = 3003;
const PORT = process.env.PORT || INTERNAL_PORT;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[CHANNEL-SERVICE] 🚀 Server running on port ${PORT}`);
  
  if (process.env.TELEGRAM_TOKEN) {
    startTelegramPolling();
  } else {
    console.warn('[CHANNEL-SERVICE] ⚠️ TELEGRAM_TOKEN not provided, polling disabled.');
  }
});
