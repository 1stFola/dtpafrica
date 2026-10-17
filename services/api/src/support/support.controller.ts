import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import { PublicFormThrottle } from "../shared/throttle";
import { CreateSupportReportDto } from "./dto/create-support-report.dto";
import { SupportService } from "./support.service";

type SupportRequest = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("support")
export class SupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Post("reports")
  @PublicFormThrottle()
  createReport(@Body() dto: CreateSupportReportDto, @Req() request: SupportRequest) {
    return this.support.createReport(dto, {
      userAgent: request.headers["user-agent"] ?? null,
      referer: request.headers.referer ?? null,
    });
  }
}
