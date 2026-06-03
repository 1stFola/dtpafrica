import fs from "fs";

const p =
  "C:/Users/bioni/.cursor/projects/c-Users-bioni-OneDrive-Desktop-DTP-dtp-africa/agent-transcripts/c472ac4f-2b6e-4631-8517-23f69388d8e2/c472ac4f-2b6e-4631-8517-23f69388d8e2.jsonl";
const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
const line = lines.find((l) => l.includes("lh3.googleusercontent.com/pw"));
const row = JSON.parse(line);
const content = row.message?.content?.[0]?.text ?? "";

const driveIds = [
  "1VXdakTFwAZls2XqVueRLEXVGWRlif9QI",
  "1J-zTumuDs2_o25tZHJClpHzVaugmrb2L",
  "1IY4d34jbUhWpqu6MGqGe5hdSiYR_YgOd",
  "1QkxJ_7UUlP6zj97hPSW93Bg5ipBb1SIw",
  "1d2tPSEztfVBspmOfLcIAt91m5yIfKoCK",
  "19eYq68R9Da3bcZ6UZiCEc1g6QD47vztp",
  "12WreiMUT8f68rT1iqfkRGvJit0o0rdnb",
  "1yhCv46cTe2FKAx3RaQaLPg4-WjjA9EvO",
  "1UiGaeVFpgVj0g5hn7h3-mYAB1fkMUjoy",
  "14vq3c2DY0c4WIefLj-DzZ_TbV63yaPr2",
  "1tJ1wGWPv3E2WWsf3wzmoV1yhlYRvjwFs",
  "1LX5-oEMLnmDc50AGlWZMQd_wQ9dtkMsX",
  "1_2CQMpyMQIh-QaFtSFIyUWTRaQ6MwdOa",
  "1gHLayL1U6mGixlctyYrCU9ZerqIqRuoa",
];

const expectedPhotos = [9, 5, 6, 6, 4, 5, 5, 6, 6, 6, 6, 6, 6, 6];

// Collect lh3 URLs in document order, skipping the demo URL block before first match section.
const allLh3 = [...content.matchAll(/https:\/\/lh3\.googleusercontent\.com[^"\\\s]+/g)].map((m) =>
  m[0].replace(/\.$/, "")
);
// Drop leading example URL repeated in feature description (first unique before "TEAMS LOGO" section photos)
const teamsIdx = content.indexOf("TEAMS LOGO");
const mediaIdx = content.indexOf("MATCH", content.indexOf("VIDEO"));
const photoStreamStart = content.indexOf("https://lh3.googleusercontent.com", Math.max(teamsIdx, 0));
const ordered = allLh3.filter((url) => content.indexOf(url) >= photoStreamStart);

let offset = 0;
const blocks = driveIds.map((driveId, i) => {
  const count = expectedPhotos[i];
  const photos = ordered.slice(offset, offset + count);
  offset += count;
  return { match: i + 1, driveId, photoCount: photos.length, photos };
});

console.log(JSON.stringify({ ordered: ordered.length, blocks }, null, 2));
