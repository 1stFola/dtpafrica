// @ts-nocheck
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizePlayerName, playerLookupKey } from "@dtp/engines";
import {
  isFullSeed,
  shouldPreserveSbMatch,
  type SeedOptions,
} from "../src/seed/seed-options";
import { allocateMatchSlug, loadExistingMatchSlugs } from "../src/scoreboard/match-slug";
import { resolvePlayerNameCandidate } from "../src/scoreboard/player-name-normalization";

const COMP_SLUG = "1xcup-2026";
const COMP_ID = "00000000-0000-4000-81xc-000000000000";
const TIMEZONE = "Africa/Lagos";
const DEFAULT_VENUE = "Inspire Field";

type TeamSeed = {
  seed: number;
  id: string;
  slug: string;
  name: string;
  shortName: string;
  logoUrl: string;
  zone?: string;
};

type MatchSeed = {
  matchCode: string;
  homeName: string;
  awayName: string;
  zone: string;
  kickoffAt: string;
  venue: string;
};

type SquadSeed = {
  teamName: string;
  players: { name: string; position: string }[];
};

const TEAM_LOGOS_CSV = String.raw`Serial Number,team_name,logo_url
1,36 LION FC,https://api.1xcup.ng/storage/team-registrations/logos/e5500cf1b2b63538f0cf1dc503765d57.jpg
2,ADHOC FA,https://api.1xcup.ng/storage/team-registrations/logos/587bc604c1f5666fc4e511233ac3c8cc.png
3,AFRICANO FC,https://api.1xcup.ng/storage/team-registrations/logos/0ca978399f511bfe9bfdf78952ba1891.jpg
4,Agbede Supreme FC,https://api.1xcup.ng/storage/team-registrations/logos/e8cc1c83cb5a1449b3a7158bb8130075.png
5,AJUWA FA,https://api.1xcup.ng/storage/team-registrations/logos/c275ff3b1d663b36af1ce60a0a214ac3.jpg
6,AMA SMILE FC,https://api.1xcup.ng/storage/team-registrations/logos/77c8cbdd1e72b4f5a4f13e0869cce9c6.jpg
7,ARICH FC,https://api.1xcup.ng/storage/team-registrations/logos/1c5a39f120a661e813da4122abe8bba7.png
8,ARUBINJAGA FA,https://api.1xcup.ng/storage/team-registrations/logos/e7d6a83ccc280097ab5632f5a3455e1a.jpg
9,AUSTENPLUS FOOTBALL CLUB,https://api.1xcup.ng/storage/team-registrations/logos/5dbba2cf0f811801d4f373c8bc4cff91.jpg
10,AUX FC,https://api.1xcup.ng/storage/team-registrations/logos/e5361771c9aef9557ae70e2dc7367462.jpg
11,BARIGA STARS FC,https://api.1xcup.ng/storage/team-registrations/logos/43b32d515bec5d0464a920cd4da0dd3f.jpg
12,BELIEVE FA,https://api.1xcup.ng/storage/team-registrations/logos/98ad2d0a47d973b93e3bfa4e87926bcd.jpg
13,BETTER TOMORROW,https://api.1xcup.ng/storage/team-registrations/logos/0b4257967b84a6da3c578ea2b1365685.jpg
14,Bilda FA,https://api.1xcup.ng/storage/team-registrations/logos/9f396e9163d8aa1624fbec7611cd6d85.jpg
15,BRIGHTON FA,https://api.1xcup.ng/storage/team-registrations/logos/f913d7930795972a0195cedbe6b63ec5.jpg
16,BUDU ELITES FA,https://api.1xcup.ng/storage/team-registrations/logos/eb2b1a0349baa6bcd0b7cf1bf9c0d333.jpg
17,BUQUENSON FA,https://api.1xcup.ng/storage/team-registrations/logos/b56e6e522d912cb824601a5ac027abb9.jpg
18,BYT Academical FC,https://api.1xcup.ng/storage/team-registrations/logos/5cf6977be56395a3c7da6771eb34c4ce.jpg
19,CHINA SUNSTARS FC,https://api.1xcup.ng/storage/team-registrations/logos/732aec9afc998270554a4a8e0921960b.jpg
20,CITYFUT ESCOLA,https://api.1xcup.ng/storage/team-registrations/logos/7774789fc3bd274dbabf4aa4369c6df4.jpg
21,Cliques SA,https://api.1xcup.ng/storage/team-registrations/logos/a8b35dfc586aaf2f08fd92edeed19d38.jpg
22,COLLINS EDWIN SC,https://api.1xcup.ng/storage/team-registrations/logos/f302eaeab256efe1d79cfef5966f5ee9.png
23,COMFORTEDGE FC,https://api.1xcup.ng/storage/team-registrations/logos/93959116d87d1d914344f173b149792f.jpg
24,CRUSADERS FC,https://api.1xcup.ng/storage/team-registrations/logos/971fd8d80e6fd17aa3c7ede9423ab8f0.png
25,Crystal FC,https://api.1xcup.ng/storage/team-registrations/logos/6b3b8594e14181eded6fa99bfc860240.png
26,DA FARIA SC,https://api.1xcup.ng/storage/team-registrations/logos/812baf257372fa4ab4ec7073ff586aa8.jpg
27,DAJA UNITED,https://api.1xcup.ng/storage/team-registrations/logos/85168144b66b0c6d27cd12518f3a06dd.jpg
28,DE POTTERS FA,https://api.1xcup.ng/storage/team-registrations/logos/3322c2974f8b5edfe26de73e40735503.jpg
29,Diadem Stallion Sports,https://api.1xcup.ng/storage/team-registrations/logos/72c3ac6e6bda99a9def718eb7d042c19.jpg
30,Divine Praise  FC,https://api.1xcup.ng/storage/team-registrations/logos/d29afb6f42ad9f1f80ac228dfd9daf71.jpg
31,Dominion excellent star FA,https://api.1xcup.ng/storage/team-registrations/logos/95632f13c9b497dedc8117b94874530a.jpg
32,Dominion Hotspur FC,https://api.1xcup.ng/storage/team-registrations/logos/cdc6ea70ae74366d2da2f838b5f9dfee.jpg
33,DOSU JOSEPH FC,https://api.1xcup.ng/storage/team-registrations/logos/58a2c1d9c5b9a28c4a92c95ce28058f7.jpg
34,DREAMERS FC,https://api.1xcup.ng/storage/team-registrations/logos/06bb515412e02bc44786b3fa765601d1.jpg
35,Dynamic Dreams FC,https://api.1xcup.ng/storage/team-registrations/logos/9ff958ae6e116bd1f51bc246dd49bc6b.jpg
36,DYNAMIC FC,https://api.1xcup.ng/storage/team-registrations/logos/990b510f0b54f675a5e6c391ff3bc45d.png
37,Eagle Star FC,https://api.1xcup.ng/storage/team-registrations/logos/8fcea1de7dacb34b474fcd0de32b8e2e.jpg
38,Ecas FA,https://api.1xcup.ng/storage/team-registrations/logos/93c55aa88e5b766213bc7223709c1579.jpg
39,EDU YOUTH FC,https://api.1xcup.ng/storage/team-registrations/logos/f6940e0358e16f89c1cbbc26220664ee.png
40,Edunz International fc,https://api.1xcup.ng/storage/team-registrations/logos/e0fbed779f3433ad1bb91c16142b9181.jpg
41,Elite Stars FC,https://api.1xcup.ng/storage/team-registrations/logos/b1a0af5f37eeaf85df3603e4460ef346.png
42,Emaljus FC,https://api.1xcup.ng/storage/team-registrations/logos/4ed3deb70c1776acb1c7e4ec083fb20c.jpg
43,Emiloju FC,https://api.1xcup.ng/storage/team-registrations/logos/ddb348d00bfdc35a0cea4fdcef1fd916.jpg
44,Evolution United,https://api.1xcup.ng/storage/team-registrations/logos/a06054cd419b7e54c1a8f4a486381afc.jpg
45,FC BETHEL SPORTING,https://api.1xcup.ng/storage/team-registrations/logos/67967e7bcf43a6dad925b3520012115f.jpg
46,FC MIDDLEWELL,https://api.1xcup.ng/storage/team-registrations/logos/665c60dfb398694efc274af305e198ac.jpg
47,FRANCEEX UNITED,https://api.1xcup.ng/storage/team-registrations/logos/dbedbe6dbc725506c114dd9d74a16665.jpg
48,G Innovation FC,https://api.1xcup.ng/storage/team-registrations/logos/bdc1804c975eb1b6411cc8f99fa5aa54.jpg
49,G12 FC,https://api.1xcup.ng/storage/team-registrations/logos/f38bb2f56798c43adf0268044400cb15.png
50,Glorious FC,https://api.1xcup.ng/storage/team-registrations/logos/6f0c241b24f198bb8277d0294005279d.jpg
51,GOAL GETTERS FA,https://api.1xcup.ng/storage/team-registrations/logos/fcd17b47d32de0ad8fdf98c7fe253f5d.jpg
52,Goals Fc,https://api.1xcup.ng/storage/team-registrations/logos/108078e59536fe1ae9af88fbf793e4f0.jpg
53,Greenlock FC,https://api.1xcup.ng/storage/team-registrations/logos/1ba0ebcd2107c6f6775f2a08642e4a54.jpg
54,H2H sport int'l,https://api.1xcup.ng/storage/team-registrations/logos/e03e77462d8d405ae500e9875147125e.jpg
55,Ighalo FA,https://api.1xcup.ng/storage/team-registrations/logos/a20915bea69424d1618f1e702cd3d6dd.jpg
56,IKOSI FC,https://api.1xcup.ng/storage/team-registrations/logos/8c085e7cd68aaadab5cea66b4dc82ac4.png
57,Ikoyi Dolphin FC,https://api.1xcup.ng/storage/team-registrations/logos/7cb3decf956fd88dcb64f44d6744dd26.jpg
58,INSPIRE SA,https://api.1xcup.ng/storage/team-registrations/logos/1a0a10e6a960a854142916afc4bc61d6.jpg
59,Joy Cometh FC,https://api.1xcup.ng/storage/team-registrations/logos/89fff30ff165748ee3773f87650fdf33.jpg
60,JP YOUNG STARS FC,https://api.1xcup.ng/storage/team-registrations/logos/4ba5db7729eb051206df4607de9b1c8f.jpg
61,KIRAA FA,https://api.1xcup.ng/storage/team-registrations/logos/3580b0e57506c3c49f0b0fa543de597a.png
62,KOSAS PHANTOM FC,https://api.1xcup.ng/storage/team-registrations/logos/fe3f4548221447c33bfc11980b549729.jpg
63,Lagos Titan FC,https://api.1xcup.ng/storage/team-registrations/logos/5ef36e09501bc099804311d7e621f947.png
64,Legacy340 SA,https://api.1xcup.ng/storage/team-registrations/logos/ac23a8217984ebf0c76160bd72ded01f.png
65,Lof united fc,https://api.1xcup.ng/storage/team-registrations/logos/a965fb82f165374c0d967185a8166b43.jpg
66,Luther Inter FC,https://api.1xcup.ng/storage/team-registrations/logos/10985ffd10e319aad4fffc1c3912a2d3.jpg
67,Maryland United FC,https://api.1xcup.ng/storage/team-registrations/logos/7221117b36f6387479553d279bdcef48.jpg
68,MEGA 22 FC,https://api.1xcup.ng/storage/team-registrations/logos/70b3ef3ccca7e5daea2e363125f1879c.jpg
69,Mido Saka Football Academy,https://api.1xcup.ng/storage/team-registrations/logos/91fba8d971dcbe8fb58c4c8c3984e9e2.jpg
70,Newhope Naija FC,https://api.1xcup.ng/storage/team-registrations/logos/bc6eaa34d847097bc2fdd6b53cdbeefb.jpg
71,OOA FA,https://api.1xcup.ng/storage/team-registrations/logos/351c8350b62843ff8fa69c2bc5fdab13.jpg
72,OOIM FC,https://api.1xcup.ng/storage/team-registrations/logos/a79c0b1b6136b647fdc98ea028a52303.jpg
73,OWORO UNITED FC,https://api.1xcup.ng/storage/team-registrations/logos/cdb86cc6ef19d32d4c614b98e633db1d.jpg
74,Panthers FA,https://api.1xcup.ng/storage/team-registrations/logos/cf126495451babeddbe9cda6afa11f13.jpg
75,Peace Fc,https://api.1xcup.ng/storage/team-registrations/logos/617d59d088f1c1c426fee16d8378e2ed.jpg
76,POWER OF THE CROSS SPORT ACADEMY,https://api.1xcup.ng/storage/team-registrations/logos/42e0d128de6347824427fd8c14b72d4f.jpg
77,PRIME ELEVEN FA,https://api.1xcup.ng/storage/team-registrations/logos/ff8eb3b09649a6471bc5cc90222b9171.jpg
78,PRINCE KAZEEM ELETU FC,https://api.1xcup.ng/storage/team-registrations/logos/c7a5530d908373f2ed903f4f1aded40c.jpg
79,Roro House,https://api.1xcup.ng/storage/team-registrations/logos/ccbd3516dcc61ef5c805da55fbb2c52e.jpg
80,ROYAL PHARAOHS FC,https://api.1xcup.ng/storage/team-registrations/logos/16409bcf19b7bccadc5dd14caee9fffe.png
81,Royalty Athletic FC,https://api.1xcup.ng/storage/team-registrations/logos/d7bc3f83a9917a2f7001bc47dbe2b4dc.png
82,SOCCER CARDINALS F.C,https://api.1xcup.ng/storage/team-registrations/logos/74b806a82abae475f201020189367a41.jpg
83,Somolu Bariga LFC Ramba Samba,https://api.1xcup.ng/storage/team-registrations/logos/b257974189950854b69344bc4f4eab28.jpg
84,STAR TO BE  ACADEMY,https://api.1xcup.ng/storage/team-registrations/logos/b9f7b6a1228e51615a3dd52132651d8f.jpg
85,SYNERGY ULTIMATE SC,https://api.1xcup.ng/storage/team-registrations/logos/e89a6cd8003e7717bee9437ca9340cc4.jpg
86,Team360 FC,https://api.1xcup.ng/storage/team-registrations/logos/73ba045efcabbb4570b8cfa0d382debf.png
87,THE PRO SELECT FC,https://api.1xcup.ng/storage/team-registrations/logos/1f3e2c0f848fb39b8b33fbfc85fe2ef9.jpg
88,Tonic FC,https://api.1xcup.ng/storage/team-registrations/logos/0a3294904c729fdce3777ea03025e80a.jpg
89,TURF SEASON TIGERS FC,https://api.1xcup.ng/storage/team-registrations/logos/d74160e461daf8da23d7e46eb4493f49.jpg
90,Unizee,https://api.1xcup.ng/storage/team-registrations/logos/a3e87b3f9af72332079a663d33133dca.jpg
91,UTMOST FC,https://api.1xcup.ng/storage/team-registrations/logos/403c983232114446023b6a41d4a1d441.jpg
92,Vido 99 fc,https://api.1xcup.ng/storage/team-registrations/logos/5fc9673bf8492e770c63259833caef11.jpg
93,VINMO ENERGY FC,https://api.1xcup.ng/storage/team-registrations/logos/e9a7b6c7cc01683e61ac0c361a730925.jpg
94,Vino Gano,https://api.1xcup.ng/storage/team-registrations/logos/68ddee24d58e44605c2bc18af4a2742d.png
95,Vinod FA,https://api.1xcup.ng/storage/team-registrations/logos/af6c04c3225937b26497187de15a4dc9.jpg
96,WASOLA VEN. FC,https://api.1xcup.ng/storage/team-registrations/logos/ac455379e46e6d110439afed185c794c.jpg
97,Willyjoe-17 FA,https://api.1xcup.ng/storage/team-registrations/logos/9f84eade8ea879ac16965bbf2758b468.jpg
98,Young Pro FA,https://api.1xcup.ng/storage/team-registrations/logos/b0c803a87d1278d5a31148adac531242.png
99,YOUNG STRIKERS FC,https://api.1xcup.ng/storage/team-registrations/logos/ccfb3f756c99c41c472d5a3fa19faa1e.jpg
100,ZENITH EMPEROR FOOTBALL CLUB,https://api.1xcup.ng/storage/team-registrations/logos/117c23f08dda75763934a10695f24299.jpg`;

const FIRST_ROUND_FIXTURES_CSV = String.raw`code,zone,date,time,venue,home,away
M1,Ikeja Zone,2026-07-23,11:00,Inspire Field,INSPIRE SA,DA FARIA SC
M2,Ikeja Zone,2026-07-23,12:15,Inspire Field,TURF SEASON TIGERS FC,OWORO UNITED FC
M3,Ikeja Zone,2026-07-23,1:30,Inspire Field,DOSU JOSEPH FC,IKOSI FC
M4,Ikeja Zone,2026-07-23,2:45,Inspire Field,SYNERGY ULTIMATE SC,CRUSADERS FC
M5,Lagos Island Zone,2026-07-24,11:00,Inspire Field,FC BETHEL SPORTING,DREAMERS FC
M6,Lagos Island Zone,2026-07-24,12:15,Inspire Field,COLLINS EDWIN SC,PRINCE KAZEEM ELETU FC
M7,Lagos Island Zone,2026-07-24,1:30,Inspire Field,36 LION FC,FC MIDDLEWELL
M8,Lagos Island Zone,2026-07-24,2:45,Inspire Field,G12 FC,GOAL GETTERS FA
M9,Ikorodu Zone,2026-07-25,11:00,Inspire Field,BRIGHTON FA,UTMOST FC
M10,Ikorodu Zone,2026-07-25,12:15,Inspire Field,BUQUENSON FA,AMA SMILE FC
M11,Ikorodu Zone,2026-07-25,1:30,Inspire Field,BELIEVE FA,ADHOC FA
M12,Ikorodu Zone,2026-07-25,2:45,Inspire Field,ARUBINJAGA FA,KIRAA FA
M13,Badagry Zone,2026-07-30,11:00,Inspire Field,VINMO ENERGY FC,BUDU ELITES FA
M14,Badagry Zone,2026-07-30,12:15,Inspire Field,AJUWA FA,KOSAS PHANTOM FC
M15,Badagry Zone,2026-07-30,1:30,Inspire Field,Ecas FA,Bilda FA
M16,Badagry Zone,2026-07-30,2:45,Inspire Field,Greenlock FC,Dominion excellent star FA
M17,Epe Zone,2026-07-31,11:00,Inspire Field,Ighalo FA,Panthers FA
M18,Epe Zone,2026-07-31,12:15,Inspire Field,THE PRO SELECT FC,ARICH FC
M19,Epe Zone,2026-07-31,1:30,Inspire Field,Ikoyi Dolphin FC,OOA FA
M20,Epe Zone,2026-07-31,2:45,Inspire Field,Cliques SA,DAJA UNITED
M21,Ikeja Zone,2026-08-01,11:00,Inspire Field,Somolu Bariga LFC Ramba Samba,CITYFUT ESCOLA
M22,Ikeja Zone,2026-08-01,12:15,Inspire Field,Elite Stars FC,Lagos Titan FC
M23,Ikeja Zone,2026-08-01,1:30,Inspire Field,SOCCER CARDINALS F.C,Royalty Athletic FC
M24,Ikeja Zone,2026-08-01,2:45,Inspire Field,DYNAMIC FC,Vinod FA
M25,Lagos Island Zone,2026-08-06,11:00,Inspire Field,Emiloju FC,Evolution United
M26,Lagos Island Zone,2026-08-06,12:15,Inspire Field,Team360 FC,FRANCEEX UNITED
M27,Lagos Island Zone,2026-08-06,1:30,Inspire Field,WASOLA VEN. FC,Goals Fc
M28,Lagos Island Zone,2026-08-06,2:45,Inspire Field,Vido 99 fc,STAR TO BE  ACADEMY
M29,Ikorodu Zone,2026-08-07,11:00,Inspire Field,Eagle Star FC,COMFORTEDGE FC
M30,Ikorodu Zone,2026-08-07,12:15,Inspire Field,Joy Cometh FC,Unizee
M31,Ikorodu Zone,2026-08-07,1:30,Inspire Field,Edunz International fc,BETTER TOMORROW
M32,Ikorodu Zone,2026-08-07,2:45,Inspire Field,H2H sport int'l,BYT Academical FC
M33,Badagry Zone,2026-08-08,11:00,Inspire Field,Emaljus FC,Willyjoe-17 FA
M34,Badagry Zone,2026-08-08,12:15,Inspire Field,Young Pro FA,AUX FC
M35,Badagry Zone,2026-08-08,1:30,Inspire Field,Roro House,Legacy340 SA
M36,Badagry Zone,2026-08-08,2:45,Inspire Field,Glorious FC,JP YOUNG STARS FC
M37,Epe Zone,2026-08-13,11:00,Inspire Field,Dynamic Dreams FC,Luther Inter FC
M38,Epe Zone,2026-08-13,12:15,Inspire Field,DE POTTERS FA,Newhope Naija FC
M39,Ikeja Zone,2026-08-13,1:30,Inspire Field,CHINA SUNSTARS FC,Maryland United FC
M40,Ikeja Zone,2026-08-13,2:45,Inspire Field,AUSTENPLUS FOOTBALL CLUB,BARIGA STARS FC
M41,Ikeja Zone,2026-08-14,11:00,Inspire Field,Diadem Stallion Sports,ZENITH EMPEROR FOOTBALL CLUB
M42,Ikeja Zone,2026-08-14,12:15,Inspire Field,G Innovation FC,Crystal FC
M43,Lagos Island Zone,2026-08-14,1:30,Inspire Field,YOUNG STRIKERS FC,Peace Fc
M44,Lagos Island Zone,2026-08-14,2:45,Inspire Field,AFRICANO FC,Mido Saka Football Academy
M45,Lagos Island Zone,2026-08-15,11:00,Inspire Field,Dominion Hotspur FC,Lof united fc
M46,Lagos Island Zone,2026-08-15,12:15,Inspire Field,Divine Praise  FC,PRIME ELEVEN FA
M47,Ikorodu Zone,2026-08-15,1:30,Inspire Field,Tonic FC,Agbede Supreme FC
M48,Ikorodu Zone,2026-08-15,2:45,Inspire Field,OOIM FC,Vino Gano
M49,Badagry Zone,2026-08-20,11:00,Inspire Field,POWER OF THE CROSS SPORT ACADEMY,EDU YOUTH FC
M50,Badagry Zone,2026-08-20,12:15,Inspire Field,ROYAL PHARAOHS FC,MEGA 22 FC`;

const SQUADS: SquadSeed[] = [
  {
    teamName: "36 LION FC",
    players: parseSquad("Aliu Abdullahi (GK), Auwal Mohammed (MF), Ayomide Fadare (DF), Azuka Alatan (DF), Camara Cherif (DF), Chibueze Kingsley (FW), Chinonso Umenozie (DF), Collins Kadiri (FW), Isah Mohammed (FW), Joel Anthony (MF), John Onyema (MF), Joshua Eze (DF), Lekan James (MF), Michael Hunsa (FW), Okiemute Adagharagba (FW), Opeyemi Ogunlade (MF), Ridwan Aremu (MF), Samuel Stephen (DF), Sarr Aboubacar (MF), Seun Lawal (FW), Seyon Isiaka (GK), Sopuruchi Ekuma (DF), Soumah Mohamed (DF), Sunkanmi Daramola (DF), Uche Emeribe (FW)"),
  },
  {
    teamName: "ADHOC FA",
    players: parseSquad("Abiodun Daniel (MF), Adelowo Qudus (MF), Adetunji Taofeek (FW), Akachukwu Chuka (DF), Akanji Sunday (MF), Amos Paul (MF), Eze Chinaza (DF), Golden James (MF), Happiness Oyong (DF), Igere Goodluck (FW), Ike Franklin (MF), Muritala Faruk (DF), Nwachukwu Ebube (DF), Ode Friday (GK), Ojo Ayomide (GK), Ojo Damilola (FW), Olafimihan Gbemileke (FW), Olajire Sodiq (FW), Olanrewaju Habeeb (MF), Omang Emmanuel (FW), Omoniyi Bidemi (MF), Simeon Chidi (MF), Umendu Martins (FW)"),
  },
  {
    teamName: "AFRICANO FC",
    players: parseSquad("Adekunle Adetomiwa Elijah (FW), Adeniji Moses Opeyemi (FW), Adeniyi Ismail (MF), Afolayan Taiye Abubakar (GK), Agoro Abdulbasit (DF), Ajayi Ayomide Ezekiel (DF), Ajayi Damilare Emmanuel (DF), Azeez Qudus (MF), Bakare Jamiu Ayomide (MF), Bakare Kabir Oriyomi (MF), Berkley Wellington Oluwaseyi (MF), Gbadebo Taiwo Afeez (GK), Hassan Adam Abolore (DF), Hassan Basit Adedapo (MF), Iwuajoku Wisdom Morris (FW), Iyaomiye Festus Ololajulo (FW), Lawal Muiz (FW), Odeniran Okikiola James (FW), Oduala Sultan Omotolani (MF), Ogunji Gabriel Ifeoluwa (MF), Olajobi Mustapha Omojuowolo (DF), Olubi Elijah Opeyemi (FW), Omole Samson Erioluwa (DF), Onyeka Daniel Akwolu (FW), Owolabi Abdulateef Olanrewaju (MF)"),
  },
  {
    teamName: "AGBEDE SUPREME FC",
    players: parseSquad("Abolaji Adetomiwa (GK), Adebowale Moshood Ayobami (FW), Adedeji Adejuwon (FW), Adetokunbo Adewale (GK), Adeyonu Adekunle (FW), Alao Toheeb Oluwadamilare (DF), Andrew Emmanuel Ayoola (FW), Ayoola Rasheed Oluwadamilare (FW), Charles Ifeakachukwu David (FW), Daniel David Obichi (FW), Hammed Ogunkoya (DF), Idowu Kehinde Waris (MF), Nofiu Abdulgafar Ayomide (MF), Ogundayomi Olanrewaju (DF), Olabamiji Hassan Oluwadamilare (DF), Olaide Olajide (MF), Onisuru Stephen (DF), Richard Emmanuel Temitope (DF), Shittu Shuaib (MF), Solate Simeon Oluwakayode (FW)"),
  },
  {
    teamName: "AJUWA FA",
    players: parseSquad("Abubakar Abduliahi (FW), Adindu Kingsley (FW), Akeem Agbaje (DF), Akor Stephen (DF), Amana Peters (GK), Austin Friday (FW), Benjamin Aga (MF), Bethel Isreal (MF), Daniel Kingsley (MF), Ebuka Okorie (DF), Eweka Sylvester (MF), Favour Nnanna (FW), Medi Phillip (GK), Mohammed Idris (FW), Monday Adeoye (FW), Odili Ebuka (GK), Okoroji Livingfaith (MF), Onyebuchi Nwabueze (MF), Otto Paul (MF), Phillip Enoch (DF), Raphael Orie (DF), Taiye Ekisanya (DF), Tare Emmanuel (MF), Tochukwu Isiagu (DF), Utibe Michael (DF)"),
  },
  {
    teamName: "AMA SMILE FC",
    players: parseSquad("Abdulsalam Idirs Oluwatosin (MF), Adeleye Emmanuel Odunayo (FW), Ajibola Damilare Amazing (DF), Alagbala Quam Adeda (FW), Babatunde Rasak Abdul Hakeem (DF), Daniel Oriade (GK), Gabriel Ajao (GK), Jeremiah Ajibade Mayowa (MF), Negedu Pater (MF), Obaro Victor (FW), Obasi Nnamdi Daniel (FW), Odunayo Hafiz Olawale (DF), Ojara Adewale (MF), Ojikutu Samod Oladayo (MF), Olusola Tope Emmanuel (FW), Owoseni Micheal Oluwaseun (FW), Oyebo Rossi Friday (DF), Samuel Eyitayo Usman (DF), Sulaiman Olasunkanmi John (FW), Tabiti Elisha Adebowale (MF), Tajudeen Azeez Olatunji (FW), Tasiti Elijah Adeniran (MF), Waris Kareem (FW)"),
  },
  {
    teamName: "ARICH FC",
    players: parseSquad("Abiola Oshogbade (DF), Agbaje Damilare (MF), Alaba Olatunji (FW), Arogundade Hammed (FW), Ayodele Abiola (MF), Ayomide Dada (FW), Basit Titiloye (FW), Bolu Oluwo (FW), Daniel Ubirih (DF), Ezekiel Felix (MF), Fuhad Onikosi (FW), Godwin Jacob (DF), Idris Ogunowo (DF), Kehinde Owolabi (FW), Lukman Sulaimon (GK), Muhammed Sarafa (DF), Okikiola Allison (MF), Olatunji Mathew (FW), Paul Abah (MF), Quadri Azeez (MF), Samuel Christian (DF), Semiu Ibrahim (DF), Solomon Daniel (FW), Udoh David (MF)"),
  },
  {
    teamName: "ARUBINJAGA FA",
    players: parseSquad("Adedeji Bolaji Paul (MF), Adeniji Kehinde (DF), Agbobiado Dare Olamilekan (FW), Ajayi Wasiu (FW), Ajisefinni Victor (MF), Alaka Tayo (MF), Amoo Oluwapelumi (FW), Babalola Ayomiposi (DF), Famakinwa Oluwafemi David (MF), Ganiu Abdullahi (DF), Idris Aremu Azeez (MF), Ikpen Lucky (DF), Irabor Joseph (FW), Leke-Akindele Abdulfathi (DF), Moses James (FW), Moses Victor (FW), Obilonu Chibueze (FW), Olagunju Adeboye Emmanuel (GK), Oluwatoyin Olakunle (GK), Omosanya Habeeb Adeyemi (DF), Rafai Abeeb (DF), Rasheed Oluwatobi (DF), Samson Idowu Fashugbe (FW), Shokunbi Ibrahim (FW), Tajudeen Taiwo (DF)"),
  },
  {
    teamName: "AUSTENPLUS FOOTBALL CLUB",
    players: parseSquad("Aaron Innocent (MF), Abdulwaheed Abubakar (FW), Adam Balarabe Musa (MF), Adewale Sunday Aduragbemi (MF), Akanbi Abdulateef Ayomide (GK), Amata Samuel (MF), Ameh Sunday Ejembi (FW), Anayo-Israel Akachukwu David (DF), Anyanwu Nkemjika (FW), Ayorinde Tope (DF), Chieme Bright (DF), Ebuka Daniel (FW), Godswill Esumike (FW), Kingsley Ema (FW), Luqman Teslim (GK), Michael Taiwo (DF), Ndubueze Kelechi Christopher (FW), Obi Jachimike Oscar (DF), Ojelabi Abolaji Oyewole (MF), Okorie Richard Ododo (MF), Omeje Wisdom Chisom (FW), Omolade Ayomikun (FW), Osuji Kingsley Nmesoma (FW), Soliu Jamiu Adisa (FW), Stanley Osariemen (DF)"),
  },
  {
    teamName: "AUX FC",
    players: parseSquad("Agboh Micheal Agboh (DF), Agboye Sunday Jeremiah (DF), Akinola Abayomi (MF), Ayuba Abeeb Oladimeji (MF), Babatunde Ridwan (FW), Duru Osita Richard (FW), Femi Samuel Ifedayo (DF), Idase Melody (FW), Izuchukwu Igbokwe (DF), Jones Ikpeme (MF), Kamorudeen Afeez (MF), Miracle Chinagorom (FW), Moro Zechariah Daubotei (GK), Moses Ganvo (MF), Ngboli Shedrack (DF), Olamide Quadri Ogunnubi (DF), Omobolanle Omobolaji (DF), Onu Chukwuemeka (FW), Samuel Kayode Olumiyiwa (FW), Shehu Quadri (FW), Stephen Godwin (FW), Uche Azubuike (MF), Ugoji Chibueze (MF), Victor Abayomi (DF), Winjobi Gbolahan (FW)"),
  },
  {
    teamName: "BARIGA STARS FC",
    players: parseSquad("Abdulqudir Sheu Odolly (GK), Adebayo Damilola (MF), Adesanya Owodunni Oluwaseun (DF), Akinola Labi (GK), Anthony Prince (DF), Bidemi Fawehinmi (DF), Dauda Qudus Opeyemi (DF), Elujoba Quazeem Akorede (MF), Fadoyin Waris (MF), Kareem Korede Abdulraheem (DF), Luka Samuel (MF), Makinde Stephen (DF), Nduka David Chinedu (FW), Oluseye Babajide Timileyin (FW), Oluwole Anuoluwapo Idowu (MF), Pelumi Yusuff Olashile (MF), Samson Babatunde Oladejo (FW), Samuel Onyenagubo Ebuka (MF), Shobakin Sodiq (MF), Sukanmi Oladega Bakare (DF), Ugbe John Akpungabeye (MF), Victor Chibuike (DF)"),
  },
  {
    teamName: "BELIEVE FA",
    players: parseSquad("Abdulrasheed Habeeb (DF), Adewale Timileyin (FW), Akintobi Kinoshi (DF), Akinyele Sunday (FW), Banjo Ayodeji (FW), Fajemilehin Michael (MF), Hassan Olawale (GK), Humphrey James (FW), Kalu Saviour (MF), Lawal Faruq (FW), Mustapha Omilabu (FW), Ogunkoya Seth (DF), Ojo Sunday (GK), Okeowo Olalekan (DF), Olaleye Gbolahan (DF), Olaniyi Michael (DF), Olayemi Feranmi (FW), Olowoigode Ridwan (DF), Omotosho Nifemi (FW), Rasak Abdullahi (DF), Razak Ayomide (DF), Saka Okiki (MF), Salami Idunnu (MF), Samuel Ellah (MF), Stephen Anochirim (FW)"),
  },
  {
    teamName: "BETTER TOMORROW",
    players: parseSquad("Adekola Rasheed (FW), Adesina Ogomide (MF), Adeyeye Samson (FW), Adeyinka Ahmed (DF), Akanbi Samuel (DF), Amototo Mubarak (DF), Ayoola Olamilekan (MF), Azeez Jamiu (MF), Chigozie Chukwkuemeka (DF), David Joshua (MF), Folorunsho Testimony (FW), Hassan Taiwo (FW), Ismail Ayomide (FW), Kasumu Ayomide (GK), Lawal Fawaz (MF), Olabiyi Temitope (FW), Olaoye David (DF), Olorunishola Samuel (FW), Oshogo Godswill (MF), Raji Afeez (DF), Salaudeen Shuaib (DF), Tiamiyu Ibrahim (GK), Usman Abiodun (DF)"),
  },
  {
    teamName: "BILDA FA",
    players: parseSquad("Acha Shedrack Eshidenang (FW), Adebimpe Hamed Majeyagbe (DF), Anas Marafa (MF), Augustine Chike Mbah (FW), Bende Christian (DF), Collins Uchenna Okereke (GK), Destiny Raphael (GK), George Precious Olamide (FW), Ilesanmi Joshua (DF), Ishola Kazeem Hammad (FW), Mark Kenneth (FW), Numan Mubarak Muhammed (MF), Ohaji Uzoma Osinachi (FW), Okechukwu Destined (FW), Otunuya Nduka Precious (DF), Owolabi Razak Olawale (DF), Sanusi Faruk Abiodun (MF), Solomon Goodluck Emmanuel (MF), Somtochukwu Charles (FW), Umeh Chibueze (DF)"),
  },
  {
    teamName: "BRIGHTON FA",
    players: parseSquad("Abu Yusuf Shinaayomi (DF), Adam Mohammed (MF), Adebayo Abdulkareem (DF), Agho Godspower (DF), Arewa Godwin (FW), Awa Anthony (FW), Destiny Paul (FW), Edoh Great (DF), Eno Daniel (DF), Eze Solomon Junior (MF), Igwe Amos (MF), Kehinde Ibrahim (MF), Lawal Basit (GK), Martins Idowu (FW), Mustapha Damilare (DF), Nortey Bruce (FW), Ogunfile Daniel (MF), Omeoga Darlington (DF), Onabajo Olashile (MF), Poni Israel (MF), Toheeb Ayoade (FW), Usman Musa (FW), Wisdom Ezekiel (GK)"),
  },
  {
    teamName: "BUDU ELITES FA",
    players: parseSquad("Abdulsalam Idris (FW), Adetona Hamidu (MF), Aina Oluwatobi Lawrence (DF), Alugo Sulaimon Oluwatobiloba (MF), Ayayi Taofik Olamilekan (MF), Ayeni Elijah Okikiola (FW), Balogun Fatiu (DF), Chukwusa Jeremiah Chukwudi (MF), David Timothy Olamilekan (DF), Ejimbe Chukwudubem Prosper (GK), Fasasi Sultan (GK), Isiaka Habeeb Korede (MF), Jinadu Wahab Adefeso (DF), Lawson Ayomide Macfish (MF), Ogundeko Bashiru (DF), Oke Peter Sewanu (DF), Olawale Olamilekan Wasiu (MF), Olushola Samson Ifeoluwa (GK), Quam Layeni Babatunde (FW), Roman Oluwatosin Fasasi (DF), Sanni Hameed Olajide (DF), Solomon Elijah Mauseveh (FW), Taiwo Victor Oluwatobi (GK), Usman Ibrahim Anas (MF), Wusu Oluwadamilola (FW)"),
  },
  {
    teamName: "BUQUENSON FA",
    players: parseSquad("Adedeji Julius Imole (DF), Adewumi Adeyemi Joshua (FW), Adeyemi Victor O (MF), Adeyemo Olawale Abdulwahab (MF), Ajibola Ibrahim Olumide (FW), Ambrose Gabriel (FW), Asuka Oluwaseyifunmi Opeyemi (MF), Azeez Faruq Abiola (FW), Balogun Olamilekan Azeez (FW), Efidi Lucas (MF), Etisi Richard (FW), Etisi Wisdom (FW), Harrison Simon Ebimiyewe (FW), Igwe Joshua Chidera (FW), Jeje Ayomiposi (DF), Job Miracle Ukahi (DF), Johnson Samuel Oluwafunmi (GK), Meleki Olukoya Oluseun (DF), Oladoyinbo Isreal Oluwatimilehin (MF), Raji Khalid Ayomide (FW), Salami Olanrewaju Ismail (MF), Shittu Lawal Abiodun (FW), Shokunbi Kayode Olamide (FW)"),
  },
  {
    teamName: "BYT ACADEMICAL FC",
    players: parseSquad("Abba Haruna (DF), Abdullahi Yahaya (MF), Ajuwon Abideen (FW), Daniel Kukingra (FW), Daramola Uthman (FW), Destiny Oodo (GK), Farouk Umar (MF), Favour Ibekwe (MF), Idris Iliyasu (FW), Iniobong Micheal (DF), Mutiu Ajibowo (FW), Nazir Nazifi (DF), Ogechukwu Emeka Godswill (FW), Opeyemi Lawal (MF), Oyekanmi Timileyin (DF), Oyolola Afeez (MF), Promise Samuel Onuchukwu (FW), Rabiu Ibrahim (MF), Salisu Umar (GK), Samad Olakuleyin (DF), Shafiu Saliman (DF), Tijani Habeeb (FW), Wahab Sikiru (DF), Yahaya Iliyasu (MF), Yekeen Muideen (FW)"),
  },
  {
    teamName: "CHINA SUNSTARS FC",
    players: parseSquad("Adamu Shuaibu (MF), Azeez Raji (DF), Babaseidu Sale (MF), Bernard Promise (FW), Chukwuma Abi Henry (DF), Emmanuel Ekong (MF), Fode Traore (FW), Joshua Ubi (FW), Kareem Akeem (DF), Linus Echebiogo (FW), Martins Usani (MF), Olayinka Salahu Seun (FW), Paul Igwe (FW), Peter Eugene (FW), Precious Egwulemu (DF), Samson Gabriel (DF), Silas Odemero (GK), Soliu Lawani (MF), Taiwo Kamorrudeen (DF), Victor Moradeyo (FW)"),
  },
  {
    teamName: "CITYFUT ESCOLA",
    players: parseSquad("Abo Kehinde Oriyomi (GK), Adeniyi Olorunwa Abdullahi (FW), Akinbode Ifeoluwa John (MF), Awonubi Joseph Oreoluwa (MF), Baidoo Joe Timilehin (DF), Bello Ahmed Omotayo (DF), Emmanuel Chidera Favour (FW), Enijuni David (MF), Hamzat Hassan Okikiola (FW), Hassan Azeez Gbolahan (MF), Kareem Akeem Gbade (DF), Lucky Aiyese Oluwole (FW), Morrisson Ifiok Emmanuel (FW), Muhammed Yusuf Isah (DF), Ogbaja Isaac Peter (FW), Olaleye Ali Akeem (FW), Omokeraro Caleb (FW), Onwuzama Emmanuel Akachi (GK), Samuel Ayobami Ojo (MF), Samuel Joshua Asuquo (DF), Tajudeen Opeyemi (MF), Yisa Sikiru Oke (FW)"),
  },
  {
    teamName: "CLIQUES SA",
    players: parseSquad("Adukwu Micheal (DF), Akeem Taiwo (DF), Akpan Patrick (MF), Anyawun Favour (DF), Ashafa Ahmed (DF), Atale Godwin (FW), Atoyebi Olamide (FW), Ayomide Joshua (MF), Ayuba Joshua (MF), Chukwu Micheal (DF), David Shedrack (DF), Houenongbe Francis (GK), Isa Gambo (FW), Kosamotu Abdullahi (DF), Ojuloge Ayinde (MF), Olawoye Demi (FW), Olawuyi Pelumi (DF), Olayinka Tobi (FW), Polmi Yahaya (MF), Randy Mensha (FW), Rangyo Peter (MF), Ridwan Akande (DF), Salahudeen Waliu Alani (GK), Ubong Ntia (FW), Yusuf Rendy (FW)"),
  },
  {
    teamName: "COLLINS EDWIN SC",
    players: parseSquad("Adamu Yahaya Chukwuebuka (MF), Adedayo Ibrahim (MF), Amoo Idris Olasunkanmi (DF), Chidera Maduka (GK), Edeh Kelechukwu (MF), Ejiofor Morgan (DF), Etini Idorenyin (DF), Francis Onyeka (FW), Lamidi Olaitan (FW), Obaji Prosper (DF), Obiajulu Benedict (GK), Obiora Sunny (FW), Odita Bright (MF), Olaitan Samuel (FW), Olamide Fasanya (DF), Omosebi Damilare (MF), Philip Samuel (MF), Quadri Kehinde (DF), Stanley Chima (FW), Tobias Chinonso (MF), Unite Amodu (FW), Vincent Campus (FW)"),
  },
  {
    teamName: "COMFORTEDGE FC",
    players: parseSquad("Abdulfatai Bolaji Saheed (GK), Adeleke Basit Olamilekan (FW), Agbo Pius Chibueze (DF), Alaga Kehinde Oluwadamilare (DF), Amodu Nurudeen Omotayo (DF), Aniolu Kenneth Nduka (DF), Azeez Toheeb Opeyemi (FW), Balogun Sunday Olamilekan (DF), Christian Imeh (MF), Emmanuel Neyo Christian (FW), Gbolade Remilekun Okikiola (DF), Inegbenijesu Joshua (FW), Junaid Emmanuel Oluwatobi (FW), Lawanson Olakitan Esho (MF), Oluwa Damola Oloyede (FW), Oluwa Kazeem Oyewunmi (DF), Sunday Micheal Olamilekan (MF), Tijani Taiwo Olatunde (DF), Ugoh Emmanuel (MF), Uzor Emeka Oluwaseun (GK)"),
  },
  {
    teamName: "CRUSADERS FC",
    players: parseSquad("Ajiduah Chukwuemeka John (FW), Craig Samuel Adeniji (GK), Dorishamu Kolade (DF), Duke Augustine (DF), Ebirien Ijonama (MF), Emmanuel Akinnagbe (FW), Gabriel Jacob (DF), Ilesanmi Samuel (MF), Itung Emmanuel Jacob (MF), Kazeem Ibrahim (GK), Kingsley Edet (FW), Michale Uwaifo (DF), Nnagbo Onyekachi Emmanuel Jerry (MF), Nwachukwu Victory Ebuka (FW), Nwanze Stanley (DF), Obaji Sunday (MF), Ogbu Victor Nnamdi (FW), Ogunlade Olawale (MF), Oluwasegun David (DF), Precious Chimdy Tata (MF), Taiwo Ayodeji Oluwasegun (MF), Tyokosu Reuben (FW), Victor Obinna Udeh (DF)"),
  },
  {
    teamName: "CRYSTAL FC",
    players: parseSquad("Asadu Uche Daniel (DF), Attah Pius (DF), Awoniyi Fuad (FW), Benjamin James Olarenwaju (MF), Bright David (MF), Durosom Abdulahi (FW), Eze Chuwkuma Prosper (DF), Idris Illiyas (DF), Joseph Ime Effiong (FW), Nwaigwe Favour (FW), Obumneme Franklin (MF), Ogunleye Adetoro (FW), Ojo Oluwatosin (MF), Olabisi Julius (GK), Onasanya Sodiq (DF), Oshikoya Adura (FW), Otuole Chukwuka (MF), Otuole Ifeanyi (MF), Pascal Gadjigbe (DF), Rilwan Bolaji (FW), Salaudeen Quadri (DF), Udoh Samuel (FW)"),
  },
  {
    teamName: "DA FARIA SC",
    players: parseSquad("Abdulazeez Sodiq (DF), Adebisi Kolawole (DF), Adu Samuel Temidayo (MF), Agboowuro Oluwatobi Daniel (DF), Ajisefinni Okikiola (DF), Akpan Samson Etim (FW), Anuoluwapo Kayode Yusuf (FW), Arulogun Oluwafemi (DF), Ayeni Temitope (DF), Ayodele Philemon Yinka (FW), George Victor (DF), Ibrahim Musa Favour (MF), Jamiu Bakare (MF), Lawal Hammed Adeyemi (DF), Nwaokolo Chiedu Anthony (MF), Ogunfolubi Taiwo Rahmon (MF), Ogunshola Adura (DF), Olanire Samuel Ayobami (GK), Oluwafemi Oluwatosin (GK), Oluwatosin Soderu (DF), Oyelakin Rasheed Gbemisola (MF), Samuel Ayobami Isreal (FW), Sikiru Sodiq (DF), Sopeju Abiodun Idris (FW), Yusuf Gbenga Raphael (MF)"),
  },
  {
    teamName: "DAJA UNITED",
    players: parseSquad("Adebayo Lateef Abiodun (FW), Agbon Victor (GK), Anyanwua Saater Enoch (DF), Boufini Rex (MF), Chime Ugochukwu (DF), David Lawrence Okolo (FW), Evans Iniobong Richard (MF), Fred Edet Asuquo (FW), Gideon Okon (DF), Godwin Samuel Niniola (MF), Ikejiaku Grant Mmerisinachi (DF), John Kelechi JohnDavid (FW), John Mark Ifeanyi (DF), Lawal Olamilekan (DF), Nwachukwu Chidera Victor (DF), Nwambueva William (FW), Nwaobodo Chimerie (MF), Ogbuka Chinaza (MF), Olanrewaju Faruk (FW), Omogbolahun Daniel (DF), Udemba Peter Chisom (DF), Uwem Sunday Edem (MF)"),
  },
  {
    teamName: "DE POTTERS FA",
    players: parseSquad("Adenola Sikiru (DF), Aigbe Fortune (FW), Aliu Yekini (MF), Ayanbukola Johnson (MF), Azeez Muiz (DF), Bello Olatunji (MF), Busari Ridwan (DF), Ezike Casmir (FW), Felix Adejuwon (FW), Hammed Ayokunle (MF), Hassan Muiz (FW), Hassan Rasak (DF), Jogbo Abideen (DF), Jonah Solomon (GK), Kareem Johnson (FW), Lawal Lookman (DF), Oduleye Odutola (DF), Ogunbajo Ayomide (FW), Ogundimu Jamiu (FW), Okeleji Rasak (MF), Oshineye Gbolade (FW)"),
  },
  {
    teamName: "DIADEM STALLION SPORTS",
    players: parseSquad("Abubakar Mikail (MF), Adebayo Abraham Godpowers (FW), Adebayo Samson Imoleayo (DF), Adeniyi Anthony Daniel (FW), Aderibigbe Dolapo Adebayo (MF), Afolabi Ayomide Daniel (MF), Akindele Yusuf Oriyomi (FW), Apolola Olawale Ayomide (FW), Arinze Christian Nwuozor (DF), Badru Shakiru Oluwaseun (DF), Bankole Jamiu Olamide (FW), Bello Olamilekan Abdulmuhee (DF), Buko Ayomitide (DF), John Francis (FW), Mustapha Fatai (MF), Ndubuisi Emmanuel (MF), Nelson Elvis Osaretin (FW), Ogunleye Gabriel Oluwaseun (FW), Olushina Oluwoye (GK), Onikoyi Ridwan (FW), Oyebanji Al Amin Ademola (FW), Raheem Abdulsalam Aremu (DF), Rufai Azeez Oluwadamilare (DF), Shomade Sodiq Oluwasegun (MF), Tayese Abiodun Emmanuel (GK)"),
  },
  {
    teamName: "DIVINE PRAISE FC",
    players: parseSquad("Adedoyin Adelani (DF), Ani Makuochukwu (DF), Arinze Godwin (FW), Chineke Cheta (MF), Ebere Francis (FW), Ejioffor Chidera (FW), Ejioke Makuochukwu (DF), Enoch Kingsley (FW), Honest Motulani (GK), Igwe Chimezie (DF), Izuchukwu Ezenobi (FW), John Kennedy Oscar (FW), Nonso Anna (DF), Offor Victor (FW), Okechukwu Paul (FW), Okereke Uzochukwu (MF), Okonne Nonso (DF), Okoro Okechukwu (MF), Onyele Somto (FW), Salami Ahmed (GK), Sunday Patrick (FW), Ukale Olatunji Ojo (FW), Yakubu Kevin (MF)"),
  },
  {
    teamName: "DOMINION EXCELLENT STAR FA",
    players: parseSquad("Akinseye Akinjuwon (FW), Ezenwa Godwin (DF), Ifeanyi Benedith (FW), Igwe Ejike (FW), Lawal Bolaji (FW), Mmuo Onyedikachi (MF), Muibi Rotimi (FW), Nwoke Eze (MF), Ofurum Kelechi (MF), Oghenekparobo Tejiri (DF), Okafor Ekene (DF), Okere Henry (FW), Okolie Stephen (DF), Okolo Victor (FW), Olabamiji Bukunmi (FW), Olalekan Dotun (DF), Olaleye Tunmise (DF), Onyemadi Stanley (DF), Onyeweke Frank (FW), Osisiogu Peres (MF), Roland Raphael (FW), Shedara Isaac (GK), Shuaib Rauf (FW), Tobby Daniels (FW), Ujah David (DF)"),
  },
  {
    teamName: "DOMINION HOTSPUR FC",
    players: parseSquad("Abdullahi Muhammad Kabir (GK), Adebowale Sodiq (MF), Adeleke Soliu Ademola (MF), Alabi Ademola (DF), Amadi Emmanuel Chijugba (FW), Ayodele Isaiah Imoleayo (FW), Babatunde Odukoya Ibarhim (DF), Chika Johnbull Odom (FW), Cyril Onobo (FW), Daniel Innocent Udoh (DF), Danjuma Lazarus (GK), Eden Daniel Obinna (FW), Elebohse Clancy (MF), Enweliku Chisom Destiny (DF), Ihitegbulem Chinonso Wisdom (FW), Lateef Idris Daniel (DF), Okon Daniel (DF), Okoronkwo Uche (MF), Okoya Yahya (MF), Olorunimbe Basit (DF), Onyenoforo Chisom (FW), Robertson Kingsman Ogheneovo (DF), Robinson Ibuchim Solomon (DF), Saheed Mumuni (MF), Stephen Uzochukwu Uche (GK)"),
  },
  {
    teamName: "DOSU JOSEPH FC",
    players: parseSquad("Abdulazeez Abdulhameed (GK), Abdulazeez Toheeb Omotayo (GK), Adekanbi Taiwo Habeeb (DF), Adeosun Femi (MF), Adewusi Habeeb (FW), Admar Sanni (MF), Akindele Ayatu (FW), Aremu Ridwan (MF), Busari Abeeb (MF), Ebiewe Israel (MF), Enabodje Jackson Wisdom (GK), Ezugwu Emmanuel (MF), Gbadegwshin Afeez Oluwatobi (FW), Godwin Michael (FW), Ibrahim Muhammad (MF), Idowu Sheriff Opeyemi (DF), Inya Kelechi (FW), Lucky Reuben (MF), Olaniyi Hassan (FW), Oloche Sunday (FW), Olowu Seun Precious (DF), Osigwe Bright (DF), Osuji Pascal (FW), Segun William (MF), Sodubi Oluwafemi Morakinyo (DF)"),
  },
  {
    teamName: "DREAMERS FC",
    players: parseSquad("Ambrose Robert (DF), Bamigbose Oluwasegun (MF), Chukwuemelie Marvellous (FW), Ejeh Matthew Echeofuni (DF), Eji Paul (FW), Enemona Paul Jonathan (FW), Enyabine Chukwuka Michael (DF), Godfrey Chinyeaka Okene (DF), Godswill Victor Isaac (FW), Imeh Usen Archibong (MF), Isaac Monday Essien (FW), Kelvin Iyere (FW), Kingsley Francis Anuruegbe (MF), Kum Joseph (FW), Moses Usen Kingsley (MF), Olawale Hammed Akorede (FW), Oniyide Kazeem Korede (DF), Onyedikachi Solomon Norbert (DF), Paul Terkaa Igbakua (GK), Ravo Reuben (MF), Samuel Olabisi Oyewumi (MF)"),
  },
  {
    teamName: "DYNAMIC DREAMS FC",
    players: parseSquad("Adebayo Babatunde Taofeek (FW), Adegoke Kazeem Olawale (FW), Adeleke Sunday Isaiah (FW), Adewuyi Anuoluwapo (GK), Amiekhame Abibu (MF), Chris Ijoko Okpeje (DF), Christopher David (GK), Chukwuemeka Ezeike Philip (FW), Dada Kayode James (DF), Emmanuel Adebayo Afolayan (DF), Esejindu David Chukwuma (MF), Francis Joe Emmanuel (MF), Ifeanyi Henry Abara (FW), Joshua Opeyemi Ojo (MF), Nwachukwu Michael Favour (DF), Okebugwu Henry Chimauchem (MF), Olufowobi Abel Oluwafemi (DF), Oluwatobi Ezekiel (MF), Paraiso Seun Wasiu (FW), Saliu Dayo Mubarak (FW), Uchechukwu Nweke (MF), Ukachukwu Elisha Chibudike (FW), Victor Joseph John (GK), Wasiu Mufutau Owolabi (FW)"),
  },
  {
    teamName: "DYNAMIC FC",
    players: parseSquad("Abdulfatai Lukman Adewale (DF), Afolabi Ridwan (MF), Agboola Sodiq (FW), Akinwale Samuel (FW), Alo Ayodeji Oluwafemi (FW), Alonge Ayolekan (MF), Bankole Sunday (FW), Jimoh Kazeem (GK), Lawal Bakky Damilola (DF), Moses Oluwatobiloba Timileyin (FW), Okanlomo Habeeb (DF), Okunade Sodiq Adewale (DF), Olakunle Abdulrazaq Salau (FW), Olatunji Waheed Oladipupo (MF), Olayode Oluwadamilare Pelumi (DF), Oludipe Olakunle Wasiu (MF), Oluwaseyi Dimeji Wasiu (DF), Omopekun Samuel Olatunde (DF), Shodimu Abraham (MF), Shokunbi Samuel (FW), Taiwo Michael (GK), Yaqub Muhammad (MF)"),
  },
  {
    teamName: "EAGLE STAR FC",
    players: parseSquad("Ademola Paul Kante (DF), Aderibigbe Nuren Oluwamuyiwa (MF), Afolayan Oluwaseun Joel (FW), Ameh Isaac Akolawole (GK), Bankole James Adebowale (FW), Bashorun Fuhad Dolapo (DF), Favour Eleba Chuku (DF), Hafeez Hammed Ola (FW), Ime Jackson Obuku (FW), Isaiah Olawale (FW), Korie Kelechi Christopher (FW), Mathias Alubarika Ogunderu (DF), Ogoji Babatunde Ibrahim (GK), Oladunjoye Omotola Rasheed (MF), Otega Joseph Prosper (DF), Otobong Emmanuel Akpan (DF), Shittu Ismail Olamilekan (DF), Sodiq Shittu Babatunde (FW), Udezi Samuel (FW), Ugoyah Richard (MF)"),
  },
  {
    teamName: "ECAS FA",
    players: parseSquad("Abayo Femi (DF), Abdullahi Muhammad (MF), Abubakar Abubakar (GK), Ayetoba Iseoluwa Abayomi (GK), Bethel Simon (MF), Chris Charles Ubong (MF), Chukwuemeka Sunday (FW), David David (DF), Habeeb Olokotintin (DF), Henry Ikenna (FW), Japhet Japhet (FW), Moronfoye Femi Samuel (DF), Muhammad Nasir Jibril (DF), Nnamdi Austin (MF), Nnoju Favour (DF), Nweke Tony (MF), Okpeyemi David (GK), Ozegbe Victor (DF), Sani Abdulazeez (FW), Simon Egwuda (DF), Suleiman Adamu (FW), Sunday Onah Godwin (MF), Udeme Sunday (FW), Ukpe Chukwudi (FW), Umar Ahmed (DF)"),
  },
  {
    teamName: "EDU YOUTH FC",
    players: parseSquad("Aese Jeremiah (FW), Ajayi Oluwaseyi (FW), Akhadelor Richard (FW), Animashaun Hameed (DF), Awhawha Andrew (MF), Ayodeji Ajayi (GK), Egbi Joshua (MF), Emmanuel Ojoto (DF), Eze Prosper (FW), Hezekiah Oriola (FW), Ijomah Praise (DF), Jimoh Sodiq (DF), Kelani Shafiu (DF), Moshood Ibrahim (FW), Muraina Sodiq (DF), Ogide Daniel (MF), Ogundeji Tony (MF), Ojukwu Emeka (FW), Olaifa Idris (DF), Oloke Emmanuel (DF), Olutaya Opeyemi (DF), Onyems Goodluck (MF), Soliu Ajibola (GK)"),
  },
  {
    teamName: "EDUNZ INTERNATIONAL FC",
    players: parseSquad("Abdul Rashid Olanrewaju (DF), Abdullateef Faheeizol (FW), Abdulquadri Hameed (FW), Adegbenro Abudullah (FW), Ademuwagun Micheal (DF), Augustine Davis (MF), Ayo Igbekele (DF), Ayomide Olumuyiwa (FW), Babalola Abraham (FW), Damilare Akinjide (MF), Dumoye Muhammad (FW), Emmanuel Peter (FW), Faruq Adeyemi (GK), Folorunsho Adedayo (GK), Lawal Azeem (FW), Muiz Oyebola (DF), Ogunleke Ayodeji (FW), Olikutunyi Gabriel (FW), Oluwatosin Ogunmodede (MF), Segun Isaac Peter (DF), Success Nmazi (DF), Sunday Maris (FW), Teslim Basit (MF), Tobi Oladejo (FW), Tosin Erinshakin (MF)"),
  },
  {
    teamName: "ELITE STARS FC",
    players: parseSquad("Abiola Adebayo (FW), Boluwatife Sogbesan (FW), Chinedu Emmanuel (GK), David Bassey (GK), Dolapo Adegunte (MF), Favour Izuchukwu (DF), Femi Sogunro (MF), Gabriel Oguntade (FW), Hafiz Odunayo (DF), John Bakare (MF), Joshua Animashaun (DF), Love Akinmoladun (FW), Olagoke Olanrewaju (MF), Olasunkanmi Quadri (FW), Oluwanifemi Oyenubi (MF), Samad Akinkunmi (MF), Sodiq Abiola (MF), Sunday Adekunle (DF), Taofeek Ogunyemi (FW), Temitope Adeniyi (MF), Toheeb Jolaosho (DF), Tokunbo Gbadamosi (DF)"),
  },
  {
    teamName: "EMALJUS FC",
    players: parseSquad("Abraham Jimesa John (FW), Adedayo Ridwan Gbolahun (MF), Awhana Silas (DF), Christian Chibizor (MF), David Oyedola (MF), Ehimhen Pascal (FW), Emmanuel Samuel Ekwe (DF), George Elisha Deco (MF), George Samuel (MF), Ikechukwu Godwin Samson (FW), Job Michael Ose (FW), Joel Kingsley Oluwatosin (DF), Kanu Ifeanyi (MF), Lawal Oluwaseyi Sufiyan (FW), Miracle James Benji (DF), Oguns Michael (DF), Olushola Tunde Samson (DF), Raji Habeeh Adetunji (DF), Tugbobo Saheed (GK), Uzochi Alex Kingsley (DF), Victor Ifeanyi Mbah (GK), Wasiu Yaya (FW)"),
  },
  {
    teamName: "EMILOJU FC",
    players: parseSquad("Abdulqadri Malik (FW), Abraham Bankole (FW), Adebayo Quadri (DF), Adefila Thomas (MF), Adewale Quadri Oluwatobiloba (FW), Adisa Olivier (GK), Aluko Segun (DF), Asiegbu Micheal (DF), Cosmas Chimezie (FW), Ebube Emmanuel (DF), Egwu Abel (FW), Greatness Benard (MF), Jeremiah Andong (FW), John Daniel (MF), Ogundeji Elijah (MF), Olayinka Olayemi (FW), Ololade Olarenwaju (DF), Oluwasanmi Oluwapelumi (MF), Richard Aninan (MF), Samuel Igwe (DF), Sikiru Ikolaba (MF), Timothy Bassey (FW), Uma Bartholomew (FW), Wisdom Chima (GK), Yusuf Asim (DF)"),
  },
  {
    teamName: "EVOLUTION UNITED",
    players: parseSquad("Abdulwaheed Mohammed Jamiu (FW), Adiele Ebuka Daniel (DF), Adoh Chuks Frank (MF), Ahmed Usman Tobilobac (GK), Aniebiet Francis (DF), Bature Olateju Ibrahim (FW), Chidozie Chima Moses (FW), Edwin Chidera Michael (DF), Ekenze Favor Obinna (FW), Emmanuel Christopher Kokoete (FW), Gbangban Daniel Amevi (DF), Idowu Babatunde Morakinyo (MF), Iyinbor David (DF), Jenas Sunday (FW), Jimoh Muideen Abefe (FW), Monday Olamiposi Monday (MF), Moses Israel (MF), Mubaraq Agboola (GK), Mubaraq Isiaka (FW), Mutolib Sodiq Aremu (MF), Olanrewaju Basit Olamilekan (DF), Olaopa Toheeb (FW), Shehu Suleman (FW), Solomon Tunde Femi (DF), Tajudeen Fawaz Olaitan (MF)"),
  },
  {
    teamName: "FC BETHEL SPORTING",
    players: parseSquad("Akpan Benedict (DF), Anu Akinsipe (MF), Ayinla Awal (FW), Chinemerem Augustine (GK), Ebuka Emmanuel (DF), Ebuka Emmanuel (MF), Ebunu Jonathan (DF), Eric Boma (DF), Farinde Oluwatobi (DF), Fawas Olaitan (FW), Godwin Chijoke (DF), Itanko Moses (FW), Joshua Okereke (MF), Lawrence Justice (MF), Mark Adoga (DF), Medumere Chukwuemeka (GK), Odo Chidera (FW), Ogunmola Samson (FW), Olamilekan Afolabi (FW), Solomon Etang (FW), Solomon Friday (MF), Tijani Ridwan (FW), Udo Sammy (FW), Waheed Jimoh (FW)"),
  },
  {
    teamName: "FC MIDDLEWELL",
    players: parseSquad("Abati Selim Oluwasegun (DF), Abdul Jelili Uthman Olanrewaju (MF), Abegunde Isreal Adepoju (DF), Adebayo Ridwanullahi Opeyemi (MF), Adesokan Muhammed Adewale (FW), Akingbala Usman (FW), Akintola Michael (GK), Akorede Abdulmuiz Adebayo (MF), Aromashodun Salaudeen (FW), Azeez Qowiyu Olasunkanmi (DF), Eno Odudu (FW), Eteng Mbabg Solomon (FW), Fatai Waris Ishola (DF), Isiaq Semiu (FW), Kayode Hassan (FW), Musa Ahmed Ayinde (FW), Ogunbowale Okiki Kanyinsola (MF), Ogunjobi Israel (MF), Olorunfemi Samuel Oluwaseyi (DF), Peter Boniface (GK), Raheem Manjeed Adeola (DF), Raimi Ibrahim Abiodun (DF), Saheed Afeez (DF), Sanni Quwam Olamilekan (MF), Sefiu Abdsomad Olamide (DF)"),
  },
  {
    teamName: "FRANCEEX UNITED",
    players: parseSquad("Akingbade Samson (GK), Annur Sa'adu (DF), Asogwa Chidi Valentine (DF), Azeez Abubabark Olashile (DF), Ebuka Innocent (DF), Francis Tochukwu Precious (FW), George Abbey Kuami (DF), Isa Kareem (MF), Iyama Joshua Ozioma (FW), John Chukwuebuka (FW), Kennedy Gabriel Imiefoh (FW), Mba Ndubisi Williams (FW), Njoku Chigozie (DF), Nkwocha Uche (DF), Nwaubah Daniel (GK), Ogbani Bernard Odey (MF), Oguekwe Stanley Kosiso (MF), Ogunrinde Oluwatobi (DF), Okafor Kizito (FW), Ononiwu John (MF), Saeed Buhari (MF), Sijuola Ibrahim Oladeji (MF), Sikiru Lawal Kayode (FW), Ukatue Bright (MF), Yusuf Azeez Metti (FW)"),
  },
  {
    teamName: "G INNOVATION FC",
    players: parseSquad("Adeshina Fuad (FW), Amadi Chukwuebuka (MF), Ani Patrick (FW), Chibueze Orizu (DF), Chijioke Okonkwo (GK), Daniel Oluwamo (DF), Ebitimi Minnah (MF), Emmanuel Dabo (FW), Genesis Onwuta (FW), Godstime (GK), Godstime Enya (FW), Goodnews Pipa (DF), Ismail Abdulreasheed (FW), Joshua Odeoyibo (DF), Melvin Ebitimi (DF), Nelson Sunday (MF), Nwachukwu Chika (DF), Osuji Candidus (MF), Osundu Temple (DF), Philip Okon (FW), Precious Chukwuemeka (MF), Roland Danlandi (DF), Silas Felix (DF), Sulaimon Basit (FW), Uchechukwu Enyabegwu (MF)"),
  },
  {
    teamName: "G12 FC",
    players: parseSquad("Abayomi Adelowo (MF), Adamu Yinusa (FW), Adedamola Elebiju (GK), Afere Oluwayemi (DF), Akram Ojokuku (MF), Aliu Olatunji (DF), Augustin Thomas (MF), Daniel Favour (FW), Dermaine Amadou (FW), Godwin Chima (MF), Ibrahim Fatai (MF), Jesugbemi Paul (FW), Kelvin Shigana (MF), Micheal Babajide (FW), Micheal Noutai (DF), Miracle Eroni (FW), Mohammed Usman (DF), Mubarak Oyeleke (MF), Okem Andrew (MF), Pascal Ngembus (GK), Regan Igwebuike (DF), Samuel Sunday (FW), Sayi Olatunji (FW), Usman Lateef (MF), Yusuf Adelupe (MF)"),
  },
  {
    teamName: "GLORIOUS FC",
    players: parseSquad("Abbey Godson (DF), Alfred Williams (MF), Ayo James (MF), Isaac Livingston (DF), Jasper Alade (FW), Jelili Saka (DF), Jesutoboar Williams (GK), Jonas Praise (FW), Kelvin Daniel (MF), Kobla Promise (GK), Monday Morris (FW), Nukunu Seth (FW), Nukunu Shepherd (MF), Philip Bright Eniola (MF), Samuel Sunday (DF), Sikiru Wasiu (DF), Simeon Adeboye (MF), Surprise David (FW), Waziri Friday (FW), Wonder Olamide (DF), Wordim Blessing (FW)"),
  },
  {
    teamName: "GOAL GETTERS FA",
    players: parseSquad("Adetoro Mikail (DF), Aminu Aliyu (DF), Chukwu Benjamin (FW), David Sulaimon (DF), Desmond Agidiogun (MF), Faruq Amid (GK), George Christian (DF), Godstime Atimati (MF), Hassan Abdullahi (FW), Lateef Adewale (FW), Marvelous Jerry (DF), Ojo Adetayo (FW), Qudus Adeoye (MF), Ridwan Yusuf (GK), Samson Adekunle Yekini (MF), Segun Adebisi (DF), Segun Monday (FW), Sodiq Amoo (MF), Stanley Unarojepha (DF), Sylvester Ihwuhiwabe (FW), Tunmise Banjoko (MF), Ubong Okon (FW), Uthman Isiaka (FW), Yayira Uchechi Paul (FW)"),
  },
  {
    teamName: "GOALS FC",
    players: parseSquad("Ajulekun Festus Eniola (MF), Amaweh Samuel (MF), Bawa Albert Gabriel (FW), Chichi Austine (DF), Chris Ekpu (MF), Dairo Emmanuel (DF), Davidson David Eno (MF), Destiny John Umbugadu (DF), Ekwu Monday Macaulay (FW), Gbenga Adetokunboh (FW), Ikenwanze Oscar (FW), John Didier Agbato (DF), Joseph Nwachukwu Emmanuel (MF), Joseph Samuel Ikechukwu (FW), Kindness Osagiede (FW), Mahmud Ahmed Awwal (DF), Nelson Robert Adedeji (GK), Nnachi Christian (FW), Nnamani Francis Somtochukwu (DF), Ogunleke Tolulope (DF), Olamilekan Jeremiah (GK), Polite Afodote (MF), Suleiman Nkeki (FW), Ter Alfred Ndeela (FW), Uwadiegwu Emmauel Chinonso (DF)"),
  },
  {
    teamName: "GREENLOCK FC",
    players: parseSquad("Adejuwon Natic (DF), Adeoye Philip (DF), Adeyi Sunday (GK), Alaka Emmanuel (DF), Alonge Oyewole (MF), Augustine Samuel (FW), Damilare Johnson (FW), Emeka Christian (FW), Favour James (DF), Felix Oluwaseun (GK), Godswill Sunday (DF), Ibrahim Saheed (FW), Ikudehinbu Oluwatayo (DF), Kingsley Peter (MF), Marcus Promise (FW), Ogwuche Abraham (MF), Olagoke Micheal (DF), Olawore Basit (FW), Shonde Gafar (DF), Sulaimon Ibrahim (FW), Usman Ridwan (MF), Yusuf Habeeb (FW)"),
  },
  {
    teamName: "H2H SPORT INT'L",
    players: parseSquad("Adenrele Khalid (MF), Adeyemi Adesuyi (DF), Ariyo Pelumi (MF), Awoyade Joshua (GK), Ayobami Ayodeji (MF), Idowu Quyam (DF), Ishola Subomi (MF), Ismail Malik (FW), James Destiny (DF), Jimoh Rasheed (DF), Kamoudeen Malik (FW), Kelechi Ifeanyi (DF), Mustpha Kehinde (DF), Mustpha Taiwo (FW), Ogaji Prince (FW), Ogunkoye Bobo (DF), Ogunkoye Rasaq (MF), Ogunmayin Tolu (GK), Ogunmola Michael (FW), Olaniyi Ayomide (DF), Omotayo Khaild (MF), Oware David (DF), Salami Rahmon (FW), Yusuf Lekan (MF)"),
  },
  {
    teamName: "IGHALO FA",
    players: parseSquad("Abubakar Usman (FW), Adams Adeagbo (MF), Alidu Mohammed (MF), Anwara Timothy (DF), Awal Moshood (DF), Bola Raji (FW), Damilola Oladele (MF), Emmanuel Timothy (DF), Ezeji Ikenna (FW), Fabiyi John (FW), Falade Joshua (DF), Fayemi Jimoh (DF), Gabriel Blessing (MF), Godwin Abah (DF), Idowu Abiodun (FW), Jimoh Olamilekan (MF), Nathaniel Akinpelu (MF), Ojewumi Damilare (GK), Olatunji Seyi (FW), Olutoye Yussuf (FW), Perfect Chiboike (FW), Sokunbi Kayode (MF), Steven David (DF), Yussuf Rafiu (FW), Yussuf Rafiu (FW)"),
  },
  {
    teamName: "IKOSI FC",
    players: parseSquad("Adebayo Samuel Fikayomi (MF), Adeya Oluwaferanmi Adeola (FW), Aduragbemi Falana (GK), Agbejoye Emmanuel (MF), Awosanmi Emmanuel (MF), Bakare Dolapo Gift (FW), Dami Longe (FW), Headboy Godwin (FW), Ibrahim Sefiu (DF), Idowu Timilehin Israel (MF), Jones Michael Ifeoluwa (FW), Musa Mohammed (DF), Ogundowo Oluwadoyin (MF), Oke Akinyemi (FW), Olasupo Oluwafemi Sunday (DF), Opeyemi Hassan (MF), Salako Ibrahim (GK), Sodiq Olajide (DF), Tobiloba Ojo (FW), Yekini Akeem Abeey (DF), Yusuf Nurudeen Adeyinka (MF)"),
  },
  {
    teamName: "IKOYI DOLPHIN FC",
    players: parseSquad("Akende Alphonsus (MF), Akin Kunle (GK), Awoderu Joseph Opeyemi (MF), Ayo Kola (FW), Babatunde Moses (MF), Barnabas Lubem (FW), Chukwuemeka Celeb (DF), Daniel Saleh (MF), Denan Panshak Hassan (FW), Destine Bulyad Fred (FW), Eleng Egbe Evogor Mayor (MF), Emmanuel Terwase (DF), Emmanuel Usman (DF), Hosea Bamskak (DF), Jonathan Danladi (DF), Mark Pakbong (DF), Nuga Oluwajoba (FW), Oluah Ikechukwu (FW), Olumide Ayomide (GK), Philip Baturyila Terungwa (FW), Ugwu David (DF), Ugwu Sunday (FW), Vitalis Terhide (FW), Waya Adekunle (FW), Young Stanley (MF)"),
  },
  {
    teamName: "INSPIRE SA",
    players: parseSquad("Abiodun Olamide (DF), Agboluaje Fawaz (FW), Ajayi Taiwo (MF), Alu Azuka (DF), Bamidele Favour (FW), Bello Alaba (FW), Esho Idris (MF), Fasola Eniola (DF), Fidelis Jeremiah (MF), Hungbo Idowu (DF), Irabor Israel (MF), Issa Jamiu (DF), John Abiodun (FW), Kehinde Hammed (FW), Kuye Kehinde (DF), Lateef Raheem (FW), Muritala Ayomide (FW), Okotore Rasheed (GK), Olayiwola Azeez (GK), Omodunni Sunday (FW), Oshinfowokan Ezekiel (MF), Paul Eniola (MF), Rauf Uthman (FW), Shiele Simion (FW), Taoheed Adeyemi (DF)"),
  },
  {
    teamName: "JOY COMETH FC",
    players: parseSquad("Abdulrasheed Jamiu Oluwatoyin (DF), Abimbola Olanrewaju (FW), Adebayo Adesanya (MF), Adekunle Tunde (FW), Adeleke Samuel (MF), Alex Chisom (MF), David Akpan Umoren (MF), Lawal Abdulrahmon (DF), Nosiru Moshood Olarewaju (FW), Okala Hamzat (DF), Okoro Henry (DF), Olaniran Mubarak Olasunkanmi (FW), Olorunlomoshe Muritala (FW), Omoregie Emmanuel (DF), Omotosho Segun Ezekiel (FW), Oshowo Adewale (DF), Osuolale David (FW), Salisu Ibrahim Olabode (DF), Sharafadeen Ibrahim (GK), Sunday Olamilekan Akanji (GK)"),
  },
  {
    teamName: "JP YOUNG STARS FC",
    players: parseSquad("Adekunle Jamiu (MF), Alexander Nwachukwu (FW), Alfred Isaac Emamoke (DF), Amusat Faruq Olamilekan (FW), Andrew Felix Adegnon (GK), Bolarinwa Samuel Oluwasegun (FW), Chinonso Stephen Anene (MF), Ekwewkem Emmanuel Tobechukwu (DF), Henry Ijezie (MF), Iruafemi Daniel (FW), Ismaila Philip (MF), Jamiu Opeyemi Alabi (DF), Micheal Ikechukwu Ajiri (DF), Mustau Toheeb Timothy (DF), Numan Sharani Sheu (FW), Ofodirinwa Chidubem Emmanuel (DF), Okechukwu Benedict Nnaona (FW), Okolie Stephen (DF), Samuel Timothy Oluwafemi (FW), Udofia Elijah Promise (MF), Udumoh Henry Emem (FW)"),
  },
  {
    teamName: "KIRAA FA",
    players: parseSquad("Abang Isaiah (FW), Adenuga Micheal (MF), Adeoye Akeem (MF), Akanbi Bolaji (DF), Ayinla Emmanuel (MF), Ayobami Ajayi (MF), Azeez Olatunji (MF), Benjamin Ishola (FW), Duntoye Abdulrahmon (MF), Emmanuel Ben (FW), Emmanuel Tomiwa (DF), Hycenth Clement (GK), Issah Sheu (MF), Jonah Michael (FW), Kaka Ridwan (FW), Kekere Bright (GK), Oladipupo Olanrewaju (DF), Oludayo Boluwatife (MF), Onekata Abdul (GK), Pascal Yosola (FW), Salau Semiu (DF), Taofik Olayinka (FW), Umar Yussuf (MF), Yakubu Muiz (FW), Yusuf Sulaimon (DF)"),
  },
  {
    teamName: "KOSAS PHANTOM FC",
    players: parseSquad("Abisogun Akeem Abiola (FW), Adeowo Fuhad Adedamola (MF), Akeem Peter Kayode (FW), Ayika Yoboh Lucky (MF), Dada Azeez Olajide (MF), Destiny Ugochukwu Onyeama (FW), Ejeta Moses Aforke (DF), Esianaka Nzube John (GK), Ezekwem Samuel Ebere (FW), Francis Ike Chukwudi (FW), Friday Ayomida Aiyelowo (MF), Ikeuzuh Chinonso Martins (MF), Nwokwocha Obinna (DF), Ogunbekun Solomon Tosin (DF), Okolo Buchi Henry (FW), Oluwaseun Taro Godswilll (MF), Oluyi Timileyin Honesty (FW), Oyekanmi Sulaimon (FW), Patrick Sylvester (MF), Stephen Peter (DF), Taiwo Iyanuoluwa (DF), Tijani Ayuba Adekunle (DF), Usman Abdulallahi Anibidesi (MF), Victor Chibueze (GK), Yinkarebogha Joel Oyindefa (MF)"),
  },
  {
    teamName: "LAGOS TITAN FC",
    players: parseSquad("Adelanwa Adeola Samson (FW), Adenekan Kazeem (FW), Adeyemi Harrison Ogidan (DF), Akangbe Stephen (MF), Akangbe Temidayo (MF), Enikuomehin Jeremiah Folarin (MF), Fadairo Bukola Samuel (DF), Gobari Progress (DF), Hammed Oladimeji (MF), Hammed Yusuf (GK), Nwekeida Ikechukwu Godspower (DF), Okayi Daniel (MF), Olubode Adebayo (FW), Oluwafemi Afuwape Atanda (MF), Oni Oluwadamilare Elijah (MF), Oviguraye Festus Ochuko (FW), Peter Sunday Usman (MF), Saheed Showole Adeshina (FW), Samuel Kehinde (DF), Taofeek Adeyanju (FW), Timothy Oluwaseun Joshua (GK), Tobi David (FW), Tolulope Joseph (DF), Usman Elojo Lucky (DF), Vincent Henry (FW)"),
  },
  {
    teamName: "LEGACY340 SA",
    players: parseSquad("Adoyi Gideon Inalegwu (FW), Aminos Elijah Oluwafemi (DF), Amobi Chiemerie Kennedy (DF), Amodu Francis (FW), Anekwe Chukwuma Collins (MF), Ayomide Rasaq (DF), Boyejo Ibrahim Olumide (DF), Ebiniyi Solomon (FW), Erondu Nnamdi (MF), Essien Destiny (FW), Ige Emmanuel Tunji (GK), Moliki Fatai Olasunkanmi (MF), Muhammed Fawas Olaitan (DF), Nwaokobia Lucky Chukwudi (MF), Okpe Ovie (MF), Olatunji Muyiwa (MF), Owolana Rokeeb Temitope (FW), Richard Akeem Samuel (FW), Samuel Gerrard Eze (DF), Useni Abdulrazak (GK)"),
  },
  {
    teamName: "LOF UNITED FC",
    players: parseSquad("Abudullahi Abdulganny (GK), Awaye Ogunsanya (FW), Chinedu Ulugbe (DF), Chisom Justice (FW), Hakeem Atolagbe (MF), Ibrahim Ismail (DF), Issac Chinasa (DF), Jamiu Abiola Adeaga (DF), Kunle Hassan (DF), Lake Ajayi (FW), Micheal Chukwunonye (FW), Miracle Okocha (MF), Mustapha Aminu (DF), Okoroji Obinna (GK), Olamide Olajumoke (MF), Olayinka Bakere Issac (MF), Peter Oladimeji (MF), Precious Opusunju (MF), Qodir Olorunmbe (DF), Richard Akpan Chalse (MF), Shine Okunola (DF), Shittu Habeeb Ademola (MF), Solomon Etim (MF), Toheeb Salaudeen (DF), Ugo Sunday Emmanuel (FW)"),
  },
  {
    teamName: "LUTHER INTER FC",
    players: parseSquad("Abiodun Toheeb Ayinla (MF), Adelowo Qudus (MF), Alassane Anassa Abdoul Hayatoula (MF), Amusa Qudus (MF), Augustine Friday (GK), Azeez Habeeb Ayodele (DF), Chibuzor Nwaiwu (GK), Dorishamu Kolade (DF), Efoli Godswill Eta (FW), Eguakun Osaretin Lucky (MF), Ejiofom Somadina Christopher (DF), Fantami Yusuf (FW), Gotom Daniel (FW), Ibime Prosper Oluyi (FW), Ibrahim Aminu (MF), Kazeem Lateef Babatunde (FW), Kosoko-King Benjamin Mayowa (FW), Mohammed Haruna (DF), Ohale Joshua Ifesinachi (FW), Oriaku Nnamdi (DF)"),
  },
  {
    teamName: "MARYLAND UNITED FC",
    players: parseSquad("Adamu Daniel (MF), Adekunle Oyebode (MF), Akinyemi Oluwasegun Victor (DF), Akodu Ayomide (MF), Austine Lopez Oddo (DF), Ayowale Omola (GK), Bowoade Sunday (MF), Daniel Anyebe (FW), Ezozo Joshua Awotu (GK), Fawaz Tobi Agunbiade (DF), Godwin David King (FW), Isa-Saliu Sodiq Abubakar (FW), Jonah Jeremiah (MF), Morola Samuel Victor (DF), Nkwocha Bright (FW), Obi Ifeanyi (MF), Oketa John Benedict (DF), Oluwafemi Akinola (MF), Omini Emmanuel Nnanna (DF), Onukwe Prosper (FW), Onyedikachi Martins Ohia (FW), Paul Waku (FW), Seriki Saidu (MF), Stanley Joseph Osayande (MF)"),
  },
  {
    teamName: "MEGA 22 FC",
    players: parseSquad("Abubakar Ali Sodiq (MF), Adejo Daniel (MF), Adigun Damilare (MF), Ajiboye Mudshiru Ola (DF), Ajuwa Godspower Karisai (FW), Alexander Victor Ekpo (MF), Chibuzor Augustine (DF), Emmanuel Jac9b (MF), Ido Oghenemaro Anthony (FW), Idris Jimoh Disu (FW), Isreal Friday (MF), Lateef Haleem Adisa (MF), Liasu Basit Atanda (FW), Michel Osaze Ogiamieb (DF), Mumboh Stephen Sunday (FW), Mustapha Ali Yusuf (MF), Nathaniel Kingsley Ifenatuora (DF), Ohagwu Peter Chukwuebuka (GK), Oladipupo Gabriel Oluwafemi (FW), Pere Donald Bebe (GK), Solomon Victory Chukwueke (FW), Sylvester Chidozie Nwoye (FW), Ulugbe Chinedu Emmanuel (DF)"),
  },
  {
    teamName: "MIDO SAKA FOOTBALL ACADEMY",
    players: parseSquad("Abdullahi Nura (MF), AbdulRahman Shuaib (FW), Adebayo Abiodun Mustapha (FW), Ajimisinmi Korede (DF), Akinola Kamolideen Ayinla (DF), Badmus Hammed Olatunji (DF), Ekinne Sunday (DF), Fatai Muyees (DF), Habeeb Olanrewaju (FW), Ikechukwu Oluoma (GK), Malachi Ben Adesuyi (FW), Mustapha Alao Monsuru (DF), Olawale Segun (MF), Omoshola Idehen (DF), Rasaq Sultan (GK), Salahu Abdullahi (DF), Sulaimon Farouq Olarewaju (MF), Sulaimon Kehinde (FW), Umar Sultan Gbolahan (MF), Usama Abdullah (DF)"),
  },
  {
    teamName: "NEWHOPE NAIJA FC",
    players: parseSquad("Abubakar Miracle (DF), Adeleke Godwin (MF), Adelu Taofeek (DF), Akinloye Toheeb (DF), Akintunde Samuel (FW), Akpos Igoli (FW), Alfred Samson (DF), Aniyu Malik (DF), Chukwu Emeka (DF), Ebitu Michael (GK), Isaac Ruben (DF), Jaiyeoba Kehinde (FW), Joseph Enoach (DF), Joseph Maro (FW), Moshood Idris (MF), Okanlomo Rafiu (DF), Olabisi Jamiu (MF), Oluoma Godspower (GK), Oluwafemi Samuel (MF), Otubekun Feranmi (DF), Soliu Isak (DF), Sulaiman Saoban (MF), Sulieman Tyabo (MF), Ubogu Success (FW)"),
  },
  {
    teamName: "OOA FA",
    players: parseSquad("Adetunji Fatai (MF), Ajayi Sodiq (FW), Alabi Hammed (FW), Alozie Justice (FW), Apata Isreal (FW), Biobaku Sodiq (FW), Chima David (FW), Dennis Ezekiel (GK), Elebimayo Mathew (MF), Emmanuel James (GK), Emmanuel Uchenna (FW), Ifemosun Kayode (MF), Imam Yusuf (DF), Jimoh Sodiq (DF), Nwaigwe Samuel (FW), Ogunyebi David (FW), Olagoke Abdullah (DF), Olaitan Mustapha (MF), Olalere Mathew (MF), Oni Micheal (DF), Oseni Kehinde (MF), Paul Olukanni (DF), Usman Suleimon (DF), Uzo Godswill (DF)"),
  },
  {
    teamName: "OOIM FC",
    players: parseSquad("Abdulmumin Ahmad (MF), Adebayo Ismaila (MF), Adegbite Joshua (FW), Adejuwon Adekunle (FW), Ademola Olanrewaju (DF), Charles Akinlotan (FW), Chukwu Chimobi (DF), Idowu Erioluwa (FW), Innocent Izuchukwu (DF), Johnson Emmanuel (MF), Joshua Julius (FW), Kehinde Habib (MF), Kingsley Okoronkwo (GK), Kofoworola Sunday (MF), Komon Ruke (DF), Mayowa Emmanuel (FW), Odediraan Selim (DF), Okafor Henry (FW), Oladoja Elijah (DF), Olajide Daniel (FW), Olowu Oritsebemiwo (MF), Onyeiwu Harrison (FW), Raheem Ramadan (MF), Sunday Darlington (GK), Uzoanya Uchenna (FW)"),
  },
  {
    teamName: "OWORO UNITED FC",
    players: parseSquad("Abdulrafiu Saheed Ajao (DF), Adeaga Johnson (MF), Adekunle Kehinde (MF), Ademola Adelani (GK), Adeoti Ismail (FW), Akeem Lawal (MF), Akudje Brume (DF), Ariwoola Yusuf (DF), Atoyebi Gideon Fabiola (FW), Eguavoen Richie (FW), Fatai Aliu (MF), Folaranmi Tunde (DF), Ibrahim Dehinde (FW), Johnson Chukwuemeka (DF), Okeowo Debo (MF), Oladeji Taofeek Anuoluwapo (GK), Olawoye Moruf (MF), Oluwaseun Aremu Timothy (MF), Omosuyi Dayo (FW), Ubong Akpan (FW)"),
  },
  {
    teamName: "PANTHERS FA",
    players: parseSquad("Ahmed Mujeeb (DF), Akinloye Sodiq (MF), Ayanwale Jeremiah Timothy (DF), Bolgun Yusuf (FW), Chiabuotu Daniel (FW), Daniel Abednego (GK), Daniel Ifechukwu Joshua (FW), Imoh Charles (MF), Israel Michael (MF), Israel Olusoji (DF), Israel Segun (DF), Ladi Precious (DF), Lawal Quadri (DF), Lawson John (DF), Lucky Aghon (MF), Muhmin Mustopha (MF), Nwaru Christian (DF), Oriola Akeem (DF), Owoje Sulaimon (DF), Saheed Rasheed (DF), Taiwo Sulaimon (MF), Terkene Emmanuel (FW), Unigwe Anthony (MF), Victor Imeh (FW), Yusuf Hassan (FW)"),
  },
  {
    teamName: "PEACE FC",
    players: parseSquad("Adegoke Adegbola Babatunde (FW), Adeiye Oluwasegun Precious (DF), Adeyemi Ajibade Abdulhaki (DF), Aminu Yaasin Oluwafunmbi (MF), Azubuike David (FW), Bakare Olajuwon (DF), Bassey David Ubong (MF), Boniface Tochukwu Emmanuel (FW), Chukwuebuka Ekuma Ibe (MF), Femi Banjo (FW), Francis Blessing (DF), Gilbert Saliva (DF), Imonah Micheal (FW), Isaac Aruntan (GK), Jeffrey Chidubem (FW), Kingsley George (DF), Mahmoud Abdsamad Olayinka (DF), Olowoyemo Oluwademi Ayomipo (MF), Omobolaji Moore (MF), Onuoha Henry Chukwudi (MF), Oseni Khalilu Ayomide (DF), Prince Akpan (DF), Shedrack Okereke (FW), Victor Bassey (GK)"),
  },
  {
    teamName: "POWER OF THE CROSS SPORT ACADEMY",
    players: parseSquad("Adio Wasiu Akanji (FW), Alanza Emmanuel Chimezie (FW), Aliu Mubarak Damilola (FW), Babatunde Samuel Olamide (MF), Bamidele Micheal (FW), Basil Nnaemeka Henry (FW), Christian Valentine (DF), David Monday Samson (MF), Dodo Ango Francis (DF), Felix Denyefa (DF), Ibeto Sunny Christian (MF), Innocent Daniel (FW), Joseph Believe (FW), Kutu Seiyefa Frank (DF), Nasiru Segun Taiwo (DF), Nwabueze Chigozie (MF), Nwachukwu Emmanuel Chisom (FW), Ofoedu Ifunanya Emmanuel (DF), Ojadi Chikamso (GK), Ojukwu Chinonso (MF), Olodu Victory Ogochukwu (FW), Onah Michael Nnabuike (DF), Peter Friday (GK), Romanus Christian Ikechukwu (DF), Uzosike Kenneth Ndubuisi (MF)"),
  },
  {
    teamName: "PRIME ELEVEN FA",
    players: parseSquad("Akumka Somto (DF), Balogun Temi (FW), Bassey Ukemeobong (FW), Chris Destiny Isreal (DF), Destiny Hitler (GK), Ejike Ugwu (MF), Emmanuel Babatunde (FW), Etim Justin Wisdom (MF), Eze Uzor (DF), Hello Richard (DF), Idabor Frank (GK), Iheme Joseph Chidera (MF), John Victor Emmanuel (MF), Joseph Thomas (DF), Merit Inioluwa Adebayo (FW), Moses Brownson (DF), Musa Malik Micheal (DF), Okpara Samson (DF), Onoriode Bright (FW), Orimisan Samuel (FW)"),
  },
  {
    teamName: "PRINCE KAZEEM ELETU FC",
    players: parseSquad("Abdullahi Kamaldeen (FW), Adeleye Ibrahim (MF), Ali Rabiu (DF), Ariwoola Isreal (DF), Ashimi Oluwatobiloba (MF), Balogun Kuku (DF), Chiwetalu Elise Abraham (FW), Edet Emmanuel Adeleya (FW), Fagboro Olayiwola (DF), Fetuga Nosirudeen Adebayo (DF), Fidelis Junior Isreal (FW), Henshaw Chukwurah (DF), Ibiduni Olayinka (FW), Jimmy Emuerinme Elisha (MF), Joseph Thankgod Ofem (FW), Lagata Olamilekan Oluwasegun (MF), Oba Surajudeen Ayodeji (GK), Obasi Jude Ikechukwu (FW), Oluwafemi Afuwape Atanda (MF), Owusu Banahene Dennis (MF), Paul Obaze (DF), Rasheed Yusuf (GK), Samuel Ezeh (FW), Sunday Abuchi (FW), Wisdom Thomas (DF)"),
  },
  {
    teamName: "RORO HOUSE",
    players: parseSquad("Abraham Samson (FW), Ayanda Olaitan (MF), Babatunde Ogungbesan (FW), Balami Kehinde (MF), Chima Steven (DF), Daniel Ayomide (DF), Eche Stephen (MF), Emmanuel Udeh (DF), Gabriel Chuzzy (MF), Hycent Olie (FW), Jephtah Bowoto (FW), Kingsley Jeremiah (DF), Muniru Adegun (GK), Ohaksm Sinclair (MF), Olajesu Olamide (FW), Peter Gabriel (FW), Peter Sunday (FW), Salisu Abubakar (GK), Taiye Breakthrough (MF), Yemi Abu (MF)"),
  },
  {
    teamName: "ROYAL PHARAOHS FC",
    players: parseSquad("Adams Victor (DF), Adeleye Taiye (FW), Ademola Alajo (FW), Aiyelowo James (MF), Ajasa Roqeeb (DF), Awwal Burian (FW), Ernest Mathew (MF), Ezekiel Isaac (FW), Femi Iwashokun (GK), Ibiyemi Adams (DF), Ibrahim Mudashiru (MF), Ikechukwu Jaswill (DF), Ikion Sunday (FW), Iyang Daniel (DF), Obiijeh Emmanuel (DF), Ojo Arise (MF), Oreoluwa Odutan (FW), Promise Ikechukwu (DF), Rilwan Kolajo (DF), Salako Waris (FW), Samuel Oseni (GK), Tijani Faruq (DF), Yusuf (DF), Yusuf Akerele (DF)"),
  },
  {
    teamName: "ROYALTY ATHLETIC FC",
    players: parseSquad("Abdullah Ayyub (DF), Abiodun Owolabi (MF), Adebayo Basit Temitope (FW), Adebayo Fawas Ayomide (MF), Adebisi Sulaimon (DF), Aderibigbe Toheeb (FW), Afolabi Taofeek (MF), Agama Bright (GK), Akanni Blessing Ayomide (DF), Aluko-dealer Emmanuel (MF), Animashaun Oladimeji (FW), Ayodeji Eniolorunda Damilola (MF), Emmanuel Oni (DF), Fafore Ahmed (MF), Favour Umoren Emmanuel (FW), Jesuosiv David (GK), Kareem Toheeb (FW), Lukmon Olamilekan Kazeem (FW), Mark Precious (FW), Olaniyan Toheeb Monday (GK), Owolabi Mutiu (MF), Smith Ikuemosa Benson (MF), Uka Ikechukwu Emmanuel (FW), Ungingi Nelson Unimke (MF), Yusuf Ayomide Obawunmi (DF)"),
  },
  {
    teamName: "SOCCER CARDINALS F.C",
    players: parseSquad("Abubakar Peace (DF), Adewunmi Adekunle Abubakar (MF), Akinola Samuel (DF), Akinosun West (MF), Akinwale Olwagbenga Falomomi (MF), Balogun Ismail (GK), Chisom Samuel (FW), Emmanuel Oluwapelumi Jago (FW), Ishola Rasheed (GK), Jesudunsin Daniel (MF), John Dede (MF), Johnson Sunday (DF), Kolade Aladeokin (DF), Kolo Isomo Bougeoir (DF), Monehin Mayowa (MF), Oladejo Wasiu (FW), Olamilekan Mustapha (MF), Oluleke Bamise (FW), Oluwole Ademola (DF), Onyekachi Okoro (FW), Osaitin Damisa (FW), Shomefun Oluwatobi (MF), Sulaimon Lateef Akanbi (MF), Tijani Azeez (DF), Yekini Jamiu Olakunle (FW)"),
  },
  {
    teamName: "SOMOLU BARIGA LFC RAMBA SAMBA",
    players: parseSquad("Adewale Gerald (DF), Ajulo Ola (DF), Alfa Olakunle (DF), Ayomiposi Olawale (GK), Babatunde Oladejo (FW), Benjamin Friday (FW), Chibuike Okonkow (FW), Danjuma Ibrahim (GK), Ekufre Abasi (FW), Ganiu Folarin (FW), Issa Yusuf Amuda (FW), John Ezra (MF), Lukman Adebambo (FW), Nelson Titus (MF), Nworie Michael (DF), Olatunji Ukale (FW), Olufemi Johnson (FW), Sunny Justice (DF), Uchenna Okonkwo (MF), Wasiu Balogun (FW)"),
  },
  {
    teamName: "STAR TO BE ACADEMY",
    players: parseSquad("Adeka Peter (DF), Adenola Abduljelil (FW), Adeyinka Salisu Quadri (DF), Adigun Farouq (FW), Akio Dennis (FW), Charles Prince (FW), Chuwkudiri Divine Ebere (GK), Ezekiel Benard (GK), James John Abayomi (FW), Michael Kofi (MF), Michael Mesach (MF), Michael Wisdom (FW), Namene Enoch (DF), Namene Gome Cherish (FW), Oba Ayodimeji Ebenezer Ayomide (DF), Onosedeba Joseph Osa (DF), Rowland Promise (DF), Shomoye Daniel Olamilekan (FW), Simon John (DF), Solomon Okeme (DF)"),
  },
  {
    teamName: "SYNERGY ULTIMATE SC",
    players: parseSquad("Abel Gideon (GK), Adinlewa Inioluwa (DF), Agborialor Wisdom (DF), Anietie Felix (FW), Aondohemba Peter (DF), Augustine Paul (MF), Ayedun Faruk (DF), Chinanu Emmanuel Davies (FW), Essumai Isaac Ibrahim (FW), Iduh Emmanuel (MF), Irinoye Faruq (MF), Isaac Christian (GK), Johnson Michael (FW), Kafari Nasiru (MF), Kinkumi Seyi Success (DF), Michael Isaiah Chika (FW), Nwigwe Christian (DF), Obiene Victory (FW), Ogundipe Oluwafeyikemi (MF), Oladele Olawale (DF), Omofolarin Oluwafemi (DF), Oyetunji Dare (DF), Oyewumi Lanre (FW), Taiwo Noah (MF)"),
  },
  {
    teamName: "TEAM360 FC",
    players: parseSquad("Aminu Abubakar (FW), Ayinla Salami (MF), Ayoade Babatunde (FW), Daniel Adams (DF), Daniel Geoffery (FW), Elegbede Mayowa (MF), Emmanuel Akonudu (DF), Evans Ajuzie (FW), Feranmi Olusegun (FW), Hameed Balogun (GK), Ishola Fawaz (FW), Kelechi Okeke (GK), Muiz Azeez (DF), Nasiru Abdullahi (FW), Nura Yahaya (MF), Nwosu Emmanuel (FW), Obiora Chinedu (FW), Ofieali Chinedu (FW), Ofojeh Prosper (DF), Oliver Daniel (FW), Oriseh David (FW), Raphael Ayinde (MF), Teniola Ayanwola (MF), Timileyin Shabi (FW), Wahab Sanni (DF)"),
  },
  {
    teamName: "THE PRO SELECT FC",
    players: parseSquad("Adeniyi Gbemileke (DF), Akinbo Emmanuel (FW), Atunwa Caleb (DF), Bilal Rammal (GK), Charity Vannelli (FW), Chia Nathaniel (MF), Daniel Okoli (GK), Destine Fred (FW), Ekene Clement (DF), Etim Esu (DF), Inawole Emmanuel (MF), Kachina Savior (MF), Nwayingor Joe Sunday (FW), Oluah Ifeanyi David (DF), Oluah Ikechukwu (FW), Oluwasegun Fajumobi (FW), Oluwatobi Samuel Oni (FW), Paul Patrick (DF), Thomas Daniel (MF), Tosin Michael (FW), Waya Adekunle (DF)"),
  },
  {
    teamName: "TONIC FC",
    players: parseSquad("Abayomi Azeez (MF), Abidoye Ibrahim (MF), Abiodun Anuoluwapo (FW), Adebanjo Temiloluwa (MF), Adegbola Abdulwarth (MF), Arinze Godwin (FW), Ayelabowo Opeyemi (FW), Ekeamadi Princewill (DF), Elkanah Ayuba (DF), Emmanuel Okanlawon (DF), Enoch Eneche (FW), Excel Ochoko (FW), Femi Adegboyega (GK), Hassan Olamilekan (FW), Nasiru Ipense (MF), Ndidi Blessing (MF), Ogunseye Victor (MF), Ojele Muyiwa (GK), Ojo Busayo (MF), Olanipekun Segun (DF), Oluwafemi Olayanju (MF), Onoja Godwin (FW), Owokoro David (DF), Rasaq Tobilola (DF), Shittu Quadri (FW)"),
  },
  {
    teamName: "TURF SEASON TIGERS FC",
    players: parseSquad("Adewumi Emmanuel (FW), Alabi Quadri (MF), Aliyu Ibrahim (DF), Ayeni Emmanuel February (DF), Chinedu Ogbuwa (MF), Egbujor Chinedu (DF), Excellence Ochomma (GK), Fatai Toheeb (DF), Ganiyu Mujeeb (DF), Gbotemi Ayanwale (MF), Jegbefume Paul (FW), Joseph Okesanya (MF), Joshua Ogonna (MF), Kehinde Olomololaye (MF), Nwaiku Job (MF), Ofoha Divine (MF), Ogheneruemu Henry (FW), Okolie Chukwudalu (FW), Paul Badejo (FW), Talabi Temitope (MF), Toheeb Sanni (MF)"),
  },
  {
    teamName: "UNIZEE",
    players: parseSquad("Abdulwahab Jubril (DF), Abolade Moshood (MF), Adeloye Mathew (DF), Adeoye Abideen Olamide (FW), Ajiboye Kayode Victor (MF), Akinboyewa Olatunde (DF), Amos Jeremiah (FW), Azeez Sunkanmi (DF), Balogun Joseph (DF), Enobong Jerome (FW), Hungbo Totenme Semande (FW), Igwe Kingsley (MF), Ismail Oluwatosin (FW), Jide Joseph (FW), Ogunlade Damilare Mobolaji (DF), Omotayo Sodiq (FW), Ridwan Akinrinoye (DF), Samson Pelumi (FW), Selim Jimoh Oluwatunmise (GK), Shokoya Oluwatobi Idris (FW), Sulaimom Idris (GK), Sultan Adeyemi (DF), Thajudeen Quadri (FW), Tijani Hassan (FW), Warimini Christian (MF)"),
  },
  {
    teamName: "UTMOST FC",
    players: parseSquad("Abdulrahim Sodiq (FW), Abdulwahab Kehinde (MF), Abdulwahab Taiwo (DF), Akinde Samuel (FW), Barnabas Ezekiel (MF), David Agayo (GK), David Oliver (DF), Edoabasi Friday (DF), Efejedia Daniel (MF), Ganiu Sikiru (DF), Gideon Onoja (GK), Jude Uchemezie (DF), Justin Wisdom (MF), Longji Caleb (MF), Odaka Kelechi (MF), Osheka Elijah (DF), Philip Pius (FW), Sadiq Janga (MF), Saka Qudus (FW), Samuel Olorunsola (FW), Shenghe Kingsley (MF), Toheeb Sefiu (DF), Victor Obaji (FW)"),
  },
  {
    teamName: "VIDO 99 FC",
    players: parseSquad("Abdulhamid Fatai (FW), Allen Samuel (FW), Azeez Ope (DF), Babalola Sodiq (MF), Babatunde A (FW), Bakare Akinsola (MF), Dennis Orianwo (GK), Ehis Isaac (FW), Eniola Yusuf (GK), Femi Ode (DF), Hope John (MF), Idris Ibrahim (MF), Joel Emmanuel (FW), Kehinde Olaniyan (DF), Kehinde Salami (DF), Malik Jimoh (MF), Mohammed Abdulsamad (DF), Mohammed Tobi (MF), Mustapha Faruq (DF), Raymond Babatunde (MF), Razaq Abdulkareem (DF), Saka Yusuf (FW), Shedrack Tanko (DF), Unanah Johnson (MF), Victor Adebayo (FW)"),
  },
  {
    teamName: "VINMO ENERGY FC",
    players: parseSquad("Alasa Lamidi (MF), Aliamin Adigun (GK), Aron Ogodogbo (FW), Dosu Dayo Pappi (DF), Ekene Onuegbu (MF), Emeka Akabuike (FW), Favour Bello (FW), Fola Adebayo (FW), Jimmy Aigbowon (GK), Kunle Iriyemi (MF), Monday Dennis (MF), Peter Anani (FW), Segun Ayeolowo (DF), Sheriff Aiyekpe (DF), Somtochukwu Nwafor (DF), Stephen Ogunji (FW), Sunday Daniel (MF), Sunday Nanayo (MF), Tunde Fatai (FW), Uche Emeribe (FW)"),
  },
  {
    teamName: "VINO GANO",
    players: parseSquad("Ademola Seidel Michael (MF), Adeyeye Abiodun (GK), Amusat Mohammed (MF), Aranmolate Tobiloba (FW), Destiny Felix (GK), Eliphew Samuel (MF), Emmanuel Temitayo Adebayo (DF), Friday Eric (DF), Gbadamosi Babatunde (FW), Gift Chimaeze (FW), Keshinro Toheeb (FW), Nduka Ezekiel (FW), Ogunmodede Tosin (MF), Olamuwagun Daniel Temitope (MF), Otusanya Samuel (DF), Qudus Ibrahim Olamilekan (FW), Rasheed Jamiu (DF), Salami Azeez (FW), Salami Rasaq (DF), Sultan Giwa (FW)"),
  },
  {
    teamName: "VINOD FA",
    players: parseSquad("Abdullahi Abubakar (GK), Ahmod Ibrahim (MF), Ambrose Akinwande (DF), Ekundayo Michael (MF), Haruna Abdulaziz (MF), Hassan Ahmed (MF), Ikeh Elvis (FW), Lawal Kehinde (DF), Muhammed Hussein (DF), Ndujife Ikechukwu (MF), Okon Innocent (DF), Oloye Yesiir (DF), Olusesi Ganiu (GK), Osas Osayande (FW), Ottun Babatunde (GK), Oyediran Odunayo (FW), Oyewole Daniel (MF), Popoola Uthman (DF), Qudus Olaotan (MF), Samuel Odah (DF)"),
  },
  {
    teamName: "WASOLA VEN. FC",
    players: parseSquad("Abubakar Diggio (MF), Adebayo Quari (MF), Adigun Damilare (MF), Ajibola Wasiu (FW), Alo Ayodeji Olufemi (FW), Azeez Rahmon Ojo (FW), Chima Okolie (DF), David Onuche (MF), Fowoshade Ayinde (DF), Ishola Rasaq Olasunkami (DF), Ismaila Eletu Seun (FW), Jimba Adedotun (MF), Joel Opadotun (FW), Kio Emmanuel Ifiemi (MF), Muhammed Abdulfatai (DF), Nwocha Martins (MF), Olawoyin Wasiu (DF), Oluwadamilare Aina (GK), Raji Yahaya (GK), Showande Seye (MF), Sunday Emmanuel (DF), Yisa Toheeb (FW)"),
  },
  {
    teamName: "WILLYJOE-17 FA",
    players: parseSquad("Adikpe Joseph Ode (DF), Adio Abbey (MF), Bakare Sodiq (DF), Chidi Chibueze (FW), Chigbo Bobby Joe (DF), Chijioke Favour (DF), Chikexirim Leo Okeneche (GK), Doukumor Funakpo Joseph (FW), Ebenezer Prince Chimezie (MF), Emmanuel Balogun (FW), Gbekpo Enagbo Segun (DF), Husseni Abduljabar (DF), John Elija (MF), Obido Samuel (DF), Obinna Marvellous (DF), Ogunrinde Ayobami Joshua (DF), Okoutu Stephen (DF), Omeh Sylvester (GK), Robert Chibuike (FW), Syllys Prosper Oluwatobiloba (MF), Tunde Seun Daniel (FW), Ubah Chukwuebuka Benjamin (MF), Udo Isaac (MF), Uwanaka Desmond (DF), Young Elisha Obotu (FW)"),
  },
  {
    teamName: "YOUNG PRO FA",
    players: parseSquad("Ayinla Friday Jamiu (DF), Babundo Joshua Ebuka (MF), Chibuike Victor Akunechenze (FW), David Monday Samson (MF), Ebube Okafor (GK), Edeh Prince Onyekachi (FW), Egwuatu Elijah Chibuzor (DF), Fatai Opeyemi Qudus (MF), Giwa Michael Opeyemi (DF), Godwin Victor Endurance (DF), Harrison Joseph Olamipo (FW), Ifeanyi Emmanuel (DF), Kingsley Silva (GK), Lawson Abiodun Champion (MF), Michael Oluwabukola Ajao (MF), Molokwu Ndubuisi Victor (MF), Mufutao Sodiq (DF), Nnaji Emmanuel Chidalu (GK), Ogungbile Elijah (MF), Okewusi Ademola (DF), Olawole Monday Isaiah (FW), Omel Chisom (FW), Sodiq Olamilekan Al-Ameen (DF), Sulaimon Kazeem Abiodun (FW), Umeagugoesi Nelson (MF)"),
  },
  {
    teamName: "YOUNG STRIKERS FC",
    players: parseSquad("AbdulRahmon Idris (DF), Adeniregun Quadri (MF), Afeez Shittu (GK), Agbaje Toheeb (FW), Akofe Olumide Micheal (MF), Alex Nkwocha (DF), Aminu Anas Muhammad (DF), Anya Patrick (FW), Aweda Yusuf (MF), Daud Muhammed Fawaz (MF), Enoch Achaleme (FW), Fashola Qoyum (FW), Hassan Muiz (DF), Lawal Khalid (DF), Lawal Muiz (FW), Liadi Kabiru (MF), Martins James (MF), Mukaila Jimoh (FW), Mutiu Agbaje (GK), Nurudeen Gomez (DF), Rahmon Wasiu Ila (MF), Riliwan Omotosho (MF), Samson Emmanuel (MF), Suenu Taiwo (GK), Tijani Hafeez (DF)"),
  },
  {
    teamName: "ZENITH EMPEROR FOOTBALL CLUB",
    players: parseSquad("Adibe Chigozie (MF), Agada Stephen (FW), Agba Chukwuma (DF), Amafiobu Peter (DF), Bankole Basit (MF), Bukari Abdulrafiu (FW), Ehimare Jude (FW), Emavodia (FW), Embugushiki Godgave (MF), Festus Omolade (FW), Jimoh Toheeb (DF), Kareem Qudus (DF), Lawal Babatunde (DF), Lawrence Samuel (DF), Mohamad Kabiru (FW), Moses Agodu (FW), Owonifari Olamide (GK), Paul Nicholas (DF), Sunday Oluwaseun (FW), Toluwani Ojo Emmanuel (MF)"),
  },
];

function parseSquad(value: string): SquadSeed["players"] {
  return value.split(",").map((entry) => {
    const match = entry.trim().match(/^(.*?)\s*\(([^)]+)\)$/);
    return {
      name: match?.[1]?.trim() ?? entry.trim(),
      position: match?.[2]?.trim() ?? "MF",
    };
  });
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortName(name: string): string {
  const cleaned = name.replace(/\b(football|academy|club|sporting|sports|united)\b/gi, "");
  const letters = cleaned.match(/[A-Za-z0-9]+/g) ?? [name];
  return letters
    .slice(0, 3)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 4);
}

function teamDisplayName(name: string): string {
  return name.trim().toUpperCase();
}

function nameKey(value: string): string {
  return slugify(value)
    .replace(/\b(fc|fa|sc|sa|lfc|f-c)\b/g, "")
    .replace(/-/g, "");
}

function splitPlayerDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? displayName,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

async function resolveUniquePlayerSlug(prisma: PrismaClient, displayName: string) {
  const base = slugify(displayName) || "player";
  let slug = base;
  let suffix = 0;
  while (await prisma.player.findUnique({ where: { slug }, select: { id: true } })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
}

async function findOrCreate1XCupPlayer(
  prisma: PrismaClient,
  rawName: string,
  position: string,
  previousTeamRows: Array<{
    playerId: string | null;
    displayName: string;
    player?: { id: string; displayName: string; normalizedName: string | null; slug: string } | null;
  }>
) {
  const displayName = normalizePlayerName(rawName);
  const normalizedName = playerLookupKey(displayName);
  const exact = normalizedName
    ? await prisma.player.findUnique({ where: { normalizedName } })
    : null;
  if (exact) {
    return prisma.player.update({
      where: { id: exact.id },
      data: {
        displayName,
        positionPrimary: exact.positionPrimary || position,
        registrationStatus: "approved",
        isPublic: true,
      },
    });
  }

  const scopedCandidate = resolvePlayerNameCandidate(
    displayName,
    previousTeamRows
      .filter((row) => row.playerId || row.player?.id)
      .map((row) => ({
        playerId: row.playerId ?? row.player!.id,
        displayName: row.displayName,
        aliases: [row.player?.displayName, row.player?.normalizedName, row.player?.slug?.replace(/-/g, " ")],
      }))
  );
  if (scopedCandidate) {
    return prisma.player.update({
      where: { id: scopedCandidate.playerId },
      data: {
        displayName,
        positionPrimary: position,
        registrationStatus: "approved",
        isPublic: true,
      },
    });
  }

  const nameParts = splitPlayerDisplayName(displayName);
  return prisma.player.create({
    data: {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      displayName,
      normalizedName: normalizedName || null,
      slug: await resolveUniquePlayerSlug(prisma, displayName),
      positionPrimary: position,
      registrationStatus: "approved",
      isPublic: true,
    },
  });
}

function parseCsvRows(csv: string): Record<string, string>[] {
  const [headerLine, ...rows] = csv.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return rows.map((line) => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (const char of line) {
      if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function watKickoff(date: string, time: string): string {
  const [rawHour, rawMinute] = time.split(":").map((x) => Number(x));
  const hour = rawHour >= 1 && rawHour <= 6 ? rawHour + 12 : rawHour;
  return `${date}T${String(hour).padStart(2, "0")}:${String(rawMinute ?? 0).padStart(2, "0")}:00+01:00`;
}

function teamId(seed: number): string {
  return `00000000-0000-4000-81xt-${String(seed).padStart(12, "0")}`;
}

function matchId(code: string): string {
  const number = Number(code.replace(/\D/g, ""));
  return `00000000-0000-4000-81xm-${String(number).padStart(12, "0")}`;
}

const TEAMS: TeamSeed[] = parseCsvRows(TEAM_LOGOS_CSV).map((row) => ({
  seed: Number(row["Serial Number"]),
  id: teamId(Number(row["Serial Number"])),
  slug: slugify(row.team_name),
  name: teamDisplayName(row.team_name),
  shortName: shortName(row.team_name),
  logoUrl: row.logo_url,
}));

const MATCHES: MatchSeed[] = parseCsvRows(FIRST_ROUND_FIXTURES_CSV).map((row) => ({
  matchCode: row.code,
  zone: row.zone,
  homeName: row.home,
  awayName: row.away,
  kickoffAt: watKickoff(row.date, row.time),
  venue: row.venue || DEFAULT_VENUE,
}));

const TOURNAMENT_DAY_BY_DATE = new Map(
  Array.from(new Set(MATCHES.map((match) => match.kickoffAt.slice(0, 10))))
    .sort()
    .map((date, index) => [date, index + 1])
);

function tournamentDay(match: MatchSeed): number {
  return TOURNAMENT_DAY_BY_DATE.get(match.kickoffAt.slice(0, 10)) ?? 1;
}

function matchNumberLabel(code: string): string {
  return `Match ${Number(code.replace(/\D/g, ""))}`;
}

const ZONES = [
  { key: "ikeja", name: "Ikeja Zone", teams: 24, qualifiers: 6 },
  { key: "lagos_island", name: "Lagos Island Zone", teams: 24, qualifiers: 6 },
  { key: "ikorodu", name: "Ikorodu Zone", teams: 20, qualifiers: 5 },
  { key: "badagry", name: "Badagry Zone", teams: 20, qualifiers: 5 },
  { key: "epe", name: "Epe Zone", teams: 12, qualifiers: 2 },
] as const;

const SECOND_ROUND_TEMPLATES = [
  { code: "M51", zone: "Ikeja Zone", date: "2026-08-20", time: "1:30", label: "IKJ F1: M1 vs M2" },
  { code: "M52", zone: "Ikeja Zone", date: "2026-08-20", time: "2:45", label: "IKJ F2: M1 vs M2" },
  { code: "M53", zone: "Lagos Island Zone", date: "2026-08-21", time: "11:00", label: "L/ISLAND F1: M1 vs M2" },
  { code: "M54", zone: "Lagos Island Zone", date: "2026-08-21", time: "12:15", label: "L/ISLAND F2: M1 vs M2" },
  { code: "M55", zone: "Ikorodu Zone", date: "2026-08-21", time: "1:30", label: "IKD F1: M1 vs M2" },
  { code: "M56", zone: "Ikorodu Zone", date: "2026-08-21", time: "2:45", label: "IKD F2: M1 vs M2" },
  { code: "M57", zone: "Badagry Zone", date: "2026-08-22", time: "11:00", label: "BD F1: M1 vs M2" },
  { code: "M58", zone: "Badagry Zone", date: "2026-08-22", time: "12:15", label: "BD F2: M1 vs M2" },
  { code: "M59", zone: "Epe Zone", date: "2026-08-22", time: "1:30", label: "EPE F1: M1 vs M2" },
  { code: "M60", zone: "Epe Zone", date: "2026-08-22", time: "2:45", label: "EPE F2: M1 vs M2" },
  { code: "M61", zone: "Ikeja Zone", date: "2026-08-27", time: "11:00", label: "IKJ F3: M1 vs M2" },
  { code: "M62", zone: "Ikeja Zone", date: "2026-08-27", time: "12:15", label: "IKJ F4: M1 vs M2" },
  { code: "M63", zone: "Lagos Island Zone", date: "2026-08-27", time: "1:30", label: "L/ISLAND F3: M1 vs M2" },
  { code: "M64", zone: "Lagos Island Zone", date: "2026-08-27", time: "2:45", label: "L/ISLAND F4: M1 vs M2" },
  { code: "M65", zone: "Ikorodu Zone", date: "2026-08-28", time: "11:00", label: "IKD F3: M1 vs M2" },
  { code: "M66", zone: "Ikorodu Zone", date: "2026-08-28", time: "12:15", label: "IKD F4: M1 vs M2" },
  { code: "M67", zone: "Badagry Zone", date: "2026-08-28", time: "1:30", label: "BD F3: M1 vs M2" },
  { code: "M68", zone: "Badagry Zone", date: "2026-08-28", time: "2:45", label: "BD F4: M1 vs M2" },
  { code: "M69", zone: "Epe Zone", date: "2026-08-29", time: "11:00", label: "EPE F1: M1 vs M2" },
  { code: "M70", zone: "Ikeja Zone", date: "2026-08-29", time: "12:15", label: "IKJ F5: M1 vs M2" },
  { code: "M71", zone: "Ikeja Zone", date: "2026-08-29", time: "1:30", label: "IKJ F6: M1 vs M2" },
  { code: "M72", zone: "Lagos Island Zone", date: "2026-08-29", time: "2:45", label: "L/ISLAND F5: M1 vs M2" },
  { code: "M73", zone: "Lagos Island Zone", date: "2026-09-03", time: "11:00", label: "L/ISLAND F6: M1 vs M2" },
  { code: "M74", zone: "Ikorodu Zone", date: "2026-09-03", time: "12:15", label: "IKD F5: M1 vs M2" },
  { code: "M75", zone: "Badagry Zone", date: "2026-09-03", time: "1:30", label: "BD F5: M1 vs M2" },
  { code: "M76", zone: "Epe Zone", date: "2026-09-04", time: "2:45", label: "EPE: F1 vs M2" },
  { code: "M77", zone: "Epe Zone", date: "2026-09-04", time: "11:00", label: "EPE: F1 vs M3" },
  { code: "M78", zone: "Epe Zone", date: "2026-09-04", time: "12:15", label: "EPE: F3 vs M2" },
];

function zoneKey(zone: string): string {
  return slugify(zone).replace(/-/g, "_");
}

export async function seed1XCup2026(prisma: PrismaClient, options?: SeedOptions) {
  const teamZoneBySlug = new Map<string, string>();
  const teamByKey = new Map<string, TeamSeed>();
  for (const team of TEAMS) teamByKey.set(nameKey(team.name), team);

  for (const match of MATCHES) {
    const home = teamByKey.get(nameKey(match.homeName));
    const away = teamByKey.get(nameKey(match.awayName));
    if (!home || !away) {
      throw new Error(`1XCup seed fixture cannot resolve teams for ${match.matchCode}: ${match.homeName} vs ${match.awayName}`);
    }
    home.zone = match.zone;
    away.zone = match.zone;
    teamZoneBySlug.set(home.slug, match.zone);
    teamZoneBySlug.set(away.slug, match.zone);
  }

  const formatConfig = {
    format: "multi_stage_tournament",
    editionLabel: "1XCup 2026",
    timezone: TIMEZONE,
    overview:
      "The tournament starts with five Lagos zonal qualifying brackets. Teams in each zone play one-time loser-go-home knockout matches, with tied games going straight to penalties. The zone qualifiers then enter a 24-team round-robin group stage, followed by a 16-team knockout stage.",
    qualifying: {
      type: "single_elimination",
      description:
        "Each zone is a one-time loser-go-home qualifier. Ikeja and Lagos Island send six teams each to the group stage, Ikorodu and Badagry send five each, and Epe sends two.",
      tiebreaker: "penalty_shootout_no_extra_time",
      totalTeams: 100,
      qualifiers: 24,
      zones: ZONES,
      firstRoundMatches: MATCHES.length,
      secondRoundTemplates: SECOND_ROUND_TEMPLATES.map((row) => ({
        ...row,
        kickoffAt: watKickoff(row.date, row.time),
        venue: DEFAULT_VENUE,
      })),
    },
    groupStage: {
      teams: 24,
      groups: 6,
      teamsPerGroup: 4,
      format: "single_round_robin",
      advancement: { topPerGroup: 2, bestThirdPlaced: 4 },
      points: { win: 3, draw: 1, loss: 0 },
      tiebreakers: ["points", "goal_difference", "goals_for", "head_to_head"],
    },
    knockoutStage: {
      teams: 16,
      rounds: ["Round of 16", "Quarter-finals", "Semi-finals", "Third-place playoff", "Final"],
      format: "single_elimination",
    },
  };

  const comp = await prisma.sbCompetition.upsert({
    where: { slug: COMP_SLUG },
    update: {
      name: "1XCup 2026",
      season: "2026",
      type: "tournament",
      formatType: "1XCUP_MULTI_STAGE",
      status: "active",
      formatConfig: formatConfig as Prisma.InputJsonValue,
      country: "Nigeria",
      description:
        "1XCup 2026 starts with 100 teams across five Lagos zonal loser-go-home qualifiers. Twenty-four zone winners/qualifiers advance to six round-robin groups of four, before the best 16 teams enter the knockout bracket.",
      isPublished: true,
    },
    create: {
      id: COMP_ID,
      slug: COMP_SLUG,
      name: "1XCup 2026",
      season: "2026",
      type: "tournament",
      formatType: "1XCUP_MULTI_STAGE",
      status: "active",
      formatConfig: formatConfig as Prisma.InputJsonValue,
      country: "Nigeria",
      description:
        "1XCup 2026 starts with 100 teams across five Lagos zonal loser-go-home qualifiers. Twenty-four zone winners/qualifiers advance to six round-robin groups of four, before the best 16 teams enter the knockout bracket.",
      isPublished: true,
    },
  });

  const stageByKey = new Map<string, string>();
  for (const [index, zone] of ZONES.entries()) {
    const stage = await prisma.sbCompetitionStage.upsert({
      where: { competitionId_key: { competitionId: comp.id, key: `qualifying_${zone.key}` } },
      update: {
        name: zone.name,
        stageType: "qualifying",
        sortOrder: index + 1,
        config: { ...zone, tiebreaker: "penalty_shootout_no_extra_time" } as Prisma.InputJsonValue,
      },
      create: {
        competitionId: comp.id,
        key: `qualifying_${zone.key}`,
        name: zone.name,
        stageType: "qualifying",
        sortOrder: index + 1,
        config: { ...zone, tiebreaker: "penalty_shootout_no_extra_time" } as Prisma.InputJsonValue,
      },
    });
    stageByKey.set(zone.name, stage.id);
  }

  for (const stage of [
    ["group_stage", "Group Stage", "group", 10],
    ["knockout_stage", "Knockout Stage", "knockout", 20],
  ] as const) {
    await prisma.sbCompetitionStage.upsert({
      where: { competitionId_key: { competitionId: comp.id, key: stage[0] } },
      update: { name: stage[1], stageType: stage[2], sortOrder: stage[3], config: formatConfig as Prisma.InputJsonValue },
      create: {
        competitionId: comp.id,
        key: stage[0],
        name: stage[1],
        stageType: stage[2],
        sortOrder: stage[3],
        config: formatConfig as Prisma.InputJsonValue,
      },
    });
  }

  const matchIds = MATCHES.map((m) => matchId(m.matchCode));
  const teamSlugs = TEAMS.map((t) => t.slug);
  if (isFullSeed(options)) {
    await prisma.sbMatch.deleteMany({ where: { competitionId: comp.id, id: { notIn: matchIds } } });
    await prisma.sbTeam.deleteMany({ where: { competitionId: comp.id, slug: { notIn: teamSlugs } } });
  }

  const teamIds: Record<string, string> = {};
  for (const team of TEAMS) {
    const zone = teamZoneBySlug.get(team.slug) ?? team.zone ?? null;
    const row = await prisma.sbTeam.upsert({
      where: { competitionId_slug: { competitionId: comp.id, slug: team.slug } },
      update: {
        name: team.name,
        shortName: team.shortName,
        groupKey: zone ? zoneKey(zone) : null,
        city: zone?.replace(" Zone", "") ?? "Lagos",
        logoUrl: team.logoUrl,
      },
      create: {
        id: team.id,
        competitionId: comp.id,
        slug: team.slug,
        name: team.name,
        shortName: team.shortName,
        groupKey: zone ? zoneKey(zone) : null,
        city: zone?.replace(" Zone", "") ?? "Lagos",
        logoUrl: team.logoUrl,
      },
    });
    teamIds[team.slug] = row.id;
  }

  const usedMatchSlugs = await loadExistingMatchSlugs(prisma);
  for (const match of MATCHES) {
    const id = matchId(match.matchCode);
    if (await shouldPreserveSbMatch(prisma, id, options)) continue;
    const home = teamByKey.get(nameKey(match.homeName))!;
    const away = teamByKey.get(nameKey(match.awayName))!;
    const slug = allocateMatchSlug(home.slug, away.slug, usedMatchSlugs);
    await prisma.sbMatch.upsert({
      where: { id },
      update: {
        slug,
        homeScore: 0,
        awayScore: 0,
        status: "scheduled",
        minute: null,
        stageKey: `qualifying_${zoneKey(match.zone)}`,
        stageId: stageByKey.get(match.zone),
        matchday: tournamentDay(match),
        roundLabel: `${match.zone} - Qualifying Round 1 (${matchNumberLabel(match.matchCode)})`,
        venue: match.venue,
        kickoffAt: new Date(match.kickoffAt),
        homeTeamId: teamIds[home.slug],
        awayTeamId: teamIds[away.slug],
        stats: null,
        meta: {
          zone: match.zone,
          matchCode: match.matchCode,
          matchNumber: matchNumberLabel(match.matchCode),
          tournamentDay: tournamentDay(match),
          timezone: TIMEZONE,
          duration: "30 minutes each half and 7 minutes rest",
          tiebreaker: "Straight to penalty shootout if tied after regular time",
        } as Prisma.InputJsonValue,
      },
      create: {
        id,
        slug,
        competitionId: comp.id,
        stageKey: `qualifying_${zoneKey(match.zone)}`,
        stageId: stageByKey.get(match.zone),
        matchday: tournamentDay(match),
        homeTeamId: teamIds[home.slug],
        awayTeamId: teamIds[away.slug],
        status: "scheduled",
        homeScore: 0,
        awayScore: 0,
        minute: null,
        kickoffAt: new Date(match.kickoffAt),
        venue: match.venue,
        roundLabel: `${match.zone} - Qualifying Round 1 (${matchNumberLabel(match.matchCode)})`,
        stats: null,
        meta: {
          zone: match.zone,
          matchCode: match.matchCode,
          matchNumber: matchNumberLabel(match.matchCode),
          tournamentDay: tournamentDay(match),
          timezone: TIMEZONE,
          duration: "30 minutes each half and 7 minutes rest",
          tiebreaker: "Straight to penalty shootout if tied after regular time",
        } as Prisma.InputJsonValue,
      },
    });
  }

  for (const squad of SQUADS) {
    const team = teamByKey.get(nameKey(squad.teamName));
    if (!team) continue;
    const teamIdValue = teamIds[team.slug];
    const previousTeamRows = await prisma.sbTeamSquad.findMany({
      where: { teamId: teamIdValue },
      include: {
        player: {
          select: { id: true, displayName: true, normalizedName: true, slug: true },
        },
      },
    });
    await prisma.sbTeamSquad.deleteMany({ where: { teamId: teamIdValue } });
    for (const player of squad.players) {
      const linkedPlayer = await findOrCreate1XCupPlayer(
        prisma,
        player.name,
        player.position,
        previousTeamRows
      );
      await prisma.sbTeamSquad.create({
        data: {
          teamId: teamIdValue,
          playerId: linkedPlayer.id,
          displayName: linkedPlayer.displayName,
          position: player.position,
          shirtNumber: null,
        },
      });
    }
  }

  const [teamCount, matchCount, squadCount] = await Promise.all([
    prisma.sbTeam.count({ where: { competitionId: comp.id } }),
    prisma.sbMatch.count({ where: { competitionId: comp.id } }),
    prisma.sbTeamSquad.count({ where: { team: { competitionId: comp.id } } }),
  ]);

  console.log("1XCup 2026 seeded:", COMP_SLUG);
  console.log("  teams:", teamCount, "(expected 100)");
  console.log("  first-round fixtures:", matchCount, "(expected 50)");
  console.log("  squad players:", squadCount, "(expected 2321)");
  return { comp, teamCount, matchCount, squadCount };
}
