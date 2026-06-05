import { Module } from "@nestjs/common";
import { BenchmarksController } from "./benchmarks.controller";
import { BenchmarksService } from "./benchmarks.service";

@Module({
  controllers: [BenchmarksController],
  providers: [BenchmarksService],
})
export class BenchmarksModule {}
