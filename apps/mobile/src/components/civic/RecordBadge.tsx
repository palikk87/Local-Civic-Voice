/**
 * THE PLATFORM RATING ITS OWN RECORD, IN PUBLIC — and saying why.
 *
 * Web twin: apps/web/src/components/civic/RecordBadge.tsx
 *
 * WHAT THIS REPLACES. A chip scored by arithmetic over constants, with a
 * ceiling of 80 against a top bar of 90 — so its best badge was unreachable for
 * every law on every screen, and every post read "? Unverified" in red on
 * records that came straight from congress.gov.
 *
 * THE CHECKLIST IS THE FEATURE, NOT THE CHIP. "if they just see unconfirmed for
 * example they are wary but don't understand but if they see it and then see
 * its just bc a brief or what ever else criteria is missing then then they
 * understand it and trust it more." So the chip opens a sheet, and the sheet is
 * the point.
 *
 * THE SERVER DECIDES. Every line comes from the backend's
 * services/record-completeness.ts, so a feed card and the law's own page can
 * never disagree about our own work. Nothing is computed here.
 */
import { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { Shield, Check, Minus, X } from 'lucide-react-native';

export interface RecordCompleteness {
  level: 'verified' | 'confirmed' | 'unconfirmed' | 'unverified';
  label: string;
  met: number;
  applicable: number;
  checks: Array<{ id: string; label: string; met: boolean; detail: string | null }>;
}

/** The four badges and what each costs. Same four lines on every record. */
const LADDER: Array<{ level: RecordCompleteness['level']; label: string; requirement: string }> = [
  { level: 'verified', label: 'Verified', requirement: 'Everything we should hold, we hold' },
  { level: 'confirmed', label: 'Confirmed', requirement: 'One thing still outstanding' },
  { level: 'unconfirmed', label: 'Unconfirmed', requirement: 'Two things still outstanding' },
  { level: 'unverified', label: 'Unverified', requirement: 'Three or more, including part of the sourcing' },
];

/** Never colour alone — the icon and the word carry it too. */
const TONE: Record<RecordCompleteness['level'], { color: string; icon: string }> = {
  verified: { color: '#22C55E', icon: '✓✓' },
  confirmed: { color: '#3B82F6', icon: '✓' },
  unconfirmed: { color: '#F59E0B', icon: '~' },
  unverified: { color: '#EF4444', icon: '?' },
};

export function RecordBadge({
  completeness,
  title,
}: {
  completeness: RecordCompleteness | null | undefined;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  // An older server sends nothing. No chip is better than a made-up one.
  if (!completeness) return null;

  const tone = TONE[completeness.level];
  const outstanding = completeness.checks.filter((check) => !check.met);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center px-2 py-0.5 rounded-full"
        style={{ backgroundColor: `${tone.color}20` }}
        accessibilityRole="button"
        accessibilityLabel={`Our record: ${completeness.label}. ${completeness.met} of ${completeness.applicable} checks. Open the checklist.`}
      >
        <Shield size={10} color={tone.color} />
        <Text className="text-xs font-medium ml-1" style={{ color: tone.color }}>
          {tone.icon} {completeness.label}
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end bg-black/60">
          <View className="bg-slate-900 rounded-t-2xl border-t border-slate-700 max-h-[85%]">
            <View className="flex-row items-center justify-between p-4 border-b border-slate-800">
              <Text className="text-white font-semibold text-base">Our record of this law</Text>
              <Pressable onPress={() => setOpen(false)} accessibilityLabel="Close">
                <X size={20} color="#94A3B8" />
              </Pressable>
            </View>

            <ScrollView className="p-4">
              {/*
                Said plainly, because the badge grades US and not the law. Every
                record comes from congress.gov, the Federal Register or
                CourtListener; what varies is how much we have finished pulling.
              */}
              <Text className="text-slate-400 text-sm mb-4">
                This rates how complete our own record is — not whether the law is real.{' '}
                {title ? `For ${title}, we` : 'We'} hold {completeness.met} of{' '}
                {completeness.applicable}.
              </Text>

              {completeness.checks.map((check) => (
                <View key={check.id} className="flex-row items-start mb-3">
                  {check.met ? (
                    <Check size={16} color="#22C55E" style={{ marginTop: 2 }} />
                  ) : (
                    <Minus size={16} color="#64748B" style={{ marginTop: 2 }} />
                  )}
                  <View className="ml-2.5 flex-1">
                    <Text className={check.met ? 'text-white text-sm' : 'text-slate-400 text-sm'}>
                      {check.label}
                    </Text>
                    {/* The real value behind the tick, which is what makes the
                        badge believable rather than another opaque score. */}
                    {check.detail ? (
                      <Text className="text-slate-500 text-xs mt-0.5">{check.detail}</Text>
                    ) : null}
                  </View>
                </View>
              ))}

              {outstanding.length > 0 && (
                <View className="bg-slate-800/60 rounded-xl p-3 border border-slate-700 mb-4">
                  {/*
                    A Citizen's Brief is only ever written because a reader asked
                    for one — nothing writes them in the background — so this is
                    also how somebody learns they can move the badge themselves.
                  */}
                  <Text className="text-slate-400 text-xs">
                    Outstanding: {outstanding.map((c) => c.label.toLowerCase()).join(', ')}. A
                    Citizen's Brief is written when somebody asks for one, and this updates when it
                    is.
                  </Text>
                </View>
              )}

              <View className="border-t border-slate-800 pt-3 pb-8">
                <Text className="text-white text-xs font-medium mb-2">What the badges mean</Text>
                {LADDER.map((rung) => (
                  <View key={rung.level} className="flex-row mb-1.5">
                    <Text
                      className="text-xs font-medium w-24"
                      style={{ color: TONE[rung.level].color }}
                    >
                      {TONE[rung.level].icon} {rung.label}
                    </Text>
                    <Text className="text-slate-400 text-xs flex-1">{rung.requirement}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
