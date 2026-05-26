import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from "@nestjs/common";
import { BenchmarksService } from "./benchmarks.service";
import { CreateBenchmarkDto } from "./dto/create-benchmark.dto";

@Controller("benchmarks")
export class BenchmarksController {
  constructor(@Inject(BenchmarksService) private readonly benchmarks: BenchmarksService) {}

  @Get()
  list() {
    return this.benchmarks.list();
  }

  @Post()
  create(@Body() dto: CreateBenchmarkDto) {
    return this.benchmarks.create(dto);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() dto: CreateBenchmarkDto) {
    return this.benchmarks.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.benchmarks.remove(id);
  }
}
