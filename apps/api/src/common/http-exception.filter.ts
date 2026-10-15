import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "Something went wrong";
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (typeof body === "object" && body) {
        const b = body as Record<string, unknown>;
        const raw = b.message;
        // Nest wraps: { statusCode, message: { code, message, ... }, error }
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          details = raw as Record<string, unknown>;
          message = String(
            (raw as { message?: unknown }).message ?? "Request failed"
          );
        } else if (typeof b.code === "string" && typeof raw === "string") {
          // Flat: BadRequestException({ code, message, ... })
          details = b;
          message = raw;
        } else if ("message" in b) {
          message = raw as string | string[];
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const text = Array.isArray(message) ? message.join(", ") : message;
    res.status(status).json({
      error: text,
      statusCode: status,
      ...(details
        ? {
            message: details,
            code: details.code,
          }
        : {}),
    });
  }
}
