/**
 * "SQL 문자열 + 파라미터 배열을 받아 rows를 돌려주는 것".
 * pg의 Pool/PoolClient도, 테스트용 PGlite도 이 모양이다. 저장소 코드는 이 타입만 본다.
 * 트랜잭션(BEGIN/COMMIT)을 쓰는 함수엔 반드시 **한 연결**(PoolClient 또는 PGlite)을 넘긴다.
 */
export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
  /** 여러 문장이 든 SQL 스크립트(마이그레이션 파일) 실행. 파라미터 없음 */
  exec(text: string): Promise<unknown>;
}
