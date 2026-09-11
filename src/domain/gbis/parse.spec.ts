// 계약 테스트: 실제 GBIS 응답(fixtures/gbis)을 파서에 넣어 우리 타입이 나오는지 확인한다.
// Nest도 DB도 네트워크도 없다. GBIS가 응답 모양을 바꾸면 여기서 먼저 깨진다.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  parseStations,
  parseLine,
  parseLocations,
  parseKstTime,
  GbisParseError,
} from './parse.js';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/gbis/${name}.json`, import.meta.url),
      'utf8',
    ),
  );

const ROUTES = [
  { no: 7000, stations: 101, turnSeq: 52, linePoints: 2487 },
  { no: 7001, stations: 44, turnSeq: 23 },
  { no: 7002, stations: 61, turnSeq: 31 },
] as const;

describe('parseKstTime', () => {
  it('tz 없는 KST 문자열을 UTC Date로 (KST 00:36 = 전날 UTC 15:36)', () => {
    expect(parseKstTime('2026-09-03 00:36:49.450').toISOString()).toBe(
      '2026-09-02T15:36:49.450Z',
    );
    expect(parseKstTime('2026-09-03 00:36:49').toISOString()).toBe(
      '2026-09-02T15:36:49.000Z',
    );
  });
  it('형식이 다르면 던진다', () => {
    expect(() => parseKstTime('2026-09-03T00:36:49Z')).toThrow(GbisParseError);
  });
});

describe('parseStations (fixture 계약)', () => {
  for (const r of ROUTES) {
    it(`${r.no}: 정류소 ${r.stations}개, turnSeq ${r.turnSeq}, seq 1..N 연속`, () => {
      const res = parseStations(fixture(`stations-${r.no}`));
      if (res.kind !== 'ok') throw new Error(`expected ok, got ${res.kind}`);
      expect(res.items).toHaveLength(r.stations);
      expect(res.items.map((s) => s.seq)).toEqual(
        res.items.map((_, i) => i + 1),
      );
      expect(res.items.every((s) => s.turnSeq === r.turnSeq)).toBe(true);
      // 회차 정류소는 정확히 하나, 그 seq가 turnSeq
      const turns = res.items.filter((s) => s.isTurn);
      expect(turns).toHaveLength(1);
      expect(turns[0]!.seq).toBe(r.turnSeq);
    });
  }
  it('7000: 경기도 좌표 범위 (lng 126~128, lat 37~38), 첫/끝 정류소는 가평터미널', () => {
    const res = parseStations(fixture('stations-7000'));
    if (res.kind !== 'ok') throw new Error(res.kind);
    for (const s of res.items) {
      expect(s.lng).toBeGreaterThan(126);
      expect(s.lng).toBeLessThan(128);
      expect(s.lat).toBeGreaterThan(37);
      expect(s.lat).toBeLessThan(38);
    }
    expect(res.items[0]!.name).toBe('가평터미널');
    expect(res.items.at(-1)!.name).toBe('가평터미널');
    expect(res.items[51]!.name).toBe('잠실역.롯데월드');
    expect(res.queryTime.toISOString()).toBe('2026-09-02T15:37:17.896Z');
  });
});

describe('parseLine (fixture 계약)', () => {
  it('7000: 2,487점, seq 연속, 왕복이라 첫 점과 끝 점이 50m 안', () => {
    const res = parseLine(fixture('line-7000'));
    if (res.kind !== 'ok') throw new Error(res.kind);
    expect(res.items).toHaveLength(2487);
    expect(res.items.map((p) => p.seq)).toEqual(res.items.map((_, i) => i + 1));
    const a = res.items[0]!;
    const b = res.items.at(-1)!;
    // 위도 1도 ≈ 111km. 거칠게 계산해도 충분
    const dLat = (a.lat - b.lat) * 111_000;
    const dLng = (a.lng - b.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
    expect(Math.hypot(dLat, dLng)).toBeLessThan(50);
  });
  for (const no of [7001, 7002]) {
    it(`${no}: 점이 있고 seq 연속`, () => {
      const res = parseLine(fixture(`line-${no}`));
      if (res.kind !== 'ok') throw new Error(res.kind);
      expect(res.items.length).toBeGreaterThan(100);
      expect(res.items.map((p) => p.seq)).toEqual(
        res.items.map((_, i) => i + 1),
      );
    });
  }
});

describe('봉투(envelope) 처리', () => {
  const header = (resultCode: number, resultMessage = '') => ({
    queryTime: '2026-09-03 00:00:00',
    resultCode,
    resultMessage,
  });

  it('resultCode 4 → empty (정상이지만 결과 없음)', () => {
    const res = parseLocations({
      response: { msgHeader: header(4, '결과가 없습니다.') },
    });
    expect(res.kind).toBe('empty');
  });
  it('resultCode 30 → error (키 미등록)', () => {
    const res = parseStations({
      response: {
        msgHeader: header(30, 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'),
      },
    });
    expect(res).toEqual({
      kind: 'error',
      code: 30,
      message: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
    });
  });
  it('결과 1건이 배열이 아니라 객체로 와도 배열로 맞춘다', () => {
    const one = { lineSeq: 1, x: 127.5, y: 37.8 };
    const res = parseLine({
      response: { msgHeader: header(0), msgBody: { busRouteLineList: one } },
    });
    expect(res.kind === 'ok' && res.items).toEqual([
      { seq: 1, lng: 127.5, lat: 37.8 },
    ]);
  });
  it('필드 타입이 다르면 GbisParseError', () => {
    const bad = { lineSeq: '1', x: 127.5, y: 37.8 };
    expect(() =>
      parseLine({
        response: {
          msgHeader: header(0),
          msgBody: { busRouteLineList: [bad] },
        },
      }),
    ).toThrow(GbisParseError);
  });
  it('msgHeader가 없으면 GbisParseError', () => {
    expect(() => parseStations({})).toThrow(GbisParseError);
    expect(() => parseStations(null)).toThrow(GbisParseError);
  });
});

describe('parseLocations (fixture 계약 — 2026-09-11 23:00 KST 녹화, 7002 운행 1대)', () => {
  it('결과 1건이라 객체로 온 busLocationList를 배열로 맞추고, 코드들을 이름으로 바꾼다', () => {
    const res = parseLocations(fixture('locations-7002'));
    if (res.kind !== 'ok') throw new Error(res.kind);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toEqual({
      plateNo: '경기77자6176',
      stationId: 239000653,
      stationSeq: 17,
      state: 'departed',
      remainSeats: 44,
      crowding: 'relaxed', // crowded: 1 — 빈 좌석 44인데 '혼잡'일 리 없다. 1 = 여유
      lowFloor: false,
      observedAt: new Date('2026-09-11T14:00:13.349Z'), // queryTime 23:00:13.349 KST
    });
  });
});

describe('parseLocations (인라인 샘플)', () => {
  it('stateCd 0/1/2 → passing/arrived/departed, observedAt = queryTime(UTC)', () => {
    const raw = {
      response: {
        msgHeader: {
          queryTime: '2026-09-03 08:00:00',
          resultCode: 0,
          resultMessage: 'ok',
        },
        msgBody: {
          busLocationList: [
            {
              plateNo: '경기70아1234',
              stationId: 239000282,
              stationSeq: 1,
              stateCd: 2,
              remainSeatCnt: 30,
              crowded: 1,
              lowPlate: 0,
            },
            {
              plateNo: '경기70아5678',
              stationId: 239000300,
              stationSeq: 52,
              stateCd: 1,
              remainSeatCnt: -1,
              crowded: 3,
              lowPlate: 1,
            },
            {
              plateNo: '경기70아9999',
              stationId: 239000301,
              stationSeq: 53,
              stateCd: 0,
            },
          ],
        },
      },
    };
    const res = parseLocations(raw);
    if (res.kind !== 'ok') throw new Error(res.kind);
    expect(res.items.map((v) => v.state)).toEqual([
      'departed',
      'arrived',
      'passing',
    ]);
    expect(res.items[0]!.observedAt.toISOString()).toBe(
      '2026-09-02T23:00:00.000Z',
    );
    expect(res.items[0]).toMatchObject({
      crowding: 'relaxed',
      lowFloor: false,
    });
    expect(res.items[1]).toMatchObject({
      crowding: 'crowded',
      lowFloor: true,
      remainSeats: -1,
    });
    expect(res.items[2]).toMatchObject({
      remainSeats: null,
      crowding: null,
      lowFloor: null,
    });
  });
  it('모르는 stateCd는 던진다', () => {
    const raw = {
      response: {
        msgHeader: { queryTime: '2026-09-03 08:00:00', resultCode: 0 },
        msgBody: {
          busLocationList: [
            { plateNo: 'x', stationId: 1, stationSeq: 1, stateCd: 7 },
          ],
        },
      },
    };
    expect(() => parseLocations(raw)).toThrow(GbisParseError);
  });
});
