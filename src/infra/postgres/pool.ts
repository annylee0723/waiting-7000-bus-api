import pg from 'pg';
import type { Queryable } from './queryable.js';

/** DATABASE_URL로 커넥션 풀을 만든다. Neon은 sslmode=require가 URL에 들어 있다 */
export function createPool(
  databaseUrl = process.env.DATABASE_URL ?? '',
): pg.Pool {
  if (!databaseUrl) throw new Error('DATABASE_URL이 비어 있음');
  return new pg.Pool({ connectionString: databaseUrl, max: 3 });
}

/** pg의 Pool/PoolClient를 Queryable 모양으로 */
export function asQueryable(c: pg.Pool | pg.PoolClient): Queryable {
  return {
    query: async (text, values) => {
      const res = await c.query(text, values as unknown[] | undefined);
      return { rows: res.rows as never };
    },
    exec: (text) => c.query(text),
  };
}
