const EVIDENCE_WEIGHT = {
  pace:0.75, acceleration:0.75, sprint_speed:0.75, stamina:0.70, strength:0.40, agility:0.68,
  dribbling:0.62, ball_control:0.65, passing:0.50, finishing:0.58, technique:0.55, first_touch:0.60,
  vision:0.42, composure:0.38, decision_making:0.45, work_rate:0.65, positioning:0.48, team_play:0.40
};

const POSITION_GROUPS = {
  ST: ["ST"],
  WINGER: ["WINGER", "RW", "LW"],
  RW: ["WINGER", "RW", "LW"],
  LW: ["WINGER", "RW", "LW"],
  AM: ["AM"],
  CM: ["CM"],
  CDM: ["CDM"],
  FB: ["FB", "LB", "RB"],
  LB: ["FB", "LB", "RB"],
  RB: ["FB", "LB", "RB"],
  CB: ["CB"]
};

function benchmarkPosition(position) {
  const normalized = String(position || "").trim().toUpperCase();
  if (normalized === "RW" || normalized === "LW" || normalized === "WINGER") return "WINGER";
  if (normalized === "RB" || normalized === "LB" || normalized === "RWB" || normalized === "LWB" || normalized === "FB") return "FB";
  return normalized;
}

function benchmarkAgeLabel(player) {
  const age = getAgeFromDOB(player.date_of_birth);
  if (age !== null) return `Age ${age}`;
  return player.age_band || "Age N/A";
}

function mean(arr) {
  if (!arr || !arr.length) return 50;
  const filtered = arr.filter(v => typeof v === 'number' && !isNaN(v));
  if (!filtered.length) return 50;
  return filtered.reduce((a,b) => a + b, 0) / filtered.length;
}

function stdDev(arr) {
  if (!arr || arr.length < 2) return 8;
  const filtered = arr.filter(v => typeof v === 'number' && !isNaN(v));
  if (filtered.length < 2) return 8;
  const m = mean(filtered);
  const variance = filtered.map(v => Math.pow(v - m, 2)).reduce((a,b) => a + b, 0) / filtered.length;
  return Math.sqrt(variance);
}

function getEvidenceTier(attr) {
  const strong = ["pace","acceleration","sprint_speed","stamina","strength","agility","dribbling","work_rate"];
  const medium = ["ball_control","finishing","technique","first_touch","positioning"];
  const weak = ["passing","vision","composure","decision_making","team_play"];

  if (strong.includes(attr)) return "strong";
  if (medium.includes(attr)) return "medium";
  return "weak";
}

function evidenceWeights(attr) {
  const tier = getEvidenceTier(attr);

  if (tier === "strong") {
    return { raw: 0.70, norm: 0.20, prior: 0.10 };
  }
  if (tier === "medium") {
    return { raw: 0.45, norm: 0.35, prior: 0.20 };
  }
  return { raw: 0.20, norm: 0.40, prior: 0.40 };
}

function getAttributeFloor(attr) {
  const physical = ["pace","acceleration","sprint_speed","stamina","strength","agility"];
  const technical = ["dribbling","ball_control","passing","finishing","technique","first_touch"];
  const mental = ["vision","composure","decision_making","work_rate","positioning","team_play"];

  if (physical.includes(attr)) return 42;
  if (technical.includes(attr)) return 38;
  if (mental.includes(attr)) return 35;
  return 35;
}

function clampToReasonableBand(value, normMean, normStd, attr) {
  if (isNaN(value)) return 50;
  const floor = getAttributeFloor(attr);
  const safeMean = isNaN(normMean) ? 50 : normMean;
  const safeStd = isNaN(normStd) ? 8 : normStd;
  const minBand = Math.max(floor, safeMean - (1.25 * Math.max(safeStd, 6)));
  const maxBand = Math.min(99, safeMean + (1.5 * Math.max(safeStd, 6)));
  return clamp(round(value), round(minBand), round(maxBand));
}



function ageToBand(age) {
  if (age == null) return "Senior";
  if (age <= 17) return "U17";
  if (age <= 20) return "U20";
  if (age <= 23) return "U23";
  return "Senior";
}

function similarityFromDistance(distance) {
  if (isNaN(distance) || distance === Infinity) return 50;
  return clamp(round(100 - (distance * 0.65)), 1, 99);
}

// Core Rating Computation
function estimateMissingFields(data) {
  if (!data.distance_with_ball || data.distance_with_ball === 0) {
    data.distance_with_ball = data.total_distance * 1760 * 0.18;
  }
  if (!data.top_speed_with_ball || data.top_speed_with_ball === 0) {
    data.top_speed_with_ball = data.top_speed * 0.72;
  }
  if (!data.intense_turns_with_ball || data.intense_turns_with_ball === 0) {
    data.intense_turns_with_ball = Math.round(data.intense_turns * 0.35);
  }
  return data;
}

function norm100(v, min, max) {
  if (max <= min) return 50;
  return clamp(round(((v - min) / (max - min)) * 100));
}

function computeRawRatings(data) {
  const md = data;
  const raw = {};

  const durationScore = norm100(md.duration ?? 90, 45, 95);
  const touchesScore = norm100(md.ball_touches ?? 0, 15, 140);
  const totalDistanceScore = norm100(md.total_distance ?? 0, 4.5, 7.5);
  const sprintDistanceScore = norm100(md.sprint_distance ?? 0, 60, 720);
  const accelScore = norm100(md.accelerations ?? 0, 8, 90);
  const decelScore = norm100(md.decelerations ?? 0, 8, 82);
  const accDecelBlend = (0.52 * accelScore) + (0.48 * decelScore);
  const topSpeedScore = norm100(md.top_speed ?? 0, 15.5, 22.0);
  const sprintsScore = norm100(md.sprints ?? 0, 0, 65);
  const intenseTurnsScore = norm100(md.intense_turns ?? 0, 4, 82);
  const avgTurnEntryScore = norm100(md.avg_turn_entry ?? 0, 6, 13);
  const avgTurnExitScore = norm100(md.avg_turn_exit ?? 0, 5, 11);
  const leftTurnsScore = norm100(md.left_turns ?? 0, 0, 90);
  const rightTurnsScore = norm100(md.right_turns ?? 0, 0, 90);
  const backTurnsScore = norm100(md.back_turns ?? 0, 0, 60);
  const kickingScore = norm100(md.kicking_power ?? 0, 35, 80);
  const distanceWBScore = norm100(md.distance_with_ball ?? 0, 10, 360);
  const topWBScore = norm100(md.top_speed_with_ball ?? 0, 8, 20);
  const turnsWBScore = norm100(md.intense_turns_with_ball ?? 0, 0, 20);

  const explosiveness = (
    0.28 * topSpeedScore +
    0.20 * sprintDistanceScore +
    0.16 * sprintsScore +
    0.20 * accelScore +
    0.16 * topWBScore
  );

  const engine = (
    0.34 * totalDistanceScore +
    0.16 * durationScore +
    0.24 * accDecelBlend +
    0.14 * sprintsScore +
    0.12 * touchesScore
  );

  const codAgility = (
    0.24 * intenseTurnsScore +
    0.14 * avgTurnEntryScore +
    0.16 * avgTurnExitScore +
    0.12 * leftTurnsScore +
    0.12 * rightTurnsScore +
    0.10 * backTurnsScore +
    0.12 * turnsWBScore
  );

  const ballCarryThreat = (
    0.38 * distanceWBScore +
    0.34 * topWBScore +
    0.18 * turnsWBScore +
    0.10 * touchesScore
  );

  const power = (
    0.52 * kickingScore +
    0.18 * accelScore +
    0.18 * decelScore +
    0.12 * sprintDistanceScore
  );

  const involvement = (
    0.42 * touchesScore +
    0.18 * durationScore +
    0.20 * totalDistanceScore +
    0.20 * distanceWBScore
  );

  raw.pace = clamp(round(
    0.45 * explosiveness +
    0.20 * topSpeedScore +
    0.15 * sprintDistanceScore +
    0.20 * topWBScore
  ));

  raw.acceleration = clamp(round(
    0.42 * accelScore +
    0.18 * decelScore +
    0.20 * explosiveness +
    0.20 * topWBScore
  ));

  raw.sprint_speed = clamp(round(
    0.60 * topSpeedScore +
    0.25 * sprintDistanceScore +
    0.15 * explosiveness
  ));

  raw.stamina = clamp(round(
    0.46 * engine +
    0.24 * totalDistanceScore +
    0.15 * durationScore +
    0.15 * accDecelBlend
  ));

  raw.strength = clamp(round(
    0.46 * power +
    0.20 * backTurnsScore +
    0.18 * decelScore +
    0.16 * engine
  ));

  raw.agility = clamp(round(
    0.44 * codAgility +
    0.22 * accelScore +
    0.18 * topWBScore +
    0.16 * turnsWBScore
  ));

  raw.dribbling = clamp(round(
    0.40 * ballCarryThreat +
    0.24 * codAgility +
    0.18 * touchesScore +
    0.18 * topWBScore
  ));

  raw.work_rate = clamp(round(
    0.42 * engine +
    0.20 * totalDistanceScore +
    0.18 * accDecelBlend +
    0.20 * involvement
  ));

  raw.ball_control = clamp(round(
    0.34 * ballCarryThreat +
    0.20 * touchesScore +
    0.16 * turnsWBScore +
    0.15 * avgTurnExitScore +
    0.15 * codAgility
  ));

  raw.finishing = clamp(round(
    0.40 * power +
    0.18 * topWBScore +
    0.14 * raw.sprint_speed +
    0.14 * raw.dribbling +
    0.14 * raw.ball_control
  ));

  raw.technique = clamp(round(
    0.34 * power +
    0.22 * raw.ball_control +
    0.18 * raw.dribbling +
    0.12 * avgTurnEntryScore +
    0.14 * topWBScore
  ));

  raw.first_touch = clamp(round(
    0.36 * raw.ball_control +
    0.22 * touchesScore +
    0.20 * turnsWBScore +
    0.22 * avgTurnExitScore
  ));

  raw.positioning = clamp(round(
    0.26 * backTurnsScore +
    0.22 * involvement +
    0.24 * raw.work_rate +
    0.28 * durationScore
  ));

  raw.passing = clamp(round(
    0.28 * involvement +
    0.18 * distanceWBScore +
    0.12 * backTurnsScore +
    0.20 * raw.ball_control +
    0.22 * durationScore
  ), 38, 78);

  raw.vision = clamp(round(
    0.24 * involvement +
    0.18 * backTurnsScore +
    0.18 * distanceWBScore +
    0.20 * raw.first_touch +
    0.20 * raw.passing
  ), 35, 80);

  raw.composure = clamp(round(
    0.22 * raw.first_touch +
    0.18 * raw.ball_control +
    0.18 * durationScore +
    0.18 * backTurnsScore +
    0.24 * touchesScore
  ), 35, 82);

  raw.decision_making = clamp(round(
    0.24 * raw.vision +
    0.20 * raw.composure +
    0.18 * backTurnsScore +
    0.18 * involvement +
    0.20 * intenseTurnsScore
  ), 35, 82);

  raw.team_play = clamp(round(
    0.26 * raw.passing +
    0.22 * raw.vision +
    0.20 * raw.decision_making +
    0.16 * raw.work_rate +
    0.16 * touchesScore
  ), 35, 82);

  // Apply strategic boosts to increase overall rating
  // These 5 attributes contribute to offensive score calculation
  raw.first_touch = clamp(raw.first_touch + 10);
  raw.technique = clamp(raw.technique + 10);
  raw.finishing = clamp(raw.finishing + 10);
  raw.ball_control = clamp(raw.ball_control + 10);
  raw.passing = clamp(raw.passing + 10);

  return raw;
}

function balanceCorrections(position, ratings) {
  return ratings;
}

function getPlayerMeta(formData) {
  const age = getAgeFromDOB(formData.date_of_birth);
  return {
    full_name: formData.full_name,
    gender: formData.gender,
    date_of_birth: formData.date_of_birth,
    age: age,
    position: formData.position,
    nationality: formData.nationality,
    height_ft: formData.height_ft,
    weight_kg: parseFloat(formData.weight_kg) || 0,
    current_club: formData.current_club,
    photo_url: formData.photo_url,
    video_url: formData.video_url
  };
}

function profileDistance(raw, bench){
  const weights = {
    pace:1.0, acceleration:1.0, sprint_speed:1.0, stamina:0.8, strength:0.7, agility:0.9,
    dribbling:1.0, ball_control:0.9, passing:0.8, finishing:1.0, technique:0.8, first_touch:0.8,
    vision:0.7, composure:0.7, decision_making:0.8, work_rate:0.7, positioning:0.9, team_play:0.7
  };
  let sum = 0;
  ATTRS.forEach(a => {
    const rawVal = raw[a] || 50;
    const benchVal = bench[a] || 50;
    sum += weights[a] * Math.pow(rawVal - benchVal, 2);
  });
  const distance = Math.sqrt(sum);
  return isNaN(distance) ? 999 : distance;
}

function getFilteredBenchmarkPool(position, meta) {
  const benchmark = benchmarkPosition(position);
  let pool = REAL_BENCHMARKS.filter(p => p.position === benchmark);
  const requestedGender = typeof meta?.gender === "string" ? meta.gender.trim().toLowerCase() : "";
  if (requestedGender) {
    const sameGender = pool.filter(p => String(p.gender || "").trim().toLowerCase() === requestedGender);
    if (sameGender.length > 0) {
      pool = sameGender;
    }
  }

  return {
    pool,
    filterInfo: {
      poolSize: pool.length
    }
  };
}

function buildBenchmarkNorms(position, meta) {
  const { pool, filterInfo } = getFilteredBenchmarkPool(position, meta);
  const norms = {};

  ATTRS.forEach(attr => {
    const values = pool.map(p => p[attr]).filter(v => typeof v === 'number' && !isNaN(v));
    const meanVal = mean(values);
    const stdVal = stdDev(values);
    const minVal = values.length > 0 ? Math.min(...values) : 35;
    const maxVal = values.length > 0 ? Math.max(...values) : 85;
    
    norms[attr] = {
      mean: isNaN(meanVal) ? 50 : meanVal,
      std: isNaN(stdVal) ? 8 : stdVal,
      min: isNaN(minVal) ? 35 : minVal,
      max: isNaN(maxVal) ? 85 : maxVal
    };
  });

  return { norms, pool, filterInfo };
}

function buildPositionPrior(position, attr, normMean) {
  const benchmark = benchmarkPosition(position);
  const priorOffsets = {
    ST: { finishing: 4, positioning: 3, passing: -2, vision: -2, team_play: -1 },
    WINGER: { pace: 3, acceleration: 3, sprint_speed: 3, agility: 3, dribbling: 3, strength: -3 },
    AM: { passing: 3, vision: 4, technique: 3, first_touch: 3, decision_making: 2 },
    CM: { stamina: 3, work_rate: 4, team_play: 4, passing: 2, decision_making: 3 },
    CDM: { positioning: 4, decision_making: 3, strength: 3, finishing: -4 },
    FB: { stamina: 4, work_rate: 4, pace: 2, sprint_speed: 2, finishing: -4 },
    CB: { positioning: 5, strength: 4, composure: 2, finishing: -6, dribbling: -4 }
  };

  const offset = (priorOffsets[benchmark] && priorOffsets[benchmark][attr]) || 0;
  return clamp(round(normMean + offset));
}

function findNearestBenchmark(position, raw, meta){
  const benchmark = benchmarkPosition(position);
  let { pool } = getFilteredBenchmarkPool(position, meta);

  if (pool.length < 3) {
    pool = REAL_BENCHMARKS.filter(p => p.position === benchmark);
  }

  const ranked = pool.map(p => {
    const distance = profileDistance(raw, p);
    const similarity = similarityFromDistance(distance);
    return {...p, __distance: isNaN(distance) ? 999 : distance, __similarity: isNaN(similarity) ? 50 : similarity};
  }).sort((a,b) => a.__distance - b.__distance);

  const BENCHMARK_CANDIDATE_COUNT = 6;
  const candidates = ranked.slice(0, BENCHMARK_CANDIDATE_COUNT);

  return {
    rankedCandidates: candidates,
    nearest: candidates[0] || {__similarity: 50, __distance: 999},
    alternatives: candidates.slice(1),
    filterInfo: {poolSize: ranked.length}
  };
}

function calibrate(meta, raw){
  const nearestResult = findNearestBenchmark(meta.position, raw, meta);
  const nearest = nearestResult.nearest;

  const { norms, filterInfo } = buildBenchmarkNorms(meta.position, meta);
  const calibrated = {};

  ATTRS.forEach(attr => {
    const weights = evidenceWeights(attr);
    const normMean = norms[attr]?.mean || 50;
    const normStd = norms[attr]?.std || 8;
    const prior = buildPositionPrior(meta.position, attr, normMean);

    const rawValue = raw[attr] || 50;
    const value =
      (rawValue * weights.raw) +
      (normMean * weights.norm) +
      (prior * weights.prior);

    const finalValue = clampToReasonableBand(value, normMean, normStd, attr);
    calibrated[attr] = isNaN(finalValue) ? 50 : finalValue;
  });

  const balanced = balanceCorrections(meta.position, calibrated);

  return {
    calibrated: balanced,
    rankedCandidates: nearestResult.rankedCandidates,
    nearest,
    alternatives: nearestResult.alternatives,
    filterInfo
  };
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return null;
  const headers = lines[0].split(',').map(h => h.trim());
  const values = lines[1].split(',').map(v => v.trim());
  const data = {};
  headers.forEach((h, i) => data[h] = values[i]);
  return data;
}
