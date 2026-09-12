import pg from 'pg';
import type { Queryable } from './queryable.js';

/** DATABASE_URL로 커넥션 풀을 만든다. Neon은 sslmode=require가 URL에 들어 있다 */
export function createPool(
  databaseUrl = process.env.DATABASE_URL ?? '',
): pg.Pool {
  if (!databaseUrl) throw new Error('DATABASE_URL이 비어 있음');
  // pg 8.x는 sslmode=require를 verify-full(인증서까지 검증)로 취급하면서 경고를 찍는다.
  // 우리가 원하는 게 바로 그 동작이므로 이름을 명시해 경고를 없앤다. Neon은 둘 다 받는다.
  const url = databaseUrl.replace(
    /([?&])sslmode=require(&|$)/,
    '$1sslmode=verify-full$2',
  );
  return new pg.Pool({ connectionString: url, max: 3 });
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
