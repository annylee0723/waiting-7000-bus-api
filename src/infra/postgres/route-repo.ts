import type { RouteStation, ShapePoint } from '../../domain/gbis/types.js';
import { cumulativeDistancesM } from '../../domain/geo/distance.js';
import type { Queryable } from './queryable.js';

export type RouteMeta = {
  id: number;
  routeNo: string;
  name: string;
  turnSeq: number | null;
};

/**
 * 노선 하나를 통째로 적재한다. 몇 번을 다시 돌려도 결과가 같다:
 *  - route·station은 있으면 갱신 (ON CONFLICT DO UPDATE)
 *  - route_station·route_shape는 그 노선 것을 지우고 다시 넣는다
 * 전부 한 트랜잭션. 중간에 실패하면 이전 상태 그대로다.
 */
export async function loadRoute(
  db: Queryable,
  route: RouteMeta,
  stations: readonly RouteStation[],
  shape: readonly ShapePoint[],
): Promise<void> {
  await db.query('BEGIN');
  try {
    await db.query(
      `INSERT INTO route (id, route_no, name, turn_seq) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET route_no = EXCLUDED.route_no, name = EXCLUDED.name,
             turn_seq = EXCLUDED.turn_seq, loaded_at = now()`,
      [route.id, route.routeNo, route.name, route.turnSeq],
    );

    // 같은 정류소 id가 한 노선에 두 번 나올 수 있어(왕복) 먼저 id로 중복을 없앤다
    const uniq = [...new Map(stations.map((s) => [s.stationId, s])).values()];
    // 행마다 INSERT를 보내면 Neon까지 왕복 100번. unnest로 배열 4개를 한 번에 보낸다
    await db.query(
      `INSERT INTO station (id, name, lng, lat)
       SELECT * FROM unnest($1::int[], $2::text[], $3::float8[], $4::float8[])
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lng = EXCLUDED.lng, lat = EXCLUDED.lat`,
      [
        uniq.map((s) => s.stationId),
        uniq.map((s) => s.name),
        uniq.map((s) => s.lng),
        uniq.map((s) => s.lat),
      ],
    );

    await db.query('DELETE FROM route_station WHERE route_id = $1', [route.id]);
    await db.query(
      `INSERT INTO route_station (route_id, seq, station_id)
       SELECT $1, * FROM unnest($2::int[], $3::int[])`,
      [route.id, stations.map((s) => s.seq), stations.map((s) => s.stationId)],
    );

    const cum = cumulativeDistancesM(shape);
    await db.query('DELETE FROM route_shape WHERE route_id = $1', [route.id]);
    await db.query(
      `INSERT INTO route_shape (route_id, seq, lng, lat, cum_dist_m)
       SELECT $1, * FROM unnest($2::int[], $3::float8[], $4::float8[], $5::float8[])`,
      [
        route.id,
        shape.map((p) => p.seq),
        shape.map((p) => p.lng),
        shape.map((p) => p.lat),
        cum,
      ],
    );

    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

export type RouteSummary = {
  routeNo: string;
  name: string;
  stations: number;
  shapePoints: number;
  lengthM: number;
};

/** 적재 결과 확인용 */
export async function summarizeRoute(
  db: Queryable,
  routeId: number,
): Promise<RouteSummary | null> {
  const { rows } = await db.query<{
    route_no: string;
    name: string;
    stations: number;
    points: number;
    length_m: number;
  }>(
    `SELECT r.route_no, r.name,
            (SELECT count(*)::int FROM route_station WHERE route_id = r.id) AS stations,
            (SELECT count(*)::int FROM route_shape   WHERE route_id = r.id) AS points,
            (SELECT coalesce(max(cum_dist_m), 0)::float8 FROM route_shape WHERE route_id = r.id) AS length_m
     FROM route r WHERE r.id = $1`,
    [routeId],
  );
  const r = rows[0];
  return r
    ? {
        routeNo: r.route_no,
        name: r.name,
        stations: r.stations,
        shapePoints: r.points,
        lengthM: r.length_m,
      }
    : null;
}
