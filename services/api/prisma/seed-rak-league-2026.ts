// @ts-nocheck
/**
 * RAK BDFA League (2025/2026) — six Lagos zonal groups feeding a Round of 16.
 *
 * Every group is a complete single round-robin. The top two from each group
 * plus the four best third-placed teams make up the 16-team knockout bracket.
 *
 * TEAMS and MATCHES are generated from the zonal fixture sheets under
 * "DTP/RAK League/Fixtures", so 102 fixtures are not transcribed by hand.
 * Re-generate rather than hand-editing those two tables.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeClubName } from "@dtp/engines";
import { shouldPreserveSbMatch } from "../src/seed/seed-options";
import { createSeedMatchSlugAllocator } from "../src/scoreboard/match-slug";

const COMP_SLUG = "rak-league-2025-2026";
const COMP_ID = "c8b8c71d-8274-47c1-8e61-625f96a7a429";
/* Slug stays "rak-league-2025-2026": it is the upsert key and the public URL
   segment, so renaming it would create a second competition, not rename this
   one. Only the display title changed. */
const COMP_NAME = "RAK BDFA League";
const TIMEZONE = "Africa/Lagos";
const COMP_LOGO =
  "https://lh3.googleusercontent.com/pw/AP1GczPQSLAFsN_hHSYTgnSSqdbjuBt2iu0Y5vDk60oFdvwdwasA68f6o9LQ4izuybtlu1V1KEpRSnEoBDC4OzvB1sm_yBiEDG9PMx761EAItflovm1nlmBDygo4RpoXORR363oTiRZy9QHhcG86KdOQrEcc=w945-h945-s-no-gm?authuser=0";
const DESCRIPTION =
  "RAK BDFA League runs six Lagos zonal groups as complete single round-robins. The top two from every group plus the four best third-placed teams advance to the Round of 16.";

const ZONES = [
  {
    "key": "BADAGRY",
    "name": "Badagry / Badagry West / Olorunda Zone",
    "teams": 7,
    "sortOrder": 1
  },
  {
    "key": "OTO AWORI A",
    "name": "Oto Awori Zone — Group A",
    "teams": 7,
    "sortOrder": 2
  },
  {
    "key": "OTO AWORI B",
    "name": "Oto Awori Zone — Group B",
    "teams": 6,
    "sortOrder": 3
  },
  {
    "key": "OJO A",
    "name": "Ojo Zone — Group A",
    "teams": 6,
    "sortOrder": 4
  },
  {
    "key": "OJO B",
    "name": "Ojo Zone — Group B",
    "teams": 6,
    "sortOrder": 5
  },
  {
    "key": "IBA",
    "name": "Iba / Amuwo Odofin / Oriade / AJIF / Ifelodun Zone",
    "teams": 6,
    "sortOrder": 6
  }
] as const;

type TeamSeed = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  groupKey: string;
  logoUrl: string | null;
};

const TEAMS: TeamSeed[] = [
  {
    "id": "f7dc0a03-f4c4-41d2-8208-0a1b248699e8",
    "slug": "masters-fc",
    "name": "MASTERS FC",
    "shortName": "MASTERS FC",
    "groupKey": "BADAGRY",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczM_Wi014bYw8UGp-BJGgwW9yZoze6KeXgwDA0w6QDUTFChe0C4fogskkTWHEGPZTXHLgOQAgOEnYCMOj4QV93rgWRIRDW6NQ35Zj1AAi6Xahi0WV8sxKWgWudT-y6R7XACtY6b9NruUc36HL2CBWE8u=w633-h626-s-no-gm?authuser=0"
  },
  {
    "id": "6ba1c194-921a-46e8-8f2e-e1eaa86d6b34",
    "slug": "roms-fc",
    "name": "ROMS FC",
    "shortName": "ROMS FC",
    "groupKey": "BADAGRY",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPsHS0XOHDXg2PKqu49VbyhVe3KZk9dQ2ElJ7K5MZ0BEMATL9_Fh8j_hNRq7ziCCWSKH7as-gC3o7jzKPdZTVSb5mWXCsiJ0Xlt-Fsb5YCMOQEKdT_92D8vDRJejxDik9Co_S4tFR2DV4V_zh4g_fPr=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "6e30e7c9-b8f4-408a-8ec3-fa624ff62aa5",
    "slug": "young-talent-fc",
    "name": "YOUNG TALENT FC",
    "shortName": "YOUNG TALENT FC",
    "groupKey": "BADAGRY",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPxe0J8Apr5UmrKDav9yCAKbsW1QyCyzQVZzKJKrMbeIooksw9qmkNWLiGYYU_7MFRwnl0g211n6w8bNm2mvQ5ArFQAqKTeUy0V6Z1rURZHPNIULNjGx-IFzjMWELqpDQZ7-WYEhtU1OPLtEUb0dsK4=w460-h542-s-no-gm?authuser=0"
  },
  {
    "id": "c65b9726-e53e-42f3-8dd1-cf6d36851d36",
    "slug": "supreme-heroes-fc",
    "name": "SUPREME HEROES FC",
    "shortName": "SUPREME HEROES FC",
    "groupKey": "BADAGRY",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPk3enY8k9-y3WLevIgOzzgOKw4hN02lyG7Bx7ITvyxi1z6tzZ-jVbU3gvxyeaabVFAEPUzKIqHQ8_p_R_hUyVV4OgLSoVJ3kMeprjjhnD8MOIS0m0mctxvQxUjJ4NeoP6HO3Z4RXz7lUG2syPy-L8L=w307-h326-s-no-gm?authuser=0"
  },
  {
    "id": "9177aac0-fb4d-4da5-8c6c-ee5f498bcac4",
    "slug": "rikay-fc",
    "name": "RIKAY FC",
    "shortName": "RIKAY FC",
    "groupKey": "BADAGRY",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczMa8HKRmyJaD8D8Y1iQbAETkvbmW1mwWAKXAXlxPlIXAGuKh1ADK5CWwBPEPG_TKUxQji7fILMEjrq9t5v6xt9aO9DHD-c5pvDPJKzeIlZ1l1OMvRqBFrx5aF7BKmBfhcS0LZcNgc8KRuG1_weHAIU-=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "1840c115-ff84-4f59-864b-3057ba7ddee5",
    "slug": "36-lions-fc",
    "name": "36 LIONS FC",
    "shortName": "36 LIONS FC",
    "groupKey": "BADAGRY",
    "logoUrl": "https://api.1xcup.ng/storage/team-registrations/logos/e5500cf1b2b63538f0cf1dc503765d57.jpg"
  },
  {
    "id": "3d165606-3eab-4f72-8b36-a5ec46c6e5f9",
    "slug": "mopson-athletic-academy",
    "name": "MOPSON ATHLETIC ACADEMY",
    "shortName": "MOPSON",
    "groupKey": "BADAGRY",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNRk6D1kzVfVpTgE3Z2sB61Lr_rVhMwTd8gSF24jkIDSj5wl72h-wfpfoAaQR_EMW8r8kuGj0nMHhWUzdvJ9oeqU48bgnGoRe3zYigFYqIdI8eOp1SEn5tWosVi_uCNorgfXixjahq9GVHN-J2XFj7O=w614-h626-s-no-gm?authuser=0"
  },
  {
    "id": "2be09152-1965-4375-86b7-37088bd1b37c",
    "slug": "lucky-fc",
    "name": "LUCKY FC",
    "shortName": "LUCKY FC",
    "groupKey": "OTO AWORI A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPYpJI9dvDgh7CCTdnUyMN5doFOxUBkpynlNjRqijWVeovgFz-kcEgljrJMFMkuMm9RC4Ibd4tuOnCv4ng447H36bfXFBRLCgjiTRpJWnipS_ZcHLcYJlhgyxLYvQXpMqpYEfCDsuPb1ROfn-5jNRaX=w509-h509-s-no-gm?authuser=0"
  },
  {
    "id": "ecba94eb-e4aa-4ed0-830b-0f2f4439e942",
    "slug": "inter-javed-fc",
    "name": "INTER JAVED FC",
    "shortName": "INTER JAVED FC",
    "groupKey": "OTO AWORI A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNIgMRi8zwAe8RsuxaFMeAe0YXrhGpqwNQwAR4jOdT722o-mf6Enfxcvg_GPzYh6tpKpOUdZ1-2CRmp4uQeL6_APaiT9fbydlG0SzXRSp3SUpJCsigT2UpS2fr0JwPlvKUTMBTmRnc3aocNl6w9V4Vw=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "5b12ac15-3b6c-462c-86bb-a6b549834e0b",
    "slug": "royal-fc",
    "name": "ROYAL FC",
    "shortName": "ROYAL FC",
    "groupKey": "OTO AWORI A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNSLxYyUXHjPckzKvtzYdWesThyY2pnr57g6a7mwoqLEinjqhvnfgp27UTD5B_gOxZo5eG6cQ-2yiq1WcWZAn_yA_dwLgXQMKvsG7wFxkDapxmEBSkVo5RCkx5A3N9JWNz5D3jdiyg7Wdy48LHEEClq=w553-h553-s-no-gm?authuser=0"
  },
  {
    "id": "17b2a0df-d154-48e9-8efb-169413525bc0",
    "slug": "super-stars-fc",
    "name": "SUPER STARS FC",
    "shortName": "SUPER STARS FC",
    "groupKey": "OTO AWORI A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczOPimE6ebHMLhKjZ_SIJjFW1b_UBdJzeMojYS7EepLL3hVhWQY2cvE6joH7pl0-9ne2fAM76S60K9EV18jNYcjPsKh732s6u1mFMjB-8FBowd6J_u0DSMc4NOUHIo8RVvwLBkIu5LkeyY-obaLb0jR0=w360-h359-s-no-gm?authuser=0"
  },
  {
    "id": "6473e565-d24f-427f-8c70-5f83e619100c",
    "slug": "bilda-fa",
    "name": "BILDA FA",
    "shortName": "BILDA FA",
    "groupKey": "OTO AWORI A",
    "logoUrl": "https://api.1xcup.ng/storage/team-registrations/logos/9f396e9163d8aa1624fbec7611cd6d85.jpg"
  },
  {
    "id": "408698d8-12b2-4c4f-877c-a0a27fe17b04",
    "slug": "dream-chasers-fc",
    "name": "DREAM CHASERS FC",
    "shortName": "DREAM CHASERS FC",
    "groupKey": "OTO AWORI A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczMIZ9SiO4RFaydDfp7mYOl4GvSgVq_BuF7D2aFpr7YtX8pePupvM9Bb5G4GSEpGVWCUcOa6XhXBePdRACq9fV3ynMJgAHz0ArqTJNLeSrFpi8xv1tNpFnclyEA-_qrzmF9eR9k7vTj7ff3j_SBQMcRI=w563-h563-s-no-gm?authuser=0"
  },
  {
    "id": "29d950fa-f31a-4132-868f-54671378dd9e",
    "slug": "jp-young-stars-fc",
    "name": "JP YOUNG STARS FC",
    "shortName": "JP YOUNG STARS FC",
    "groupKey": "OTO AWORI A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczOzt_IYHb4FkKSy71y5B_feLv8M017Z1qBvaiej_VEJvvuknrk-yhlISkFVrRbZDF-ygYD4mlPGn6dkJpY8P-EUqomzfNB2FJVPPUrV4lj4rWcK1azY1pDmDtGEJI16GePplvzyQQoGcPrArSwCFvro=w387-h626-s-no-gm?authuser=0"
  },
  {
    "id": "7a703728-a02a-4f7b-8404-eb358f11c03e",
    "slug": "tico-fa",
    "name": "TICO FA",
    "shortName": "TICO FA",
    "groupKey": "OTO AWORI B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczMdX2xrVhgdAqoDNzMeUprUOd-O3Wn3Omd1-Wmxnx-Aa12468Lgaf4bC0rnPmafRjw8zN0w-j0hmdLGHTSLcrye51H3xs2lQ2b6i7730XEwaHgb_WJ4vLcCMBu5EPyu6dU0EAMSpVqpgH1xUtAJPGSy=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "d6933519-54a4-4171-8040-e40c4c4f5670",
    "slug": "isashi-fc",
    "name": "ISASHI FC",
    "shortName": "ISASHI FC",
    "groupKey": "OTO AWORI B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczMJBf7MKVWo4y_bFNpa6HVejzNZw6tEydFym6dtW5kt9sYxK7LZKZWpU8kLTw5EMAKCeKQEFJqarVe7PklktU4M2dvb1x2cgJOrdYEAUqlfGNgy_qBubVPX7ZDDlu4L6VlaVwrk3rUjkk7ZFdvahJZ2=w522-h626-s-no-gm?authuser=0"
  },
  {
    "id": "cbc68fec-d043-4b6a-87e0-3ad439dca096",
    "slug": "kedge-sports-intl",
    "name": "KEDGE SPORTS INT'L",
    "shortName": "KEDGE",
    "groupKey": "OTO AWORI B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczN8jU7WPAgb-nb4ouVGDvruZqyW0UcSEXMIXxheuHxuXXCAuGg8HuimuiaZg3L7zOBrPFnGXuE0gMOBX_0cUaS7AVO17ktwDpIC52yiXpTK8qcrfXfU8FplvfSvE6EkoMTzoPG0WV0zcFrGa5hcvygz=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "afabb97c-b8c2-4e3e-82bd-f59d11a3eb20",
    "slug": "oscar-rovers-sports-fc",
    "name": "OSCAR ROVERS SPORTS FC",
    "shortName": "OSCAR ROVERS FC",
    "groupKey": "OTO AWORI B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNmBUN7boOTVmEnnPmhbWIDUsGOYw5tmvKX8YbbF0Isr7DddAotqUVJAOCB0DOTDUR0wKissLEFypJQxRQN3hGw69Zya1NLeINgOt_RYu0JNE7-jhgec2Omn4gXdi8uHv-db5fAIRFvWWsDzevexH3-=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "759094b3-24dd-45b0-8918-53327f4a7544",
    "slug": "power-of-the-cross-sa",
    "name": "POWER OF THE CROSS SA",
    "shortName": "POWER OF THE CROSS",
    "groupKey": "OTO AWORI B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczN6B_7DjpsvTys13flSa0OFDUbL9t7eYxTyFFwPvQnVDgFwL-Rsf-3ohi0eZFilHRrsSyKXw8e-T29u8mZr8xuRA4KERsomf60si2FazU5lP-TbO1gOjq00SdBieZ_fvd4O8Cmia-d9eMen7-jZbQeM=w678-h567-s-no-gm?authuser=0"
  },
  {
    "id": "e2d8f335-f100-4535-8ec0-5214ba53b134",
    "slug": "fuji-top-fc",
    "name": "FUJI TOP FC",
    "shortName": "FUJI TOP FC",
    "groupKey": "OTO AWORI B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNgg4aYsrgyFPIMnpy2s3FhgpqXsz0g4Y4XCKiooxsNDAdJhCva8-0mAoUSUMBy64e8nsdc1lsN-k2Fwy3Q1uNhxDj9ly50coMnMdxQ_DMn4jxLHL1qhvDv_C6jr-qdXo_ub6_yybIuXWoEtb-_u_Ch=w472-h626-s-no-gm?authuser=0"
  },
  {
    "id": "418e7ccd-19e9-4ed5-8e8a-9d1a75c1b15c",
    "slug": "roro-fc",
    "name": "RORO FC",
    "shortName": "RORO FC",
    "groupKey": "OJO A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPhNQc17BF-hEhmg52GgDUZgnwWYWUYJC7vU_5D2zwYqRs0oE96NrN4KLXEvT20TlD2sz6K42N6H5E1aO6nL0Wj6VniTZgrdrXMYdQkcewlhfxUsacsi3ZzuquMT8ytemefSeIUbeMOJdUNtYUURuke=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "cebadd3c-006a-488c-8511-3aa03e2336b3",
    "slug": "emaljus-fc",
    "name": "EMALJUS FC",
    "shortName": "EMALJUS FC",
    "groupKey": "OJO A",
    "logoUrl": "https://api.1xcup.ng/storage/team-registrations/logos/4ed3deb70c1776acb1c7e4ec083fb20c.jpg"
  },
  {
    "id": "73fc11b8-5b06-43ae-8533-3176b6a92562",
    "slug": "divinely-blessed-fc",
    "name": "DIVINELY BLESSED FC",
    "shortName": "DIVINELY BLESSED F",
    "groupKey": "OJO A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPmYWnfFaVpx1EOOQLMxV7PJOOrVx_99XT-kT5d-lRlyUL2wS-EAF0L6gLBXBBWtcb74vjLRQn7Gs6KVgCGLZ8srb9eeNRDtas9Krosw3-cIuH_bK73b8G9Kxt_aJ-0b-5g4cYwP6OWR6CGGccdSGVv=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "40c4c823-df36-4d05-8d5e-6b9a3f4b817e",
    "slug": "sc-heritage",
    "name": "SC HERITAGE",
    "shortName": "SC HERITAGE",
    "groupKey": "OJO A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPWh5xMNZZfn0xTQtGuz90WWYzMEygTQHfQt6jIT6XjugEmfbGuRngYTwOzPTGBrn3LM5uK6IYFR_Fnlfglr9Bewc1FLBUOi7DRKDBCReUGup9Cwu5igLHaUT5LzCCJBkym6ar1RjVeR6opzRWnI-hs=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "201f6019-0991-4888-8dda-1579237544f6",
    "slug": "pocsa",
    "name": "POCSA",
    "shortName": "POCSA",
    "groupKey": "OJO A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPF9L8wCr-ErMOU3ZHT_brI0YBG9umX-eB9SlcrBc8j1hr7zdiYtzKFvfp0lSBFbwLqP2sa1Pik9BdLXmX6L27sdM1sd8AZegpV2u2IHextjd1YbNQNkFgcyYNmaD0oCC87GNyzpEtPr9kkfAhszssr=w732-h612-s-no-gm?authuser=0"
  },
  {
    "id": "b0f47cf2-432b-4cef-82e5-0d174b7ce5aa",
    "slug": "black-jaguars-fc",
    "name": "BLACK JAGUARS FC",
    "shortName": "BLACK JAGUARS FC",
    "groupKey": "OJO A",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPA2u-T8PhZl1btuC9iWkwlONLPcQS7EbRCXy1_pi-AvWNdzbvVg7ix7R0pwdHjR9A4N-DcVIwJlp8AmBTtU9xAjVRBbj7QmoP2fIARB4AskG5Cy5h7HbrRei3ydrSq8-XaUClZPf3qTBLwSp0R-vWi=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "de24aa20-35e7-4a1e-87de-b96ad784c76d",
    "slug": "budu-elites-fc",
    "name": "BUDU ELITES FC",
    "shortName": "BUDU ELITES FC",
    "groupKey": "OJO B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczOBd8DHKN7HM6fFQsEFzl5-tbCRjmc0uc5s-bnPM9vkCB9ATPdzjuAJS83XPNZobVR5LLigy0CuiteXbghdTWWfmzPpYAFRS9PAwvKjOfYUORugUlH24xIiTxtg4sKsF8YI3FX7g5PX5vuWzedpGLyF=w746-h820-s-no-gm?authuser=0"
  },
  {
    "id": "f5ea13ed-73b4-4fe8-85f7-5a4918433da6",
    "slug": "leads-united-fc",
    "name": "LEADS UNITED FC",
    "shortName": "LEADS UNITED FC",
    "groupKey": "OJO B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNil5MllyiUVLjTuaRsy2JK7R2BueHe8f1metZJIUvnklopi5VoB2nZ4TD1L8l7ZuwRZBsluRgKkF_ZeXdCgc9gMEzyHd0_tvNNN69UlZg0n1j6HF2qLcbRqqOfSD-1-ByR6u4cz708icWTV_NetmIg=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "33713507-e438-4c06-870f-9d51f911ec5f",
    "slug": "first-touch-fa",
    "name": "FIRST TOUCH FA",
    "shortName": "FIRST TOUCH FA",
    "groupKey": "OJO B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczP3l-DCFYk8vAkWafE9uJZPrVVj3iOTmlan5XfxEPSC1J8vTRcsir4ce9cxLlTjJb9psaAoz9pT8uX9BVAQAAMYy6h5Pst5SP77vGy-Ezf2KhB87pITRiyeSiSIFcRiRX8v2lUP8EUR8g6hPa15Osi6=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "f038ec4b-eb98-4d50-8da3-a1ee3d0300b7",
    "slug": "eva-light-fc",
    "name": "EVA LIGHT FC",
    "shortName": "EVA LIGHT FC",
    "groupKey": "OJO B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNYXs7DrA6GikGM6BTjmNp1WfIeFw-uvsfzniYXTKcFLcVjTAhKajO1nELZIXHGwNaFZm5xwrbawie8XAHTGkgUuKFnf6oSvT9Iv0_JIvmgmRfEo61mU80jFxLTqEYZx6tX2hKnjuUEnFSJ_DlutB5k=w608-h626-s-no-gm?authuser=0"
  },
  {
    "id": "443d5fed-6e00-44e7-87b5-bd06caca4aa5",
    "slug": "brilliant-sports-fa",
    "name": "BRILLIANT SPORTS FA",
    "shortName": "BRILLIANT FA",
    "groupKey": "OJO B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczP0RbXOLq99LOY5oJVr4vPds-4GSgn9kGwohnfMdbKKToAgkLNjiccD8D0qQHu0TTxamQU6t4cJbHlXI93H_3L5egvb9wU6daDqrIiFyqDxkMvrWPdPSpdBgq48fwnJh3PoUCuhrSljfVK1luCI6NKc=w500-h500-s-no-gm?authuser=0"
  },
  {
    "id": "b09ee9bf-659b-40b6-85f5-369048cdf623",
    "slug": "liams-heights-sports-academy",
    "name": "LIAM'S HEIGHTS SPORTS ACADEMY",
    "shortName": "LIAM'S HEIGHTS",
    "groupKey": "OJO B",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczMC5xbKpRHCMqUXiqcqX6mnKegntYs9Q5ateu2XUbDXsPotp6zreMWwY0m2nmnbboKCB5TGlkMXO1_Xi2ubWLbRin4KMIvWkEUlM_gXV61Tlzfbcm9zuKEUZq-Ywt3HHGowxxzPoELEdj6P_6Uwn5pr=w908-h945-s-no-gm?authuser=0"
  },
  {
    "id": "fb599640-100c-4987-8302-12d02166bc0f",
    "slug": "young-eleven-fc",
    "name": "YOUNG ELEVEN FC",
    "shortName": "YOUNG ELEVEN FC",
    "groupKey": "IBA",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPY9HiU5jeQuzTCeyAm4qfTgHqWL1PbC8BZbnANHxJHB1Tun6ZhSvOPyTeCBj5BoEz3b9tPdimePD3fUmDolXywB0Kykaj9RyFEN2YQiZmlnnGPt76Coz0ZnAKOSVr2DYr80dizMdbn4W1jw-fC9KvN=w1027-h626-s-no-gm?authuser=0"
  },
  {
    "id": "ea95a345-f56e-4508-8425-8040c622fec7",
    "slug": "chekas-united-fc",
    "name": "CHEKAS UNITED FC",
    "shortName": "CHEKAS UNITED FC",
    "groupKey": "IBA",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNW3xAvFGhHYXxnuX-741v28SzJdDLHdvGs1_w91iq7rZhjGWZiAnwR3nCH8mhb25t5VtPxkxWHTguPC3RR81-Mgnz728CbjqHHFyYG4im9uSoAwXcKHKL_0HeYiS0maDqutAqP96U9l9xJiU-TUt6C=w641-h626-s-no-gm?authuser=0"
  },
  {
    "id": "cb7d88b0-c904-42f0-8bef-ccf189a70000",
    "slug": "ecas-fc",
    "name": "ECAS FC",
    "shortName": "ECAS FC",
    "groupKey": "IBA",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczPsEljfT5cwqo4YyHOgSIuveQX7smGRyvesIEuGHc5as6tDpfn_EeHllnqdlASBvXiww8kTm0hsuIG_fJnc2y5HOWze8sWgLPSzxgyr2KvjNUnb5gNcd5PHTxdKpzSoiW97i3mrD8bLM0PmEcucoVkm=w821-h893-s-no-gm?authuser=0"
  },
  {
    "id": "ab4af9ac-40c8-491a-881b-94ef4f323b44",
    "slug": "paddysco-sports-academy",
    "name": "PADDYSCO SPORTS ACADEMY",
    "shortName": "PADDYSCO",
    "groupKey": "IBA",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczM_mF5OAhcwD5voS7rml3iC8oKgB9lJJByKndESPY4IhZECN-HxQwsgGRpfSe4hCwxLjeCLl_ALxFY_sJeIVKAiUtp_GS6IFWGOML0d90S2ox-YaWuZend4MaWG-58t8s8cjIhHz9hFBtpQrh7CxCG6=w626-h626-s-no-gm?authuser=0"
  },
  {
    "id": "ac661bfc-62c4-4dba-8490-d42190128500",
    "slug": "smiler-all-champions-fc",
    "name": "SMILER ALL CHAMPIONS FC",
    "shortName": "SMILER ALL CHAMPIO",
    "groupKey": "IBA",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNU-d-z5XvqqcWWryv3JKgpBCGbacaU-syRc4EPesak4em0vSjsdQwDxTslAnHvxjlEWyFsyGo4Z_QdgyFEDvZsgEClwuwSIFCCkpVn-UEssggXQgYyHbWELd6FxOFwlsjIH925hEVM5jXNoW2iM_xQ=w601-h626-s-no-gm?authuser=0"
  },
  {
    "id": "4544bda5-eb6c-4c8f-833f-05957c895dd4",
    "slug": "diamond-fc",
    "name": "DIAMOND FC",
    "shortName": "DIAMOND FC",
    "groupKey": "IBA",
    "logoUrl": "https://lh3.googleusercontent.com/pw/AP1GczNHRT2AWTTgxN4-B_eVXnbmjEZPoS1OpPhGm560Rd-Px9_e5kS0WfWSOJoOKleRjHZcKXfBln5a4y71Pa2Now-r8GFtcW24SuxXQALxNOG0Hc3jm0PToEjqgdd5yz0D9KiKV1-kl0USkGtQ1gvFYahv=w612-h569-s-no-gm?authuser=0"
  }
];

type MatchSeed = {
  id: string;
  groupKey: string;
  matchday: number;
  homeSlug: string;
  awaySlug: string;
  kickoffAt: string;
  venue: string;
};

const MATCHES: MatchSeed[] = [
  {
    "id": "679671b2-6f04-4e6c-8b65-e10da2174992",
    "groupKey": "BADAGRY",
    "matchday": 1,
    "homeSlug": "roms-fc",
    "awaySlug": "mopson-athletic-academy",
    "kickoffAt": "2026-08-29T11:00:00.000+01:00",
    "venue": "Nigerian French Village, Ajara, Badagry"
  },
  {
    "id": "db4d499f-e341-45b1-8432-36add00f3625",
    "groupKey": "BADAGRY",
    "matchday": 1,
    "homeSlug": "young-talent-fc",
    "awaySlug": "36-lions-fc",
    "kickoffAt": "2026-08-29T13:00:00.000+01:00",
    "venue": "Nigerian French Village, Ajara, Badagry"
  },
  {
    "id": "18187e04-3ae5-45c8-8528-62c9191f5a6d",
    "groupKey": "BADAGRY",
    "matchday": 1,
    "homeSlug": "supreme-heroes-fc",
    "awaySlug": "rikay-fc",
    "kickoffAt": "2026-08-29T15:00:00.000+01:00",
    "venue": "Nigerian French Village, Ajara, Badagry"
  },
  {
    "id": "b01c3bbc-5e66-4df7-8112-c3a798eccd23",
    "groupKey": "BADAGRY",
    "matchday": 2,
    "homeSlug": "masters-fc",
    "awaySlug": "mopson-athletic-academy",
    "kickoffAt": "2026-09-01T11:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "ffd6801f-7fce-419d-8fb6-3fb7fda7fd21",
    "groupKey": "BADAGRY",
    "matchday": 2,
    "homeSlug": "rikay-fc",
    "awaySlug": "roms-fc",
    "kickoffAt": "2026-09-01T13:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "5f6930d1-3c83-4c91-8f67-4fc6be10e8e5",
    "groupKey": "BADAGRY",
    "matchday": 2,
    "homeSlug": "young-talent-fc",
    "awaySlug": "supreme-heroes-fc",
    "kickoffAt": "2026-09-01T15:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "90e72b82-6058-4384-8378-d38233f1d24b",
    "groupKey": "BADAGRY",
    "matchday": 3,
    "homeSlug": "roms-fc",
    "awaySlug": "young-talent-fc",
    "kickoffAt": "2026-09-03T11:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "580b6e2b-5b80-43ed-86df-6c98ceda3390",
    "groupKey": "BADAGRY",
    "matchday": 3,
    "homeSlug": "mopson-athletic-academy",
    "awaySlug": "rikay-fc",
    "kickoffAt": "2026-09-03T13:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "5cd0faa8-118e-477a-83b1-b8a210153b66",
    "groupKey": "BADAGRY",
    "matchday": 3,
    "homeSlug": "36-lions-fc",
    "awaySlug": "masters-fc",
    "kickoffAt": "2026-09-03T15:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "9aa3aac1-20fa-4a58-867d-86eaec66ff9c",
    "groupKey": "BADAGRY",
    "matchday": 4,
    "homeSlug": "mopson-athletic-academy",
    "awaySlug": "young-talent-fc",
    "kickoffAt": "2026-09-05T11:00:00.000+01:00",
    "venue": "Nigerian French Village, Ajara, Badagry"
  },
  {
    "id": "f9570702-a6fd-41ac-89d4-b52c1ec10396",
    "groupKey": "BADAGRY",
    "matchday": 4,
    "homeSlug": "36-lions-fc",
    "awaySlug": "supreme-heroes-fc",
    "kickoffAt": "2026-09-05T13:00:00.000+01:00",
    "venue": "Nigerian French Village, Ajara, Badagry"
  },
  {
    "id": "cdd6ae24-d93d-4fcd-8971-4d200ca429c0",
    "groupKey": "BADAGRY",
    "matchday": 4,
    "homeSlug": "masters-fc",
    "awaySlug": "rikay-fc",
    "kickoffAt": "2026-09-05T15:00:00.000+01:00",
    "venue": "Nigerian French Village, Ajara, Badagry"
  },
  {
    "id": "7ae65a97-71fb-46d3-8292-fc9b8e7ef0bf",
    "groupKey": "BADAGRY",
    "matchday": 5,
    "homeSlug": "supreme-heroes-fc",
    "awaySlug": "masters-fc",
    "kickoffAt": "2026-09-08T11:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "0fbe4eb9-d2f2-4af7-82b5-e78c73e8f033",
    "groupKey": "BADAGRY",
    "matchday": 5,
    "homeSlug": "rikay-fc",
    "awaySlug": "young-talent-fc",
    "kickoffAt": "2026-09-08T13:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "54ea12fa-7831-4da0-8335-3bd8f16d44d7",
    "groupKey": "BADAGRY",
    "matchday": 5,
    "homeSlug": "36-lions-fc",
    "awaySlug": "roms-fc",
    "kickoffAt": "2026-09-08T15:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "221a6b55-5d2d-4e22-8fa6-b387e12ac493",
    "groupKey": "BADAGRY",
    "matchday": 6,
    "homeSlug": "36-lions-fc",
    "awaySlug": "mopson-athletic-academy",
    "kickoffAt": "2026-09-10T11:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "fc8e47ad-5cec-42a0-8d6e-7aa2bb3c44d6",
    "groupKey": "BADAGRY",
    "matchday": 6,
    "homeSlug": "masters-fc",
    "awaySlug": "young-talent-fc",
    "kickoffAt": "2026-09-10T13:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "4a456404-f85c-49d3-804c-36d096fc5450",
    "groupKey": "BADAGRY",
    "matchday": 6,
    "homeSlug": "supreme-heroes-fc",
    "awaySlug": "roms-fc",
    "kickoffAt": "2026-09-10T15:00:00.000+01:00",
    "venue": "LA Primary School, Age Mowo"
  },
  {
    "id": "09533bba-a808-49bc-8bbd-8403f66ba356",
    "groupKey": "BADAGRY",
    "matchday": 7,
    "homeSlug": "roms-fc",
    "awaySlug": "masters-fc",
    "kickoffAt": "2026-09-12T11:00:00.000+01:00",
    "venue": "Nigerian French Village, Ajara, Badagry"
  },
  {
    "id": "c54e7aa0-6ae0-4a47-841b-1322909c9efe",
    "groupKey": "BADAGRY",
    "matchday": 7,
    "homeSlug": "supreme-heroes-fc",
    "awaySlug": "mopson-athletic-academy",
    "kickoffAt": "2026-09-12T13:00:00.000+01:00",
    "venue": "Nigerian French Village, Ajara, Badagry"
  },
  {
    "id": "a46b6007-862f-4d44-8154-fa8f19215bb2",
    "groupKey": "BADAGRY",
    "matchday": 7,
    "homeSlug": "rikay-fc",
    "awaySlug": "36-lions-fc",
    "kickoffAt": "2026-09-12T15:00:00.000+01:00",
    "venue": "Nigerian French Village, Ajara, Badagry"
  },
  {
    "id": "dc497e54-7711-4bbe-8f08-8abb6de72108",
    "groupKey": "OTO AWORI A",
    "matchday": 1,
    "homeSlug": "inter-javed-fc",
    "awaySlug": "jp-young-stars-fc",
    "kickoffAt": "2026-09-01T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "74cab316-a211-4bcb-8bee-bdc03a636ef8",
    "groupKey": "OTO AWORI A",
    "matchday": 1,
    "homeSlug": "royal-fc",
    "awaySlug": "dream-chasers-fc",
    "kickoffAt": "2026-09-01T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "a6dded62-a89b-4c11-85bf-bd4bc1d35926",
    "groupKey": "OTO AWORI A",
    "matchday": 1,
    "homeSlug": "super-stars-fc",
    "awaySlug": "bilda-fa",
    "kickoffAt": "2026-09-01T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "b66ead0d-661d-4df3-8957-1ce865b60fb0",
    "groupKey": "OTO AWORI A",
    "matchday": 2,
    "homeSlug": "jp-young-stars-fc",
    "awaySlug": "lucky-fc",
    "kickoffAt": "2026-09-04T11:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "bd3c7cc5-ccf6-40a7-8eb0-ec461cc7311d",
    "groupKey": "OTO AWORI A",
    "matchday": 2,
    "homeSlug": "bilda-fa",
    "awaySlug": "inter-javed-fc",
    "kickoffAt": "2026-09-04T13:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "a8b1a3d5-015a-4417-87a0-eef4b9b28b0b",
    "groupKey": "OTO AWORI A",
    "matchday": 2,
    "homeSlug": "super-stars-fc",
    "awaySlug": "royal-fc",
    "kickoffAt": "2026-09-04T15:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "6611df5e-efa8-4d32-8b14-134b8c3314d2",
    "groupKey": "OTO AWORI A",
    "matchday": 3,
    "homeSlug": "lucky-fc",
    "awaySlug": "dream-chasers-fc",
    "kickoffAt": "2026-09-06T12:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "39fe0769-8ae9-4bbb-8e95-1dedeffa397b",
    "groupKey": "OTO AWORI A",
    "matchday": 3,
    "homeSlug": "inter-javed-fc",
    "awaySlug": "royal-fc",
    "kickoffAt": "2026-09-06T14:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "e68d3163-c79d-43c6-8bf5-623af123de00",
    "groupKey": "OTO AWORI A",
    "matchday": 3,
    "homeSlug": "jp-young-stars-fc",
    "awaySlug": "bilda-fa",
    "kickoffAt": "2026-09-06T16:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "db701158-8be9-4d92-89fa-b098ce778af3",
    "groupKey": "OTO AWORI A",
    "matchday": 4,
    "homeSlug": "royal-fc",
    "awaySlug": "jp-young-stars-fc",
    "kickoffAt": "2026-09-09T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "d067d379-4522-436b-82b1-013605fcbe5a",
    "groupKey": "OTO AWORI A",
    "matchday": 4,
    "homeSlug": "dream-chasers-fc",
    "awaySlug": "super-stars-fc",
    "kickoffAt": "2026-09-09T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "0d2e42b0-7a87-4a45-8260-431fafa98811",
    "groupKey": "OTO AWORI A",
    "matchday": 4,
    "homeSlug": "bilda-fa",
    "awaySlug": "lucky-fc",
    "kickoffAt": "2026-09-09T16:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "1bef91bc-b8ff-4a42-89af-b9263842ab3a",
    "groupKey": "OTO AWORI A",
    "matchday": 5,
    "homeSlug": "dream-chasers-fc",
    "awaySlug": "inter-javed-fc",
    "kickoffAt": "2026-09-12T11:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "ce1a53cd-274a-45ba-822a-d3d879b724be",
    "groupKey": "OTO AWORI A",
    "matchday": 5,
    "homeSlug": "bilda-fa",
    "awaySlug": "royal-fc",
    "kickoffAt": "2026-09-12T13:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "539c1066-96ed-435a-84ca-d84ba2e85161",
    "groupKey": "OTO AWORI A",
    "matchday": 5,
    "homeSlug": "lucky-fc",
    "awaySlug": "super-stars-fc",
    "kickoffAt": "2026-09-12T15:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "916d602c-09bc-4aff-8952-b1c40f5627ec",
    "groupKey": "OTO AWORI A",
    "matchday": 6,
    "homeSlug": "lucky-fc",
    "awaySlug": "royal-fc",
    "kickoffAt": "2026-09-16T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "8b574d69-e323-4bd3-871d-35b93061a0d8",
    "groupKey": "OTO AWORI A",
    "matchday": 6,
    "homeSlug": "super-stars-fc",
    "awaySlug": "inter-javed-fc",
    "kickoffAt": "2026-09-16T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "ce82d453-fa45-475a-852e-335dc4dcb567",
    "groupKey": "OTO AWORI A",
    "matchday": 6,
    "homeSlug": "dream-chasers-fc",
    "awaySlug": "jp-young-stars-fc",
    "kickoffAt": "2026-09-16T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "8501bbd6-fb21-4577-81e6-e689617a9265",
    "groupKey": "OTO AWORI A",
    "matchday": 7,
    "homeSlug": "super-stars-fc",
    "awaySlug": "jp-young-stars-fc",
    "kickoffAt": "2026-09-18T10:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "d38484b5-be08-45a7-83bf-7f6d86fbf0d9",
    "groupKey": "OTO AWORI A",
    "matchday": 7,
    "homeSlug": "bilda-fa",
    "awaySlug": "dream-chasers-fc",
    "kickoffAt": "2026-09-18T12:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "2406a2fe-aee8-4bd9-8070-b4b25b53257c",
    "groupKey": "OTO AWORI A",
    "matchday": 7,
    "homeSlug": "lucky-fc",
    "awaySlug": "inter-javed-fc",
    "kickoffAt": "2026-09-18T14:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "5817dbbf-4779-4e7b-811a-eee9b3542577",
    "groupKey": "OTO AWORI B",
    "matchday": 1,
    "homeSlug": "kedge-sports-intl",
    "awaySlug": "oscar-rovers-sports-fc",
    "kickoffAt": "2026-09-02T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "f81875dc-0673-4ca4-8fd4-2cd845a8405e",
    "groupKey": "OTO AWORI B",
    "matchday": 1,
    "homeSlug": "tico-fa",
    "awaySlug": "isashi-fc",
    "kickoffAt": "2026-09-02T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "df903128-a269-41b8-8f76-518ad9879c43",
    "groupKey": "OTO AWORI B",
    "matchday": 1,
    "homeSlug": "power-of-the-cross-sa",
    "awaySlug": "fuji-top-fc",
    "kickoffAt": "2026-09-02T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "e52652bf-b780-4897-8737-f4cd935ca187",
    "groupKey": "OTO AWORI B",
    "matchday": 2,
    "homeSlug": "fuji-top-fc",
    "awaySlug": "tico-fa",
    "kickoffAt": "2026-09-05T11:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "733c98c1-f167-4261-83fd-02609c49c131",
    "groupKey": "OTO AWORI B",
    "matchday": 2,
    "homeSlug": "power-of-the-cross-sa",
    "awaySlug": "oscar-rovers-sports-fc",
    "kickoffAt": "2026-09-05T13:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "2e205d39-5840-4769-8df3-32e8103aa18d",
    "groupKey": "OTO AWORI B",
    "matchday": 2,
    "homeSlug": "isashi-fc",
    "awaySlug": "kedge-sports-intl",
    "kickoffAt": "2026-09-05T15:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "a0c48e80-be92-4f4b-8a61-89f9badf5d37",
    "groupKey": "OTO AWORI B",
    "matchday": 3,
    "homeSlug": "isashi-fc",
    "awaySlug": "oscar-rovers-sports-fc",
    "kickoffAt": "2026-09-08T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "764f46a9-5bd7-4138-8d21-09b6e1878c98",
    "groupKey": "OTO AWORI B",
    "matchday": 3,
    "homeSlug": "kedge-sports-intl",
    "awaySlug": "fuji-top-fc",
    "kickoffAt": "2026-09-08T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "a117e604-2c79-4b57-8bee-eee9f936fe68",
    "groupKey": "OTO AWORI B",
    "matchday": 3,
    "homeSlug": "tico-fa",
    "awaySlug": "power-of-the-cross-sa",
    "kickoffAt": "2026-09-08T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "3fe4bbb1-031b-4332-82ea-1e0c4db48bf7",
    "groupKey": "OTO AWORI B",
    "matchday": 4,
    "homeSlug": "fuji-top-fc",
    "awaySlug": "isashi-fc",
    "kickoffAt": "2026-09-10T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "3f1577ae-e7fc-426d-80e1-62f404fbcf2e",
    "groupKey": "OTO AWORI B",
    "matchday": 4,
    "homeSlug": "power-of-the-cross-sa",
    "awaySlug": "kedge-sports-intl",
    "kickoffAt": "2026-09-10T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "30ae56e9-b7d9-4b05-87ca-0eee4ac77bd7",
    "groupKey": "OTO AWORI B",
    "matchday": 4,
    "homeSlug": "oscar-rovers-sports-fc",
    "awaySlug": "tico-fa",
    "kickoffAt": "2026-09-10T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "afef443f-3ab5-4e9f-864e-7fb7784f93f5",
    "groupKey": "OTO AWORI B",
    "matchday": 5,
    "homeSlug": "isashi-fc",
    "awaySlug": "power-of-the-cross-sa",
    "kickoffAt": "2026-09-13T12:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "bda826ec-da59-4f63-8d7a-dbd1cb698cf3",
    "groupKey": "OTO AWORI B",
    "matchday": 5,
    "homeSlug": "oscar-rovers-sports-fc",
    "awaySlug": "fuji-top-fc",
    "kickoffAt": "2026-09-13T14:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "3303e55d-086c-4dca-84af-4d447470f7b0",
    "groupKey": "OTO AWORI B",
    "matchday": 5,
    "homeSlug": "tico-fa",
    "awaySlug": "kedge-sports-intl",
    "kickoffAt": "2026-09-13T16:00:00.000+01:00",
    "venue": "Ashiribo Sports Center, Ijanikin"
  },
  {
    "id": "4fdccae3-631b-44ac-851e-0a764c8160d2",
    "groupKey": "OJO A",
    "matchday": 1,
    "homeSlug": "roro-fc",
    "awaySlug": "emaljus-fc",
    "kickoffAt": "2026-08-31T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "08c290e9-1d5d-441a-8532-f2cd7b1ae432",
    "groupKey": "OJO A",
    "matchday": 1,
    "homeSlug": "divinely-blessed-fc",
    "awaySlug": "sc-heritage",
    "kickoffAt": "2026-08-31T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "3a28c056-f0f9-4d0e-8e97-5e7808219618",
    "groupKey": "OJO A",
    "matchday": 1,
    "homeSlug": "pocsa",
    "awaySlug": "black-jaguars-fc",
    "kickoffAt": "2026-08-31T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "15903048-9971-4e04-8fab-f39fa0511553",
    "groupKey": "OJO A",
    "matchday": 2,
    "homeSlug": "pocsa",
    "awaySlug": "sc-heritage",
    "kickoffAt": "2026-09-02T10:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "565a241c-b185-44e6-8da9-d9185d5de45a",
    "groupKey": "OJO A",
    "matchday": 2,
    "homeSlug": "emaljus-fc",
    "awaySlug": "divinely-blessed-fc",
    "kickoffAt": "2026-09-02T12:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "9b5bb5d3-de4b-4af0-86cf-489d482fcae4",
    "groupKey": "OJO A",
    "matchday": 2,
    "homeSlug": "black-jaguars-fc",
    "awaySlug": "roro-fc",
    "kickoffAt": "2026-09-02T14:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "458c9a7e-3d93-42e3-831b-b0b9bd621c70",
    "groupKey": "OJO A",
    "matchday": 3,
    "homeSlug": "emaljus-fc",
    "awaySlug": "sc-heritage",
    "kickoffAt": "2026-09-04T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "4180581e-3654-4346-8a6c-accc2ec69ecc",
    "groupKey": "OJO A",
    "matchday": 3,
    "homeSlug": "roro-fc",
    "awaySlug": "pocsa",
    "kickoffAt": "2026-09-04T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "82fc0003-3c61-4bdf-83fe-58773aeaadcf",
    "groupKey": "OJO A",
    "matchday": 3,
    "homeSlug": "divinely-blessed-fc",
    "awaySlug": "black-jaguars-fc",
    "kickoffAt": "2026-09-04T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "ab314763-ad75-4b1d-89a7-1f7390a0874a",
    "groupKey": "OJO A",
    "matchday": 4,
    "homeSlug": "emaljus-fc",
    "awaySlug": "black-jaguars-fc",
    "kickoffAt": "2026-09-08T10:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "5664c9d6-18b7-4e5f-85ac-babea9fd6523",
    "groupKey": "OJO A",
    "matchday": 4,
    "homeSlug": "divinely-blessed-fc",
    "awaySlug": "pocsa",
    "kickoffAt": "2026-09-08T12:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "76c27f98-f378-4652-8f07-7d14558a896f",
    "groupKey": "OJO A",
    "matchday": 4,
    "homeSlug": "sc-heritage",
    "awaySlug": "roro-fc",
    "kickoffAt": "2026-09-08T14:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "a1088474-2590-4b98-8584-fd4f64a9fab8",
    "groupKey": "OJO A",
    "matchday": 5,
    "homeSlug": "sc-heritage",
    "awaySlug": "black-jaguars-fc",
    "kickoffAt": "2026-09-11T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "805f86e7-c2b2-42f9-8606-c9ee52fc85e1",
    "groupKey": "OJO A",
    "matchday": 5,
    "homeSlug": "roro-fc",
    "awaySlug": "divinely-blessed-fc",
    "kickoffAt": "2026-09-11T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "15cd4b1a-e667-43fb-8a22-97c2ccb4d9b6",
    "groupKey": "OJO A",
    "matchday": 5,
    "homeSlug": "emaljus-fc",
    "awaySlug": "pocsa",
    "kickoffAt": "2026-09-11T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "ee64c7aa-aed1-422e-8cf2-1a182a80e53c",
    "groupKey": "OJO B",
    "matchday": 1,
    "homeSlug": "first-touch-fa",
    "awaySlug": "eva-light-fc",
    "kickoffAt": "2026-09-01T10:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "762245fa-a0ed-4bf2-892c-f2e777792b33",
    "groupKey": "OJO B",
    "matchday": 1,
    "homeSlug": "brilliant-sports-fa",
    "awaySlug": "liams-heights-sports-academy",
    "kickoffAt": "2026-09-01T12:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "f600beb6-6bca-4a41-8d46-e82b225da412",
    "groupKey": "OJO B",
    "matchday": 1,
    "homeSlug": "budu-elites-fc",
    "awaySlug": "leads-united-fc",
    "kickoffAt": "2026-09-01T14:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "923a93e7-90c0-40a6-8283-d73453cb09bd",
    "groupKey": "OJO B",
    "matchday": 2,
    "homeSlug": "leads-united-fc",
    "awaySlug": "first-touch-fa",
    "kickoffAt": "2026-09-03T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "9fe17380-e251-4c22-8b79-1a81bd88bc69",
    "groupKey": "OJO B",
    "matchday": 2,
    "homeSlug": "liams-heights-sports-academy",
    "awaySlug": "budu-elites-fc",
    "kickoffAt": "2026-09-03T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "be1eae48-da13-4f45-89eb-79acd7edfc9e",
    "groupKey": "OJO B",
    "matchday": 2,
    "homeSlug": "eva-light-fc",
    "awaySlug": "brilliant-sports-fa",
    "kickoffAt": "2026-09-03T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "6107bc4c-3058-4317-8f36-31b9e62a2f88",
    "groupKey": "OJO B",
    "matchday": 3,
    "homeSlug": "leads-united-fc",
    "awaySlug": "eva-light-fc",
    "kickoffAt": "2026-09-07T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "1b24435a-1594-4198-8238-ee54286f7ca0",
    "groupKey": "OJO B",
    "matchday": 3,
    "homeSlug": "budu-elites-fc",
    "awaySlug": "brilliant-sports-fa",
    "kickoffAt": "2026-09-07T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "dae93eb9-710c-422c-8719-62ec2a4cc597",
    "groupKey": "OJO B",
    "matchday": 3,
    "homeSlug": "first-touch-fa",
    "awaySlug": "liams-heights-sports-academy",
    "kickoffAt": "2026-09-07T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "3a9400a6-e3b3-4d05-8a0a-3e64cef264b8",
    "groupKey": "OJO B",
    "matchday": 4,
    "homeSlug": "eva-light-fc",
    "awaySlug": "liams-heights-sports-academy",
    "kickoffAt": "2026-09-09T10:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "e76566da-b78a-4e44-8b35-fafd223190b1",
    "groupKey": "OJO B",
    "matchday": 4,
    "homeSlug": "brilliant-sports-fa",
    "awaySlug": "leads-united-fc",
    "kickoffAt": "2026-09-09T12:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "76dab6b0-6e7e-4b03-811c-35d1fb50ce41",
    "groupKey": "OJO B",
    "matchday": 4,
    "homeSlug": "first-touch-fa",
    "awaySlug": "budu-elites-fc",
    "kickoffAt": "2026-09-09T14:00:00.000+01:00",
    "venue": "Saint Michael Primary School, Ojo"
  },
  {
    "id": "239ef9a6-6e53-4caf-8ce0-9cbfc2b51d23",
    "groupKey": "OJO B",
    "matchday": 5,
    "homeSlug": "liams-heights-sports-academy",
    "awaySlug": "leads-united-fc",
    "kickoffAt": "2026-09-12T10:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "19d299ab-ecfa-407c-8faa-9de3e30018f6",
    "groupKey": "OJO B",
    "matchday": 5,
    "homeSlug": "eva-light-fc",
    "awaySlug": "budu-elites-fc",
    "kickoffAt": "2026-09-12T12:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "2a804f4a-2ab3-448c-8f01-e746d56b4f55",
    "groupKey": "OJO B",
    "matchday": 5,
    "homeSlug": "brilliant-sports-fa",
    "awaySlug": "first-touch-fa",
    "kickoffAt": "2026-09-12T14:00:00.000+01:00",
    "venue": "Jakande Sports Center, Ajangbadi"
  },
  {
    "id": "55c58807-ed4c-402a-8871-7d117fae2dc1",
    "groupKey": "IBA",
    "matchday": 1,
    "homeSlug": "young-eleven-fc",
    "awaySlug": "chekas-united-fc",
    "kickoffAt": "2026-08-31T11:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "3823e3f6-5fdf-468a-8818-d1c8b9f73dfa",
    "groupKey": "IBA",
    "matchday": 1,
    "homeSlug": "smiler-all-champions-fc",
    "awaySlug": "diamond-fc",
    "kickoffAt": "2026-08-31T13:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "eee62384-e00e-405e-8868-dadba63c737c",
    "groupKey": "IBA",
    "matchday": 1,
    "homeSlug": "ecas-fc",
    "awaySlug": "paddysco-sports-academy",
    "kickoffAt": "2026-08-31T15:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "897b1962-602c-4d78-8f93-b429c30b6260",
    "groupKey": "IBA",
    "matchday": 2,
    "homeSlug": "paddysco-sports-academy",
    "awaySlug": "smiler-all-champions-fc",
    "kickoffAt": "2026-09-04T11:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "5ed9c10b-a7cb-4a12-8ec7-dab13dc017d1",
    "groupKey": "IBA",
    "matchday": 2,
    "homeSlug": "chekas-united-fc",
    "awaySlug": "ecas-fc",
    "kickoffAt": "2026-09-04T13:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "e4e7df45-5aa2-402c-8d3a-60aeef9e1761",
    "groupKey": "IBA",
    "matchday": 2,
    "homeSlug": "diamond-fc",
    "awaySlug": "young-eleven-fc",
    "kickoffAt": "2026-09-04T15:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "d6277144-6b15-44c5-888c-fcf10e16b379",
    "groupKey": "IBA",
    "matchday": 3,
    "homeSlug": "ecas-fc",
    "awaySlug": "diamond-fc",
    "kickoffAt": "2026-09-07T11:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "56e0d95b-ecbc-4882-883f-c2c2ce5c3ea8",
    "groupKey": "IBA",
    "matchday": 3,
    "homeSlug": "young-eleven-fc",
    "awaySlug": "smiler-all-champions-fc",
    "kickoffAt": "2026-09-07T13:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "59bff2fa-7b12-467f-8b7d-3d098381930a",
    "groupKey": "IBA",
    "matchday": 3,
    "homeSlug": "chekas-united-fc",
    "awaySlug": "paddysco-sports-academy",
    "kickoffAt": "2026-09-07T15:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "188b6b38-2b66-4ce2-8db3-351a0e0f14fc",
    "groupKey": "IBA",
    "matchday": 4,
    "homeSlug": "diamond-fc",
    "awaySlug": "chekas-united-fc",
    "kickoffAt": "2026-09-10T12:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "6672ff0f-0985-45b4-8104-e51fa7559708",
    "groupKey": "IBA",
    "matchday": 4,
    "homeSlug": "paddysco-sports-academy",
    "awaySlug": "young-eleven-fc",
    "kickoffAt": "2026-09-10T14:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "61059914-0f5e-4946-8bb5-57fcf2e2b7dc",
    "groupKey": "IBA",
    "matchday": 4,
    "homeSlug": "smiler-all-champions-fc",
    "awaySlug": "ecas-fc",
    "kickoffAt": "2026-09-10T16:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "bd240fb4-5255-4be8-81f0-7188ddd7fcc9",
    "groupKey": "IBA",
    "matchday": 5,
    "homeSlug": "young-eleven-fc",
    "awaySlug": "ecas-fc",
    "kickoffAt": "2026-09-14T11:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "326b2d00-bc8f-4798-880d-239fcabc766b",
    "groupKey": "IBA",
    "matchday": 5,
    "homeSlug": "paddysco-sports-academy",
    "awaySlug": "diamond-fc",
    "kickoffAt": "2026-09-14T13:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  },
  {
    "id": "7b5fb278-feb2-4be3-8de9-326f09481a81",
    "groupKey": "IBA",
    "matchday": 5,
    "homeSlug": "chekas-united-fc",
    "awaySlug": "smiler-all-champions-fc",
    "kickoffAt": "2026-09-14T15:00:00.000+01:00",
    "venue": "Olympic Stadium, Ijesha"
  }
];

const stageKeyFor = (groupKey: string) =>
  `group_${groupKey.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

export async function seedRakLeague2026(prisma: PrismaClient) {
  const formatConfig = {
    format: "zonal_group_stage_knockout",
    timezone: TIMEZONE,
    overview: DESCRIPTION,
    groupStage: {
      teams: 38,
      groups: ZONES.length,
      matches: 102,
      format: "single_round_robin",
      points: { win: 3, draw: 1, loss: 0 },
      tiebreakers: ["points", "goal_difference", "goals_for", "head_to_head"],
      zones: ZONES,
    },
    advancement: {
      topPerGroup: 2,
      bestThirdPlaced: 4,
      qualifiers: 16,
      into: "round_of_16",
    },
    knockout: {
      teams: 16,
      rounds: ["round_of_16", "quarter_final", "semi_final", "final"],
      // Bracket fixtures depend on final group standings, and no dates or
      // venues have been issued yet, so none are seeded.
      fixturesSeeded: false,
    },
  };

  const competitionFields = {
    name: COMP_NAME,
    season: "2025/2026",
    type: "league",
    formatType: "RAK_LEAGUE_ZONAL",
    formatConfig: formatConfig as Prisma.InputJsonValue,
    country: "Nigeria",
    logoUrl: COMP_LOGO,
    description: DESCRIPTION,
    status: "upcoming",
    isPublished: true,
  };

  const comp = await prisma.sbCompetition.upsert({
    where: { slug: COMP_SLUG },
    update: competitionFields,
    create: { id: COMP_ID, slug: COMP_SLUG, ...competitionFields },
  });

  const stageByGroup = new Map<string, string>();
  for (const zone of ZONES) {
    const stageFields = {
      name: zone.name,
      stageType: "group",
      sortOrder: zone.sortOrder,
      config: { ...zone, format: "single_round_robin" } as Prisma.InputJsonValue,
    };
    const row = await prisma.sbCompetitionStage.upsert({
      where: { competitionId_key: { competitionId: comp.id, key: stageKeyFor(zone.key) } },
      update: stageFields,
      create: { competitionId: comp.id, key: stageKeyFor(zone.key), ...stageFields },
    });
    stageByGroup.set(zone.key, row.id);
  }

  const knockoutFields = {
    name: "Round of 16",
    stageType: "knockout",
    sortOrder: 90,
    config: formatConfig.knockout as Prisma.InputJsonValue,
  };
  await prisma.sbCompetitionStage.upsert({
    where: { competitionId_key: { competitionId: comp.id, key: "round_of_16" } },
    update: knockoutFields,
    create: { competitionId: comp.id, key: "round_of_16", ...knockoutFields },
  });

  const teamIds: Record<string, string> = {};
  for (const team of TEAMS) {
    const teamFields = {
      name: normalizeClubName(team.name),
      shortName: team.shortName,
      groupKey: team.groupKey,
      city: "Lagos",
      logoUrl: team.logoUrl,
    };
    const row = await prisma.sbTeam.upsert({
      where: { competitionId_slug: { competitionId: comp.id, slug: team.slug } },
      update: teamFields,
      create: { id: team.id, competitionId: comp.id, slug: team.slug, ...teamFields },
    });
    teamIds[team.slug] = row.id;
  }

  const slugFor = await createSeedMatchSlugAllocator(prisma, MATCHES.map((m) => m.id));
  for (const match of MATCHES) {
    if (await shouldPreserveSbMatch(prisma, match.id)) continue;
    const shared = {
      slug: slugFor(match.id, match.homeSlug, match.awaySlug),
      stageKey: stageKeyFor(match.groupKey),
      stageId: stageByGroup.get(match.groupKey),
      matchday: match.matchday,
      homeTeamId: teamIds[match.homeSlug],
      awayTeamId: teamIds[match.awaySlug],
      status: "scheduled",
      homeScore: 0,
      awayScore: 0,
      minute: null,
      kickoffAt: new Date(match.kickoffAt),
      venue: match.venue,
      roundLabel: `${match.groupKey} - Matchday ${match.matchday}`,
      stats: null,
      isPublished: true,
      meta: { zone: match.groupKey, group: match.groupKey, timezone: TIMEZONE } as Prisma.InputJsonValue,
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
    `Seeded ${COMP_NAME}: ${teamCount} teams (expected 38), ${matchCount} matches (expected 102)`,
  );
  return { comp, teamCount, matchCount };
}
