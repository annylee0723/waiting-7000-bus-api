// infra 층: 여기서만 진짜 HTTP를 한다. domain의 GbisPort를 구현한다.
import type { GbisPort } from '../../domain/ports.js';
import {
  parseLine,
  parseLocations,
  parseStations,
} from '../../domain/gbis/parse.js';
import type {
  GbisResult,
  RouteStation,
  ShapePoint,
  VehicleObservation,
} from '../../domain/gbis/types.js';

const BASE = 'https://apis.data.go.kr/6410000';

const ENDPOINT = {
  stations: '/busrouteservice/v2/getBusRouteStationListv2',
  line: '/busrouteservice/v2/getBusRouteLineListv2',
  locations: '/buslocationservice/v2/getBusLocationListv2',
} as const;

/** HTTP 단계에서 끝내 실패했을 때 (타임아웃·5xx가 재시도 후에도 실패, 또는 4xx) */
export class GbisHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly attempts?: number,
  ) {
    super(message);
    this.name = 'GbisHttpError';
  }
}

export type GbisClientOptions = {
  /** 공공데이터포털 Encoding 키. 끝이 %3D%3D. 이미 URL 인코딩돼 있으니 그대로 붙인다 */
  serviceKey: string;
  /** 한 요청을 기다리는 최대 시간. 기본 5초 */
  timeoutMs?: number;
  /** 실패 시 추가로 시도하는 횟수. 기본 2 (총 3번) */
  retries?: number;
  /** 테스트용 주입점 */
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
};

export class HttpGbisClient implements GbisPort {
  private readonly key: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GbisClientOptions) {
    if (!opts.serviceKey) throw new Error('GBIS_SERVICE_KEY가 비어 있음');
    this.key = opts.serviceKey;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.retries = opts.retries ?? 2;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  fetchStations(routeId: number): Promise<GbisResult<RouteStation>> {
    return this.get(ENDPOINT.stations, routeId).then(parseStations);
  }
  fetchLine(routeId: number): Promise<GbisResult<ShapePoint>> {
    return this.get(ENDPOINT.line, routeId).then(parseLine);
  }
  fetchLocations(routeId: number): Promise<GbisResult<VehicleObservation>> {
    return this.get(ENDPOINT.locations, routeId).then(parseLocations);
  }

  /** URL 조립. URLSearchParams를 쓰면 키의 %3D가 %253D로 이중 인코딩되므로 문자열로 붙인다 */
  url(path: string, routeId: number): string {
    return `${BASE}${path}?serviceKey=${this.key}&routeId=${routeId}&format=json`;
  }

  /**
   * GET + 타임아웃 + 재시도.
   * 재시도하는 실패: 네트워크 오류, 타임아웃, 5xx.  재시도 안 하는 실패: 4xx (다시 보내도 같다).
   * 간격: 500ms → 1000ms → 2000ms (지수 백오프)
   */
  private async get(path: string, routeId: number): Promise<unknown> {
    const url = this.url(path, routeId);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.retries + 1; attempt++) {
      try {
        const res = await this.fetchFn(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) return (await res.json()) as unknown;
        if (res.status >= 500) {
          lastErr = new GbisHttpError(
            `GBIS ${res.status}`,
            res.status,
            attempt,
          );
        } else {
          throw new GbisHttpError(
            `GBIS ${res.status} (재시도 안 함)`,
            res.status,
            attempt,
          );
        }
      } catch (e) {
        if (
          e instanceof GbisHttpError &&
          e.status !== undefined &&
          e.status < 500
        )
          throw e;
        lastErr = e;
      }
      if (attempt <= this.retries) await this.sleep(500 * 2 ** (attempt - 1));
    }
    const cause = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new GbisHttpError(
      `GBIS 요청 ${this.retries + 1}번 모두 실패: ${cause}`,
      undefined,
      this.retries + 1,
    );
  }
}
