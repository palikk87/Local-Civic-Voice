/**
 * Export what the platform holds. Parity with the web screen.
 *
 * Was: three hardcoded "Recent Reports" with invented dates and statuses, and
 * four buttons that each raised "your report is being generated, you'll receive
 * an email when it's ready." No job, no file, no mailer.
 *
 * On a phone the file is fetched and handed to the system share sheet, so it
 * lands somewhere the person chooses — in front of them, or not at all.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ArrowLeft, Download, FileText, MapPin, ShieldCheck } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { BACKEND_URL } from '@/lib/config';
import { useB2BStore } from '@/lib/b2b-store';

const EXPORTS = [
  {
    key: 'records',
    path: '/api/b2b/reports/export.csv',
    title: 'All records',
    description:
      'One row per bill, order and ruling, with the vote counts held for it. No estimates.',
    icon: <FileText size={22} color="#818CF8" />,
  },
  {
    key: 'districts',
    path: '/api/b2b/reports/coverage.csv',
    title: 'By district',
    description:
      'One row per district where members have declared themselves. Districts below the privacy floor are listed with their voice count and no opinion.',
    icon: <MapPin size={22} color="#818CF8" />,
  },
];

export default function B2BReportsScreen() {
  const router = useRouter();
  const session = useB2BStore((s) => s.session);
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (item: (typeof EXPORTS)[number]) => {
    if (!session?.token) return;
    setBusy(item.key);
    try {
      const response = await fetch(`${BACKEND_URL}${item.path}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok) {
        Alert.alert('Not downloaded', 'That export did not come back. Nothing was saved.');
        return;
      }

      const csv = await response.text();
      const stamp = new Date().toISOString().slice(0, 10);

      // expo-file-system's File/Paths API. The older writeAsStringAsync +
      // cacheDirectory pair is gone in this version, and reaching for it is how
      // a screen typechecks against documentation rather than against the
      // installed package.
      const file = new File(Paths.cache, `ayeandnay-${item.key}-${stamp}.csv`);
      file.create({ overwrite: true });
      file.write(csv);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Saved', `Written to ${file.uri}`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Not downloaded', 'That export did not come back. Nothing was saved.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0F172A', '#1E1B4B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800/50">
          <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#94A3B8" />
          </TouchableOpacity>
          <View className="flex-1 ml-2">
            <Text className="text-white text-lg font-semibold">Exports</Text>
            <Text className="text-slate-400 text-sm">Nothing queued, nothing emailed</Text>
          </View>
        </View>

        <ScrollView className="flex-1 px-4 py-4">
          {EXPORTS.map((item) => (
            <View
              key={item.key}
              className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5 mb-3"
            >
              <View className="flex-row items-start">
                <View className="w-11 h-11 bg-indigo-500/20 rounded-xl items-center justify-center">
                  {item.icon}
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-white font-semibold">{item.title}</Text>
                  <Text className="text-slate-400 text-sm mt-1">{item.description}</Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => download(item)}
                disabled={busy !== null}
                className={`bg-indigo-600 rounded-lg py-3 mt-4 flex-row items-center justify-center ${
                  busy !== null ? 'opacity-60' : ''
                }`}
              >
                {busy === item.key ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Download size={16} color="white" />
                    <Text className="text-white font-medium ml-2">Download CSV</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ))}

          <View className="flex-row items-start bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 mt-2 mb-8">
            <ShieldCheck size={16} color="#34D399" />
            <Text className="text-slate-300 text-sm ml-2 flex-1">
              Exports contain aggregate counts only. No file names a member, and no district appears
              with an opinion attached unless enough people there have voted that no one of them can
              be singled out.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
