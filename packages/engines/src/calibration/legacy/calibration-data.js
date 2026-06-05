// Helper functions for benchmark generation
const ATTRS = ["pace","acceleration","sprint_speed","stamina","strength","agility","dribbling","ball_control","passing","finishing","technique","first_touch","vision","composure","decision_making","work_rate","positioning","team_play"];

function clamp(v,min=1,max=100){ return Math.max(min, Math.min(max, v)); }
function round(v){ return Math.round(v); }

function getAgeFromDOB(dobString) {
  if (!dobString) return null;
  const dob = new Date(dobString);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

const BENCHMARK_MATURITY_MODE = "EARLY_PRO";

function maturityGroup(attr) {
  const physical = ["pace","acceleration","sprint_speed","stamina","strength","agility","work_rate"];
  const technical = ["dribbling","ball_control","passing","finishing","technique","first_touch"];
  const mental = ["vision","composure","decision_making","positioning","team_play"];

  if (physical.includes(attr)) return "physical";
  if (technical.includes(attr)) return "technical";
  return "mental";
}

function maturityAdjustment(attr, mode = "EARLY_PRO") {
  if (mode === "ESTABLISHED_PRO") return 0;
  if (mode === "ELITE_PEAK") return 2;

  if (mode === "EARLY_PRO") {
    const group = maturityGroup(attr);
    if (group === "physical") return -4;
    if (group === "technical") return -8;
    return -12;
  }

  return 0;
}

function applyMaturityToTemplate(baseRatings, mode = "EARLY_PRO") {
  const out = {};
  ATTRS.forEach(attr => {
    const adj = maturityAdjustment(attr, mode);
    out[attr] = clamp(round(baseRatings[attr] + adj));
  });

  if (mode === "EARLY_PRO") {
    out.first_touch = clamp(round(out.first_touch - 2));
    out.composure = clamp(round(out.composure - 2));
    out.decision_making = clamp(round(out.decision_making - 2));
    out.positioning = clamp(round(out.positioning - 2));
  }

  return out;
}

function summaryRatings(ratings) {
  const offAttrs = [ratings.pace, ratings.dribbling, ratings.finishing, ratings.positioning].filter(v => typeof v === 'number' && !isNaN(v));
  const defAttrs = [ratings.stamina, ratings.strength, ratings.work_rate].filter(v => typeof v === 'number' && !isNaN(v));
  
  const offScore = offAttrs.length > 0 ? Math.round(offAttrs.reduce((a,b) => a+b, 0) / offAttrs.length) : 50;
  const defScore = defAttrs.length > 0 ? Math.round(defAttrs.reduce((a,b) => a+b, 0) / defAttrs.length) : 50;
  const allAttrs = [...offAttrs, ...defAttrs];
  const overallScore = allAttrs.length > 0 ? Math.round(allAttrs.reduce((a,b) => a+b, 0) / allAttrs.length) : 50;
  
  return {
    offensive_score: offScore,
    defensive_score: defScore,
    overall_rating: overallScore
  };
}

function computeBenchmarkOverall(ratings, position) {
  const summary = summaryRatings(ratings);
  return clamp(round((summary.offensive_score * 0.55) + (summary.defensive_score * 0.45)));
}

function ratingsFromArray(arr) {
  const obj = {};
  ATTRS.forEach((k, i) => obj[k] = arr[i]);
  return obj;
}

function tweakRatings(base, tweaks = {}) {
  const out = { ...base };
  Object.entries(tweaks).forEach(([k, v]) => {
    out[k] = clamp(round((out[k] || 0) + v));
  });
  return out;
}

function benchmarkPlayer({
  full_name, position, archetype, nationality, overall_rating,
  template, tweaks = {}, gender = "Male", date_of_birth = "",
  height_ft = "", weight_kg = "", current_club = "",
  photo_url = "", video_url = ""
}) {
  const baseTemplate = ratingsFromArray(BENCHMARK_TEMPLATES[position][template]);
  const maturityAdjusted = applyMaturityToTemplate(baseTemplate, BENCHMARK_MATURITY_MODE);
  const finalRatings = tweakRatings(maturityAdjusted, tweaks);
  const earlyOverall = computeBenchmarkOverall(finalRatings, position);

  return {
    full_name, gender, date_of_birth, position,
    overall_rating: earlyOverall,
    nationality, height_ft, weight_kg,
    current_club, archetype,
    benchmark_maturity: BENCHMARK_MATURITY_MODE,
    photo_url, video_url,
    ...finalRatings
  };
}

// Benchmark Templates
const BENCHMARK_TEMPLATES = {
  ST: {
    "Explosive 9":        [92,90,93,75,74,82,85,84,72,88,84,84,74,82,80,78,89,76],
    "Power Finisher":     [82,78,86,88,90,73,80,82,70,93,84,85,72,88,85,80,94,74],
    "Complete Forward":   [78,74,80,83,82,72,82,85,84,91,88,89,85,90,89,79,94,84],
    "Mobile Striker":     [84,86,83,82,80,84,86,87,76,88,86,88,78,86,84,82,90,78]
  },
  WINGER: {
    "Explosive Dribbler": [95,95,94,82,68,92,92,89,78,81,86,86,79,80,76,80,80,80],
    "Creative Winger":    [88,89,87,84,66,90,89,89,84,78,87,88,85,84,82,82,82,86],
    "Wide Finisher":      [90,89,91,84,74,88,88,87,80,88,86,86,80,86,84,82,86,82],
    "Workhorse Wide Fwd": [86,87,86,86,72,84,83,83,78,78,81,82,78,80,78,88,79,84]
  },
  AM: {
    "Elite Creator":      [74,72,75,86,70,78,88,90,94,84,91,91,94,92,92,80,88,93],
    "Playmaker":          [78,79,77,82,66,86,88,89,90,80,89,90,91,89,88,82,85,90],
    "Dribbling Creator":  [82,84,80,80,64,92,92,91,84,81,89,90,87,86,84,78,84,85],
    "Attacking 10":       [79,80,78,78,66,84,86,88,85,84,87,88,86,87,84,78,86,84]
  },
  CM: {
    "Box-to-Box":         [84,83,84,92,80,82,84,85,82,78,83,84,80,82,84,92,84,86],
    "Controller":         [76,76,76,87,66,84,86,89,91,72,88,90,91,90,91,84,86,92],
    "Technical 8":        [80,81,79,89,64,89,89,90,88,76,88,90,88,88,87,88,84,90],
    "Dynamic 8":          [82,83,81,90,72,85,84,86,84,77,84,85,82,84,85,90,84,88]
  },
  CDM: {
    "Destroyer":          [72,70,74,88,88,70,74,78,78,60,78,80,76,84,87,88,90,84],
    "Deep Playmaker":     [68,66,70,89,82,72,80,84,90,70,85,86,89,90,92,84,94,92],
    "Hybrid DM":          [76,74,78,90,86,74,79,82,84,70,81,83,82,86,88,90,91,88],
    "Screening 6":        [70,68,72,86,78,72,76,80,84,62,80,83,83,87,90,86,92,89]
  },
  FB: {
    "Overlapping FB":     [92,91,93,88,74,86,82,83,80,70,80,81,78,80,82,90,82,85],
    "Power Fullback":     [90,88,91,87,82,80,78,80,78,68,78,79,74,78,80,88,83,83],
    "Inverted FB":        [78,77,79,86,70,78,80,84,90,70,86,85,88,86,87,84,83,90],
    "Wingback Runner":    [95,95,95,86,64,90,84,81,76,72,79,80,74,78,76,90,80,82]
  },
  CB: {
    "Stopper":            [76,72,79,80,94,68,68,78,76,52,74,78,72,88,90,82,94,84],
    "Recovery CB":        [84,81,86,81,88,74,74,80,78,50,76,80,74,84,88,84,91,84],
    "Ball-Playing CB":    [74,70,76,82,84,72,76,84,86,52,80,84,80,88,89,82,90,87],
    "Leader CB":          [72,68,75,82,90,68,70,80,80,50,76,80,74,90,92,82,93,86]
  }
};

const BENCHMARK_SEEDS = [
  // ST - existing 10
  { full_name:"Kylian Mbappé", date_of_birth:"1998-12-20", position:"ST", archetype:"Explosive 9", nationality:"France", region:"Europe", age_band:"Senior", overall_rating:92, template:"Explosive 9", tweaks:{ pace:4, acceleration:4, sprint_speed:3, agility:3, dribbling:3, finishing:2 } },
  { full_name:"Erling Haaland", date_of_birth:"2000-07-21", position:"ST", archetype:"Power Finisher", nationality:"Norway", region:"Europe", age_band:"Senior", overall_rating:91, template:"Power Finisher", tweaks:{ strength:3, finishing:2, pace:2, acceleration:-1, agility:-2 } },
  { full_name:"Harry Kane", date_of_birth:"1993-07-28", position:"ST", archetype:"Complete Forward", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:90, template:"Complete Forward", tweaks:{ pace:-4, acceleration:-4, sprint_speed:-3, passing:2, vision:2, team_play:1 } },
  { full_name:"Lautaro Martínez", date_of_birth:"1997-08-22", position:"ST", archetype:"Mobile Striker", nationality:"Argentina", region:"South America", age_band:"Senior", overall_rating:89, template:"Mobile Striker", tweaks:{ strength:4, composure:2, finishing:2 } },
  { full_name:"Alexander Isak", date_of_birth:"1999-09-21", position:"ST", archetype:"Mobile Striker", nationality:"Sweden", region:"Europe", age_band:"Senior", overall_rating:85, template:"Mobile Striker", tweaks:{ pace:2, agility:2, strength:-2, first_touch:-1 } },
  { full_name:"Victor Osimhen", date_of_birth:"1998-12-29", position:"ST", archetype:"Explosive 9", nationality:"Nigeria", region:"Africa", age_band:"Senior", overall_rating:87, template:"Explosive 9", tweaks:{ strength:5, finishing:1, passing:-2, team_play:-2 } },
  { full_name:"Viktor Gyökeres", date_of_birth:"1998-06-04", position:"ST", archetype:"Power Finisher", nationality:"Sweden", region:"Europe", age_band:"Senior", overall_rating:86, template:"Power Finisher", tweaks:{ pace:3, acceleration:2, strength:1, passing:-1 } },
  { full_name:"Julián Álvarez", date_of_birth:"2000-01-31", position:"ST", archetype:"Mobile Striker", nationality:"Argentina", region:"South America", age_band:"Senior", overall_rating:86, template:"Mobile Striker", tweaks:{ work_rate:3, team_play:2, positioning:-1 } },
  { full_name:"Jonathan David", date_of_birth:"2000-01-14", position:"ST", archetype:"Explosive 9", nationality:"Canada", region:"North America", age_band:"Senior", overall_rating:84, template:"Explosive 9", tweaks:{ finishing:-1, strength:-3, team_play:-1 } },
  { full_name:"Cristiano Ronaldo", date_of_birth:"1985-02-05", position:"ST", archetype:"Power Finisher", nationality:"Portugal", region:"Europe", age_band:"Senior", overall_rating:86, template:"Power Finisher", tweaks:{ pace:-2, acceleration:-3, sprint_speed:-1, composure:3, positioning:2 } },

  // ST - added 10
  { full_name:"Viktor Boniface", date_of_birth:"2000-12-23", position:"ST", archetype:"Power Finisher", nationality:"Nigeria", region:"Africa", age_band:"Senior", overall_rating:84, template:"Power Finisher", tweaks:{ strength:2, pace:2, dribbling:1, passing:-1 } },
  { full_name:"Ollie Watkins", date_of_birth:"1995-12-30", position:"ST", archetype:"Mobile Striker", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:84, template:"Mobile Striker", tweaks:{ pace:2, work_rate:2, finishing:1, team_play:1 } },
  { full_name:"Benjamin Šeško", date_of_birth:"2003-05-31", position:"ST", archetype:"Explosive 9", nationality:"Slovenia", region:"Europe", age_band:"U23", overall_rating:83, template:"Explosive 9", tweaks:{ strength:2, finishing:1, passing:-2 } },
  { full_name:"Darwin Núñez", date_of_birth:"1999-06-24", position:"ST", archetype:"Explosive 9", nationality:"Uruguay", region:"South America", age_band:"Senior", overall_rating:83, template:"Explosive 9", tweaks:{ pace:2, work_rate:1, composure:-2, finishing:-1 } },
  { full_name:"Santiago Giménez", date_of_birth:"2001-04-18", position:"ST", archetype:"Power Finisher", nationality:"Mexico", region:"North America", age_band:"Senior", overall_rating:83, template:"Power Finisher", tweaks:{ finishing:2, strength:1, passing:-2 } },
  { full_name:"Loïs Openda", date_of_birth:"2000-02-16", position:"ST", archetype:"Explosive 9", nationality:"Belgium", region:"Europe", age_band:"Senior", overall_rating:83, template:"Explosive 9", tweaks:{ pace:2, acceleration:2, team_play:-1 } },
  { full_name:"Serhou Guirassy", date_of_birth:"1996-03-12", position:"ST", archetype:"Power Finisher", nationality:"Guinea", region:"Africa", age_band:"Senior", overall_rating:84, template:"Power Finisher", tweaks:{ strength:2, finishing:2, pace:-1 } },
  { full_name:"Evan Ferguson", date_of_birth:"2004-10-19", position:"ST", archetype:"Complete Forward", nationality:"Ireland", region:"Europe", age_band:"U20", overall_rating:80, template:"Complete Forward", tweaks:{ strength:1, pace:-1, vision:1 } },
  { full_name:"Ivan Toney", date_of_birth:"1996-03-16", position:"ST", archetype:"Complete Forward", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:83, template:"Complete Forward", tweaks:{ strength:2, passing:1, pace:-2 } },
  { full_name:"Dušan Vlahović", date_of_birth:"2000-01-28", position:"ST", archetype:"Power Finisher", nationality:"Serbia", region:"Europe", age_band:"Senior", overall_rating:84, template:"Power Finisher", tweaks:{ strength:2, finishing:1, agility:-1 } },

  // WINGER - existing 10
  { full_name:"Vinícius Júnior", date_of_birth:"2000-07-12", position:"WINGER", archetype:"Explosive Dribbler", nationality:"Brazil", region:"South America", age_band:"Senior", overall_rating:90, template:"Explosive Dribbler", tweaks:{ dribbling:2, ball_control:1, finishing:2 } },
  { full_name:"Mohamed Salah", date_of_birth:"1992-06-15", position:"WINGER", archetype:"Wide Finisher", nationality:"Egypt", region:"Africa", age_band:"Senior", overall_rating:89, template:"Wide Finisher", tweaks:{ composure:2, decision_making:2, team_play:0 } },
  { full_name:"Bukayo Saka", date_of_birth:"2001-09-05", position:"WINGER", archetype:"Creative Winger", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:88, template:"Creative Winger", tweaks:{ work_rate:2, strength:2, finishing:1 } },
  { full_name:"Rafael Leão", date_of_birth:"1999-06-10", position:"WINGER", archetype:"Wide Finisher", nationality:"Portugal", region:"Europe", age_band:"Senior", overall_rating:86, template:"Wide Finisher", tweaks:{ pace:3, sprint_speed:3, strength:3, decision_making:-3 } },
  { full_name:"Lamine Yamal", date_of_birth:"2007-07-13", position:"WINGER", archetype:"Explosive Dribbler", nationality:"Spain", region:"Europe", age_band:"U20", overall_rating:89, template:"Explosive Dribbler", tweaks:{ vision:3, passing:3, strength:-4, finishing:1 } },
  { full_name:"Nico Williams", date_of_birth:"2002-07-12", position:"WINGER", archetype:"Explosive Dribbler", nationality:"Spain", region:"Europe", age_band:"Senior", overall_rating:85, template:"Explosive Dribbler", tweaks:{ pace:2, acceleration:2, ball_control:-1 } },
  { full_name:"Khvicha Kvaratskhelia", date_of_birth:"2001-02-12", position:"WINGER", archetype:"Creative Winger", nationality:"Georgia", region:"Europe", age_band:"Senior", overall_rating:86, template:"Creative Winger", tweaks:{ dribbling:2, finishing:1, work_rate:-1 } },
  { full_name:"Ousmane Dembélé", date_of_birth:"1997-05-15", position:"WINGER", archetype:"Explosive Dribbler", nationality:"France", region:"Europe", age_band:"Senior", overall_rating:86, template:"Explosive Dribbler", tweaks:{ passing:3, team_play:2, composure:-1 } },
  { full_name:"Rodrygo", date_of_birth:"2001-01-09", position:"WINGER", archetype:"Wide Finisher", nationality:"Brazil", region:"South America", age_band:"Senior", overall_rating:86, template:"Wide Finisher", tweaks:{ dribbling:1, ball_control:1, strength:-2 } },
  { full_name:"Son Heung-min", date_of_birth:"1992-07-08", position:"WINGER", archetype:"Wide Finisher", nationality:"South Korea", region:"Asia", age_band:"Senior", overall_rating:87, template:"Wide Finisher", tweaks:{ composure:2, finishing:2, pace:-1 } },

  // WINGER - added 10
  { full_name:"Ademola Lookman", date_of_birth:"1997-10-20", position:"WINGER", archetype:"Wide Finisher", nationality:"Nigeria", region:"Africa", age_band:"Senior", overall_rating:85, template:"Wide Finisher", tweaks:{ finishing:2, dribbling:1, passing:-1 } },
  { full_name:"Raphinha", date_of_birth:"1996-12-14", position:"WINGER", archetype:"Creative Winger", nationality:"Brazil", region:"South America", age_band:"Senior", overall_rating:85, template:"Creative Winger", tweaks:{ passing:2, work_rate:1, composure:1 } },
  { full_name:"Bradley Barcola", date_of_birth:"2002-09-02", position:"WINGER", archetype:"Explosive Dribbler", nationality:"France", region:"Europe", age_band:"Senior", overall_rating:83, template:"Explosive Dribbler", tweaks:{ pace:2, finishing:1, team_play:-1 } },
  { full_name:"Désiré Doué", date_of_birth:"2005-06-03", position:"WINGER", archetype:"Creative Winger", nationality:"France", region:"Europe", age_band:"U20", overall_rating:80, template:"Creative Winger", tweaks:{ dribbling:2, pace:1, composure:-2 } },
  { full_name:"Noni Madueke", date_of_birth:"2002-03-10", position:"WINGER", archetype:"Explosive Dribbler", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:81, template:"Explosive Dribbler", tweaks:{ pace:2, ball_control:1, team_play:-2 } },
  { full_name:"Johan Bakayoko", date_of_birth:"2003-04-20", position:"WINGER", archetype:"Explosive Dribbler", nationality:"Belgium", region:"Europe", age_band:"U23", overall_rating:81, template:"Explosive Dribbler", tweaks:{ acceleration:2, finishing:1, passing:-1 } },
  { full_name:"Sávio", date_of_birth:"2004-04-10", position:"WINGER", archetype:"Creative Winger", nationality:"Brazil", region:"South America", age_band:"U20", overall_rating:81, template:"Creative Winger", tweaks:{ dribbling:2, pace:1, strength:-2 } },
  { full_name:"Takefusa Kubo", date_of_birth:"2001-06-04", position:"WINGER", archetype:"Creative Winger", nationality:"Japan", region:"Asia", age_band:"Senior", overall_rating:83, template:"Creative Winger", tweaks:{ agility:2, passing:1, finishing:-1 } },
  { full_name:"Luis Díaz", date_of_birth:"1997-01-13", position:"WINGER", archetype:"Explosive Dribbler", nationality:"Colombia", region:"South America", age_band:"Senior", overall_rating:84, template:"Explosive Dribbler", tweaks:{ work_rate:1, dribbling:1, team_play:-1 } },
  { full_name:"Bryan Mbeumo", date_of_birth:"1999-08-07", position:"WINGER", archetype:"Wide Finisher", nationality:"Cameroon", region:"Africa", age_band:"Senior", overall_rating:83, template:"Wide Finisher", tweaks:{ strength:2, finishing:1, passing:1 } },

  // AM - existing 10
  { full_name:"Kevin De Bruyne", date_of_birth:"1991-06-28", position:"AM", archetype:"Elite Creator", nationality:"Belgium", region:"Europe", age_band:"Senior", overall_rating:90, template:"Elite Creator", tweaks:{ passing:2, vision:2, technique:1, pace:-2 } },
  { full_name:"Florian Wirtz", date_of_birth:"2003-05-03", position:"AM", archetype:"Playmaker", nationality:"Germany", region:"Europe", age_band:"U23", overall_rating:88, template:"Playmaker", tweaks:{ dribbling:2, ball_control:2, finishing:2 } },
  { full_name:"Jamal Musiala", date_of_birth:"2003-02-26", position:"AM", archetype:"Dribbling Creator", nationality:"Germany", region:"Europe", age_band:"U23", overall_rating:87, template:"Dribbling Creator", tweaks:{ agility:2, dribbling:2, strength:-2 } },
  { full_name:"Cole Palmer", date_of_birth:"2002-05-06", position:"AM", archetype:"Attacking 10", nationality:"England", region:"Europe", age_band:"U23", overall_rating:85, template:"Attacking 10", tweaks:{ composure:2, finishing:2, pace:-1 } },
  { full_name:"Bruno Fernandes", date_of_birth:"1994-09-08", position:"AM", archetype:"Elite Creator", nationality:"Portugal", region:"Europe", age_band:"Senior", overall_rating:87, template:"Elite Creator", tweaks:{ work_rate:3, finishing:1, strength:1, pace:-1 } },
  { full_name:"Martin Ødegaard", date_of_birth:"1998-12-17", position:"AM", archetype:"Playmaker", nationality:"Norway", region:"Europe", age_band:"Senior", overall_rating:88, template:"Playmaker", tweaks:{ team_play:2, decision_making:2, finishing:-1 } },
  { full_name:"Paulo Dybala", date_of_birth:"1993-11-15", position:"AM", archetype:"Attacking 10", nationality:"Argentina", region:"South America", age_band:"Senior", overall_rating:84, template:"Attacking 10", tweaks:{ technique:2, first_touch:2, stamina:-4 } },
  { full_name:"Mohammed Kudus", date_of_birth:"2000-08-02", position:"AM", archetype:"Dribbling Creator", nationality:"Ghana", region:"Africa", age_band:"Senior", overall_rating:83, template:"Dribbling Creator", tweaks:{ strength:3, finishing:1, passing:-1 } },
  { full_name:"Xavi Simons", date_of_birth:"2003-04-21", position:"AM", archetype:"Dribbling Creator", nationality:"Netherlands", region:"Europe", age_band:"U23", overall_rating:84, template:"Dribbling Creator", tweaks:{ pace:2, acceleration:2, team_play:1 } },
  { full_name:"Dominik Szoboszlai", date_of_birth:"2000-10-25", position:"AM", archetype:"Attacking 10", nationality:"Hungary", region:"Europe", age_band:"Senior", overall_rating:84, template:"Attacking 10", tweaks:{ technique:2, stamina:2, passing:1 } },

  // AM - added 10
  { full_name:"Phil Foden", date_of_birth:"2000-05-28", position:"AM", archetype:"Dribbling Creator", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:87, template:"Dribbling Creator", tweaks:{ finishing:2, vision:1, strength:-2 } },
  { full_name:"Eberechi Eze", date_of_birth:"1998-06-29", position:"AM", archetype:"Attacking 10", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:83, template:"Attacking 10", tweaks:{ dribbling:2, technique:1, work_rate:-1 } },
  { full_name:"Hakan Çalhanoğlu", date_of_birth:"1994-02-08", position:"AM", archetype:"Elite Creator", nationality:"Türkiye", region:"Europe", age_band:"Senior", overall_rating:85, template:"Elite Creator", tweaks:{ passing:2, technique:2, pace:-3 } },
  { full_name:"James Maddison", date_of_birth:"1996-11-23", position:"AM", archetype:"Attacking 10", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:84, template:"Attacking 10", tweaks:{ passing:2, vision:1, strength:-2 } },
  { full_name:"Dani Olmo", date_of_birth:"1998-05-07", position:"AM", archetype:"Playmaker", nationality:"Spain", region:"Europe", age_band:"Senior", overall_rating:84, template:"Playmaker", tweaks:{ finishing:1, technique:1, pace:1 } },
  { full_name:"Isco", date_of_birth:"1992-04-21", position:"AM", archetype:"Playmaker", nationality:"Spain", region:"Europe", age_band:"Senior", overall_rating:82, template:"Playmaker", tweaks:{ technique:2, first_touch:2, pace:-4 } },
  { full_name:"Kang-in Lee", date_of_birth:"2001-02-19", position:"AM", archetype:"Playmaker", nationality:"South Korea", region:"Asia", age_band:"Senior", overall_rating:82, template:"Playmaker", tweaks:{ agility:1, passing:1, strength:-2 } },
  { full_name:"Rayan Cherki", date_of_birth:"2003-08-17", position:"AM", archetype:"Dribbling Creator", nationality:"France", region:"Europe", age_band:"U23", overall_rating:81, template:"Dribbling Creator", tweaks:{ dribbling:2, technique:1, decision_making:-2 } },
  { full_name:"Morgan Gibbs-White", date_of_birth:"2000-01-27", position:"AM", archetype:"Attacking 10", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:82, template:"Attacking 10", tweaks:{ work_rate:2, passing:1, finishing:1 } },
  { full_name:"Pedro Gonçalves", date_of_birth:"1998-06-28", position:"AM", archetype:"Attacking 10", nationality:"Portugal", region:"Europe", age_band:"Senior", overall_rating:82, template:"Attacking 10", tweaks:{ finishing:2, composure:1, pace:-1 } },

  // CM - existing 10
  { full_name:"Jude Bellingham", date_of_birth:"2003-06-29", position:"CM", archetype:"Box-to-Box", nationality:"England", region:"Europe", age_band:"U23", overall_rating:90, template:"Box-to-Box", tweaks:{ technique:2, composure:2, positioning:2 } },
  { full_name:"Federico Valverde", date_of_birth:"1998-07-22", position:"CM", archetype:"Box-to-Box", nationality:"Uruguay", region:"South America", age_band:"Senior", overall_rating:88, template:"Box-to-Box", tweaks:{ pace:2, sprint_speed:2, work_rate:2 } },
  { full_name:"Bernardo Silva", date_of_birth:"1994-08-10", position:"CM", archetype:"Technical 8", nationality:"Portugal", region:"Europe", age_band:"Senior", overall_rating:88, template:"Technical 8", tweaks:{ agility:2, team_play:1, strength:-3 } },
  { full_name:"Nicolò Barella", date_of_birth:"1997-02-07", position:"CM", archetype:"Dynamic 8", nationality:"Italy", region:"Europe", age_band:"Senior", overall_rating:87, template:"Dynamic 8", tweaks:{ passing:1, work_rate:2, strength:1 } },
  { full_name:"Declan Rice", date_of_birth:"1999-01-14", position:"CM", archetype:"Box-to-Box", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:87, template:"Box-to-Box", tweaks:{ strength:3, passing:2, dribbling:-2 } },
  { full_name:"Alexis Mac Allister", date_of_birth:"1998-12-24", position:"CM", archetype:"Controller", nationality:"Argentina", region:"South America", age_band:"Senior", overall_rating:86, template:"Controller", tweaks:{ finishing:2, composure:1 } },
  { full_name:"Vitinha", date_of_birth:"2000-02-13", position:"CM", archetype:"Technical 8", nationality:"Portugal", region:"Europe", age_band:"Senior", overall_rating:86, template:"Technical 8", tweaks:{ strength:-2, agility:2, passing:1 } },
  { full_name:"Tijjani Reijnders", date_of_birth:"1998-07-29", position:"CM", archetype:"Dynamic 8", nationality:"Netherlands", region:"Europe", age_band:"Senior", overall_rating:85, template:"Dynamic 8", tweaks:{ finishing:2, pace:1 } },
  { full_name:"João Neves", date_of_birth:"2004-09-27", position:"CM", archetype:"Controller", nationality:"Portugal", region:"Europe", age_band:"U20", overall_rating:83, template:"Controller", tweaks:{ work_rate:2, strength:-3, agility:1 } },
  { full_name:"Bruno Guimarães", date_of_birth:"1997-11-16", position:"CM", archetype:"Controller", nationality:"Brazil", region:"South America", age_band:"Senior", overall_rating:86, template:"Controller", tweaks:{ strength:2, decision_making:1, pace:-1 } },

  // CM - added 10
  { full_name:"Enzo Fernández", date_of_birth:"2001-01-17", position:"CM", archetype:"Controller", nationality:"Argentina", region:"South America", age_band:"Senior", overall_rating:84, template:"Controller", tweaks:{ passing:2, composure:1, pace:-1 } },
  { full_name:"Ryan Gravenberch", date_of_birth:"2002-05-16", position:"CM", archetype:"Dynamic 8", nationality:"Netherlands", region:"Europe", age_band:"Senior", overall_rating:82, template:"Dynamic 8", tweaks:{ dribbling:1, pace:1, decision_making:-1 } },
  { full_name:"Sandro Tonali", date_of_birth:"2000-05-08", position:"CM", archetype:"Controller", nationality:"Italy", region:"Europe", age_band:"Senior", overall_rating:83, template:"Controller", tweaks:{ work_rate:2, passing:1, aggression:0 } },
  { full_name:"Frenkie de Jong", date_of_birth:"1997-05-12", position:"CM", archetype:"Technical 8", nationality:"Netherlands", region:"Europe", age_band:"Senior", overall_rating:86, template:"Technical 8", tweaks:{ ball_control:2, passing:2, strength:-2 } },
  { full_name:"Sergej Milinković-Savić", date_of_birth:"1995-02-27", position:"CM", archetype:"Box-to-Box", nationality:"Serbia", region:"Europe", age_band:"Senior", overall_rating:84, template:"Box-to-Box", tweaks:{ strength:3, technique:1, pace:-2 } },
  { full_name:"Pascal Groß", date_of_birth:"1991-06-15", position:"CM", archetype:"Controller", nationality:"Germany", region:"Europe", age_band:"Senior", overall_rating:82, template:"Controller", tweaks:{ passing:2, vision:2, pace:-4 } },
  { full_name:"Teun Koopmeiners", date_of_birth:"1998-02-28", position:"CM", archetype:"Box-to-Box", nationality:"Netherlands", region:"Europe", age_band:"Senior", overall_rating:84, template:"Box-to-Box", tweaks:{ finishing:2, passing:1, pace:-1 } },
  { full_name:"Mattéo Guendouzi", date_of_birth:"1999-04-14", position:"CM", archetype:"Dynamic 8", nationality:"France", region:"Europe", age_band:"Senior", overall_rating:81, template:"Dynamic 8", tweaks:{ work_rate:2, passing:1, finishing:-1 } },
  { full_name:"Conor Gallagher", date_of_birth:"2000-02-06", position:"CM", archetype:"Box-to-Box", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:81, template:"Box-to-Box", tweaks:{ work_rate:2, stamina:2, technique:-1 } },
  { full_name:"Kobbie Mainoo", date_of_birth:"2005-04-19", position:"CM", archetype:"Technical 8", nationality:"England", region:"Europe", age_band:"U20", overall_rating:80, template:"Technical 8", tweaks:{ composure:1, ball_control:1, strength:-2 } },

  // CDM - existing 10
  { full_name:"Rodri", date_of_birth:"1996-06-22", position:"CDM", archetype:"Deep Playmaker", nationality:"Spain", region:"Europe", age_band:"Senior", overall_rating:91, template:"Deep Playmaker", tweaks:{ passing:2, composure:2, positioning:1 } },
  { full_name:"Martín Zubimendi", date_of_birth:"1999-02-02", position:"CDM", archetype:"Screening 6", nationality:"Spain", region:"Europe", age_band:"Senior", overall_rating:84, template:"Screening 6", tweaks:{ passing:1, team_play:1 } },
  { full_name:"Moisés Caicedo", date_of_birth:"2001-11-02", position:"CDM", archetype:"Hybrid DM", nationality:"Ecuador", region:"South America", age_band:"Senior", overall_rating:85, template:"Hybrid DM", tweaks:{ acceleration:2, work_rate:2, passing:-1 } },
  { full_name:"João Palhinha", date_of_birth:"1995-07-09", position:"CDM", archetype:"Destroyer", nationality:"Portugal", region:"Europe", age_band:"Senior", overall_rating:84, template:"Destroyer", tweaks:{ strength:2, passing:-1, finishing:-2 } },
  { full_name:"Manuel Ugarte", date_of_birth:"2001-04-11", position:"CDM", archetype:"Destroyer", nationality:"Uruguay", region:"South America", age_band:"Senior", overall_rating:83, template:"Destroyer", tweaks:{ work_rate:2, agility:1, passing:-2 } },
  { full_name:"Wilfred Ndidi", date_of_birth:"1996-12-16", position:"CDM", archetype:"Destroyer", nationality:"Nigeria", region:"Africa", age_band:"Senior", overall_rating:81, template:"Destroyer", tweaks:{ strength:1, pace:1, ball_control:-2 } },
  { full_name:"Edson Álvarez", date_of_birth:"1997-10-24", position:"CDM", archetype:"Hybrid DM", nationality:"Mexico", region:"North America", age_band:"Senior", overall_rating:82, template:"Hybrid DM", tweaks:{ strength:2, pace:-1, finishing:-2 } },
  { full_name:"Casemiro", date_of_birth:"1992-02-23", position:"CDM", archetype:"Screening 6", nationality:"Brazil", region:"South America", age_band:"Senior", overall_rating:84, template:"Screening 6", tweaks:{ composure:2, decision_making:2, pace:-3 } },
  { full_name:"Youssouf Fofana", date_of_birth:"1999-01-10", position:"CDM", archetype:"Hybrid DM", nationality:"France", region:"Europe", age_band:"Senior", overall_rating:82, template:"Hybrid DM", tweaks:{ pace:1, team_play:1 } },
  { full_name:"Pierre-Emile Højbjerg", date_of_birth:"1995-08-05", position:"CDM", archetype:"Screening 6", nationality:"Denmark", region:"Europe", age_band:"Senior", overall_rating:81, template:"Screening 6", tweaks:{ strength:1, passing:1, agility:-1 } },

  // CDM - added 10
  { full_name:"Yves Bissouma", date_of_birth:"1996-08-30", position:"CDM", archetype:"Destroyer", nationality:"Mali", region:"Africa", age_band:"Senior", overall_rating:81, template:"Destroyer", tweaks:{ agility:1, dribbling:1, passing:-1 } },
  { full_name:"André Trindade", date_of_birth:"2001-07-16", position:"CDM", archetype:"Screening 6", nationality:"Brazil", region:"South America", age_band:"Senior", overall_rating:81, template:"Screening 6", tweaks:{ passing:1, composure:1, pace:-1 } },
  { full_name:"Boubacar Kamara", date_of_birth:"1999-11-23", position:"CDM", archetype:"Hybrid DM", nationality:"France", region:"Europe", age_band:"Senior", overall_rating:82, template:"Hybrid DM", tweaks:{ strength:1, positioning:1, passing:1 } },
  { full_name:"Amadou Onana", date_of_birth:"2001-08-16", position:"CDM", archetype:"Destroyer", nationality:"Belgium", region:"Europe", age_band:"Senior", overall_rating:81, template:"Destroyer", tweaks:{ strength:2, pace:1, passing:-1 } },
  { full_name:"Tyler Adams", date_of_birth:"1999-02-14", position:"CDM", archetype:"Hybrid DM", nationality:"United States", region:"North America", age_band:"Senior", overall_rating:80, template:"Hybrid DM", tweaks:{ work_rate:2, pace:1, passing:-1 } },
  { full_name:"Ibrahim Sangaré", date_of_birth:"1997-12-02", position:"CDM", archetype:"Destroyer", nationality:"Ivory Coast", region:"Africa", age_band:"Senior", overall_rating:80, template:"Destroyer", tweaks:{ strength:2, work_rate:1, agility:-1 } },
  { full_name:"Hidemasa Morita", date_of_birth:"1995-05-10", position:"CDM", archetype:"Screening 6", nationality:"Japan", region:"Asia", age_band:"Senior", overall_rating:80, template:"Screening 6", tweaks:{ passing:1, team_play:1, pace:-1 } },
  { full_name:"Denis Zakaria", date_of_birth:"1996-11-20", position:"CDM", archetype:"Hybrid DM", nationality:"Switzerland", region:"Europe", age_band:"Senior", overall_rating:80, template:"Hybrid DM", tweaks:{ strength:2, pace:1, finishing:-2 } },
  { full_name:"Douglas Luiz", date_of_birth:"1998-05-09", position:"CDM", archetype:"Deep Playmaker", nationality:"Brazil", region:"South America", age_band:"Senior", overall_rating:83, template:"Deep Playmaker", tweaks:{ technique:1, passing:1, pace:-1 } },
  { full_name:"Guido Rodríguez", date_of_birth:"1994-04-12", position:"CDM", archetype:"Screening 6", nationality:"Argentina", region:"South America", age_band:"Senior", overall_rating:79, template:"Screening 6", tweaks:{ positioning:1, strength:1, pace:-2 } },

  // FB - existing 10
  { full_name:"Achraf Hakimi", date_of_birth:"1998-11-04", position:"FB", archetype:"Overlapping FB", nationality:"Morocco", region:"Africa", age_band:"Senior", overall_rating:86, template:"Overlapping FB", tweaks:{ pace:2, acceleration:1, dribbling:1 } },
  { full_name:"Theo Hernández", date_of_birth:"1997-10-06", position:"FB", archetype:"Power Fullback", nationality:"France", region:"Europe", age_band:"Senior", overall_rating:86, template:"Power Fullback", tweaks:{ pace:2, sprint_speed:2, strength:2 } },
  { full_name:"Trent Alexander-Arnold", date_of_birth:"1998-10-07", position:"FB", archetype:"Inverted FB", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:86, template:"Inverted FB", tweaks:{ passing:2, vision:2, team_play:1 } },
  { full_name:"Jeremie Frimpong", date_of_birth:"2000-12-10", position:"FB", archetype:"Wingback Runner", nationality:"Netherlands", region:"Europe", age_band:"Senior", overall_rating:84, template:"Wingback Runner", tweaks:{ dribbling:2, finishing:1, strength:-2 } },
  { full_name:"Alphonso Davies", date_of_birth:"2000-11-02", position:"FB", archetype:"Wingback Runner", nationality:"Canada", region:"North America", age_band:"Senior", overall_rating:85, template:"Wingback Runner", tweaks:{ agility:2, ball_control:1, passing:-1 } },
  { full_name:"Jules Koundé", date_of_birth:"1998-11-12", position:"FB", archetype:"Power Fullback", nationality:"France", region:"Europe", age_band:"Senior", overall_rating:85, template:"Power Fullback", tweaks:{ positioning:2, decision_making:2, dribbling:-1 } },
  { full_name:"Nuno Mendes", date_of_birth:"2002-06-19", position:"FB", archetype:"Overlapping FB", nationality:"Portugal", region:"Europe", age_band:"U23", overall_rating:84, template:"Overlapping FB", tweaks:{ dribbling:1, passing:1 } },
  { full_name:"Andrew Robertson", date_of_birth:"1994-03-11", position:"FB", archetype:"Overlapping FB", nationality:"Scotland", region:"Europe", age_band:"Senior", overall_rating:84, template:"Overlapping FB", tweaks:{ passing:2, work_rate:2, sprint_speed:-2 } },
  { full_name:"Noussair Mazraoui", date_of_birth:"1997-11-14", position:"FB", archetype:"Inverted FB", nationality:"Morocco", region:"Africa", age_band:"Senior", overall_rating:82, template:"Inverted FB", tweaks:{ agility:1, team_play:1 } },
  { full_name:"Pervis Estupiñán", date_of_birth:"1998-01-21", position:"FB", archetype:"Power Fullback", nationality:"Ecuador", region:"South America", age_band:"Senior", overall_rating:82, template:"Power Fullback", tweaks:{ passing:1, work_rate:1 } },

  // FB - added 10
  { full_name:"Reece James", date_of_birth:"1999-12-08", position:"FB", archetype:"Power Fullback", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:84, template:"Power Fullback", tweaks:{ strength:2, passing:1, sprint_speed:-1 } },
  { full_name:"Miguel Gutiérrez", date_of_birth:"2001-07-27", position:"FB", archetype:"Inverted FB", nationality:"Spain", region:"Europe", age_band:"Senior", overall_rating:81, template:"Inverted FB", tweaks:{ passing:1, vision:1, pace:-1 } },
  { full_name:"Álex Grimaldo", date_of_birth:"1995-09-20", position:"FB", archetype:"Inverted FB", nationality:"Spain", region:"Europe", age_band:"Senior", overall_rating:84, template:"Inverted FB", tweaks:{ passing:2, technique:1, strength:-2 } },
  { full_name:"Oleksandr Zinchenko", date_of_birth:"1996-12-15", position:"FB", archetype:"Inverted FB", nationality:"Ukraine", region:"Europe", age_band:"Senior", overall_rating:81, template:"Inverted FB", tweaks:{ team_play:1, passing:1, pace:-2 } },
  { full_name:"Destiny Udogie", date_of_birth:"2002-11-28", position:"FB", archetype:"Overlapping FB", nationality:"Italy", region:"Europe", age_band:"Senior", overall_rating:82, template:"Overlapping FB", tweaks:{ pace:1, dribbling:1, decision_making:-1 } },
  { full_name:"Pedro Porro", date_of_birth:"1999-09-13", position:"FB", archetype:"Overlapping FB", nationality:"Spain", region:"Europe", age_band:"Senior", overall_rating:82, template:"Overlapping FB", tweaks:{ passing:1, finishing:1, positioning:-1 } },
  { full_name:"Denzel Dumfries", date_of_birth:"1996-04-18", position:"FB", archetype:"Power Fullback", nationality:"Netherlands", region:"Europe", age_band:"Senior", overall_rating:82, template:"Power Fullback", tweaks:{ strength:2, finishing:1, passing:-1 } },
  { full_name:"Diogo Dalot", date_of_birth:"1999-03-18", position:"FB", archetype:"Power Fullback", nationality:"Portugal", region:"Europe", age_band:"Senior", overall_rating:81, template:"Power Fullback", tweaks:{ passing:1, dribbling:1, work_rate:1 } },
  { full_name:"Ben White", date_of_birth:"1997-10-08", position:"FB", archetype:"Inverted FB", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:82, template:"Inverted FB", tweaks:{ positioning:2, decision_making:1, pace:-1 } },
  { full_name:"Federico Dimarco", date_of_birth:"1997-11-10", position:"FB", archetype:"Overlapping FB", nationality:"Italy", region:"Europe", age_band:"Senior", overall_rating:83, template:"Overlapping FB", tweaks:{ passing:2, technique:1, strength:-1 } },

  // CB - existing 10
  { full_name:"Virgil van Dijk", date_of_birth:"1991-07-08", position:"CB", archetype:"Leader CB", nationality:"Netherlands", region:"Europe", age_band:"Senior", overall_rating:89, template:"Leader CB", tweaks:{ strength:3, composure:2, positioning:2 } },
  { full_name:"William Saliba", date_of_birth:"2001-03-24", position:"CB", archetype:"Recovery CB", nationality:"France", region:"Europe", age_band:"U23", overall_rating:87, template:"Recovery CB", tweaks:{ composure:2, ball_control:1 } },
  { full_name:"Rúben Dias", date_of_birth:"1997-05-14", position:"CB", archetype:"Leader CB", nationality:"Portugal", region:"Europe", age_band:"Senior", overall_rating:88, template:"Leader CB", tweaks:{ strength:2, decision_making:2 } },
  { full_name:"Alessandro Bastoni", date_of_birth:"1999-04-13", position:"CB", archetype:"Ball-Playing CB", nationality:"Italy", region:"Europe", age_band:"Senior", overall_rating:87, template:"Ball-Playing CB", tweaks:{ passing:2, first_touch:1, pace:1 } },
  { full_name:"Antonio Rüdiger", date_of_birth:"1993-03-03", position:"CB", archetype:"Recovery CB", nationality:"Germany", region:"Europe", age_band:"Senior", overall_rating:87, template:"Recovery CB", tweaks:{ strength:2, composure:1 } },
  { full_name:"Gabriel Magalhães", date_of_birth:"1997-12-19", position:"CB", archetype:"Stopper", nationality:"Brazil", region:"South America", age_band:"Senior", overall_rating:85, template:"Stopper", tweaks:{ pace:1, strength:1 } },
  { full_name:"Marquinhos", date_of_birth:"1994-05-14", position:"CB", archetype:"Ball-Playing CB", nationality:"Brazil", region:"South America", age_band:"Senior", overall_rating:86, template:"Ball-Playing CB", tweaks:{ agility:1, pace:1, strength:-1 } },
  { full_name:"Ronald Araújo", date_of_birth:"1999-03-07", position:"CB", archetype:"Recovery CB", nationality:"Uruguay", region:"South America", age_band:"Senior", overall_rating:85, template:"Recovery CB", tweaks:{ strength:2, passing:-1 } },
  { full_name:"Kim Min-jae", date_of_birth:"1996-11-15", position:"CB", archetype:"Stopper", nationality:"South Korea", region:"Asia", age_band:"Senior", overall_rating:84, template:"Stopper", tweaks:{ pace:2, acceleration:2, strength:1 } },
  { full_name:"Cristian Romero", date_of_birth:"1998-04-27", position:"CB", archetype:"Leader CB", nationality:"Argentina", region:"South America", age_band:"Senior", overall_rating:85, template:"Leader CB", tweaks:{ agility:1, strength:1, passing:-1 } },

  // CB - added 10
  { full_name:"Jonathan Tah", date_of_birth:"1996-02-11", position:"CB", archetype:"Leader CB", nationality:"Germany", region:"Europe", age_band:"Senior", overall_rating:84, template:"Leader CB", tweaks:{ strength:2, positioning:1, pace:-1 } },
  { full_name:"Dayot Upamecano", date_of_birth:"1998-10-27", position:"CB", archetype:"Recovery CB", nationality:"France", region:"Europe", age_band:"Senior", overall_rating:83, template:"Recovery CB", tweaks:{ pace:2, strength:1, composure:-1 } },
  { full_name:"Micky van de Ven", date_of_birth:"2001-04-19", position:"CB", archetype:"Recovery CB", nationality:"Netherlands", region:"Europe", age_band:"U23", overall_rating:83, template:"Recovery CB", tweaks:{ pace:3, sprint_speed:2, passing:-1 } },
  { full_name:"Piero Hincapié", date_of_birth:"2002-01-09", position:"CB", archetype:"Ball-Playing CB", nationality:"Ecuador", region:"South America", age_band:"Senior", overall_rating:82, template:"Ball-Playing CB", tweaks:{ agility:1, pace:1, strength:-1 } },
  { full_name:"Willian Pacho", date_of_birth:"2001-10-16", position:"CB", archetype:"Stopper", nationality:"Ecuador", region:"South America", age_band:"Senior", overall_rating:82, template:"Stopper", tweaks:{ pace:1, composure:1, passing:-1 } },
  { full_name:"Ibrahima Konaté", date_of_birth:"1999-05-25", position:"CB", archetype:"Recovery CB", nationality:"France", region:"Europe", age_band:"Senior", overall_rating:83, template:"Recovery CB", tweaks:{ strength:2, pace:1, ball_control:-1 } },
  { full_name:"Jarrad Branthwaite", date_of_birth:"2002-06-27", position:"CB", archetype:"Stopper", nationality:"England", region:"Europe", age_band:"Senior", overall_rating:81, template:"Stopper", tweaks:{ strength:2, pace:1, passing:-1 } },
  { full_name:"Lisandro Martínez", date_of_birth:"1998-01-18", position:"CB", archetype:"Ball-Playing CB", nationality:"Argentina", region:"South America", age_band:"Senior", overall_rating:83, template:"Ball-Playing CB", tweaks:{ passing:2, aggression:0, strength:-2 } },
  { full_name:"Levi Colwill", date_of_birth:"2003-02-26", position:"CB", archetype:"Ball-Playing CB", nationality:"England", region:"Europe", age_band:"U23", overall_rating:81, template:"Ball-Playing CB", tweaks:{ passing:1, composure:1, pace:1 } },
  { full_name:"Murillo", date_of_birth:"2002-07-04", position:"CB", archetype:"Recovery CB", nationality:"Brazil", region:"South America", age_band:"Senior", overall_rating:81, template:"Recovery CB", tweaks:{ pace:2, strength:1, passing:-1 } }
];

const REAL_BENCHMARKS = BENCHMARK_SEEDS.map(seed => benchmarkPlayer(seed));
