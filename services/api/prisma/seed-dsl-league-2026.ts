/**
 * Dynasty Scouting League (DSL) 2026 — a single round-robin in Ogun State.
 *
 * Thirteen teams, so each matchday rests one side; every club plays all twelve
 * of the others exactly once across thirteen Thursdays. Every fixture is played
 * at the same venue.
 *
 * TEAMS and MATCHES are generated from the published fixture list so that 78
 * fixtures are not transcribed by hand. Re-generate rather than editing them.
 */
// Prisma is a value import: DbNull/JsonNull are runtime sentinels.
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { normalizeClubName } from "@dtp/engines";
import { shouldPreserveSbMatch } from "../src/seed/seed-options";
import { allocateMatchSlug, loadExistingMatchSlugs } from "../src/scoreboard/match-slug";

const COMP_SLUG = "dsl-league-2026";
const COMP_ID = "dd158044-8193-4804-80f6-74ac90cad8c2";
const COMP_NAME = "Dynasty Scouting League";
const TIMEZONE = "Africa/Lagos";
const VENUE = "Otunba Dipo Dina International Stadium, Ijebu-Ode, Ogun State";
const COMP_LOGO =
  "https://lh3.googleusercontent.com/pw/AP1GczNALIxvuKkBd3lLWgh_YJcRFepriPLRehd9xdhJb626DAF8SFqQkP2xoXXatOHpUdsbW70oP-zMTG0HFr3TJEzNatBBMYcLLYxQNa54Jkj1u4LGFf0SLIWmrZBtILvJZTWKQ0acLkMfJ3rPhivOJwwe=w945-h945-s-no-gm?authuser=0";
const DESCRIPTION =
  "The Dynasty Scouting League is a single round-robin between thirteen Ogun State clubs. Every side meets each of the others once across thirteen matchdays, all played at the Otunba Dipo Dina International Stadium in Ijebu-Ode.";

type TeamSeed = { id: string; slug: string; name: string; logoUrl: string | null };

const TEAMS: TeamSeed[] = [
  {
    "id": "8212d027-4ddc-4ffb-83ac-e6a711561071",
    "slug": "d2r-fa",
    "name": "D2R FA",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczMEXDpq21Rgr6iZaUEkunyvrNcJFeoXLqCdD71gzyF5f0KA2NPZwv6Hh2WLavC7wfu83YE4bnQC46W8WRItth-6hSnrnajiAPcDSMvtuvU25Y6xF_y8sQBv2fBrtcoQY5TZTug_eKvPPEQSAQgjNx6e=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "f20365f8-28cb-4a8c-890e-a15637b0befb",
    "slug": "fima-fc",
    "name": "FIMA FC",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczOd3IVs3jz4wN8pMOibchbucwaEQvnOGPrOMAfPEI8iFZlRyDrVi2IZ05JumkQtEGkkkuih6gdlG9xk5S2bFhx1r1j7h4mMig0RqLLLCwbVVZkVNVNn48EnW5A8yICNJu2OFLOJdWj4Pg27h2HztwEE=w476-h626-s-no-gm?authuser=0"
  },
  {
    "id": "402a8a86-eba1-4705-8d97-ca27360e7288",
    "slug": "immaculate-fc",
    "name": "IMMACULATE FC",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPj14-zrNb6sH_nbCt70mKuEB1PJuxAWp3XU0jcnZJqWNxHQiC4GVI9OxVWv9Ei7dHqxN49w_Oc-BpsZv5ElxU30GZUzsSqKQ98WBaCmrYWKrTLltWa6ah2YIus1XpQeYgrtEOknTZSG3mOg6U4gp0Y=w371-h368-s-no-gm?authuser=0"
  },
  {
    "id": "d6c9d38d-8c42-4273-8c4f-7f7f2e883338",
    "slug": "just-john-fc",
    "name": "JUST JOHN FC",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczMw3ZkgKmaojEDO1AOFoy0RngE0Mm3Bsg34q6wVk_9s-KwE1OXmkgUTDBbz_2lid0mTVj3LQmV__azh2G4x9y6XmzH6Co9zyXk9ggYsoZ5F62hoebhurEgzomAR2N8A_REqe5xHTPxh7j2UemVSMyPG=w323-h407-s-no-gm?authuser=0"
  },
  {
    "id": "6c9dc4d9-aba3-4e4d-8c94-45235c9c0827",
    "slug": "kakawa-fc",
    "name": "KAKAWA FC",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNkmWHT2HohRSRrPaox-iWe_sE1cICdhy0xfSGhEV-HVWNL64Xz33Av4RjyCyXiqHGsxeZz2zP-pGjQ7j8O9qtoC35Z39_7qtsv7-PHw8FdMVsPSGSdP1WczELCZc_iD1h8PM8IUDnYdXoaPvUNRU6Y=w460-h477-s-no-gm?authuser=0"
  },
  {
    "id": "2e8d8034-f077-45d6-884f-be93afa81236",
    "slug": "leal-fc",
    "name": "LEAL FC",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczP6xV8Tn4aOISfDWSg-duoaJQDmJB0DeN8bqXl2aSmbUT-UYgPNd4KuRuQfV8cxLN-Wz3gxqFRT7RbOOK26Uh9ZVJK7qTMXwIoannaHNxZZmTMauBOzXVlUDZufgT9jjqDAFjclXBZcdOI5ZkjjhSkJ=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "375b8f2c-e0ab-44c2-863f-2883184ae6c3",
    "slug": "obazz-fc",
    "name": "OBAZZ FC",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczM0w01VkzprcEhXBt6ESIESxzu4Q1jtlB04cKyhGlnUUSJy7QV8JMFyoUzXNeLEnJLVdjQudY69eJ5DAQKc50XZT16nhMigFdDbqBSeJXYrPmFk_loLHJyhd1GAtjEpLH5UjAx6pmFMHH1IEfG8U65o=w569-h578-s-no-gm?authuser=0"
  },
  {
    "id": "e0fc03ab-36d7-47ca-87df-b7083bffbd54",
    "slug": "oduduwa-fc",
    "name": "ODUDUWA FC",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczM0_I_S_ATSkNZuN0F60U7pohcYVIKwILTIiNkQMxnOWZqqzeCwRXUsVRFj6fyxPSRHtxCyyhwR9R20upRHzPJXKWj6zuy0QBxNLItW91QHA8VPiAycu4IMpXpc0-ACuhs66E1ElPmDzLvi0F3MzsEG=w225-h225-s-no-gm?authuser=0"
  },
  {
    "id": "342e4ef5-5a35-4563-886b-9b5641605cee",
    "slug": "rock-boys-fa",
    "name": "ROCK BOYS FA",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczMwgI9EMY8GTt1mL0OJgiAxXoGTTmQHBxA0_voRuNTvniwYa1arcLNhU_7WQm35FEGpPeXrODUwzQaioxul50P0wdgxpRN33voK5ZdO7U0AaWd0-LGlKEwiqoMYDmavu_tW2uob0CJ6v-jSRnpkhsjz=w542-h460-s-no-gm?authuser=0"
  },
  {
    "id": "fb6faf02-18c4-4a2d-8e86-86b6b0ee4364",
    "slug": "sgh-sa",
    "name": "SGH SA",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNQBHMFZTZOY48XKoPHmuX4bA_d6kTOHgbKWLFUDcn-BI05oMq2MTQwVCEwD4_TUIwtptiUHK2tCwOBdiG-5M-Hgi9hXwhBA9L9HGXEXn7mMLIPoqaELtN2hFNMvef6DEvWaHywn_IAjAIk0oj61PO9=w485-h626-s-no-gm?authuser=0"
  },
  {
    "id": "011fbbe0-be7f-48b5-8b10-204212faf9d8",
    "slug": "stanique-fc",
    "name": "STANIQUE FC",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczOFnx5VMdF8WRlFBefXz7Xab61_SA0cLs57jkdQBoBO2m-6mzKDrgoDb-_SA7vtjA_-f5pfd_Rdhx6-P6CHDZt0G2ouXNTs8-bM29jhgroO1IeSmOTD_kgSrv5sgY5AiT-oyyho_spn0VI28LX9Ryzx=w561-h626-s-no-gm?authuser=0"
  },
  {
    "id": "3c156093-e11a-4ed8-8c80-d487a62311e9",
    "slug": "super-accurate-fa",
    "name": "SUPER ACCURATE FA",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNTMKvlc5ZxrtHkce6EBt3GacyNO-DOEYvzJD4fol4ilO5UfiHHhseb1iKAY1WzqLyVqha4H4NFEMKfXJBU8bLjxCFK9jpgY2TbntUo5RXMbNGmYIOTKf-Z4EUXMvPTNDqViqUJju-NELhntMgFE7Eo=w614-h520-s-no-gm?authuser=0"
  },
  {
    "id": "d13f7813-89dd-4b15-8178-223b8b4afd98",
    "slug": "utility-sports-fc",
    "name": "UTILITY SPORTS FC",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczOFlnVnfXG2_fA1C6pw0QH8Hxo89-DAQGC6zueiGcZxrJQdsr7ldKAKwqD8IbbU6N2uRfGNKvGIQcx7qZEwvlLAhDH77WNDAw4zjJzgLsuWVEpcVJT0Kx7QZSYgYwMvyNdIkbpLKtjXERf-VZYgihLn=w404-h404-s-no-gm?authuser=0"
  }
];

type MatchSeed = {
  id: string;
  matchday: number;
  homeSlug: string;
  awaySlug: string;
  kickoffAt: string;
};

const MATCHES: MatchSeed[] = [
  {
    "id": "1398a7a9-ac30-4cc5-8be6-e8226c45b00a",
    "matchday": 1,
    "homeSlug": "obazz-fc",
    "awaySlug": "sgh-sa",
    "kickoffAt": "2026-09-03T08:00:00.000+01:00"
  },
  {
    "id": "07ea1a74-8be0-4da4-8e24-c49ea397cf73",
    "matchday": 1,
    "homeSlug": "rock-boys-fa",
    "awaySlug": "leal-fc",
    "kickoffAt": "2026-09-03T09:30:00.000+01:00"
  },
  {
    "id": "0f7b59a4-1a33-496c-8760-38c3da3399d0",
    "matchday": 1,
    "homeSlug": "stanique-fc",
    "awaySlug": "kakawa-fc",
    "kickoffAt": "2026-09-03T11:15:00.000+01:00"
  },
  {
    "id": "5013dd1a-2a88-4cb2-86bf-4b0fa43d1653",
    "matchday": 1,
    "homeSlug": "just-john-fc",
    "awaySlug": "super-accurate-fa",
    "kickoffAt": "2026-09-03T13:00:00.000+01:00"
  },
  {
    "id": "98b4e4ee-bc16-487c-84c5-05d273ab4c66",
    "matchday": 1,
    "homeSlug": "immaculate-fc",
    "awaySlug": "d2r-fa",
    "kickoffAt": "2026-09-03T14:45:00.000+01:00"
  },
  {
    "id": "3f4baebb-1e94-4965-883e-60d0598e879c",
    "matchday": 1,
    "homeSlug": "fima-fc",
    "awaySlug": "utility-sports-fc",
    "kickoffAt": "2026-09-03T16:30:00.000+01:00"
  },
  {
    "id": "b1450a97-530b-4533-81b3-79c6c4d75e73",
    "matchday": 2,
    "homeSlug": "kakawa-fc",
    "awaySlug": "immaculate-fc",
    "kickoffAt": "2026-09-10T08:00:00.000+01:00"
  },
  {
    "id": "915965af-9c43-457c-8c26-5f687f860fb9",
    "matchday": 2,
    "homeSlug": "utility-sports-fc",
    "awaySlug": "just-john-fc",
    "kickoffAt": "2026-09-10T09:30:00.000+01:00"
  },
  {
    "id": "2d22dcd3-6b1a-4dea-8c95-45d1183fc00c",
    "matchday": 2,
    "homeSlug": "d2r-fa",
    "awaySlug": "fima-fc",
    "kickoffAt": "2026-09-10T11:15:00.000+01:00"
  },
  {
    "id": "c5120941-e1e9-4d4a-8f52-a90660734b60",
    "matchday": 2,
    "homeSlug": "super-accurate-fa",
    "awaySlug": "rock-boys-fa",
    "kickoffAt": "2026-09-10T13:00:00.000+01:00"
  },
  {
    "id": "2d61c9b5-dd95-4454-8a83-ad6058746d89",
    "matchday": 2,
    "homeSlug": "sgh-sa",
    "awaySlug": "stanique-fc",
    "kickoffAt": "2026-09-10T14:45:00.000+01:00"
  },
  {
    "id": "943b0554-6bc4-4805-802d-989f761a43b5",
    "matchday": 2,
    "homeSlug": "leal-fc",
    "awaySlug": "oduduwa-fc",
    "kickoffAt": "2026-09-10T16:30:00.000+01:00"
  },
  {
    "id": "62b3dcfc-e1be-438e-879c-39a3cab1f96c",
    "matchday": 3,
    "homeSlug": "fima-fc",
    "awaySlug": "kakawa-fc",
    "kickoffAt": "2026-09-17T08:00:00.000+01:00"
  },
  {
    "id": "6db46708-60f5-40e9-801d-8bf36967d68f",
    "matchday": 3,
    "homeSlug": "oduduwa-fc",
    "awaySlug": "super-accurate-fa",
    "kickoffAt": "2026-09-17T09:30:00.000+01:00"
  },
  {
    "id": "3945fdeb-f8f9-4152-8dbe-a175fdb5c8f0",
    "matchday": 3,
    "homeSlug": "just-john-fc",
    "awaySlug": "d2r-fa",
    "kickoffAt": "2026-09-17T11:15:00.000+01:00"
  },
  {
    "id": "62d8347e-96d3-4a5a-8c25-ccc427f75943",
    "matchday": 3,
    "homeSlug": "rock-boys-fa",
    "awaySlug": "utility-sports-fc",
    "kickoffAt": "2026-09-17T13:00:00.000+01:00"
  },
  {
    "id": "dbd17648-aff5-4d03-829e-067ae4359bee",
    "matchday": 3,
    "homeSlug": "immaculate-fc",
    "awaySlug": "sgh-sa",
    "kickoffAt": "2026-09-17T14:45:00.000+01:00"
  },
  {
    "id": "1de942bf-ef50-43b9-8e0f-6b2491ce02d7",
    "matchday": 3,
    "homeSlug": "stanique-fc",
    "awaySlug": "obazz-fc",
    "kickoffAt": "2026-09-17T16:30:00.000+01:00"
  },
  {
    "id": "86241e37-21d4-4a2f-846d-98d19fae467e",
    "matchday": 4,
    "homeSlug": "sgh-sa",
    "awaySlug": "fima-fc",
    "kickoffAt": "2026-09-24T08:00:00.000+01:00"
  },
  {
    "id": "2fd045b2-539e-4ca2-8ce4-40d29e2201c7",
    "matchday": 4,
    "homeSlug": "super-accurate-fa",
    "awaySlug": "leal-fc",
    "kickoffAt": "2026-09-24T09:30:00.000+01:00"
  },
  {
    "id": "ee3b7097-f949-4f10-82f3-b9348cf9f4e5",
    "matchday": 4,
    "homeSlug": "d2r-fa",
    "awaySlug": "rock-boys-fa",
    "kickoffAt": "2026-09-24T11:15:00.000+01:00"
  },
  {
    "id": "1cf4a60c-61f0-4eea-83cc-81826cec938b",
    "matchday": 4,
    "homeSlug": "kakawa-fc",
    "awaySlug": "just-john-fc",
    "kickoffAt": "2026-09-24T13:00:00.000+01:00"
  },
  {
    "id": "93d22142-0deb-4487-884b-3bdb3147007f",
    "matchday": 4,
    "homeSlug": "obazz-fc",
    "awaySlug": "immaculate-fc",
    "kickoffAt": "2026-09-24T14:45:00.000+01:00"
  },
  {
    "id": "6c26c943-36f0-42ba-8098-fb0e9385219f",
    "matchday": 4,
    "homeSlug": "utility-sports-fc",
    "awaySlug": "oduduwa-fc",
    "kickoffAt": "2026-09-24T16:30:00.000+01:00"
  },
  {
    "id": "96d06dfa-2e4c-49fe-8802-2d9387768c87",
    "matchday": 5,
    "homeSlug": "immaculate-fc",
    "awaySlug": "stanique-fc",
    "kickoffAt": "2026-10-01T08:00:00.000+01:00"
  },
  {
    "id": "d7327bf8-4fce-4ff2-8bc4-11ba1a214dbb",
    "matchday": 5,
    "homeSlug": "rock-boys-fa",
    "awaySlug": "kakawa-fc",
    "kickoffAt": "2026-10-01T09:30:00.000+01:00"
  },
  {
    "id": "10d58f8a-29b0-418e-8dc1-9ff301439337",
    "matchday": 5,
    "homeSlug": "just-john-fc",
    "awaySlug": "sgh-sa",
    "kickoffAt": "2026-10-01T11:15:00.000+01:00"
  },
  {
    "id": "7b9d1853-2701-40a8-80a1-ed53057cfd93",
    "matchday": 5,
    "homeSlug": "oduduwa-fc",
    "awaySlug": "d2r-fa",
    "kickoffAt": "2026-10-01T13:00:00.000+01:00"
  },
  {
    "id": "c75029ad-2325-408f-83ab-13f097d7f164",
    "matchday": 5,
    "homeSlug": "leal-fc",
    "awaySlug": "utility-sports-fc",
    "kickoffAt": "2026-10-01T14:45:00.000+01:00"
  },
  {
    "id": "c3d0a1ad-7d1c-4c2b-8f8b-373bf573011e",
    "matchday": 5,
    "homeSlug": "fima-fc",
    "awaySlug": "obazz-fc",
    "kickoffAt": "2026-10-01T16:30:00.000+01:00"
  },
  {
    "id": "c69c9a2a-eb1c-4b0e-83e6-9e2af9a68ac2",
    "matchday": 6,
    "homeSlug": "super-accurate-fa",
    "awaySlug": "utility-sports-fc",
    "kickoffAt": "2026-10-08T08:00:00.000+01:00"
  },
  {
    "id": "812d6936-63bb-456b-8b57-8b36c616f28a",
    "matchday": 6,
    "homeSlug": "stanique-fc",
    "awaySlug": "fima-fc",
    "kickoffAt": "2026-10-08T09:30:00.000+01:00"
  },
  {
    "id": "9cdaa664-7740-4f4b-8979-0f95d710a325",
    "matchday": 6,
    "homeSlug": "obazz-fc",
    "awaySlug": "just-john-fc",
    "kickoffAt": "2026-10-08T11:15:00.000+01:00"
  },
  {
    "id": "ea138289-e5df-4515-8a75-f4bcb31ad8a5",
    "matchday": 6,
    "homeSlug": "d2r-fa",
    "awaySlug": "leal-fc",
    "kickoffAt": "2026-10-08T13:00:00.000+01:00"
  },
  {
    "id": "bbc49acb-2350-41fb-86b4-d3825147417a",
    "matchday": 6,
    "homeSlug": "rock-boys-fa",
    "awaySlug": "sgh-sa",
    "kickoffAt": "2026-10-08T14:45:00.000+01:00"
  },
  {
    "id": "9506c57a-d8d2-49ee-8365-27cfd6345a58",
    "matchday": 6,
    "homeSlug": "kakawa-fc",
    "awaySlug": "oduduwa-fc",
    "kickoffAt": "2026-10-08T16:30:00.000+01:00"
  },
  {
    "id": "b050ab2b-4c8c-463e-8462-f4d2f537c4d6",
    "matchday": 7,
    "homeSlug": "leal-fc",
    "awaySlug": "kakawa-fc",
    "kickoffAt": "2026-10-15T08:00:00.000+01:00"
  },
  {
    "id": "2daf9fc3-e6ff-41c8-8386-604821c501ea",
    "matchday": 7,
    "homeSlug": "oduduwa-fc",
    "awaySlug": "sgh-sa",
    "kickoffAt": "2026-10-15T09:30:00.000+01:00"
  },
  {
    "id": "b5544fa6-e416-4e32-89a8-3ec877549d60",
    "matchday": 7,
    "homeSlug": "rock-boys-fa",
    "awaySlug": "obazz-fc",
    "kickoffAt": "2026-10-15T11:15:00.000+01:00"
  },
  {
    "id": "c4a06c7f-2b57-4ab6-804e-f55fdb5365ad",
    "matchday": 7,
    "homeSlug": "just-john-fc",
    "awaySlug": "stanique-fc",
    "kickoffAt": "2026-10-15T13:00:00.000+01:00"
  },
  {
    "id": "ff9c9f4b-781c-4118-8f1b-56024c1776be",
    "matchday": 7,
    "homeSlug": "super-accurate-fa",
    "awaySlug": "d2r-fa",
    "kickoffAt": "2026-10-15T14:45:00.000+01:00"
  },
  {
    "id": "d9518400-2f90-4e38-8a3c-e41833a1d179",
    "matchday": 7,
    "homeSlug": "fima-fc",
    "awaySlug": "immaculate-fc",
    "kickoffAt": "2026-10-15T16:30:00.000+01:00"
  },
  {
    "id": "bafcf688-b61f-4cea-88f7-6c28a1595346",
    "matchday": 8,
    "homeSlug": "obazz-fc",
    "awaySlug": "oduduwa-fc",
    "kickoffAt": "2026-10-22T08:00:00.000+01:00"
  },
  {
    "id": "1b9c5661-4d8d-44e4-82a4-0e10d21b5ceb",
    "matchday": 8,
    "homeSlug": "immaculate-fc",
    "awaySlug": "just-john-fc",
    "kickoffAt": "2026-10-22T09:30:00.000+01:00"
  },
  {
    "id": "e16a9f62-c545-4ded-876b-cbe873a1029c",
    "matchday": 8,
    "homeSlug": "d2r-fa",
    "awaySlug": "utility-sports-fc",
    "kickoffAt": "2026-10-22T11:15:00.000+01:00"
  },
  {
    "id": "e3bd7dfa-04b0-49c3-87a1-3ef35c55417b",
    "matchday": 8,
    "homeSlug": "stanique-fc",
    "awaySlug": "rock-boys-fa",
    "kickoffAt": "2026-10-22T13:00:00.000+01:00"
  },
  {
    "id": "6736a92a-ec32-4037-80a9-9246abb3cb58",
    "matchday": 8,
    "homeSlug": "sgh-sa",
    "awaySlug": "leal-fc",
    "kickoffAt": "2026-10-22T14:45:00.000+01:00"
  },
  {
    "id": "b247fc71-7fd3-4e18-8e5e-f130ebe91109",
    "matchday": 8,
    "homeSlug": "kakawa-fc",
    "awaySlug": "super-accurate-fa",
    "kickoffAt": "2026-10-22T16:30:00.000+01:00"
  },
  {
    "id": "ae8c41a3-3880-42d0-86d4-4f9043ad9929",
    "matchday": 9,
    "homeSlug": "oduduwa-fc",
    "awaySlug": "stanique-fc",
    "kickoffAt": "2026-10-29T08:00:00.000+01:00"
  },
  {
    "id": "bd8d6f98-b26e-4c3a-8739-abe7f75b2cbd",
    "matchday": 9,
    "homeSlug": "super-accurate-fa",
    "awaySlug": "sgh-sa",
    "kickoffAt": "2026-10-29T09:30:00.000+01:00"
  },
  {
    "id": "47b7e38f-978d-4837-855a-762be481e50b",
    "matchday": 9,
    "homeSlug": "rock-boys-fa",
    "awaySlug": "immaculate-fc",
    "kickoffAt": "2026-10-29T11:15:00.000+01:00"
  },
  {
    "id": "a477081d-0576-40f2-873d-00507d73629a",
    "matchday": 9,
    "homeSlug": "just-john-fc",
    "awaySlug": "fima-fc",
    "kickoffAt": "2026-10-29T13:00:00.000+01:00"
  },
  {
    "id": "6fa085ad-c571-4fa5-85dd-9b6649885512",
    "matchday": 9,
    "homeSlug": "utility-sports-fc",
    "awaySlug": "kakawa-fc",
    "kickoffAt": "2026-10-29T14:45:00.000+01:00"
  },
  {
    "id": "b8a4e7ab-070e-46f5-8be7-501aae494b76",
    "matchday": 9,
    "homeSlug": "leal-fc",
    "awaySlug": "obazz-fc",
    "kickoffAt": "2026-10-29T16:30:00.000+01:00"
  },
  {
    "id": "bfdc424b-53e4-40c6-82a4-e4d0010ba541",
    "matchday": 10,
    "homeSlug": "obazz-fc",
    "awaySlug": "super-accurate-fa",
    "kickoffAt": "2026-11-05T08:00:00.000+01:00"
  },
  {
    "id": "22dfb7ef-5344-4582-804c-45fe531da6fe",
    "matchday": 10,
    "homeSlug": "fima-fc",
    "awaySlug": "rock-boys-fa",
    "kickoffAt": "2026-11-05T09:30:00.000+01:00"
  },
  {
    "id": "fd0f5610-068f-41bc-8f31-25ad6f524a25",
    "matchday": 10,
    "homeSlug": "kakawa-fc",
    "awaySlug": "d2r-fa",
    "kickoffAt": "2026-11-05T11:15:00.000+01:00"
  },
  {
    "id": "011c1797-d7b2-42ea-8f79-b35c55e19aef",
    "matchday": 10,
    "homeSlug": "sgh-sa",
    "awaySlug": "utility-sports-fc",
    "kickoffAt": "2026-11-05T13:00:00.000+01:00"
  },
  {
    "id": "4a9a5101-6239-4d21-84ab-100be26101fa",
    "matchday": 10,
    "homeSlug": "stanique-fc",
    "awaySlug": "leal-fc",
    "kickoffAt": "2026-11-05T14:45:00.000+01:00"
  },
  {
    "id": "d14b5c9d-01f4-4201-84f4-ed34219fd0c6",
    "matchday": 10,
    "homeSlug": "immaculate-fc",
    "awaySlug": "oduduwa-fc",
    "kickoffAt": "2026-11-05T16:30:00.000+01:00"
  },
  {
    "id": "e3ff3546-c163-4689-8ca8-4e3f3a269de7",
    "matchday": 11,
    "homeSlug": "oduduwa-fc",
    "awaySlug": "fima-fc",
    "kickoffAt": "2026-11-12T08:00:00.000+01:00"
  },
  {
    "id": "6f5e9edf-4047-4fdf-865a-b8e949f919f0",
    "matchday": 11,
    "homeSlug": "super-accurate-fa",
    "awaySlug": "stanique-fc",
    "kickoffAt": "2026-11-12T09:30:00.000+01:00"
  },
  {
    "id": "19eb3a00-da90-4ebb-8ef0-6cd2fa524ca9",
    "matchday": 11,
    "homeSlug": "rock-boys-fa",
    "awaySlug": "just-john-fc",
    "kickoffAt": "2026-11-12T11:15:00.000+01:00"
  },
  {
    "id": "718dc15f-88f7-47a8-8492-c5f64013a0ab",
    "matchday": 11,
    "homeSlug": "d2r-fa",
    "awaySlug": "sgh-sa",
    "kickoffAt": "2026-11-12T13:00:00.000+01:00"
  },
  {
    "id": "d9df1161-e780-4421-8c5a-63936bff0e9c",
    "matchday": 11,
    "homeSlug": "utility-sports-fc",
    "awaySlug": "obazz-fc",
    "kickoffAt": "2026-11-12T14:45:00.000+01:00"
  },
  {
    "id": "72ee22cf-261b-4187-8c6b-96410cef6bf2",
    "matchday": 11,
    "homeSlug": "leal-fc",
    "awaySlug": "immaculate-fc",
    "kickoffAt": "2026-11-12T16:30:00.000+01:00"
  },
  {
    "id": "f09a7e4e-b996-4da7-84a9-48b204607f55",
    "matchday": 12,
    "homeSlug": "fima-fc",
    "awaySlug": "leal-fc",
    "kickoffAt": "2026-11-19T08:00:00.000+01:00"
  },
  {
    "id": "ef9622e6-9133-4bb1-813f-cef47b2669a9",
    "matchday": 12,
    "homeSlug": "just-john-fc",
    "awaySlug": "oduduwa-fc",
    "kickoffAt": "2026-11-19T09:30:00.000+01:00"
  },
  {
    "id": "846395e6-8f44-4128-89c3-9b04d112e877",
    "matchday": 12,
    "homeSlug": "obazz-fc",
    "awaySlug": "d2r-fa",
    "kickoffAt": "2026-11-19T11:15:00.000+01:00"
  },
  {
    "id": "1deeebf0-4d1f-4457-8528-35d2a242840f",
    "matchday": 12,
    "homeSlug": "sgh-sa",
    "awaySlug": "kakawa-fc",
    "kickoffAt": "2026-11-19T13:00:00.000+01:00"
  },
  {
    "id": "bb0bb32f-993c-4aa6-8920-c3a27203d0df",
    "matchday": 12,
    "homeSlug": "immaculate-fc",
    "awaySlug": "super-accurate-fa",
    "kickoffAt": "2026-11-19T14:45:00.000+01:00"
  },
  {
    "id": "c5c09c1f-7a03-4525-8930-530f4d6d9491",
    "matchday": 12,
    "homeSlug": "stanique-fc",
    "awaySlug": "utility-sports-fc",
    "kickoffAt": "2026-11-19T16:30:00.000+01:00"
  },
  {
    "id": "5d0821af-a385-4e24-8211-b28862f1c30f",
    "matchday": 13,
    "homeSlug": "utility-sports-fc",
    "awaySlug": "immaculate-fc",
    "kickoffAt": "2026-11-26T08:00:00.000+01:00"
  },
  {
    "id": "249cdd67-7c93-47b8-8021-23a9b159ac75",
    "matchday": 13,
    "homeSlug": "d2r-fa",
    "awaySlug": "stanique-fc",
    "kickoffAt": "2026-11-26T09:30:00.000+01:00"
  },
  {
    "id": "9b9f1625-8f3e-4867-8700-e7be80ef1ff3",
    "matchday": 13,
    "homeSlug": "oduduwa-fc",
    "awaySlug": "rock-boys-fa",
    "kickoffAt": "2026-11-26T11:15:00.000+01:00"
  },
  {
    "id": "acf19418-3c8d-4c7e-8e30-bf59ca61634c",
    "matchday": 13,
    "homeSlug": "leal-fc",
    "awaySlug": "just-john-fc",
    "kickoffAt": "2026-11-26T13:00:00.000+01:00"
  },
  {
    "id": "882be2be-07e6-42f6-8054-2a474775ee1a",
    "matchday": 13,
    "homeSlug": "super-accurate-fa",
    "awaySlug": "fima-fc",
    "kickoffAt": "2026-11-26T14:45:00.000+01:00"
  },
  {
    "id": "1da5ead5-67b5-4f1f-8a3f-4b2e860d4686",
    "matchday": 13,
    "homeSlug": "kakawa-fc",
    "awaySlug": "obazz-fc",
    "kickoffAt": "2026-11-26T16:30:00.000+01:00"
  }
];

export async function seedDslLeague2026(prisma: PrismaClient) {
  const formatConfig = {
    format: "single_round_robin",
    overview: DESCRIPTION,
    timezone: TIMEZONE,
    venue: VENUE,
    teams: 13,
    matchdays: 13,
    matches: 78,
    points: { win: 3, draw: 1, loss: 0 },
    tiebreakers: ["points", "goal_difference", "goals_for", "head_to_head"],
    /* Thirteen teams means one club rests each matchday. */
    byePerMatchday: true,
  };

  const fields = {
    name: COMP_NAME,
    season: "2026",
    type: "league",
    formatType: "LEAGUE_SINGLE_ROUND_ROBIN",
    formatConfig: formatConfig as Prisma.InputJsonValue,
    country: "Nigeria",
    logoUrl: COMP_LOGO,
    description: DESCRIPTION,
    status: "upcoming",
    isPublished: true,
  };

  const comp = await prisma.sbCompetition.upsert({
    where: { slug: COMP_SLUG },
    update: fields,
    create: { id: COMP_ID, slug: COMP_SLUG, ...fields },
  });

  const teamIds: Record<string, string> = {};
  for (const team of TEAMS) {
    const teamFields = {
      name: normalizeClubName(team.name),
      shortName: team.name,
      city: "Ijebu-Ode",
      logoUrl: team.logoUrl,
      /* One league table, so no group key: the standings render as a single
         table rather than a set of groups. */
      groupKey: null,
    };
    const row = await prisma.sbTeam.upsert({
      where: { competitionId_slug: { competitionId: comp.id, slug: team.slug } },
      update: teamFields,
      create: { id: team.id, competitionId: comp.id, slug: team.slug, ...teamFields },
    });
    teamIds[team.slug] = row.id;
  }

  const usedMatchSlugs = await loadExistingMatchSlugs(prisma);
  for (const match of MATCHES) {
    if (await shouldPreserveSbMatch(prisma, match.id)) continue;
    const shared = {
      slug: allocateMatchSlug(match.homeSlug, match.awaySlug, usedMatchSlugs),
      matchday: match.matchday,
      homeTeamId: teamIds[match.homeSlug],
      awayTeamId: teamIds[match.awaySlug],
      status: "scheduled",
      homeScore: 0,
      awayScore: 0,
      minute: null,
      kickoffAt: new Date(match.kickoffAt),
      venue: VENUE,
      roundLabel: `Matchday ${match.matchday}`,
      // `stats` is a nullable Json column; Prisma rejects a bare `null` here and
      // requires DbNull to write a SQL NULL.
      stats: Prisma.DbNull,
      isPublished: true,
      meta: { timezone: TIMEZONE } as Prisma.InputJsonValue,
    };
    await prisma.sbMatch.upsert({
      where: { id: match.id },
      update: shared,
      create: { id: match.id, competitionId: comp.id, ...shared },
    });
  }

  const [teamCount, matchCount] = await Promise.all([
    prisma.sbTeam.count({ where: { competitionId: comp.id } }),
    prisma.sbMatch.count({ where: { competitionId: comp.id } }),
  ]);
  console.log(
    `Seeded ${COMP_NAME}: ${teamCount} teams (expected 13), ${matchCount} matches (expected 78)`
  );
  return { comp, teamCount, matchCount };
}
