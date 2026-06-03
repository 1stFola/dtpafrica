import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { AdsConfigService } from "../ads/ads-config.service";
import { ContactDto } from "./dto/contact.dto";
import { RegisterPlayerDto } from "./dto/register-player.dto";
import { HomeService } from "./home.service";

@Controller("home")
export class HomeController {
  constructor(
    @Inject(HomeService) private readonly home: HomeService,
    @Inject(AdsConfigService) private readonly ads: AdsConfigService
  ) {}

  @Get("featured-players")
  featuredPlayers(@Query("limit") limit?: string) {
    return this.home.featuredPlayers(limit != null ? Number(limit) : 24);
  }

  @Get("players/:slugOrId")
  publicPlayer(
    @Param("slugOrId") slugOrId: string,
    @Query("club") club?: string,
    @Query("competition") competition?: string,
    @Query("role") role?: string
  ) {
    return this.home.publicPlayer(slugOrId, { club, competition, role });
  }

  @Post("register")
  register(@Body() dto: RegisterPlayerDto) {
    return this.home.register(dto);
  }

  @Post("contact")
  contact(@Body() dto: ContactDto) {
    return this.home.submitContact(dto);
  }

  @Get("blog")
  blogList() {
    return this.home.listBlog();
  }

  @Get("blog/:slug")
  blogPost(@Param("slug") slug: string) {
    return this.home.blogBySlug(slug);
  }

  @Get("academies")
  academies() {
    return this.home.listAcademies();
  }

  @Get("academies/:slug")
  academy(@Param("slug") slug: string) {
    return this.home.academyBySlug(slug);
  }

  @Get("content")
  staticContent(@Query("keys") keys?: string) {
    return this.home.staticContent(keys);
  }

  @Get("ads")
  adsConfig() {
    return this.ads.getConfig();
  }
}
