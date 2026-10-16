/**
 * United Football Championship League 2026 — the registered squads.
 *
 * Source: the clubs' own entries on the "UFC 2026 Season – Player Registration"
 * form, exported on 16 October 2026. Eleven of the twelve clubs had registered;
 * BOX2BOX FC had not, so it has no roster here and its squad stays empty until
 * one arrives.
 *
 * What was changed from the export, and nothing else:
 *   - A name written entirely in capitals (`DANJUMA LAZARUS`) is title-cased
 *     (`Danjuma Lazarus`), token by token, so `EGUAKUN Lucky` becomes
 *     `Eguakun Lucky`. A lowercase surname (`Aina oladayo`) is left as the club
 *     typed it: the rule only touches a name that shouts.
 *   - One name was typed in Unicode "mathematical bold" letters, which are not
 *     the letters they look like and would never match a search; it is folded
 *     to plain text (`Prince Coman`).
 *   - The form's position labels (`Defensive Midfielder (DM)`) are kept as the
 *     code in brackets, which is what every other ScoreBoard squad stores.
 *   - Photos are not carried over: the export holds private form-storage links
 *     that expire, not image URLs.
 *
 * Two clubs registered a player called Usman Mohammed (G12 #21, The Charlesann
 * FC #6). The directory keys players on name, so the second row would attach the
 * same player to a second squad of this league; the seed holds it back and says
 * so, rather than guessing whether they are one person. Both rows stay in the
 * data so the hold-back is visible here and in the seed's output.
 *
 * Additive, like every seed: a player is resolved or created exactly as the
 * admin squad import does it (same lookup, same draft shell), a squad row is
 * created only when the team has no row for that player, and an existing row is
 * only ever given its missing player link. A shirt number or position changed
 * in admin is never reset.
 */
import type { PrismaClient } from "@prisma/client";
import { playerLookupKey } from "@dtp/engines";
import { PlayerDirectoryService } from "../src/scoreboard/player-directory.service";
import type { PrismaService } from "../src/prisma/prisma.service";
import { PlaceholderPlayerNameError } from "../src/players/placeholder-names";
import { tidyPlayerName } from "../src/players/tidy-player-name";
import { COMP_SLUG, TEAMS } from "./seed-united-football-championship-league-2026";

export type RosterRow = { shirt: number | null; name: string; position: string | null };
export type RosterSeed = { teamSlug: string; players: RosterRow[] };

export const ROSTERS: RosterSeed[] = [
  {
    teamSlug: "jumez-international-fc",
    players: [
      { shirt: 18, name: "Aina oladayo", position: "DM" },
      { shirt: 6, name: "Oriaku Nnamdi", position: "CB" },
      { shirt: 13, name: "Kazeem lateef", position: "ST" },
      { shirt: 7, name: "Koboko Benjamin", position: "RW" },
      { shirt: 15, name: "Oladeji olamilekan", position: "LB" },
      { shirt: 3, name: "Amusa Qudus", position: "AM" },
      { shirt: 4, name: "Aminu ibrahim", position: "DM" },
      { shirt: 16, name: "Efoli godwill", position: "LW" },
      { shirt: 10, name: "Al Hasaan Anassa", position: "CM" },
      { shirt: 2, name: "Ejiofor Christopher", position: "LB" },
      { shirt: 1, name: "Ajala tobiloba", position: "GK" },
      { shirt: 9, name: "Umoru Eshiakhane", position: "ST" },
      { shirt: 8, name: "Eguakun Lucky", position: "AM" },
      { shirt: 12, name: "Ibimie prosper", position: "LW" },
      { shirt: 17, name: "Ola Aina Azeez", position: "CB" },
      { shirt: 11, name: "Oyinlola taiwo", position: "RW" },
      { shirt: 14, name: "Fuludu victor", position: "CM" },
      { shirt: 19, name: "Onwubuya goodluck", position: "RB" },
      { shirt: 21, name: "Uzoma chinonso", position: "CM" },
      { shirt: 20, name: "Atorose odunayomi Emmanuel", position: "CB" },
      { shirt: 23, name: "Sodiq maitama", position: "RB" },
      { shirt: 5, name: "Azeez Abeeb", position: "CB" },
      { shirt: 24, name: "Asekun Samuel", position: "GK" },
      { shirt: 25, name: "Augustine Friday", position: "GK" },
    ],
  },
  {
    teamSlug: "right-to-play-football-academy",
    players: [
      { shirt: 18, name: "Olatunji Joseph", position: "LW" },
      { shirt: 11, name: "Samuel Adetunji-Adefeso", position: "LW" },
      { shirt: 5, name: "Ariwoola Yusuf", position: "RB" },
      { shirt: 20, name: "Ibrahim Idris", position: "ST" },
      { shirt: 7, name: "Akinfolarin Stephen", position: "LW" },
      { shirt: 21, name: "David Yusuf", position: "ST" },
      { shirt: 10, name: "Monday Osakwe", position: "DM" },
      { shirt: 29, name: "Moshood Adisa", position: "RW" },
      { shirt: 1, name: "John Emmanuel Rotimi", position: "GK" },
      { shirt: 26, name: "Emmanuel Opara", position: "CM" },
      { shirt: 4, name: "Kingsley Kokoh", position: "DM" },
      { shirt: 19, name: "Olamilekan Olasanjo", position: "DM" },
      { shirt: 3, name: "Olumide olulegan", position: "RW" },
      { shirt: 6, name: "Prince Coman", position: "CB" },
      { shirt: 16, name: "Samuel sadem", position: "LB" },
      { shirt: 27, name: "Oluwabukunmi Akinwale", position: "ST" },
      { shirt: 8, name: "Muktar Mustapha", position: "AM" },
      { shirt: 14, name: "Ilyas Durosinmi", position: "CM" },
      { shirt: 27, name: "Abdullah Afolabi", position: "DM" },
      { shirt: 25, name: "Yusuf olagoke", position: "LW" },
      { shirt: 15, name: "Solomon Adams", position: "CB" },
      /* Registered without a position. */
      { shirt: 17, name: "Teslim Umar", position: null },
    ],
  },
  {
    teamSlug: "dominion-hotspur-fc",
    players: [
      { shirt: 1, name: "Danjuma Lazarus", position: "GK" },
      { shirt: 2, name: "Ohunuma Wisdom", position: "RB" },
      { shirt: 3, name: "Bashiru David", position: "LB" },
      { shirt: 5, name: "Daniel Okon", position: "CB" },
      { shirt: 12, name: "Odukoya Tunde", position: "LB" },
      { shirt: 8, name: "Adeleke Soliu", position: "AM" },
      { shirt: 17, name: "Rasq Tolani", position: "CM" },
      { shirt: 19, name: "Oladega Malik", position: "AM" },
      { shirt: 16, name: "Elebhose Savior", position: "DM" },
      { shirt: 6, name: "Okechukwu Charles", position: "DM" },
      { shirt: 4, name: "Danjuma Enoch", position: "DM" },
      { shirt: 7, name: "Ohunuma Daniel", position: "LW" },
      { shirt: 9, name: "Esu Cyril", position: "ST" },
      { shirt: 10, name: "Edeh Obinna", position: "LW" },
      { shirt: 14, name: "Enweliku Chisom", position: "RW" },
      { shirt: 18, name: "Henshaw Solomon", position: "RW" },
      { shirt: 15, name: "Nwakpa Chidera", position: "ST" },
      { shirt: 11, name: "Ihitegbulem Chinonso", position: "LW" },
      { shirt: 22, name: "Udeofor Uchenna", position: "CB" },
      { shirt: 23, name: "Ebri Believe", position: "DM" },
      { shirt: 24, name: "Joshua Jibril", position: "RW" },
      { shirt: 20, name: "Osunde Peter", position: "GK" },
      { shirt: 25, name: "Olorunimbe Basit", position: "RB" },
      { shirt: 13, name: "Abdulahi Quadri", position: "LB" },
      { shirt: 27, name: "John Jeffery", position: "DM" },
      { shirt: 21, name: "Michael Patrick", position: "RW" },
      { shirt: 29, name: "Patrick Olamide", position: "CB" },
    ],
  },
  {
    teamSlug: "ablaze-fc",
    players: [
      { shirt: 10, name: "Yusuf Murtala", position: "AM" },
      { shirt: 1, name: "Emmanuel Akinola", position: "GK" },
      { shirt: 17, name: "Enoch Olanrewaju", position: "CM" },
      { shirt: 9, name: "Fuwad Oseni", position: "ST" },
      { shirt: 14, name: "Timilehin Agbonjimi", position: "LW" },
      { shirt: 15, name: "Idowu Ajao", position: "DM" },
      { shirt: 3, name: "Ridwan Bolaji", position: "CB" },
      { shirt: 2, name: "Godwin Onobi", position: "RB" },
      { shirt: 7, name: "Michael Joseph", position: "RW" },
      { shirt: 12, name: "Basit Olugbade", position: "LB" },
      { shirt: 16, name: "Sunday Lucky", position: "RB" },
      { shirt: 5, name: "Noah Ashaka", position: "DM" },
      { shirt: 25, name: "Quwiy Onilude", position: "ST" },
      { shirt: 13, name: "Waris Abdullahi", position: "ST" },
      { shirt: 4, name: "Olanrewaju Oseni", position: "CB" },
      { shirt: 20, name: "Michael Akinmosin", position: "AM" },
      { shirt: 6, name: "Kadiri Sultan", position: "CM" },
      { shirt: 11, name: "Tofunmi Adeshina", position: "ST" },
      { shirt: 8, name: "Kehinde Salaudeen", position: "CM" },
      { shirt: 19, name: "Hammed Yussuf", position: "DM" },
      { shirt: 22, name: "Idris Hudu", position: "ST" },
      { shirt: 23, name: "Ifeanyi Ayalogu", position: "LW" },
      { shirt: 18, name: "Ireoluwasubomi Igbasan", position: "GK" },
      { shirt: 21, name: "Habeeb Busari", position: "AM" },
    ],
  },
  {
    teamSlug: "g12-football-club",
    players: [
      { shirt: 1, name: "Pascal Ngembus", position: "GK" },
      { shirt: 13, name: "Terry Stephen", position: "CB" },
      /* Also registered by The Charlesann FC as #6; see the file comment. */
      { shirt: 21, name: "Usman Mohammed", position: "CB" },
      { shirt: 3, name: "Ryan Olatunji", position: "LB" },
      { shirt: 22, name: "Kehinde Adesokan", position: "LB" },
      { shirt: 26, name: "Dermaine Amadou", position: "DM" },
      { shirt: 17, name: "Andrew Okem", position: "AM" },
      { shirt: 14, name: "Akram Ojokuku", position: "DM" },
      { shirt: 10, name: "Abayomi Adelowo", position: "DM" },
      { shirt: 16, name: "Yusuf Adelupe", position: "CM" },
      { shirt: 4, name: "Ibrahim Fatai", position: "AM" },
      { shirt: 27, name: "Mohammed Basiru", position: "LW" },
      { shirt: 11, name: "Chinedu Uwakwe", position: "RW" },
      { shirt: 28, name: "Mohammed Auwal", position: "RW" },
      { shirt: 7, name: "Fabrice Labode", position: "RW" },
      { shirt: 23, name: "Miracle Eroni", position: "LW" },
      { shirt: 19, name: "Damilare Salako", position: "ST" },
      { shirt: 12, name: "Success Ubogu", position: "ST" },
      { shirt: 9, name: "Samuel Sunday", position: "ST" },
      { shirt: 29, name: "Jesugbemi Paul", position: "ST" },
      { shirt: 25, name: "Olamilekan Oladele", position: "LB" },
      { shirt: 8, name: "Usman Lateef", position: "DM" },
      { shirt: 2, name: "Shuaib Aromashodun", position: "RB" },
      { shirt: 6, name: "Favour Oladipo", position: "DM" },
      { shirt: 20, name: "Adamu Yinusa", position: "LB" },
      { shirt: 30, name: "Daniel Favour", position: "LW" },
      { shirt: 62, name: "Mohammed Abdulganiu", position: "GK" },
      { shirt: 60, name: "Adedamola Elebiju", position: "GK" },
      { shirt: 15, name: "Micheal Noutai", position: "RB" },
    ],
  },
  {
    teamSlug: "evolution-united-football-academy",
    players: [
      { shirt: 1, name: "Ahmed usman", position: "GK" },
      { shirt: 22, name: "Ayuba jesse", position: "RB" },
      { shirt: 12, name: "Sikiru abubekar", position: "RB" },
      { shirt: 6, name: "Onyeji chidera", position: "CB" },
      { shirt: 5, name: "Iyinbor David", position: "CB" },
      { shirt: 3, name: "Femi Solomon", position: "LB" },
      { shirt: 14, name: "Olanrewaju basit", position: "CB" },
      { shirt: 13, name: "Itoro benjamin", position: "LB" },
      { shirt: 15, name: "Edwin chidera", position: "DM" },
      { shirt: 4, name: "Ekenze favor obinna", position: "DM" },
      { shirt: 10, name: "Idowu babatunde", position: "AM" },
      { shirt: 8, name: "tajudeen fawaz", position: "CM" },
      { shirt: 25, name: "Jude frank", position: "CM" },
      { shirt: 20, name: "Jimoh muyideen", position: "RW" },
      { shirt: 23, name: "Olateju bature", position: "RW" },
      { shirt: 9, name: "Christopher Emmanuel", position: "ST" },
      { shirt: 21, name: "Abdulwaheed Mohammed", position: "ST" },
      { shirt: 11, name: "Olaopa Toheeb", position: "LW" },
      { shirt: 16, name: "Adoh Chuks", position: "CM" },
      { shirt: 17, name: "Francis Ebuka", position: "ST" },
      { shirt: 24, name: "Sunday jenas", position: "RW" },
      { shirt: 29, name: "Monday Olamiposi", position: "ST" },
      { shirt: 30, name: "Chukwu Victor", position: "CB" },
      { shirt: 19, name: "Agboola Mubarak", position: "GK" },
      { shirt: 27, name: "Chima Moses", position: "LW" },
      { shirt: 26, name: "Aweda Yusuf", position: "CM" },
      { shirt: 18, name: "Moses Isreal", position: "DM" },
      { shirt: 2, name: "Tytus Innocent", position: "CB" },
      { shirt: 7, name: "Shehu sulaimon", position: "LW" },
    ],
  },
  {
    teamSlug: "honey-badger-fc",
    players: [
      { shirt: 10, name: "Adakole Hillary", position: "AM" },
      { shirt: 11, name: "Christian Emmanuel", position: "LW" },
      { shirt: 16, name: "David Esejindu", position: "CM" },
      { shirt: 15, name: "Lekan suleiman", position: "CM" },
      { shirt: 17, name: "Abubakar Sadiq", position: "LW" },
      { shirt: 25, name: "David Chima", position: "CB" },
      { shirt: 21, name: "Chukwube Nwafor", position: "RW" },
      { shirt: 7, name: "Jonathan Izunna", position: "LW" },
      { shirt: 2, name: "Ebube Egenamba", position: "RB" },
      { shirt: 19, name: "Tamunokuro pabo", position: "RW" },
      { shirt: 5, name: "Richard Johnson", position: "CB" },
      { shirt: 1, name: "David Nworie", position: "GK" },
      { shirt: 4, name: "Joshua Ojo", position: "DM" },
      { shirt: 12, name: "Oluwapelumi Ajibola", position: "RW" },
      { shirt: 6, name: "Arthur Sifon", position: "CB" },
      { shirt: 3, name: "Ebube luke John", position: "LB" },
      { shirt: 13, name: "Usaini Adam suleiman", position: "LB" },
      { shirt: 9, name: "Korede Ademola", position: "ST" },
      { shirt: 22, name: "Richard Ephraim", position: "GK" },
      { shirt: 27, name: "Pius Inah", position: "ST" },
      { shirt: 27, name: "Solomon Nwaoha", position: "RW" },
      { shirt: 26, name: "Emmanuel Chujor", position: "AM" },
      { shirt: 30, name: "Leke Odunuga", position: "GK" },
      { shirt: 15, name: "Tersugh Elijah", position: "DM" },
      { shirt: 18, name: "Abdulrahmon Musbau Oluwapelumi", position: "CB" },
      { shirt: 28, name: "Melvin Ebitimi Joshua", position: "CB" },
    ],
  },
  {
    teamSlug: "the-charlesann-fc",
    players: [
      { shirt: 32, name: "Daniel Emmanuel", position: "GK" },
      { shirt: 90, name: "Michael Unehi", position: "GK" },
      { shirt: 10, name: "Jones Sunday", position: "AM" },
      { shirt: 15, name: "Sontom Nwafor", position: "CB" },
      { shirt: 12, name: "Ifeanyi Victor", position: "RB" },
      { shirt: 13, name: "Uche Benjamin", position: "LB" },
      { shirt: 4, name: "Victory Cosmas", position: "DM" },
      { shirt: 24, name: "Joel Echiezona", position: "DM" },
      /* Held back by the seed while G12 holds the player of this name. */
      { shirt: 6, name: "Usman Mohammed", position: "CM" },
      { shirt: 8, name: "Paul Taiwo", position: "AM" },
      { shirt: 11, name: "Israel Iboyi", position: "LW" },
      { shirt: 21, name: "Mesoma Onyenze", position: "RW" },
      { shirt: 7, name: "Bright Uba", position: "LW" },
      { shirt: 14, name: "David Matthew", position: "RW" },
      { shirt: 17, name: "Usman Babatunde", position: "ST" },
      { shirt: 9, name: "Tobiloba Olubo", position: "ST" },
      { shirt: 30, name: "Solomon Justice", position: "ST" },
      { shirt: 2, name: "Oluseun Oladele", position: "RB" },
      { shirt: 16, name: "James Abo", position: "CM" },
      { shirt: 27, name: "Kamara Amah", position: "LW" },
      { shirt: 51, name: "Sunday Ufram", position: "GK" },
      { shirt: 5, name: "Utibe Michael Esenowo", position: "CB" },
      { shirt: 23, name: "Robert Akuna", position: "ST" },
    ],
  },
  {
    teamSlug: "patnik-football-academy",
    players: [
      { shirt: 90, name: "Abdulateef Akanbi", position: "GK" },
      { shirt: 1, name: "Akolade Oluwasegun", position: "GK" },
      { shirt: 88, name: "Soyombo Joseph", position: "GK" },
      { shirt: 2, name: "Michael Taiwo", position: "RB" },
      { shirt: 4, name: "Oscar Obi Jachimike", position: "CB" },
      { shirt: 13, name: "Omolade Ayomikun", position: "RB" },
      { shirt: 3, name: "Nkemjika Anyanwu", position: "LB" },
      { shirt: 5, name: "Chieme Bright", position: "CB" },
      { shirt: 17, name: "Ayorinde Tope", position: "LB" },
      { shirt: 10, name: "Adewale Aduragbemi", position: "CM" },
      { shirt: 11, name: "Simon Pius", position: "LW" },
      { shirt: 19, name: "Haruna Abdulkareem", position: "CB" },
      { shirt: 16, name: "Kelechi Christopher", position: "RW" },
      { shirt: 12, name: "Adam Balarabe", position: "CM" },
      { shirt: 8, name: "Amata Samuel", position: "AM" },
      { shirt: 14, name: "Sunday Ezekiel", position: "CM" },
      { shirt: 7, name: "Osuji Kingsley", position: "RW" },
      { shirt: 9, name: "Ameh Sunday", position: "ST" },
      { shirt: 23, name: "Marvellous Agbelesebiomo", position: "ST" },
      { shirt: 6, name: "Aaron Innocent", position: "DM" },
      { shirt: 15, name: "Olayemi Ashiru", position: "DM" },
      { shirt: 18, name: "Soliu Adisa", position: "RW" },
      { shirt: 20, name: "Sunday Akoh", position: "AM" },
      { shirt: 22, name: "Emmanuel Iwuanyanwu", position: "RB" },
      { shirt: 24, name: "Emeka Ewelike", position: "RW" },
      { shirt: 25, name: "Olusegun Abel", position: "ST" },
      { shirt: 24, name: "Anagor Daniel", position: "RW" },
    ],
  },
  {
    teamSlug: "fc-bethel-sporting",
    players: [
      { shirt: 20, name: "Abiodun Babatunde", position: "GK" },
      { shirt: 1, name: "Abubakar Abubakar", position: "CB" },
      { shirt: 24, name: "Mark Adoga", position: "RB" },
      { shirt: 5, name: "Jonathan Ebunu", position: "CB" },
      { shirt: 4, name: "Eric Boma", position: "CB" },
      { shirt: 15, name: "Farinde Tobi", position: "LB" },
      { shirt: 12, name: "Chukwubueze Israel", position: "LB" },
      { shirt: 13, name: "Nelson Emmanuel", position: "CB" },
      { shirt: 10, name: "Okereke Joshua", position: "AM" },
      { shirt: 6, name: "Enuka Emmanuel", position: "DM" },
      { shirt: 8, name: "Ezike Mircale", position: "DM" },
      { shirt: 14, name: "Nwuzi Victor", position: "AM" },
      { shirt: 23, name: "Dosa Femi", position: "CM" },
      { shirt: 22, name: "Chisom Nwakama", position: "AM" },
      { shirt: 17, name: "Afolabi Lekan", position: "ST" },
      { shirt: 7, name: "Tijjani Ridwan", position: "LW" },
      { shirt: 11, name: "Ojo Jordan", position: "RW" },
      { shirt: 9, name: "Egbe Elvis", position: "ST" },
      { shirt: 27, name: "Sunday Jonathan", position: "ST" },
      { shirt: 17, name: "Itanko Moses", position: "RW" },
      { shirt: 18, name: "Olaitan Fawas", position: "RW" },
      { shirt: 19, name: "Ayinla Awal", position: "LW" },
    ],
  },
  {
    teamSlug: "springsoca-united",
    players: [
      { shirt: 11, name: "Eniola Tanko", position: "RB" },
      { shirt: 90, name: "Tochukwu Chineziako", position: "GK" },
      { shirt: 9, name: "Tega Obibi Noah", position: "ST" },
      { shirt: 32, name: "Hal-ameen Ojolowo", position: "RB" },
      { shirt: 1, name: "Samuel Victor", position: "GK" },
      { shirt: 15, name: "Rilwan Lasisi", position: "RB" },
      { shirt: 19, name: "Egeonu Chidera", position: "AM" },
      { shirt: 8, name: "Adam Ibrahim", position: "RW" },
      { shirt: 14, name: "Ogbonne Chibueze", position: "DM" },
      { shirt: 99, name: "Chaseley Chisom", position: "GK" },
      { shirt: 10, name: "Okechukwu Onyedikachi Stanley", position: "CB" },
      { shirt: 12, name: "Daniel Odunayo", position: "LB" },
      { shirt: 52, name: "Onyeka Daniel", position: "DM" },
      { shirt: 45, name: "Shobowale Farouq", position: "ST" },
      { shirt: 33, name: "Ajayi Ayomide", position: "CM" },
      { shirt: 65, name: "Ifeanyi Ejike", position: "CM" },
      { shirt: 2, name: "Onwere Chizara", position: "LW" },
      { shirt: 76, name: "John Ebuka", position: "LB" },
      { shirt: 85, name: "Sunday Taina Patrick", position: "CM" },
      { shirt: 44, name: "Aremu Ridwan", position: "CB" },
      { shirt: 50, name: "Jimoh Babatunde Muhammed", position: "CM" },
      { shirt: 43, name: "Idowu Muiz", position: "CM" },
      { shirt: 69, name: "Precious Isaac", position: "ST" },
      { shirt: 21, name: "Maduka Daniel", position: "RB" },
      { shirt: 53, name: "Mabini Anuoluwapo Oluwasegun", position: "RW" },
      { shirt: 25, name: "Nwaserije Prince", position: "CM" },
    ],
  },
];

/**
 * What is wrong with the roster data itself, before any database is involved.
 * Empty when every team slug is a UFC club and no club lists one player twice.
 */
export function rosterProblems(rosters: RosterSeed[] = ROSTERS): string[] {
  const out: string[] = [];
  const known = new Set(TEAMS.map((t) => t.slug));
  for (const roster of rosters) {
    if (!known.has(roster.teamSlug)) out.push(`${roster.teamSlug} is not a UFC club`);
    const seen = new Map<string, string>();
    for (const row of roster.players) {
      const key = playerLookupKey(tidyPlayerName(row.name));
      if (!key) out.push(`${roster.teamSlug}: a row has no name`);
      const first = seen.get(key);
      if (first) out.push(`${roster.teamSlug}: ${row.name} is listed twice (also as ${first})`);
      else seen.set(key, row.name);
      if (row.shirt != null && (!Number.isInteger(row.shirt) || row.shirt < 0 || row.shirt > 999)) {
        out.push(`${roster.teamSlug}: ${row.name} has shirt ${row.shirt}`);
      }
    }
  }
  return out;
}

export type SquadSeedResult = {
  created: number;
  linked: number;
  unchanged: number;
  /** Rows not written, each with the reason. */
  heldBack: string[];
  /** Squad size per team slug after the run. */
  squadSizes: Record<string, number>;
};

export async function seedUnitedFootballChampionshipLeague2026Squads(
  prisma: PrismaClient
): Promise<SquadSeedResult> {
  const dataProblems = rosterProblems();
  if (dataProblems.length) {
    throw new Error(`UFC 2026 roster data: ${dataProblems.join("; ")}`);
  }

  const comp = await prisma.sbCompetition.findUnique({
    where: { slug: COMP_SLUG },
    select: { id: true },
  });
  if (!comp) {
    throw new Error(`${COMP_SLUG} is not in the database; the league seed runs before this one`);
  }
  const teams = await prisma.sbTeam.findMany({
    where: { competitionId: comp.id },
    select: { id: true, slug: true, name: true },
  });
  const teamBySlug = new Map(teams.map((t) => [t.slug, t]));

  /* The same resolver the admin squad import uses, so a seeded player and an
     imported one are indistinguishable: tidied name, directory lookup by key,
     display name and slug, and a draft shell when nobody matches. PrismaService
     only adds lifecycle hooks to PrismaClient, which the resolver never calls. */
  const directory = new PlayerDirectoryService(prisma as PrismaService);

  const result: SquadSeedResult = {
    created: 0,
    linked: 0,
    unchanged: 0,
    heldBack: [],
    squadSizes: {},
  };

  for (const roster of ROSTERS) {
    const team = teamBySlug.get(roster.teamSlug);
    if (!team) {
      result.heldBack.push(`${roster.teamSlug}: no such team in ${COMP_SLUG}`);
      continue;
    }
    for (const row of roster.players) {
      const displayName = tidyPlayerName(row.name);
      const label = `${displayName} (${team.name}${row.shirt == null ? "" : ` #${row.shirt}`})`;

      let player: { id: string };
      try {
        player = await directory.resolveOrCreatePlayer(displayName, row.position);
      } catch (error) {
        if (error instanceof PlaceholderPlayerNameError) {
          result.heldBack.push(`${label}: ${error.message}`);
          continue;
        }
        throw error;
      }

      const elsewhere = await prisma.sbTeamSquad.findFirst({
        where: {
          playerId: player.id,
          teamId: { not: team.id },
          team: { competitionId: comp.id },
        },
        select: { team: { select: { name: true } } },
      });
      if (elsewhere) {
        result.heldBack.push(`${label}: already registered for ${elsewhere.team.name} in this league`);
        continue;
      }

      const existing = await prisma.sbTeamSquad.findFirst({
        where: {
          teamId: team.id,
          OR: [{ playerId: player.id }, { displayName: { equals: displayName, mode: "insensitive" } }],
        },
        select: { id: true, playerId: true },
      });
      if (!existing) {
        await prisma.sbTeamSquad.create({
          data: {
            teamId: team.id,
            playerId: player.id,
            displayName,
            position: row.position,
            shirtNumber: row.shirt,
          },
        });
        result.created += 1;
      } else if (!existing.playerId) {
        await prisma.sbTeamSquad.update({
          where: { id: existing.id },
          data: { playerId: player.id },
        });
        result.linked += 1;
      } else {
        result.unchanged += 1;
      }
    }
  }

  for (const team of teams) {
    result.squadSizes[team.slug] = await prisma.sbTeamSquad.count({ where: { teamId: team.id } });
  }

  const listed = ROSTERS.reduce((n, r) => n + r.players.length, 0);
  console.log(
    `Seeded UFC 2026 squads: ${listed} registered rows; ` +
      `${result.created} created, ${result.linked} linked, ${result.unchanged} already in place, ` +
      `${result.heldBack.length} held back`
  );
  for (const reason of result.heldBack) console.log(`  held back: ${reason}`);
  return result;
}
