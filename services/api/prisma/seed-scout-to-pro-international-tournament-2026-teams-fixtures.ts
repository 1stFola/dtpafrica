import type { Prisma, PrismaClient } from "@prisma/client";
import { isFullSeed, type SeedOptions } from "../src/seed/seed-options";
import { splitPlayerName } from "../src/utils/player-utils";

const COMP_SLUG = "scout-to-pro-international-tournament-2026";

// Group structure from the provided data
const GROUPS = {
  A: ["AMULUDUN FC", "SOCCER TALENT FC", "AKOKA CITY FC", "IKONNECT FC"],
  B: ["OOA FC", "OLYMPIQUE LAGOS FA", "DREAM 2 REALITY FA", "EASY NTER GLOBAL FC"],
  C: ["PRINCE KAZEEM ELETU FC", "ELITE STARS FC", "OJODU CITY FC", "BARIGA STARS FC"],
  D: ["BOX 2 BOX FC", "OBA’S FC7", "PATNIK FA", "UTMOST FC"],
  E: ["AWONIYI FC", "ATHLETIC FC", "IKORODU CITY FA", "FC BETHEL SPORTING FC"]
};

// Flatten all teams
const ALL_TEAMS = Object.values(GROUPS).flat();

// Match schedule from the provided data
const MATCH_SCHEDULE = [
  // Day 1 - 03-09-2026
  { date: "2026-09-03", time: "08:00", match: ["AMULUDUN FC", "SOCCER TALENT FC"] },
  { date: "2026-09-03", time: "09:00", match: ["OOA FC", "OLYMPIQUE LAGOS FA"] },
  { date: "2026-09-03", time: "10:00", match: ["BARIGA STARS FC", "OJODU CITY FC"] },
  { date: "2026-09-03", time: "11:00", match: ["BOX 2 BOX FC", "OBA’S FC7"] }, // Note: Originally said 11:00 PM but likely AM
  { date: "2026-09-03", time: "08:00", match: ["AWONIYI FC", "ATHLETIC FC"] },
  { date: "2026-09-03", time: "13:00", match: ["UTMOST FC", "PATNIK FA"] }, // 1:00 PM

  // Day 2 - 04-09-2026
  { date: "2026-09-04", time: "08:00", match: ["AKOKA CITY FC", "IKONNECT FC"] },
  { date: "2026-09-04", time: "09:00", match: ["DREAM 2 REALITY FA", "EASY NTER GLOBAL FC"] },
  { date: "2026-09-04", time: "10:00", match: ["OBA’S FC7", "UTMOST FC"] },
  { date: "2026-09-04", time: "11:00", match: ["PRINCE KAZEEM ELETU FC", "ELITE STARS FC"] },
  { date: "2026-09-04", time: "12:00", match: ["BOX 2 BOX FC", "PATNIK FA"] },
  { date: "2026-09-04", time: "13:00", match: ["FIMA FC", "FC BETHEL SPORTING FC"] }, // Fima FC vs FC Bethel Sporting

  // Day 3 - 06-09-2026
  { date: "2026-09-06", time: "08:00", match: ["AWONIYI FC", "FIMA FC"] },
  { date: "2026-09-06", time: "09:00", match: ["AMULUDUN FC", "AKOKA CITY FC"] },
  { date: "2026-09-06", time: "10:00", match: ["OOA FC", "DREAM 2 REALITY FA"] },
  { date: "2026-09-06", time: "11:00", match: ["SOCCER TALENT FC", "IKONNECT FC"] },
  // Break 12:00 PM - 2:00 PM
  { date: "2026-09-06", time: "14:00", match: ["OLYMPIQUE LAGOS FA", "EASY NTER GLOBAL FC"] },
  { date: "2026-09-06", time: "15:00", match: ["PRINCE KAZEEM ELETU FC", "OJODU CITY FC"] },
  { date: "2026-09-06", time: "16:00", match: ["ELITE STARS FC", "BARIGA STARS FC"] },
  { date: "2026-09-06", time: "17:00", match: ["ATHLETIC FC", "FC BETHEL SPORTING FC"] }
];

// Squad data for specific teams (from provided JSON)
const SQUAD_DATA = {
  "AKOKA CITY FC": [
    {"jerseyNumber": 17, "fullName": "Damilola Oderinde", "position": "ST"},
    {"jerseyNumber": 1, "fullName": "Tomiwa Abolaji", "position": "GK"},
    {"jerseyNumber": 22, "fullName": "Peter Anuligwo", "position": "LW"},
    {"jerseyNumber": 9, "fullName": "Rasheed Jimoh", "position": "ST"},
    {"jerseyNumber": 7, "fullName": "Israel Akamo", "position": "RW"},
    {"jerseyNumber": 10, "fullName": "David Augustine", "position": "AM"},
    {"jerseyNumber": 13, "fullName": "Matthew Anthony", "position": "CB"},
    {"jerseyNumber": 3, "fullName": "Damilare Adekanbi", "position": "LB"},
    {"jerseyNumber": 2, "fullName": "Basit Adeniyi", "position": "RB"},
    {"jerseyNumber": 18, "fullName": "Peters Emmanuel", "position": "DM"},
    {"jerseyNumber": 19, "fullName": "Toyeeb Alli", "position": "AM"},
    {"jerseyNumber": 11, "fullName": "Jide Adeleke", "position": "LW"},
    {"jerseyNumber": 4, "fullName": "Victor Johnson", "position": "DM"},
    {"jerseyNumber": 5, "fullName": "Ibrahim Musa", "position": "CB"},
    {"jerseyNumber": 8, "fullName": "Isaih Olugbiji", "position": "AM"},
    {"jerseyNumber": 14, "fullName": "Donald Ugbe", "position": "ST"},
    {"jerseyNumber": 6, "fullName": "Peter Adekunle", "position": "DM"},
    {"jerseyNumber": 12, "fullName": "Okoronkwo Uchenna", "position": "CB"},
    {"jerseyNumber": 20, "fullName": "Basit Soneye", "position": "CB"},
    {"jerseyNumber": 21, "fullName": "Bolaji Odunuga", "position": "CB"},
    {"jerseyNumber": 15, "fullName": "Robiu Kareem", "position": "CM"}
  ],
  "DREAM 2 REALITY FA": [
    {"jerseyNumber": 31, "fullName": "Oluwalomola Samuel", "position": "GK"},
    {"jerseyNumber": 1, "fullName": "Ariyo Ramadan", "position": "GK"},
    {"jerseyNumber": 30, "fullName": "Ajao Saheed", "position": "DF"},
    {"jerseyNumber": 25, "fullName": "Awoniyan Joseph", "position": "DF"},
    {"jerseyNumber": 6, "fullName": "Siakpere Delbert", "position": "DF"},
    {"jerseyNumber": 14, "fullName": "Yusuf Ganiu", "position": "DF"},
    {"jerseyNumber": 5, "fullName": "Daramola David", "position": "DF"},
    {"jerseyNumber": 4, "fullName": "Lateef Ayomide", "position": "DF"},
    {"jerseyNumber": 35, "fullName": "Aina Bamidele", "position": "DF"},
    {"jerseyNumber": 8, "fullName": "Unenge Kingsley", "position": "MF"},
    {"jerseyNumber": 12, "fullName": "Kayode Olamilekan", "position": "MF"},
    {"jerseyNumber": 20, "fullName": "Adeleke Habeeb", "position": "MF"},
    {"jerseyNumber": 22, "fullName": "Muhammad Ibrahim", "position": "MF"},
    {"jerseyNumber": 28, "fullName": "Oyasope Oluwatosin", "position": "FW"},
    {"jerseyNumber": 16, "fullName": "Salahudeen Farounk", "position": "FW"},
    {"jerseyNumber": 39, "fullName": "Oladosu Tobiloba", "position": "FW"},
    {"jerseyNumber": 24, "fullName": "Baidoo Joe", "position": "FW"},
    {"jerseyNumber": 21, "fullName": "Ojeniyi Idris", "position": "FW"},
    {"jerseyNumber": 15, "fullName": "Abodunrin Habeeb", "position": "FW"},
    {"jerseyNumber": 10, "fullName": "Asor Diata", "position": "FW"},
    {"jerseyNumber": 2, "fullName": "Odeniran Victor", "position": "FW"},
    {"jerseyNumber": 34, "fullName": "Aganga Ayomide", "position": "ST"},
    {"jerseyNumber": 9, "fullName": "Akponurhievwe Stanley", "position": "ST"},
    {"jerseyNumber": 42, "fullName": "Ayinde Idowu", "position": "ST"},
    {"jerseyNumber": 23, "fullName": "Emmanuel Morrison", "position": "ST"}
  ],
  "OBA’S FC7": [ // Note: Using the exact name from GROUP D
    {"jerseyNumber": 1, "fullName": "David Igbinovia", "position": "GK"},
    {"jerseyNumber": 2, "fullName": "Musa Ahmad", "position": "RB"},
    {"jerseyNumber": 4, "fullName": "Akor Sunday Isaac", "position": "AM"},
    {"jerseyNumber": 5, "fullName": "Hussain Yusuf", "position": "CB"},
    {"jerseyNumber": 7, "fullName": "Idris Okekunle", "position": "RW"},
    {"jerseyNumber": 10, "fullName": "Stanley Nriama", "position": "LW"},
    {"jerseyNumber": 12, "fullName": "Victor Juan Chiosa", "position": "AMF"},
    {"jerseyNumber": 14, "fullName": "David Anayo", "position": "MID"},
    {"jerseyNumber": 15, "fullName": "George Agazuma", "position": "LB"},
    {"jerseyNumber": 16, "fullName": "Opeyemi Adebayo Usman", "position": "MID"},
    {"jerseyNumber": 18, "fullName": "Hassan Adegbola", "position": "LW"},
    {"jerseyNumber": 19, "fullName": "Musa Babà", "position": "CB"},
    {"jerseyNumber": 20, "fullName": "John Usman", "position": "MID"},
    {"jerseyNumber": 21, "fullName": "Sauban Kareem", "position": "RW"},
    {"jerseyNumber": 22, "fullName": "Ogunjobi Taiwo", "position": "CB"},
    {"jerseyNumber": 23, "fullName": "David Linus", "position": "ST"},
    {"jerseyNumber": 24, "fullName": "Charles James", "position": "RB"},
    {"jerseyNumber": 25, "fullName": "Saidu Umar Adam", "position": "ST"},
    {"jerseyNumber": 27, "fullName": "Usman Olaide Ismail", "position": "DM"},
    {"jerseyNumber": 29, "fullName": "Emmanuel Bright", "position": "LWF"},
    {"jerseyNumber": 30, "fullName": "Warris Oyedotun", "position": "GK"}
  ],
  "UTMOST FC": [
    {"jerseyNumber": 22, "fullName": "Gideon Onoja", "position": "GK"},
    {"jerseyNumber": 1, "fullName": "David Agayo", "position": "GK"},
    {"jerseyNumber": 2, "fullName": "Elijah Osheka", "position": "RB"},
    {"jerseyNumber": 12, "fullName": "Jude Uchemezie", "position": "CB"},
    {"jerseyNumber": 4, "fullName": "Sikiru Ganiu", "position": "CB"},
    {"jerseyNumber": 3, "fullName": "Mustapha Abubakar", "position": "LB"},
    {"jerseyNumber": 13, "fullName": "Buchi Robinson", "position": "CB"},
    {"jerseyNumber": 27, "fullName": "Toheeb Sefiu", "position": "CB"},
    {"jerseyNumber": 24, "fullName": "David Olukoga", "position": "LB"},
    {"jerseyNumber": 8, "fullName": "Janga Sadiq", "position": "AMF"},
    {"jerseyNumber": 18, "fullName": "Caleb Longji", "position": "DM"},
    {"jerseyNumber": 5, "fullName": "Barnabas Ezekiel", "position": "AMF"},
    {"jerseyNumber": 10, "fullName": "Daniel Bassey", "position": "AMF"},
    {"jerseyNumber": 21, "fullName": "Ayinde Ibrahim", "position": "DM"},
    {"jerseyNumber": 20, "fullName": "Efejedia Daniel", "position": "DM"},
    {"jerseyNumber": 9, "fullName": "Saka Qudus", "position": "CF"},
    {"jerseyNumber": 7, "fullName": "Samuel Akinde", "position": "RW"},
    {"jerseyNumber": 11, "fullName": "Philip Pius", "position": "LW"},
    {"jerseyNumber": 28, "fullName": "Balogun Ridwan", "position": "CF"},
    {"jerseyNumber": 14, "fullName": "Victor Obaji", "position": "RW"}
  ],
  "PRINCE KAZEEM ELETU FC": [
    {"jerseyNumber": 7, "fullName": "Jude Obasi", "position": "WF"},
    {"jerseyNumber": 1, "fullName": "Surajudeen Oba", "position": "GK"},
    {"jerseyNumber": 22, "fullName": "Yusuf Rashed", "position": "GK"},
    {"jerseyNumber": 70, "fullName": "Ali Rabiu", "position": "RB"},
    {"jerseyNumber": 11, "fullName": "Samuel Ezeh", "position": "WF"},
    {"jerseyNumber": 77, "fullName": "Kamaldeen Abdullahi", "position": "WF"},
    {"jerseyNumber": 80, "fullName": "Wisdom Opkara", "position": "LB"},
    {"jerseyNumber": 31, "fullName": "Emmanuel Edet", "position": "DM"},
    {"jerseyNumber": 9, "fullName": "Abraham Chwetalu", "position": "CF"},
    {"jerseyNumber": 3, "fullName": "Juwon Kuku", "position": "LB"},
    {"jerseyNumber": 4, "fullName": "Henshaw Chukwurah", "position": "CB"},
    {"jerseyNumber": 6, "fullName": "Dennis Owusu", "position": "MF"},
    {"jerseyNumber": 17, "fullName": "Junior Fidelis", "position": "CF"},
    {"jerseyNumber": 45, "fullName": "Thank God Joseph", "position": "CB"},
    {"jerseyNumber": 8, "fullName": "Azeez Tijani", "position": "MF"},
    {"jerseyNumber": 37, "fullName": "Yusuf Opeloyeru", "position": "RB"},
    {"jerseyNumber": 15, "fullName": "Olalekan Lagata", "position": "DM"},
    {"jerseyNumber": 14, "fullName": "Ayomide Arowosegbe", "position": "CB"},
    {"jerseyNumber": 10, "fullName": "Jimmy Elisha", "position": "WF"},
    {"jerseyNumber": 55, "fullName": "Joshua Omodu", "position": "CB"},
    {"jerseyNumber": 5, "fullName": "Tobiloba Ashimi", "position": "MF"},
    {"jerseyNumber": 38, "fullName": "Osifeso Samuel", "position": "WF"}
  ],
  "PATNIK FA": [
    {"jerseyNumber": 1, "fullName": "Teslim Luqman", "position": "GK"},
    {"jerseyNumber": 90, "fullName": "Oluwasegun Akolade", "position": "GK"},
    {"jerseyNumber": 17, "fullName": "Tope Ayorinde", "position": "LB"},
    {"jerseyNumber": 12, "fullName": "Taiwo Micheal", "position": "CB"},
    {"jerseyNumber": 6, "fullName": "Oscar Obi", "position": "CB"},
    {"jerseyNumber": 2, "fullName": "Ayomikun Omolade", "position": "RB"},
    {"jerseyNumber": 5, "fullName": "Chieme Bright", "position": "CB"},
    {"jerseyNumber": 21, "fullName": "Stanley Osariemen", "position": "CB"},
    {"jerseyNumber": 3, "fullName": "Nkemjika Anyanwu", "position": "LB"},
    {"jerseyNumber": 4, "fullName": "Aaron Innocent", "position": "DM"},
    {"jerseyNumber": 13, "fullName": "Samuel Amata", "position": "CM"},
    {"jerseyNumber": 15, "fullName": "Adam Musa", "position": "AM"},
    {"jerseyNumber": 16, "fullName": "Abolaji Ojelabi", "position": "CM"},
    {"jerseyNumber": 10, "fullName": "Aduragbemi Adewale", "position": "CM"},
    {"jerseyNumber": 23, "fullName": "Hammed Oseni", "position": "CM"},
    {"jerseyNumber": 19, "fullName": "Kelechi Ndubueze", "position": "RWF"},
    {"jerseyNumber": 9, "fullName": "Sunday Ameh", "position": "CF"},
    {"jerseyNumber": 20, "fullName": "Simon Pius", "position": "LWF"},
    {"jerseyNumber": 18, "fullName": "Soliu Adisa", "position": "LWF"},
    {"jerseyNumber": 7, "fullName": "Kingsley Osuji", "position": "LWF"},
    {"jerseyNumber": 25, "fullName": "Abel Olusegun", "position": "AMF"},
    {"jerseyNumber": 14, "fullName": "Emmanuel Umeh", "position": "CF"},
    {"jerseyNumber": 8, "fullName": "Francis John", "position": "RWF"},
    {"jerseyNumber": 11, "fullName": "Olawale Delly", "position": "RWF"},
    {"jerseyNumber": 22, "fullName": "Daniel MakuoChukwu Anagor", "position": "AMF"}
  ],
  "OLYMPIQUE LAGOS FA": [
    {"jerseyNumber": 1, "fullName": "Williams Ibrahim", "position": "GK"},
    {"jerseyNumber": 3, "fullName": "Usman Ibrahim", "position": "LB"},
    {"jerseyNumber": 6, "fullName": "Philip-paul Ujah", "position": "CB"},
    {"jerseyNumber": 48, "fullName": "Bukunmi Solomon", "position": "CM"},
    {"jerseyNumber": 14, "fullName": "Issac Mbah", "position": "DM"},
    {"jerseyNumber": 15, "fullName": "David Clement", "position": "CM"},
    {"jerseyNumber": 19, "fullName": "Gabriel Daniel", "position": "WF"},
    {"jerseyNumber": 21, "fullName": "Hassan Muhammed", "position": "RB"},
    {"jerseyNumber": 18, "fullName": "Oluwapelumi Oluwasanmi", "position": "CM"},
    {"jerseyNumber": 53, "fullName": "Asim Yusuf", "position": "RB"},
    {"jerseyNumber": 9, "fullName": "Opeyemi Olanrewaju", "position": "WF"},
    {"jerseyNumber": 22, "fullName": "Honor Nwakpa", "position": "GK"},
    {"jerseyNumber": 40, "fullName": "Daniel David", "position": "WF"},
    {"jerseyNumber": 27, "fullName": "Oludayo Abosede", "position": "CB"},
    {"jerseyNumber": 29, "fullName": "Mukhtar Oladeinde", "position": "CF"},
    {"jerseyNumber": 16, "fullName": "Abdulquadri Kolawole", "position": "WF"},
    {"jerseyNumber": 8, "fullName": "Desmond Osahenruwen", "position": "CM"},
    {"jerseyNumber": 20, "fullName": "Micheal Ayotunde", "position": "CM"},
    {"jerseyNumber": 25, "fullName": "Aduragbemi Samuel", "position": "LB"},
    {"jerseyNumber": 17, "fullName": "Aaron Samuel", "position": "WF"},
    {"jerseyNumber": 28, "fullName": "Nabil Cole-Kosoko", "position": "CM"},
    {"jerseyNumber": 38, "fullName": "Muhammed Bada", "position": "CF"},
    {"jerseyNumber": 24, "fullName": "Hendricks Lateju", "position": "GK"},
    {"jerseyNumber": 10, "fullName": "Salif Cole-Kosoko", "position": "CM"},
    {"jerseyNumber": 23, "fullName": "Kehinde Qozeem", "position": "CF"}
  ],
  "OJODU CITY FC": [
    {"jerseyNumber": 1, "fullName": "Victor Johnson", "position": "GK"},
    {"jerseyNumber": 32, "fullName": "Agu Kingsley Obumnaeme", "position": "GK"},
    {"jerseyNumber": 24, "fullName": "Abereoje Qudus Ajibola", "position": "CB"},
    {"jerseyNumber": 26, "fullName": "Afensumu Samuel Monday", "position": "CB"},
    {"jerseyNumber": 2, "fullName": "Samuel Odunayo Israel", "position": "RB"},
    {"jerseyNumber": 13, "fullName": "Ebogu Osita Japhet", "position": "LB"},
    {"jerseyNumber": 30, "fullName": "Jerry Elochukwu Othniel", "position": "RB"},
    {"jerseyNumber": 10, "fullName": "Emmanuel Samuel Elijah", "position": "AM"},
    {"jerseyNumber": 18, "fullName": "Haruna Junior Haruna", "position": "DM"},
    {"jerseyNumber": 20, "fullName": "Odunuga Ayuba Temitope", "position": "CF"},
    {"jerseyNumber": 7, "fullName": "Dada Teniola Titus", "position": "RW"},
    {"jerseyNumber": 17, "fullName": "Mubarak Abdul Hamid", "position": "LW"},
    {"jerseyNumber": 9, "fullName": "Patrick Akhidenor-Solanke", "position": "CF"},
    {"jerseyNumber": 23, "fullName": "Owodunni Abayomi Faruq", "position": "CB"},
    {"jerseyNumber": 30, "fullName": "Sabiu Abdullahi", "position": "LW"},
    {"jerseyNumber": 14, "fullName": "Terkaa Dondonen Andrew", "position": "DM"},
    {"jerseyNumber": 21, "fullName": "Kelechi Enoch Ozioma", "position": "RB"},
    {"jerseyNumber": 8, "fullName": "Yeboah Morgan", "position": "AM"},
    {"jerseyNumber": 16, "fullName": "Ishola Elijah", "position": "RW"}
  ],
  "FIMA FC": [
    {"jerseyNumber": 2, "fullName": "Anointing Adeleke", "position": "LW"},
    {"jerseyNumber": 3, "fullName": "Michael Oboh", "position": "CF"},
    {"jerseyNumber": 4, "fullName": "Favour Tolulope", "position": "LB"},
    {"jerseyNumber": 5, "fullName": "Attah Igoche", "position": "CM"},
    {"jerseyNumber": 6, "fullName": "Toheeb Akanfa", "position": "AM"},
    {"jerseyNumber": 7, "fullName": "Oghenetega James", "position": "RB"},
    {"jerseyNumber": 8, "fullName": "Olawale Ode", "position": "CB"},
    {"jerseyNumber": 9, "fullName": "Tunde Omitokun", "position": "DM"},
    {"jerseyNumber": 10, "fullName": "Abdulhakeem Ishaq", "position": "CF"},
    {"jerseyNumber": 11, "fullName": "Raphael Aderibigbe", "position": "AM"},
    {"jerseyNumber": 12, "fullName": "Abubakar Usman", "position": "RW"},
    {"jerseyNumber": 13, "fullName": "Amtagu Innocent", "position": "CB"},
    {"jerseyNumber": 14, "fullName": "Samsudeen Adewale", "position": "CM"},
    {"jerseyNumber": 15, "fullName": "Abdullahi Ibrahim", "position": "RW"},
    {"jerseyNumber": 16, "fullName": "David Ogunmade", "position": "RW"},
    {"jerseyNumber": 17, "fullName": "Israel Adedola", "position": "RB"},
    {"jerseyNumber": 18, "fullName": "Tomiwa Bada", "position": "CB"},
    {"jerseyNumber": 19, "fullName": "Wasiu Biobaku", "position": "LW"},
    {"jerseyNumber": 20, "fullName": "Oluwafemi Atanda", "position": "DM"},
    {"jerseyNumber": 1, "fullName": "Michael Terseer", "position": "GK"},
    {"jerseyNumber": 22, "fullName": "Roqeeb Adewale", "position": "DM"}
  ],
  "FC BETHEL SPORTING FC": [
    {"jerseyNumber": 1, "fullName": "Abiodun Ogubowale", "position": "GK"},
    {"jerseyNumber": 30, "fullName": "Madumere Chukwuemeka", "position": "GK"},
    {"jerseyNumber": 2, "fullName": "Mark Adoga", "position": "RB"},
    {"jerseyNumber": 3, "fullName": "Oluwatobi Farinde", "position": "LB"},
    {"jerseyNumber": 5, "fullName": "Jonathan Ebunu", "position": "CB"},
    {"jerseyNumber": 4, "fullName": "Briggs Inabubeleba", "position": "CB"},
    {"jerseyNumber": 6, "fullName": "Ebuka Emmanuel", "position": "DM"},
    {"jerseyNumber": 8, "fullName": "Chijoke Godwin", "position": "DM"},
    {"jerseyNumber": 20, "fullName": "Miracle Ezike", "position": "DM"},
    {"jerseyNumber": 24, "fullName": "Nwuzi Izuchukwu", "position": "CM"},
    {"jerseyNumber": 10, "fullName": "Joshua Okereke", "position": "AM"},
    {"jerseyNumber": 12, "fullName": "Henry Nwakobia", "position": "AM"},
    {"jerseyNumber": 21, "fullName": "Awwal Ayinla", "position": "LWF"},
    {"jerseyNumber": 11, "fullName": "Tijani Ridwan", "position": "LWF"},
    {"jerseyNumber": 25, "fullName": "Fawas Olaitan", "position": "RWF"},
    {"jerseyNumber": 18, "fullName": "Moses Itanko", "position": "RWF"},
    {"jerseyNumber": 19, "fullName": "Olamilekan Afolabi", "position": "CF"},
    {"jerseyNumber": 9, "fullName": "Liadi Shafihi", "position": "CF"},
    {"jerseyNumber": 7, "fullName": "Ebenezer Prince", "position": "WF"},
    {"jerseyNumber": 17, "fullName": "Joshua Ayobami", "position": "CB"}
  ],
  "EASY NTER GLOBAL FC": [
    {"jerseyNumber": 1, "fullName": "Moshood Akintola", "position": "GK"},
    {"jerseyNumber": 29, "fullName": "Tijani Agunbiade", "position": "LB"},
    {"jerseyNumber": 30, "fullName": "Femi Adeleke", "position": "CB"},
    {"jerseyNumber": 8, "fullName": "Pascal Ndubuisi", "position": "CB"},
    {"jerseyNumber": 31, "fullName": "Jeremiah Richard", "position": "CM"},
    {"jerseyNumber": 15, "fullName": "Idris Oladaride", "position": "CM"},
    {"jerseyNumber": 21, "fullName": "Afeez Bakare", "position": "LW"},
    {"jerseyNumber": 14, "fullName": "Chisom Ekechi", "position": "RW"},
    {"jerseyNumber": 25, "fullName": "Hammad Sulaimon", "position": "CB"},
    {"jerseyNumber": 28, "fullName": "Ebuka Solomon", "position": "AM"},
    {"jerseyNumber": 24, "fullName": "John Onyero", "position": "DM"},
    {"jerseyNumber": 13, "fullName": "Samson Ogundipe", "position": "RB"},
    {"jerseyNumber": 11, "fullName": "Bashir Akorede", "position": "LW"},
    {"jerseyNumber": 9, "fullName": "Yusuf Ajibola", "position": "RB"},
    {"jerseyNumber": 16, "fullName": "Malik Oladega", "position": "AM"},
    {"jerseyNumber": 26, "fullName": "Fawaz Adetunji", "position": "LB"},
    {"jerseyNumber": 22, "fullName": "Timiobong Etuk-Udoh", "position": "GK"},
    {"jerseyNumber": 23, "fullName": "Uthman Oyewunmi", "position": "LB"},
    {"jerseyNumber": 6, "fullName": "Jafar Abdulhakeem", "position": "CF"},
    {"jerseyNumber": 40, "fullName": "Divine Favour Omuchi", "position": "GK"}
  ]
};

// Helper functions
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Main seeding function
export async function seedScoutToProTeamsFixturesSquads(
  prisma: PrismaClient,
  options?: SeedOptions
) {
  console.log("🔄 Starting Scout To Pro International Tournament 2026 seeding...");

  // Find the competition
  const competition = await prisma.sbCompetition.findUnique({
    where: { slug: COMP_SLUG }
  });

  if (!competition) {
    throw new Error(`Competition with slug "${COMP_SLUG}" not found. Please run the competition seed first.`);
  }

  console.log(`📍 Found competition: ${competition.name} (${competition.id})`);

  // 1. Create teams
  console.log("\n🏆 Creating teams...");
  const teamRecords: Record<string, { id: string }> = {};

  for (const teamName of ALL_TEAMS) {
    // Check if team already exists
    let team = await prisma.sbTeam.findFirst({
      where: {
        name: teamName,
        competitionId: competition.id
      }
    });

    if (!team) {
      team = await prisma.sbTeam.create({
        data: {
          name: teamName,
          slug: slugify(teamName),
          competitionId: competition.id,
          shortName: teamName.substring(0, Math.min(3, teamName.length)).toUpperCase(),
          city: "Lagos", // All matches in Lagos
          
          logoUrl: null,
          groupKey: Object.entries(GROUPS).find(([_, teams]) => teams.includes(teamName))?.[0] || null
        }
      });

      console.log(`  ✅ Created team: ${teamName}`);
    } else {
      console.log(`  🔄 Team already exists: ${teamName}`);
    }

    teamRecords[teamName] = { id: team.id };
  }

  // 2. Create match fixtures
  console.log("\n📅 Creating match fixtures...");
  let matchesCreated = 0;

  for (const matchData of MATCH_SCHEDULE) {
    const [teamAName, teamBName] = matchData.match;
    const teamA = teamRecords[teamAName];
    const teamB = teamRecords[teamBName];

    if (!teamA || !teamB) {
      console.log(`  ⚠️  Skipping match: ${teamAName} vs ${teamBName} - team not found`);
      continue;
    }

    // Check if match already exists
    const existingMatch = await prisma.sbMatch.findFirst({
      where: {
        competitionId: competition.id,
        homeTeamId: teamA.id,
        awayTeamId: teamB.id,
        kickoffAt: new Date(`${matchData.date}T${matchData.time}:00`)
      }
    });

    if (!existingMatch) {
      await prisma.sbMatch.create({
        data: {
          competitionId: competition.id,
          homeTeamId: teamA.id,
          awayTeamId: teamB.id,
          
          kickoffAt: new Date(`${matchData.date}T${matchData.time}:00`),
          venue: "Bariga Stadium, Lagos",
          status: "scheduled",
          roundLabel: `Group ${Object.entries(GROUPS).find(([_, teams]) => teams.includes(teamAName))?.[0] ?? 'Unknown'}`
        }
      });

      console.log(`  ✅ Created match: ${teamAName} vs ${teamBName} (${matchData.date} ${matchData.time})`);
      matchesCreated++;
    } else {
      console.log(`  🔄 Match already exists: ${teamAName} vs ${teamBName}`);
    }
  }

  // 3. Create squad records (player assignments) for teams with squad data
  console.log("\n👥 Creating squad records (player assignments)...");
  let squadRecordsCreated = 0;
  let playersProcessed = 0;

  for (const [teamName, players] of Object.entries(SQUAD_DATA)) {
    const team = teamRecords[teamName];
    if (!team) {
      console.log(`  ⚠️  Skipping squad for ${teamName} - team not found`);
      continue;
    }

    console.log(`  📋 Processing squad for ${teamName} (${players.length} players)`);

    for (const playerData of players) {
      try {
        const { fullName, position: rawPosition, jerseyNumber } = playerData;

        // Normalize data
        const position = normalizePosition(rawPosition);
        const shirtNumber = normalizeShirtNumber(jerseyNumber);
        const { firstName, lastName } = splitPlayerName(fullName);
        const displayName = fullName.trim();

        // Find or create player
        let player = await prisma.player.findFirst({
          where: {
            displayName: displayName
          }
        });

        if (!player) {
          // Create new player
          player = await prisma.player.create({
            data: {
              firstName,
              lastName,
              displayName,
              normalizedName: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
              slug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
              positionPrimary: position,
              registrationStatus: "approved",
              isPublic: true,
            }
          });

          console.log(`    ✅ Created player: ${displayName} (${position})`);
        } else {
          // Update player position if different
          if (player.positionPrimary !== position) {
            await prisma.player.update({
              where: { id: player.id },
              data: { positionPrimary: position }
            });
            console.log(`    🔄 Updated player position: ${displayName} (${position})`);
          }
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

          console.log(`    🔗 Linked ${displayName} to ${teamName} (shirt #${shirtNumber ?? 'N/A'})`);
          squadRecordsCreated++;
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

          console.log(`    🔄 Updated squad entry for ${displayName} in ${teamName}`);
          squadRecordsCreated++; // Still count as processed
        }

        playersProcessed++;
      } catch (error) {
        console.error(`    ❌ Error processing player ${playerData.fullName}:`, error);
      }
    }
  }

  console.log(`\n🎉 Scout To Pro International Tournament 2026 Seeding Complete:`);
  console.log(`   🏆 Teams: ${Object.keys(teamRecords).length}`);
  console.log(`   📅 Matches created: ${matchesCreated}`);
  console.log(`   👥 Squad records created: ${squadRecordsCreated}`);
  console.log(`   👤 Players processed: ${playersProcessed}`);

  return {
    teamsCreated: Object.keys(teamRecords).length,
    matchesCreated,
    squadRecordsCreated,
    playersProcessed
  };
}
