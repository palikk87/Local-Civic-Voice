/**
 * THE MOST IMPORTANT CONTROL IN THE APP, LOOKING THE SAME ON BOTH.
 *
 * Web twin: the `aye` and `nay` variants in apps/web/src/components/ui/button.tsx,
 * as used by components/civic/VotePanel.tsx.
 *
 * Reported plainly: "My buttons on the app still don't have this look." The
 * phone drew them five different ways and none of them matched the web:
 *
 *   - the three law screens had them OUTLINED until you voted — a tinted wash
 *     with a thin border — and only filled in afterwards, so the primary action
 *     on the page read as secondary until it was too late to matter.
 *   - the feed and timeline cards had them GREY until you voted, then plain
 *     emerald-600 and red-600.
 *
 * AYE IS THE LIGHT ONE, NAY IS THE DARK ONE, AND THAT IS NOT DECORATION. Around
 * one man in twelve has red-green colour blindness. Simulated through the
 * Brettel-Vienot model, a mid-green against a mid-red — which is exactly what
 * emerald-600 against red-600 is — collapses into two near-identical olives.
 * Splitting the pair by LIGHTNESS as well as hue is what carries it, and the
 * icons and the words carry the rest. Colour is never the only channel, which
 * is why the chosen side also gets a tick.
 *
 * THE PLINTH. The web has a 4px hard shadow under each button that shrinks when
 * pressed. React Native has no hard shadow, so it is a bottom border of the
 * same colour, shrinking the same way — same object, same behaviour, drawn with
 * what the platform has.
 */
import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { ThumbsUp, ThumbsDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

/** Straight from the web's dark-theme tokens, so the two cannot drift. */
const AYE = {
  fill: '#4ADE80', // --support        hsl(142 69% 58%)
  ink: '#082114', // --support-foreground hsl(150 62% 8%)
  plinth: '#114A2E', //                hsl(150 62% 18%)
};
const NAY = {
  fill: '#9F1239', // --oppose         hsl(344 79% 35%)
  ink: '#FFFFFF', // --oppose-foreground
  plinth: '#520A1D', //                hsl(344 79% 18%)
};

function VoteButton({
  side,
  label,
  chosen,
  busy,
  onPress,
  size,
}: {
  side: 'aye' | 'nay';
  label: string;
  chosen: boolean;
  busy?: boolean;
  onPress: () => void;
  size: 'lg' | 'sm';
}) {
  const [pressed, setPressed] = useState(false);
  const tone = side === 'aye' ? AYE : NAY;
  const Icon = side === 'aye' ? ThumbsUp : ThumbsDown;
  const plinth = pressed ? 1 : 4;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: chosen, busy }}
      accessibilityLabel={chosen ? `${label}, your position` : label}
      disabled={busy}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone.fill,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: tone.fill,
        borderBottomWidth: plinth,
        borderBottomColor: tone.plinth,
        // The press travels the distance the plinth loses, so the face of the
        // button stays put and only the depth changes.
        transform: [{ translateY: pressed ? 3 : 0 }],
        paddingVertical: size === 'lg' ? 12 : 7,
        opacity: busy ? 0.7 : 1,
        // Your own position is ringed in the platform's gold, the same way the
        // web rings it — never by dimming the other one, which would read as
        // "that option is gone".
        ...(chosen ? { borderColor: '#F59E0B' } : null),
      }}
    >
      {busy ? (
        <ActivityIndicator color={tone.ink} size="small" />
      ) : (
        <>
          <Icon size={size === 'lg' ? 20 : 15} color={tone.ink} />
          <Text
            style={{
              color: tone.ink,
              fontWeight: '800',
              letterSpacing: 2,
              fontSize: size === 'lg' ? 17 : 13,
              marginLeft: 8,
            }}
          >
            {chosen ? `${label} ✓` : label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function VoteButtons({
  userVote,
  onAye,
  onNay,
  busy,
  size = 'lg',
  ayeLabel = 'AYE',
  nayLabel = 'NAY',
}: {
  /** Which side this reader is on, in whichever vocabulary the screen uses. */
  userVote?: string | null;
  onAye: () => void;
  onNay: () => void;
  busy?: boolean;
  size?: 'lg' | 'sm';
  /** A card can append its percentage; the law screens use the bare word. */
  ayeLabel?: string;
  nayLabel?: string;
}) {
  // Three vocabularies reach this: 'yea'/'nay' on the law screens,
  // 'support'/'oppose' in the position ledger, and null for nobody.
  const chose = (side: 'aye' | 'nay') =>
    side === 'aye'
      ? userVote === 'yea' || userVote === 'support'
      : userVote === 'nay' || userVote === 'oppose';

  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <VoteButton
        side="aye"
        label={ayeLabel}
        chosen={chose('aye')}
        busy={busy}
        onPress={onAye}
        size={size}
      />
      <VoteButton
        side="nay"
        label={nayLabel}
        chosen={chose('nay')}
        busy={busy}
        onPress={onNay}
        size={size}
      />
    </View>
  );
}
