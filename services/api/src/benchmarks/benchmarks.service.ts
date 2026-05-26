import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateBenchmarkDto } from "./dto/create-benchmark.dto";

@Injectable()
export class BenchmarksService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tacticalBenchmark.findMany({
      where: { isActive: true },
      orderBy: { playerName: "asc" },
    });
  }

  create(dto: CreateBenchmarkDto) {
    return this.prisma.tacticalBenchmark.create({ data: dto });
  }

  async update(id: string, dto: Partial<CreateBenchmarkDto>) {
    try {
      return await this.prisma.tacticalBenchmark.update({ where: { id }, data: dto });
    } catch {
      throw new NotFoundException(`Benchmark ${id} not found`);
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.tacticalBenchmark.delete({ where: { id } });
      return { deleted: true };
    } catch {
      throw new NotFoundException(`Benchmark ${id} not found`);
    }
  }
}
