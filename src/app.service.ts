import { Injectable } from '@nestjs/common';

export type Health = { ok: true; now: string };

@Injectable()
export class AppService {
  health(): Health {
    return { ok: true, now: new Date().toISOString() };
  }
}
