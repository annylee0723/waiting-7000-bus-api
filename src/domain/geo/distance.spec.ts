import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { haversineM, cumulativeDistancesM } from './distance.js';
import { parseLine, parseStations } from '../gbis/parse.js';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/gbis/${name}.json`, import.meta.url),
      'utf8',
    ),
  );

describe('haversineM', () => {
  it('같은 점은 0', () => {
    expect(
      haversineM({ lng: 127.5, lat: 37.8 }, { lng: 127.5, lat: 37.8 }),
    ).toBe(0);
  });
  it('위도 1도 ≈ 111.2km', () => {
    const d = haversineM({ lng: 127, lat: 37 }, { lng: 127, lat: 38 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
  it('대칭', () => {
    const a = { lng: 127.5153, lat: 37.8246 };
    const b = { lng: 127.1, lat: 37.513 };
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });
});

describe('cumulativeDistancesM', () => {
  it('빈 목록 → 빈 배열, 한 점 → [0]', () => {
    expect(cumulativeDistancesM([])).toEqual([]);
    expect(cumulativeDistancesM([{ lng: 1, lat: 1 }])).toEqual([0]);
  });
  it('7002 형상: 단조 증가, 총 길이가 정류소 직선거리 합보다 길고 200km보다 짧다', () => {
    const line = parseLine(fixture('line-7002'));
    const st = parseStations(fixture('stations-7002'));
    if (line.kind !== 'ok' || st.kind !== 'ok') throw new Error('fixture');
    const cum = cumulativeDistancesM(line.items);
    expect(cum).toHaveLength(line.items.length);
    expect(cum[0]).toBe(0);
    for (let i = 1; i < cum.length; i++)
      expect(cum[i]!).toBeGreaterThanOrEqual(cum[i - 1]!);
    const straight = cumulativeDistancesM(st.items).at(-1)!; // 정류소를 직선으로 이은 길이
    expect(cum.at(-1)!).toBeGreaterThan(straight);
    expect(cum.at(-1)!).toBeLessThan(200_000);
  });
});
