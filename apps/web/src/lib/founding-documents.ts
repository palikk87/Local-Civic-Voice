// AYE & NAY founding documents, adapted for web from the mobile app.
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Droplets,
  Eye,
  Scale,
  RotateCcw,
  Crown,
  Shield,
  Award,
} from "lucide-react";

export interface ConstitutionSection {
  id: string;
  title: string;
  content: string;
  enforcedInCode: boolean;
}

export interface ConstitutionArticle {
  id: string;
  number: string;
  title: string;
  icon: LucideIcon;
  sections: ConstitutionSection[];
}

export const CONSTITUTION = {
  version: "1.0",
  effectiveDate: "2025-01-01",
  preamble:
    "We, the People, in order to reclaim our inherent right to self-governance in a digital age, establish this Constitution. We declare that the Will of the People—verified, deliberated, and transparent—is the supreme authority of this platform. All code, algorithms, and leadership structures are subordinate to this singular objective.",
  articles: [
    {
      id: "article-1",
      number: "I",
      title: "The Supremacy of the Pulse",
      icon: Activity,
      sections: [
        {
          id: "art1-sec1",
          title: "The Pulse as Law",
          content:
            'The "Public Pulse" (the aggregated, weighted sentiment of verified citizens) shall be the only official output of this platform.',
          enforcedInCode: true,
        },
        {
          id: "art1-sec2",
          title: "Anti-Manipulation",
          content:
            "No external entity—corporate, governmental, or algorithmic—shall have the power to alter, suppress, or prioritize any segment of the Pulse.",
          enforcedInCode: true,
        },
        {
          id: "art1-sec3",
          title: "The Human Requirement",
          content:
            'Only verified human beings may contribute to the Pulse. Artificial Intelligence may summarize or facilitate, but it shall have no vote, no weight, and no "voice" in the final tally.',
          enforcedInCode: true,
        },
      ],
    },
    {
      id: "article-2",
      number: "II",
      title: "The Doctrine of Liquid Sovereignty",
      icon: Droplets,
      sections: [
        {
          id: "art2-sec1",
          title: "The Reclaimable Voice",
          content: 'Political power on this platform is never "won"; it is only "borrowed."',
          enforcedInCode: true,
        },
        {
          id: "art2-sec2",
          title: "Instant Recall",
          content:
            "Every user retains the absolute, non-negotiable right to instantly revoke their delegation from any Civil Leader.",
          enforcedInCode: true,
        },
        {
          id: "art2-sec3",
          title: "The Floor, Not the Ceiling",
          content:
            'Users may always choose to vote directly on any "Master Reference ID," overriding their chosen Leader\'s stance for that specific instance without losing their long-term delegation.',
          enforcedInCode: true,
        },
      ],
    },
    {
      id: "article-3",
      number: "III",
      title: "The Transparency of the Architecture",
      icon: Eye,
      sections: [
        {
          id: "art3-sec1",
          title: "The Open Ledger",
          content:
            "The logic used to calculate the Pulse, the Trust Scores, and the Magnification of Leaders must be publicly auditable.",
          enforcedInCode: true,
        },
        {
          id: "art3-sec2",
          title: "Right to Audit",
          content:
            'Any user or group of users may demand an "Integrity Audit" of a specific vote if there is evidence of bot interference or system malfunction.',
          enforcedInCode: true,
        },
        {
          id: "art3-sec3",
          title: "Master Reference Integrity",
          content:
            'Every data point must link back to an official Executive, Legislative, or Judicial source ID to prevent the "Digital Government" from drifting into fiction.',
          enforcedInCode: true,
        },
      ],
    },
    {
      id: "article-4",
      number: "IV",
      title: "The Separation of Powers",
      icon: Scale,
      sections: [
        {
          id: "art4-sec1",
          title: "The Electorate (The Users)",
          content: "The sole source of all power. They vote, delegate, and impeach.",
          enforcedInCode: true,
        },
        {
          id: "art4-sec2",
          title: "The Vanguard (The Civil Leaders)",
          content:
            "Those who earn magnification through merit and expertise. They have no power other than that which is lent to them by the Electorate.",
          enforcedInCode: true,
        },
        {
          id: "art4-sec3",
          title: "The Judiciary (The Community Juries)",
          content:
            "Randomly selected high-trust users who resolve disputes regarding the Code of Conduct and the Bill of Rights.",
          enforcedInCode: false,
        },
      ],
    },
    {
      id: "article-5",
      number: "V",
      title: "The Self-Correction Mechanism",
      icon: RotateCcw,
      sections: [
        {
          id: "art5-sec1",
          title: "Leader Accountability",
          content:
            "Any Civil Leader who misrepresents the facts of a Federal ID or violates the Code of Conduct shall be subject to immediate demotion by a Jury of their peers.",
          enforcedInCode: true,
        },
        {
          id: "art5-sec2",
          title: "Platform Neutrality",
          content:
            'If the platform\'s administrators or developers are found to be biasing the Pulse, the Electorate may trigger a "System-Wide Reset" via a super-majority vote, forcing a roll-back to a neutral state.',
          enforcedInCode: false,
        },
      ],
    },
  ] as ConstitutionArticle[],
};

export interface RightsArticle {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  content: string;
  principles: string[];
  icon: LucideIcon;
}

export const BILL_OF_RIGHTS = {
  version: "1.0",
  effectiveDate: "2025-01-01",
  preamble:
    "We, the Users of AYE & NAY, in order to form a more perfect Union of citizens and technology, do hereby establish these fundamental rights to ensure the integrity of our collective voice and the security of our individual sovereignty.",
  articles: [
    {
      id: "rights-1",
      number: "I",
      title: "The Right of Individual Sovereignty",
      subtitle: "Liquid Democracy",
      content:
        "No user shall be permanently bound to any representative or leader. The power of the vote originates in the individual and is only lent, never given. Every citizen retains the absolute right to instantly revoke or reassign their delegation at any time, for any reason, without delay or penalty.",
      principles: [
        "Instant delegation revocation",
        "No lock-in periods on delegations",
        "Individual vote always overrides delegation",
        "Transparent delegation chains",
      ],
      icon: Crown,
    },
    {
      id: "rights-2",
      number: "II",
      title: "The Right to Algorithmic Neutrality",
      subtitle: "Public Pulse Integrity",
      content:
        'The "Public Pulse" shall not be manipulated for profit, engagement, or bias. The platform shall remain a neutral conduit for human intent. No "Black Box" algorithm shall amplify one voice over another based on outrage or commercial interest; only the verifiable weight of Liquid Democracy shall determine the prominence of an idea.',
      principles: [
        "No engagement-based manipulation",
        "No profit-driven amplification",
        "Transparent ranking factors",
        "Equal voice weight by default",
      ],
      icon: Scale,
    },
    {
      id: "rights-3",
      number: "III",
      title: "The Right of Redress & Transparency",
      subtitle: "Vote Details",
      content:
        'The "Vote Details" of any federal action shall be a public record within the platform. Every user has the right to see the mathematical path of a decision—to know exactly how many direct votes and delegated weights formed the Pulse. No "Dark Money" or bot-driven influence shall be permitted to obscure the true will of the people.',
      principles: [
        "Public vote tallies",
        "Visible delegation weights",
        "Anti-bot verification",
        "No hidden influence",
      ],
      icon: Eye,
    },
    {
      id: "rights-4",
      number: "IV",
      title: "The Right to Data Security & Anonymity",
      subtitle: "Digital Privacy",
      content:
        'The right of the people to be secure in their digital persons, papers, and effects shall not be violated. AYE & NAY shall collect only the minimum data necessary to verify citizenship and jurisdiction. Personal identity shall remain shielded from the federal government and third parties, ensuring that the "Public Pulse" is a reflection of honest conviction, not a target for surveillance.',
      principles: [
        "Minimal data collection",
        "No government data sharing",
        "Anonymous voting option",
        "Encrypted personal data",
      ],
      icon: Shield,
    },
    {
      id: "rights-5",
      number: "V",
      title: "The Right to Meritocratic Leadership",
      subtitle: "Civil Leader Accountability",
      content:
        'The status of "Civil Leader" is a privilege granted by the community, not a right of the platform. A Leader\'s magnification is tied directly to their Trust Score. The community retains the right to "Impeach" or demote any leader who violates the platform\'s integrity or spreads verifiable falsehoods, as determined by the collective will of their followers.',
      principles: [
        "Community-granted leadership",
        "Trust Score determines influence",
        "Community impeachment rights",
        "Falsehood accountability",
      ],
      icon: Award,
    },
  ] as RightsArticle[],
};
