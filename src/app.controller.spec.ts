import { Test, TestingModule } from '@nestjs/testing';
import { describe, beforeEach, it, expect } from 'vitest';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get(AppController);
  });

  it('GET /health returns ok with an ISO timestamp', () => {
    const body = appController.health();
    expect(body.ok).toBe(true);
    expect(new Date(body.now).toISOString()).toBe(body.now);
  });
});
