// Complete Federal Government Structure
// Auto-update feature: lastUpdated timestamp tracks when data was refreshed
// Data sources: whitehouse.gov, senate.gov, house.gov, supremecourt.gov, usa.gov

import type { GovernmentBranch } from './types';

export interface GovernmentPosition {
  id: string;
  title: string;
  department?: string;
  branch: GovernmentBranch;
  level: 'head' | 'cabinet' | 'senior' | 'member' | 'justice';
  order?: number; // For succession or seniority
}

export interface OfficeHolder {
  id: string;
  positionId: string;
  name: string;
  party?: 'D' | 'R' | 'I' | 'none';
  state?: string;
  imageUrl: string;
  appointedBy?: string;
  startDate: string;
  endDate?: string;
  bio?: string;
  contact?: {
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
  };
}

export interface GovernmentDepartment {
  id: string;
  name: string;
  shortName: string;
  branch: GovernmentBranch;
  description: string;
  website: string;
  established: string;
  headPositionId: string;
}

// Last updated timestamp for auto-update feature
export const governmentDataMeta = {
  lastUpdated: '2025-01-20T12:00:00Z',
  version: '119th-congress',
  sources: [
    'https://www.whitehouse.gov/administration/',
    'https://www.senate.gov/senators/',
    'https://www.house.gov/representatives',
    'https://www.supremecourt.gov/about/biographies.aspx',
  ],
};

// ==========================================
// EXECUTIVE BRANCH POSITIONS
// ==========================================

export const executivePositions: GovernmentPosition[] = [
  // White House
  { id: 'potus', title: 'President of the United States', branch: 'executive', level: 'head', order: 1 },
  { id: 'vpotus', title: 'Vice President of the United States', branch: 'executive', level: 'head', order: 2 },
  { id: 'cos', title: 'White House Chief of Staff', department: 'Executive Office', branch: 'executive', level: 'senior', order: 3 },
  { id: 'nsa', title: 'National Security Advisor', department: 'National Security Council', branch: 'executive', level: 'senior' },
  { id: 'press-sec', title: 'White House Press Secretary', department: 'Executive Office', branch: 'executive', level: 'senior' },

  // Cabinet Departments (in order of succession)
  { id: 'sec-state', title: 'Secretary of State', department: 'Department of State', branch: 'executive', level: 'cabinet', order: 4 },
  { id: 'sec-treasury', title: 'Secretary of the Treasury', department: 'Department of the Treasury', branch: 'executive', level: 'cabinet', order: 5 },
  { id: 'sec-defense', title: 'Secretary of Defense', department: 'Department of Defense', branch: 'executive', level: 'cabinet', order: 6 },
  { id: 'attorney-general', title: 'Attorney General', department: 'Department of Justice', branch: 'executive', level: 'cabinet', order: 7 },
  { id: 'sec-interior', title: 'Secretary of the Interior', department: 'Department of the Interior', branch: 'executive', level: 'cabinet', order: 8 },
  { id: 'sec-agriculture', title: 'Secretary of Agriculture', department: 'Department of Agriculture', branch: 'executive', level: 'cabinet', order: 9 },
  { id: 'sec-commerce', title: 'Secretary of Commerce', department: 'Department of Commerce', branch: 'executive', level: 'cabinet', order: 10 },
  { id: 'sec-labor', title: 'Secretary of Labor', department: 'Department of Labor', branch: 'executive', level: 'cabinet', order: 11 },
  { id: 'sec-hhs', title: 'Secretary of Health and Human Services', department: 'Department of Health and Human Services', branch: 'executive', level: 'cabinet', order: 12 },
  { id: 'sec-hud', title: 'Secretary of Housing and Urban Development', department: 'Department of Housing and Urban Development', branch: 'executive', level: 'cabinet', order: 13 },
  { id: 'sec-transportation', title: 'Secretary of Transportation', department: 'Department of Transportation', branch: 'executive', level: 'cabinet', order: 14 },
  { id: 'sec-energy', title: 'Secretary of Energy', department: 'Department of Energy', branch: 'executive', level: 'cabinet', order: 15 },
  { id: 'sec-education', title: 'Secretary of Education', department: 'Department of Education', branch: 'executive', level: 'cabinet', order: 16 },
  { id: 'sec-va', title: 'Secretary of Veterans Affairs', department: 'Department of Veterans Affairs', branch: 'executive', level: 'cabinet', order: 17 },
  { id: 'sec-dhs', title: 'Secretary of Homeland Security', department: 'Department of Homeland Security', branch: 'executive', level: 'cabinet', order: 18 },

  // Cabinet-level positions
  { id: 'epa-admin', title: 'EPA Administrator', department: 'Environmental Protection Agency', branch: 'executive', level: 'cabinet' },
  { id: 'omb-director', title: 'Director of the Office of Management and Budget', department: 'Office of Management and Budget', branch: 'executive', level: 'cabinet' },
  { id: 'dni', title: 'Director of National Intelligence', department: 'Office of the Director of National Intelligence', branch: 'executive', level: 'cabinet' },
  { id: 'ustr', title: 'United States Trade Representative', department: 'Office of the U.S. Trade Representative', branch: 'executive', level: 'cabinet' },
  { id: 'un-ambassador', title: 'U.S. Ambassador to the United Nations', department: 'U.S. Mission to the United Nations', branch: 'executive', level: 'cabinet' },
  { id: 'cea-chair', title: 'Chair of the Council of Economic Advisers', department: 'Council of Economic Advisers', branch: 'executive', level: 'cabinet' },
  { id: 'sba-admin', title: 'Administrator of the Small Business Administration', department: 'Small Business Administration', branch: 'executive', level: 'cabinet' },
  { id: 'cia-director', title: 'Director of the Central Intelligence Agency', department: 'Central Intelligence Agency', branch: 'executive', level: 'senior' },
];

// ==========================================
// LEGISLATIVE BRANCH POSITIONS
// ==========================================

export const legislativePositions: GovernmentPosition[] = [
  // Senate Leadership
  { id: 'senate-president', title: 'President of the Senate', branch: 'legislative', level: 'head', order: 1 },
  { id: 'senate-ppt', title: 'President Pro Tempore of the Senate', branch: 'legislative', level: 'head', order: 2 },
  { id: 'senate-majority-leader', title: 'Senate Majority Leader', branch: 'legislative', level: 'senior', order: 3 },
  { id: 'senate-minority-leader', title: 'Senate Minority Leader', branch: 'legislative', level: 'senior', order: 4 },
  { id: 'senate-majority-whip', title: 'Senate Majority Whip', branch: 'legislative', level: 'senior', order: 5 },
  { id: 'senate-minority-whip', title: 'Senate Minority Whip', branch: 'legislative', level: 'senior', order: 6 },

  // House Leadership
  { id: 'house-speaker', title: 'Speaker of the House', branch: 'legislative', level: 'head', order: 1 },
  { id: 'house-majority-leader', title: 'House Majority Leader', branch: 'legislative', level: 'senior', order: 2 },
  { id: 'house-minority-leader', title: 'House Minority Leader', branch: 'legislative', level: 'senior', order: 3 },
  { id: 'house-majority-whip', title: 'House Majority Whip', branch: 'legislative', level: 'senior', order: 4 },
  { id: 'house-minority-whip', title: 'House Minority Whip', branch: 'legislative', level: 'senior', order: 5 },

  // Members
  { id: 'senator', title: 'United States Senator', branch: 'legislative', level: 'member' },
  { id: 'representative', title: 'United States Representative', branch: 'legislative', level: 'member' },
];

// ==========================================
// JUDICIAL BRANCH POSITIONS
// ==========================================

export const judicialPositions: GovernmentPosition[] = [
  // Supreme Court
  { id: 'chief-justice', title: 'Chief Justice of the United States', department: 'Supreme Court', branch: 'judicial', level: 'head', order: 1 },
  { id: 'associate-justice', title: 'Associate Justice of the Supreme Court', department: 'Supreme Court', branch: 'judicial', level: 'justice' },

  // Federal Courts
  { id: 'circuit-judge', title: 'Circuit Judge', department: 'U.S. Courts of Appeals', branch: 'judicial', level: 'justice' },
  { id: 'district-judge', title: 'District Judge', department: 'U.S. District Courts', branch: 'judicial', level: 'justice' },
];

// ==========================================
// CURRENT OFFICE HOLDERS (Trump Administration 2025)
// ==========================================

export const currentOfficeHolders: OfficeHolder[] = [
  // Executive Branch - White House
  {
    id: 'trump-47',
    positionId: 'potus',
    name: 'Donald J. Trump',
    party: 'R',
    imageUrl: 'https://www.whitehouse.gov/wp-content/uploads/2025/01/47-donald-trump.jpg',
    startDate: '2025-01-20',
    bio: '47th President of the United States. Previously served as 45th President (2017-2021).',
    contact: {
      website: 'https://www.whitehouse.gov',
      address: '1600 Pennsylvania Avenue NW, Washington, DC 20500',
    },
  },
  {
    id: 'vance-50',
    positionId: 'vpotus',
    name: 'JD Vance',
    party: 'R',
    state: 'OH',
    imageUrl: 'https://www.whitehouse.gov/wp-content/uploads/2025/01/50-jd-vance.jpg',
    startDate: '2025-01-20',
    bio: '50th Vice President of the United States. Former U.S. Senator from Ohio.',
    contact: {
      website: 'https://www.whitehouse.gov/administration/vice-president-vance/',
    },
  },
  {
    id: 'susie-wiles',
    positionId: 'cos',
    name: 'Susie Wiles',
    party: 'R',
    imageUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'First female White House Chief of Staff. Longtime Republican strategist.',
  },
  {
    id: 'mike-waltz',
    positionId: 'nsa',
    name: 'Michael Waltz',
    party: 'R',
    state: 'FL',
    imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former U.S. Representative from Florida. Green Beret veteran.',
  },
  {
    id: 'karoline-leavitt',
    positionId: 'press-sec',
    name: 'Karoline Leavitt',
    party: 'R',
    imageUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Youngest White House Press Secretary in history at age 27.',
  },

  // Cabinet
  {
    id: 'marco-rubio',
    positionId: 'sec-state',
    name: 'Marco Rubio',
    party: 'R',
    state: 'FL',
    imageUrl: 'https://www.rubio.senate.gov/wp-content/uploads/2023/01/rubio-official.jpg',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former U.S. Senator from Florida. First Latino Secretary of State.',
  },
  {
    id: 'scott-bessent',
    positionId: 'sec-treasury',
    name: 'Scott Bessent',
    party: 'R',
    imageUrl: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Hedge fund manager and economic advisor.',
  },
  {
    id: 'pete-hegseth',
    positionId: 'sec-defense',
    name: 'Pete Hegseth',
    party: 'R',
    imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former Fox News host and Army National Guard officer.',
  },
  {
    id: 'pam-bondi',
    positionId: 'attorney-general',
    name: 'Pam Bondi',
    party: 'R',
    state: 'FL',
    imageUrl: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former Florida Attorney General.',
  },
  {
    id: 'doug-burgum',
    positionId: 'sec-interior',
    name: 'Doug Burgum',
    party: 'R',
    state: 'ND',
    imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former Governor of North Dakota. Software entrepreneur.',
  },
  {
    id: 'brooke-rollins',
    positionId: 'sec-agriculture',
    name: 'Brooke Rollins',
    party: 'R',
    imageUrl: 'https://images.unsplash.com/photo-1551836022-deb4988cc6c0?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former Director of the Domestic Policy Council.',
  },
  {
    id: 'howard-lutnick',
    positionId: 'sec-commerce',
    name: 'Howard Lutnick',
    party: 'R',
    imageUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'CEO of Cantor Fitzgerald.',
  },
  {
    id: 'lori-chavez-deremer',
    positionId: 'sec-labor',
    name: 'Lori Chavez-DeRemer',
    party: 'R',
    state: 'OR',
    imageUrl: 'https://images.unsplash.com/photo-1594744803329-e58b31de8bf5?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former U.S. Representative from Oregon.',
  },
  {
    id: 'robert-kennedy-jr',
    positionId: 'sec-hhs',
    name: 'Robert F. Kennedy Jr.',
    party: 'D',
    imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Environmental lawyer and former independent presidential candidate.',
  },
  {
    id: 'scott-turner',
    positionId: 'sec-hud',
    name: 'Scott Turner',
    party: 'R',
    state: 'TX',
    imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former NFL player and Executive Director of White House Opportunity and Revitalization Council.',
  },
  {
    id: 'sean-duffy',
    positionId: 'sec-transportation',
    name: 'Sean Duffy',
    party: 'R',
    state: 'WI',
    imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former U.S. Representative from Wisconsin. Fox Business host.',
  },
  {
    id: 'chris-wright',
    positionId: 'sec-energy',
    name: 'Chris Wright',
    party: 'R',
    imageUrl: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'CEO of Liberty Energy. Fracking industry leader.',
  },
  {
    id: 'linda-mcmahon',
    positionId: 'sec-education',
    name: 'Linda McMahon',
    party: 'R',
    imageUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former WWE CEO and SBA Administrator.',
  },
  {
    id: 'doug-collins',
    positionId: 'sec-va',
    name: 'Doug Collins',
    party: 'R',
    state: 'GA',
    imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former U.S. Representative from Georgia. Air Force Reserve chaplain.',
  },
  {
    id: 'kristi-noem',
    positionId: 'sec-dhs',
    name: 'Kristi Noem',
    party: 'R',
    state: 'SD',
    imageUrl: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former Governor of South Dakota.',
  },
  {
    id: 'lee-zeldin',
    positionId: 'epa-admin',
    name: 'Lee Zeldin',
    party: 'R',
    state: 'NY',
    imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former U.S. Representative from New York.',
  },
  {
    id: 'russell-vought',
    positionId: 'omb-director',
    name: 'Russell Vought',
    party: 'R',
    imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former OMB Director (2020-2021). Project 2025 contributor.',
  },
  {
    id: 'tulsi-gabbard',
    positionId: 'dni',
    name: 'Tulsi Gabbard',
    party: 'R',
    state: 'HI',
    imageUrl: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former U.S. Representative from Hawaii. Former Democrat turned Republican.',
  },
  {
    id: 'john-ratcliffe',
    positionId: 'cia-director',
    name: 'John Ratcliffe',
    party: 'R',
    state: 'TX',
    imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former DNI (2020-2021) and U.S. Representative from Texas.',
  },
  {
    id: 'elise-stefanik',
    positionId: 'un-ambassador',
    name: 'Elise Stefanik',
    party: 'R',
    state: 'NY',
    imageUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&h=200&fit=crop',
    startDate: '2025-01-20',
    appointedBy: 'Donald J. Trump',
    bio: 'Former U.S. Representative from New York and House Republican Conference Chair.',
  },

  // Legislative Branch Leadership
  {
    id: 'mike-johnson',
    positionId: 'house-speaker',
    name: 'Mike Johnson',
    party: 'R',
    state: 'LA',
    imageUrl: 'https://www.speaker.gov/wp-content/uploads/2023/10/Official-Speaker-Johnson.jpg',
    startDate: '2023-10-25',
    bio: '56th Speaker of the House. Represents Louisiana\'s 4th district.',
    contact: {
      website: 'https://www.speaker.gov',
      phone: '(202) 225-4000',
    },
  },
  {
    id: 'john-thune',
    positionId: 'senate-majority-leader',
    name: 'John Thune',
    party: 'R',
    state: 'SD',
    imageUrl: 'https://www.thune.senate.gov/public/index.cfm/files/serve?File_id=1a9e6f3e-4f9a-4e1e-a1a7-1b1b1b1b1b1b',
    startDate: '2025-01-03',
    bio: 'U.S. Senator from South Dakota since 2005. Succeeded Mitch McConnell as Majority Leader.',
    contact: {
      website: 'https://www.thune.senate.gov',
      phone: '(202) 224-2321',
    },
  },
  {
    id: 'chuck-schumer',
    positionId: 'senate-minority-leader',
    name: 'Chuck Schumer',
    party: 'D',
    state: 'NY',
    imageUrl: 'https://www.schumer.senate.gov/imo/media/image/schumer_official.jpg',
    startDate: '2025-01-03',
    bio: 'U.S. Senator from New York since 1999. Former Senate Majority Leader.',
    contact: {
      website: 'https://www.schumer.senate.gov',
      phone: '(202) 224-6542',
    },
  },
  {
    id: 'hakeem-jeffries',
    positionId: 'house-minority-leader',
    name: 'Hakeem Jeffries',
    party: 'D',
    state: 'NY',
    imageUrl: 'https://jeffries.house.gov/sites/jeffries.house.gov/files/wysiwyg_uploaded/HJ%20Official%20Portrait%20118th.jpg',
    startDate: '2023-01-03',
    bio: 'U.S. Representative from New York\'s 8th district. First Black House party leader.',
    contact: {
      website: 'https://jeffries.house.gov',
      phone: '(202) 225-5936',
    },
  },
  {
    id: 'steve-scalise',
    positionId: 'house-majority-leader',
    name: 'Steve Scalise',
    party: 'R',
    state: 'LA',
    imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    startDate: '2023-01-03',
    bio: 'U.S. Representative from Louisiana\'s 1st district.',
    contact: {
      website: 'https://scalise.house.gov',
      phone: '(202) 225-3015',
    },
  },
  {
    id: 'john-barrasso',
    positionId: 'senate-majority-whip',
    name: 'John Barrasso',
    party: 'R',
    state: 'WY',
    imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop',
    startDate: '2025-01-03',
    bio: 'U.S. Senator from Wyoming since 2007.',
    contact: {
      website: 'https://www.barrasso.senate.gov',
      phone: '(202) 224-6441',
    },
  },
  {
    id: 'dick-durbin',
    positionId: 'senate-minority-whip',
    name: 'Dick Durbin',
    party: 'D',
    state: 'IL',
    imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    startDate: '2025-01-03',
    bio: 'U.S. Senator from Illinois since 1997.',
    contact: {
      website: 'https://www.durbin.senate.gov',
      phone: '(202) 224-2152',
    },
  },

  // Supreme Court Justices
  {
    id: 'john-roberts',
    positionId: 'chief-justice',
    name: 'John G. Roberts Jr.',
    party: 'none',
    imageUrl: 'https://www.supremecourt.gov/about/images/JGRoberts.jpg',
    startDate: '2005-09-29',
    appointedBy: 'George W. Bush',
    bio: '17th Chief Justice of the United States.',
  },
  {
    id: 'clarence-thomas',
    positionId: 'associate-justice',
    name: 'Clarence Thomas',
    party: 'none',
    imageUrl: 'https://www.supremecourt.gov/about/images/CThomas.jpg',
    startDate: '1991-10-23',
    appointedBy: 'George H.W. Bush',
    bio: 'Most senior Associate Justice. Second African American to serve on the Court.',
  },
  {
    id: 'samuel-alito',
    positionId: 'associate-justice',
    name: 'Samuel A. Alito Jr.',
    party: 'none',
    imageUrl: 'https://www.supremecourt.gov/about/images/SAlito.jpg',
    startDate: '2006-01-31',
    appointedBy: 'George W. Bush',
    bio: 'Author of Dobbs v. Jackson decision overturning Roe v. Wade.',
  },
  {
    id: 'sonia-sotomayor',
    positionId: 'associate-justice',
    name: 'Sonia Sotomayor',
    party: 'none',
    imageUrl: 'https://www.supremecourt.gov/about/images/SSotomayor.jpg',
    startDate: '2009-08-08',
    appointedBy: 'Barack Obama',
    bio: 'First Hispanic and Latina Justice.',
  },
  {
    id: 'elena-kagan',
    positionId: 'associate-justice',
    name: 'Elena Kagan',
    party: 'none',
    imageUrl: 'https://www.supremecourt.gov/about/images/EKagan.jpg',
    startDate: '2010-08-07',
    appointedBy: 'Barack Obama',
    bio: 'Former Solicitor General and Harvard Law School Dean.',
  },
  {
    id: 'neil-gorsuch',
    positionId: 'associate-justice',
    name: 'Neil M. Gorsuch',
    party: 'none',
    imageUrl: 'https://www.supremecourt.gov/about/images/NGorsuch.jpg',
    startDate: '2017-04-10',
    appointedBy: 'Donald J. Trump',
    bio: 'Former Tenth Circuit Court of Appeals judge.',
  },
  {
    id: 'brett-kavanaugh',
    positionId: 'associate-justice',
    name: 'Brett M. Kavanaugh',
    party: 'none',
    imageUrl: 'https://www.supremecourt.gov/about/images/BKavanaugh.jpg',
    startDate: '2018-10-06',
    appointedBy: 'Donald J. Trump',
    bio: 'Former D.C. Circuit Court of Appeals judge.',
  },
  {
    id: 'amy-coney-barrett',
    positionId: 'associate-justice',
    name: 'Amy Coney Barrett',
    party: 'none',
    imageUrl: 'https://www.supremecourt.gov/about/images/ABarrett.jpg',
    startDate: '2020-10-27',
    appointedBy: 'Donald J. Trump',
    bio: 'Former Notre Dame Law professor and Seventh Circuit judge.',
  },
  {
    id: 'ketanji-brown-jackson',
    positionId: 'associate-justice',
    name: 'Ketanji Brown Jackson',
    party: 'none',
    imageUrl: 'https://www.supremecourt.gov/about/images/KJackson.jpg',
    startDate: '2022-06-30',
    appointedBy: 'Joe Biden',
    bio: 'First Black woman to serve on the Supreme Court.',
  },
];

// ==========================================
// GOVERNMENT DEPARTMENTS
// ==========================================

export const governmentDepartments: GovernmentDepartment[] = [
  // Executive Departments
  {
    id: 'dept-state',
    name: 'Department of State',
    shortName: 'State',
    branch: 'executive',
    description: 'Responsible for foreign affairs and diplomacy.',
    website: 'https://www.state.gov',
    established: '1789',
    headPositionId: 'sec-state',
  },
  {
    id: 'dept-treasury',
    name: 'Department of the Treasury',
    shortName: 'Treasury',
    branch: 'executive',
    description: 'Manages government revenue and monetary policy.',
    website: 'https://www.treasury.gov',
    established: '1789',
    headPositionId: 'sec-treasury',
  },
  {
    id: 'dept-defense',
    name: 'Department of Defense',
    shortName: 'Defense',
    branch: 'executive',
    description: 'Provides military forces to deter war and protect security.',
    website: 'https://www.defense.gov',
    established: '1947',
    headPositionId: 'sec-defense',
  },
  {
    id: 'dept-justice',
    name: 'Department of Justice',
    shortName: 'Justice',
    branch: 'executive',
    description: 'Enforces federal laws and administers justice.',
    website: 'https://www.justice.gov',
    established: '1870',
    headPositionId: 'attorney-general',
  },
  {
    id: 'dept-interior',
    name: 'Department of the Interior',
    shortName: 'Interior',
    branch: 'executive',
    description: 'Manages federal lands and natural resources.',
    website: 'https://www.doi.gov',
    established: '1849',
    headPositionId: 'sec-interior',
  },
  {
    id: 'dept-agriculture',
    name: 'Department of Agriculture',
    shortName: 'Agriculture',
    branch: 'executive',
    description: 'Develops and executes farm, food, and conservation policy.',
    website: 'https://www.usda.gov',
    established: '1862',
    headPositionId: 'sec-agriculture',
  },
  {
    id: 'dept-commerce',
    name: 'Department of Commerce',
    shortName: 'Commerce',
    branch: 'executive',
    description: 'Promotes economic growth and job creation.',
    website: 'https://www.commerce.gov',
    established: '1903',
    headPositionId: 'sec-commerce',
  },
  {
    id: 'dept-labor',
    name: 'Department of Labor',
    shortName: 'Labor',
    branch: 'executive',
    description: 'Protects workers\' rights and workplace safety.',
    website: 'https://www.dol.gov',
    established: '1913',
    headPositionId: 'sec-labor',
  },
  {
    id: 'dept-hhs',
    name: 'Department of Health and Human Services',
    shortName: 'HHS',
    branch: 'executive',
    description: 'Protects health of Americans and provides essential services.',
    website: 'https://www.hhs.gov',
    established: '1979',
    headPositionId: 'sec-hhs',
  },
  {
    id: 'dept-hud',
    name: 'Department of Housing and Urban Development',
    shortName: 'HUD',
    branch: 'executive',
    description: 'Addresses housing needs and promotes community development.',
    website: 'https://www.hud.gov',
    established: '1965',
    headPositionId: 'sec-hud',
  },
  {
    id: 'dept-transportation',
    name: 'Department of Transportation',
    shortName: 'Transportation',
    branch: 'executive',
    description: 'Ensures safe and efficient transportation system.',
    website: 'https://www.transportation.gov',
    established: '1967',
    headPositionId: 'sec-transportation',
  },
  {
    id: 'dept-energy',
    name: 'Department of Energy',
    shortName: 'Energy',
    branch: 'executive',
    description: 'Advances energy and nuclear security.',
    website: 'https://www.energy.gov',
    established: '1977',
    headPositionId: 'sec-energy',
  },
  {
    id: 'dept-education',
    name: 'Department of Education',
    shortName: 'Education',
    branch: 'executive',
    description: 'Promotes student achievement and educational excellence.',
    website: 'https://www.ed.gov',
    established: '1979',
    headPositionId: 'sec-education',
  },
  {
    id: 'dept-va',
    name: 'Department of Veterans Affairs',
    shortName: 'VA',
    branch: 'executive',
    description: 'Provides benefits and services to veterans.',
    website: 'https://www.va.gov',
    established: '1989',
    headPositionId: 'sec-va',
  },
  {
    id: 'dept-dhs',
    name: 'Department of Homeland Security',
    shortName: 'DHS',
    branch: 'executive',
    description: 'Secures the nation from threats.',
    website: 'https://www.dhs.gov',
    established: '2002',
    headPositionId: 'sec-dhs',
  },
  // Legislative
  {
    id: 'us-senate',
    name: 'United States Senate',
    shortName: 'Senate',
    branch: 'legislative',
    description: 'Upper chamber of Congress. 100 members, 2 per state.',
    website: 'https://www.senate.gov',
    established: '1789',
    headPositionId: 'senate-president',
  },
  {
    id: 'us-house',
    name: 'United States House of Representatives',
    shortName: 'House',
    branch: 'legislative',
    description: 'Lower chamber of Congress. 435 members based on population.',
    website: 'https://www.house.gov',
    established: '1789',
    headPositionId: 'house-speaker',
  },
  // Judicial
  {
    id: 'supreme-court',
    name: 'Supreme Court of the United States',
    shortName: 'SCOTUS',
    branch: 'judicial',
    description: 'Highest court in the federal judiciary. 9 justices.',
    website: 'https://www.supremecourt.gov',
    established: '1789',
    headPositionId: 'chief-justice',
  },
];

// ==========================================
// HELPER FUNCTIONS
// ==========================================

export function getOfficeHolderByPosition(positionId: string): OfficeHolder | undefined {
  return currentOfficeHolders.find(h => h.positionId === positionId);
}

export function getPositionById(positionId: string): GovernmentPosition | undefined {
  return [
    ...executivePositions,
    ...legislativePositions,
    ...judicialPositions,
  ].find(p => p.id === positionId);
}

export function getOfficeHoldersByBranch(branch: GovernmentBranch): OfficeHolder[] {
  const branchPositionIds = [
    ...executivePositions,
    ...legislativePositions,
    ...judicialPositions,
  ]
    .filter(p => p.branch === branch)
    .map(p => p.id);

  return currentOfficeHolders.filter(h => branchPositionIds.includes(h.positionId));
}

export function getDepartmentsByBranch(branch: GovernmentBranch): GovernmentDepartment[] {
  return governmentDepartments.filter(d => d.branch === branch);
}

export function getPresidentialSuccession(): OfficeHolder[] {
  const successionOrder = [
    'potus', 'vpotus', 'house-speaker', 'senate-ppt',
    'sec-state', 'sec-treasury', 'sec-defense', 'attorney-general',
    'sec-interior', 'sec-agriculture', 'sec-commerce', 'sec-labor',
    'sec-hhs', 'sec-hud', 'sec-transportation', 'sec-energy',
    'sec-education', 'sec-va', 'sec-dhs',
  ];

  return successionOrder
    .map(posId => currentOfficeHolders.find(h => h.positionId === posId))
    .filter((h): h is OfficeHolder => h !== undefined);
}

export function getSupremeCourtJustices(): OfficeHolder[] {
  return currentOfficeHolders.filter(
    h => h.positionId === 'chief-justice' || h.positionId === 'associate-justice'
  );
}

export function getCabinetMembers(): OfficeHolder[] {
  const cabinetPositions = executivePositions
    .filter(p => p.level === 'cabinet')
    .map(p => p.id);

  return currentOfficeHolders.filter(h => cabinetPositions.includes(h.positionId));
}

export function getCongressionalLeadership(): OfficeHolder[] {
  const leadershipPositions = legislativePositions
    .filter(p => p.level === 'head' || p.level === 'senior')
    .map(p => p.id);

  return currentOfficeHolders.filter(h => leadershipPositions.includes(h.positionId));
}

// Check if data needs updating (older than 24 hours)
export function isDataStale(): boolean {
  const lastUpdate = new Date(governmentDataMeta.lastUpdated);
  const now = new Date();
  const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);
  return hoursSinceUpdate > 24;
}

// Export all positions combined
export const allPositions = [
  ...executivePositions,
  ...legislativePositions,
  ...judicialPositions,
];
