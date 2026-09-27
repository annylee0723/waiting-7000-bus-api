import { Injectable } from '@nestjs/common';
import { PollerService } from './infra/nest/poller.service.js';

export type Health = {
  ok: true;
  now: string;
  /** 노선별 마지막 폴. 폴러가 꺼져 있으면 빈 객체 */
  lastPoll: Record<
    string,
    {
      result: string;
      vehicles: number;
      inserted: number;
      finishedAt: string;
      ageSec: number;
    }
  >;
};

@Injectable()
export class AppService {
  constructor(private readonly poller: PollerService) {}

  health(): Health {
    const now = new Date();
    const lastPoll: Health['lastPoll'] = {};
    for (const [routeId, s] of this.poller.last) {
      lastPoll[String(routeId)] = {
        result: s.result,
        vehicles: s.vehicles,
        inserted: s.inserted,
        finishedAt: s.finishedAt.toISOString(),
        ageSec: Math.round((now.getTime() - s.finishedAt.getTime()) / 1000),
      };
    }
    return { ok: true, now: now.toISOString(), lastPoll };
  }
}
