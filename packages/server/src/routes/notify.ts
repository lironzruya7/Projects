import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { setSetting } from '../db/db.js';
import { composeDigest, getNotifyConfig, sendNotification, sendTest, type NotifyConfig } from '../notify/notify.js';

const NotifyBody = z.object({
  enabled: z.boolean(),
  channel: z.enum(['ntfy', 'telegram', 'webhook']),
  url: z.string(),
  telegramBotToken: z.string(),
  telegramChatId: z.string(),
  includeAmounts: z.boolean(),
});

/** Mask the Telegram bot token before sending config to the client. */
function redact(cfg: NotifyConfig): Omit<NotifyConfig, 'telegramBotToken'> & { telegramTokenSet: boolean } {
  const { telegramBotToken, ...rest } = cfg;
  return { ...rest, telegramTokenSet: Boolean(telegramBotToken) };
}

export async function notifyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/notify/settings', async () => redact(getNotifyConfig()));

  app.put('/api/notify/settings', async (req) => {
    const body = NotifyBody.parse(req.body);
    // Keep the existing token when the client sends an empty string (it never
    // receives the real token, so blank = "unchanged").
    const current = getNotifyConfig();
    const next: NotifyConfig = { ...body, telegramBotToken: body.telegramBotToken || current.telegramBotToken };
    setSetting('notify', next);
    return redact(next);
  });

  // Send a test message using the CURRENT saved config (so the owner verifies wiring).
  app.post('/api/notify/test', async () => {
    const cfg = getNotifyConfig();
    return sendTest({ ...cfg, enabled: true });
  });

  // Compose + send the spending digest now (a cron/pm2 job can hit this weekly).
  app.post('/api/notify/digest', async () => {
    const { title, message } = composeDigest();
    const res = await sendNotification(title, message);
    return { ...res, preview: message };
  });
}
