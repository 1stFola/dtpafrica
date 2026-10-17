import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { LiveAudioCommentaryService } from "./scoreboard/live-audio-commentary.service";
import { applyBodyLimits } from "./shared/body-limits";
import { corsOrigins } from "./shared/cors";
import { assertJwtSecrets } from "./shared/jwt-secrets";
import { loadApiEnv } from "./shared/load-dotenv";
import { TRUSTED_PROXIES } from "./shared/throttle";

loadApiEnv();

async function bootstrap() {
  // Before anything is built: a production API without its session keys must not start.
  assertJwtSecrets();
  // Body parsing is ours: worker routes take larger bodies than the rest (shared/body-limits).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // req.ip is the visitor nginx resolved, not nginx itself: the rate limits key on it.
  app.set("trust proxy", TRUSTED_PROXIES);
  applyBodyLimits(app);
  app.setGlobalPrefix("api/v1");
  // Production's two hostnames (and Vite's, in development); CORS_ORIGINS overrides (shared/cors).
  app.enableCors({ origin: corsOrigins() });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })
  );
  app.get(LiveAudioCommentaryService).attach(app.getHttpServer());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`@dtp/api listening on http://localhost:${port}/api/v1`);
}

bootstrap();
