import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * AYE & NAY seed data.
 *
 * Populates the canonical GovernmentReference model with real-world items from
 * all three branches of government (Legislative bills, Executive orders, SCOTUS
 * cases) so the website has a rich "Public Pulse" from day one.
 *
 * NOTE: The vote endpoints recalculate supportVotes/opposeVotes from actual
 * GovernmentReferenceVote rows. To keep the seeded Pulse durable (so it does not
 * reset to ~0 the first time a real user votes) we back every seeded count with
 * real vote rows cast by clearly-labelled sample citizens
 * (email domain @sample.ayeandnay.com). These can be safely deleted before the
 * app launches.
 */

type Ref = {
  masterReferenceId: string;
  referenceType: "bill" | "executive_order" | "scotus_case";
  title: string;
  shortTitle?: string;
  category: string;
  status: string;
  chamber?: string;
  congress?: number;
  sponsor?: string;
  description: string;
  sourceUrl?: string;
  signedDate?: Date;
  decidedDate?: Date;
  // Rough public sentiment used to generate realistic vote rows
  support: number;
  oppose: number;
};

const references: Ref[] = [
  // ---------------- Legislative (bills) ----------------
  {
    masterReferenceId: "hr-3684-119",
    referenceType: "bill",
    title: "Infrastructure Investment and Jobs Act",
    shortTitle: "Infrastructure & Jobs Act",
    category: "economy",
    status: "passed",
    chamber: "house",
    congress: 119,
    sponsor: "Rep. Peter DeFazio",
    description:
      "A comprehensive bill to rebuild America's infrastructure — roads, bridges, public transit, broadband internet, and clean energy projects — while creating millions of jobs.",
    sourceUrl: "https://www.congress.gov/bill/117th-congress/house-bill/3684",
    support: 312,
    oppose: 88,
  },
  {
    masterReferenceId: "s-2657-119",
    referenceType: "bill",
    title: "Clean Energy Innovation Act",
    category: "environment",
    status: "committee",
    chamber: "senate",
    congress: 119,
    sponsor: "Sen. Lisa Murkowski",
    description:
      "Promotes research and development of clean energy technologies including solar, wind, geothermal, and advanced nuclear power to accelerate the transition to a low-carbon economy.",
    support: 241,
    oppose: 156,
  },
  {
    masterReferenceId: "hr-1976-119",
    referenceType: "bill",
    title: "Affordable Healthcare Expansion Act",
    category: "healthcare",
    status: "proposed",
    chamber: "house",
    congress: 119,
    sponsor: "Rep. Frank Pallone Jr.",
    description:
      "Expands access to affordable healthcare by strengthening the Affordable Care Act, capping insulin costs, and reducing prescription drug prices for seniors.",
    support: 289,
    oppose: 174,
  },
  {
    masterReferenceId: "s-4102-119",
    referenceType: "bill",
    title: "National Security Enhancement Act",
    category: "defense",
    status: "committee",
    chamber: "senate",
    congress: 119,
    sponsor: "Sen. Jack Reed",
    description:
      "Strengthens national defense capabilities and improves cybersecurity protections for critical infrastructure against foreign threats.",
    support: 198,
    oppose: 121,
  },
  {
    masterReferenceId: "hr-2811-119",
    referenceType: "bill",
    title: "Education Opportunity Act",
    category: "education",
    status: "proposed",
    chamber: "house",
    congress: 119,
    sponsor: "Rep. Bobby Scott",
    description:
      "Increases funding for public schools, expands access to early childhood education, and lowers the cost of higher education through expanded grant programs.",
    support: 264,
    oppose: 97,
  },
  {
    masterReferenceId: "s-1298-119",
    referenceType: "bill",
    title: "Small Business Relief Act",
    category: "economy",
    status: "passed",
    chamber: "senate",
    congress: 119,
    sponsor: "Sen. Ben Cardin",
    description:
      "Provides tax incentives and grants to support small businesses recovering from economic challenges and to encourage new entrepreneurship.",
    support: 301,
    oppose: 64,
  },
  {
    masterReferenceId: "hr-4-119",
    referenceType: "bill",
    title: "Voting Rights Protection Act",
    category: "civil_rights",
    status: "committee",
    chamber: "house",
    congress: 119,
    sponsor: "Rep. Terri Sewell",
    description:
      "Strengthens federal protections for voting rights and ensures equal access to the ballot for all citizens by restoring key provisions of the Voting Rights Act.",
    support: 276,
    oppose: 203,
  },
  {
    masterReferenceId: "s-348-119",
    referenceType: "bill",
    title: "Immigration Reform Act",
    category: "immigration",
    status: "proposed",
    chamber: "senate",
    congress: 119,
    sponsor: "Sen. Dick Durbin",
    description:
      "Comprehensive immigration reform including a pathway to citizenship, border security improvements, and modernization of the legal visa system.",
    support: 231,
    oppose: 219,
  },
  {
    masterReferenceId: "hr-5376-119",
    referenceType: "bill",
    title: "Housing Affordability Act",
    category: "housing",
    status: "committee",
    chamber: "house",
    congress: 119,
    sponsor: "Rep. Maxine Waters",
    description:
      "Addresses the housing crisis by increasing funding for affordable housing construction, expanding rental assistance, and incentivizing first-time homebuyers.",
    support: 258,
    oppose: 112,
  },
  {
    masterReferenceId: "s-1014-119",
    referenceType: "bill",
    title: "Criminal Justice Reform Act",
    category: "justice",
    status: "proposed",
    chamber: "senate",
    congress: 119,
    sponsor: "Sen. Cory Booker",
    description:
      "Reforms federal sentencing guidelines, expands rehabilitation and re-entry programs, and addresses systemic inequities in the criminal justice system.",
    support: 247,
    oppose: 158,
  },
  {
    masterReferenceId: "hr-3843-119",
    referenceType: "bill",
    title: "American Data Privacy and Protection Act",
    shortTitle: "Data Privacy Act",
    category: "technology",
    status: "committee",
    chamber: "house",
    congress: 119,
    sponsor: "Rep. Cathy McMorris Rodgers",
    description:
      "Establishes a national framework for consumer data privacy, giving Americans the right to access, correct, and delete the personal data companies collect about them.",
    support: 318,
    oppose: 76,
  },
  {
    masterReferenceId: "s-2089-119",
    referenceType: "bill",
    title: "Veterans Health Care Improvement Act",
    category: "healthcare",
    status: "passed",
    chamber: "senate",
    congress: 119,
    sponsor: "Sen. Jon Tester",
    description:
      "Expands health care access and mental health services for veterans, and streamlines the VA claims process to reduce backlogs.",
    support: 356,
    oppose: 41,
  },

  // ---------------- Executive (orders) ----------------
  {
    masterReferenceId: "eo-14110",
    referenceType: "executive_order",
    title: "Safe, Secure, and Trustworthy Development of Artificial Intelligence",
    shortTitle: "AI Safety Executive Order",
    category: "technology",
    status: "signed",
    description:
      "Directs federal agencies to establish safety standards, protect privacy, and promote responsible innovation in the development and deployment of artificial intelligence.",
    sourceUrl: "https://www.federalregister.gov/documents/2023/11/01/2023-24283",
    signedDate: new Date("2025-01-30"),
    support: 214,
    oppose: 168,
  },
  {
    masterReferenceId: "eo-14057",
    referenceType: "executive_order",
    title: "Catalyzing Clean Energy Industries and Jobs Through Federal Sustainability",
    shortTitle: "Federal Clean Energy Order",
    category: "environment",
    status: "signed",
    description:
      "Sets a goal for the federal government to achieve carbon-free electricity and net-zero emissions from federal operations, procurement, and buildings.",
    signedDate: new Date("2025-02-12"),
    support: 189,
    oppose: 201,
  },
  {
    masterReferenceId: "eo-14036",
    referenceType: "executive_order",
    title: "Promoting Competition in the American Economy",
    shortTitle: "Economic Competition Order",
    category: "economy",
    status: "signed",
    description:
      "Directs agencies to combat anti-competitive practices, lower prices for consumers, and increase wages by promoting fair competition across major industries.",
    signedDate: new Date("2025-03-05"),
    support: 267,
    oppose: 94,
  },
  {
    masterReferenceId: "eo-14019",
    referenceType: "executive_order",
    title: "Promoting Access to Voting",
    shortTitle: "Voting Access Order",
    category: "civil_rights",
    status: "signed",
    description:
      "Directs federal agencies to expand access to voter registration and election information, and to make it easier for eligible citizens to participate in elections.",
    signedDate: new Date("2025-02-28"),
    support: 233,
    oppose: 176,
  },
  {
    masterReferenceId: "eo-14008",
    referenceType: "executive_order",
    title: "Tackling the Climate Crisis at Home and Abroad",
    shortTitle: "Climate Crisis Order",
    category: "environment",
    status: "signed",
    description:
      "Places the climate crisis at the center of U.S. foreign policy and national security, and commits to conserving 30% of federal lands and waters by 2030.",
    signedDate: new Date("2025-01-27"),
    support: 205,
    oppose: 188,
  },
  {
    masterReferenceId: "eo-14092",
    referenceType: "executive_order",
    title: "Reducing Gun Violence and Making Our Communities Safer",
    shortTitle: "Gun Violence Order",
    category: "justice",
    status: "signed",
    description:
      "Directs agencies to increase background check compliance, promote safe firearm storage, and improve federal support for community violence intervention programs.",
    signedDate: new Date("2025-03-14"),
    support: 221,
    oppose: 214,
  },

  // ---------------- Judicial (SCOTUS cases) ----------------
  {
    masterReferenceId: "scotus-22-451",
    referenceType: "scotus_case",
    title: "Loper Bright Enterprises v. Raimondo",
    shortTitle: "Chevron Deference Case",
    category: "justice",
    status: "decided",
    description:
      "A landmark case reconsidering the Chevron doctrine, which governs how much deference courts give to federal agencies' interpretations of ambiguous statutes.",
    sourceUrl: "https://www.supremecourt.gov/",
    decidedDate: new Date("2025-06-28"),
    support: 178,
    oppose: 192,
  },
  {
    masterReferenceId: "scotus-23-411",
    referenceType: "scotus_case",
    title: "Moore v. United States",
    category: "economy",
    status: "decided",
    description:
      "Addresses whether the federal government can tax unrealized gains, with significant implications for the structure of the U.S. tax code.",
    decidedDate: new Date("2025-06-20"),
    support: 156,
    oppose: 149,
  },
  {
    masterReferenceId: "scotus-23-175",
    referenceType: "scotus_case",
    title: "NetChoice v. Paxton",
    shortTitle: "Social Media Regulation Case",
    category: "technology",
    status: "decided",
    description:
      "Examines whether states can regulate how large social media platforms moderate content, balancing free speech rights against platform editorial discretion.",
    decidedDate: new Date("2025-07-01"),
    support: 203,
    oppose: 187,
  },
  {
    masterReferenceId: "scotus-22-914",
    referenceType: "scotus_case",
    title: "Department of State v. Muñoz",
    category: "immigration",
    status: "decided",
    description:
      "Considers the scope of constitutional protections in the visa application process and the government's authority over immigration decisions.",
    decidedDate: new Date("2025-06-15"),
    support: 134,
    oppose: 168,
  },
  {
    masterReferenceId: "scotus-23-719",
    referenceType: "scotus_case",
    title: "Fischer v. United States",
    category: "civil_rights",
    status: "decided",
    description:
      "Interprets the scope of federal obstruction statutes, with implications for how broadly certain criminal charges can be applied.",
    decidedDate: new Date("2025-06-25"),
    support: 145,
    oppose: 159,
  },
];

function pickDistinct<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  const count = Math.min(n, copy.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]!);
  }
  return out;
}

async function seed() {
  console.log("🌱 Seeding AYE & NAY database...");

  // Clean prior seed data (idempotent). Only removes sample citizens + references.
  await prisma.governmentReferenceVote.deleteMany({});
  await prisma.governmentReference.deleteMany({});
  // Both suffixes. These rows were seeded when the platform was called Civic
  // Voice, and clearing only the new one would leave every old sample account
  // behind — indistinguishable, from then on, from a real citizen.
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { endsWith: "@sample.ayeandnay.com" } },
        { email: { endsWith: "@sample.civicvoice.app" } },
      ],
    },
  });

  // Create a pool of sample citizens to back the Public Pulse with real vote rows.
  const NUM_CITIZENS = 400;
  const cities = [
    "Austin, TX", "Denver, CO", "Columbus, OH", "Portland, OR", "Atlanta, GA",
    "Phoenix, AZ", "Nashville, TN", "Seattle, WA", "Boston, MA", "Miami, FL",
    "Minneapolis, MN", "Charlotte, NC", "Detroit, MI", "Sacramento, CA", "Boise, ID",
  ];
  console.log(`Creating ${NUM_CITIZENS} sample citizens...`);
  await prisma.user.createMany({
    data: Array.from({ length: NUM_CITIZENS }, (_, i) => ({
      name: `Citizen ${i + 1}`,
      email: `citizen${i + 1}@sample.ayeandnay.com`,
      emailVerified: true,
      location: cities[i % cities.length],
    })),
  });
  const citizens = await prisma.user.findMany({
    where: { email: { endsWith: "@sample.ayeandnay.com" } },
    select: { id: true },
  });
  const citizenIds = citizens.map((c) => c.id);

  // Create references + backing votes
  let totalVotes = 0;
  for (const ref of references) {
    const created = await prisma.governmentReference.create({
      data: {
        masterReferenceId: ref.masterReferenceId,
        referenceType: ref.referenceType,
        title: ref.title,
        shortTitle: ref.shortTitle ?? null,
        category: ref.category,
        status: ref.status,
        chamber: ref.chamber ?? null,
        congress: ref.congress ?? null,
        description: ref.description,
        sourceUrl: ref.sourceUrl ?? null,
        signedDate: ref.signedDate ?? null,
        decidedDate: ref.decidedDate ?? null,
        totalComments: Math.floor(Math.random() * 40),
        totalShares: Math.floor(Math.random() * 25),
      },
    });

    // Scale seeded sentiment down to fit the sample citizen pool while keeping ratios.
    const scale = Math.min(1, (NUM_CITIZENS - 5) / (ref.support + ref.oppose));
    const supportN = Math.max(1, Math.round(ref.support * scale));
    const opposeN = Math.max(1, Math.round(ref.oppose * scale));

    // Each citizen may vote at most once per reference (unique constraint).
    const voters = pickDistinct(citizenIds, supportN + opposeN);
    const voteRows = voters.map((userId, idx) => ({
      governmentReferenceId: created.id,
      userId,
      position: idx < supportN ? "support" : "oppose",
    }));
    await prisma.governmentReferenceVote.createMany({ data: voteRows });

    const actualSupport = voteRows.filter((v) => v.position === "support").length;
    const actualOppose = voteRows.filter((v) => v.position === "oppose").length;
    await prisma.governmentReference.update({
      where: { id: created.id },
      data: { supportVotes: actualSupport, opposeVotes: actualOppose },
    });
    totalVotes += voteRows.length;
  }

  const counts = {
    references: await prisma.governmentReference.count(),
    bills: await prisma.governmentReference.count({ where: { referenceType: "bill" } }),
    executiveOrders: await prisma.governmentReference.count({ where: { referenceType: "executive_order" } }),
    scotusCases: await prisma.governmentReference.count({ where: { referenceType: "scotus_case" } }),
    sampleCitizens: citizenIds.length,
    votes: totalVotes,
  };

  console.log("\n📊 Seed complete:");
  console.log(`   References: ${counts.references} (${counts.bills} bills, ${counts.executiveOrders} executive orders, ${counts.scotusCases} SCOTUS cases)`);
  console.log(`   Sample citizens: ${counts.sampleCitizens}`);
  console.log(`   Backing votes: ${counts.votes}`);
}

seed()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
