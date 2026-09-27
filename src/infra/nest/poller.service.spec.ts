import { describe, it, expect, vi, afterEach } from 'vitest';
import { PollerService } from './poller.service.js';
import type { PollOnce, PollSummary } from '../../application/poll-once.js';

const summary = (routeId: number): PollSummary => ({
  routeId,
  result: 'ok',
  vehicles: 1,
  inserted: 1,
  startedAt: new Date(),
  finishedAt: new Date(),
});

/** run()이 호출된 횟수와 "동시에 몇 개가 돌고 있었나"의 최대값을 기록하는 가짜 유스케이스 */
function slowPollOnce(delayMs: number) {
  let running = 0;
  const stats = { calls: 0, maxConcurrent: 0 };
  const uc = {
    async run(routeId: number) {
      stats.calls++;
      running++;
      stats.maxConcurrent = Math.max(stats.maxConcurrent, running);
      await new Promise((r) => setTimeout(r, delayMs));
      running--;
      return summary(routeId);
    },
  } as unknown as PollOnce;
  return { uc, stats };
}

const clockAt = (iso: string) => ({ now: () => new Date(iso) });
const KST_NOON = '2026-09-14T03:00:00Z'; // 12:00 KST → 120초 간격
const KST_3AM = '2026-09-13T18:00:00Z'; // 03:00 KST → 중단

afterEach(() => vi.useRealTimers());

describe('PollerService', () => {
  it('운행시간: tick 한 번에 노선마다 한 번 폴하고, 다음 tick을 간격 뒤에 예약한다', async () => {
    vi.useFakeTimers();
    const { uc, stats } = slowPollOnce(10);
    const svc = new PollerService(uc, clockAt(KST_NOON), {
      enabled: true,
      routeIds: [1, 2],
    });
    const p = svc.tick();
    await vi.advanceTimersByTimeAsync(25);
    await p;
    expect(stats.calls).toBe(2);
    expect(svc.last.get(1)?.result).toBe('ok');
    // 120초가 지나면 다음 바퀴
    await vi.advanceTimersByTimeAsync(120_000 + 25);
    expect(stats.calls).toBe(4);
    svc.onModuleDestroy();
  });

  it('겹치지 않는다: 앞 폴이 안 끝났으면 tick을 또 불러도 새 폴을 시작하지 않는다', async () => {
    vi.useFakeTimers();
    const { uc, stats } = slowPollOnce(1_000);
    const svc = new PollerService(uc, clockAt(KST_NOON), {
      enabled: true,
      routeIds: [1],
    });
    const first = svc.tick();
    await vi.advanceTimersByTimeAsync(100);
    await svc.tick(); // 겹쳐서 호출 (수동 트리거 상황)
    await svc.tick();
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    expect(stats.calls).toBe(1);
    expect(stats.maxConcurrent).toBe(1);
    svc.onModuleDestroy();
  });

  it('새벽에는 폴하지 않고 5분 뒤 다시 확인만 예약한다', async () => {
    vi.useFakeTimers();
    const { uc, stats } = slowPollOnce(1);
    const svc = new PollerService(uc, clockAt(KST_3AM), {
      enabled: true,
      routeIds: [1],
    });
    await svc.tick();
    expect(stats.calls).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    svc.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('DB 저장이 던져도 폴러는 죽지 않고 다음 바퀴를 예약한다', async () => {
    vi.useFakeTimers();
    const uc = {
      run: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as PollOnce;
    const svc = new PollerService(uc, clockAt(KST_NOON), {
      enabled: true,
      routeIds: [1],
    });
    await svc.tick();
    expect(vi.getTimerCount()).toBe(1);
    svc.onModuleDestroy();
  });

  it('꺼져 있으면 onModuleInit이 아무것도 안 한다', () => {
    vi.useFakeTimers();
    const { uc, stats } = slowPollOnce(1);
    const svc = new PollerService(uc, clockAt(KST_NOON), {
      enabled: false,
      routeIds: [1],
    });
    svc.onModuleInit();
    expect(stats.calls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
