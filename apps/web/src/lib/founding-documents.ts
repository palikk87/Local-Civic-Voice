/**
 * The founding documents, for the web app.
 *
 * WHAT THIS USED TO BE. A second, hand-maintained copy of the whole
 * Constitution and Bill of Rights — every article, every clause, and fifteen
 * `enforcedInCode` flags, sitting beside the copy in packages/civic-core that
 * the phone reads. They agreed by luck. Nothing made them agree.
 *
 * A platform whose supreme document exists twice does not have a supreme
 * document; it has two drafts and a coin toss. So this file no longer holds
 * text. It holds the one thing the web genuinely needs that the shared package
 * cannot give it: real Lucide components in place of icon names, because
 * civic-core is shared with a React Native app whose icons are different
 * modules entirely.
 *
 * Change the words in packages/civic-core/src/constitution.ts, and both
 * clients change together, because there is only one of them now — and the
 * Bill of Rights is part of that one, as Amendments I to V.
 */

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Award,
  Crown,
  Droplets,
  Eye,
  RotateCcw,
  Scale,
  Shield,
} from "lucide-react";
import {
  CONSTITUTION as CORE_CONSTITUTION,
  getAmendmentEnforcement,
  getConstitutionalEnforcement,
} from "@civic/core/constitution";

export { getAmendmentEnforcement, getConstitutionalEnforcement };

export interface ConstitutionSection {
  id: string;
  title: string;
  content: string;
  /**
   * True only when a test under backend/tests carries this clause's id in its
   * name. See backend/tests/constitution-enforced.test.ts — the badge cannot
   * outrun the suite. That rule is Article VI.
   */
  enforcedInCode: boolean;
}

export interface ConstitutionArticle {
  id: string;
  number: string;
  title: string;
  icon: LucideIcon;
  sections: ConstitutionSection[];
}

export interface Definition {
  term: string;
  meaning: string;
}

/** An Amendment — what the Bill of Rights is made of. */
export interface RightsArticle {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  content: string;
  icon: LucideIcon;
  enforcedInCode: boolean;
}

/**
 * Icon name to component. The one thing that genuinely differs between the two
 * clients: civic-core stores a name because a React Native app resolves it
 * from a different package.
 *
 * An unknown name falls back to Scale rather than crashing the page — a
 * missing glyph is not a reason a citizen cannot read their own constitution.
 */
const ICONS: Record<string, LucideIcon> = {
  Activity,
  Award,
  Crown,
  Droplets,
  Eye,
  RotateCcw,
  Scale,
  Shield,
};

function icon(name: string): LucideIcon {
  return ICONS[name] ?? Scale;
}

const AMENDMENTS = CORE_CONSTITUTION.amendments.map((amendment) => ({
  id: amendment.id,
  number: amendment.number,
  title: amendment.title,
  subtitle: amendment.subtitle,
  content: amendment.content,
  icon: icon(amendment.icon),
  enforcedInCode: amendment.enforcedInCode,
})) as RightsArticle[];

export const CONSTITUTION = {
  version: CORE_CONSTITUTION.version,
  effectiveDate: CORE_CONSTITUTION.effectiveDate,
  preamble: CORE_CONSTITUTION.preamble,
  amendmentsNote: CORE_CONSTITUTION.amendmentsNote,
  definitions: CORE_CONSTITUTION.definitions,
  articles: CORE_CONSTITUTION.articles.map((article) => ({
    id: article.id,
    number: article.number,
    title: article.title,
    icon: icon(article.icon),
    sections: article.sections.map((section) => ({
      id: section.id,
      title: section.title,
      content: section.content,
      enforcedInCode: section.enforcedInCode,
    })),
  })) as ConstitutionArticle[],
  amendments: AMENDMENTS,
};

/**
 * The Bill of Rights is not a second document. It is the Amendments, under the
 * name people actually call them.
 */
export const BILL_OF_RIGHTS = {
  version: CORE_CONSTITUTION.version,
  effectiveDate: CORE_CONSTITUTION.effectiveDate,
  preamble: CORE_CONSTITUTION.amendmentsNote,
  articles: AMENDMENTS,
};
