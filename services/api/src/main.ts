import "reflect-metadata";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { LiveAudioCommentaryService } from "./scoreboard/live-audio-commentary.service";

for (const envPath of [join(process.cwd(), ".env"), join(process.cwd(), "services/api/.env")]) {
  if (existsSync(envPath)) {
    loadEnvFile(envPath);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })
  );
  app.get(LiveAudioCommentaryService).attach(app.getHttpServer());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`@dtp/api listening on http://localhost:${port}/api/v1`);
}

bootstrap();
