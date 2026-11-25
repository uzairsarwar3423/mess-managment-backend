import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  repo: { insert: vi.fn() },
  tokens: { listForUser: vi.fn(), removeTokens: vi.fn() },
  push: { sendPush: vi.fn() },
}));
vi.mock('../../src/modules/notifications/notifications.repository', () => m.repo);
vi.mock('../../src/modules/notifications/pushTokens.repository', () => m.tokens);
vi.mock('../../src/lib/expoPush', () => m.push);

import { notifyStudent } from '../../src/modules/notifications/notifications.service';
import { formatDate, templates } from '../../src/modules/notifications/templates';

const input = {
  messId: 'm1', studentId: 's1', type: 'payment_approved' as const,
  title: 'Payment approved', body: 'Active until 24 Dec 2026.', data: { payment_id: 'p1' },
};

beforeEach(() => {
  vi.resetAllMocks();
  m.repo.insert.mockResolvedValue(undefined);
  m.tokens.listForUser.mockResolvedValue(['ExponentPushToken[abc]']);
  m.tokens.removeTokens.mockResolvedValue(undefined);
  m.push.sendPush.mockResolvedValue({ deadTokens: [] });
});

describe('notifyStudent', () => {
  it('stores the notification and pushes it with ids only', async () => {
    await notifyStudent(input);
    expect(m.repo.insert).toHaveBeenCalledWith({
      mess_id: 'm1', student_id: 's1', type: 'payment_approved', title: input.title, body: input.body, data: { payment_id: 'p1' },
    });
    expect(m.push.sendPush).toHaveBeenCalledWith(['ExponentPushToken[abc]'], {
      title: input.title, body: input.body, data: { type: 'payment_approved', payment_id: 'p1' },
    });
  });

  it('removes tokens that Expo reports as dead', async () => {
    m.push.sendPush.mockResolvedValue({ deadTokens: ['ExponentPushToken[abc]'] });
    await notifyStudent(input);
    expect(m.tokens.removeTokens).toHaveBeenCalledWith(['ExponentPushToken[abc]']);
  });

  it('skips the push when the student has no registered device', async () => {
    m.tokens.listForUser.mockResolvedValue([]);
    await notifyStudent(input);
    expect(m.push.sendPush).not.toHaveBeenCalled();
    expect(m.repo.insert).toHaveBeenCalled();
  });

  it('never throws: a database or push failure must not undo the business action', async () => {
    m.repo.insert.mockRejectedValue(new Error('db down'));
    m.push.sendPush.mockRejectedValue(new Error('expo down'));
    await expect(notifyStudent(input)).resolves.toBeUndefined();
  });
});

describe('templates', () => {
  it('formats dates and messages', () => {
    expect(formatDate('2026-12-24')).toBe('24 Dec 2026');
    expect(templates.paymentApproved('2026-12-24').body).toBe('Your subscription is active until 24 Dec 2026.');
    expect(templates.paymentRejected('Unreadable screenshot').body).toBe('Reason: Unreadable screenshot');
  });
});
