import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertStaticContentDto } from "./dto/upsert-static-content.dto";

const CONTENT_KEY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

@Injectable()
export class AdminContentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.staticContent.findMany({
      orderBy: { key: "asc" },
    });
  }

  upsert(key: string, dto: UpsertStaticContentDto) {
    if (!CONTENT_KEY_RE.test(key)) {
      throw new BadRequestException(
        "Content key may only contain lowercase letters, numbers, dots, dashes, and underscores"
      );
    }

    return this.prisma.staticContent.upsert({
      where: { key },
      update: { value: dto.value },
      create: { key, value: dto.value },
    });
  }
}
