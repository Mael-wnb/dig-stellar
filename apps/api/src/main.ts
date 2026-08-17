// apps/api/src/main.ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

function getAllowedOrigins(): string[] {
  const raw =
    process.env.CORS_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173';

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Lot S2: no framework fingerprinting in responses.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  const allowedOrigins = getAllowedOrigins();

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      // Lot S2: a disallowed origin gets a clean CORS denial (no ACAO headers,
      // the browser blocks the read) — NOT a thrown error, which Nest turned
      // into a 500 on every cross-origin probe.
      callback(null, allowedOrigins.includes(origin));
    },
    credentials: true,
    // Lot S2: preflights were ~35% of all traffic (S0 baseline) — let browsers
    // cache the preflight verdict for an hour.
    maxAge: 3600,
  });

  // Lot S2: nginx is the only intended public entry. Bind loopback so the raw
  // Node port is unreachable from outside even if the firewall regresses.
  // HOST=0.0.0.0 remains available for environments that need it (e.g. Docker).
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
}
bootstrap();
