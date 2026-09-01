import { describe, it, expect, vi, beforeEach } from "vitest";
import * as allure from "allure-js-commons";
import { NotFoundException } from "@nestjs/common";
import { PlayersService } from "./players.service";

// ── Mock PrismaService ────────────────────────────────────────────────────────
const mockPrisma = {
  player: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  tacticalScores: {
    findUnique: vi.fn(),
  },
  positionFitSnapshot: {
    findUnique: vi.fn(),
  },
};

const mockPlayer = {
  id: "player-001",
  firstName: "Emeka",
  lastName: "Okafor",
  displayName: "Emeka Okafor",
  slug: "emeka-okafor",
  positionPrimary: "CM",
  positionSecondary: "CAM",
  nationality: "Nigerian",
  overallRating: 78,
  offensiveRating: 80,
  defensiveRating: 74,
  tacticalScores: null,
  positionFit: null,
  aggregatedMetrics: [],
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("PlayersService", () => {
  let service: PlayersService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlayersService(mockPrisma as any);
  });

  describe("list()", () => {
    it("returns up to 50 players by default", async () => {
      await allure.epic("API");
      await allure.feature("Players");
      await allure.story("List players");
      await allure.severity("normal");

      mockPrisma.player.findMany.mockResolvedValue([mockPlayer]);

      const result = await service.list();

      expect(mockPrisma.player.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 })
      );
      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe("Emeka Okafor");
    });

    it("caps limit at 100 regardless of input", async () => {
      await allure.epic("API");
      await allure.feature("Players");
      await allure.story("List players — limit cap");

      mockPrisma.player.findMany.mockResolvedValue([]);

      await service.list(999);

      expect(mockPrisma.player.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });
  });

  describe("getById()", () => {
    it("returns the player when found", async () => {
      await allure.epic("API");
      await allure.feature("Players");
      await allure.story("Get player by ID");
      await allure.severity("critical");

      mockPrisma.player.findUnique.mockResolvedValue(mockPlayer);

      const result = await service.getById("player-001");

      expect(result.id).toBe("player-001");
      expect(result.displayName).toBe("Emeka Okafor");
    });

    it("throws NotFoundException when player does not exist", async () => {
      await allure.epic("API");
      await allure.feature("Players");
      await allure.story("Get player by ID — not found");
      await allure.severity("critical");

      mockPrisma.player.findUnique.mockResolvedValue(null);

      await expect(service.getById("nonexistent")).rejects.toThrow(NotFoundException);
    });
  });

  describe("getTacticalScores()", () => {
    it("returns tactical scores when available", async () => {
      await allure.epic("API");
      await allure.feature("Players");
      await allure.story("Tactical scores");
      await allure.severity("normal");

      const scores = {
        playerId: "player-001",
        gegenpressScore: 72,
        tikiTakaScore: 65,
      };
      mockPrisma.tacticalScores.findUnique.mockResolvedValue(scores);

      const result = await service.getTacticalScores("player-001");
      expect(result.gegenpressScore).toBe(72);
    });

    it("throws NotFoundException when no tactical scores exist", async () => {
      await allure.epic("API");
      await allure.feature("Players");
      await allure.story("Tactical scores — not found");

      mockPrisma.tacticalScores.findUnique.mockResolvedValue(null);

      await expect(service.getTacticalScores("player-001")).rejects.toThrow(NotFoundException);
    });
  });

  describe("getPositionFit()", () => {
    it("throws NotFoundException when no position fit exists", async () => {
      await allure.epic("API");
      await allure.feature("Players");
      await allure.story("Position fit — not found");

      mockPrisma.positionFitSnapshot.findUnique.mockResolvedValue(null);

      await expect(service.getPositionFit("player-001")).rejects.toThrow(NotFoundException);
    });
  });

  describe("getTacticalProfile()", () => {
    it("returns a combined profile shape", async () => {
      await allure.epic("API");
      await allure.feature("Players");
      await allure.story("Tactical profile");
      await allure.severity("normal");

      mockPrisma.player.findUnique.mockResolvedValue(mockPlayer);

      const result = await service.getTacticalProfile("player-001");

      expect(result.player.id).toBe("player-001");
      expect(result.player.displayName).toBe("Emeka Okafor");
      expect(result.player.overallRating).toBe(78);
      expect(result).toHaveProperty("tacticalScores");
      expect(result).toHaveProperty("positionFit");
    });
  });
});
