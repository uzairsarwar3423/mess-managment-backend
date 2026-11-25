import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  cron: { schedule: vi.fn() },
  jobs: { refreshStatuses: vi.fn(), sendExpiryReminders: vi.fn() },
}));
vi.mock('node-cron', () => ({ default: m.cron }));
vi.mock('../../src/modules/subscriptions/subscriptions.jobs', () => m.jobs);

import { guarded, startJobs } from '../../src/jobs';

beforeEach(() => {
  vi.resetAllMocks();
  m.cron.schedule.mockImplementation(() => ({ stop: vi.fn() }));
  m.jobs.refreshStatuses.mockResolvedValue(0);
  m.jobs.sendExpiryReminders.mockResolvedValue({ expiring: 0, expired: 0 });
});

describe('guarded', () => {
  it('never throws, even when the job fails', async () => {
    const run = guarded('boom', async () => {
      throw new Error('db down');
    });
    await expect(run()).resolves.toBeUndefined();
  });

  it('skips a run while the previous one is still going, then recovers', async () => {
    let release: () => void = () => undefined;
    const task = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const run = guarded('slow', task);

    const first = run();
    await run(); // overlapping call is skipped
    expect(task).toHaveBeenCalledTimes(1);

    release();
    await first;
    const next = run();
    release();
    await next;
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe('startJobs', () => {
  it('schedules the nightly refresh (00:05) and the reminders (09:00) in the configured time zone', () => {
    startJobs();
    expect(m.cron.schedule).toHaveBeenCalledTimes(2);
    expect(m.cron.schedule).toHaveBeenCalledWith('5 0 * * *', expect.any(Function), { timezone: 'Asia/Karachi' });
    expect(m.cron.schedule).toHaveBeenCalledWith('0 9 * * *', expect.any(Function), { timezone: 'Asia/Karachi' });
  });

  it('catches up on statuses at startup and wires the schedules to the right jobs', async () => {
    startJobs();
    await vi.waitFor(() => expect(m.jobs.refreshStatuses).toHaveBeenCalledTimes(1)); // startup catch-up
    expect(m.jobs.sendExpiryReminders).not.toHaveBeenCalled(); // reminders wait for 09:00

    const calls = m.cron.schedule.mock.calls as [string, () => void][];
    const refreshCb = calls[0]![1];
    const remindCb = calls[1]![1];
    refreshCb();
    await vi.waitFor(() => expect(m.jobs.refreshStatuses).toHaveBeenCalledTimes(2));
    remindCb();
    await vi.waitFor(() => expect(m.jobs.sendExpiryReminders).toHaveBeenCalledTimes(1));
  });

  it('stop() stops every task', () => {
    const stops = [vi.fn(), vi.fn()];
    m.cron.schedule.mockImplementationOnce(() => ({ stop: stops[0] })).mockImplementationOnce(() => ({ stop: stops[1] }));
    startJobs().stop();
    expect(stops[0]).toHaveBeenCalled();
    expect(stops[1]).toHaveBeenCalled();
  });
});
