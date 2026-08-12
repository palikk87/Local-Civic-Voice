// Web port of mobile/src/components/NewsReelCarousel.tsx — scrollable news carousel with bias indicators
import { useCallback, useMemo, useRef } from "react";
import { Play, ExternalLink, Clock, Shield, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NewsReel, BiasLean } from "@/lib/mobile/news-reels";
import { getBiasColor, getReelsForBill } from "@/lib/mobile/news-reels";
import {
  useBiasHistoryStore,
  selectIsPremium,
  getBalancedReels,
} from "@/lib/mobile/bias-history-store";

const CARD_WIDTH_CLASS = "w-[75vw] max-w-[280px] shrink-0";

function CivicPartnerAd({ onPress }: { onPress: () => void }) {
  return (
    <button
      onClick={onPress}
      className={cn(CARD_WIDTH_CLASS, "h-48 rounded-2xl overflow-hidden text-left border-2 border-amber-500")}
    >
      <div
        className="h-full flex flex-col justify-between p-4"
        style={{ background: "linear-gradient(160deg, #78350F, #451A03, #1C0A00)" }}
      >
        <div className="flex items-center">
          <div className="bg-amber-500/30 p-2 rounded-full">
            <Shield size={20} color="#F59E0B" />
          </div>
          <span className="text-amber-400 font-semibold ml-2 text-sm">Civic Partner</span>
        </div>

        <div>
          <p className="text-white font-bold text-lg mb-1">Support Informed Democracy</p>
          <p className="text-amber-100/70 text-sm mb-3">
            Learn how you can help make civic engagement accessible to all
          </p>
          <span className="inline-block bg-amber-500 px-4 py-2 rounded-full text-amber-950 font-semibold">
            Learn More
          </span>
        </div>
      </div>
    </button>
  );
}

interface ReelCardProps {
  reel: NewsReel;
  onPress: () => void;
  onWatchTimeUpdate: (watchTime: number) => void;
  isSponsored?: boolean;
}

function ReelCard({ reel, onPress, onWatchTimeUpdate, isSponsored = false }: ReelCardProps) {
  const biasColor = getBiasColor(reel.biasLean);
  const viewStartTime = useRef<number | null>(null);

  const handleMouseDown = () => {
    if (!viewStartTime.current) {
      viewStartTime.current = Date.now();
    }
  };

  const handlePress = () => {
    if (viewStartTime.current) {
      const watchTime = Math.floor((Date.now() - viewStartTime.current) / 1000);
      if (watchTime >= 10) {
        onWatchTimeUpdate(watchTime);
      }
      viewStartTime.current = null;
    }
    onPress();
  };

  const borderColor = isSponsored ? "#F59E0B" : biasColor;
  const borderWidth = isSponsored ? 3 : 2;

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <button
      onClick={handlePress}
      onMouseDown={handleMouseDown}
      className={cn(CARD_WIDTH_CLASS, "relative h-48 rounded-2xl overflow-hidden text-left")}
      style={{ borderWidth, borderColor, borderStyle: "solid" }}
    >
      {/* Thumbnail */}
      <img src={reel.thumbnailUrl} alt={reel.title} className="absolute inset-0 w-full h-full object-cover" />

      {/* Gradient Overlay */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[70%]"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)" }}
      />

      {/* Play Button */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-white/20 backdrop-blur-sm p-3 rounded-full">
          <Play size={24} color="#fff" fill="#fff" />
        </div>
      </div>

      {/* Sponsored Badge */}
      {isSponsored ? (
        <div className="absolute top-2 right-2 bg-amber-500/90 px-2 py-0.5 rounded-full flex items-center">
          <Sparkles size={10} color="#fff" />
          <span className="text-white text-xs font-medium ml-1">Sponsored</span>
        </div>
      ) : null}

      {/* Bias Badge */}
      <div
        className="absolute top-2 left-2 px-2 py-0.5 rounded-full"
        style={{ backgroundColor: `${biasColor}CC` }}
      >
        <span className="text-white text-xs font-semibold">{reel.biasLean}</span>
      </div>

      {/* Content Info */}
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <div className="flex items-center mb-1">
          <span className="text-white/80 text-xs">{reel.sourceName}</span>
          <span className="mx-1.5 w-1 h-1 rounded-full bg-white/50" />
          <Clock size={10} color="rgba(255,255,255,0.7)" />
          <span className="text-white/70 text-xs ml-1">{formatDuration(reel.duration)}</span>
        </div>
        <p className="text-white font-semibold text-sm line-clamp-2">{reel.title}</p>
      </div>
    </button>
  );
}

function BiasLegend() {
  const biases: { lean: BiasLean; label: string }[] = [
    { lean: "Left", label: "Left" },
    { lean: "Center", label: "Center" },
    { lean: "Right", label: "Right" },
  ];

  return (
    <div className="flex items-center justify-center mb-3 px-4">
      <span className="text-slate-400 text-xs mr-2">Media Bias:</span>
      {biases.map((bias, index) => (
        <div key={bias.lean} className="flex items-center">
          <span
            className="w-2.5 h-2.5 rounded-full mr-1"
            style={{ backgroundColor: getBiasColor(bias.lean) }}
          />
          <span className="text-slate-300 text-xs">{bias.label}</span>
          {index < biases.length - 1 ? <span className="text-slate-500 mx-2">|</span> : null}
        </div>
      ))}
    </div>
  );
}

interface NewsReelCarouselProps {
  billId: string;
  onReelPress?: (reel: NewsReel) => void;
}

export function NewsReelCarousel({ billId, onReelPress }: NewsReelCarouselProps) {
  const isPremium = useBiasHistoryStore(selectIsPremium);
  const recordView = useBiasHistoryStore((s) => s.recordView);
  const recordAdClick = useBiasHistoryStore((s) => s.recordAdClick);
  const getDominantBias = useBiasHistoryStore((s) => s.getDominantBias);

  const allReels = getReelsForBill(billId);
  const dominantBias = getDominantBias();
  const balancedReels = getBalancedReels(allReels, dominantBias, 10);

  const reels = isPremium ? balancedReels.filter((r) => !r.isSponsored) : balancedReels;

  const carouselItems = useMemo(() => {
    const items: Array<{ type: "reel"; data: NewsReel } | { type: "ad"; id: string }> = [];
    reels.forEach((reel, index) => {
      items.push({ type: "reel", data: reel });
      if (!isPremium && (index + 1) % 4 === 0 && index < reels.length - 1) {
        items.push({ type: "ad", id: `ad-${index}` });
      }
    });
    return items;
  }, [reels, isPremium]);

  const handleWatchTimeUpdate = useCallback(
    (reel: NewsReel, watchTime: number) => {
      if (watchTime >= 10) {
        recordView(reel.biasLean, watchTime);
      }
    },
    [recordView]
  );

  const handleReelPress = useCallback(
    (reel: NewsReel) => {
      if (onReelPress) {
        onReelPress(reel);
      } else {
        window.open(reel.videoUrl, "_blank", "noreferrer");
      }
    },
    [onReelPress]
  );

  const handleAdPress = useCallback(
    (adId: string) => {
      recordAdClick(adId, "civic_partner");
    },
    [recordAdClick]
  );

  if (reels.length === 0) {
    return null;
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-4 mb-2">
        <span className="text-white font-semibold text-lg">News Coverage</span>
        <div className="flex items-center">
          <ExternalLink size={14} color="#64748B" />
          <span className="text-slate-400 text-sm ml-1">{reels.length} sources</span>
        </div>
      </div>

      <BiasLegend />

      <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {carouselItems.map((item, index) =>
          item.type === "ad" ? (
            <CivicPartnerAd key={`ad-${billId}-${index}`} onPress={() => handleAdPress(item.id)} />
          ) : (
            <ReelCard
              key={`reel-${item.data.id}-${index}`}
              reel={item.data}
              isSponsored={item.data.isSponsored && !isPremium}
              onPress={() => handleReelPress(item.data)}
              onWatchTimeUpdate={(time) => handleWatchTimeUpdate(item.data, time)}
            />
          )
        )}
      </div>

      {/* Balanced Feed Indicator */}
      {dominantBias ? (
        <div className="flex items-center justify-center mt-3 px-4">
          <div className="bg-slate-800/60 px-3 py-1.5 rounded-full flex items-center">
            <Shield size={12} color="#22C55E" />
            <span className="text-slate-300 text-xs ml-1.5">
              Balanced Feed: 70% preferred, 30% diverse perspectives
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default NewsReelCarousel;
