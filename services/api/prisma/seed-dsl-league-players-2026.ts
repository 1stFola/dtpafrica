/**
 * Dynasty Scouting League (DSL) 2026 — Player Seeding
 *
 * Seeds player data for the Dynasty Scouting League teams based on the provided roster data.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { playerLookupKey, normalizeClubName } from "@dtp/engines";

// admin-scoreboard.service declares splitPlayerName but does not export it, so
// importing it from there resolved to undefined and threw for every player.
import { splitPlayerName } from "../src/utils/player-utils";

const COMP_SLUG = "dsl-league-2026";

// Team name mappings from JSON to DSL team slugs
const TEAM_NAME_MAPPINGS: Record<string, string> = {
  "DREAM2REALITY FC": "d2r-fa",
  "FIMA FC": "fima-fc",
  "IMMACULATE FC U19": "immaculate-fc",
  "JUSTJOHN FC": "just-john-fc",
  "Kakawa FC": "kakawa-fc",
  "LEAL SC U19": "leal-fc",
  "OBAZZ FC U19": "obazz-fc",
  "Oduduwa FC": "oduduwa-fc",
  "Rock boys FA": "rock-boys-fa",
  "SGH SPORTS ACADEMY": "sgh-sa",
  "Stanique Football Club": "stanique-fc",
  "Super Accurate FA": "super-accurate-fa",
  "UTILITY SPORTS FC": "utility-sports-fc",
  // Note: "Easy Nter G U19" is not in the DSL teams, so it will be skipped
};

// Player data from the JSON provided
const PLAYER_DATA: Record<string, Array<{ fullName: string; position: string; shirtNumber: number }>> = {
  "DREAM2REALITY FC": [
    {"fullName": "SAMUEL OLUWALOMOLA", "position": "GK", "shirtNumber": 31},
    {"fullName": "RAMADAN ARIYO", "position": "GK", "shirtNumber": 1},
    {"fullName": "WAHAB AYOMIDE OLOYEDE", "position": "GK", "shirtNumber": 40},
    {"fullName": "DELBERT SIAKPERE", "position": "CB", "shirtNumber": 6},
    {"fullName": "JOSEPH AWONIYAN", "position": "CB", "shirtNumber": 25},
    {"fullName": "DAVID DARAMOLA", "position": "RB", "shirtNumber": 5},
    {"fullName": "GANIU YUSUF", "position": "LB", "shirtNumber": 14},
    {"fullName": "BAMIDELE AINA", "position": "LB", "shirtNumber": 35},
    {"fullName": "OLAMILEKAN KAYODE", "position": "DM", "shirtNumber": 12},
    {"fullName": "AYOMIDE LATEEF", "position": "DM", "shirtNumber": 4},
    {"fullName": "IBRAHIM MUHAMMED", "position": "DM", "shirtNumber": 22},
    {"fullName": "DIATA ASOR", "position": "DM", "shirtNumber": 10},
    {"fullName": "HABEEB ADELEKE", "position": "DM", "shirtNumber": 20},
    {"fullName": "DESMOND SOMTOCHUKWU", "position": "DM", "shirtNumber": 43},
    {"fullName": "KINGSLEY UNENGE", "position": "CM", "shirtNumber": 8},
    {"fullName": "FAROUQ SALAUDEEN", "position": "AM", "shirtNumber": 16},
    {"fullName": "VICTOR ODENIRAN", "position": "AM", "shirtNumber": 2},
    {"fullName": "HABEEB ABODUNRIN", "position": "AM", "shirtNumber": 15},
    {"fullName": "DAMILOLA OLUWASEGUN", "position": "AM", "shirtNumber": 28},
    {"fullName": "OLUWATOSIN OYASHOPE", "position": "AM", "shirtNumber": 27},
    {"fullName": "IDOWU AYINDE", "position": "LW", "shirtNumber": 42},
    {"fullName": "JOE BAIDOO", "position": "LW", "shirtNumber": 24},
    {"fullName": "TOBILOBA OLADOSU", "position": "RW", "shirtNumber": 39},
    {"fullName": "IDRIS OJENIYI", "position": "RW", "shirtNumber": 21},
    {"fullName": "GANIU GAFARU", "position": "RW", "shirtNumber": 7},
    {"fullName": "DAMILOLA SATUYI", "position": "ST", "shirtNumber": 19},
    {"fullName": "AYOMIDE AGANGA", "position": "ST", "shirtNumber": 34},
    {"fullName": "STANLEY AKPONURHIEVWE", "position": "ST", "shirtNumber": 9},
    {"fullName": "MORRISON EMMANUEL", "position": "ST", "shirtNumber": 23}
  ],
  "FIMA FC": [
    {"fullName": "ANOINTING ADELEKE", "position": "Left Wing", "shirtNumber": 2},
    {"fullName": "MICHAEL OBOH", "position": "Center Forward", "shirtNumber": 3},
    {"fullName": "FAVOUR TOLULOPE", "position": "Left Back", "shirtNumber": 4},
    {"fullName": "ATTAH IGOCHE", "position": "Attacking Midfield", "shirtNumber": 5},
    {"fullName": "TOHEEB AKANFA", "position": "Attacking Midfield", "shirtNumber": 6},
    {"fullName": "OGHENETEGA JAMES", "position": "Right Back", "shirtNumber": 7},
    {"fullName": "OLAWALE ODE", "position": "Center Back", "shirtNumber": 8},
    {"fullName": "TUNDE OMITOKUN", "position": "Defensive Midfield", "shirtNumber": 9},
    {"fullName": "ABDULHAKEEM ISHAQ", "position": "Center Forward", "shirtNumber": 10},
    {"fullName": "RAPHAEL ADERIBIGBE", "position": "Attacking Midfield", "shirtNumber": 11},
    {"fullName": "ABUBAKAR USMAN", "position": "Right Wing", "shirtNumber": 12},
    {"fullName": "AMTAGU INNOCENT", "position": "Center Back", "shirtNumber": 13},
    {"fullName": "SAMSUDEEN ADEWALE", "position": "Center Midfield", "shirtNumber": 14},
    {"fullName": "ABDULLAHI IBRAHIM", "position": "Right Wing", "shirtNumber": 15},
    {"fullName": "DAVID OGUNMADE", "position": "Right Wing/CF", "shirtNumber": 16},
    {"fullName": "ISRAEL ADEDOLA", "position": "Right Back/CB", "shirtNumber": 17},
    {"fullName": "TOMIWA BADA", "position": "Center Back", "shirtNumber": 18},
    {"fullName": "WASIU BIOBAKU", "position": "Left Wing/RW", "shirtNumber": 19},
    {"fullName": "ROQEEB AKINTAYO", "position": "Defensive Midfield", "shirtNumber": 22},
    {"fullName": "MICHAEL TERSEER", "position": "Goal Keeper", "shirtNumber": 1},
    {"fullName": "LUKMAN ABDULRASAQ", "position": "Goal Keeper", "shirtNumber": 55}
  ],
  "IMMACULATE FC U19": [
    {"fullName": "SHOLA OWOLABI", "position": "AMF", "shirtNumber": 7},
    {"fullName": "IDOWU OMOSEBI", "position": "RWF", "shirtNumber": 29},
    {"fullName": "ALABI SIKIRU", "position": "DM", "shirtNumber": 6},
    {"fullName": "CHUKWUEBUKA AGU", "position": "RB", "shirtNumber": 2},
    {"fullName": "CHINAZA CHUKWUDI", "position": "CM", "shirtNumber": 10},
    {"fullName": "ANTHONY ABAYOMI EDEMA", "position": "LWF", "shirtNumber": 11},
    {"fullName": "FRIDAY AUGUSTINE", "position": "GK", "shirtNumber": 21},
    {"fullName": "WISDOM CHRISTOPHER OTU", "position": "CB", "shirtNumber": 20},
    {"fullName": "DANIEL LOMBA", "position": "RWF", "shirtNumber": 16},
    {"fullName": "HAMMED YEKINI", "position": "CM", "shirtNumber": 18},
    {"fullName": "TITILOPE AZEEZ SHUAIB", "position": "CB", "shirtNumber": 30},
    {"fullName": "DAVID VICTOR", "position": "LWF", "shirtNumber": 17},
    {"fullName": "MANGANE DAUDA MOHAMMED", "position": "CB", "shirtNumber": 23},
    {"fullName": "OYINDAMOLA IDOWU", "position": "DM", "shirtNumber": 22},
    {"fullName": "GRACIOUS INEGBENOSIE", "position": "RWF", "shirtNumber": 19},
    {"fullName": "SABIU ISIYAKA", "position": "AMF", "shirtNumber": 27},
    {"fullName": "DAMILARE DAVID OGUNGBAMILA", "position": "CF", "shirtNumber": 24},
    {"fullName": "OLATUNJI OJO UKALLE", "position": "CF", "shirtNumber": 9},
    {"fullName": "UZOMA FAVOUR CHUKWU", "position": "LWF", "shirtNumber": 8},
    {"fullName": "PETER OGBU", "position": "DM", "shirtNumber": 25},
    {"fullName": "CHIKE CHRISTIAN EGWUOBA", "position": "RB", "shirtNumber": 3},
    {"fullName": "AYOBAMI JOODA", "position": "DM", "shirtNumber": 13},
    {"fullName": "KAREEM UMAR", "position": "RB", "shirtNumber": 28}
  ],
  "JUSTJOHN FC": [
    {"fullName": "ISSAH NURIEN", "position": "Wing Forward", "shirtNumber": 11},
    {"fullName": "MORUF ALADE", "position": "Center Attacking Midfilder", "shirtNumber": 2},
    {"fullName": "BALOGUN OLUWATOSIN", "position": "Right Back", "shirtNumber": 20},
    {"fullName": "MARVELOUS THIAGO. O", "position": "Center Attacking Midfilder", "shirtNumber": 10},
    {"fullName": "BASHIR TIJANI", "position": "Left Center Back", "shirtNumber": 3},
    {"fullName": "NWALI JOSHUA", "position": "Left Back", "shirtNumber": 28},
    {"fullName": "OGUNSANYA OLUWASEYI", "position": "Left Center Back", "shirtNumber": 29},
    {"fullName": "MAKINDE FAITH.A", "position": "Right Back", "shirtNumber": 16},
    {"fullName": "OGIDIOLU TOMIWA", "position": "Center Foward", "shirtNumber": 9},
    {"fullName": "OLAKANMI D. IYANU", "position": "Center Back", "shirtNumber": 15},
    {"fullName": "ADIGUN PETER", "position": "Center Back", "shirtNumber": 30},
    {"fullName": "OGUNYINKA MOSHOOD", "position": "Defensive Midfilder", "shirtNumber": 14},
    {"fullName": "BELLO FAVOUR.M", "position": "Defensive Midfilder", "shirtNumber": 32},
    {"fullName": "ALAYANDE OLUWAFEMI", "position": "Wing Forward", "shirtNumber": 36},
    {"fullName": "BAKARE O . AHMED", "position": "Center Midfilder", "shirtNumber": 27},
    {"fullName": "AKINSOLA A.TAJUDEEN", "position": "Wing Forward", "shirtNumber": 8},
    {"fullName": "ABIODUN GABRIEL", "position": "Wing Forward", "shirtNumber": 22},
    {"fullName": "TAJUDEEN MUHEEZ", "position": "Wing Forward", "shirtNumber": 25},
    {"fullName": "ALEEM SODIQ", "position": "LB/RWF", "shirtNumber": 19},
    {"fullName": "OLAWUYI KOLADE", "position": "Center Back", "shirtNumber": 12},
    {"fullName": "YUSUF FAIZ", "position": "Goal Keeper", "shirtNumber": 1},
    {"fullName": "ADEBISI TIMILEYIN.E", "position": "Goal Keeper", "shirtNumber": 23},
    {"fullName": "OMIDOKUN J. AMHED", "position": "Center Attacking Midfilder", "shirtNumber": 4},
    {"fullName": "OKOLI ANTHONY", "position": "Center Foward", "shirtNumber": 31},
    {"fullName": "FRANCIS BHEBHE", "position": "AM/Left Winger", "shirtNumber": 17}
  ],
  "Easy Nter G U19": [
    {"fullName": "OLUWATUNMISE AFOLABI", "position": "Defender", "shirtNumber": 31},
    {"fullName": "TAIYE HASSAN BASHIR", "position": "Forward", "shirtNumber": 32},
    {"fullName": "JAMIU OLAMIDE JIMOH", "position": "Midfielder", "shirtNumber": 35},
    {"fullName": "OLUWASEUN OWOLABI", "position": "Forward", "shirtNumber": 25}
  ],
  "Kakawa FC": [
    {"fullName": "MIRACLE ENOJO", "position": "CM/AM", "shirtNumber": 8},
    {"fullName": "GREAT AZELU", "position": "CB", "shirtNumber": 2},
    {"fullName": "DAMILARE AKINBOLA", "position": "LWF", "shirtNumber": 11},
    {"fullName": "PRAISE ONYEKWELIBE", "position": "RWF", "shirtNumber": 17},
    {"fullName": "DAVID STEPHEN", "position": "CF", "shirtNumber": 9},
    {"fullName": "IGWE CHRISTIAN", "position": "RB", "shirtNumber": 24},
    {"fullName": "DESTINY CHWUKUEMEKA", "position": "LWF", "shirtNumber": 7},
    {"fullName": "FREEDOM EBUBE", "position": "DM", "shirtNumber": 14},
    {"fullName": "DANIEL MOSES", "position": "CF", "shirtNumber": 13},
    {"fullName": "MOSES YIMAM", "position": "LB", "shirtNumber": 30},
    {"fullName": "IWALEWA OMOSOLA", "position": "CF", "shirtNumber": 18},
    {"fullName": "ABDULLAHI - DAUD OBASHOLA", "position": "GK", "shirtNumber": 22},
    {"fullName": "OLOWOGBOYE STEPHEN", "position": "DM", "shirtNumber": 4},
    {"fullName": "ADELEKE MUTIU OPEYEMI", "position": "GK", "shirtNumber": 1},
    {"fullName": "OLABODE DANIEL", "position": "LWF", "shirtNumber": 12},
    {"fullName": "AKINBOWALE AYOMIDE", "position": "CB", "shirtNumber": 31},
    {"fullName": "OLATUJA DAVID OWOLABI", "position": "CB", "shirtNumber": 15},
    {"fullName": "BROWNSON MOSES", "position": "CB", "shirtNumber": 5},
    {"fullName": "BADAMOSI MUSA", "position": "LWF", "shirtNumber": 19},
    {"fullName": "JAMES SAMSON", "position": "CM/DM", "shirtNumber": 10}
  ],
  "LEAL SC U19": [
    {"fullName": "MICHAEL ODUKOYA", "position": "Goalkeeper", "shirtNumber": 1},
    {"fullName": "SAMUEL OMOWA", "position": "Goalkeeper", "shirtNumber": 26},
    {"fullName": "JOHNSON ALIU", "position": "Defender", "shirtNumber": 5},
    {"fullName": "OLUSHOLA OGUNSAKIN", "position": "Defender", "shirtNumber": 12},
    {"fullName": "VICTOR ONAKOYA", "position": "Defender", "shirtNumber": 13},
    {"fullName": "MOYINOLUWA ODUBANJO", "position": "Defender", "shirtNumber": 22},
    {"fullName": "MUIZ OGUNLEYE", "position": "Defender", "shirtNumber": 23},
    {"fullName": "AFEEZ TIJANI", "position": "Defender", "shirtNumber": 25},
    {"fullName": "ADEDAYO ONAYEMI", "position": "Defender", "shirtNumber": 27},
    {"fullName": "TOBI ADEDEJI", "position": "Midfield", "shirtNumber": 4},
    {"fullName": "OLANIRE ODUTAYO", "position": "Midfield", "shirtNumber": 6},
    {"fullName": "BERNARD MENSAH", "position": "Midfield", "shirtNumber": 8},
    {"fullName": "TOBILOBA JOLASANMI", "position": "Midfield", "shirtNumber": 10},
    {"fullName": "OVIE JACOB", "position": "Midfield", "shirtNumber": 16},
    {"fullName": "KABIRU AKANBI", "position": "Midfield", "shirtNumber": 20},
    {"fullName": "IBRAHIM HAMMAD", "position": "Midfield", "shirtNumber": 24},
    {"fullName": "OLORUNTOBA ARE", "position": "Forward", "shirtNumber": 7},
    {"fullName": "SUNDAY OJEKA", "position": "Forward", "shirtNumber": 9},
    {"fullName": "ADEBAYO OMOSUYI", "position": "Forward", "shirtNumber": 11},
    {"fullName": "OPEYEMI BILIAMINU", "position": "Forward", "shirtNumber": 14},
    {"fullName": "OLANREWAJU KOLAWOLE", "position": "Forward", "shirtNumber": 15},
    {"fullName": "TAIYE ABDULWAHEED", "position": "Forward", "shirtNumber": 17},
    {"fullName": "DAMILOLA FADAYOMI", "position": "Forward", "shirtNumber": 18},
    {"fullName": "OKIKIOLA ADEDEJI", "position": "Forward", "shirtNumber": 19},
    {"fullName": "KOLAWOLE OLOWOLAGBA", "position": "Forward", "shirtNumber": 21}
  ],
  "OBAZZ FC U19": [
    {"fullName": "CHIDERA VICTOR", "position": "DEFENDER", "shirtNumber": 3},
    {"fullName": "TITUS EMMANUEL", "position": "DEFENDER", "shirtNumber": 6},
    {"fullName": "JONAH ANIEDI", "position": "MIDFIELDER", "shirtNumber": 8},
    {"fullName": "RIDWAN AYO", "position": "MIDFIELDER", "shirtNumber": 10},
    {"fullName": "ABEMIGHO SIMEON", "position": "MIDFIELDER", "shirtNumber": 13},
    {"fullName": "CLINTON KINGSLEY", "position": "MIDFIELDER", "shirtNumber": 7},
    {"fullName": "ONYEOZIRI CHUKWUDIRIM", "position": "FORWARD", "shirtNumber": 11},
    {"fullName": "ALI ANTHONY", "position": "FORWARD", "shirtNumber": 16},
    {"fullName": "SAMSON SIMON", "position": "FORWARD", "shirtNumber": 9},
    {"fullName": "MBAH FRANCIS", "position": "MIDFIELDER", "shirtNumber": 15},
    {"fullName": "WISDOM UMUNNAKWE", "position": "MIDFIELDER", "shirtNumber": 4},
    {"fullName": "BONIFACE AHUEKWE", "position": "GOAL KEEPER", "shirtNumber": 70},
    {"fullName": "IBECHIOLE CHUKWUEBUKA", "position": "FORWARD", "shirtNumber": 18},
    {"fullName": "OHAM IKENNA", "position": "FORWARD", "shirtNumber": 19},
    {"fullName": "SAHHU ABUBAKAR", "position": "MIDFIELDER", "shirtNumber": 2},
    {"fullName": "MICHAEL EMMANUEL", "position": "FORWARD", "shirtNumber": 14},
    {"fullName": "SANUSI AYOMIDE", "position": "DEFENDER", "shirtNumber": 5},
    {"fullName": "DENNIS EMMANUEL", "position": "FORWARD", "shirtNumber": 12},
    {"fullName": "EBUKA ANTHONY", "position": "FORWARD", "shirtNumber": 17},
    {"fullName": "SULEIMAN ALABI", "position": "GOALKEEPER", "shirtNumber": 80},
    {"fullName": "WAHAB JELILI", "position": "MIDFIELDER", "shirtNumber": 20},
    {"fullName": "TIJANI YUSUF", "position": "DEFENDER", "shirtNumber": 21},
    {"fullName": "ADEBISI AYORINDE", "position": "DEFENDER", "shirtNumber": 22},
    {"fullName": "SAKA LATEEF", "position": "FORWARD", "shirtNumber": 23},
    {"fullName": "TAJUDEEN YUSUF", "position": "FORWARD", "shirtNumber": 24}
  ],
  "Oduduwa FC": [
    {"fullName": "DANIEL SUNDAY", "position": "Goalkeeper", "shirtNumber": 36},
    {"fullName": "ISRAEL NICHOLAS", "position": "Goalkeeper", "shirtNumber": 26},
    {"fullName": "MARVELOUS EZENWOKE", "position": "Right Back", "shirtNumber": 13},
    {"fullName": "JAIRUS MARK", "position": "Right Back", "shirtNumber": 2},
    {"fullName": "QUADRI SHORINOLU", "position": "Right Back", "shirtNumber": 16},
    {"fullName": "RAMADAN QUADRI", "position": "Left Back", "shirtNumber": 18},
    {"fullName": "EMMANUEL RICHARD", "position": "Central Back", "shirtNumber": 4},
    {"fullName": "BABATUNDE SALAUDEEN", "position": "Central Back", "shirtNumber": 12},
    {"fullName": "HONEST EBOH", "position": "Central Back", "shirtNumber": 8},
    {"fullName": "IKECHUKWU UKACHUKWU", "position": "Central Back", "shirtNumber": 5},
    {"fullName": "MOSES MARCUS", "position": "Defensive Midfield", "shirtNumber": 10},
    {"fullName": "QUADRI AKANFE", "position": "Defensive Midfield", "shirtNumber": 6},
    {"fullName": "AYOMIDE ADEOYE", "position": "Defensive Midfield", "shirtNumber": 14},
    {"fullName": "OBAKOREDE AJOSE", "position": "Wing Forward", "shirtNumber": 20},
    {"fullName": "OLAMILEKAN TEMITOPE", "position": "Left Wing Forward", "shirtNumber": 19},
    {"fullName": "TOHEEB ADELEKE", "position": "Left Wing Forward", "shirtNumber": 22},
    {"fullName": "ALIAMEEN TORIOLA", "position": "Left Wing Forward", "shirtNumber": 17},
    {"fullName": "EMMANUEL BELLO", "position": "Centre Forward", "shirtNumber": 9},
    {"fullName": "AKOREDE AJAYI", "position": "Centre Forward", "shirtNumber": 25}
  ],
  "Rock boys FA": [
    {"fullName": "ADEBAYO BABATUNDE", "position": "Goal Kepper", "shirtNumber": 1},
    {"fullName": "MOHAMMED OLARENWAJU", "position": "Defensive Midfider", "shirtNumber": 2},
    {"fullName": "IBRAHIM ADIGUN", "position": "Left Back", "shirtNumber": 3},
    {"fullName": "LEKAN OLARENWAJU", "position": "Center Back", "shirtNumber": 4},
    {"fullName": "IBRAHIM ADEBAYO", "position": "Defensive Midfider", "shirtNumber": 5},
    {"fullName": "ILESANMI DAVID", "position": "Defensive Midfider", "shirtNumber": 6},
    {"fullName": "SAHEED ALANI", "position": "Attacking Midfider", "shirtNumber": 7},
    {"fullName": "MUJEEB SANYAOLU", "position": "Left Wing", "shirtNumber": 8},
    {"fullName": "LEKAN POPOOLA", "position": "Center Forward", "shirtNumber": 9},
    {"fullName": "ADIGUN USMAN", "position": "Right Back/Defensive mid", "shirtNumber": 10},
    {"fullName": "SHERIFF ADEPOJU", "position": "Right Wing", "shirtNumber": 11},
    {"fullName": "AYINDE QUAM", "position": "Defensive/Attacking Mid", "shirtNumber": 12},
    {"fullName": "IWALEHIN SAMUEL", "position": "Defensive Midfider", "shirtNumber": 13},
    {"fullName": "ALIYU MOHAMMED", "position": "Defensive Midfider", "shirtNumber": 14},
    {"fullName": "GIDEON OGU", "position": "Center Back", "shirtNumber": 15},
    {"fullName": "OGBU EMMANUEL", "position": "Center Back/Dm", "shirtNumber": 16},
    {"fullName": "EUGENE DOMINIC", "position": "Left/Right Wing", "shirtNumber": 17},
    {"fullName": "SAMUEL CLETUS", "position": "Left Back", "shirtNumber": 18},
    {"fullName": "IBRAHIM ALI", "position": "Right Wing/Center Forward", "shirtNumber": 19},
    {"fullName": "VICTOR CLETUS", "position": "Goal Kepper", "shirtNumber": 20},
    {"fullName": "ADELEKE SODEEQ", "position": "Right Back", "shirtNumber": 21}
  ],
  "SGH SPORTS ACADEMY": [
    {"fullName": "AJIBAYE BABATUNDE", "position": "Goal Keeper", "shirtNumber": 1},
    {"fullName": "TOBI SALIU", "position": "Right Back", "shirtNumber": 2},
    {"fullName": "SANGOBIYI SAMUEL", "position": "Left Back", "shirtNumber": 3},
    {"fullName": "ADEWALE SUNDAY", "position": "Center Back", "shirtNumber": 6},
    {"fullName": "AGBOOLA OLAYINKA", "position": "Center Back", "shirtNumber": 4},
    {"fullName": "UMOKE DAVID", "position": "Defensive Midfielder", "shirtNumber": 8},
    {"fullName": "ODUMESI BAMIDELE", "position": "Defensive Midfielder", "shirtNumber": 44},
    {"fullName": "ADEYEMI TOMIWA", "position": "Left Wing Forward", "shirtNumber": 20},
    {"fullName": "AFOLABI JESSE", "position": "Attacking Midfielder", "shirtNumber": 45},
    {"fullName": "ADEGBOYEGA JOHN", "position": "Right Wing Forward", "shirtNumber": 7},
    {"fullName": "IGWE DAVID", "position": "Center Forward", "shirtNumber": 9},
    {"fullName": "ABDULFATAI RAMAN", "position": "Attacking Midfielder", "shirtNumber": 14},
    {"fullName": "SALIHU TOHEEB", "position": "Attacking Midfielder", "shirtNumber": 15},
    {"fullName": "ADEBISI PETER", "position": "Defensive Midfielder", "shirtNumber": 25},
    {"fullName": "AYODIPUPO JOSHUA", "position": "Left Wing Forward", "shirtNumber": 88},
    {"fullName": "OBI DAVID", "position": "Right Back", "shirtNumber": 16},
    {"fullName": "OLADIPUPO IBRAHIM", "position": "Left Back", "shirtNumber": 18},
    {"fullName": "OSENI SULEMAN", "position": "Right Wing Forward", "shirtNumber": 17},
    {"fullName": "MUSA YUSUF", "position": "Center Forward", "shirtNumber": 11},
    {"fullName": "SOLAJA EMMANUEL", "position": "Attacking Midfielder", "shirtNumber": 12},
    {"fullName": "SAKA FOLORUNSHO", "position": "Center Back", "shirtNumber": 5},
    {"fullName": "ALABI AYODELE", "position": "Goal Keeper", "shirtNumber": 70}
  ],
  "Stanique Football Club": [
    {"fullName": "CHRISTOPHER MICHAEL", "position": "Goalkeeper", "shirtNumber": 25},
    {"fullName": "FRANKLIN GODWIN", "position": "Rightback", "shirtNumber": 13},
    {"fullName": "CHISOM NWOKORO", "position": "Center back", "shirtNumber": 6},
    {"fullName": "ANTHONY BENSON", "position": "Center back", "shirtNumber": 5},
    {"fullName": "EMMANUEL CHUKWU", "position": "Left back", "shirtNumber": 3},
    {"fullName": "MARVELOUS JONAH", "position": "Midfielder", "shirtNumber": 20},
    {"fullName": "TESTIMONY NZOM", "position": "Midfielder", "shirtNumber": 10},
    {"fullName": "JOSEPH UFELI", "position": "Midfielder", "shirtNumber": 8},
    {"fullName": "BENJAMIN JOSEPH", "position": "Midfielder", "shirtNumber": 7},
    {"fullName": "JOSEPH OKON", "position": "Center forward", "shirtNumber": 9},
    {"fullName": "COLLINS INNOCENT", "position": "Winger", "shirtNumber": 19},
    {"fullName": "ABDULAZEEZ OLAWALE", "position": "Midfielder", "shirtNumber": 16},
    {"fullName": "RUPHIN LUSUNGU", "position": "Midfielder", "shirtNumber": 14},
    {"fullName": "OMOTOYOSI ADEKUNLE", "position": "Center forward", "shirtNumber": 18},
    {"fullName": "EMMANUEL IME", "position": "Center back", "shirtNumber": 12},
    {"fullName": "ISAAC LOGNIE", "position": "Winger", "shirtNumber": 17},
    {"fullName": "MICHAEL OLAWALE", "position": "Midfielder", "shirtNumber": 21},
    {"fullName": "DESTINY DAVID", "position": "Winger", "shirtNumber": 11},
    {"fullName": "DAVID CHIDIEBERE", "position": "Center back", "shirtNumber": 4},
    {"fullName": "DANIEL EPHRAIM", "position": "Center back", "shirtNumber": 15},
    {"fullName": "LIGHT RAPHAEL", "position": "Goal keeper", "shirtNumber": 1},
    {"fullName": "ABRAHAM UNAM", "position": "Center forward", "shirtNumber": 23}
  ],
  "Super Accurate FA": [
    {"fullName": "ENOCH PAUL", "position": "Center Back", "shirtNumber": 5},
    {"fullName": "UBANI MARVELLOUS", "position": "Center Forward", "shirtNumber": 17},
    {"fullName": "AWOYEMI SESAN", "position": "Right Back", "shirtNumber": 22},
    {"fullName": "EBIGBO NNAEMEKA", "position": "Center Forward", "shirtNumber": 9},
    {"fullName": "ADEGBOLA TOHEEB", "position": "Center Back", "shirtNumber": 4},
    {"fullName": "MATTHEW ADEWALE", "position": "Attacking Midfilder", "shirtNumber": 15},
    {"fullName": "IBRAHIM SADIQ", "position": "Wing Forward", "shirtNumber": 20},
    {"fullName": "BISONG EMMANUEL", "position": "Defensive Midfilder", "shirtNumber": 16},
    {"fullName": "AKUDO CHIBUZOR", "position": "Attacking Midfilder", "shirtNumber": 28},
    {"fullName": "OWOYEMI MICHEAL", "position": "Left Back", "shirtNumber": 3},
    {"fullName": "HAMZAT KEHINDE", "position": "Wing Forward", "shirtNumber": 18},
    {"fullName": "MURITALA FARUQ", "position": "Defensive Midfilder", "shirtNumber": 14},
    {"fullName": "BADMUS KEHINDE", "position": "Wing Forward", "shirtNumber": 21},
    {"fullName": "OTEJU OLASHILE", "position": "Wing Forward", "shirtNumber": 8},
    {"fullName": "SUNDAY OREOLUWA", "position": "Right Back", "shirtNumber": 25},
    {"fullName": "ABIJO IBRAHIM", "position": "Goal Keeper", "shirtNumber": 1},
    {"fullName": "LAWAL JALAILU AYOMIDE", "position": "Attacking Midfilder", "shirtNumber": 10},
    {"fullName": "OYEKUNLE FUHAD", "position": "Center Midfilder", "shirtNumber": 12},
    {"fullName": "DAVID JOSEPH", "position": "Right Back", "shirtNumber": 13},
    {"fullName": "NWAKALAMBA JONATHAN", "position": "Goal Keeper", "shirtNumber": 50},
    {"fullName": "QUADRI ANIMASHAUN", "position": "Center Back", "shirtNumber": 19},
    {"fullName": "OMOTAYO ISREAL", "position": "Goal Keeper", "shirtNumber": 45},
    {"fullName": "USMAN JAFAR", "position": "Wing Forward", "shirtNumber": 11},
    {"fullName": "ISHAQ MUHAMMAD", "position": "Left Back", "shirtNumber": 30},
    {"fullName": "ADEPOJU ABDULMALIK", "position": "Center Back", "shirtNumber": 26},
    {"fullName": "JIMOH WAHAB", "position": "Wing Forward", "shirtNumber": 24},
    {"fullName": "ADEWUNMI PAUL", "position": "Defensive Midfilder", "shirtNumber": 29},
    {"fullName": "OKORIE ABRAHAM", "position": "Right Back", "shirtNumber": 2},
    {"fullName": "ONABANJO EMMANUEL", "position": "Wing Forward", "shirtNumber": 7},
    {"fullName": "QUAZEEN AHMID", "position": "Center Back", "shirtNumber": 27}
  ],
  "UTILITY SPORTS FC": [
    {"fullName": "GODDEY JOHNSON", "position": "GK", "shirtNumber": 22},
    {"fullName": "EBOH FAVOUR", "position": "GK", "shirtNumber": 1},
    {"fullName": "ABIGIDE ONOCHIE", "position": "LB/AM", "shirtNumber": 12},
    {"fullName": "VINCENT GIDEON", "position": "DM/LB", "shirtNumber": 3},
    {"fullName": "MICHAEL ESSIEN", "position": "RB", "shirtNumber": 24},
    {"fullName": "EMMANUEL OJO", "position": "LCB", "shirtNumber": 2},
    {"fullName": "AMANGER EMMANUEL", "position": "AMF/CMF", "shirtNumber": 18},
    {"fullName": "AKINSOLA WARIS", "position": "CB", "shirtNumber": 6},
    {"fullName": "DOMINION AMADIFE", "position": "CB", "shirtNumber": 5},
    {"fullName": "USMAN ISAAC", "position": "DM", "shirtNumber": 8},
    {"fullName": "ABDULKAREEM UMAR", "position": "CF", "shirtNumber": 76},
    {"fullName": "RIDWAN ABDULRAHMAN", "position": "AM/RW", "shirtNumber": 10},
    {"fullName": "OLEH BETHEL", "position": "LF", "shirtNumber": 20},
    {"fullName": "TEMILOLUWA LAJORIN", "position": "RF", "shirtNumber": 77},
    {"fullName": "KANU UGOCHUKWU", "position": "DMF/CB", "shirtNumber": 4},
    {"fullName": "GREAT UDORI", "position": "RF/LF", "shirtNumber": 19},
    {"fullName": "OGUNME BASIT", "position": "LF", "shirtNumber": 11},
    {"fullName": "ATSER SHEDRACH", "position": "LF", "shirtNumber": 7},
    {"fullName": "AMODU DAMILOLA", "position": "CF", "shirtNumber": 9},
    {"fullName": "DARLINGTON MBAMA", "position": "CF/LF", "shirtNumber": 99},
    {"fullName": "CELESTINE KWAGHMANDE", "position": "DMF", "shirtNumber": 16}
  ]
};

function normalizePosition(position: string): string {
  const posUpper = position.trim().toUpperCase();

  // Map various position formats to standard abbreviations
  if (posUpper.includes("GK") || posUpper.includes("GOAL")) return "GK";
  if (posUpper.includes("CB") || posUpper.includes("CENTRAL BACK") || posUpper.includes("CENTRE BACK")) return "CB";
  if (posUpper.includes("RB") || posUpper.includes("RIGHT BACK")) return "RB";
  if (posUpper.includes("LB") || posUpper.includes("LEFT BACK")) return "LB";
  if (posUpper.includes("WB") || posUpper.includes("WING BACK")) return posUpper.includes("LEFT") ? "LB" : "RB";
  if (posUpper.includes("DM") || posUpper.includes("DEFENSIVE MID")) return "DM";
  if (posUpper.includes("CM") || posUpper.includes("CENTRAL MID")) return "CM";
  if (posUpper.includes("AM") || posUpper.includes("ATTACKING MID")) return "AM";
  if (posUpper.includes("LM") || posUpper.includes("LEFT MID")) return "LM";
  if (posUpper.includes("RM") || posUpper.includes("RIGHT MID")) return "RM";
  if (posUpper.includes("LW") || posUpper.includes("LEFT WING") || posUpper.includes("LWF")) return "LW";
  if (posUpper.includes("RW") || posUpper.includes("RIGHT WING") || posUpper.includes("RWF")) return "RW";
  if (posUpper.includes("ST") || posUpper.includes("CENTER FORWARD") || posUpper.includes("CENTRE FORWARD") ||
      posUpper.includes("CF") || posUpper.includes("FORWARD")) return "ST";

  // Default to CM if we can't determine
  return "CM";
}

function normalizeShirtNumber(shirtNumber: unknown): number | null {
  if (typeof shirtNumber === "number" && !isNaN(shirtNumber) && shirtNumber >= 0 && shirtNumber <= 99) {
    return shirtNumber;
  }

  const num = Number(shirtNumber);
  if (!isNaN(num) && num >= 0 && num <= 99) {
    return num;
  }

  return null; // Will use null in DB if invalid
}

async function seedDslLeaguePlayers(prisma: PrismaClient) {
  console.log("🔄 Starting Dynasty Scouting League player seeding...");

  // Find the DSL competition
  const competition = await prisma.sbCompetition.findUnique({
    where: { slug: COMP_SLUG }
  });

  if (!competition) {
    throw new Error(`Competition with slug "${COMP_SLUG}" not found. Please run the DSL league seed first.`);
  }

  console.log(`📍 Found competition: ${competition.name} (${competition.id})`);

  // Get all teams in the DSL competition
  const teams = await prisma.sbTeam.findMany({
    where: { competitionId: competition.id },
    select: { id: true, slug: true, name: true }
  });

  console.log(`📊 Found ${teams.length} teams in the competition`);

  // Create a map of team name (normalized) to team ID for easy lookup
  const teamMap = new Map<string, string>();
  teams.forEach(team => {
    teamMap.set(normalizeClubName(team.name).toLowerCase(), team.id);
  });

  let totalPlayersCreated = 0;
  let totalPlayersSkipped = 0;

  // Process each team in the player data
  for (const [teamName, players] of Object.entries(PLAYER_DATA)) {
    // Skip teams not in DSL (like Easy Nter G U19)
    const teamSlug = TEAM_NAME_MAPPINGS[teamName];
    if (!teamSlug) {
      console.log(`⚠️  Skipping "${teamName}" - not found in DSL team mappings`);
      totalPlayersSkipped += players.length;
      continue;
    }

    // Find the team in our DSL teams
    const team = teams.find(t => t.slug === teamSlug);
    if (!team) {
      console.log(`⚠️  Skipping "${teamName}" (mapped to ${teamSlug}) - team not found in DSL`);
      totalPlayersSkipped += players.length;
      continue;
    }

    console.log(`👥 Processing ${team.name} (${team.slug}) - ${players.length} players`);

    // Process each player for this team
    for (const playerData of players) {
      try {
        const { fullName, position: rawPosition, shirtNumber: rawShirtNumber } = playerData;

        // Normalize data
        const position = normalizePosition(rawPosition);
        const shirtNumber = normalizeShirtNumber(rawShirtNumber);
        const { firstName, lastName } = splitPlayerName(fullName);
        const displayName = fullName.trim();
        // playerLookupKey is the directory's canonical dedupe key — it is what
        // admin-scoreboard.service writes and looks up by. normalizePlayerName
        // preserves casing, so using it here stored a key the admin UI could
        // never match, and re-adding a seeded player collided on Player.slug.
        const normalizedName = playerLookupKey(displayName);
        const slug = slugifyPlayerName(displayName); // We'll need to import this or create it

        // Check if player already exists by normalizedName
        let player = await prisma.player.findUnique({
          where: { normalizedName }
        });

        if (!player) {
          // Create new player
          player = await prisma.player.create({
            data: {
              firstName,
              lastName,
              displayName,
              normalizedName,
              slug,
              positionPrimary: position,
              registrationStatus: "approved",
              isPublic: true,
            }
          });

          console.log(`    ✅ Created player: ${displayName} (${position})`);
        } else {
          // Update existing player if needed (optional)
          await prisma.player.update({
            where: { id: player.id },
            data: {
              positionPrimary: position,
              // Keep other fields as-is to avoid overwriting existing data
            }
          });

          console.log(`    🔄 Updated player: ${displayName} (${position})`);
        }

        // Check if player already has a squad entry for this team
        const existingSquad = await prisma.sbTeamSquad.findFirst({
          where: {
            playerId: player.id,
            teamId: team.id
          }
        });

        if (!existingSquad) {
          // Create squad entry linking player to team
          await prisma.sbTeamSquad.create({
            data: {
              teamId: team.id,
              playerId: player.id,
              displayName,
              position,
              shirtNumber
            }
          });

          console.log(`    🔗 Linked ${displayName} to ${team.name} (shirt #${shirtNumber ?? 'N/A'})`);
          totalPlayersCreated++;
        } else {
          // Update existing squad entry if needed
          await prisma.sbTeamSquad.update({
            where: { id: existingSquad.id },
            data: {
              displayName,
              position,
              shirtNumber
            }
          });

          console.log(`    🔄 Updated squad entry for ${displayName} in ${team.name}`);
          totalPlayersCreated++; // Still count as processed
        }
      } catch (error) {
        console.error(`❌ Error processing player ${playerData.fullName}:`, error);
        totalPlayersSkipped++;
      }
    }
  }

  console.log(`\n🎉 DSL Player Seeding Complete:`);
  console.log(`   ✅ Players processed: ${totalPlayersCreated}`);
  console.log(`   ⚠️  Players skipped: ${totalPlayersSkipped}`);

  return {
    playersCreated: totalPlayersCreated,
    playersSkipped: totalPlayersSkipped
  };
}

// Helper function to slugify player names (similar to what's used elsewhere)
function slugifyPlayerName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export { seedDslLeaguePlayers };