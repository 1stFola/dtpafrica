import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from "@nestjs/common";
import { RequirePermissions } from "../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../admin/guards/permissions.guard";
import { BenchmarksService } from "./benchmarks.service";
import { CreateBenchmarkDto } from "./dto/create-benchmark.dto";

/** Reading is public. Benchmarks feed calibration, so changing them needs `players.calibrate`. */
@Controller("benchmarks")
export class BenchmarksController {
  constructor(@Inject(BenchmarksService) private readonly benchmarks: BenchmarksService) {}

  @Get()
  list() {
    return this.benchmarks.list();
  }

  @Post()
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @RequirePermissions("players.calibrate")
  create(@Body() dto: CreateBenchmarkDto) {
    return this.benchmarks.create(dto);
  }

  @Put(":id")
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @RequirePermissions("players.calibrate")
  update(@Param("id") id: string, @Body() dto: CreateBenchmarkDto) {
    return this.benchmarks.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @RequirePermissions("players.calibrate")
  remove(@Param("id") id: string) {
    return this.benchmarks.remove(id);
  }
}
