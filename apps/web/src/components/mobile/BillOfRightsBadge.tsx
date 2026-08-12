// Web port of mobile/src/components/BillOfRightsBadge.tsx
import { useNavigate } from "react-router-dom";
import {
  Scroll,
  Shield,
  Scale,
  Eye,
  Crown,
  Award,
  BookOpen,
  CheckCircle,
  Lock,
  Unlock,
  type LucideIcon,
} from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { BILL_OF_RIGHTS } from "@/lib/mobile/bill-of-rights";
import { CONSTITUTION } from "@/lib/mobile/constitution";

interface BillOfRightsBadgeProps {
  variant?: "compact" | "full";
  showVersion?: boolean;
  className?: string;
}

/**
 * Bill of Rights Compliance Badge
 * Shows that this app operates under the Civil Voice Bill of Rights
 */
export function BillOfRightsBadge({
  variant = "compact",
  showVersion = false,
  className = "",
}: BillOfRightsBadgeProps) {
  const navigate = useNavigate();

  const handlePress = () => {
    navigate("/bill-of-rights");
  };

  if (variant === "compact") {
    return (
      <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        <button
          onClick={handlePress}
          className={`flex items-center bg-amber-900/30 px-2 py-1 rounded-full border border-amber-700/30 ${className}`}
        >
          <Scroll size={12} color="#FCD34D" />
          <span className="text-amber-300 text-xs font-medium ml-1">Rights Protected</span>
        </button>
      </MotionDiv>
    );
  }

  return (
    <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <button
        onClick={handlePress}
        className={`bg-amber-900/20 rounded-xl p-3 border border-amber-700/30 w-full text-left ${className}`}
      >
        <div className="flex items-center">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center mr-3">
            <Shield size={20} color="#FCD34D" />
          </div>
          <div className="flex-1">
            <p className="text-amber-100 font-semibold">Bill of Rights Protected</p>
            <p className="text-amber-300/70 text-xs">
              {BILL_OF_RIGHTS.articles.length} Articles enshrined in code
            </p>
          </div>
          <Scroll size={16} color="#FCD34D" />
        </div>
        {showVersion ? (
          <p className="text-amber-500/50 text-xs mt-2">v{BILL_OF_RIGHTS.version}</p>
        ) : null}
      </button>
    </MotionDiv>
  );
}

interface ArticleBadgeProps {
  articleNumber: "I" | "II" | "III" | "IV" | "V";
  size?: "sm" | "md";
  source?: "bill-of-rights" | "constitution";
}

const ARTICLE_COLORS: Record<string, string> = {
  I: "#F59E0B",
  II: "#3B82F6",
  III: "#22C55E",
  IV: "#8B5CF6",
  V: "#EF4444",
};

/**
 * Individual Article Badge
 * Use to indicate which specific article protects a feature
 */
export function ArticleBadge({ articleNumber, size = "sm", source = "bill-of-rights" }: ArticleBadgeProps) {
  const article =
    source === "bill-of-rights"
      ? BILL_OF_RIGHTS.articles.find((a) => a.number === articleNumber)
      : CONSTITUTION.articles.find((a) => a.number === articleNumber);
  if (!article) return null;

  const color = ARTICLE_COLORS[articleNumber] ?? "#F59E0B";

  if (size === "sm") {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded"
        style={{ backgroundColor: `${color}20` }}
      >
        <span className="text-xs font-bold" style={{ color }}>
          Art. {articleNumber}
        </span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center px-2 py-1 rounded-lg"
      style={{ backgroundColor: `${color}20` }}
    >
      <span className="text-xs font-bold mr-1" style={{ color }}>
        Article {articleNumber}:
      </span>
      <span className="text-xs" style={{ color: `${color}CC` }}>
        {"subtitle" in article ? (article as { subtitle: string }).subtitle : article.title}
      </span>
    </span>
  );
}

/**
 * Compliance Statement
 * Shows a specific compliance message for a feature
 */
export function ComplianceStatement({
  article,
  statement,
}: {
  article: "I" | "II" | "III" | "IV" | "V";
  statement: string;
}) {
  return (
    <div className="flex items-start bg-slate-800/40 rounded-lg p-2 mt-2">
      <ArticleBadge articleNumber={article} size="sm" />
      <span className="text-slate-400 text-xs ml-2 flex-1">{statement}</span>
    </div>
  );
}

// Icon mapping for articles
const ARTICLE_ICONS: Record<string, LucideIcon> = {
  I: Crown, // Sovereignty
  II: Scale, // Neutrality
  III: Eye, // Transparency
  IV: Shield, // Privacy
  V: Award, // Leadership
};

interface RightProtectionBannerProps {
  article: "I" | "II" | "III" | "IV" | "V";
  title: string;
  description: string;
  isActive?: boolean;
}

/**
 * Right Protection Banner
 * Shows when a specific right is being exercised or protected
 */
export function RightProtectionBanner({
  article,
  title,
  description,
  isActive = true,
}: RightProtectionBannerProps) {
  const navigate = useNavigate();
  const color = ARTICLE_COLORS[article] ?? "#F59E0B";
  const IconComponent = ARTICLE_ICONS[article] ?? Shield;

  return (
    <MotionDiv initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <button
        onClick={() => navigate("/bill-of-rights")}
        className="rounded-xl p-3 border w-full text-left"
        style={{ backgroundColor: `${color}10`, borderColor: `${color}30` }}
      >
        <div className="flex items-center">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center mr-3"
            style={{ backgroundColor: `${color}20` }}
          >
            <IconComponent size={16} color={color} />
          </div>
          <div className="flex-1">
            <div className="flex items-center">
              <span className="font-semibold text-sm" style={{ color }}>
                {title}
              </span>
              {isActive ? (
                <span className="ml-2 flex items-center">
                  <CheckCircle size={12} color="#22C55E" />
                  <span className="text-emerald-400 text-xs ml-1">Active</span>
                </span>
              ) : null}
            </div>
            <p className="text-slate-400 text-xs mt-0.5">{description}</p>
          </div>
          <ArticleBadge articleNumber={article} size="sm" />
        </div>
      </button>
    </MotionDiv>
  );
}

interface DelegationRightIndicatorProps {
  canRevoke: boolean;
  onLearnMore?: () => void;
}

/**
 * Delegation Right Indicator
 * Shows Article I protections for delegation actions
 */
export function DelegationRightIndicator({ canRevoke }: DelegationRightIndicatorProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-amber-900/20 rounded-lg p-3 border border-amber-700/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center flex-1">
          {canRevoke ? <Unlock size={16} color="#22C55E" /> : <Lock size={16} color="#EF4444" />}
          <span className="text-amber-100 text-sm font-medium ml-2">
            {canRevoke ? "Instant Revocation Available" : "Revocation Blocked"}
          </span>
        </div>
        <button onClick={() => navigate("/bill-of-rights")}>
          <ArticleBadge articleNumber="I" size="sm" />
        </button>
      </div>
      <p className="text-amber-300/70 text-xs mt-2">
        Per Article I, you can revoke your delegation at any time, for any reason, without delay or
        penalty.
      </p>
    </div>
  );
}

interface TransparencyIndicatorProps {
  directVotes: number;
  delegatedVotes: number;
  totalWeight: number;
}

/**
 * Transparency Indicator
 * Shows Article III vote transparency breakdown
 */
export function TransparencyIndicator({
  directVotes,
  delegatedVotes,
  totalWeight,
}: TransparencyIndicatorProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/bill-of-rights")}
      className="bg-emerald-900/20 rounded-lg p-3 border border-emerald-700/30 w-full text-left"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center">
          <Eye size={16} color="#22C55E" />
          <span className="text-emerald-100 text-sm font-medium ml-2">Vote Transparency</span>
        </div>
        <ArticleBadge articleNumber="III" size="sm" />
      </div>
      <div className="flex justify-between">
        <div>
          <p className="text-slate-400 text-xs">Direct</p>
          <p className="text-white font-bold">{directVotes.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-slate-400 text-xs">Delegated</p>
          <p className="text-white font-bold">{delegatedVotes.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-slate-400 text-xs">Total Weight</p>
          <p className="text-emerald-400 font-bold">{totalWeight.toLocaleString()}</p>
        </div>
      </div>
      <p className="text-emerald-300/60 text-xs mt-2 italic">
        "Every user has the right to see the mathematical path of a decision"
      </p>
    </button>
  );
}

interface ConstitutionalPowerBadgeProps {
  branch: "electorate" | "vanguard" | "judiciary";
}

/**
 * Constitutional Power Badge
 * Shows which branch of platform governance the user belongs to
 */
export function ConstitutionalPowerBadge({ branch }: ConstitutionalPowerBadgeProps) {
  const navigate = useNavigate();

  const branchInfo = {
    electorate: {
      label: "Electorate",
      description: "The sole source of all power",
      color: "#3B82F6",
      icon: Crown,
    },
    vanguard: {
      label: "Civil Leader",
      description: "Magnification through merit",
      color: "#F59E0B",
      icon: Award,
    },
    judiciary: {
      label: "Community Jury",
      description: "Resolve disputes",
      color: "#8B5CF6",
      icon: Scale,
    },
  };

  const info = branchInfo[branch];
  const IconComponent = info.icon;

  return (
    <button
      onClick={() => navigate("/constitution")}
      className="rounded-lg p-2 border text-left"
      style={{ backgroundColor: `${info.color}15`, borderColor: `${info.color}30` }}
    >
      <div className="flex items-center">
        <IconComponent size={14} color={info.color} />
        <span className="text-xs font-semibold ml-1.5" style={{ color: info.color }}>
          {info.label}
        </span>
      </div>
      <p className="text-slate-400 text-xs mt-0.5">{info.description}</p>
    </button>
  );
}

interface FoundingDocumentsLinkProps {
  variant?: "horizontal" | "vertical";
}

/**
 * Founding Documents Link
 * Quick access to both Constitution and Bill of Rights
 */
export function FoundingDocumentsLink({ variant = "horizontal" }: FoundingDocumentsLinkProps) {
  const navigate = useNavigate();

  if (variant === "horizontal") {
    return (
      <div className="flex">
        <button
          onClick={() => navigate("/constitution")}
          className="flex-1 flex items-center justify-center bg-slate-800/60 rounded-l-lg py-2 px-3 border-r border-slate-700"
        >
          <BookOpen size={14} color="#94A3B8" />
          <span className="text-slate-300 text-xs font-medium ml-1.5">Constitution</span>
        </button>
        <button
          onClick={() => navigate("/bill-of-rights")}
          className="flex-1 flex items-center justify-center bg-amber-900/30 rounded-r-lg py-2 px-3"
        >
          <Scroll size={14} color="#FCD34D" />
          <span className="text-amber-300 text-xs font-medium ml-1.5">Bill of Rights</span>
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => navigate("/constitution")}
        className="w-full flex items-center bg-slate-800/60 rounded-t-lg py-2 px-3 border-b border-slate-700"
      >
        <BookOpen size={14} color="#94A3B8" />
        <span className="text-slate-300 text-xs font-medium ml-1.5">Constitution</span>
      </button>
      <button
        onClick={() => navigate("/bill-of-rights")}
        className="w-full flex items-center bg-amber-900/30 rounded-b-lg py-2 px-3"
      >
        <Scroll size={14} color="#FCD34D" />
        <span className="text-amber-300 text-xs font-medium ml-1.5">Bill of Rights</span>
      </button>
    </div>
  );
}
