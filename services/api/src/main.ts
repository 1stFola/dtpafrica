import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { LiveAudioCommentaryService } from "./scoreboard/live-audio-commentary.service";
import { applyBodyLimits } from "./shared/body-limits";
import { loadApiEnv } from "./shared/load-dotenv";

loadApiEnv();

async function bootstrap() {
  // Body parsing is ours: worker routes take larger bodies than the rest (shared/body-limits).
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  applyBodyLimits(app);
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
