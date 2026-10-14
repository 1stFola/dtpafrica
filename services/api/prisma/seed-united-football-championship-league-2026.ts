/**
 * United Football Championship League 2026 — twelve clubs, a single round robin,
 * every match at the Legacy Pitch, National Stadium, Surulere, Lagos.
 *
 * Generated from the organising committee's fixture export (66 matches over
 * eleven game weeks, 17 October – 29 December 2026) and its crest list. The
 * export gives dates only; kickoff slots come from the competition owner:
 * Saturdays 11:00, Mondays 09:00 / 11:00 / 13:00 / 15:00 in match-number order,
 * Tuesdays 09:00, all West Africa Time.
 *
 * The crest list labels clubs by short names ("JUMEZ", "FC BOX 2 BOX", "RIGHT TO
 * PLAY FA"); the fixture export's full names are canonical here and each crest
 * was matched to its club by hand. Honey Badger FC and the league itself have no
 * crest yet, so both carry a null logo until one is supplied.
 */
// Prisma is a value import: DbNull/JsonNull are runtime sentinels.
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { normalizeClubName } from "@dtp/engines";
import { shouldPreserveSbMatch } from "../src/seed/seed-options";
import { allocateMatchSlug, loadExistingMatchSlugs } from "../src/scoreboard/match-slug";

export const COMP_SLUG = "united-football-championship-league-2026";
const COMP_ID = "422fc25d-bf3d-46a2-a5e8-82da10a91a00";
const COMP_NAME = "United Football Championship League";
const TIMEZONE = "Africa/Lagos";
const VENUE = "Legacy Pitch, National Stadium, Surulere, Lagos";
const CITY = "Lagos";
const DESCRIPTION =
  "The United Football Championship League is a twelve-club round robin played at the Legacy Pitch, National Stadium, Surulere, Lagos. Every side meets each of the others once across eleven game weeks, from 17 October to 29 December 2026.";

export type TeamSeed = { id: string; slug: string; name: string; logoUrl: string | null };
export type MatchSeed = {
  id: string;
  /** Match number in the published schedule. */
  match: number;
  matchday: number;
  homeSlug: string;
  awaySlug: string;
  kickoffAt: string;
};

export const TEAMS: TeamSeed[] = [
  { id: "2bfe28b6-d2a0-49a9-9fe7-0627cec53e95", slug: "dominion-hotspur-fc", name: "Dominion Hotspur FC", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczPLr2I3irdSH14ypvf9QZT73EsMKg7HzF0fmNHybeGD04pTSNod9aaPiJTQcTGAykraTxCr6u9x4glDEuTXQeNno1x0VdWr4WqFEU6O4c8bqw3Xzjq97SfN8WZHTYfs8iAmafsS8UwRug0JitUrVIfq=w605-h636-s-no-gm?authuser=0" },
  { id: "64ee3e91-3d5d-4834-b990-8dc6931a54c9", slug: "box2box-fc", name: "BOX2BOX FC", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczOh-fbhnpOBAB4pIFHLrSBitaQfLtNkQpar0uCmYoPO1wRzlOkQ68yh31_A2Q4OapKSh7__QgMhKjfVNHwQleCPvjUz7SnAVOR0YUSEw-Nax27XeSW6LYusCCom4mcZ6-0VCSmh_T9NyZS8Kq3D0wy-=w309-h636-s-no-gm?authuser=0" },
  { id: "ff18bb50-8f2f-410a-8312-1c41a4a5b60d", slug: "jumez-international-fc", name: "Jumez International FC", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczN9F_QZTh2IUW4Y8NfuLsed-ATGOar6VIhZihXpTapfvKJHGMqyzthXiphOnDdT8kaPArwolcZA6ga2Tz3RQhZu7Ou_fHfrZK3ng2ykj8stMp4bxuFvpiWGxHHQTzxIJWQLzDo50j7-bDVDADk2-zS7=w683-h636-s-no-gm?authuser=0" },
  { id: "c75cf123-62c3-4496-8df3-984802a0644e", slug: "g12-football-club", name: "G12 Football Club", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczMKM7YciQUHpIDZ0uKi-eQQ5a0YKP7VlHPnZjGrZGevsuGiNDTCrh2mLbtlR6DtTHSKGRvrYG3mSB6uSv259q2_6cf4q17580LTiyps1-tU32tUjAG2ytr4hMkKsNOToVpvaSX5j3n-j5_D9ThoLVcr=w636-h636-s-no-gm?authuser=0" },
  { id: "a654ac28-802b-4b89-bac1-5c9b65ae0b43", slug: "honey-badger-fc", name: "Honey Badger FC", logoUrl: null },
  { id: "4d668e04-80f9-435c-9ee4-60bc9b00752b", slug: "patnik-football-academy", name: "Patnik Football Academy", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczPPnSAp3JFx8D3JEmKsYJx3rqjx4ID2t53MaL4E3nWxqDZNYIyGMXtjB_pQdl8gQQabL5qYjy1F_8V8tgI_WKOVPVdFTga3HRFw3-bri67zMwYkCKBDWF4c3WvTVySr8ZSLhYZSISzXZqa1V7dnL7W7=w636-h636-s-no-gm?authuser=0" },
  { id: "01a65015-1f6c-462c-a54c-210c03810fa2", slug: "fc-bethel-sporting", name: "FC Bethel Sporting", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczPkRpPWtPmiXvsypLXw_-UCZa_QqXi8rsnjKbgOq5vapZB6KcqBVuZeKqAVqqrcwKq_oUqqi3bI4xC0QAtvLQLrmEqAZe_f-5PtMAjgWGBGmZxt_4izIfBv7TPPt00vUaZ7vRdtgDKLubK8MlvbjWP-=w636-h636-s-no-gm?authuser=0" },
  { id: "57cdaf86-7281-4640-aa28-958c2289321d", slug: "evolution-united-football-academy", name: "Evolution United Football Academy", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczNEYuNNw0liAdKiy3AJmeaw2Nv_ndml5ClQ9OLZwvHUa0Y24EeyPWiKcHUYe6LDx54wJw7izpOeYGF7-tUpDXccS_7uWf2uDyo0t7c9NdlxajmPKQWKJOFJwfFKDyblxD8492qO6ko0tJ58-JtrVCN1=w636-h636-s-no-gm?authuser=0" },
  { id: "3ff4ee8d-55c0-4238-9de2-f23521cac153", slug: "the-charlesann-fc", name: "The Charlesann FC", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczPwkd7nL_Wz3zpjVepRR6lHIqqZlteRuzf_ijAXnjtIpjgfQz2Gy8nJJmyFLDH4WkhXJ-uSTihJNNBYcwJHiQiapIh-Z6DTw8NthRa8dwK7Gc2bl_mPEkkD9P3-Lki12CvHbC7DC6Zw0wnjd0GAkT-D=w636-h636-s-no-gm?authuser=0" },
  { id: "6d611e29-00d8-4f6f-ba3a-1c09856f219a", slug: "right-to-play-football-academy", name: "Right to Play Football Academy", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczMRuGfYTjGaZIY2ijjeM1n3QOS7LCv8puuCi6paEp0Vh--ODwmtXctfWxD85mTH1_yTi-Z0YNvQjCVlzrwwm0og_09NFb3_sv699TBrc9ZyxcyHuQNWbo-9RWT10wxQpA64pah43k76wMnyyM0u62Qp=w294-h636-s-no-gm?authuser=0" },
  { id: "22a0ce40-dd83-477b-9ef2-5ce192402fd0", slug: "ablaze-fc", name: "Ablaze FC", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczObJeLGgoVB4p5w3-W_DuobWrBgZfBZkEapIxZQdy_YtnnWcT6PiPc529W-EMQdi3pMx8yuPPOm4qKBJwyyocroGwnrF0Oq9aHqtzjlvtje-u4ZY8f4PIofNsTjwiidFGVlYXDa3Pczw1t4XBfjH_HA=w636-h636-s-no-gm?authuser=0" },
  { id: "476d616e-58bb-49db-bddb-0a447413d140", slug: "springsoca-united", name: "SpringSoca United", logoUrl: "https://lh3.googleusercontent.com/pw/AP1GczPcfKjBHWoSas7AmbicqtGMn8AWhv1AFMZj24u9qYCQK5QsgW3zQHVPYYe4v3j492nYL02ULa3vYeqohTJTXmeonIB_WDS6dlE4SfseEvgfqZQATKOZwXymLWpf1ZNvnGJXB6GymrTB5zGnROpGgT6O=w189-h254-s-no-gm?authuser=0" },
];

export const MATCHES: MatchSeed[] = [
  { id: "356ef0db-bd77-4f27-a690-0d4e587efa7b", match: 1, matchday: 1, homeSlug: "dominion-hotspur-fc", awaySlug: "box2box-fc", kickoffAt: "2026-10-17T11:00:00.000+01:00" },
  { id: "b89b443d-998e-47a4-b4c4-09c67f2a6c6f", match: 2, matchday: 1, homeSlug: "jumez-international-fc", awaySlug: "g12-football-club", kickoffAt: "2026-10-19T09:00:00.000+01:00" },
  { id: "1e44939f-2b6f-4ccb-88c1-3de9dba5428a", match: 3, matchday: 1, homeSlug: "honey-badger-fc", awaySlug: "patnik-football-academy", kickoffAt: "2026-10-19T11:00:00.000+01:00" },
  { id: "387363ad-29c9-4a03-9559-85115e38656f", match: 4, matchday: 1, homeSlug: "fc-bethel-sporting", awaySlug: "evolution-united-football-academy", kickoffAt: "2026-10-19T13:00:00.000+01:00" },
  { id: "c27734fd-a5f3-4537-bf17-4bb13754f7e0", match: 5, matchday: 1, homeSlug: "the-charlesann-fc", awaySlug: "right-to-play-football-academy", kickoffAt: "2026-10-19T15:00:00.000+01:00" },
  { id: "a84c5167-bb04-4c8d-a109-6c1a11f640af", match: 6, matchday: 1, homeSlug: "ablaze-fc", awaySlug: "springsoca-united", kickoffAt: "2026-10-20T09:00:00.000+01:00" },
  { id: "b117a287-418a-441a-aaf4-feb1f0bbdb01", match: 7, matchday: 2, homeSlug: "g12-football-club", awaySlug: "the-charlesann-fc", kickoffAt: "2026-10-24T11:00:00.000+01:00" },
  { id: "ce7fd8e3-a0f4-4428-9fdc-a9dd5689519c", match: 8, matchday: 2, homeSlug: "right-to-play-football-academy", awaySlug: "dominion-hotspur-fc", kickoffAt: "2026-10-26T09:00:00.000+01:00" },
  { id: "4d36259d-a8bb-476e-973f-71fdc3df02db", match: 9, matchday: 2, homeSlug: "fc-bethel-sporting", awaySlug: "ablaze-fc", kickoffAt: "2026-10-26T11:00:00.000+01:00" },
  { id: "c2988c9f-5d10-4c36-98a9-bad323fb2ab8", match: 10, matchday: 2, homeSlug: "box2box-fc", awaySlug: "patnik-football-academy", kickoffAt: "2026-10-26T13:00:00.000+01:00" },
  { id: "75a5b8d2-1b31-4c84-9649-d6385a707738", match: 11, matchday: 2, homeSlug: "springsoca-united", awaySlug: "honey-badger-fc", kickoffAt: "2026-10-26T15:00:00.000+01:00" },
  { id: "2050de88-4045-4f6e-8c2e-0ef0d0b53ddb", match: 12, matchday: 2, homeSlug: "evolution-united-football-academy", awaySlug: "jumez-international-fc", kickoffAt: "2026-10-27T09:00:00.000+01:00" },
  { id: "22b35db1-2171-4c0d-9dff-ba009d182361", match: 13, matchday: 3, homeSlug: "right-to-play-football-academy", awaySlug: "honey-badger-fc", kickoffAt: "2026-10-31T11:00:00.000+01:00" },
  { id: "6183922b-378f-4b53-b627-cbc782fb4b42", match: 14, matchday: 3, homeSlug: "the-charlesann-fc", awaySlug: "jumez-international-fc", kickoffAt: "2026-11-02T09:00:00.000+01:00" },
  { id: "c4bd410a-7273-4f72-a4d4-7071dc99ed3c", match: 15, matchday: 3, homeSlug: "g12-football-club", awaySlug: "springsoca-united", kickoffAt: "2026-11-02T11:00:00.000+01:00" },
  { id: "b33dbb7e-4cce-4a86-9cc0-547c69bbaf9e", match: 16, matchday: 3, homeSlug: "ablaze-fc", awaySlug: "box2box-fc", kickoffAt: "2026-11-02T13:00:00.000+01:00" },
  { id: "b2a5f129-b074-4d72-8993-c9159f82d4ab", match: 17, matchday: 3, homeSlug: "patnik-football-academy", awaySlug: "evolution-united-football-academy", kickoffAt: "2026-11-02T15:00:00.000+01:00" },
  { id: "03225611-926a-4a50-b020-fdd43b50b838", match: 18, matchday: 3, homeSlug: "dominion-hotspur-fc", awaySlug: "fc-bethel-sporting", kickoffAt: "2026-11-03T09:00:00.000+01:00" },
  { id: "85e75adc-9c38-4c48-b7b6-0a9b7bf999bb", match: 19, matchday: 4, homeSlug: "jumez-international-fc", awaySlug: "ablaze-fc", kickoffAt: "2026-11-07T11:00:00.000+01:00" },
  { id: "b3029aee-f289-422b-aa36-ff55fc37065d", match: 20, matchday: 4, homeSlug: "fc-bethel-sporting", awaySlug: "the-charlesann-fc", kickoffAt: "2026-11-09T09:00:00.000+01:00" },
  { id: "60b60c60-1c7d-4684-badd-97664ec41740", match: 21, matchday: 4, homeSlug: "box2box-fc", awaySlug: "honey-badger-fc", kickoffAt: "2026-11-09T11:00:00.000+01:00" },
  { id: "c6bfc545-79f4-4ce4-a680-4eb53247cf58", match: 22, matchday: 4, homeSlug: "springsoca-united", awaySlug: "right-to-play-football-academy", kickoffAt: "2026-11-09T13:00:00.000+01:00" },
  { id: "41f5871d-f0d1-429c-94c9-24d45446d598", match: 23, matchday: 4, homeSlug: "evolution-united-football-academy", awaySlug: "dominion-hotspur-fc", kickoffAt: "2026-11-09T15:00:00.000+01:00" },
  { id: "e678333a-f9b6-40f0-9d3e-7d6a952c2a80", match: 24, matchday: 4, homeSlug: "patnik-football-academy", awaySlug: "g12-football-club", kickoffAt: "2026-11-10T09:00:00.000+01:00" },
  { id: "25fb80e3-b1ac-47c6-bc55-8cf2f7c4afff", match: 25, matchday: 5, homeSlug: "evolution-united-football-academy", awaySlug: "springsoca-united", kickoffAt: "2026-11-14T11:00:00.000+01:00" },
  { id: "b5afdd2a-5121-42ad-941f-2bb23c065fab", match: 26, matchday: 5, homeSlug: "the-charlesann-fc", awaySlug: "ablaze-fc", kickoffAt: "2026-11-16T09:00:00.000+01:00" },
  { id: "7fb6527d-639c-40d7-b5c6-e752fef973bd", match: 27, matchday: 5, homeSlug: "patnik-football-academy", awaySlug: "fc-bethel-sporting", kickoffAt: "2026-11-16T11:00:00.000+01:00" },
  { id: "9703b506-a5c4-43fc-b134-834764bc9494", match: 28, matchday: 5, homeSlug: "honey-badger-fc", awaySlug: "g12-football-club", kickoffAt: "2026-11-16T13:00:00.000+01:00" },
  { id: "adabcf0e-4a0f-442a-ab6a-44949965c51c", match: 29, matchday: 5, homeSlug: "jumez-international-fc", awaySlug: "dominion-hotspur-fc", kickoffAt: "2026-11-16T15:00:00.000+01:00" },
  { id: "6abdbb8e-0985-414e-834e-cedf3a19c507", match: 30, matchday: 5, homeSlug: "right-to-play-football-academy", awaySlug: "box2box-fc", kickoffAt: "2026-11-17T09:00:00.000+01:00" },
  { id: "7533ab5a-c097-4970-92af-37dcb3247eec", match: 31, matchday: 6, homeSlug: "ablaze-fc", awaySlug: "patnik-football-academy", kickoffAt: "2026-11-21T11:00:00.000+01:00" },
  { id: "001d6783-30cc-414a-8e39-641e75c649c7", match: 32, matchday: 6, homeSlug: "g12-football-club", awaySlug: "evolution-united-football-academy", kickoffAt: "2026-11-23T09:00:00.000+01:00" },
  { id: "de82bb8b-ce63-41a4-89a8-bf9ef78e1549", match: 33, matchday: 6, homeSlug: "springsoca-united", awaySlug: "dominion-hotspur-fc", kickoffAt: "2026-11-23T11:00:00.000+01:00" },
  { id: "bdf19700-7c79-4e7b-9e3d-1cb3cf63b265", match: 34, matchday: 6, homeSlug: "box2box-fc", awaySlug: "jumez-international-fc", kickoffAt: "2026-11-23T13:00:00.000+01:00" },
  { id: "5a0cb1eb-ab6c-42a1-94b8-64982794173b", match: 35, matchday: 6, homeSlug: "right-to-play-football-academy", awaySlug: "fc-bethel-sporting", kickoffAt: "2026-11-23T15:00:00.000+01:00" },
  { id: "b1717293-a088-4de5-98af-6b9d5974251b", match: 36, matchday: 6, homeSlug: "honey-badger-fc", awaySlug: "the-charlesann-fc", kickoffAt: "2026-11-24T09:00:00.000+01:00" },
  { id: "69e6c780-e829-4502-a2bb-0e01dbd1a6c5", match: 37, matchday: 7, homeSlug: "springsoca-united", awaySlug: "fc-bethel-sporting", kickoffAt: "2026-11-28T11:00:00.000+01:00" },
  { id: "5b343d68-bb52-47b6-b239-f0e890cda178", match: 38, matchday: 7, homeSlug: "box2box-fc", awaySlug: "g12-football-club", kickoffAt: "2026-11-30T09:00:00.000+01:00" },
  { id: "90ecb720-4b9d-49df-95ea-a06e9417a838", match: 39, matchday: 7, homeSlug: "dominion-hotspur-fc", awaySlug: "the-charlesann-fc", kickoffAt: "2026-11-30T11:00:00.000+01:00" },
  { id: "8a5121b2-7642-486b-ae97-af80a5b8d394", match: 40, matchday: 7, homeSlug: "honey-badger-fc", awaySlug: "evolution-united-football-academy", kickoffAt: "2026-11-30T13:00:00.000+01:00" },
  { id: "5f36b7ed-927a-4827-8b0a-07256ef21a04", match: 41, matchday: 7, homeSlug: "ablaze-fc", awaySlug: "right-to-play-football-academy", kickoffAt: "2026-11-30T15:00:00.000+01:00" },
  { id: "6d34efb6-69e6-4a19-8eeb-f67a24468b09", match: 42, matchday: 7, homeSlug: "patnik-football-academy", awaySlug: "jumez-international-fc", kickoffAt: "2026-12-01T09:00:00.000+01:00" },
  { id: "281c8432-6491-4008-9fa2-bd45dc9c4e8c", match: 43, matchday: 8, homeSlug: "dominion-hotspur-fc", awaySlug: "honey-badger-fc", kickoffAt: "2026-12-05T11:00:00.000+01:00" },
  { id: "95281de7-59ca-4435-a431-00ec1b84f114", match: 44, matchday: 8, homeSlug: "evolution-united-football-academy", awaySlug: "ablaze-fc", kickoffAt: "2026-12-07T09:00:00.000+01:00" },
  { id: "06f98fd8-b672-4818-82c9-0d725b425cd4", match: 45, matchday: 8, homeSlug: "jumez-international-fc", awaySlug: "right-to-play-football-academy", kickoffAt: "2026-12-07T11:00:00.000+01:00" },
  { id: "d076b4d4-3aa3-42b4-bbc0-3fbd9749ae9d", match: 46, matchday: 8, homeSlug: "springsoca-united", awaySlug: "patnik-football-academy", kickoffAt: "2026-12-07T13:00:00.000+01:00" },
  { id: "c6408d7f-ace7-4945-b094-b405e9b55a57", match: 47, matchday: 8, homeSlug: "fc-bethel-sporting", awaySlug: "g12-football-club", kickoffAt: "2026-12-07T15:00:00.000+01:00" },
  { id: "950a54e6-14f0-443a-b656-aab3ac878657", match: 48, matchday: 8, homeSlug: "the-charlesann-fc", awaySlug: "box2box-fc", kickoffAt: "2026-12-08T09:00:00.000+01:00" },
  { id: "fa2b5f49-e96c-4958-b4ba-fa7b975ea8a2", match: 49, matchday: 9, homeSlug: "g12-football-club", awaySlug: "right-to-play-football-academy", kickoffAt: "2026-12-12T11:00:00.000+01:00" },
  { id: "6fc19628-7a77-4a77-b525-96e6d3a9736f", match: 50, matchday: 9, homeSlug: "patnik-football-academy", awaySlug: "the-charlesann-fc", kickoffAt: "2026-12-14T09:00:00.000+01:00" },
  { id: "b18b3c53-a1cb-458f-9eb8-13638e435947", match: 51, matchday: 9, homeSlug: "jumez-international-fc", awaySlug: "springsoca-united", kickoffAt: "2026-12-14T11:00:00.000+01:00" },
  { id: "f59bf725-40fe-4145-bf0f-3d58e380e566", match: 52, matchday: 9, homeSlug: "dominion-hotspur-fc", awaySlug: "ablaze-fc", kickoffAt: "2026-12-14T13:00:00.000+01:00" },
  { id: "64fd4367-9335-4479-8709-f95ea4849b31", match: 53, matchday: 9, homeSlug: "box2box-fc", awaySlug: "evolution-united-football-academy", kickoffAt: "2026-12-14T15:00:00.000+01:00" },
  { id: "c7099662-e3ff-496f-9e2d-62d1d41eb132", match: 54, matchday: 9, homeSlug: "fc-bethel-sporting", awaySlug: "honey-badger-fc", kickoffAt: "2026-12-15T09:00:00.000+01:00" },
  { id: "6a37640b-475e-412e-9a0c-7d6f966c4108", match: 55, matchday: 10, homeSlug: "the-charlesann-fc", awaySlug: "evolution-united-football-academy", kickoffAt: "2026-12-19T11:00:00.000+01:00" },
  { id: "6af7cc0d-47fb-410c-abfb-ac0f3b312140", match: 56, matchday: 10, homeSlug: "springsoca-united", awaySlug: "box2box-fc", kickoffAt: "2026-12-21T09:00:00.000+01:00" },
  { id: "a52c2100-bb27-4be4-a520-3544dbc21cee", match: 57, matchday: 10, homeSlug: "right-to-play-football-academy", awaySlug: "patnik-football-academy", kickoffAt: "2026-12-21T11:00:00.000+01:00" },
  { id: "addc71a1-41c8-4f07-864a-a339268282ce", match: 58, matchday: 10, homeSlug: "fc-bethel-sporting", awaySlug: "jumez-international-fc", kickoffAt: "2026-12-21T13:00:00.000+01:00" },
  { id: "b5997419-0d99-46cb-ae6c-62405e62348a", match: 59, matchday: 10, homeSlug: "ablaze-fc", awaySlug: "honey-badger-fc", kickoffAt: "2026-12-21T15:00:00.000+01:00" },
  { id: "b9cac098-09ff-409a-82cd-9273df9d1685", match: 60, matchday: 10, homeSlug: "g12-football-club", awaySlug: "dominion-hotspur-fc", kickoffAt: "2026-12-22T09:00:00.000+01:00" },
  { id: "d4e214ee-8056-490b-b561-42eb9f905b50", match: 61, matchday: 11, homeSlug: "box2box-fc", awaySlug: "fc-bethel-sporting", kickoffAt: "2026-12-26T11:00:00.000+01:00" },
  { id: "12ea3283-d772-4dfd-be9f-1003b6a96566", match: 62, matchday: 11, homeSlug: "dominion-hotspur-fc", awaySlug: "patnik-football-academy", kickoffAt: "2026-12-28T09:00:00.000+01:00" },
  { id: "3ddeff17-9f77-47c0-9ff2-d8b9208154a1", match: 63, matchday: 11, homeSlug: "g12-football-club", awaySlug: "ablaze-fc", kickoffAt: "2026-12-28T11:00:00.000+01:00" },
  { id: "66bede28-f4c6-43cc-98f2-7eec5c39aa19", match: 64, matchday: 11, homeSlug: "honey-badger-fc", awaySlug: "jumez-international-fc", kickoffAt: "2026-12-28T13:00:00.000+01:00" },
  { id: "d0aec069-df74-4c98-aa35-216206b0ed83", match: 65, matchday: 11, homeSlug: "the-charlesann-fc", awaySlug: "springsoca-united", kickoffAt: "2026-12-28T15:00:00.000+01:00" },
  { id: "6a3a394b-b73b-4ec2-8ab6-245458834772", match: 66, matchday: 11, homeSlug: "evolution-united-football-academy", awaySlug: "right-to-play-football-academy", kickoffAt: "2026-12-29T09:00:00.000+01:00" },
];

export async function seedUnitedFootballChampionshipLeague2026(prisma: PrismaClient) {
  const formatConfig = {
    format: "round_robin",
    overview: DESCRIPTION,
    timezone: TIMEZONE,
    venue: VENUE,
    teams: TEAMS.length,
    matchdays: 11,
    matches: MATCHES.length,
    league: { homeAndAway: false },
    points: { win: 3, draw: 1, loss: 0 },
    tiebreakers: ["points", "goal_difference", "goals_for", "head_to_head"],
  };

  const fields = {
    name: COMP_NAME,
    season: "2026",
    type: "league",
    formatType: "STANDARD_LEAGUE",
    formatConfig: formatConfig as Prisma.InputJsonValue,
    country: "Nigeria",
    logoUrl: null,
    description: DESCRIPTION,
    status: "scheduled",
    isPublished: true,
  };

  /* Create-only for the competition row's admin-editable fields: once it exists,
     a re-run must not reset a status, crest or description set in admin. */
  const comp = await prisma.sbCompetition.upsert({
    where: { slug: COMP_SLUG },
    update: { formatConfig: fields.formatConfig },
    create: { id: COMP_ID, slug: COMP_SLUG, ...fields },
  });

  const teamIds: Record<string, string> = {};
  for (const team of TEAMS) {
    const teamFields = {
      name: normalizeClubName(team.name),
      shortName: team.name,
      city: CITY,
      /* A single table, so no group key. */
      groupKey: null,
    };
    const row = await prisma.sbTeam.upsert({
      where: { competitionId_slug: { competitionId: comp.id, slug: team.slug } },
      /* A crest added later in admin (Honey Badger FC has none yet) is kept. */
      update: teamFields,
      create: {
        id: team.id,
        competitionId: comp.id,
        slug: team.slug,
        logoUrl: team.logoUrl,
        ...teamFields,
      },
    });
    teamIds[team.slug] = row.id;
  }

  /* A match that already exists keeps its slug. allocateMatchSlug treats the
     match's own current slug as taken, so re-allocating on every run would move
     each URL to "-2" and back on alternate runs. */
  const existingSlugs = new Map(
    (
      await prisma.sbMatch.findMany({
        where: { id: { in: MATCHES.map((m) => m.id) } },
        select: { id: true, slug: true },
      })
    ).map((r) => [r.id, r.slug])
  );
  const usedMatchSlugs = await loadExistingMatchSlugs(prisma);
  let seeded = 0;
  let preserved = 0;
  for (const match of MATCHES) {
    /* Never overwrite a match that has kicked off or had events recorded. */
    if (await shouldPreserveSbMatch(prisma, match.id)) {
      preserved += 1;
      continue;
    }
    const shared = {
      slug:
        existingSlugs.get(match.id) ??
        allocateMatchSlug(match.homeSlug, match.awaySlug, usedMatchSlugs),
      /* Left empty on purpose: the ScoreBoard pages title a numbered matchday
         "Day N", and a game week here spans up to three dates. With no matchday
         the fixtures group under roundLabel instead, as JOEMARK's do. */
      matchday: null,
      homeTeamId: teamIds[match.homeSlug],
      awayTeamId: teamIds[match.awaySlug],
      status: "scheduled",
      homeScore: 0,
      awayScore: 0,
      minute: null,
      kickoffAt: new Date(match.kickoffAt),
      venue: VENUE,
      roundLabel: `Week ${match.matchday}`,
      // `stats` is a nullable Json column; Prisma rejects a bare `null` here.
      stats: Prisma.DbNull,
      isPublished: true,
      meta: { timezone: TIMEZONE, matchNumber: match.match, gameWeek: match.matchday } as Prisma.InputJsonValue,
    };
    await prisma.sbMatch.upsert({
      where: { id: match.id },
      update: shared,
      create: { id: match.id, competitionId: comp.id, ...shared },
    });
    seeded += 1;
  }

  const [teamCount, matchCount] = await Promise.all([
    prisma.sbTeam.count({ where: { competitionId: comp.id } }),
    prisma.sbMatch.count({ where: { competitionId: comp.id } }),
  ]);
  console.log(
    `Seeded ${COMP_NAME}: ${teamCount} teams (expected ${TEAMS.length}), ` +
      `${matchCount} matches (expected ${MATCHES.length}); ` +
      `${seeded} written, ${preserved} left alone because they have started`
  );
  return { comp, teamCount, matchCount };
}
