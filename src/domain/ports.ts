// domain이 바깥 세상에 요구하는 인터페이스(port). 구현(adapter)은 infra/에 있다.
// domain·application은 이 타입만 알고, 진짜 HTTP·DB가 뭔지 모른다.
import type {
  GbisResult,
  RouteStation,
  ShapePoint,
  VehicleObservation,
} from './gbis/types.js';

export interface GbisPort {
  fetchStations(routeId: number): Promise<GbisResult<RouteStation>>;
  fetchLine(routeId: number): Promise<GbisResult<ShapePoint>>;
  fetchLocations(routeId: number): Promise<GbisResult<VehicleObservation>>;
}

export type PollResult = 'ok' | 'empty' | 'error' | 'failed';

/** 폴 한 번의 기록 */
export type PollRun = {
  routeId: number;
  startedAt: Date;
  finishedAt: Date;
  result: PollResult;
  vehicles: number;
  detail?: string;
};

export interface ObservationRepo {
  /** 폴 기록과 관측을 한 트랜잭션으로 저장. 이미 있는 관측은 건너뛴다. 새로 들어간 행 수를 돌려준다 */
  savePoll(
    run: PollRun,
    observations: readonly VehicleObservation[],
  ): Promise<{ inserted: number }>;
}

/** "지금"을 주입받기 위한 포트. 테스트에서 시각을 고정한다 */
export interface Clock {
  now(): Date;
}
