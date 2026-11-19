import type { Logger } from '../logger.js';

export interface Notifier {
  send(text: string): Promise<void>;
}

export class LogNotifier implements Notifier {
  constructor(private readonly log: Logger) {}
  async send(text: string): Promise<void> {
    this.log.info({ alert: text }, 'guardian alert');
  }
}

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly log: Logger,
  ) {}

  async send(text: string): Promise<void> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) this.log.warn({ status: res.status, body: await res.text() }, 'telegram send failed');
    } catch (err) {
      this.log.warn({ err }, 'telegram send failed');
    }
  }
}

export class MemoryNotifier implements Notifier {
  readonly sent: string[] = [];
  async send(text: string): Promise<void> {
    this.sent.push(text);
  }
}

export class FanoutNotifier implements Notifier {
  constructor(private readonly targets: Notifier[]) {}
  async send(text: string): Promise<void> {
    await Promise.all(this.targets.map((t) => t.send(text)));
  }
}
