import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Queryable } from './queryable.js';

/**
 * migrations/*.sql 을 이름순으로, 아직 안 돈 것만 실행한다.
 * 어떤 파일이 돌았는지는 schema_migration 표에 남긴다 (DB 안의 "적용 이력").
 * 파일 하나 = 트랜잭션 하나. 중간에 실패하면 그 파일은 통째로 없던 일이 된다.
 */
export async function runMigrations(
  db: Queryable,
  dir: string,
): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migration (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set(
    (
      await db.query<{ name: string }>('SELECT name FROM schema_migration')
    ).rows.map((r) => r.name),
  );
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    await db.query('BEGIN');
    try {
      await db.exec(sql);
      await db.query('INSERT INTO schema_migration (name) VALUES ($1)', [f]);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw new Error(
        `migration ${f} 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    applied.push(f);
  }
  return applied;
}
