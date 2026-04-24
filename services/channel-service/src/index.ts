import { config } from 'dotenv';
import express from 'express';
import { setupRoutes } from './routes';
import { iniciar as iniciarConfig, getConfig, recarregar as recarregarConfig } from './services/config';
import { startBotPolling, recarregarBots } from './services/telegram';
import { iniciar as iniciarChips } from './services/chips';

config();

const app = express();
app.use(express.json({ limit: '10mb' }));

setupRoutes(app);

const PORT = process.env.PORT || 8080;

async function bootstrap() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CHANNEL-SERVICE] 🚀 Server running on port ${PORT}`);
  });

  // Carrega config dinâmica do CRM (instâncias WA + bots TG)
  await iniciarConfig();
  iniciarChips();

  // Inicia polling Telegram para todos os bots configurados no banco
  const { telegram_bots } = getConfig();
  if (telegram_bots.length > 0) {
    for (const bot of telegram_bots) startBotPolling(bot.bot_token, bot.agent_slug);
  } else if (process.env.TELEGRAM_TOKEN) {
    // Fallback para env var durante transição (antes de configurar no painel)
    startBotPolling(process.env.TELEGRAM_TOKEN, 'mari');
  } else {
    console.warn('[CHANNEL-SERVICE] ⚠️ Nenhum bot Telegram configurado.');
  }

  // Recarrega bots Telegram quando config atualizar
  setInterval(async () => {
    await recarregarConfig().catch(() => {});
    const { telegram_bots: bots } = getConfig();
    recarregarBots(bots.map(b => ({ token: b.bot_token, agentSlug: b.agent_slug })));
  }, 2 * 60 * 1000);
}

bootstrap();
