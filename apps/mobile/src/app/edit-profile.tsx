// Change your own name, handle, bio, location and picture.
// Web twin: apps/web/src/components/profile/EditProfileDialog.tsx
//
// The endpoint for this has existed since the beginning and nothing but the
// signup form ever called it, so an account was whatever it was on the day it
// was made — permanently. On a platform that asks people to put their name to
// public positions on legislation, not being able to correct that name is not
// a missing nicety.
//
// WHAT IS NOT EDITABLE FROM HERE: anything that would rewrite the record.
// Positions, posts and votes are what somebody said in public and stay as they
// were said. Changing your display name does not change what you backed.
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Camera } from 'lucide-react-native';

import { api, uploadMedia } from '@/lib/api/api';
import { AuthGate } from '@/components/auth/AuthGate';
import { DistrictPicker } from '@/components/civic/DistrictPicker';
import { useCurrentUser } from '@/lib/auth/use-civic-auth';

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  multiline,
  hint,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  hint?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  return (
    <View className="mb-4">
      <Text className="text-slate-400 text-sm mb-1.5">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#475569"
        maxLength={maxLength}
        multiline={multiline}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={autoCapitalize !== 'none'}
        className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white"
        style={multiline ? { minHeight: 88, textAlignVertical: 'top' } : undefined}
      />
      {hint ? <Text className="text-slate-500 text-xs mt-1">{hint}</Text> : null}
    </View>
  );
}

function EditProfileContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  const startingName = user?.name ?? '';
  const startingUsername = user?.username ?? '';
  const startingBio = user?.bio ?? '';
  const startingLocation = user?.location ?? '';
  const startingAvatar =
    user?.image || `https://api.dicebear.com/7.x/avataaars/png?seed=${user?.id ?? 'anon'}`;

  const [name, setName] = useState(startingName);
  const [username, setUsername] = useState(startingUsername);
  const [bio, setBio] = useState(startingBio);
  const [location, setLocation] = useState(startingLocation);
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function pickAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photo access is off', 'Turn it on in Settings to change your picture.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (picked.canceled || picked.assets.length === 0) return;

    const asset = picked.assets[0]!;
    const filename = asset.uri.split('/').pop() ?? 'avatar.jpg';
    const match = /\.(\w+)$/.exec(filename);

    setUploading(true);
    try {
      const stored = await uploadMedia({
        uri: asset.uri,
        name: filename,
        type: `image/${match?.[1] ?? 'jpeg'}`,
      });
      setImage(stored.url);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // A failed upload is a failed upload. Showing the local file as if it
      // had been stored would put a picture on the profile that only this
      // handset can load.
      Alert.alert("Couldn't upload that picture");
    } finally {
      setUploading(false);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      // Only what actually changed. Sending every field back would rewrite a
      // username to itself and trip the uniqueness check on the way past.
      const changes: Record<string, string> = {};
      if (name.trim() && name.trim() !== startingName) changes.name = name.trim();
      if (username.trim() && username.trim() !== startingUsername) {
        changes.username = username.trim().toLowerCase();
      }
      if (bio !== startingBio) changes.bio = bio;
      if (location !== startingLocation) changes.location = location;
      if (image) changes.image = image;

      if (Object.keys(changes).length === 0) return Promise.resolve(null);
      return api.patch('/api/users/me', changes);
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      router.back();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      Alert.alert(message.includes('taken') ? 'That username is taken' : "Couldn't save that");
    },
  });

  const preview = image ?? startingAvatar;

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable onPress={() => router.back()} className="flex-row items-center">
          <ArrowLeft size={22} color="#F8FAFC" />
          <Text className="text-white text-lg font-semibold ml-2">Edit profile</Text>
        </Pressable>

        <Pressable
          disabled={save.isPending || uploading}
          onPress={() => save.mutate()}
          className="bg-amber-500 rounded-full px-4 py-2"
          style={{ opacity: save.isPending || uploading ? 0.5 : 1 }}
        >
          <Text className="text-slate-900 font-semibold">
            {save.isPending ? 'Saving…' : 'Save'}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          <View className="items-center mb-6">
            <Pressable onPress={pickAvatar} className="relative">
              <Image
                source={{ uri: preview }}
                className="w-24 h-24 rounded-full border-2 border-amber-500/30"
              />
              <View className="absolute bottom-0 right-0 bg-amber-500 w-8 h-8 rounded-full items-center justify-center border-2 border-slate-900">
                {uploading ? (
                  <ActivityIndicator size="small" color="#0F172A" />
                ) : (
                  <Camera size={16} color="#0F172A" />
                )}
              </View>
            </Pressable>
            <Text className="text-slate-500 text-xs mt-2 text-center px-8">
              A picture is optional. Nothing here is verified as your likeness.
            </Text>
          </View>

          <Field label="Name" value={name} onChangeText={setName} maxLength={100} />
          <Field
            label="Username"
            value={username}
            onChangeText={setUsername}
            maxLength={30}
            autoCapitalize="none"
            hint="Lowercase letters, numbers and underscores."
          />
          <Field
            label="Bio"
            value={bio}
            onChangeText={setBio}
            maxLength={500}
            multiline
            placeholder="What you follow, and why."
          />
          <Field label="Location" value={location} onChangeText={setLocation} maxLength={100} />
          {/* Free text, shown on the profile card, parsed by nothing. The
              structured jurisdiction below is a separate question with a
              separate answer — "Brooklyn, NY" cannot be counted and NY-8 can. */}
          <Text className="text-slate-500 text-xs mb-4 -mt-2">
            Shown on your profile. Not used to place your vote.
          </Text>

          {/* Saves on its own, immediately — it is a right rather than a form
              field, and taking it back must not be queued behind a Save. */}
          <View className="border-t border-slate-800 pt-4 mt-2">
            <DistrictPicker />
          </View>

          <Text className="text-slate-500 text-xs mt-2">
            Your positions and posts stay exactly as you made them.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function EditProfileScreen() {
  return (
    <AuthGate capability="viewProfile" reason="Sign in to edit your profile.">
      <EditProfileContent />
    </AuthGate>
  );
}
