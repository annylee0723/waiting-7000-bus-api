// 유스케이스: 노선 하나를 한 번 폴링한다. GBIS 호출 → 파싱 → 저장. Nest·pg·fetch를 모른다.
import type {
  Clock,
  GbisPort,
  ObservationRepo,
  PollResult,
} from '../domain/ports.js';

export type PollSummary = {
  routeId: number;
  result: PollResult;
  vehicles: number;
  inserted: number;
  startedAt: Date;
  finishedAt: Date;
  detail?: string;
};

export class PollOnce {
  constructor(
    private readonly gbis: GbisPort,
    private readonly repo: ObservationRepo,
    private readonly clock: Clock,
  ) {}

  async run(routeId: number): Promise<PollSummary> {
    const startedAt = this.clock.now();
    let res;
    try {
      res = await this.gbis.fetchLocations(routeId);
    } catch (e) {
      // HTTP가 끝내 실패(재시도 후)하거나 파싱이 깨진 경우. 폴 기록만 남기고 관측은 없다
      const detail = e instanceof Error ? e.message : String(e);
      const finishedAt = this.clock.now();
      await this.repo.savePoll(
        {
          routeId,
          startedAt,
          finishedAt,
          result: 'failed',
          vehicles: 0,
          detail,
        },
        [],
      );
      return {
        routeId,
        result: 'failed',
        vehicles: 0,
        inserted: 0,
        startedAt,
        finishedAt,
        detail,
      };
    }
    const finishedAt = this.clock.now();

    if (res.kind === 'ok') {
      const { inserted } = await this.repo.savePoll(
        {
          routeId,
          startedAt,
          finishedAt,
          result: 'ok',
          vehicles: res.items.length,
        },
        res.items,
      );
      return {
        routeId,
        result: 'ok',
        vehicles: res.items.length,
        inserted,
        startedAt,
        finishedAt,
      };
    }
    const detail =
      res.kind === 'error' ? `${res.code} ${res.message}` : undefined;
    await this.repo.savePoll(
      { routeId, startedAt, finishedAt, result: res.kind, vehicles: 0, detail },
      [],
    );
    return {
      routeId,
      result: res.kind,
      vehicles: 0,
      inserted: 0,
      startedAt,
      finishedAt,
      detail,
    };
  }
}
