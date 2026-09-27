import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations } from './migrate.js';
import { loadRoute } from './route-repo.js';
import { PgObservationRepo, lastPolls } from './observation-repo.js';
import {
  parseLine,
  parseLocations,
  parseStations,
} from '../../domain/gbis/parse.js';
import type { Queryable } from './queryable.js';
import type { VehicleObservation } from '../../domain/gbis/types.js';

const MIGRATIONS = fileURLToPath(
  new URL('../../../migrations', import.meta.url),
);
const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/gbis/${name}.json`, import.meta.url),
      'utf8',
    ),
  );

let pg: PGlite;
let db: Queryable;
let repo: PgObservationRepo;
const ROUTE = 239000141;
const run = (
  result: 'ok' | 'empty' | 'error' | 'failed',
  vehicles: number,
  at: string,
  detail?: string,
) => ({
  routeId: ROUTE,
  startedAt: new Date(at),
  finishedAt: new Date(new Date(at).getTime() + 200),
  result,
  vehicles,
  detail,
});

beforeAll(async () => {
  pg = new PGlite();
  db = pg as unknown as Queryable;
  await runMigrations(db, MIGRATIONS);
  const st = parseStations(fixture('stations-7002'));
  const ln = parseLine(fixture('line-7002'));
  if (st.kind !== 'ok' || ln.kind !== 'ok') throw new Error('fixture');
  await loadRoute(
    db,
    { id: ROUTE, routeNo: '7002', name: 'x', turnSeq: 31 },
    st.items,
    ln.items,
  );
  repo = new PgObservationRepo(db);
});
afterAll(() => pg.close());

describe('마이그레이션 002', () => {
  it('001·002가 순서대로 기록돼 있다', async () => {
    const { rows } = await db.query<{ name: string }>(
      'SELECT name FROM schema_migration ORDER BY name',
    );
    expect(rows.map((r) => r.name)).toEqual([
      '001_init.sql',
      '002_observation.sql',
    ]);
  });
});

describe('PgObservationRepo.savePoll', () => {
  it('녹화된 실제 위치 응답 1건을 저장한다', async () => {
    const loc = parseLocations(fixture('locations-7002'));
    if (loc.kind !== 'ok') throw new Error(loc.kind);
    const r = await repo.savePoll(
      run('ok', loc.items.length, '2026-09-11T14:00:13Z'),
      loc.items,
    );
    expect(r.inserted).toBe(1);
    const { rows } = await db.query<{
      plate_no: string;
      station_seq: number;
      state: string;
      crowding: string;
      observed_at: Date;
    }>(
      'SELECT plate_no, station_seq, state, crowding, observed_at FROM vehicle_observation',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      plate_no: '경기77자6176',
      station_seq: 17,
      state: 'departed',
      crowding: 'relaxed',
    });
    expect(rows[0]!.observed_at.toISOString()).toBe('2026-09-11T14:00:13.349Z');
  });

  it('같은 관측을 다시 저장하면 inserted 0, 행 수 그대로 (멱등)', async () => {
    const loc = parseLocations(fixture('locations-7002'));
    if (loc.kind !== 'ok') throw new Error(loc.kind);
    const r = await repo.savePoll(
      run('ok', 1, '2026-09-11T14:01:13Z'),
      loc.items,
    );
    expect(r.inserted).toBe(0);
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM vehicle_observation',
    );
    expect(rows[0]!.n).toBe(1);
    // 폴 기록은 두 번 다 남는다 — "폴은 했는데 새 관측이 없었다"도 정보다
    const runs = await db.query<{ vehicles: number; inserted: number }>(
      'SELECT vehicles, inserted FROM poll_run ORDER BY id',
    );
    expect(runs.rows).toEqual([
      { vehicles: 1, inserted: 1 },
      { vehicles: 1, inserted: 0 },
    ]);
  });

  it('empty·error·failed는 관측 없이 폴 기록만', async () => {
    await repo.savePoll(run('empty', 0, '2026-09-12T18:00:00Z'), []);
    await repo.savePoll(
      run('error', 0, '2026-09-12T18:01:00Z', '22 LIMITED'),
      [],
    );
    await repo.savePoll(
      run('failed', 0, '2026-09-12T18:02:00Z', 'timeout'),
      [],
    );
    const { rows } = await db.query<{ result: string; detail: string | null }>(
      'SELECT result, detail FROM poll_run ORDER BY id OFFSET 2',
    );
    expect(rows).toEqual([
      { result: 'empty', detail: null },
      { result: 'error', detail: '22 LIMITED' },
      { result: 'failed', detail: 'timeout' },
    ]);
  });

  it('한 폴에 여러 차량, 그중 하나가 이미 있으면 나머지만 들어간다', async () => {
    const t = new Date('2026-09-12T08:00:00Z');
    const mk = (plateNo: string, seq: number): VehicleObservation => ({
      plateNo,
      stationId: 239000859,
      stationSeq: seq,
      state: 'arrived',
      remainSeats: null,
      crowding: null,
      lowFloor: null,
      observedAt: t,
    });
    expect(
      (await repo.savePoll(run('ok', 1, '2026-09-13T08:00:00Z'), [mk('A', 3)]))
        .inserted,
    ).toBe(1);
    expect(
      (
        await repo.savePoll(run('ok', 3, '2026-09-13T08:01:00Z'), [
          mk('A', 3),
          mk('B', 10),
          mk('C', 20),
        ])
      ).inserted,
    ).toBe(2);
  });

  it('lastPolls: 노선별 마지막 폴 하나', async () => {
    const last = await lastPolls(db);
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({
      routeId: ROUTE,
      result: 'ok',
      vehicles: 3,
      inserted: 2,
    });
  });

  it('잘못된 state는 CHECK가 막고, 트랜잭션이라 폴 기록도 안 남는다', async () => {
    const before = (
      await db.query<{ n: number }>('SELECT count(*)::int AS n FROM poll_run')
    ).rows[0]!.n;
    const bad = {
      plateNo: 'Z',
      stationId: 1,
      stationSeq: 1,
      state: 'flying',
      remainSeats: null,
      crowding: null,
      lowFloor: null,
      observedAt: new Date(),
    } as unknown as VehicleObservation;
    await expect(
      repo.savePoll(run('ok', 1, '2026-09-12T09:00:00Z'), [bad]),
    ).rejects.toThrow(/check/i);
    const after = (
      await db.query<{ n: number }>('SELECT count(*)::int AS n FROM poll_run')
    ).rows[0]!.n;
    expect(after).toBe(before);
  });
});
