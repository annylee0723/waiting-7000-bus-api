// DB 테스트. 진짜 Postgres 서버 대신 PGlite(브라우저·Node용 내장 Postgres)를 메모리에 띄운다.
// 같은 SQL이 Neon에서도 그대로 돈다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations } from './migrate.js';
import { loadRoute, summarizeRoute } from './route-repo.js';
import { parseLine, parseStations } from '../../domain/gbis/parse.js';
import type { Queryable } from './queryable.js';

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

function parsed(no: number) {
  const st = parseStations(fixture(`stations-${no}`));
  const ln = parseLine(fixture(`line-${no}`));
  if (st.kind !== 'ok' || ln.kind !== 'ok') throw new Error('fixture');
  return { stations: st.items, shape: ln.items };
}

let pg: PGlite;
let db: Queryable;

beforeAll(async () => {
  pg = new PGlite();
  db = pg as unknown as Queryable;
});
afterAll(() => pg.close());

describe('runMigrations', () => {
  it('001을 적용하고, 두 번째 실행은 아무것도 안 한다', async () => {
    expect(await runMigrations(db, MIGRATIONS)).toEqual(['001_init.sql']);
    expect(await runMigrations(db, MIGRATIONS)).toEqual([]);
    const { rows } = await db.query<{ name: string }>(
      'SELECT name FROM schema_migration',
    );
    expect(rows.map((r) => r.name)).toEqual(['001_init.sql']);
  });
});

describe('loadRoute', () => {
  const ROUTE = {
    id: 239000141,
    routeNo: '7002',
    name: '유명산종점 ↔ 잠실역.롯데월드',
    turnSeq: 31,
  };

  it('7002 적재: 정류소 61, 형상 1512, 누적거리 단조 증가', async () => {
    const { stations, shape } = parsed(7002);
    await loadRoute(db, ROUTE, stations, shape);
    const s = await summarizeRoute(db, ROUTE.id);
    expect(s).toMatchObject({
      routeNo: '7002',
      stations: 61,
      shapePoints: 1512,
    });
    expect(s!.lengthM).toBeGreaterThan(50_000);

    const { rows } = await db.query<{ cum: number }>(
      'SELECT cum_dist_m AS cum FROM route_shape WHERE route_id = $1 ORDER BY seq',
      [ROUTE.id],
    );
    for (let i = 1; i < rows.length; i++)
      expect(rows[i]!.cum).toBeGreaterThanOrEqual(rows[i - 1]!.cum);
  });

  it('윗벌은 station 표에 방향별로 2행, route_station에서 seq 15·48', async () => {
    const { rows } = await db.query<{ seq: number; id: number; name: string }>(
      `SELECT rs.seq, s.id, s.name FROM route_station rs JOIN station s ON s.id = rs.station_id
       WHERE rs.route_id = $1 AND s.name = '윗벌' ORDER BY rs.seq`,
      [239000141],
    );
    expect(rows).toEqual([
      { seq: 15, id: 239000859, name: '윗벌' },
      { seq: 48, id: 239000860, name: '윗벌' },
    ]);
  });

  it('같은 노선을 다시 적재해도 행 수가 늘지 않는다 (멱등)', async () => {
    const { stations, shape } = parsed(7002);
    await loadRoute(db, ROUTE, stations, shape);
    await loadRoute(db, ROUTE, stations, shape);
    const s = await summarizeRoute(db, ROUTE.id);
    expect(s).toMatchObject({ stations: 61, shapePoints: 1512 });
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM station',
    );
    expect(rows[0]!.n).toBe(new Set(stations.map((x) => x.stationId)).size);
  });

  it('세 노선을 다 넣어도 서로 안 섞인다', async () => {
    for (const [id, no, turn] of [
      [239000139, '7000', 52],
      [239000140, '7001', 23],
    ] as const) {
      const { stations, shape } = parsed(Number(no));
      await loadRoute(
        db,
        {
          id,
          routeNo: no,
          name: `${stations[0]!.name} ↔ ${stations[turn - 1]!.name}`,
          turnSeq: turn,
        },
        stations,
        shape,
      );
    }
    expect((await summarizeRoute(db, 239000139))!).toMatchObject({
      stations: 101,
      shapePoints: 2487,
    });
    expect((await summarizeRoute(db, 239000140))!).toMatchObject({
      stations: 44,
    });
    expect((await summarizeRoute(db, 239000141))!).toMatchObject({
      stations: 61,
      shapePoints: 1512,
    });
  });

  it('없는 노선을 가리키는 route_station은 FK가 막는다', async () => {
    await expect(
      db.query(
        'INSERT INTO route_station (route_id, seq, station_id) VALUES (1, 1, 239000859)',
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('적재 도중 실패하면 이전 상태가 그대로다 (트랜잭션)', async () => {
    const { stations, shape } = parsed(7002);
    const before = await summarizeRoute(db, ROUTE.id);
    // seq가 겹치는 형상 → PK 위반 → 전체 ROLLBACK
    const broken = [...shape, { seq: 1, lng: 0, lat: 0 }];
    await expect(loadRoute(db, ROUTE, stations, broken)).rejects.toThrow();
    expect(await summarizeRoute(db, ROUTE.id)).toEqual(before);
  });
});
