export type FormationId =
  | "4-3-3"
  | "4-2-3-1"
  | "4-4-2"
  | "3-4-3"
  | "3-5-2"
  | "4-1-4-1"
  | "5-3-2";

export type SlotRole = "gk" | "def" | "mid" | "att";

export type FormationSlot = {
  id: string;
  label: string;
  /** Acceptable position codes (see POSITION_ALIASES) */
  positions: string[];
  role: SlotRole;
  /** Pitch coordinates 0–100 (top = opponent goal) */
  x: number;
  y: number;
};

export const FORMATION_IDS: FormationId[] = [
  "4-3-3",
  "4-2-3-1",
  "4-4-2",
  "3-4-3",
  "3-5-2",
  "4-1-4-1",
  "5-3-2",
];

export const FORMATIONS: Record<FormationId, FormationSlot[]> = {
  "4-3-3": [
    { id: "gk", label: "GK", positions: ["GK"], role: "gk", x: 50, y: 90 },
    { id: "lb", label: "LB", positions: ["FB", "LB", "LWB"], role: "def", x: 18, y: 72 },
    { id: "cb1", label: "CB", positions: ["CB"], role: "def", x: 38, y: 78 },
    { id: "cb2", label: "CB", positions: ["CB"], role: "def", x: 62, y: 78 },
    { id: "rb", label: "RB", positions: ["FB", "RB", "RWB"], role: "def", x: 82, y: 72 },
    { id: "cm1", label: "CM", positions: ["CM", "DM", "CDM"], role: "mid", x: 32, y: 52 },
    { id: "cm2", label: "CM", positions: ["CM", "DM", "CDM"], role: "mid", x: 50, y: 48 },
    { id: "cm3", label: "CM", positions: ["CM", "AM"], role: "mid", x: 68, y: 52 },
    { id: "lw", label: "LW", positions: ["LW", "WINGER"], role: "att", x: 22, y: 28 },
    { id: "st", label: "ST", positions: ["ST"], role: "att", x: 50, y: 18 },
    { id: "rw", label: "RW", positions: ["RW", "WINGER"], role: "att", x: 78, y: 28 },
  ],
  "4-2-3-1": [
    { id: "gk", label: "GK", positions: ["GK"], role: "gk", x: 50, y: 90 },
    { id: "lb", label: "LB", positions: ["FB", "LB"], role: "def", x: 18, y: 72 },
    { id: "cb1", label: "CB", positions: ["CB"], role: "def", x: 38, y: 78 },
    { id: "cb2", label: "CB", positions: ["CB"], role: "def", x: 62, y: 78 },
    { id: "rb", label: "RB", positions: ["FB", "RB"], role: "def", x: 82, y: 72 },
    { id: "dm1", label: "DM", positions: ["DM", "CDM", "CM"], role: "mid", x: 38, y: 55 },
    { id: "dm2", label: "DM", positions: ["DM", "CDM", "CM"], role: "mid", x: 62, y: 55 },
    { id: "lam", label: "LAM", positions: ["LW", "WINGER", "AM"], role: "att", x: 22, y: 38 },
    { id: "cam", label: "CAM", positions: ["AM", "CM"], role: "att", x: 50, y: 35 },
    { id: "ram", label: "RAM", positions: ["RW", "WINGER", "AM"], role: "att", x: 78, y: 38 },
    { id: "st", label: "ST", positions: ["ST"], role: "att", x: 50, y: 16 },
  ],
  "4-4-2": [
    { id: "gk", label: "GK", positions: ["GK"], role: "gk", x: 50, y: 90 },
    { id: "lb", label: "LB", positions: ["FB", "LB"], role: "def", x: 18, y: 72 },
    { id: "cb1", label: "CB", positions: ["CB"], role: "def", x: 38, y: 78 },
    { id: "cb2", label: "CB", positions: ["CB"], role: "def", x: 62, y: 78 },
    { id: "rb", label: "RB", positions: ["FB", "RB"], role: "def", x: 82, y: 72 },
    { id: "lm", label: "LM", positions: ["LW", "WINGER", "CM"], role: "mid", x: 22, y: 48 },
    { id: "cm1", label: "CM", positions: ["CM", "DM"], role: "mid", x: 40, y: 52 },
    { id: "cm2", label: "CM", positions: ["CM", "DM"], role: "mid", x: 60, y: 52 },
    { id: "rm", label: "RM", positions: ["RW", "WINGER", "CM"], role: "mid", x: 78, y: 48 },
    { id: "st1", label: "ST", positions: ["ST"], role: "att", x: 40, y: 20 },
    { id: "st2", label: "ST", positions: ["ST"], role: "att", x: 60, y: 20 },
  ],
  "3-4-3": [
    { id: "gk", label: "GK", positions: ["GK"], role: "gk", x: 50, y: 90 },
    { id: "cb1", label: "CB", positions: ["CB"], role: "def", x: 28, y: 78 },
    { id: "cb2", label: "CB", positions: ["CB"], role: "def", x: 50, y: 80 },
    { id: "cb3", label: "CB", positions: ["CB"], role: "def", x: 72, y: 78 },
    { id: "lwb", label: "LWB", positions: ["FB", "LB", "LWB"], role: "mid", x: 18, y: 52 },
    { id: "cm1", label: "CM", positions: ["CM", "DM"], role: "mid", x: 40, y: 50 },
    { id: "cm2", label: "CM", positions: ["CM", "DM"], role: "mid", x: 60, y: 50 },
    { id: "rwb", label: "RWB", positions: ["FB", "RB", "RWB"], role: "mid", x: 82, y: 52 },
    { id: "lw", label: "LW", positions: ["LW", "WINGER"], role: "att", x: 22, y: 28 },
    { id: "st", label: "ST", positions: ["ST"], role: "att", x: 50, y: 18 },
    { id: "rw", label: "RW", positions: ["RW", "WINGER"], role: "att", x: 78, y: 28 },
  ],
  "3-5-2": [
    { id: "gk", label: "GK", positions: ["GK"], role: "gk", x: 50, y: 90 },
    { id: "cb1", label: "CB", positions: ["CB"], role: "def", x: 28, y: 78 },
    { id: "cb2", label: "CB", positions: ["CB"], role: "def", x: 50, y: 80 },
    { id: "cb3", label: "CB", positions: ["CB"], role: "def", x: 72, y: 78 },
    { id: "lwb", label: "LWB", positions: ["FB", "LB", "LWB"], role: "mid", x: 15, y: 52 },
    { id: "dm", label: "DM", positions: ["DM", "CDM", "CM"], role: "mid", x: 50, y: 55 },
    { id: "rwb", label: "RWB", positions: ["FB", "RB", "RWB"], role: "mid", x: 85, y: 52 },
    { id: "cm1", label: "CM", positions: ["CM", "AM"], role: "mid", x: 35, y: 42 },
    { id: "cm2", label: "CM", positions: ["CM", "AM"], role: "mid", x: 65, y: 42 },
    { id: "st1", label: "ST", positions: ["ST"], role: "att", x: 40, y: 20 },
    { id: "st2", label: "ST", positions: ["ST"], role: "att", x: 60, y: 20 },
  ],
  "4-1-4-1": [
    { id: "gk", label: "GK", positions: ["GK"], role: "gk", x: 50, y: 90 },
    { id: "lb", label: "LB", positions: ["FB", "LB"], role: "def", x: 18, y: 72 },
    { id: "cb1", label: "CB", positions: ["CB"], role: "def", x: 38, y: 78 },
    { id: "cb2", label: "CB", positions: ["CB"], role: "def", x: 62, y: 78 },
    { id: "rb", label: "RB", positions: ["FB", "RB"], role: "def", x: 82, y: 72 },
    { id: "dm", label: "DM", positions: ["DM", "CDM"], role: "mid", x: 50, y: 58 },
    { id: "lm", label: "LM", positions: ["LW", "WINGER", "CM"], role: "mid", x: 22, y: 42 },
    { id: "cm1", label: "CM", positions: ["CM", "AM"], role: "mid", x: 40, y: 45 },
    { id: "cm2", label: "CM", positions: ["CM", "AM"], role: "mid", x: 60, y: 45 },
    { id: "rm", label: "RM", positions: ["RW", "WINGER", "CM"], role: "mid", x: 78, y: 42 },
    { id: "st", label: "ST", positions: ["ST"], role: "att", x: 50, y: 16 },
  ],
  "5-3-2": [
    { id: "gk", label: "GK", positions: ["GK"], role: "gk", x: 50, y: 90 },
    { id: "lb", label: "LB", positions: ["FB", "LB"], role: "def", x: 12, y: 74 },
    { id: "cb1", label: "CB", positions: ["CB"], role: "def", x: 32, y: 80 },
    { id: "cb2", label: "CB", positions: ["CB"], role: "def", x: 50, y: 82 },
    { id: "cb3", label: "CB", positions: ["CB"], role: "def", x: 68, y: 80 },
    { id: "rb", label: "RB", positions: ["FB", "RB"], role: "def", x: 88, y: 74 },
    { id: "cm1", label: "CM", positions: ["CM", "DM"], role: "mid", x: 32, y: 50 },
    { id: "cm2", label: "CM", positions: ["CM", "DM"], role: "mid", x: 50, y: 48 },
    { id: "cm3", label: "CM", positions: ["CM", "DM"], role: "mid", x: 68, y: 50 },
    { id: "st1", label: "ST", positions: ["ST"], role: "att", x: 40, y: 20 },
    { id: "st2", label: "ST", positions: ["ST"], role: "att", x: 60, y: 20 },
  ],
};

export function normalizePosition(code: string): string {
  const u = code.trim().toUpperCase();
  const map: Record<string, string> = {
    GOALKEEPER: "GK",
    GKP: "GK",
    DEFENDER: "CB",
    MIDFIELDER: "CM",
    FORWARD: "ST",
    WING: "WINGER",
    WINGER: "WINGER",
    LWING: "LW",
    RWING: "RW",
    STRIKER: "ST",
    CAM: "AM",
    CDM: "DM",
  };
  return map[u] ?? u;
}

export function positionMatchesSlot(playerPos: string, slot: FormationSlot): boolean {
  const p = normalizePosition(playerPos);
  return slot.positions.some((s) => normalizePosition(s) === p);
}
