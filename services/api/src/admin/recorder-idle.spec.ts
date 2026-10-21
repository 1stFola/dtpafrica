import { describe, expect, it } from "vitest";
import {
  AUTO_SUBMIT_DELAY_MS,
  IDLE_LIMIT_MS,
  SUBMIT_TOO_EARLY,
  assessAutoSubmit,
  assessIdle,
  canSubmitYet,
  idleLockMessage,
  quietMinutes,
  type AutoSubmitCandidate,
  type IdleCandidate,
} from "./recorder-idle";

/**
 * When a live recording has been left running with nobody at it.
 *
 * Both mistakes here are expensive and they pull in opposite directions. Tripping early
 * stops a broadcast of a match that was being recorded perfectly well; never tripping
 * leaves the ScoreBoard showing a live match that ended hours ago. Most of these tests are
 * about the cases that must *not* trip.
 */

const NOW = new Date("2026-09-29T16:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

function candidate(over: Partial<IdleCandidate> = {}): IdleCandidate {
  return {
    matchId: "match-1",
    sheetStatus: "live",
    clockPhase: "running",
    lastEventAt: minutesAgo(1),
    halfStartedAt: minutesAgo(30),
    idleLockedAt: null,
    isTraining: false,
    ...over,
  };
}

describe("a recording that has been left running", () => {
  it("trips after twenty quiet minutes", () => {
    const verdict = assessIdle(candidate({ lastEventAt: minutesAgo(21) }), NOW);
    expect(verdict.idle).toBe(true);
    if (verdict.idle) expect(quietMinutes(verdict.quietMs)).toBe(21);
  });

  it("trips in added time too, which is still a running clock", () => {
    expect(
      assessIdle(candidate({ clockPhase: "added_running", lastEventAt: minutesAgo(25) }), NOW).idle
    ).toBe(true);
  });

  it("measures from kick-off when nothing has ever been filed", () => {
    /* A match that starts and records nothing is exactly the walked-away case. Measuring
       from "the last event" alone would mean it never trips. */
    const verdict = assessIdle(
      candidate({ lastEventAt: null, halfStartedAt: minutesAgo(40) }),
      NOW
    );
    expect(verdict.idle).toBe(true);
    if (verdict.idle) expect(verdict.since).toEqual(minutesAgo(40));
  });

  it("reports what it measured from, so an alert can say how long", () => {
    const verdict = assessIdle(candidate({ lastEventAt: minutesAgo(33) }), NOW);
    expect(verdict.idle).toBe(true);
    if (verdict.idle) {
      expect(verdict.since).toEqual(minutesAgo(33));
      expect(idleLockMessage(verdict.quietMs)).toContain("33 minutes");
    }
  });
});

describe("what must not trip", () => {
  it("leaves a recorder who filed an event a moment ago", () => {
    expect(assessIdle(candidate({ lastEventAt: minutesAgo(2) }), NOW).idle).toBe(false);
  });

  it("does not trip one second early", () => {
    /* The boundary, stated once so a later change to the limit cannot quietly move it. */
    const justInside = new Date(NOW.getTime() - IDLE_LIMIT_MS + 1000);
    expect(assessIdle(candidate({ lastEventAt: justInside }), NOW).idle).toBe(false);
    const justOutside = new Date(NOW.getTime() - IDLE_LIMIT_MS);
    expect(assessIdle(candidate({ lastEventAt: justOutside }), NOW).idle).toBe(true);
  });

  it("leaves a clock that is not running", () => {
    /* Half-time, awaiting added time and awaiting full time are somebody waiting, not
       somebody absent. A long gap there is the normal shape of a match. */
    for (const phase of [
      "pre_kickoff",
      "awaiting_added",
      "awaiting_second_half",
      "awaiting_full_time",
      "penalty_shootout",
      "finished",
    ]) {
      const verdict = assessIdle(candidate({ clockPhase: phase, lastEventAt: minutesAgo(90) }), NOW);
      expect(verdict.idle).toBe(false);
    }
  });

  it("leaves a sheet that is no longer live", () => {
    for (const status of ["submitted", "approved"]) {
      expect(assessIdle(candidate({ sheetStatus: status, lastEventAt: minutesAgo(90) }), NOW).idle).toBe(
        false
      );
    }
  });

  it("leaves a sheet it has already locked", () => {
    /* Otherwise every sweep would re-lock it and overwrite the timestamp the alert reads,
       so the panel would say the match went quiet a minute ago however long it had been. */
    const verdict = assessIdle(
      candidate({ idleLockedAt: minutesAgo(5), lastEventAt: minutesAgo(90) }),
      NOW
    );
    expect(verdict.idle).toBe(false);
    if (!verdict.idle) expect(verdict.reason).toBe("already_locked");
  });

  it("leaves a practice match alone", () => {
    /* The training sandbox is somebody learning the console. Locking them out of it, and
       raising an alert for a super admin, would be noise on both counts. */
    expect(assessIdle(candidate({ isTraining: true, lastEventAt: minutesAgo(90) }), NOW).idle).toBe(
      false
    );
  });

  it("leaves a running clock with no anchor at all to measure from", () => {
    /* A clock claiming to run with neither an event nor a kick-off time is a broken sheet,
       and guessing that it has been quiet since the epoch would lock it instantly. */
    expect(
      assessIdle(candidate({ lastEventAt: null, halfStartedAt: null }), NOW).idle
    ).toBe(false);
  });
});

describe("the message a locked recorder sees", () => {
  it("says how long it was quiet and who can undo it", () => {
    const message = idleLockMessage(24 * 60_000);
    expect(message).toContain("24 minutes");
    expect(message).toContain("ScoreBoard admin");
  });

  it("says the broadcast ended, because that is the part nobody else can see", () => {
    expect(idleLockMessage(IDLE_LIMIT_MS)).toContain("broadcast");
  });
});

describe("submitting a finished match nobody submitted", () => {
  /* A recorder who blows full time and walks away leaves a complete sheet in `live` for
     ever: the figures are right, nobody can approve them, and the fixture shows no
     result. */

  function finished(over: Partial<AutoSubmitCandidate> = {}): AutoSubmitCandidate {
    return {
      matchId: "match-1",
      sheetStatus: "live",
      clockPhase: "finished",
      fullTimeAt: minutesAgo(6),
      idleLockedAt: null,
      correctionRequested: false,
      isTraining: false,
      ...over,
    };
  }

  it("submits five minutes after full time", () => {
    const verdict = assessAutoSubmit(finished(), NOW);
    expect(verdict.submit).toBe(true);
  });

  it("does not submit a second early", () => {
    const justInside = new Date(NOW.getTime() - AUTO_SUBMIT_DELAY_MS + 1000);
    expect(assessAutoSubmit(finished({ fullTimeAt: justInside }), NOW).submit).toBe(false);
    const justOutside = new Date(NOW.getTime() - AUTO_SUBMIT_DELAY_MS);
    expect(assessAutoSubmit(finished({ fullTimeAt: justOutside }), NOW).submit).toBe(true);
  });

  it("never submits a recording the idle sweep stopped", () => {
    /* The sweep stopped it because nobody was there, so its figures are the ones nobody
       vouches for. Submitting them would push an unwatched sheet into the approval queue
       looking exactly like a recorder's own work. */
    const verdict = assessAutoSubmit(finished({ idleLockedAt: minutesAgo(30) }), NOW);
    expect(verdict.submit).toBe(false);
    if (!verdict.submit) expect(verdict.reason).toBe("locked");
  });

  it("waits while a correction request is pending", () => {
    /* The recorder has asked for the sheet back. Submitting it under them would be rude
       and would make the request unanswerable. */
    expect(assessAutoSubmit(finished({ correctionRequested: true }), NOW).submit).toBe(false);
  });

  it("does nothing before full time", () => {
    for (const phase of ["running", "awaiting_full_time", "penalty_shootout", "awaiting_second_half"]) {
      expect(assessAutoSubmit(finished({ clockPhase: phase }), NOW).submit).toBe(false);
    }
  });

  it("does nothing when full time was never recorded", () => {
    /* A finished phase with no timestamp is an older sheet from before the column
       existed. Guessing a moment for it could submit somebody's match instantly. */
    expect(assessAutoSubmit(finished({ fullTimeAt: null }), NOW).submit).toBe(false);
  });

  it("leaves a sheet somebody already submitted", () => {
    for (const status of ["submitted", "approved"]) {
      expect(assessAutoSubmit(finished({ sheetStatus: status }), NOW).submit).toBe(false);
    }
  });

  it("leaves a practice match alone", () => {
    expect(assessAutoSubmit(finished({ isTraining: true }), NOW).submit).toBe(false);
  });
});

describe("when a sheet may be sent for approval", () => {
  it("allows it once the second half is under way", () => {
    expect(canSubmitYet({ half: 2, phase: "running" })).toBe(true);
  });

  it("allows it for the rest of the match, not only at full time", () => {
    /* A recorder whose phone dies in the eighty-eighth minute should still be able to
       send up what they have. Gating on full time would lose that. */
    for (const phase of ["running", "added_running", "awaiting_full_time", "finished", "penalty_shootout"]) {
      expect(canSubmitYet({ half: 2, phase })).toBe(true);
    }
  });

  it("allows a record reopened for corrections, whichever half its clock was left in", () => {
    expect(canSubmitYet({ half: 1, phase: "correction" })).toBe(true);
    expect(canSubmitYet({ half: 2, phase: "correction" })).toBe(true);
  });

  it("refuses during the first half, however far in", () => {
    /* A sheet submitted at half-time is half a match: the approver sees a plausible
       record with forty-five minutes missing, and the recorder has to ask for it back
       to finish the job they were in the middle of. */
    for (const phase of ["pre_kickoff", "running", "awaiting_added", "added_running", "awaiting_second_half"]) {
      expect(canSubmitYet({ half: 1, phase })).toBe(false);
    }
  });

  it("refuses when there is no clock at all", () => {
    // A sheet that never kicked off has nothing to send.
    expect(canSubmitYet(null)).toBe(false);
  });

  it("explains itself in the recorder's terms", () => {
    expect(SUBMIT_TOO_EARLY).toContain("second half");
  });
});
