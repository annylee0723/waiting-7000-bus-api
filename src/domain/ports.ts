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
