"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./config/load-env");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const path_1 = require("path");
const app_module_1 = require("./app.module");
const http_exception_filter_1 = require("./common/http-exception.filter");
const env_1 = require("./config/env");
async function bootstrap() {
    const log = new common_1.Logger("Bootstrap");
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors({ origin: true });
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new http_exception_filter_1.AllExceptionsFilter());
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, transform: true }));
    app.enableShutdownHooks();
    const downloads = (0, env_1.downloadsDir)();
    if (downloads) {
        app.useStaticAssets(downloads, {
            prefix: "/downloads",
            index: false,
            setHeaders: (res, path) => {
                res.setHeader("Cache-Control", "no-cache");
                if (path.endsWith(".apk"))
                    res.setHeader("Content-Type", "application/vnd.android.package-archive");
            },
        });
    }
    app.useStaticAssets((0, env_1.dataDir)("branding"), {
        prefix: "/branding",
        index: false,
        setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=3600"),
    });
    const web = (0, env_1.webDistDir)();
    if (web) {
        app.useStaticAssets(web, {
            index: false,
            setHeaders: (res, path) => {
                const immutable = /[\\/]assets[\\/]/.test(path);
                res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
            },
        });
        const index = (0, path_1.join)(web, "index.html");
        app.use((req, res, next) => {
            if (req.method !== "GET" ||
                req.path.startsWith("/api") ||
                req.path.startsWith("/socket.io") ||
                req.path.startsWith("/downloads") ||
                req.path.startsWith("/branding")) {
                return next();
            }
            res.setHeader("Cache-Control", "no-cache");
            res.sendFile(index);
        });
        log.log(`Serving web app from ${web}`);
    }
    const port = (0, env_1.httpPort)();
    await app.listen(port, "0.0.0.0");
    log.log(`PixalBotics Restaurant on http://0.0.0.0:${port} (LAN)`);
}
bootstrap();
//# sourceMappingURL=main.js.map