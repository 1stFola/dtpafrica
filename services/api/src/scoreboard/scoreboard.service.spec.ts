import { describe, it, expect, vi, beforeEach } from "vitest";
import * as allure from "allure-js-commons";
import { BadRequestException } from "@nestjs/common";
import { ScoreboardController } from "./scoreboard.controller";
import { ScoreboardService } from "./scoreboard.service";
import { CompetitionEngineService } from "./competition-engine.service";
import { LiveAudioCommentaryService } from "./live-audio-commentary.service";

// ── Minimal mocks ─────────────────────────────────────────────────────────────

const mockSb = {
  overview: vi.fn().mockResolvedValue({ competitions: [], matches: [] }),
  competitions: vi.fn().mockResolvedValue([]),
  stats: vi.fn().mockResolvedValue({ total: 0 }),
  teams: vi.fn().mockResolvedValue([]),
  search: vi.fn().mockResolvedValue([]),
  highlights: vi.fn().mockResolvedValue([]),
  matches: vi.fn().mockResolvedValue([]),
  listMatches: vi.fn().mockResolvedValue([]),
  statLeaders: vi.fn().mockResolvedValue([]),
};

const mockEngine = {
  groupStandings: vi.fn().mockResolvedValue([]),
};

const mockLiveAudio = {
  poll: vi.fn().mockResolvedValue({ active: false, sequence: 0, startedAt: null, mimeType: null, chunks: [] }),
};

describe("ScoreboardController", () => {
  let controller: ScoreboardController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ScoreboardController(
      mockSb as unknown as ScoreboardService,
      mockEngine as unknown as CompetitionEngineService,
      mockLiveAudio as unknown as LiveAudioCommentaryService
    );
  });

  describe("GET /scoreboard/overview", () => {
    it("returns scoreboard overview", async () => {
      await allure.epic("API");
      await allure.feature("Scoreboard");
      await allure.story("Overview");
      await allure.severity("normal");

      const result = await controller.overview();
      expect(mockSb.overview).toHaveBeenCalledOnce();
      expect(result).toHaveProperty("competitions");
    });
  });

  describe("GET /scoreboard/competitions/:slug/stat-leaders", () => {
    it("accepts valid metric 'goals'", async () => {
      await allure.epic("API");
      await allure.feature("Scoreboard");
      await allure.story("Stat leaders — valid metric");
      await allure.severity("normal");

      mockSb.statLeaders.mockResolvedValue([{ playerId: "p1", value: 5 }]);

      const result = await controller.statLeaders("jagaban-2026", "goals", "10");
      expect(mockSb.statLeaders).toHaveBeenCalledWith("jagaban-2026", "goals", 10);
      expect(Array.isArray(result)).toBe(true);
    });

    it("accepts valid metric 'assists'", async () => {
      await allure.epic("API");
      await allure.feature("Scoreboard");
      await allure.story("Stat leaders — assists metric");

      await controller.statLeaders("jagaban-2026", "assists", "5");
      expect(mockSb.statLeaders).toHaveBeenCalledWith("jagaban-2026", "assists", 5);
    });

    it("throws BadRequestException for invalid metric", async () => {
      await allure.epic("API");
      await allure.feature("Scoreboard");
      await allure.story("Stat leaders — invalid metric rejected");
      await allure.severity("critical");
      await allure.description(
        "The stat leaders endpoint must reject unknown metric values " +
        "to prevent silent data errors."
      );

      expect(() =>
        controller.statLeaders("jagaban-2026", "invalid_metric", "10")
      ).toThrow(BadRequestException);
    });

    it("defaults to limit 10 when limit param is absent", async () => {
      await allure.epic("API");
      await allure.feature("Scoreboard");
      await allure.story("Stat leaders — default limit");

      await controller.statLeaders("jagaban-2026", "goals", undefined);
      expect(mockSb.statLeaders).toHaveBeenCalledWith("jagaban-2026", "goals", 10);
    });
  });

  describe("GET /scoreboard/stats", () => {
    it("returns stats object", async () => {
      await allure.epic("API");
      await allure.feature("Scoreboard");
      await allure.story("Stats");

      const result = await controller.stats();
      expect(result).toHaveProperty("total");
    });
  });

  describe("GET /scoreboard/search", () => {
    it("calls search with query string", async () => {
      await allure.epic("API");
      await allure.feature("Scoreboard");
      await allure.story("Search");

      await controller.search("emeka");
      expect(mockSb.search).toHaveBeenCalledWith("emeka");
    });

    it("defaults to empty string when no query given", async () => {
      await allure.epic("API");
      await allure.feature("Scoreboard");
      await allure.story("Search — empty query");

      await controller.search();
      expect(mockSb.search).toHaveBeenCalledWith("");
    });
  });
});
