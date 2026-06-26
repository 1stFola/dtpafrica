import { BadRequestException } from "@nestjs/common";

/** Nigeria (WAT) is fixed UTC+1 with no daylight saving. */
export const SCOREBOARD_WAT_OFFSET = "+01:00";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** Parse YYYY-MM-DD + HH:mm as West Africa Time into a UTC Date. */
export function parseWatKickoff(date: string, time: string): Date {
  if (!DATE_RE.test(date)) {
    throw new BadRequestException("kickoffDate must be YYYY-MM-DD");
  }
  if (!TIME_RE.test(time)) {
    throw new BadRequestException("kickoffTime must be HH:mm (24-hour WAT)");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new BadRequestException("kickoffDate is out of range");
  }
  if (hour > 23 || minute > 59) {
    throw new BadRequestException("kickoffTime must be a valid 24-hour WAT time");
  }
  const iso = `${date}T${time}:00${SCOREBOARD_WAT_OFFSET}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("Invalid kickoff date/time");
  }
  return parsed;
}

export function parseKickoffAtIso(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("kickoffAt must be a valid ISO-8601 datetime");
  }
  return parsed;
}
