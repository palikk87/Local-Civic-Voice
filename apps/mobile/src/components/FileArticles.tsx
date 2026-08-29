/**
 * Filing Articles of Impeachment, from wherever the person is.
 *
 * Phone twin of apps/web/src/components/articlev/FileArticles.tsx.
 *
 * WHY THIS IS ITS OWN FILE. It used to live inside the Article V screen, so
 * the only way to bring proceedings was to find a card buried on your own
 * profile, open Article V, and scroll to a list of your delegates. Somebody
 * who has just watched a delegate do the thing they want to impeach them for
 * is looking at THAT PERSON. A remedy nobody can find is not a remedy.
 *
 * The bar is unchanged and enforced by the server either way: only somebody
 * currently delegating to this person may file.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { cn } from '@/lib/cn';
import { articleV, personLabel, type MyDelegation } from '@/lib/article-v';

export function ArticlesForm({
  minLength,
  maxLength,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  minLength: number;
  maxLength: number;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (grounds: string, evidence: string) => void;
  onCancel: () => void;
}) {
  const [grounds, setGrounds] = useState('');
  const [evidence, setEvidence] = useState('');
  const ready = grounds.trim().length >= minLength && evidence.trim().length >= minLength;

  return (
    <View className="mt-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Grounds — what they are accused of
      </Text>
      <TextInput
        testID="articles-grounds"
        value={grounds}
        onChangeText={(text) => setGrounds(text.slice(0, maxLength))}
        multiline
        numberOfLines={4}
        placeholder="State the accusation plainly."
        placeholderTextColor="#6E8A7C"
        className="mt-1 min-h-[96px] rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100"
      />
      <Text className="mt-1 text-xs text-slate-500">
        {grounds.trim().length} of at least {minLength} characters
      </Text>

      <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Evidence — what shows it
      </Text>
      <TextInput
        testID="articles-evidence"
        value={evidence}
        onChangeText={(text) => setEvidence(text.slice(0, maxLength))}
        multiline
        numberOfLines={4}
        placeholder="Point at what anybody can check."
        placeholderTextColor="#6E8A7C"
        className="mt-1 min-h-[96px] rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100"
      />
      <Text className="mt-1 text-xs text-slate-500">
        {evidence.trim().length} of at least {minLength} characters
      </Text>

      {/* Said before they file, not after. */}
      <Text className="mt-3 rounded-xl border border-amber-700/40 bg-amber-900/20 p-3 text-xs leading-5 text-amber-200">
        This is a formal filing. It is delivered to the person it names, in their inbox and by
        email, and it goes to the platform's administrators. Nobody can stop the proceeding once
        it starts — but a filing made in bad faith is grounds for suspending or banning the person
        who made it.
      </Text>

      {error ? <Text className="mt-2 text-sm text-red-400">{error}</Text> : null}

      <View className="mt-3 flex-row">
        <Pressable
          testID="articles-submit"
          disabled={!ready || busy}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onSubmit(grounds.trim(), evidence.trim());
          }}
          className={cn(
            'flex-1 items-center rounded-xl py-3',
            ready && !busy ? 'bg-red-600' : 'bg-slate-700/50'
          )}
        >
          <Text className={cn('font-semibold', ready && !busy ? 'text-white' : 'text-slate-500')}>
            {busy ? 'Filing…' : submitLabel}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          className="ml-2 rounded-xl border border-slate-700 px-4 py-3"
        >
          <Text className="text-sm text-slate-300">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function FileAgainstDelegate({
  delegation,
  minLength,
  maxLength,
  onFiled,
}: {
  delegation: MyDelegation;
  minLength: number;
  maxLength: number;
  onFiled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filing = useMutation({
    mutationFn: ({ grounds, evidence }: { grounds: string; evidence: string }) =>
      articleV.file(delegation.toUser.id, grounds, evidence),
    onSuccess: () => {
      setOpen(false);
      setError(null);
      onFiled();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not file.'),
  });

  return (
    <View className="mb-4 rounded-2xl border border-slate-700/50 bg-slate-800/60 p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-semibold text-white">{personLabel(delegation.toUser)}</Text>
          <Text className="text-xs text-slate-400">
            {delegation.category
              ? `You delegate your vote on ${delegation.category}`
              : 'You delegate your vote across every category'}
          </Text>
        </View>
        {!open ? (
          <Pressable
            testID="open-articles-form"
            onPress={() => setOpen(true)}
            className="rounded-xl border border-red-700/50 px-3 py-2"
          >
            <Text className="text-sm text-red-300">File Articles</Text>
          </Pressable>
        ) : null}
      </View>

      {open ? (
        <ArticlesForm
          minLength={minLength}
          maxLength={maxLength}
          submitLabel="File Articles of Impeachment"
          busy={filing.isPending}
          error={error}
          onSubmit={(grounds, evidence) => filing.mutate({ grounds, evidence })}
          onCancel={() => {
            setOpen(false);
            setError(null);
          }}
        />
      ) : null}
    </View>
  );
}
