try {
  process.loadEnvFile('.env'); // 로컬: .env 읽기. 배포 환경엔 파일이 없으니 무시
} catch {
  /* .env 없음 */
}
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
