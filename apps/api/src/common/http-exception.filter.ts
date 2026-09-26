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

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") message = body;
      else if (typeof body === "object" && body && "message" in body) {
        message = (body as { message: string | string[] }).message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const text = Array.isArray(message) ? message.join(", ") : message;
    res.status(status).json({ error: text, statusCode: status });
  }
}
