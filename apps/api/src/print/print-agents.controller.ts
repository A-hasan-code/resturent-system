import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { RequirePerms } from "../common/decorators";
import { PrintAgentsService } from "./print-agents.service";

class AgentPrinterDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(200) driver?: string;
  @IsOptional() @IsString() @MaxLength(120) port?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class AgentDeviceDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(80) className?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(260) instanceId?: string;
  @IsOptional() @IsBoolean() problem?: boolean;
}

class RegisterAgentDto {
  @IsString() @MaxLength(80) machineKey!: string;
  @IsString() @MaxLength(80) hostname!: string;
  @IsOptional() @IsString() @MaxLength(80) displayName?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentPrinterDto)
  printers!: AgentPrinterDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentDeviceDto)
  devices?: AgentDeviceDto[];
}

class HeartbeatDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentPrinterDto)
  printers?: AgentPrinterDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentDeviceDto)
  devices?: AgentDeviceDto[];
}

class FailJobDto {
  @IsOptional() @IsString() @MaxLength(500) error?: string;
}

class RenameAgentDto {
  @IsString() @MaxLength(80) displayName!: string;
}

@Controller("print-agents")
export class PrintAgentsController {
  constructor(private readonly agents: PrintAgentsService) {}

  /** Admin: Additional PCs currently registered as print agents. */
  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms("printers.manage")
  list() {
    return this.agents.listForAdmin();
  }

  /** Admin: label counter PC (Lawn / Main / Rooftop) — used in printer names + Users assign. */
  @Patch(":id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms("printers.manage")
  rename(@Param("id") id: string, @Body() dto: RenameAgentDto) {
    return this.agents.rename(id, dto.displayName);
  }

  /** Desktop Additional PC: register / refresh local USB printers. */
  @Post("register")
  register(@Body() dto: RegisterAgentDto) {
    return this.agents.register(dto);
  }

  @Post("heartbeat")
  async heartbeat(@Headers("authorization") auth: string | undefined, @Body() dto: HeartbeatDto) {
    const agent = await this.agents.requireAgent(auth);
    return this.agents.heartbeat(agent.id, dto.printers, dto.devices);
  }

  @Post("jobs/claim")
  async claim(@Headers("authorization") auth: string | undefined) {
    const agent = await this.agents.requireAgent(auth);
    const job = await this.agents.claimNext(agent.id);
    return job ?? { id: null };
  }

  @Post("jobs/:id/done")
  async done(@Headers("authorization") auth: string | undefined, @Param("id") id: string) {
    const agent = await this.agents.requireAgent(auth);
    return this.agents.complete(agent.id, id);
  }

  @Post("jobs/:id/fail")
  async fail(
    @Headers("authorization") auth: string | undefined,
    @Param("id") id: string,
    @Body() dto: FailJobDto,
  ) {
    const agent = await this.agents.requireAgent(auth);
    return this.agents.fail(agent.id, id, dto.error || "Print failed on Additional PC");
  }
}
