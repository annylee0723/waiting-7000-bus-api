// 실제 GBIS를 한 번 호출해 파서가 살아 있는 응답을 통과하는지 본다.
// 사용: pnpm build && node --env-file=.env dist/scripts/gbis-smoke.js [routeId] [--record]
//   --record: 위치 응답 원본을 fixtures/gbis/locations-<routeId>.json 으로 저장 (운행시간에만 의미 있음)
import { writeFileSync } from 'node:fs';
import { HttpGbisClient } from '../infra/gbis/gbis-client.js';
import { KNOWN_ROUTES } from '../domain/gbis/routes.js';

const routeId = Number(process.argv[2] ?? 239000139);
const record = process.argv.includes('--record');
const key = process.env.GBIS_SERVICE_KEY ?? '';

const client = new HttpGbisClient({ serviceKey: key });

// 원본 JSON도 보고 싶어서 client 내부 대신 여기서 한 번 더 직접 받는다 (호출 1건 추가)
async function rawLocations(): Promise<unknown> {
  const res = await fetch(
    client.url('/buslocationservice/v2/getBusLocationListv2', routeId),
    {
      signal: AbortSignal.timeout(5_000),
    },
  );
  return res.json();
}

const t0 = Date.now();
const [stations, line, locations] = await Promise.all([
  client.fetchStations(routeId),
  client.fetchLine(routeId),
  client.fetchLocations(routeId),
]);
const ms = Date.now() - t0;

const summarize = (
  name: string,
  r: { kind: string; items?: unknown[]; code?: number; message?: string },
) =>
  r.kind === 'ok'
    ? `${name}: ok, ${r.items!.length}개`
    : r.kind === 'empty'
      ? `${name}: empty (결과 없음)`
      : `${name}: error ${r.code} ${r.message}`;

console.log(`routeId=${routeId}  (${ms}ms, 호출 3건)`);
console.log(' ', summarize('stations ', stations));
console.log(' ', summarize('line     ', line));
console.log(' ', summarize('locations', locations));
if (locations.kind === 'ok') {
  for (const v of locations.items) {
    console.log(
      `    ${v.plateNo}  seq ${String(v.stationSeq).padStart(3)}  ${v.state.padEnd(8)}  seats ${v.remainSeats ?? '-'}  ${v.observedAt.toISOString()}`,
    );
  }
}

if (record) {
  const raw = await rawLocations();
  const path = `fixtures/gbis/locations-${KNOWN_ROUTES[routeId] ?? routeId}.json`;
  writeFileSync(path, JSON.stringify(raw, null, 2));
  console.log(`\n저장: ${path} (호출 1건 추가)`);
}
