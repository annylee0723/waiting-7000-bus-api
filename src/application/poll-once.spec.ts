// application 테스트: 포트를 전부 인메모리 가짜로. Nest도 DB도 네트워크도 없다.
import { describe, it, expect } from 'vitest';
import { PollOnce } from './poll-once.js';
import type { GbisPort, ObservationRepo, PollRun } from '../domain/ports.js';
import type { GbisResult, VehicleObservation } from '../domain/gbis/types.js';

const obs = (
  plateNo: string,
  seq: number,
  observedAt: Date,
): VehicleObservation => ({
  plateNo,
  stationId: 1,
  stationSeq: seq,
  state: 'departed',
  remainSeats: 10,
  crowding: 'relaxed',
  lowFloor: false,
  observedAt,
});

/** 진짜 DB 대신: 폴 기록 배열 + (route, plate, time) 키로 중복을 거르는 Set */
function fakeRepo() {
  const runs: PollRun[] = [];
  const seen = new Set<string>();
  const repo: ObservationRepo = {
    async savePoll(run, observations) {
      runs.push(run);
      let inserted = 0;
      for (const o of observations) {
        const key = `${run.routeId}|${o.plateNo}|${o.observedAt.toISOString()}`;
        if (!seen.has(key)) {
          seen.add(key);
          inserted++;
        }
      }
      return { inserted };
    },
  };
  return { repo, runs, seen };
}

const gbisReturning = (
  r: GbisResult<VehicleObservation> | Error,
): GbisPort => ({
  fetchStations: () => Promise.reject(new Error('unused')),
  fetchLine: () => Promise.reject(new Error('unused')),
  fetchLocations: () =>
    r instanceof Error ? Promise.reject(r) : Promise.resolve(r),
});

const fixedClock = (iso: string) => ({ now: () => new Date(iso) });
const T = new Date('2026-09-14T05:00:00Z');

describe('PollOnce', () => {
  it('ok: 관측을 저장하고 폴 기록에 vehicles를 남긴다', async () => {
    const { repo, runs } = fakeRepo();
    const uc = new PollOnce(
      gbisReturning({
        kind: 'ok',
        queryTime: T,
        items: [obs('A', 1, T), obs('B', 5, T)],
      }),
      repo,
      fixedClock('2026-09-14T05:00:01Z'),
    );
    const s = await uc.run(239000141);
    expect(s).toMatchObject({ result: 'ok', vehicles: 2, inserted: 2 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      routeId: 239000141,
      result: 'ok',
      vehicles: 2,
    });
  });

  it('empty(새벽): 관측 없이 폴 기록만', async () => {
    const { repo, runs } = fakeRepo();
    const uc = new PollOnce(
      gbisReturning({ kind: 'empty', queryTime: T }),
      repo,
      fixedClock('2026-09-14T05:00:01Z'),
    );
    expect(await uc.run(1)).toMatchObject({
      result: 'empty',
      vehicles: 0,
      inserted: 0,
    });
    expect(runs[0]!.result).toBe('empty');
  });

  it('error(한도 초과 22): 폴 기록에 코드와 메시지', async () => {
    const { repo, runs } = fakeRepo();
    const uc = new PollOnce(
      gbisReturning({ kind: 'error', code: 22, message: 'LIMITED' }),
      repo,
      fixedClock('2026-09-14T05:00:01Z'),
    );
    expect(await uc.run(1)).toMatchObject({
      result: 'error',
      detail: '22 LIMITED',
    });
    expect(runs[0]).toMatchObject({ result: 'error', detail: '22 LIMITED' });
  });

  it('failed(HTTP 3번 다 실패): 던지지 않고 failed로 기록한다 — 폴러는 죽으면 안 된다', async () => {
    const { repo, runs } = fakeRepo();
    const uc = new PollOnce(
      gbisReturning(new Error('GBIS 요청 3번 모두 실패')),
      repo,
      fixedClock('2026-09-14T05:00:01Z'),
    );
    expect(await uc.run(1)).toMatchObject({ result: 'failed', detail: /3번/ });
    expect(runs[0]!.result).toBe('failed');
  });

  it('같은 응답을 두 번 저장하면 두 번째는 inserted 0 (멱등은 저장소가 보장)', async () => {
    const { repo } = fakeRepo();
    const uc = new PollOnce(
      gbisReturning({ kind: 'ok', queryTime: T, items: [obs('A', 1, T)] }),
      repo,
      fixedClock('2026-09-14T05:00:01Z'),
    );
    expect((await uc.run(1)).inserted).toBe(1);
    expect((await uc.run(1)).inserted).toBe(0);
  });
});
