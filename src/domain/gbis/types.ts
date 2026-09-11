// domain 층: 이 파일과 형제 파일들은 Nest·pg·fetch를 import하지 않는다.
// GBIS 응답을 "우리 말"로 바꾼 뒤의 타입만 둔다.

/** 노선 위의 정류소 하나. seq는 1부터, turnSeq 이하가 상행(잠실행). */
export type RouteStation = {
  stationId: number;
  name: string;
  seq: number;
  turnSeq: number;
  /** 회차 정류소인가 (turnYn === 'Y') */
  isTurn: boolean;
  /** 경도 (GBIS x). Leaflet은 [lat, lng] 순서이니 뒤집어 쓴다 */
  lng: number;
  /** 위도 (GBIS y) */
  lat: number;
};

/** 노선 형상(폴리라인)의 점 하나 */
export type ShapePoint = { seq: number; lng: number; lat: number };

/** stateCd 0/1/2를 이름으로 */
export type VehicleState = 'passing' | 'arrived' | 'departed';

/** GBIS crowded 코드 1/2/3/4. 실측(09-11): 빈 좌석 44대에 crowded=1 → 1이 '여유' */
export type Crowding = 'relaxed' | 'normal' | 'crowded' | 'very_crowded';

/** 위치 API의 차량 한 대. GPS 없음 — 정류소 순번이 전부다 */
export type VehicleObservation = {
  plateNo: string;
  stationId: number;
  stationSeq: number;
  state: VehicleState;
  remainSeats: number | null;
  crowding: Crowding | null;
  lowFloor: boolean | null;
  /** 응답의 queryTime(KST 문자열)을 UTC Date로 */
  observedAt: Date;
};

/**
 * 모든 파서의 반환 타입. Discriminated Union.
 * - ok:    정상, items 있음
 * - empty: resultCode 4 — 정상이지만 결과 없음 (새벽에 위치 API가 이렇게 온다)
 * - error: 그 외 (30 = 키 미등록, 22 = 일일 한도 초과 …)
 */
export type GbisResult<T> =
  | { kind: 'ok'; queryTime: Date; items: T[] }
  | { kind: 'empty'; queryTime: Date }
  | { kind: 'error'; code: number; message: string };
