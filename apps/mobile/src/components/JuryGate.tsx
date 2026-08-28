/**
 * SEQUESTRATION, on the screen — Constitution Article IV.
 *
 * Phone twin of apps/web/src/components/jury/JuryGate.tsx.
 *
 * THIS IS NOT THE ENFORCEMENT. The server is: every route but the case,
 * sign-out, account settings and the bug reporter answers 423 for a sequestered
 * account. What this adds is that the app behaves like it means it, rather than
 * showing a juror five hundred failed requests.
 *
 * A SUMMONS IS NOT A SEQUESTRATION. Somebody called but not yet accepted gets a
 * banner, not a redirect: they still have a day, and taking their app away
 * before they said yes would be the platform answering for them.
 */

import React, { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Scale } from 'lucide-react-native';
import { usePermissions } from '@/lib/auth/use-civic-auth';
import { juries } from '@/lib/juries';

export function JuryGate() {
  const { isAuthenticated } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();

  const { data } = useQuery({
    queryKey: ['juries', 'mine'],
    queryFn: juries.mine,
    enabled: isAuthenticated,
    // A summons arrives while somebody is using the app, so this has to notice
    // without a reload. A minute is far inside the 24-hour window.
    refetchInterval: 60_000,
  });

  const sequestered = data?.sequesteredBy ?? null;
  const onTheCase = sequestered ? pathname === `/jury/${sequestered}` : false;

  useEffect(() => {
    if (sequestered && !onTheCase) {
      router.replace(`/jury/${sequestered}`);
    }
  }, [sequestered, onTheCase, router]);

  const waiting = (data?.summonses ?? []).filter((s) => s.state === 'summoned');
  if (sequestered || waiting.length === 0) return null;

  return (
    <Pressable
      testID="jury-summons-banner"
      onPress={() => router.push(`/jury/${waiting[0]!.juryId}`)}
      className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2"
    >
      <View className="flex-row items-center">
        <Scale size={16} color="#F59E0B" />
        <Text className="ml-2 flex-1 text-sm leading-5 text-white">
          <Text className="font-semibold">You have been called to a jury.</Text> A report is waiting
          for a decision and you were drawn at random. You have a day to answer.
        </Text>
      </View>
    </Pressable>
  );
}
