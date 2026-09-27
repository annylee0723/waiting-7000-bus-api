import { Module, Logger } from '@nestjs/common';
import pg from 'pg';
import { PollOnce } from '../../application/poll-once.js';
import { HttpGbisClient } from '../gbis/gbis-client.js';
import { PgObservationRepo } from '../postgres/observation-repo.js';
import { createPool } from '../postgres/pool.js';
import {
  CLOCK,
  POLL_ONCE,
  POLLER_CONFIG,
  PollerService,
  type PollerConfig,
} from './poller.service.js';

export const PG_POOL = Symbol('PG_POOL');

/**
 * 배선(wiring)만 한다. 환경변수를 읽어 진짜 어댑터를 만들고 유스케이스에 꽂는다.
 * 여기가 domain·application이 infra를 만나는 유일한 지점이다.
 */
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): pg.Pool | null => {
        if (!process.env.DATABASE_URL) {
          new Logger('PollerModule').warn('DATABASE_URL 없음 → DB 없이 기동');
          return null;
        }
        return createPool();
      },
    },
    {
      provide: POLL_ONCE,
      inject: [PG_POOL, CLOCK],
      useFactory: (
        pool: pg.Pool | null,
        clock: { now(): Date },
      ): PollOnce | null => {
        if (!pool) return null;
        const key = process.env.GBIS_SERVICE_KEY ?? '';
        const gbis = new HttpGbisClient({ serviceKey: key });
        return new PollOnce(
          gbis,
          new PgObservationRepo(new PooledSession(pool)),
          clock,
        );
      },
    },
    { provide: CLOCK, useValue: { now: () => new Date() } },
    {
      provide: POLLER_CONFIG,
      useFactory: (): PollerConfig => ({
        enabled: process.env.POLL_ENABLED === 'true',
        routeIds: (process.env.POLL_ROUTE_IDS ?? '239000141')
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n)),
      }),
    },
    PollerService,
  ],
  exports: [PollerService, PG_POOL],
})
export class PollerModule {}

/**
 * BEGIN…COMMIT이 같은 연결에서 돌도록, BEGIN에서 연결을 빌리고 COMMIT/ROLLBACK에서 돌려준다.
 * 트랜잭션 밖의 쿼리는 풀에 바로 보낸다.
 */
class PooledSession {
  private client: pg.PoolClient | null = null;
  constructor(private readonly pool: pg.Pool) {}

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }> {
    const t = text.trim().toUpperCase();
    if (t === 'BEGIN') {
      this.client = await this.pool.connect();
      await this.client.query('BEGIN');
      return { rows: [] };
    }
    const target = this.client ?? this.pool;
    try {
      const res = await target.query(text, values as unknown[] | undefined);
      return { rows: res.rows as R[] };
    } finally {
      if ((t === 'COMMIT' || t === 'ROLLBACK') && this.client) {
        this.client.release();
        this.client = null;
      }
    }
  }
  exec(text: string): Promise<unknown> {
    return this.pool.query(text);
  }
}
