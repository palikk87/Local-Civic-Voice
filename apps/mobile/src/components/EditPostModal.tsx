/**
 * YOUR OWN WORDS, CHANGED.
 *
 * Web twin: apps/web/src/components/feed/EditPostDialog.tsx.
 *
 * Reported plainly: "The edit post button doesn't go anywhere ... It should
 * allow you to edit your post and its content. Not the original law posted but
 * the content that the poster added to it."
 *
 * THE LAW IS SHOWN AND NOT EDITABLE, which is the whole distinction in that
 * report. A post is somebody's words ABOUT a record, and the record is what
 * everybody replying, voting and passing it on is responding to. So the law
 * card sits here plainly, above a box that holds only the words — you can see
 * exactly what you are keeping while you change what is yours.
 */
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { AttachedLawCard } from '@/components/AttachedLawCard';
import { useTimelineStore, type TimelinePost } from '@/lib/timeline-store';

export function EditPostModal({
  post,
  onClose,
}: {
  post: TimelinePost | null;
  onClose: () => void;
}) {
  const editPost = useTimelineStore((s) => s.editPost);
  const [words, setWords] = useState('');
  const [saving, setSaving] = useState(false);

  // Reopening on a different post must not show the last one's words.
  useEffect(() => {
    if (post) setWords(post.opinion ?? post.content ?? '');
  }, [post]);

  if (!post) return null;

  const lawId = post.sharedContent?.id;
  const carriesSomethingElse = Boolean(lawId) || (post.media?.length ?? 0) > 0;
  const canSave = !saving && (words.trim().length > 0 || carriesSomethingElse);

  const save = async () => {
    setSaving(true);
    try {
      await editPost(post.id, words);
      onClose();
    } catch {
      Alert.alert('Not saved', 'Could not save your changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView edges={['bottom']} className="bg-slate-900 rounded-t-3xl max-h-[90%]">
            <View className="flex-row items-center justify-between px-4 pt-4 pb-2 border-b border-slate-800">
              <Text className="text-white text-lg font-semibold">Edit your post</Text>
              <Pressable onPress={onClose} hitSlop={8} className="p-1">
                <X size={20} color="#94A3B8" />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              <Text className="text-slate-400 text-sm px-4 pt-3">
                {lawId
                  ? 'The law stays as it is. These are your words about it.'
                  : 'Change what you wrote.'}
              </Text>

              {/* The law, shown and fixed. There is deliberately no way to
                  detach it here: everybody who replied did so to a post about
                  THIS record. */}
              {lawId ? (
                <AttachedLawCard
                  referenceId={lawId}
                  fallbackTitle={post.sharedContent?.title ?? 'This law'}
                  fallbackIdentifier={post.sharedContent?.displayId ?? null}
                />
              ) : null}

              <TextInput
                value={words}
                onChangeText={setWords}
                multiline
                maxLength={5000}
                placeholder={
                  carriesSomethingElse ? 'Say something about it (optional)' : 'Your words'
                }
                placeholderTextColor="#6E8A7C"
                textAlignVertical="top"
                className="mx-4 mt-4 p-3 bg-slate-800/60 border border-slate-700/50 rounded-xl text-white text-base"
                style={{ minHeight: 120 }}
              />

              <View className="flex-row justify-end px-4 mt-4">
                <Pressable onPress={onClose} disabled={saving} className="px-4 py-3 mr-2">
                  <Text className="text-slate-400 font-medium">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={save}
                  disabled={!canSave}
                  className={
                    canSave
                      ? 'px-5 py-3 rounded-xl bg-amber-500'
                      : 'px-5 py-3 rounded-xl bg-slate-700'
                  }
                >
                  <Text className={canSave ? 'text-slate-900 font-bold' : 'text-slate-500 font-bold'}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
