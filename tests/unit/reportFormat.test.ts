import { describe, expect, it } from 'vitest';
import {
  dateLabel, dateTimeLabel, localDate, longDateLabel, methodLabel, money, monthLabel, statusLabel, timeLabel,
} from '../../src/modules/reports/format';

describe('report formatting', () => {
  it('money drops needless decimals and groups thousands', () => {
    expect(money(8500)).toBe('Rs. 8,500');
    expect(money('8500.00')).toBe('Rs. 8,500');
    expect(money('8500.50')).toBe('Rs. 8,500.50');
    expect(money(1105000)).toBe('Rs. 1,105,000');
    expect(money(0)).toBe('Rs. 0');
  });

  it('dates and months', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(monthLabel('2026-01')).toBe('January 2026');
    expect(dateLabel('2026-11-25')).toBe('25 Nov 2026');
    expect(longDateLabel('2026-11-25')).toBe('Wednesday, 25 Nov 2026');
  });

  it('times use the mess time zone (Karachi is UTC+5)', () => {
    expect(timeLabel('2026-11-25T07:05:00Z', 'Asia/Karachi')).toBe('12:05');
    expect(dateTimeLabel('2026-11-25T07:05:00Z', 'Asia/Karachi')).toBe('25 Nov 2026, 12:05');
    // 19:30 UTC is already the next day in Karachi
    expect(localDate('2026-11-25T19:30:00Z', 'Asia/Karachi')).toBe('2026-11-26');
    expect(timeLabel('2026-11-25T19:30:00Z', 'Asia/Karachi')).toBe('00:30');
  });

  it('labels', () => {
    expect(methodLabel('easypaisa')).toBe('EasyPaisa');
    expect(methodLabel('nayapay')).toBe('NayaPay');
    expect(methodLabel('bank')).toBe('Bank');
    expect(statusLabel('approved')).toBe('Approved');
  });
});
