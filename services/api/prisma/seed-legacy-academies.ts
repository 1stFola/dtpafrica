import type { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { isFullSeed, type SeedOptions } from "../src/seed/seed-options";

type LegacyAcademySeed = {
  name: string;
  contactPerson: string;
  email: string;
  country: string;
  loginUsername: string;
  password: string;
  subscriptionTier: "Premium" | "Basic";
  maxPlayers: number;
  logoUrl: string;
};

const LEGACY_ACADEMIES: LegacyAcademySeed[] = [
  {
    name: "AYICRIP-NELIS FA",
    contactPerson: "Chris Ibe",
    email: "1stfola@gmail.com",
    country: "Nigeria",
    loginUsername: "AYICRIP-NELIS",
    password: "AYICRIP-NELISadmin",
    subscriptionTier: "Premium",
    maxPlayers: 20,
    logoUrl:
      "https://ayicripnelisfa.org/wp-content/uploads/2023/01/Ayicrip-Nelis.jpeg",
  },
  {
    name: "IGANMU TIGER FC",
    contactPerson: "Fola Sanni",
    email: "1stfola@gmail.com",
    country: "Nigeria",
    loginUsername: "Iganmu",
    password: "Iganmuadmin",
    subscriptionTier: "Basic",
    maxPlayers: 30,
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR4f7bORj-IqKayq_rog5YFnmyCP0SevgLoKw&s",
  },
  {
    name: "EMILOJU FC",
    contactPerson: "MR EMILOJU",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "EMILOJUFC",
    password: "EMILOJUFCBO$$",
    subscriptionTier: "Premium",
    maxPlayers: 18,
    logoUrl:
      "https://app.trickle.so/storage/public/images/usr_154548bd30000001/93f3f690-6692-4087-bf80-cb6d2a551576.jpeg",
  },
  {
    name: "EVOLUTION UNITED FC",
    contactPerson: "DTP Africa",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "EVOLUTIONFC",
    password: "EVOLUTIONFCBoss",
    subscriptionTier: "Basic",
    maxPlayers: 10,
    logoUrl:
      "https://app.trickle.so/storage/public/images/usr_154548bd30000001/2aa8d009-9c61-43f8-a2b3-1870bf8faf4e.jpeg",
  },
  {
    name: "OJODU CITY FC",
    contactPerson: "DTP Africa",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "OJODUCITYFC",
    password: "OJODU@123",
    subscriptionTier: "Basic",
    maxPlayers: 10,
    logoUrl:
      "https://app.trickle.so/storage/public/images/usr_154548bd30000001/b46e4472-7d33-44de-bd9f-0aa50b3bd324.jpeg",
  },
  {
    name: "SMART CITY FC",
    contactPerson: "DTP Africa",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "SMARTCITYFC",
    password: "SMARTCITYBO$$",
    subscriptionTier: "Basic",
    maxPlayers: 10,
    logoUrl:
      "https://app.trickle.so/storage/public/images/usr_154548bd30000001/ea7b2489-200b-4d1d-9b40-7269df6f4ef0.png",
  },
  {
    name: "VIDO 99 FC",
    contactPerson: "DTP Africa",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "VIDO99FC",
    password: "VIDO99FC@1",
    subscriptionTier: "Basic",
    maxPlayers: 10,
    logoUrl:
      "https://app.trickle.so/storage/public/images/usr_154548bd30000001/29096a99-dcd6-496f-8665-e1109d01d6dd.jpeg",
  },
  {
    name: "FC BETHEL SPORTING",
    contactPerson: "DTP Africa",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "FCBETHEL",
    password: "FCBETHELSPORTING",
    subscriptionTier: "Basic",
    maxPlayers: 10,
    logoUrl:
      "https://app.trickle.so/storage/public/images/usr_154548bd30000001/67c1b936-a88b-4f98-9ae0-ff1c467d729e.jpeg",
  },
  {
    name: "OLUGBANI FC",
    contactPerson: "DTP Africa",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "OLUGBANIFC",
    password: "OLUGBANIFC@",
    subscriptionTier: "Premium",
    maxPlayers: 20,
    logoUrl:
      "https://cdn.thenationonlineng.net/wp-content/uploads/2024/05/15023011/Apapa-Iganmu-Local.jpg",
  },
  {
    name: "ATHLETIC CLUB",
    contactPerson: "DTP Africa",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "ATHLETICCLUB",
    password: "ATHLETIC@@",
    subscriptionTier: "Premium",
    maxPlayers: 10,
    logoUrl:
      "https://lh3.googleusercontent.com/pw/AP1GczO_xOtfLrVwYx1LwGZrq1XEOwH7DQOiITrfIRpXMiaaiR5wR54_Lx5QTRRdeF6PIt0em_3x3ddD7g7f4zVrtVAQpGAvYm8BQHCpef_NmC3Sy50No0hkRBAVdTHTTmKhUW8GIOyS2ot3Ke2DtaiSCeFN=w317-h374-s-no-gm?authuser=0",
  },
  {
    name: "OLYMPIC LAGOS",
    contactPerson: "DTP Africa",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "OLYMPICLAGOS",
    password: "OLYMPICdtp",
    subscriptionTier: "Premium",
    maxPlayers: 10,
    logoUrl:
      "https://app.trickle.so/storage/public/images/usr_154548bd30000001/6896df9d-fa5e-4a5c-a700-f99270ebef14.png",
  },
  {
    name: "GOALGETTERS FA",
    contactPerson: "DTP Africa",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "GOALGETTERSFA",
    password: "GOALGETTERS@DTP",
    subscriptionTier: "Premium",
    maxPlayers: 15,
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTf0eo-nadpS99FW-txoZQfV-NouduU89re-Q&s",
  },
  {
    name: "MAGIC STARS FC",
    contactPerson: "DTP Africa",
    email: "directtoproafrica@gmail.com",
    country: "Nigeria",
    loginUsername: "MAGICSTARSFC",
    password: "MAGICSTARS@",
    subscriptionTier: "Premium",
    maxPlayers: 15,
    logoUrl:
      "https://magicstarsfc.com/wp-content/uploads/2025/06/cropped-cropped-logo-2-1-scaled-1-1.png",
  },
];

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "academy"
  );
}

function normalizeCountry(country: string): string {
  const trimmed = country.trim();
  if (trimmed.toLowerCase() === "nigeria") return "Nigeria";
  return trimmed;
}

export async function seedLegacyAcademies(
  prisma: PrismaClient,
  options?: SeedOptions
): Promise<number> {
  const full = isFullSeed(options);
  let count = 0;

  for (const academy of LEGACY_ACADEMIES) {
    const slug = slugify(academy.name);
    const passwordHash = await bcrypt.hash(academy.password, 10);
    const loginUsername = academy.loginUsername.trim();

    const sharedFields = {
      name: academy.name,
      contactPerson: academy.contactPerson,
      email: academy.email,
      phone: null,
      country: normalizeCountry(academy.country),
      loginUsername,
      subscriptionTier: academy.subscriptionTier,
      maxPlayers: academy.maxPlayers,
      logoUrl: academy.logoUrl,
      isPublished: true,
    };

    await prisma.academy.upsert({
      where: { slug },
      update: full
        ? { ...sharedFields, passwordHash }
        : sharedFields,
      create: {
        slug,
        name: academy.name,
        contactPerson: academy.contactPerson,
        email: academy.email,
        phone: null,
        country: normalizeCountry(academy.country),
        loginUsername,
        passwordHash,
        subscriptionTier: academy.subscriptionTier,
        maxPlayers: academy.maxPlayers,
        logoUrl: academy.logoUrl,
        isPublished: true,
      },
    });

    count += 1;
    console.log(`  legacy academy: ${slug} (login: ${loginUsername})`);
  }

  return count;
}
