import { Controller, Get, Module, Param, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { RequirePerms } from "../common/decorators";
import { AuditService } from "./audit.service";

@Controller("audit")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePerms("payments.view")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  report(@Query("from") from: string, @Query("to") to: string) {
    return this.audit.report(from, to);
  }

  @Get("export")
  async export(@Query("from") from: string, @Query("to") to: string) {
    const report = await this.audit.report(from, to);
    const pdf = await this.audit.toPdf(report);
    return file(`audit-${from}-to-${to}.pdf`, pdf);
  }

  @Get("files")
  files() {
    return { dir: this.audit.dir(), files: this.audit.listStored() };
  }

  @Get("files/:file")
  stored(@Param("file") fileName: string) {
    const found = this.audit.readStored(fileName);
    return file(found.file, found.body);
  }
}

function file(filename: string, body: Buffer) {
  return new StreamableFile(body, {
    type: "application/pdf",
    disposition: `attachment; filename="${filename}"`,
  });
}

@Module({
  providers: [AuditService],
  controllers: [AuditController],
})
export class AuditModule {}
