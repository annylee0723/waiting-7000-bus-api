// 사용: pnpm build && node --env-file=.env dist/scripts/migrate.js
import { runMigrations } from '../infra/postgres/migrate.js';
import { createPool, asQueryable } from '../infra/postgres/pool.js';

const pool = createPool();
const client = await pool.connect(); // 트랜잭션은 연결 하나에 묶여야 하므로 풀이 아니라 클라이언트
try {
  const applied = await runMigrations(asQueryable(client), 'migrations');
  console.log(
    applied.length
      ? `적용: ${applied.join(', ')}`
      : '적용할 마이그레이션 없음 (이미 최신)',
  );
} finally {
  client.release();
  await pool.end();
}
