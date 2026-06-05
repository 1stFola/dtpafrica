import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { slugifyDisplayName } from "../home/slug";
import { UpsertBlogPostDto } from "./dto/upsert-blog-post.dto";

function slugifyTitle(title: string): string {
  return slugifyDisplayName(title);
}

@Injectable()
export class AdminBlogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.blogPost.findMany({
      orderBy: { updatedAt: "desc" },
    });
  }

  get(id: string) {
    return this.prisma.blogPost.findUnique({ where: { id } });
  }

  async create(dto: UpsertBlogPostDto) {
    const slug = dto.slug?.trim() || slugifyTitle(dto.title);
    const isPublished = dto.isPublished ?? false;
    return this.prisma.blogPost.create({
      data: {
        title: dto.title,
        slug,
        excerpt: dto.excerpt,
        body: dto.body,
        coverImageUrl: dto.coverImageUrl,
        isPublished,
        publishedAt: isPublished ? new Date() : new Date(),
      },
    });
  }

  async update(id: string, dto: UpsertBlogPostDto) {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Blog post not found");

    const slug = dto.slug?.trim() || existing.slug;
    const isPublished = dto.isPublished ?? existing.isPublished;

    return this.prisma.blogPost.update({
      where: { id },
      data: {
        title: dto.title,
        slug,
        excerpt: dto.excerpt,
        body: dto.body,
        coverImageUrl: dto.coverImageUrl,
        isPublished,
        publishedAt:
          isPublished && !existing.isPublished ? new Date() : existing.publishedAt,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.blogPost.delete({ where: { id } });
    return { deleted: true };
  }

  async setPublished(id: string, isPublished: boolean) {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Blog post not found");
    return this.prisma.blogPost.update({
      where: { id },
      data: {
        isPublished,
        publishedAt: isPublished ? new Date() : existing.publishedAt,
      },
    });
  }
}
