import { Controller, Get, Header } from "@nestjs/common";

/**
 * The server's clock, for browsers to measure their own against.
 *
 * The live match clock is anchored to wall-clock instants: the recorder's device stamps
 * kick-off, and every viewer counts from it with its own Date.now(). Two devices whose
 * clocks disagree by a minute show clocks a minute apart. Each browser asks this once,
 * works out how far its clock is from the server's (apps/web/src/lib/server-clock.ts),
 * and stamps and reads anchors on server time, so every screen counts from one clock.
 *
 * Milliseconds, because the HTTP Date header carries whole seconds only.
 */
@Controller("time")
export class TimeController {
  @Get()
  // A cached answer is a wrong answer.
  @Header("Cache-Control", "no-store")
  now(): { now: number } {
    return { now: Date.now() };
  }
}
