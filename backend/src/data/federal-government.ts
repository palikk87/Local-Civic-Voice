/**
 * Canonical roster of the federal government's executive and judicial branches.
 *
 * This is the ONE source of water for both faucets (mobile + web). Congress is not
 * here — the 537 sitting members come live from Congress.gov via
 * services/congress-members.ts, because that roster changes constantly.
 *
 * Verified 2026-07-26 against:
 *   - https://www.whitehouse.gov/administration/        (President, Vice President)
 *   - https://www.whitehouse.gov/administration/cabinet/ (Cabinet + cabinet-rank)
 *   - Supreme Court October Term 2025 hearing lists      (the nine Justices)
 *
 * When a name changes, edit it HERE and both apps update.
 */

import type { Department, Official } from "../types";

export const GOVERNMENT_DATA_META = {
  lastUpdated: "2026-07-26T00:00:00Z",
  sources: [
    "https://www.whitehouse.gov/administration/",
    "https://www.whitehouse.gov/administration/cabinet/",
    "https://www.supremecourt.gov/about/biographies.aspx",
    "https://api.congress.gov/v3/member",
  ],
};

/** Shorthand so the records below stay readable. */
function official(input: Partial<Official> & Pick<Official, "id" | "name" | "title" | "group">): Official {
  return {
    shortTitle: input.title,
    branch: "executive",
    acting: false,
    party: null,
    department: null,
    since: null,
    appointedBy: null,
    photoUrl: null,
    website: null,
    phone: null,
    bio: null,
    successionOrder: null,
    ...input,
  } as Official;
}

// ============================================================
// EXECUTIVE BRANCH — President & Vice President
// ============================================================

const PRINCIPALS: Official[] = [
  official({
    id: "potus",
    name: "Donald J. Trump",
    title: "President of the United States",
    shortTitle: "President",
    group: "president",
    party: "R",
    since: "2025-01-20",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Official_Presidential_Portrait_of_President_Donald_J._Trump_%282025%29_%28cropped%29%282%29.jpg/330px-Official_Presidential_Portrait_of_President_Donald_J._Trump_%282025%29_%28cropped%29%282%29.jpg",
    website: "https://www.whitehouse.gov",
    phone: "202-456-1414",
    bio: "47th President of the United States. Previously served as the 45th President (2017-2021).",
  }),
  official({
    id: "vpotus",
    name: "JD Vance",
    title: "Vice President of the United States",
    shortTitle: "Vice President",
    group: "vice-president",
    party: "R",
    since: "2025-01-20",
    successionOrder: 1,
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/March_2026_Official_Vice_Presidential_Portrait_of_JD_Vance_%28head-and-shoulders_cropped%29.jpg/330px-March_2026_Official_Vice_Presidential_Portrait_of_JD_Vance_%28head-and-shoulders_cropped%29.jpg",
    website: "https://www.whitehouse.gov/administration/vice-president-vance/",
    phone: "202-456-1414",
    bio: "50th Vice President of the United States. Former U.S. Senator from Ohio. President of the Senate.",
  }),
];

// ============================================================
// EXECUTIVE BRANCH — The Cabinet (heads of the 15 departments)
// successionOrder follows the Presidential Succession Act: 4 = State,
// counting on from Vice President (1), Speaker (2), President pro tempore (3).
// ============================================================

const CABINET: Official[] = [
  official({
    id: "sec-state",
    name: "Marco Rubio",
    title: "Secretary of State",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Official_portrait_of_Secretary_Marco_Rubio_%28cropped%29%282%29.jpg/330px-Official_portrait_of_Secretary_Marco_Rubio_%28cropped%29%282%29.jpg",
    department: "dept-state",
    since: "2025-01-21",
    successionOrder: 4,
    website: "https://www.state.gov",
    phone: "202-647-4000",
    bio: "Former U.S. Senator from Florida. Also serving as Acting National Security Advisor.",
  }),
  official({
    id: "sec-treasury",
    name: "Scott Bessent",
    title: "Secretary of the Treasury",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Official_portrait_of_Treasury_Secretary_Scott_Bessent_%28borderless%29_%28cropped%29.jpg/330px-Official_portrait_of_Treasury_Secretary_Scott_Bessent_%28borderless%29_%28cropped%29.jpg",
    department: "dept-treasury",
    since: "2025-01-28",
    successionOrder: 5,
    website: "https://home.treasury.gov",
    phone: "202-622-2000",
    bio: "Investor and former hedge fund manager.",
  }),
  official({
    id: "sec-war",
    name: "Pete Hegseth",
    title: "Secretary of War",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Pete_Hegseth_Official_Portrait_%28cropped%29%28b%29.jpg/330px-Pete_Hegseth_Official_Portrait_%28cropped%29%28b%29.jpg",
    department: "dept-war",
    since: "2025-01-25",
    successionOrder: 6,
    website: "https://www.war.gov",
    phone: "703-571-3343",
    bio: "Army National Guard veteran and former television host. Leads the Department of War (formerly Defense).",
  }),
  official({
    id: "attorney-general",
    name: "Todd Blanche",
    title: "Acting Attorney General",
    group: "cabinet",
    acting: true,
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/DAG_DAG_Todd_Blanche_Official_Port.jpg/330px-DAG_DAG_Todd_Blanche_Official_Port.jpg",
    department: "dept-justice",
    since: "2026-01-01",
    successionOrder: 7,
    website: "https://www.justice.gov",
    phone: "202-514-2000",
    bio: "Serving as Acting Attorney General; previously Deputy Attorney General.",
  }),
  official({
    id: "sec-interior",
    name: "Doug Burgum",
    title: "Secretary of the Interior",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Doug_Burgum_2025_DOI_portrait_%28cropped%29%28b%29.jpg/330px-Doug_Burgum_2025_DOI_portrait_%28cropped%29%28b%29.jpg",
    department: "dept-interior",
    since: "2025-02-01",
    successionOrder: 8,
    website: "https://www.doi.gov",
    phone: "202-208-3100",
    bio: "Former Governor of North Dakota.",
  }),
  official({
    id: "sec-agriculture",
    name: "Brooke Rollins",
    title: "Secretary of Agriculture",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Second_Portrait_of_Secretary_Rollins.jpg/330px-Second_Portrait_of_Secretary_Rollins.jpg",
    department: "dept-agriculture",
    since: "2025-02-13",
    successionOrder: 9,
    website: "https://www.usda.gov",
    phone: "202-720-2791",
    bio: "Attorney and former head of the America First Policy Institute.",
  }),
  official({
    id: "sec-commerce",
    name: "Howard Lutnick",
    title: "Secretary of Commerce",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Howard_Lutnick_2025.jpg/330px-Howard_Lutnick_2025.jpg",
    department: "dept-commerce",
    since: "2025-02-21",
    successionOrder: 10,
    website: "https://www.commerce.gov",
    phone: "202-482-2000",
    bio: "Financial services executive.",
  }),
  official({
    id: "sec-labor",
    name: "Keith E. Sonderling",
    title: "Acting Secretary of Labor",
    group: "cabinet",
    acting: true,
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Deputy_Secretary_Sonderling.jpg/330px-Deputy_Secretary_Sonderling.jpg",
    department: "dept-labor",
    since: "2026-01-01",
    successionOrder: 11,
    website: "https://www.dol.gov",
    phone: "202-693-6000",
    bio: "Serving as Acting Secretary of Labor; previously Deputy Secretary of Labor.",
  }),
  official({
    id: "sec-hhs",
    name: "Robert F. Kennedy, Jr.",
    title: "Secretary of Health and Human Services",
    group: "cabinet",
    party: "I",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Robert_F._Kennedy_Jr.%2C_official_portrait_%282025%29_%28cropped_3-4%29_%28b%29.jpg/330px-Robert_F._Kennedy_Jr.%2C_official_portrait_%282025%29_%28cropped_3-4%29_%28b%29.jpg",
    department: "dept-hhs",
    since: "2025-02-13",
    successionOrder: 12,
    website: "https://www.hhs.gov",
    phone: "202-690-7000",
    bio: "Environmental attorney and former presidential candidate.",
  }),
  official({
    id: "sec-hud",
    name: "Scott Turner",
    title: "Secretary of Housing and Urban Development",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Scott_Turner%2C_official_portrait_%282025%29.jpg/330px-Scott_Turner%2C_official_portrait_%282025%29.jpg",
    department: "dept-hud",
    since: "2025-02-05",
    successionOrder: 13,
    website: "https://www.hud.gov",
    phone: "202-708-1112",
    bio: "Former Texas state representative and NFL player.",
  }),
  official({
    id: "sec-transportation",
    name: "Sean Duffy",
    title: "Secretary of Transportation",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Secretary_of_Transportation_Sean_Duffy_Official_Portrait.jpg/330px-Secretary_of_Transportation_Sean_Duffy_Official_Portrait.jpg",
    department: "dept-transportation",
    since: "2025-01-28",
    successionOrder: 14,
    website: "https://www.transportation.gov",
    phone: "202-366-4000",
    bio: "Former U.S. Representative from Wisconsin.",
  }),
  official({
    id: "sec-energy",
    name: "Chris Wright",
    title: "Secretary of Energy",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Secretary_Chris_Wright_Official_Portrait.png/330px-Secretary_Chris_Wright_Official_Portrait.png",
    department: "dept-energy",
    since: "2025-02-03",
    successionOrder: 15,
    website: "https://www.energy.gov",
    phone: "202-586-5000",
    bio: "Energy industry executive.",
  }),
  official({
    id: "sec-education",
    name: "Linda McMahon",
    title: "Secretary of Education",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/ED_Sec_Linda_McMahon_%28cropped%29.jpg/330px-ED_Sec_Linda_McMahon_%28cropped%29.jpg",
    department: "dept-education",
    since: "2025-03-03",
    successionOrder: 16,
    website: "https://www.ed.gov",
    phone: "202-401-2000",
    bio: "Former Administrator of the Small Business Administration.",
  }),
  official({
    id: "sec-va",
    name: "Doug Collins",
    title: "Secretary of Veterans Affairs",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Official_portrait_of_Douglas_Collins%2C_U.S._Secretary_of_Veterans_Affairs.jpeg/330px-Official_portrait_of_Douglas_Collins%2C_U.S._Secretary_of_Veterans_Affairs.jpeg",
    department: "dept-va",
    since: "2025-02-05",
    successionOrder: 17,
    website: "https://www.va.gov",
    phone: "202-461-4800",
    bio: "Former U.S. Representative from Georgia and Air Force Reserve chaplain.",
  }),
  official({
    id: "sec-dhs",
    name: "Markwayne Mullin",
    title: "Secretary of Homeland Security",
    group: "cabinet",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/DHS_Secretary_Markwayne_Mullin_Official_Portrait_%2855166865268%29.jpg/330px-DHS_Secretary_Markwayne_Mullin_Official_Portrait_%2855166865268%29.jpg",
    department: "dept-dhs",
    since: "2026-01-01",
    successionOrder: 18,
    website: "https://www.dhs.gov",
    phone: "202-282-8000",
    bio: "Former U.S. Senator and Representative from Oklahoma.",
  }),
];

// ============================================================
// EXECUTIVE BRANCH — Cabinet-rank officials (not in the line of succession)
// ============================================================

const CABINET_RANK: Official[] = [
  official({
    id: "ustr",
    name: "Jamieson Greer",
    title: "United States Trade Representative",
    group: "cabinet-rank",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Official_portrait_of_U.S._Trade_Representative_Jamieson_Greer_%28cropped_2%29.jpg/330px-Official_portrait_of_U.S._Trade_Representative_Jamieson_Greer_%28cropped_2%29.jpg",
    department: "office-ustr",
    since: "2025-02-26",
    website: "https://ustr.gov",
    phone: "202-395-3230",
    bio: "Trade attorney and former USTR chief of staff.",
  }),
  official({
    id: "omb-director",
    name: "Russ Vought",
    title: "Director of the Office of Management and Budget",
    shortTitle: "OMB Director",
    group: "cabinet-rank",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Russell_Vought%2C_official_portrait_%282025%29_%28cropped1%29.jpg/330px-Russell_Vought%2C_official_portrait_%282025%29_%28cropped1%29.jpg",
    department: "office-omb",
    since: "2025-02-07",
    website: "https://www.whitehouse.gov/omb/",
    phone: "202-395-3080",
    bio: "Served in the same role during the first Trump administration.",
  }),
  official({
    id: "epa-admin",
    name: "Lee Zeldin",
    title: "Administrator of the Environmental Protection Agency",
    shortTitle: "EPA Administrator",
    group: "cabinet-rank",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Lee-Zeldin-EPA-Official-Portrait.jpg/330px-Lee-Zeldin-EPA-Official-Portrait.jpg",
    department: "agency-epa",
    since: "2025-01-29",
    website: "https://www.epa.gov",
    phone: "202-564-4700",
    bio: "Former U.S. Representative from New York.",
  }),
  official({
    id: "sba-admin",
    name: "Kelly Loeffler",
    title: "Administrator of the Small Business Administration",
    shortTitle: "SBA Administrator",
    group: "cabinet-rank",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Kelly_Loeffler%2C_official_portrait_%282025%29.jpg/330px-Kelly_Loeffler%2C_official_portrait_%282025%29.jpg",
    department: "agency-sba",
    since: "2025-02-19",
    website: "https://www.sba.gov",
    phone: "202-205-6600",
    bio: "Former U.S. Senator from Georgia.",
  }),
  official({
    id: "cia-director",
    name: "John Ratcliffe",
    title: "Director of the Central Intelligence Agency",
    shortTitle: "CIA Director",
    group: "cabinet-rank",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/John_Ratcliffe_official_photo.jpg/330px-John_Ratcliffe_official_photo.jpg",
    department: "agency-cia",
    since: "2025-01-23",
    website: "https://www.cia.gov",
    bio: "Former Director of National Intelligence and U.S. Representative from Texas.",
  }),
  official({
    id: "dni",
    name: "William J. Pulte",
    title: "Acting Director of National Intelligence",
    shortTitle: "Acting DNI",
    group: "cabinet-rank",
    acting: true,
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Director_of_the_Federal_Housing_Finance_Agency_William_John_Pulte.jpg/330px-Director_of_the_Federal_Housing_Finance_Agency_William_John_Pulte.jpg",
    department: "agency-odni",
    since: "2026-01-01",
    website: "https://www.dni.gov",
    bio: "Serving as Acting Director of National Intelligence.",
  }),
];

// ============================================================
// EXECUTIVE BRANCH — Senior White House staff
// ============================================================

const WHITE_HOUSE_STAFF: Official[] = [
  official({
    id: "cos",
    name: "Susie Wiles",
    title: "White House Chief of Staff",
    group: "white-house",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Susie_Wiles_%28crop%29_%28cropped%29.jpg/330px-Susie_Wiles_%28crop%29_%28cropped%29.jpg",
    since: "2025-01-20",
    website: "https://www.whitehouse.gov",
    bio: "First woman to serve as White House Chief of Staff. Former campaign manager.",
  }),
  official({
    id: "nsa",
    name: "Marco Rubio",
    title: "Acting National Security Advisor",
    group: "white-house",
    acting: true,
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Official_portrait_of_Secretary_Marco_Rubio_%28cropped%29%282%29.jpg/330px-Official_portrait_of_Secretary_Marco_Rubio_%28cropped%29%282%29.jpg",
    since: "2025-05-01",
    website: "https://www.whitehouse.gov",
    bio: "Serving concurrently as Secretary of State.",
  }),
  official({
    id: "press-sec",
    name: "Karoline Leavitt",
    title: "White House Press Secretary",
    group: "white-house",
    party: "R",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Official_portrait_of_Karoline_Leavitt%2C_2025_%28cropped%29%282%29.jpg/330px-Official_portrait_of_Karoline_Leavitt%2C_2025_%28cropped%29%282%29.jpg",
    since: "2025-01-20",
    website: "https://www.whitehouse.gov/briefings-statements/",
    bio: "Youngest person to serve as White House Press Secretary.",
  }),
];

const EXECUTIVE: Official[] = [...PRINCIPALS, ...CABINET, ...CABINET_RANK, ...WHITE_HOUSE_STAFF];

// ============================================================
// JUDICIAL BRANCH — The Supreme Court of the United States
// Listed Chief Justice first, then Associate Justices by seniority.
// ============================================================

const JUDICIAL: Official[] = [
  official({
    id: "chief-justice",
    name: "John G. Roberts Jr.",
    title: "Chief Justice of the United States",
    shortTitle: "Chief Justice",
    branch: "judicial",
    group: "judicial",
    department: "court-scotus",
    since: "2005-09-29",
    appointedBy: "George W. Bush",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Official_roberts_CJ.jpg/330px-Official_roberts_CJ.jpg",
    website: "https://www.supremecourt.gov",
    phone: "202-479-3000",
    bio: "17th Chief Justice of the United States.",
  }),
  official({
    id: "justice-thomas",
    name: "Clarence Thomas",
    title: "Associate Justice of the Supreme Court",
    shortTitle: "Associate Justice",
    branch: "judicial",
    group: "judicial",
    department: "court-scotus",
    since: "1991-10-23",
    appointedBy: "George H. W. Bush",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Clarence_Thomas_official_SCOTUS_portrait_%283x4_cropped%29.jpg/330px-Clarence_Thomas_official_SCOTUS_portrait_%283x4_cropped%29.jpg",
    website: "https://www.supremecourt.gov",
    bio: "Most senior Associate Justice on the Court.",
  }),
  official({
    id: "justice-alito",
    name: "Samuel A. Alito Jr.",
    title: "Associate Justice of the Supreme Court",
    shortTitle: "Associate Justice",
    branch: "judicial",
    group: "judicial",
    department: "court-scotus",
    since: "2006-01-31",
    appointedBy: "George W. Bush",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Samuel_Alito_official_photo.jpg/330px-Samuel_Alito_official_photo.jpg",
    website: "https://www.supremecourt.gov",
    bio: "Previously served on the U.S. Court of Appeals for the Third Circuit.",
  }),
  official({
    id: "justice-sotomayor",
    name: "Sonia Sotomayor",
    title: "Associate Justice of the Supreme Court",
    shortTitle: "Associate Justice",
    branch: "judicial",
    group: "judicial",
    department: "court-scotus",
    since: "2009-08-08",
    appointedBy: "Barack Obama",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Sonia_Sotomayor_in_SCOTUS_robe.jpg/330px-Sonia_Sotomayor_in_SCOTUS_robe.jpg",
    website: "https://www.supremecourt.gov",
    bio: "First Hispanic and Latina member of the Court.",
  }),
  official({
    id: "justice-kagan",
    name: "Elena Kagan",
    title: "Associate Justice of the Supreme Court",
    shortTitle: "Associate Justice",
    branch: "judicial",
    group: "judicial",
    department: "court-scotus",
    since: "2010-08-07",
    appointedBy: "Barack Obama",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Elena_Kagan_Official_SCOTUS_Portrait_%282013%29.jpg/330px-Elena_Kagan_Official_SCOTUS_Portrait_%282013%29.jpg",
    website: "https://www.supremecourt.gov",
    bio: "Former Solicitor General of the United States and Dean of Harvard Law School.",
  }),
  official({
    id: "justice-gorsuch",
    name: "Neil M. Gorsuch",
    title: "Associate Justice of the Supreme Court",
    shortTitle: "Associate Justice",
    branch: "judicial",
    group: "judicial",
    department: "court-scotus",
    since: "2017-04-10",
    appointedBy: "Donald J. Trump",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Associate_Justice_Neil_Gorsuch_Official_Portrait.jpg/330px-Associate_Justice_Neil_Gorsuch_Official_Portrait.jpg",
    website: "https://www.supremecourt.gov",
    bio: "Previously served on the U.S. Court of Appeals for the Tenth Circuit.",
  }),
  official({
    id: "justice-kavanaugh",
    name: "Brett M. Kavanaugh",
    title: "Associate Justice of the Supreme Court",
    shortTitle: "Associate Justice",
    branch: "judicial",
    group: "judicial",
    department: "court-scotus",
    since: "2018-10-06",
    appointedBy: "Donald J. Trump",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Associate_Justice_Brett_Kavanaugh_Official_Portrait_%28full_length%29.jpg/330px-Associate_Justice_Brett_Kavanaugh_Official_Portrait_%28full_length%29.jpg",
    website: "https://www.supremecourt.gov",
    bio: "Previously served on the U.S. Court of Appeals for the D.C. Circuit.",
  }),
  official({
    id: "justice-barrett",
    name: "Amy Coney Barrett",
    title: "Associate Justice of the Supreme Court",
    shortTitle: "Associate Justice",
    branch: "judicial",
    group: "judicial",
    department: "court-scotus",
    since: "2020-10-27",
    appointedBy: "Donald J. Trump",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Official_Amy_Barrett_photo.jpg/330px-Official_Amy_Barrett_photo.jpg",
    website: "https://www.supremecourt.gov",
    bio: "Previously served on the U.S. Court of Appeals for the Seventh Circuit.",
  }),
  official({
    id: "justice-jackson",
    name: "Ketanji Brown Jackson",
    title: "Associate Justice of the Supreme Court",
    shortTitle: "Associate Justice",
    branch: "judicial",
    group: "judicial",
    department: "court-scotus",
    since: "2022-06-30",
    appointedBy: "Joseph R. Biden Jr.",
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Ketanji_Brown_Jackson_official_SCOTUS_portrait.jpg/330px-Ketanji_Brown_Jackson_official_SCOTUS_portrait.jpg",
    website: "https://www.supremecourt.gov",
    bio: "First Black woman to serve on the Supreme Court.",
  }),
];

// ============================================================
// DEPARTMENTS, AGENCIES & INSTITUTIONS
// ============================================================

function dept(input: Partial<Department> & Pick<Department, "id" | "name" | "abbreviation">): Department {
  return {
    branch: "executive",
    established: null,
    website: null,
    description: null,
    headOfficialId: null,
    ...input,
  } as Department;
}

const DEPARTMENTS: Department[] = [
  dept({ id: "dept-state", name: "Department of State", abbreviation: "DOS", established: "1789", website: "https://www.state.gov", headOfficialId: "sec-state", description: "Leads America's foreign policy through diplomacy, advocacy and assistance." }),
  dept({ id: "dept-treasury", name: "Department of the Treasury", abbreviation: "USDT", established: "1789", website: "https://home.treasury.gov", headOfficialId: "sec-treasury", description: "Manages federal finances, collects taxes and issues currency." }),
  dept({ id: "dept-war", name: "Department of War", abbreviation: "DOW", established: "1789", website: "https://www.war.gov", headOfficialId: "sec-war", description: "Provides the military forces needed to deter war and protect national security. Formerly the Department of Defense." }),
  dept({ id: "dept-justice", name: "Department of Justice", abbreviation: "DOJ", established: "1870", website: "https://www.justice.gov", headOfficialId: "attorney-general", description: "Enforces federal law and administers justice." }),
  dept({ id: "dept-interior", name: "Department of the Interior", abbreviation: "DOI", established: "1849", website: "https://www.doi.gov", headOfficialId: "sec-interior", description: "Manages public lands, natural resources and tribal relations." }),
  dept({ id: "dept-agriculture", name: "Department of Agriculture", abbreviation: "USDA", established: "1862", website: "https://www.usda.gov", headOfficialId: "sec-agriculture", description: "Supports farming, food safety and rural development." }),
  dept({ id: "dept-commerce", name: "Department of Commerce", abbreviation: "DOC", established: "1903", website: "https://www.commerce.gov", headOfficialId: "sec-commerce", description: "Promotes economic growth, trade and technological competitiveness." }),
  dept({ id: "dept-labor", name: "Department of Labor", abbreviation: "DOL", established: "1913", website: "https://www.dol.gov", headOfficialId: "sec-labor", description: "Protects workers' wages, safety and benefits." }),
  dept({ id: "dept-hhs", name: "Department of Health and Human Services", abbreviation: "HHS", established: "1953", website: "https://www.hhs.gov", headOfficialId: "sec-hhs", description: "Protects public health and administers Medicare and Medicaid." }),
  dept({ id: "dept-hud", name: "Department of Housing and Urban Development", abbreviation: "HUD", established: "1965", website: "https://www.hud.gov", headOfficialId: "sec-hud", description: "Supports affordable housing and community development." }),
  dept({ id: "dept-transportation", name: "Department of Transportation", abbreviation: "DOT", established: "1966", website: "https://www.transportation.gov", headOfficialId: "sec-transportation", description: "Oversees highways, aviation, rail and transit safety." }),
  dept({ id: "dept-energy", name: "Department of Energy", abbreviation: "DOE", established: "1977", website: "https://www.energy.gov", headOfficialId: "sec-energy", description: "Manages energy policy, research and the nuclear stockpile." }),
  dept({ id: "dept-education", name: "Department of Education", abbreviation: "ED", established: "1979", website: "https://www.ed.gov", headOfficialId: "sec-education", description: "Administers federal education funding and policy." }),
  dept({ id: "dept-va", name: "Department of Veterans Affairs", abbreviation: "VA", established: "1989", website: "https://www.va.gov", headOfficialId: "sec-va", description: "Provides health care, benefits and burial services to veterans." }),
  dept({ id: "dept-dhs", name: "Department of Homeland Security", abbreviation: "DHS", established: "2002", website: "https://www.dhs.gov", headOfficialId: "sec-dhs", description: "Secures borders, aviation and critical infrastructure." }),
  dept({ id: "office-ustr", name: "Office of the United States Trade Representative", abbreviation: "USTR", established: "1962", website: "https://ustr.gov", headOfficialId: "ustr", description: "Develops and coordinates U.S. trade policy." }),
  dept({ id: "office-omb", name: "Office of Management and Budget", abbreviation: "OMB", established: "1970", website: "https://www.whitehouse.gov/omb/", headOfficialId: "omb-director", description: "Prepares the President's budget and oversees agency performance." }),
  dept({ id: "agency-epa", name: "Environmental Protection Agency", abbreviation: "EPA", established: "1970", website: "https://www.epa.gov", headOfficialId: "epa-admin", description: "Protects human health and the environment." }),
  dept({ id: "agency-sba", name: "Small Business Administration", abbreviation: "SBA", established: "1953", website: "https://www.sba.gov", headOfficialId: "sba-admin", description: "Supports small businesses with loans, contracting and counseling." }),
  dept({ id: "agency-cia", name: "Central Intelligence Agency", abbreviation: "CIA", established: "1947", website: "https://www.cia.gov", headOfficialId: "cia-director", description: "Collects and analyses foreign intelligence." }),
  dept({ id: "agency-odni", name: "Office of the Director of National Intelligence", abbreviation: "ODNI", established: "2005", website: "https://www.dni.gov", headOfficialId: "dni", description: "Leads and integrates the U.S. Intelligence Community." }),
  dept({ id: "court-scotus", name: "Supreme Court of the United States", abbreviation: "SCOTUS", branch: "judicial", established: "1789", website: "https://www.supremecourt.gov", headOfficialId: "chief-justice", description: "The highest court in the federal judiciary. Nine Justices serve for life." }),
  dept({ id: "body-senate", name: "United States Senate", abbreviation: "Senate", branch: "legislative", established: "1789", website: "https://www.senate.gov", description: "100 Senators, two from each state, serving six-year terms." }),
  dept({ id: "body-house", name: "United States House of Representatives", abbreviation: "House", branch: "legislative", established: "1789", website: "https://www.house.gov", description: "435 voting Representatives apportioned by state population, serving two-year terms." }),
];

export { EXECUTIVE, JUDICIAL, DEPARTMENTS, CABINET, CABINET_RANK, PRINCIPALS, WHITE_HOUSE_STAFF };

/**
 * WHERE EACH OFFICIAL'S PHOTOGRAPH COMES FROM.
 *
 * The `photoUrl` recorded against every official above is a Wikimedia address,
 * and until now it was handed straight to the reader's browser — so every
 * Government screen on this platform fetched thirty-six pictures from somebody
 * else's server, every time it painted, and a face was missing whenever that
 * server said no.
 *
 * Now the screen is given our address instead, and the first request for a post
 * fetches the photograph once and keeps it. This map is what that fetch reads.
 * The URLs stay here rather than being replaced: a face on a public official
 * should say where it came from, and a post added to this file tomorrow is
 * collected the first time anybody opens the screen. See routes/portraits.ts.
 */
export const OFFICIAL_PORTRAIT_SOURCES: Record<string, string> = Object.fromEntries(
  [...EXECUTIVE, ...JUDICIAL]
    .filter((official) => official.photoUrl)
    .map((official) => [`official-${official.id}`, official.photoUrl as string]),
);
