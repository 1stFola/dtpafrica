import { Module } from "@nestjs/common";
import { AdminGuardsModule } from "../admin/admin-guards.module";
import { BenchmarksController } from "./benchmarks.controller";
import { BenchmarksService } from "./benchmarks.service";

@Module({
  imports: [AdminGuardsModule],
  controllers: [BenchmarksController],
  providers: [BenchmarksService],
})
export class BenchmarksModule {}
