import { describe, it, expect, vi } from 'vitest';
import { HttpGbisClient, GbisHttpError } from './gbis-client.js';

const KEY = 'abc%2Fdef%3D%3D';
const okBody = {
  response: {
    msgHeader: {
      queryTime: '2026-09-11 22:00:00',
      resultCode: 0,
      resultMessage: 'ok',
    },
    msgBody: { busRouteLineList: [{ lineSeq: 1, x: 127.5, y: 37.8 }] },
  },
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** fetch를 가짜로. 호출마다 지정한 결과를 순서대로 돌려준다 */
function fakeFetch(...results: Array<Response | Error>) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    const r = results.shift();
    if (!r) throw new Error('fake fetch: 준비된 응답 없음');
    if (r instanceof Error) throw r;
    return r;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const noSleep = async () => {};

describe('HttpGbisClient', () => {
  it('URL: 키를 이중 인코딩하지 않고 그대로 붙인다', () => {
    const c = new HttpGbisClient({
      serviceKey: KEY,
      fetch: fakeFetch().fn,
      sleep: noSleep,
    });
    const u = c.url('/x', 239000139);
    expect(u).toContain(`serviceKey=${KEY}&`);
    expect(u).not.toContain('%253D');
    expect(u).toContain('routeId=239000139');
    expect(u).toContain('format=json');
  });

  it('성공하면 파서를 거쳐 GbisResult로 돌려준다', async () => {
    const f = fakeFetch(jsonResponse(okBody));
    const c = new HttpGbisClient({
      serviceKey: KEY,
      fetch: f.fn,
      sleep: noSleep,
    });
    const res = await c.fetchLine(239000139);
    expect(res.kind).toBe('ok');
    expect(f.calls).toHaveLength(1);
  });

  it('타임아웃(AbortError) → 재시도 → 성공', async () => {
    const abort = new DOMException('timeout', 'TimeoutError');
    const f = fakeFetch(abort, jsonResponse(okBody));
    const sleeps: number[] = [];
    const c = new HttpGbisClient({
      serviceKey: KEY,
      fetch: f.fn,
      sleep: async (ms) => void sleeps.push(ms),
    });
    const res = await c.fetchLine(1);
    expect(res.kind).toBe('ok');
    expect(f.calls).toHaveLength(2);
    expect(sleeps).toEqual([500]);
  });

  it('5xx는 재시도, 지수 백오프 500→1000, 3번 다 실패하면 GbisHttpError', async () => {
    const f = fakeFetch(
      jsonResponse({}, 500),
      jsonResponse({}, 502),
      jsonResponse({}, 503),
    );
    const sleeps: number[] = [];
    const c = new HttpGbisClient({
      serviceKey: KEY,
      fetch: f.fn,
      sleep: async (ms) => void sleeps.push(ms),
    });
    await expect(c.fetchLine(1)).rejects.toMatchObject({
      name: 'GbisHttpError',
      attempts: 3,
    });
    expect(f.calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('4xx는 재시도하지 않고 바로 던진다', async () => {
    const f = fakeFetch(jsonResponse({}, 401));
    const c = new HttpGbisClient({
      serviceKey: KEY,
      fetch: f.fn,
      sleep: noSleep,
    });
    await expect(c.fetchLine(1)).rejects.toBeInstanceOf(GbisHttpError);
    expect(f.calls).toHaveLength(1);
  });

  it('HTTP 200이어도 GBIS resultCode가 에러면 error 결과 (throw 아님)', async () => {
    const body = {
      response: {
        msgHeader: {
          queryTime: '2026-09-11 22:00:00',
          resultCode: 30,
          resultMessage: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
        },
      },
    };
    const c = new HttpGbisClient({
      serviceKey: KEY,
      fetch: fakeFetch(jsonResponse(body)).fn,
      sleep: noSleep,
    });
    expect(await c.fetchStations(1)).toEqual({
      kind: 'error',
      code: 30,
      message: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
    });
  });

  it('키가 비어 있으면 생성 자체가 실패한다', () => {
    expect(() => new HttpGbisClient({ serviceKey: '' })).toThrow(
      /GBIS_SERVICE_KEY/,
    );
  });
});
