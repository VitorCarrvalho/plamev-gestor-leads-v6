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

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`[CHANNEL-SERVICE] 🚀 Server running on port ${PORT}`);
  
  if (process.env.TELEGRAM_TOKEN) {
    startTelegramPolling();
  } else {
    console.warn('[CHANNEL-SERVICE] ⚠️ TELEGRAM_TOKEN not provided, polling disabled.');
  }
});
