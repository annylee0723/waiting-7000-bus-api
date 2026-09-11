import type {
  GbisResult,
  RouteStation,
  ShapePoint,
  VehicleObservation,
  VehicleState,
} from './types.js';

/** GBIS 응답이 우리가 기대한 모양이 아닐 때. 경계에서 바로 던진다 */
export class GbisParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GbisParseError';
  }
}

// ---------- 공통: 봉투(envelope) ----------

type Envelope = {
  response?: {
    msgHeader?: {
      queryTime?: unknown;
      resultCode?: unknown;
      resultMessage?: unknown;
    };
    msgBody?: Record<string, unknown>;
  };
};

/**
 * GBIS queryTime은 "2026-09-03 00:36:49.450" 같은 KST 문자열이고 tz 표기가 없다.
 * 서버는 UTC로 돌기 때문에, 여기서 +09:00을 명시해 Date로 만든다.
 */
export function parseKstTime(s: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(s);
  if (!m) throw new GbisParseError(`queryTime 형식이 아님: ${s}`);
  return new Date(`${m[1]}T${m[2]}${m[3] ?? ''}+09:00`);
}

/** 봉투를 벗기고 상태(ok/empty/error)와 raw 목록을 돌려준다 */
function openEnvelope(
  raw: unknown,
  listKey: string,
):
  | { kind: 'ok'; queryTime: Date; list: unknown[] }
  | Exclude<GbisResult<never>, { kind: 'ok' }> {
  const header = (raw as Envelope)?.response?.msgHeader;
  if (!header) throw new GbisParseError('response.msgHeader 없음');

  const code = num(header.resultCode, 'resultCode');
  if (code !== 0 && code !== 4) {
    return { kind: 'error', code, message: String(header.resultMessage ?? '') };
  }

  const queryTime = parseKstTime(str(header.queryTime, 'queryTime'));
  if (code === 4) return { kind: 'empty', queryTime };

  const body = (raw as Envelope).response?.msgBody?.[listKey];
  // 공공 API는 결과가 1건이면 배열 대신 객체 하나를 주기도 한다. 배열로 맞춘다
  const list = body == null ? [] : Array.isArray(body) ? body : [body];
  if (list.length === 0) return { kind: 'empty', queryTime };
  return { kind: 'ok', queryTime, list };
}

// ---------- 필드 검사 헬퍼 ----------

function num(v: unknown, field: string): number {
  if (typeof v !== 'number' || Number.isNaN(v))
    throw new GbisParseError(`${field}: 숫자가 아님 (${String(v)})`);
  return v;
}
function str(v: unknown, field: string): string {
  if (typeof v !== 'string')
    throw new GbisParseError(`${field}: 문자열이 아님 (${String(v)})`);
  return v;
}
function optNum(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}
/** 'Y'/'N' 또는 1/0 → boolean. 없으면 null */
function optYn(v: unknown): boolean | null {
  if (v === 'Y' || v === 1 || v === '1') return true;
  if (v === 'N' || v === 0 || v === '0') return false;
  return null;
}

// ---------- 파서 3개 ----------

/** getBusRouteStationListv2 응답 → RouteStation[] (seq 오름차순) */
export function parseStations(raw: unknown): GbisResult<RouteStation> {
  const env = openEnvelope(raw, 'busRouteStationList');
  if (env.kind !== 'ok') return env;
  const items = env.list.map((r): RouteStation => {
    const o = r as Record<string, unknown>;
    return {
      stationId: num(o.stationId, 'stationId'),
      name: str(o.stationName, 'stationName').trim(),
      seq: num(o.stationSeq, 'stationSeq'),
      turnSeq: num(o.turnSeq, 'turnSeq'),
      isTurn: o.turnYn === 'Y',
      lng: num(o.x, 'x'),
      lat: num(o.y, 'y'),
    };
  });
  items.sort((a, b) => a.seq - b.seq);
  return { kind: 'ok', queryTime: env.queryTime, items };
}

/** getBusRouteLineListv2 응답 → ShapePoint[] (seq 오름차순) */
export function parseLine(raw: unknown): GbisResult<ShapePoint> {
  const env = openEnvelope(raw, 'busRouteLineList');
  if (env.kind !== 'ok') return env;
  const items = env.list.map((r): ShapePoint => {
    const o = r as Record<string, unknown>;
    return {
      seq: num(o.lineSeq, 'lineSeq'),
      lng: num(o.x, 'x'),
      lat: num(o.y, 'y'),
    };
  });
  items.sort((a, b) => a.seq - b.seq);
  return { kind: 'ok', queryTime: env.queryTime, items };
}

const STATE_BY_CODE: Record<number, VehicleState> = {
  0: 'passing',
  1: 'arrived',
  2: 'departed',
};

/** getBusLocationListv2 응답 → VehicleObservation[]. observedAt은 응답의 queryTime */
export function parseLocations(raw: unknown): GbisResult<VehicleObservation> {
  const env = openEnvelope(raw, 'busLocationList');
  if (env.kind !== 'ok') return env;
  const items = env.list.map((r): VehicleObservation => {
    const o = r as Record<string, unknown>;
    const code = num(o.stateCd, 'stateCd');
    const state = STATE_BY_CODE[code];
    if (!state) throw new GbisParseError(`stateCd: 모르는 값 ${code}`);
    return {
      plateNo: str(o.plateNo, 'plateNo').trim(),
      stationId: num(o.stationId, 'stationId'),
      stationSeq: num(o.stationSeq, 'stationSeq'),
      state,
      remainSeats: optNum(o.remainSeatCnt),
      crowded: optYn(o.crowded),
      lowFloor: optYn(o.lowPlate),
      observedAt: env.queryTime,
    };
  });
  return { kind: 'ok', queryTime: env.queryTime, items };
}
