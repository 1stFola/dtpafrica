import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { AdminMatchStatsController } from "./admin-match-stats.controller";

/**
 * Nest registers routes in declaration order, so a fixed path declared below
 * `GET :matchId` is answered by that handler with the word as a match id. That is how
 * the stopped-recordings list returned "Match not found" and the dashboard panel
 * stayed empty while sheets sat locked.
 */
describe("match-stats route order", () => {
  it("declares every fixed GET path above GET :matchId", () => {
    const proto = AdminMatchStatsController.prototype as unknown as Record<string, unknown>;
    const gets = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== "constructor" && typeof proto[name] === "function")
      .filter((name) => Reflect.getMetadata(METHOD_METADATA, proto[name] as object) === RequestMethod.GET)
      .map((name) => String(Reflect.getMetadata(PATH_METADATA, proto[name] as object)));

    const catchAll = gets.indexOf(":matchId");
    expect(catchAll).toBeGreaterThan(-1);
    const fixedBelow = gets.slice(catchAll + 1).filter((path) => !path.startsWith(":"));
    expect(fixedBelow).toEqual([]);
    expect(gets.slice(0, catchAll)).toContain("idle-locked");
  });
});
