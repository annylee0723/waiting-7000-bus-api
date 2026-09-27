import type { ObservationRepo, PollRun } from '../../domain/ports.js';
import type { VehicleObservation } from '../../domain/gbis/types.js';
import type { Queryable } from './queryable.js';

/** ObservationRepo의 Postgres 구현. 트랜잭션을 쓰므로 db는 한 연결(PoolClient/PGlite)이어야 한다 */
export class PgObservationRepo implements ObservationRepo {
  constructor(private readonly db: Queryable) {}

  async savePoll(
    run: PollRun,
    observations: readonly VehicleObservation[],
  ): Promise<{ inserted: number }> {
    await this.db.query('BEGIN');
    try {
      let inserted = 0;
      if (observations.length > 0) {
        // unnest로 한 번에. 이미 있는 (route, plate, observed_at)은 ON CONFLICT DO NOTHING으로 건너뛴다.
        // RETURNING 1 → 실제로 들어간 행만 돌아오므로 그 수가 inserted.
        const { rows } = await this.db.query(
          `INSERT INTO vehicle_observation
             (route_id, plate_no, station_id, station_seq, state, remain_seats, crowding, low_floor, observed_at)
           SELECT $1, * FROM unnest(
             $2::text[], $3::int[], $4::int[], $5::text[], $6::int[], $7::text[], $8::boolean[], $9::timestamptz[])
           ON CONFLICT (route_id, plate_no, observed_at) DO NOTHING
           RETURNING 1`,
          [
            run.routeId,
            observations.map((o) => o.plateNo),
            observations.map((o) => o.stationId),
            observations.map((o) => o.stationSeq),
            observations.map((o) => o.state),
            observations.map((o) => o.remainSeats),
            observations.map((o) => o.crowding),
            observations.map((o) => o.lowFloor),
            observations.map((o) => o.observedAt),
          ],
        );
        inserted = rows.length;
      }
      await this.db.query(
        `INSERT INTO poll_run (route_id, started_at, finished_at, result, vehicles, inserted, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          run.routeId,
          run.startedAt,
          run.finishedAt,
          run.result,
          run.vehicles,
          inserted,
          run.detail ?? null,
        ],
      );
      await this.db.query('COMMIT');
      return { inserted };
    } catch (e) {
      await this.db.query('ROLLBACK');
      throw e;
    }
  }
}

export type LastPoll = {
  routeId: number;
  finishedAt: Date;
  result: string;
  vehicles: number;
  inserted: number;
};

/** /health 용: 노선별 마지막 폴 */
export async function lastPolls(db: Queryable): Promise<LastPoll[]> {
  const { rows } = await db.query<{
    route_id: number;
    finished_at: Date;
    result: string;
    vehicles: number;
    inserted: number;
  }>(
    `SELECT DISTINCT ON (route_id) route_id, finished_at, result, vehicles, inserted
     FROM poll_run ORDER BY route_id, finished_at DESC`,
  );
  return rows.map((r) => ({
    routeId: r.route_id,
    finishedAt: r.finished_at,
    result: r.result,
    vehicles: r.vehicles,
    inserted: r.inserted,
  }));
}
