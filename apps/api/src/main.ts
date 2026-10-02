import "./config/load-env";
import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { join } from "path";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/http-exception.filter";
import { downloadsDir, httpPort, webDistDir, dataDir } from "./config/env";

async function bootstrap() {
  const log = new Logger("Bootstrap");
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: true });
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const downloads = downloadsDir();
  if (downloads) {
    app.useStaticAssets(downloads, {
      prefix: "/downloads",
      index: false,
      setHeaders: (res, path) => {
        res.setHeader("Cache-Control", "no-cache");
        if (path.endsWith(".apk")) res.setHeader("Content-Type", "application/vnd.android.package-archive");
      },
    });
  }

  app.useStaticAssets(dataDir("branding"), {
    prefix: "/branding",
    index: false,
    setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=3600"),
  });

  const web = webDistDir();
  if (web) {
    app.useStaticAssets(web, {
      index: false,
      setHeaders: (res, path) => {
        const immutable = /[\\/]assets[\\/]/.test(path);
        res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
    const index = join(web, "index.html");
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (
        req.method !== "GET" ||
        req.path.startsWith("/api") ||
        req.path.startsWith("/socket.io") ||
        req.path.startsWith("/downloads") ||
        req.path.startsWith("/branding")
      ) {
        return next();
      }
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(index);
    });
    log.log(`Serving web app from ${web}`);
  }

  const port = httpPort();
  await app.listen(port, "0.0.0.0");
  log.log(`Hotel System on http://0.0.0.0:${port} (LAN)`);
}

bootstrap();
