import { describe, it, expect } from 'vitest';
import { hourIn, pollIntervalMs, estimatedCallsPerDay } from './schedule.js';

const kst = (hhmm: string) => new Date(`2026-09-14T${hhmm}:00+09:00`);

describe('hourIn (KST)', () => {
  it('UTC 자정 = KST 09시', () => {
    expect(hourIn(new Date('2026-09-14T00:00:00Z'))).toBe(9);
  });
  it('KST 자정은 0 (24가 아니라)', () => {
    expect(hourIn(kst('00:00'))).toBe(0);
  });
});

describe('pollIntervalMs', () => {
  it('새벽 00~05시는 중단', () => {
    expect(pollIntervalMs(kst('00:00'))).toBeNull();
    expect(pollIntervalMs(kst('04:59'))).toBeNull();
    expect(pollIntervalMs(kst('05:00'))).toBe(120_000);
  });
  it('출퇴근은 60초, 나머지는 120초', () => {
    expect(pollIntervalMs(kst('07:00'))).toBe(60_000);
    expect(pollIntervalMs(kst('08:59'))).toBe(60_000);
    expect(pollIntervalMs(kst('09:00'))).toBe(120_000);
    expect(pollIntervalMs(kst('17:30'))).toBe(60_000);
    expect(pollIntervalMs(kst('20:00'))).toBe(120_000);
    expect(pollIntervalMs(kst('23:59'))).toBe(120_000);
  });
  it('서버가 UTC여도 같은 순간이면 같은 답 (같은 시각의 다른 표기)', () => {
    expect(pollIntervalMs(new Date('2026-09-13T23:00:00Z'))).toBe(
      pollIntervalMs(kst('08:00')),
    );
  });
});

describe('폴링 예산', () => {
  it('노선 하나 하루 호출이 1,000건 한도 안', () => {
    const n = estimatedCallsPerDay();
    expect(n).toBeLessThan(1_000);
    expect(n).toBeGreaterThan(500);
  });
});
