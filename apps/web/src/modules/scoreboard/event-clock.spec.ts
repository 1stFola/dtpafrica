import { describe, expect, it } from "vitest";
import { compareEventClock, eventClockLabel } from "./event-clock";

describe("the event clock", () => {
  it("reads a whole minute as it always did and a placed second beside it", () => {
    expect(eventClockLabel({ minute: 47 })).toBe("47'");
    expect(eventClockLabel({ minute: 47, secondInMinute: null })).toBe("47'");
    expect(eventClockLabel({ minute: 47, secondInMinute: 12 })).toBe("47'12\"");
    expect(eventClockLabel({ minute: 47, secondInMinute: 0 })).toBe("47'00\"");
  });

  it("orders by minute first, then by the second, with a missing second at the minute's start", () => {
    expect(compareEventClock({ minute: 46, secondInMinute: 59 }, { minute: 47 })).toBeLessThan(0);
    expect(compareEventClock({ minute: 47, secondInMinute: 12 }, { minute: 47 })).toBeGreaterThan(0);
    expect(compareEventClock({ minute: 47 }, { minute: 47, secondInMinute: 0 })).toBe(0);
    expect(compareEventClock({ minute: 47, secondInMinute: 5 }, { minute: 47, secondInMinute: 30 })).toBeLessThan(0);
  });
});
