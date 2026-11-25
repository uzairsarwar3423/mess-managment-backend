import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { env } from '../config/env';

let client: Expo | null = null;

function getClient(): Expo {
  if (!client) client = new Expo(env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : {});
  return client;
}

export interface PushOutcome {
  /** Tokens Expo reported as no longer registered (should be deleted). */
  deadTokens: string[];
}

/** Sends push notifications; invalid tokens are skipped. Payloads must carry ids only, never sensitive data. */
export async function sendPush(
  tokens: string[],
  message: { title: string; body: string; data?: Record<string, unknown> },
): Promise<PushOutcome> {
  const expo = getClient();
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    sound: 'default',
    title: message.title,
    body: message.body,
    data: message.data ?? {},
  }));

  const deadTokens: string[] = [];
  for (const chunk of expo.chunkPushNotifications(messages)) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        const to = chunk[i]?.to;
        if (typeof to === 'string') deadTokens.push(to);
      }
    });
  }
  return { deadTokens };
}
