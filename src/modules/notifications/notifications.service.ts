import { logger } from '../../lib/logger';
import { sendPush } from '../../lib/expoPush';
import * as repository from './notifications.repository';
import type { NotificationType } from './notifications.repository';
import * as pushTokens from './pushTokens.repository';

export interface NotifyInput {
  messId: string;
  studentId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Ids for deep links only (e.g. { payment_id }). */
  data?: Record<string, unknown>;
}

/**
 * Creates the in-app notification and sends a push. NEVER throws: a notification problem must not
 * undo a business action such as a payment approval. Failures are logged.
 */
export async function notifyStudent(input: NotifyInput): Promise<void> {
  const data = input.data ?? {};
  try {
    await repository.insert({
      mess_id: input.messId,
      student_id: input.studentId,
      type: input.type,
      title: input.title,
      body: input.body,
      data,
    });
  } catch (err) {
    logger.error({ err, type: input.type }, 'could not store notification');
  }

  try {
    const tokens = await pushTokens.listForUser(input.studentId);
    if (tokens.length === 0) return;
    const { deadTokens } = await sendPush(tokens, { title: input.title, body: input.body, data: { type: input.type, ...data } });
    await pushTokens.removeTokens(deadTokens);
  } catch (err) {
    logger.warn({ err, type: input.type }, 'could not send push notification');
  }
}
