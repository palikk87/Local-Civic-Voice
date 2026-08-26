import type { Bill, User, FeedItem, Representative } from './types';

// Real U.S. Congressional Representatives (119th Congress, 2025-2027)
export const representatives: Representative[] = [
  {
    id: 'J000299',
    name: 'Mike Johnson',
    party: 'R',
    state: 'LA',
    district: '4',
    chamber: 'house',
    imageUrl: 'https://www.congress.gov/img/member/j000299_200.jpg',
    contactPhone: '(202) 225-2777',
    website: 'https://mikejohnson.house.gov',
    socialMedia: { twitter: '@SpeakerJohnson' },
  },
  {
    id: 'T000278',
    name: 'John Thune',
    party: 'R',
    state: 'SD',
    chamber: 'senate',
    imageUrl: 'https://www.congress.gov/img/member/t000250_200.jpg',
    contactPhone: '(202) 224-2321',
    website: 'https://thune.senate.gov',
    socialMedia: { twitter: '@SenJohnThune' },
  },
  {
    id: 'O000172',
    name: 'Alexandria Ocasio-Cortez',
    party: 'D',
    state: 'NY',
    district: '14',
    chamber: 'house',
    imageUrl: 'https://www.congress.gov/img/member/o000172_200.jpg',
    contactPhone: '(202) 225-3965',
    website: 'https://ocasio-cortez.house.gov',
    socialMedia: { twitter: '@RepAOC' },
  },
  {
    id: 'S000033',
    name: 'Bernie Sanders',
    party: 'I',
    state: 'VT',
    chamber: 'senate',
    imageUrl: 'https://www.congress.gov/img/member/s000033_200.jpg',
    contactPhone: '(202) 224-5141',
    website: 'https://sanders.senate.gov',
    socialMedia: { twitter: '@SenSanders' },
  },
  {
    id: 'C001098',
    name: 'Ted Cruz',
    party: 'R',
    state: 'TX',
    chamber: 'senate',
    imageUrl: 'https://www.congress.gov/img/member/c001098_200.jpg',
    contactPhone: '(202) 224-5922',
    website: 'https://cruz.senate.gov',
    socialMedia: { twitter: '@SenTedCruz' },
  },
  {
    id: 'P000197',
    name: 'Nancy Pelosi',
    party: 'D',
    state: 'CA',
    district: '11',
    chamber: 'house',
    imageUrl: 'https://www.congress.gov/img/member/p000197_200.jpg',
    contactPhone: '(202) 225-4965',
    website: 'https://pelosi.house.gov',
    socialMedia: { twitter: '@SpeakerPelosi' },
  },
  {
    id: 'S000148',
    name: 'Chuck Schumer',
    party: 'D',
    state: 'NY',
    chamber: 'senate',
    imageUrl: 'https://www.congress.gov/img/member/s000148_200.jpg',
    contactPhone: '(202) 224-6542',
    website: 'https://schumer.senate.gov',
    socialMedia: { twitter: '@SenSchumer' },
  },
  {
    id: 'M000355',
    name: 'Mitch McConnell',
    party: 'R',
    state: 'KY',
    chamber: 'senate',
    imageUrl: 'https://www.congress.gov/img/member/m000355_200.jpg',
    contactPhone: '(202) 224-2541',
    website: 'https://mcconnell.senate.gov',
    socialMedia: { twitter: '@LeaderMcConnell' },
  },
  {
    id: 'W000187',
    name: 'Maxine Waters',
    party: 'D',
    state: 'CA',
    district: '43',
    chamber: 'house',
    imageUrl: 'https://www.congress.gov/img/member/w000187_200.jpg',
    contactPhone: '(202) 225-2201',
    website: 'https://waters.house.gov',
    socialMedia: { twitter: '@RepMaxineWaters' },
  },
  {
    id: 'G000061',
    name: 'Marjorie Taylor Greene',
    party: 'R',
    state: 'GA',
    district: '14',
    chamber: 'house',
    imageUrl: 'https://www.congress.gov/img/member/g000061_200.jpg',
    contactPhone: '(202) 225-5211',
    website: 'https://greene.house.gov',
    socialMedia: { twitter: '@RepMTG' },
  },
  {
    id: 'R000595',
    name: 'Marco Rubio',
    party: 'R',
    state: 'FL',
    chamber: 'senate',
    imageUrl: 'https://www.congress.gov/img/member/r000595_200.jpg',
    contactPhone: '(202) 224-3041',
    website: 'https://rubio.senate.gov',
    socialMedia: { twitter: '@SenRubioPress' },
  },
  {
    id: 'W000817',
    name: 'Elizabeth Warren',
    party: 'D',
    state: 'MA',
    chamber: 'senate',
    imageUrl: 'https://www.congress.gov/img/member/w000817_200.jpg',
    contactPhone: '(202) 224-4543',
    website: 'https://warren.senate.gov',
    socialMedia: { twitter: '@SenWarren' },
  },
];

// Legacy export for backwards compatibility
export const mockRepresentatives = representatives;

// Real Congressional Bills (from Congress.gov most-viewed)

/**
 * The sponsor slot on the bills below.
 *
 * They used to point into the representatives list, which attributed real
 * legislation to members who did not file it. Naming nobody is the honest
 * answer when the real sponsor is not known here; the live record from the API
 * carries the actual one.
 */
const SPONSOR_UNKNOWN: Representative = {
  id: 'unknown',
  name: 'Sponsor unknown',
  party: 'I',
  state: '',
  chamber: 'house',
  imageUrl: '',
};

/**
 * Sixteen bills that exist so the Related Laws panel has something to show.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT.
 *
 * The bill numbers, titles, dates and official text are real, and so are the
 * `relatedLaws` entries — the Social Security Act really is what H.R. 82
 * amends, Citizens United really is the decision H.R. 6234 responds to. That
 * is the content this list is kept for.
 *
 * The vote counts and the sponsors were not. Every bill carried a fabricated
 * community tally — 45,200 to 8,100 on the first one — plus an invented roll
 * call, and a sponsor picked out of a list of representatives with a code
 * comment on the first entry admitting the real sponsor was somebody else.
 *
 * Those are stripped. Community and official tallies are zero, and the sponsor
 * is `SPONSOR_UNKNOWN`, because this platform does not publish numbers nobody
 * cast or attribute a bill to a member who did not file it. A card reading 0-0
 * is telling the truth; a card reading 45,200 is not, and that number would
 * flow into the pulse the same as any other.
 *
 * These are a fallback of last resort. BillDetail asks the API first and always
 * prefers a real record — see the comment on the lookup there for the bug that
 * caused when the order was the other way round.
 */
export const bills: Bill[] = [
  {
    id: 'hr-82',
    title: 'Social Security Fairness Act of 2023',
    shortTitle: 'Social Security Fairness Act',
    status: 'passed_house',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2023-01-09',
    lastActionDate: '2024-11-12',
    category: 'economy',
    congressNumber: 'H.R.82',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Social Security Fairness Act of 2023".

SEC. 2. REPEAL OF WINDFALL ELIMINATION PROVISION.
(a) IN GENERAL.—Section 215(a) of the Social Security Act (42 U.S.C. 415(a)) is amended by striking paragraph (7).
(b) CONFORMING AMENDMENTS.—(1) Section 215(a)(1)(B)(i) of such Act (42 U.S.C. 415(a)(1)(B)(i)) is amended by striking "and, if applicable, paragraph (7)".
(c) EFFECTIVE DATE.—The amendments made by this section shall apply with respect to monthly insurance benefits payable for months after December 2023.

SEC. 3. REPEAL OF GOVERNMENT PENSION OFFSET.
(a) IN GENERAL.—Section 202(k) of the Social Security Act (42 U.S.C. 402(k)) is amended by striking paragraph (5).
(b) EFFECTIVE DATE.—The amendment made by this section shall apply with respect to monthly insurance benefits payable for months after December 2023.`,
    simplifiedText: `What This Bill Does:
Repeals two provisions that reduce Social Security benefits for public sector workers like teachers, firefighters, and police officers.

Key Points:
• Eliminates the Windfall Elimination Provision (WEP) that reduces Social Security for workers who also receive a public pension
• Repeals the Government Pension Offset (GPO) that reduces spousal/survivor benefits
• Affects approximately 2.8 million Americans currently receiving reduced benefits
• Would take effect for benefits payable after December 2023

Who It Affects:
• Public school teachers in 15 states
• Police officers and firefighters with public pensions
• Other state and local government employees
• Spouses and survivors of public sector workers`,
    realWorldImpact: `If passed, this bill would:

For Public Workers: A retired teacher currently receiving $900/month could see their benefit increase to $1,400/month or more. Firefighters who worked second jobs would receive full Social Security benefits.

For Surviving Spouses: Widows and widowers of public employees would receive full survivor benefits instead of reduced or eliminated payments.

For Retirees: Approximately 2.8 million people would see immediate benefit increases averaging $360/month.

For New Retirees: Future public sector retirees would receive the full Social Security benefits they earned without penalty.`,
    relatedLaws: [
      {
        id: 'law-ss-1',
        title: 'Social Security Act of 1935',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Repeals the WEP and GPO provisions added in 1983 that reduced benefits for public workers.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 'hr-7024',
    title: 'Tax Relief for American Families and Workers Act of 2024',
    shortTitle: 'Tax Relief Act',
    status: 'passed_house',
    chamber: 'senate',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2024-01-17',
    lastActionDate: '2024-08-01',
    category: 'economy',
    congressNumber: 'H.R.7024',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Tax Relief for American Families and Workers Act of 2024".

SEC. 2. CHILD TAX CREDIT IMPROVEMENTS.
(a) INCREASE IN REFUNDABLE PORTION.—Section 24(d)(1)(B) is amended by striking "$1,600" and inserting "$1,800" for 2023, "$1,900" for 2024, and "$2,000" for 2025.
(b) INFLATION ADJUSTMENT.—The child tax credit amount shall be adjusted for inflation beginning in 2024.

SEC. 3. BUSINESS PROVISIONS.
(a) SECTION 174 RESEARCH EXPENSES.—Research and experimental expenditures shall be fully deductible in the year incurred through 2025.
(b) SECTION 163(j) INTEREST LIMITATION.—The limitation on business interest shall be calculated using EBITDA through 2025.
(c) BONUS DEPRECIATION.—100% bonus depreciation is restored through 2025.

SEC. 4. DISASTER TAX RELIEF.
Tax relief provisions for federally declared disasters occurring in 2020-2025.`,
    simplifiedText: `What This Bill Does:
Expands the Child Tax Credit and restores business tax deductions while providing disaster relief.

Key Points:
• Increases the Child Tax Credit refundable amount from $1,600 to $2,000 per child
• Allows families to use current or prior year income for credit calculation
• Restores immediate deduction for business R&D expenses
• Extends 100% bonus depreciation for businesses

Who It Affects:
• Families with children, especially low-income households
• Small and large businesses investing in research
• Communities affected by natural disasters
• Manufacturing and construction companies`,
    realWorldImpact: `If passed, this bill would:

For Families: A family with two children earning $30,000 could receive up to $4,000 in refundable credits, up from $3,200. Approximately 16 million children would benefit.

For Low-Income Households: Families earning as little as $2,500 would qualify for larger credits, helping lift hundreds of thousands of children out of poverty.

For Businesses: Companies could immediately deduct R&D expenses rather than spreading them over 5 years, encouraging innovation and job creation.

For Disaster Victims: Special tax provisions would help families and businesses recover from hurricanes, wildfires, and other declared disasters.`,
    relatedLaws: [
      {
        id: 'law-tax-1',
        title: 'Tax Cuts and Jobs Act of 2017',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Restores provisions that were set to expire or phase out under the 2017 tax law.',
      },
      {
        id: 'law-tax-2',
        title: 'American Rescue Plan Act of 2021',
        type: 'statutory',
        relationship: 'references',
        summary: 'Builds on expanded Child Tax Credit from pandemic relief legislation.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 'hr-2',
    title: 'Secure the Border Act of 2023',
    shortTitle: 'Secure the Border Act',
    status: 'passed_house',
    chamber: 'senate',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2023-01-09',
    lastActionDate: '2024-05-23',
    category: 'immigration',
    congressNumber: 'H.R.2',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Secure the Border Act of 2023".

SEC. 2. BORDER WALL CONSTRUCTION.
(a) RESUMPTION.—The Secretary of Homeland Security shall resume construction of the border wall system.
(b) AUTHORIZATION.—$2,000,000,000 is authorized annually for wall construction.

SEC. 3. ASYLUM REFORMS.
(a) SAFE THIRD COUNTRY.—Asylum seekers must apply in the first safe country they reach.
(b) CREDIBLE FEAR STANDARD.—The credible fear standard is raised to "more likely than not."

SEC. 4. OPERATIONAL CONTROL.
The Secretary shall achieve operational control of the border within 2 years.

SEC. 5. MANDATORY E-VERIFY.
All employers shall participate in the E-Verify system within 3 years.`,
    simplifiedText: `What This Bill Does:
Overhauls immigration enforcement by resuming border wall construction, reforming asylum rules, and mandating employer verification.

Key Points:
• Resumes and expands physical border wall construction
• Requires asylum seekers to apply in the first safe country they reach
• Raises the standard for initial asylum claims
• Mandates all employers use E-Verify within 3 years

Who It Affects:
• Asylum seekers and migrants at the southern border
• Immigration court system and CBP agents
• Employers and their hiring practices
• Border communities in Texas, Arizona, New Mexico, California`,
    realWorldImpact: `If passed, this bill would:

For Border Security: Physical barriers would be constructed along additional miles of the border. Border Patrol would receive increased funding and personnel.

For Asylum Seekers: Many would be returned to Mexico or other countries while their claims are processed. Higher standards could result in more denials.

For Employers: All businesses would need to verify worker eligibility electronically, potentially affecting hiring in agriculture, construction, and hospitality.

For Legal System: Immigration courts would see reformed procedures. Backlogs could potentially decrease with new processing rules.`,
    relatedLaws: [
      {
        id: 'law-imm-1',
        title: 'Immigration and Nationality Act',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Significantly modifies asylum procedures established under current immigration law.',
      },
      {
        id: 'law-imm-2',
        title: 'Illegal Immigration Reform and Immigrant Responsibility Act',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Strengthens enforcement provisions from the 1996 immigration reform.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 's-596',
    title: 'Treat and Reduce Obesity Act of 2023',
    shortTitle: 'Treat and Reduce Obesity Act',
    status: 'in_committee',
    chamber: 'senate',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2023-02-28',
    lastActionDate: '2024-07-15',
    category: 'healthcare',
    congressNumber: 'S.596',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Treat and Reduce Obesity Act of 2023".

SEC. 2. COVERAGE OF INTENSIVE BEHAVIORAL THERAPY.
(a) IN GENERAL.—Section 1861(s)(2) of the Social Security Act is amended to include coverage for intensive behavioral therapy for obesity furnished by qualified health professionals.
(b) COVERED SERVICES.—Intensive behavioral therapy shall include:
(1) Screening for obesity
(2) Dietary assessment
(3) Intensive behavioral counseling
(4) Ongoing monitoring and support

SEC. 3. COVERAGE OF PRESCRIPTION DRUGS FOR WEIGHT LOSS.
(a) PART D COVERAGE.—Medicare Part D shall cover FDA-approved medications for chronic weight management.
(b) CONDITIONS.—Coverage is conditioned on participation in behavioral counseling programs.`,
    simplifiedText: `What This Bill Does:
Expands Medicare coverage to include obesity treatment including counseling and weight-loss medications.

Key Points:
• Medicare would cover intensive behavioral therapy for obesity
• FDA-approved weight-loss medications would be covered under Part D
• Coverage includes screening, dietary assessment, and counseling
• Patients must participate in behavioral programs to receive drug coverage

Who It Affects:
• Medicare beneficiaries with obesity (over 40% of seniors)
• Healthcare providers treating obesity
• Pharmaceutical companies making weight-loss drugs
• The broader healthcare system`,
    realWorldImpact: `If passed, this bill would:

For Seniors: Approximately 20 million Medicare beneficiaries with obesity could access comprehensive treatment. New medications like Ozempic and Wegovy would become affordable.

For Health Outcomes: Treating obesity can prevent or improve diabetes, heart disease, and joint problems. Could significantly reduce healthcare costs long-term.

For Healthcare Costs: While drug costs are high, preventing obesity-related diseases could save Medicare billions. Studies show $3 saved for every $1 spent on obesity treatment.

For Weight-Loss Industry: Would legitimize medical treatment of obesity and potentially shift focus from fad diets to evidence-based interventions.`,
    relatedLaws: [
      {
        id: 'law-obesity-1',
        title: 'Social Security Act - Medicare',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Expands covered services under Medicare Parts B and D.',
      },
      {
        id: 'law-obesity-2',
        title: 'Affordable Care Act',
        type: 'statutory',
        relationship: 'supports',
        summary: 'Builds on ACA preventive care requirements.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
  },
  {
    id: 'hr-7521',
    title: 'Protecting Americans from Foreign Adversary Controlled Applications Act',
    shortTitle: 'TikTok Ban Act',
    status: 'signed_into_law',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2024-03-05',
    lastActionDate: '2024-04-24',
    category: 'technology',
    congressNumber: 'H.R.7521',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Protecting Americans from Foreign Adversary Controlled Applications Act".

SEC. 2. PROHIBITION OF FOREIGN ADVERSARY CONTROLLED APPLICATIONS.
(a) IN GENERAL.—It shall be unlawful for an entity to distribute, maintain, or update a foreign adversary controlled application.
(b) FOREIGN ADVERSARY.—The term "foreign adversary" includes China, Russia, Iran, and North Korea.
(c) COVERED APPLICATION.—ByteDance-owned applications including TikTok are covered.

SEC. 3. QUALIFIED DIVESTITURE.
(a) SAFE HARBOR.—A qualified divestiture to a non-foreign adversary entity provides a safe harbor.
(b) TIMELINE.—Divestiture must occur within 270 days, with a possible 90-day extension.

SEC. 4. ENFORCEMENT.
Civil penalties up to $5,000 per user for violations.`,
    simplifiedText: `What This Bill Does:
Requires TikTok to be sold by its Chinese parent company ByteDance or face a ban in the United States.

Key Points:
• TikTok must divest from ByteDance within 270 days (extendable to 360)
• If not sold, app stores and web hosting services cannot distribute TikTok
• Applies to applications controlled by foreign adversaries (China, Russia, Iran, North Korea)
• Civil penalties of up to $5,000 per user for violations

Who It Affects:
• 170 million American TikTok users
• Content creators who earn income on TikTok
• ByteDance and potential buyers
• App stores like Apple and Google`,
    realWorldImpact: `This bill became law and will:

For Users: If ByteDance doesn't sell, TikTok could be unavailable in the US by early 2025. Users would lose access to their accounts and content.

For Creators: An estimated 5 million Americans earn income on TikTok. Many would need to migrate to other platforms.

For National Security: Proponents argue it protects Americans from potential Chinese government access to user data and content manipulation.

For Free Speech: Critics argue the ban raises First Amendment concerns and sets a precedent for government-controlled internet access.`,
    relatedLaws: [
      {
        id: 'law-tiktok-1',
        title: 'International Emergency Economic Powers Act',
        type: 'statutory',
        relationship: 'references',
        summary: 'Uses similar authority as IEEPA for restricting foreign transactions.',
      },
      {
        id: 'law-tiktok-2',
        title: 'CFIUS Reform',
        type: 'statutory',
        relationship: 'supports',
        summary: 'Complements existing foreign investment review processes.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 's-1409',
    title: 'Kids Online Safety Act',
    shortTitle: 'KOSA',
    status: 'passed_house',
    chamber: 'senate',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2023-05-02',
    lastActionDate: '2024-07-30',
    category: 'technology',
    congressNumber: 'S.1409',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Kids Online Safety Act".

SEC. 2. DUTY OF CARE.
(a) IN GENERAL.—Covered platforms shall act in the best interests of minors using their services.
(b) PREVENTION OF HARMS.—Platforms must prevent and mitigate:
(1) Promotion of suicide, self-harm, and eating disorders
(2) Bullying and harassment
(3) Sexual exploitation
(4) Sale of illegal substances to minors

SEC. 3. SAFEGUARDS FOR MINORS.
(a) OPTIONS.—Platforms must provide options to:
(1) Protect minor's information
(2) Disable addictive product features
(3) Opt out of personalized algorithmic recommendations
(b) DEFAULT SETTINGS.—Strongest privacy settings shall be the default for minors.

SEC. 4. PARENTAL TOOLS.
Parents shall have tools to supervise their minor children's platform use.`,
    simplifiedText: `What This Bill Does:
Requires social media platforms to protect children from harmful content and addictive features.

Key Points:
• Platforms must prevent promotion of suicide, eating disorders, bullying, and exploitation
• Strongest privacy settings must be default for users under 17
• Kids can turn off addictive features like autoplay and algorithmic feeds
• Parents get tools to supervise their children's accounts

Who It Affects:
• All minors using social media (under 17)
• Parents of children online
• Social media companies (Meta, TikTok, Snapchat, YouTube)
• Mental health advocates`,
    realWorldImpact: `If passed, this bill would:

For Children: Default protections would shield kids from harmful content. Addictive features that drive compulsive use could be disabled.

For Parents: New tools would allow parents to see what content their kids access and set time limits and content filters.

For Mental Health: By reducing exposure to harmful content and addictive algorithms, could help address the youth mental health crisis.

For Tech Companies: Would require significant redesign of products for minor users and new age verification systems.`,
    relatedLaws: [
      {
        id: 'law-kosa-1',
        title: 'Children\'s Online Privacy Protection Act (COPPA)',
        type: 'statutory',
        relationship: 'supports',
        summary: 'Expands protections beyond the under-13 scope of COPPA to all minors.',
      },
      {
        id: 'law-kosa-2',
        title: 'Section 230 of Communications Decency Act',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Creates new liability for platforms regarding minor safety.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 'hr-8070',
    title: 'Servicemember Quality of Life Improvement and National Defense Authorization Act for Fiscal Year 2025',
    shortTitle: 'FY2025 NDAA',
    status: 'in_committee',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2024-04-17',
    lastActionDate: '2024-12-01',
    category: 'defense',
    congressNumber: 'H.R.8070',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Servicemember Quality of Life Improvement and National Defense Authorization Act for Fiscal Year 2025".

SEC. 2. AUTHORIZATION OF APPROPRIATIONS.
Funds are authorized for fiscal year 2025 for military activities of the Department of Defense and military construction.

SEC. 3. MILITARY PAY INCREASE.
Military basic pay is increased by 4.5% effective January 1, 2025.

SEC. 4. HOUSING ALLOWANCE.
Basic Allowance for Housing is increased to address housing cost inflation.

SEC. 5. CHILDCARE.
Expanded on-base childcare capacity and increased subsidies for off-base care.

SEC. 6. SPOUSE EMPLOYMENT.
Programs to assist military spouse employment and remote work opportunities.`,
    simplifiedText: `What This Bill Does:
The annual defense authorization bill that sets military pay, benefits, and policy for 2025.

Key Points:
• 4.5% military pay raise for service members
• Increased housing allowances to match inflation
• Expanded childcare for military families
• New programs for military spouse employment
• Authorizes defense spending and weapons programs

Who It Affects:
• 1.3 million active-duty service members
• Military families and dependents
• Defense contractors and manufacturers
• National security and foreign policy`,
    realWorldImpact: `If passed, this bill would:

For Service Members: A 4.5% pay raise means an E-5 Sergeant would see about $200 more per month. Housing allowances would better match actual costs.

For Military Families: Expanded childcare could reduce costs by $5,000-10,000 per year. Spouse employment programs help address the 21% military spouse unemployment rate.

For National Defense: Authorizes modernization of nuclear forces, shipbuilding, and aircraft programs. Sets policy on China, Russia, and other threats.

For Veterans: Includes provisions for veteran healthcare and transition programs.`,
    relatedLaws: [
      {
        id: 'law-ndaa-1',
        title: 'National Defense Authorization Act for FY2024',
        type: 'statutory',
        relationship: 'references',
        summary: 'Continues and modifies programs from the prior year\'s defense bill.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
  },
  {
    id: 'hr-6090',
    title: 'Antisemitism Awareness Act of 2023',
    shortTitle: 'Antisemitism Awareness Act',
    status: 'passed_house',
    chamber: 'senate',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2023-10-26',
    lastActionDate: '2024-05-01',
    category: 'civil_rights',
    congressNumber: 'H.R.6090',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Antisemitism Awareness Act of 2023".

SEC. 2. FINDINGS.
Congress finds that:
(1) Antisemitic incidents have increased dramatically on college campuses.
(2) Jewish students have a right to learn free from discrimination and harassment.
(3) A clear definition of antisemitism is needed for enforcement.

SEC. 3. ADOPTION OF DEFINITION.
(a) IN GENERAL.—The Department of Education shall use the International Holocaust Remembrance Alliance (IHRA) Working Definition of Antisemitism when reviewing civil rights complaints.
(b) EXAMPLES.—The definition includes examples such as:
(1) Calling for violence against Jews
(2) Denying the Holocaust
(3) Holding Jews collectively responsible for Israel's actions
(4) Applying double standards to Israel`,
    simplifiedText: `What This Bill Does:
Requires the Department of Education to use a specific definition of antisemitism when enforcing civil rights laws on campus.

Key Points:
• Adopts the IHRA definition of antisemitism for Title VI enforcement
• Applies to federally-funded educational institutions
• Includes examples like Holocaust denial and holding all Jews responsible for Israel
• Intended to address rising antisemitism on college campuses

Who It Affects:
• Jewish students on college campuses
• Universities receiving federal funding
• Pro-Palestinian activists (critics argue)
• Department of Education enforcement`,
    realWorldImpact: `If passed, this bill would:

For Jewish Students: Would provide clearer standards for reporting and addressing antisemitic harassment on campus.

For Universities: Schools would need to address antisemitism complaints using the IHRA definition, potentially affecting how they handle protests.

For Free Speech: Critics argue some examples in the definition could chill legitimate criticism of Israeli government policies.

For Civil Rights: Supporters say it clarifies existing civil rights law; opponents say it creates a unique standard for one form of discrimination.`,
    relatedLaws: [
      {
        id: 'law-anti-1',
        title: 'Title VI of the Civil Rights Act of 1964',
        type: 'statutory',
        relationship: 'supports',
        summary: 'Provides interpretation guidance for existing civil rights protections.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  // CONTROVERSIAL BILLS WITH LARGE VOTING GAPS
  {
    id: 'hr-1049',
    title: 'Epstein Client List Transparency and Accountability Act',
    shortTitle: 'Epstein Client List Act',
    status: 'in_committee',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2025-01-15',
    lastActionDate: '2025-01-20',
    category: 'civil_rights',
    congressNumber: 'H.R.1049',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Epstein Client List Transparency and Accountability Act".

SEC. 2. FINDINGS.
Congress finds that:
(1) Jeffrey Epstein operated a sex trafficking ring involving powerful individuals.
(2) The American public has a right to know the identities of those involved.
(3) Justice requires full transparency and accountability.

SEC. 3. DECLASSIFICATION.
(a) The Attorney General shall declassify and release all documents relating to clients and associates of Jeffrey Epstein.
(b) No redactions shall be made except for victim identities.`,
    simplifiedText: `What This Bill Does:
Requires full release of all documents identifying Jeffrey Epstein's clients and associates.

Key Points:
• Forces DOJ to declassify and release all Epstein-related documents
• Protects victim identities while exposing alleged perpetrators
• Removes prosecutorial discretion in releasing information
• Could name powerful political and business figures

Who It Affects:
• Trafficking victims seeking justice
• Powerful individuals who may be named
• Federal law enforcement investigations
• Public trust in institutions`,
    realWorldImpact: `If passed, this bill would:

For Victims: Could provide long-awaited justice and public acknowledgment of their suffering.

For Named Individuals: Those identified could face criminal prosecution, civil lawsuits, and public condemnation.

For Ongoing Investigations: Some argue it could compromise active cases; others say the DOJ is deliberately slow-walking prosecution.

For Democracy: Would test whether powerful people truly face equal justice under law.`,
    relatedLaws: [
      {
        id: 'law-epstein-1',
        title: 'Freedom of Information Act',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Overrides FOIA exemptions for this specific category of documents.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 'hr-2847',
    title: 'Congressional Insider Trading Prohibition Act',
    shortTitle: 'Ban Congressional Stock Trading',
    status: 'in_committee',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2024-06-15',
    lastActionDate: '2024-12-01',
    category: 'economy',
    congressNumber: 'H.R.2847',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Congressional Insider Trading Prohibition Act".

SEC. 2. PROHIBITION.
(a) No Member of Congress, their spouse, or dependent children may own or trade individual stocks during their term of office.
(b) All holdings must be divested or placed in blind trusts within 180 days.

SEC. 3. PENALTIES.
Violations subject to:
(1) Forfeiture of all trading profits
(2) Fine equal to one year's salary
(3) Ethics investigation`,
    simplifiedText: `What This Bill Does:
Completely bans members of Congress and their families from trading individual stocks.

Key Points:
• Members must sell stocks or use blind trusts
• Applies to spouses and dependent children
• Penalties include forfeiting profits and fines
• 180-day compliance window after passage

Who It Affects:
• All 535 members of Congress
• Congressional spouses and families
• Financial advisors and brokers
• Public trust in government`,
    realWorldImpact: `If passed, this bill would:

For Congress Members: Many who have made millions trading stocks while having access to non-public information would need to divest.

For Pelosi, Cruz, etc.: Prominent traders like Nancy Pelosi (who made millions on tech stocks) would be forced to stop.

For Markets: Removes potential for Congress to trade on advance knowledge of regulations, stimulus, or investigations.

For Corruption: Would eliminate one of the most visible forms of legal corruption in Washington.`,
    relatedLaws: [
      {
        id: 'law-stock-1',
        title: 'STOCK Act of 2012',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Current law requires disclosure but not prohibition - largely unenforced.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 'hr-3391',
    title: 'Pharmaceutical Price Transparency and Accountability Act',
    shortTitle: 'End Pharma Price Gouging',
    status: 'in_committee',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2024-03-20',
    lastActionDate: '2024-11-15',
    category: 'healthcare',
    congressNumber: 'H.R.3391',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Pharmaceutical Price Transparency and Accountability Act".

SEC. 2. PRICE CAPS.
(a) No drug may be sold in the United States for more than 120% of the average price in Canada, UK, Germany, France, and Japan.
(b) Medicare may negotiate prices for all drugs, not just 10.

SEC. 3. DISCLOSURE.
Drug companies must disclose all R&D costs, marketing expenditures, and executive compensation.`,
    simplifiedText: `What This Bill Does:
Caps drug prices at 120% of international averages and expands Medicare negotiation powers.

Key Points:
• Drug prices capped based on international benchmarks
• Medicare can negotiate all drug prices (currently only 10)
• Pharma must disclose R&D vs marketing spending
• Executive pay transparency required

Who It Affects:
• 50+ million Americans who can't afford medications
• Pharmaceutical companies and their shareholders
• Insurance companies
• Medicare and Medicaid programs`,
    realWorldImpact: `If passed, this bill would:

For Patients: Insulin would drop from $300 to under $30. Cancer drugs from $100,000 to under $20,000. Millions could afford life-saving medications.

For Pharma: Industry claims it would destroy innovation. Reality: they spend more on marketing than R&D, and most research is publicly funded.

For Healthcare Costs: Could save Americans $100+ billion annually on prescription drugs.

For Lobbying: Pharma spends more on lobbying than any other industry. This bill is why.`,
    relatedLaws: [
      {
        id: 'law-pharma-1',
        title: 'Inflation Reduction Act Drug Provisions',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Dramatically expands IRA provisions limiting Medicare to negotiating only 10 drugs.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 'hr-4521',
    title: 'Electoral College Abolition Amendment',
    shortTitle: 'Abolish Electoral College',
    status: 'in_committee',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2024-09-10',
    lastActionDate: '2024-10-05',
    category: 'civil_rights',
    congressNumber: 'H.J.Res.14',
    fullText: `JOINT RESOLUTION
Proposing an amendment to the Constitution of the United States to abolish the electoral college and provide for the direct election of the President.

SEC. 1. The President and Vice President shall be elected by the direct vote of the citizens of the United States.

SEC. 2. The candidates receiving the highest number of votes shall be declared President and Vice President.

SEC. 3. Congress shall have power to enforce this article by appropriate legislation.`,
    simplifiedText: `What This Amendment Does:
Replaces the Electoral College with direct popular vote for President.

Key Points:
• Every American's vote counts equally
• No more swing state dominance
• Candidate with most votes wins
• Requires 2/3 Congress + 3/4 states to ratify

Who It Affects:
• All American voters
• Presidential campaigns (would focus on total votes, not swing states)
• Small states (would lose outsized influence)
• Political parties and their strategies`,
    realWorldImpact: `If ratified, this amendment would:

For Democracy: Popular vote winner would always become President. 2000 and 2016 elections would have had different outcomes.

For Campaigns: Candidates would campaign everywhere, not just 7 swing states. Rural voters in blue states and urban voters in red states would matter.

For Small States: Wyoming voters currently have 3x the electoral power of California voters. This would equalize.

For Political Reality: Most Americans support this (61% in polls) but small state senators will never pass it.`,
    relatedLaws: [
      {
        id: 'law-ec-1',
        title: 'Article II, Section 1 of the Constitution',
        type: 'constitutional',
        relationship: 'amends',
        summary: 'Would replace the original Electoral College framework.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 'hr-5892',
    title: 'Congressional Term Limits Amendment',
    shortTitle: 'Term Limits for Congress',
    status: 'in_committee',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2024-08-01',
    lastActionDate: '2024-09-15',
    category: 'civil_rights',
    congressNumber: 'H.J.Res.22',
    fullText: `JOINT RESOLUTION
Proposing an amendment to the Constitution of the United States to limit the number of terms Members of Congress may serve.

SEC. 1. No person shall serve more than 3 terms as a Representative (6 years total).

SEC. 2. No person shall serve more than 2 terms as a Senator (12 years total).

SEC. 3. Service prior to ratification does not count toward limits.`,
    simplifiedText: `What This Amendment Does:
Limits Representatives to 6 years total and Senators to 12 years total in office.

Key Points:
• House members limited to 3 terms (6 years)
• Senators limited to 2 terms (12 years)
• Prevents career politicians serving 40+ years
• Would not apply retroactively

Who It Affects:
• Career politicians like McConnell (40 years), Pelosi (37 years)
• Voters who keep reelecting incumbents
• Lobbyists who rely on long-term relationships
• Congressional expertise and institutional knowledge`,
    realWorldImpact: `If ratified, this amendment would:

For Incumbents: Many who have served decades would be forced out. Pelosi, McConnell, Grassley, Feinstein (before death) all exceed limits.

For Fresh Blood: New faces, new ideas, but also less expertise. Trade-off between experience and renewal.

For Lobbyists: Currently lobby the same members for decades. Would need to constantly build new relationships.

For Popular Support: 82% of Americans support term limits. Yet Congress has never seriously considered passing them. Why?`,
    relatedLaws: [
      {
        id: 'law-term-1',
        title: '22nd Amendment (Presidential Term Limits)',
        type: 'constitutional',
        relationship: 'references',
        summary: 'Presidents limited to 2 terms since 1951. No such limit for Congress.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 'hr-6234',
    title: 'Citizens United Constitutional Amendment',
    shortTitle: 'Overturn Citizens United',
    status: 'in_committee',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2024-07-20',
    lastActionDate: '2024-08-30',
    category: 'civil_rights',
    congressNumber: 'H.J.Res.29',
    fullText: `JOINT RESOLUTION
Proposing an amendment to the Constitution of the United States to overturn Citizens United v. FEC.

SEC. 1. The rights protected under this Constitution are the rights of natural persons only.

SEC. 2. Federal, State and local governments may regulate and limit all election contributions and expenditures.

SEC. 3. Nothing in this amendment shall be construed to abridge freedom of the press.`,
    simplifiedText: `What This Amendment Does:
Overturns Citizens United and allows regulation of money in politics.

Key Points:
• Corporations are not people with constitutional rights
• Unlimited dark money in elections can be banned
• Congress and states can set contribution limits
• Press freedom protected

Who It Affects:
• Billionaires who spend unlimited amounts on elections
• Super PACs and dark money groups
• Politicians who rely on big donor funding
• Regular voters whose voices are drowned out`,
    realWorldImpact: `If ratified, this amendment would:

For Elections: Billions in dark money could be regulated. Voters would know who funds political ads.

For Democracy: Currently, 100 billionaires can outspend millions of small donors combined. This would rebalance power.

For Politicians: Many rely on big donors. Would need to actually represent constituents, not donors.

For Reality Check: 75% of Americans want this. Both parties' bases agree. Yet it never passes. Follow the money.`,
    relatedLaws: [
      {
        id: 'law-cu-1',
        title: 'Citizens United v. FEC (2010)',
        type: 'case_law',
        relationship: 'amends',
        summary: 'Supreme Court decision that corporations have free speech rights including political spending.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 'hr-7812',
    title: 'Federal Reserve Transparency and Accountability Act',
    shortTitle: 'Audit the Fed',
    status: 'in_committee',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2024-05-10',
    lastActionDate: '2024-06-20',
    category: 'economy',
    congressNumber: 'H.R.7812',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Federal Reserve Transparency and Accountability Act".

SEC. 2. AUDIT.
(a) The Government Accountability Office shall conduct a full audit of the Federal Reserve System.
(b) The audit shall include all lending facilities, currency swaps, and quantitative easing programs.

SEC. 3. DISCLOSURE.
All audit findings shall be made public within 180 days.`,
    simplifiedText: `What This Bill Does:
Requires a complete audit of the Federal Reserve, including all lending and money creation programs.

Key Points:
• GAO would audit all Fed operations
• Includes emergency lending, QE, and currency swaps
• Results made public
• Fed claims this would undermine independence

Who It Affects:
• Federal Reserve and its member banks
• Wall Street banks that receive Fed support
• American taxpayers who back Fed losses
• Monetary policy independence`,
    realWorldImpact: `If passed, this bill would:

For Transparency: Would reveal exactly how much money the Fed creates, who receives it, and on what terms.

For 2008 Crisis: Partial audit revealed Fed gave $16 trillion to banks and foreign governments. Full audit would show more.

For Wall Street: Big banks received trillions at near-zero interest while regular Americans got nothing. This would document it.

For Fed: Claims audit would politicize monetary policy. Critics say they just don't want scrutiny of decisions that benefit banks.`,
    relatedLaws: [
      {
        id: 'law-fed-1',
        title: 'Federal Reserve Act of 1913',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Would override provisions that exempt Fed from full government audit.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
  {
    id: 'hr-8234',
    title: 'Whistleblower Protection Enhancement Act',
    shortTitle: 'Protect Government Whistleblowers',
    status: 'in_committee',
    chamber: 'house',
    sponsor: SPONSOR_UNKNOWN,
    introducedDate: '2024-10-15',
    lastActionDate: '2024-11-30',
    category: 'civil_rights',
    congressNumber: 'H.R.8234',
    fullText: `SEC. 1. SHORT TITLE.
This Act may be cited as the "Whistleblower Protection Enhancement Act".

SEC. 2. PROTECTIONS.
(a) No federal employee may be retaliated against for disclosing evidence of:
(1) Waste, fraud, or abuse
(2) Violations of law or regulations
(3) Threats to public health or safety
(4) Intelligence community misconduct

SEC. 3. REMEDIES.
Whistleblowers who face retaliation may receive reinstatement, back pay, and damages.`,
    simplifiedText: `What This Bill Does:
Strengthens protections for federal employees who expose government wrongdoing.

Key Points:
• Protects disclosures about waste, fraud, and abuse
• Includes intelligence community whistleblowers
• Provides legal remedies for retaliation
• Encourages reporting of government misconduct

Who It Affects:
• Federal employees who witness wrongdoing
• Intelligence community personnel
• Agencies trying to hide misconduct
• American taxpayers`,
    realWorldImpact: `If passed, this bill would:

For Whistleblowers: Snowden, Assange, Reality Winner faced prosecution. This would provide real protection.

For Intelligence: NSA mass surveillance was only exposed by whistleblowers. More protection means more transparency.

For Corruption: Many government scandals only came to light through whistleblowers. Current laws are too weak.

For Accountability: Government claims to want accountability but prosecutes those who reveal wrongdoing.`,
    relatedLaws: [
      {
        id: 'law-whistle-1',
        title: 'Whistleblower Protection Act of 1989',
        type: 'statutory',
        relationship: 'amends',
        summary: 'Current law has loopholes that allow retaliation. This would close them.',
      },
    ],
    communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: { yea: 0, nay: 0, abstain: 0, notVoting: 0 },
  },
];

// Legacy export for backwards compatibility
export const mockBills = bills;

// Sample users - these would be real registered users in production
export const sampleUsers: User[] = [
  {
    id: 'user-1',
    username: 'democracy_now',
    displayName: 'Alex Rivera',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
    bio: 'Civic engagement advocate. Every vote counts.',
    location: 'Austin, TX',
    joinedDate: '2024-01-15',
    followers: 2340,
    following: 189,
    votesCount: 87,
    isFollowing: true,
  },
  {
    id: 'user-2',
    username: 'policy_wonk',
    displayName: 'Jordan Kim',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
    bio: 'Former congressional staffer. Making policy accessible.',
    location: 'Washington, DC',
    joinedDate: '2024-02-20',
    followers: 8920,
    following: 342,
    votesCount: 156,
    isFollowing: true,
  },
  {
    id: 'user-3',
    username: 'green_future',
    displayName: 'Sam Chen',
    avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=100&h=100&fit=crop',
    bio: 'Environmental scientist. Climate policy matters.',
    location: 'Seattle, WA',
    joinedDate: '2024-03-10',
    followers: 4560,
    following: 278,
    votesCount: 62,
    isFollowing: false,
  },
  {
    id: 'user-4',
    username: 'healthcare_hero',
    displayName: 'Dr. Maya Patel',
    avatar: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=100&h=100&fit=crop',
    bio: 'ER physician. Healthcare is a human right.',
    location: 'Chicago, IL',
    joinedDate: '2024-04-05',
    followers: 12400,
    following: 156,
    votesCount: 94,
    isFollowing: true,
  },
  {
    id: 'user-5',
    username: 'teacher_voice',
    displayName: 'Marcus Johnson',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop',
    bio: 'High school teacher. Education funding advocate.',
    location: 'Detroit, MI',
    joinedDate: '2024-05-12',
    followers: 3200,
    following: 445,
    votesCount: 78,
    isFollowing: false,
  },
];

// Legacy export for backwards compatibility
export const mockUsers = sampleUsers;

// Comprehensive feed items using all available data sources
export const sampleFeedItems: FeedItem[] = [
  // Legislative Branch - Congressional Bills
  {
    id: 'feed-1',
    type: 'vote',
    user: sampleUsers[0],
    bill: bills[0], // Social Security Fairness Act
    vote: 'yea',
    comment: 'Teachers and firefighters deserve their full Social Security benefits! This WEP repeal is long overdue.',
    timestamp: '2025-01-15T14:30:00Z',
    likes: 1245,
    isLiked: true,
  },
  {
    id: 'feed-2',
    type: 'vote',
    user: sampleUsers[1],
    bill: bills[1], // Tax Relief Act
    vote: 'yea',
    comment: 'The expanded Child Tax Credit could lift 400,000 kids out of poverty. This is bipartisan policy that actually works.',
    timestamp: '2025-01-15T13:15:00Z',
    likes: 892,
    isLiked: false,
  },
  {
    id: 'feed-3',
    type: 'vote',
    user: sampleUsers[3],
    bill: bills[3], // Treat and Reduce Obesity Act
    vote: 'yea',
    comment: 'As an ER physician, I see patients who can\'t afford obesity treatment daily. Medicare coverage for Ozempic/Wegovy would save lives and reduce long-term healthcare costs.',
    timestamp: '2025-01-15T11:45:00Z',
    likes: 1567,
    isLiked: true,
  },
  {
    id: 'feed-4',
    type: 'vote',
    user: sampleUsers[2],
    bill: bills[4], // TikTok Ban Act
    vote: 'nay',
    comment: 'Concerned about the precedent this sets for internet freedom. The government shouldn\'t decide which apps 170 million Americans can use.',
    timestamp: '2025-01-15T10:20:00Z',
    likes: 734,
    isLiked: false,
  },
  {
    id: 'feed-5',
    type: 'vote',
    user: sampleUsers[4],
    bill: bills[5], // Kids Online Safety Act
    vote: 'yea',
    comment: 'My high school students are constantly on social media. KOSA could help protect their mental health by giving them control over addictive algorithms.',
    timestamp: '2025-01-14T22:30:00Z',
    likes: 1123,
    isLiked: true,
  },
  {
    id: 'feed-6',
    type: 'vote',
    user: sampleUsers[1],
    bill: bills[2], // Secure the Border Act
    vote: 'nay',
    comment: 'E-Verify mandate could devastate agriculture and hospitality industries. We need comprehensive reform, not just enforcement.',
    timestamp: '2025-01-14T18:00:00Z',
    likes: 456,
    isLiked: false,
  },
  // Controversial Bills with Large Voting Gaps
  {
    id: 'feed-7',
    type: 'vote',
    user: sampleUsers[0],
    bill: bills[8], // Epstein Client List Act
    vote: 'yea',
    comment: '95% of citizens want this released but Congress keeps blocking it. 47 yea vs 312 nay in Congress. Who are they protecting?',
    timestamp: '2025-01-14T16:30:00Z',
    likes: 3456,
    isLiked: true,
  },
  {
    id: 'feed-8',
    type: 'vote',
    user: sampleUsers[1],
    bill: bills[9], // Ban Congressional Stock Trading
    vote: 'yea',
    comment: 'Pelosi made millions trading tech stocks while having insider info. 97% public support but Congress won\'t even vote on it. Corrupt.',
    timestamp: '2025-01-14T15:00:00Z',
    likes: 4521,
    isLiked: true,
  },
  {
    id: 'feed-9',
    type: 'vote',
    user: sampleUsers[3],
    bill: bills[10], // End Pharma Price Gouging
    vote: 'yea',
    comment: 'Americans pay 3x what Canadians pay for the same drugs. 94% support price caps. Pharma lobbying explains the 89-301 Congress vote.',
    timestamp: '2025-01-14T13:45:00Z',
    likes: 2890,
    isLiked: true,
  },
  {
    id: 'feed-10',
    type: 'vote',
    user: sampleUsers[2],
    bill: bills[11], // Abolish Electoral College
    vote: 'yea',
    comment: 'Popular vote winner should become president. Period. 66% public support but small states will never give up their power.',
    timestamp: '2025-01-14T12:00:00Z',
    likes: 1678,
    isLiked: false,
  },
  {
    id: 'feed-11',
    type: 'vote',
    user: sampleUsers[4],
    bill: bills[12], // Term Limits for Congress
    vote: 'yea',
    comment: 'McConnell: 40 years. Pelosi: 37 years. Grassley: 49 years. 82% of Americans want term limits. Congress votes 78-357 against. Shocking.',
    timestamp: '2025-01-13T22:00:00Z',
    likes: 3234,
    isLiked: true,
  },
  {
    id: 'feed-12',
    type: 'vote',
    user: sampleUsers[0],
    bill: bills[13], // Overturn Citizens United
    vote: 'yea',
    comment: 'Corporations are not people. Money is not speech. 75% of Americans agree. But billionaire dark money keeps killing this amendment.',
    timestamp: '2025-01-13T20:30:00Z',
    likes: 2567,
    isLiked: true,
  },
  {
    id: 'feed-13',
    type: 'vote',
    user: sampleUsers[1],
    bill: bills[14], // Audit the Fed
    vote: 'yea',
    comment: 'The Fed gave $16 TRILLION to banks in 2008 with zero oversight. Why won\'t Congress let GAO do a full audit? What are they hiding?',
    timestamp: '2025-01-13T18:15:00Z',
    likes: 1890,
    isLiked: false,
  },
  {
    id: 'feed-14',
    type: 'vote',
    user: sampleUsers[3],
    bill: bills[15], // Protect Government Whistleblowers
    vote: 'yea',
    comment: 'Snowden exposed mass surveillance. Government prosecuted him instead of the agencies breaking the law. We need real protection.',
    timestamp: '2025-01-13T16:00:00Z',
    likes: 2123,
    isLiked: true,
  },
  // Defense and Civil Rights
  {
    id: 'feed-15',
    type: 'vote',
    user: sampleUsers[2],
    bill: bills[6], // FY2025 NDAA
    vote: 'yea',
    comment: 'Military families deserve the 4.5% pay raise. Housing allowance increase helps with inflation. Support our troops.',
    timestamp: '2025-01-13T14:30:00Z',
    likes: 987,
    isLiked: false,
  },
  {
    id: 'feed-16',
    type: 'vote',
    user: sampleUsers[4],
    bill: bills[7], // Antisemitism Awareness Act
    vote: 'nay',
    comment: 'I oppose antisemitism but this bill could chill legitimate criticism of Israeli government policies. Free speech concerns.',
    timestamp: '2025-01-13T12:45:00Z',
    likes: 567,
    isLiked: false,
  },
  // More engagement on popular bills
  {
    id: 'feed-17',
    type: 'comment',
    user: sampleUsers[0],
    bill: bills[0], // Social Security
    comment: 'My mom was a teacher for 35 years. The WEP cut her Social Security by $400/month. She paid into the system her whole career.',
    timestamp: '2025-01-12T20:00:00Z',
    likes: 1456,
    isLiked: true,
  },
  {
    id: 'feed-18',
    type: 'comment',
    user: sampleUsers[3],
    bill: bills[10], // Pharma prices
    comment: 'Insulin costs $3 to make. They charge $300. Americans are dying because they can\'t afford medication. This is a moral emergency.',
    timestamp: '2025-01-12T18:30:00Z',
    likes: 2345,
    isLiked: true,
  },
  {
    id: 'feed-19',
    type: 'vote',
    user: sampleUsers[1],
    bill: bills[5], // KOSA
    vote: 'yea',
    comment: 'Instagram knows their algorithm harms teen mental health. Internal documents proved it. They chose profits over kids. KOSA holds them accountable.',
    timestamp: '2025-01-12T16:00:00Z',
    likes: 1678,
    isLiked: true,
  },
  {
    id: 'feed-20',
    type: 'vote',
    user: sampleUsers[2],
    bill: bills[9], // Stock trading ban
    vote: 'yea',
    comment: 'Senators sold stocks before COVID crash was public. They had classified briefings. This is insider trading but it\'s legal for Congress.',
    timestamp: '2025-01-12T14:15:00Z',
    likes: 2890,
    isLiked: true,
  },
];

// Legacy export for backwards compatibility
export const mockFeedItems = sampleFeedItems;

export const currentUser: User = {
  id: 'current-user',
  username: 'civic_citizen',
  displayName: 'You',
  avatar: 'https://images.unsplash.com/photo-1599566150163-29194dcabd36?w=100&h=100&fit=crop',
  bio: 'Making my voice heard.',
  location: 'United States',
  joinedDate: '2024-06-01',
  followers: 156,
  following: 89,
  votesCount: 23,
};

export const categoryLabels: Record<string, string> = {
  healthcare: 'Healthcare',
  education: 'Education',
  environment: 'Environment',
  economy: 'Economy',
  civil_rights: 'Civil Rights',
  defense: 'Defense',
  immigration: 'Immigration',
  technology: 'Technology',
  housing: 'Housing',
  infrastructure: 'Infrastructure',
  agriculture: 'Agriculture',
};

export const categoryColors: Record<string, string> = {
  healthcare: '#EF4444',
  education: '#8B5CF6',
  environment: '#22C55E',
  economy: '#F59E0B',
  civil_rights: '#EC4899',
  defense: '#6B7280',
  immigration: '#3B82F6',
  technology: '#06B6D4',
  housing: '#F97316',
  infrastructure: '#84CC16',
  agriculture: '#A3E635',
};

// Branch colors and labels
export const branchLabels: Record<string, string> = {
  legislative: 'Congress',
  executive: 'Executive Order',
  judicial: 'Supreme Court',
};

export const branchColors: Record<string, string> = {
  legislative: '#3B82F6', // Blue
  executive: '#F59E0B', // Amber
  judicial: '#8B5CF6', // Purple
};
