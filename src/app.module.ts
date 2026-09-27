import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PollerModule } from './infra/nest/poller.module.js';

@Module({
  imports: [PollerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
