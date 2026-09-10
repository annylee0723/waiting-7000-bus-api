import { Controller, Get } from '@nestjs/common';
import { AppService, type Health } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  health(): Health {
    return this.appService.health();
  }
}
