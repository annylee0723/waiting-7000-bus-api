// 노선 하나의 정류소·형상을 DB에 적재한다.
// 사용: node --env-file=.env dist/scripts/load-route.js <routeId> [--fixture]
//   --fixture: GBIS를 부르지 않고 fixtures/gbis/*.json 을 쓴다 (호출 예산 0)
import { readFileSync } from 'node:fs';
import { HttpGbisClient } from '../infra/gbis/gbis-client.js';
import { parseLine, parseStations } from '../domain/gbis/parse.js';
import { KNOWN_ROUTES } from '../domain/gbis/routes.js';
import { createPool, asQueryable } from '../infra/postgres/pool.js';
import { loadRoute, summarizeRoute } from '../infra/postgres/route-repo.js';

const routeId = Number(process.argv[2]);
const useFixture = process.argv.includes('--fixture');
const routeNo = KNOWN_ROUTES[routeId];
if (!routeNo)
  throw new Error(
    `모르는 routeId: ${process.argv[2]} (${Object.keys(KNOWN_ROUTES).join(', ')})`,
  );

const [st, ln] = useFixture
  ? [
      parseStations(
        JSON.parse(
          readFileSync(`fixtures/gbis/stations-${routeNo}.json`, 'utf8'),
        ),
      ),
      parseLine(
        JSON.parse(readFileSync(`fixtures/gbis/line-${routeNo}.json`, 'utf8')),
      ),
    ]
  : await (async () => {
      const c = new HttpGbisClient({
        serviceKey: process.env.GBIS_SERVICE_KEY ?? '',
      });
      return Promise.all([c.fetchStations(routeId), c.fetchLine(routeId)]);
    })();
if (st.kind !== 'ok') throw new Error(`stations: ${st.kind}`);
if (ln.kind !== 'ok') throw new Error(`line: ${ln.kind}`);

const turn = st.items.find((s) => s.isTurn);
const name = `${st.items[0]!.name} ↔ ${turn?.name ?? st.items.at(-1)!.name}`;

const pool = createPool();
const client = await pool.connect();
try {
  const db = asQueryable(client);
  await loadRoute(
    db,
    { id: routeId, routeNo, name, turnSeq: turn?.seq ?? null },
    st.items,
    ln.items,
  );
  const s = await summarizeRoute(db, routeId);
  console.log(
    `${routeNo} (${routeId}) ${useFixture ? '[fixture]' : '[live]'}: ${name}`,
  );
  console.log(
    `  정류소 ${s!.stations}개 · 형상 ${s!.shapePoints}점 · 총 길이 ${(s!.lengthM / 1000).toFixed(1)}km`,
  );
} finally {
  client.release();
  await pool.end();
}
