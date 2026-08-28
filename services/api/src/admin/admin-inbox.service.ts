import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type InboxStatus = "all" | "active" | "unread" | "read" | "archived";
type InboxSource = "all" | "contact" | "newsletter";

@Injectable()
export class AdminInboxService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(query: { status?: string; q?: string; source?: string; limit?: number }) {
    const status = this.normalizeStatus(query.status);
    const source = this.normalizeSource(query.source);
    const where: Prisma.ContactMessageWhereInput = {};

    if (status === "active") {
      where.archivedAt = null;
    } else if (status === "unread") {
      where.archivedAt = null;
      where.readAt = null;
    } else if (status === "read") {
      where.archivedAt = null;
      where.readAt = { not: null };
    } else if (status === "archived") {
      where.archivedAt = { not: null };
    }

    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: "insensitive" } },
        { email: { contains: query.q, mode: "insensitive" } },
        { subject: { contains: query.q, mode: "insensitive" } },
        { message: { contains: query.q, mode: "insensitive" } },
      ];
    }

    if (source === "newsletter") {
      where.subject = { equals: "Newsletter signup", mode: "insensitive" };
    } else if (source === "contact") {
      where.NOT = { subject: { equals: "Newsletter signup", mode: "insensitive" } };
    }

    return this.prisma.contactMessage.findMany({
      where,
      take: Math.min(query.limit ?? 100, 200),
      orderBy: { createdAt: "desc" },
    }).then((rows) =>
      rows.map((row) => ({
        ...row,
        source:
          row.subject?.toLowerCase() === "newsletter signup"
            ? "newsletter"
            : "contact",
      }))
    );
  }

  async get(id: string) {
    const message = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!message) throw new NotFoundException("Contact message not found");
    return message;
  }

  async setRead(id: string, read = true) {
    await this.get(id);
    return this.prisma.contactMessage.update({
      where: { id },
      data: { readAt: read ? new Date() : null },
    });
  }

  async setArchived(id: string, archived = true) {
    await this.get(id);
    return this.prisma.contactMessage.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.contactMessage.delete({ where: { id } });
    return { ok: true };
  }

  private normalizeStatus(status?: string): InboxStatus {
    if (
      status === "all" ||
      status === "unread" ||
      status === "read" ||
      status === "archived"
    ) {
      return status;
    }
    return "active";
  }

  private normalizeSource(source?: string): InboxSource {
    if (source === "contact" || source === "newsletter") return source;
    return "all";
  }
}
