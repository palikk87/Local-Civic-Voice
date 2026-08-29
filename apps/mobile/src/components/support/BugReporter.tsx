/**
 * Report a bug by pointing at it — the mobile half of the web reporter.
 *
 * WHERE THIS DIFFERS FROM THE WEB, AND WHY IT IS SAID OUT LOUD.
 *
 * On the web, pointing gives back the thing itself: its visible label, and a
 * DOM path a developer can search for. React Native has no DOM and no way to
 * ask "what is under this coordinate" without every component in the app
 * volunteering for it, so the same trick is not available.
 *
 * What is available is the tap itself. The overlay records exactly where on the
 * screen the finger landed, in real pixels and as a share of the width and
 * height, together with the route. "84% across and 71% down /bill/hr-1234-119
 * on a 390x844 screen" is not as good as "the Vote Nay button", and pretending
 * otherwise would be the thing this codebase keeps getting punished for. It is
 * true, it is specific, and it is enough to find the component.
 *
 * Everything else is the same: two questions rather than one, signed-out
 * visitors can report, and the payload is the same shape the web sends to the
 * same endpoint.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  Platform,
  Alert,
  type GestureResponderEvent,
} from 'react-native';
import { useLocalSearchParams, usePathname, useSegments } from 'expo-router';
import { Bug, Crosshair, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { api } from '@/lib/api/api';

type Stage = 'idle' | 'picking' | 'writing' | 'sending';

interface Picked {
  label: string;
  path: string;
}

/**
 * A tap turned into words somebody can act on.
 *
 * Thirds rather than percentages in the label, because "the middle of the lower
 * third" is how a person would say it and how a developer would look for it.
 * The exact numbers are kept in `path` for whoever needs them.
 */
function describeTap(x: number, y: number, width: number, height: number): Picked {
  const across = x / width;
  const down = y / height;

  const horizontal = across < 0.34 ? 'left' : across < 0.67 ? 'centre' : 'right';
  const vertical = down < 0.25 ? 'top' : down < 0.5 ? 'upper middle' : down < 0.75 ? 'lower middle' : 'bottom';

  return {
    label: `the ${horizontal} of the ${vertical} of the screen`,
    path: `tap (${Math.round(x)}, ${Math.round(y)}) on a ${Math.round(width)}x${Math.round(
      height,
    )} screen — ${Math.round(across * 100)}% across, ${Math.round(down * 100)}% down`,
  };
}

const FIELD =
  'bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white';

export function BugReporter() {
  const pathname = usePathname();
  /**
   * WHICH RECORD THE SCREEN WAS SHOWING.
   *
   * A phone has no DOM, so there is no element to interrogate the way the web
   * reporter does — a tap gives coordinates and nothing else, and coordinates
   * tell an admin almost nothing. What IS knowable here is the screen and its
   * parameters, and that is the part the admin actually needs: not "the upper
   * middle of the screen" but "the bill detail screen, showing hr-3194-119".
   */
  const params = useLocalSearchParams();
  const segments = useSegments();
  const [stage, setStage] = useState<Stage>('idle');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState('');
  const [wanted, setWanted] = useState('');

  function reset() {
    setStage('idle');
    setPicked(null);
    setProblem('');
    setWanted('');
  }

  const onPickTap = (event: GestureResponderEvent) => {
    const { width, height } = Dimensions.get('window');
    const { pageX, pageY } = event.nativeEvent;
    setPicked(describeTap(pageX, pageY, width, height));
    Haptics.selectionAsync();
    setStage('writing');
  };

  async function send() {
    if (problem.trim().length < 3) {
      Alert.alert('One more line', 'Say what went wrong, even briefly.');
      return;
    }

    const { width, height } = Dimensions.get('window');
    setStage('sending');
    try {
      await api.post('/api/bug-reports', {
        // No URL bar on a phone. The route is the honest equivalent, and the
        // backend requires both fields, so it is sent as both rather than
        // inventing a hostname that does not exist.
        pageUrl: `app://${pathname}`,
        pagePath: pathname,
        elementLabel: picked?.label,
        elementPath: picked?.path,
        // What the screen actually was, since there is no element to inspect.
        elementDetail: {
          screen: segments.length ? `/${segments.join('/')}` : pathname,
          params: Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v !== undefined && v !== null)
              .map(([k, v]) => [k, String(Array.isArray(v) ? v.join(',') : v).slice(0, 300)]),
          ),
          tap: picked?.path,
        },
        problem: problem.trim(),
        wanted: wanted.trim() || undefined,
        userAgent: `AYE & NAY mobile — ${Platform.OS} ${Platform.Version}`,
        viewport: `${Math.round(width)}x${Math.round(height)}`,
        appCommit: process.env.EXPO_PUBLIC_COMMIT_SHA ?? undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Sent', 'Thank you — an admin will see this.');
      reset();
    } catch (error) {
      setStage('writing');
      Alert.alert(
        'Not sent',
        error instanceof Error ? error.message : 'Could not send that report.',
      );
    }
  }

  if (stage === 'idle') {
    return (
      <TouchableOpacity
        onPress={() => setStage('writing')}
        accessibilityLabel="Report a problem with this screen"
        // Above the tab bar, out of the way of the primary actions, and on
        // every screen because the screens people cannot get past are exactly
        // the ones worth hearing about.
        style={{ position: 'absolute', right: 16, bottom: 96 }}
        className="w-11 h-11 rounded-full bg-slate-800/95 border border-slate-700 items-center justify-center"
      >
        <Bug size={20} color="#8FA79A" />
      </TouchableOpacity>
    );
  }

  if (stage === 'picking') {
    return (
      <Modal transparent animationType="fade" onRequestClose={() => setStage('writing')}>
        {/* The whole screen is the target. The app underneath is not touchable
            while this is up, which is the point: aiming at Delete must report
            Delete rather than delete anything. */}
        <TouchableWithoutFeedback onPress={onPickTap}>
          <View style={{ flex: 1 }} className="bg-black/10">
            <View className="bg-amber-500 px-4 py-3 flex-row items-center justify-center">
              <Crosshair size={16} color="#451A03" />
              <Text className="text-amber-950 font-medium ml-2 flex-1">
                Tap the spot that is giving you trouble.
              </Text>
              <TouchableOpacity onPress={() => setStage('writing')}>
                <Text className="text-amber-950 underline">Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={reset}>
      <View style={{ flex: 1 }} className="justify-end bg-black/50">
        {/* CAPPED AND SCROLLABLE. Reported on the web as "you cant scroll on
            the pop up windows"; this sheet had the same defect — a long report
            form grew past the top of the phone with nothing to scroll. */}
        <ScrollView
          style={{ maxHeight: '85%' }}
          className="bg-slate-900 border-t border-slate-700 rounded-t-2xl px-4 pt-4 pb-8"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center">
              <Bug size={16} color="#F59E0B" />
              <Text className="text-white font-semibold ml-2">Report a problem</Text>
            </View>
            <TouchableOpacity onPress={reset} accessibilityLabel="Close">
              <X size={20} color="#8FA79A" />
            </TouchableOpacity>
          </View>

          {picked ? (
            <View className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 mb-3">
              <Text className="text-slate-400 text-xs">
                You pointed at <Text className="text-white font-medium">{picked.label}</Text>
              </Text>
              <TouchableOpacity onPress={() => setPicked(null)}>
                <Text className="text-slate-400 text-xs underline mt-1">clear</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setStage('picking')}
              className="flex-row items-center justify-center border border-slate-600 rounded-lg py-2.5 mb-3"
            >
              <Crosshair size={16} color="#8FA79A" />
              <Text className="text-slate-200 ml-2">Point at the problem</Text>
            </TouchableOpacity>
          )}

          <Text className="text-white text-xs font-medium mb-1">What happened?</Text>
          <TextInput
            className={`${FIELD} mb-3`}
            multiline
            numberOfLines={3}
            style={{ minHeight: 72, textAlignVertical: 'top' }}
            value={problem}
            onChangeText={setProblem}
            placeholder="I pressed Vote Nay and the bar stayed grey."
            placeholderTextColor="#6E8A7C"
          />

          <Text className="text-white text-xs font-medium mb-1">
            What should it have done? <Text className="text-slate-400">(optional)</Text>
          </Text>
          <TextInput
            className={`${FIELD} mb-4`}
            multiline
            numberOfLines={2}
            style={{ minHeight: 56, textAlignVertical: 'top' }}
            value={wanted}
            onChangeText={setWanted}
            placeholder="Filled the bar red and counted my vote."
            placeholderTextColor="#6E8A7C"
          />

          <TouchableOpacity
            onPress={send}
            disabled={stage === 'sending'}
            className={`bg-indigo-600 rounded-lg py-3 items-center ${
              stage === 'sending' ? 'opacity-60' : ''
            }`}
          >
            {stage === 'sending' ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-medium">Send to the team</Text>
            )}
          </TouchableOpacity>

          <Text className="text-slate-500 text-[11px] leading-snug mt-3">
            Sends the screen you are on, where you tapped, your screen size and the app version.
            Nothing else.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}
