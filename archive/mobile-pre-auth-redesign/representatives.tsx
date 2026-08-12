import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  TextInput,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Search,
  MapPin,
  Phone,
  Mail,
  Globe,
  Twitter,
  ChevronRight,
  Building2,
  Users,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { mockRepresentatives } from '@/lib/mock-data';
import type { Representative } from '@/lib/types';
import { cn } from '@/lib/cn';

function RepresentativeCard({
  rep,
  index,
  onContact,
}: {
  rep: Representative;
  index: number;
  onContact: (rep: Representative) => void;
}) {
  const partyColors = {
    D: { bg: 'bg-blue-900/50', text: 'text-blue-400', border: 'border-blue-700/50' },
    R: { bg: 'bg-red-900/50', text: 'text-red-400', border: 'border-red-700/50' },
    I: { bg: 'bg-purple-900/50', text: 'text-purple-400', border: 'border-purple-700/50' },
  };

  const partyNames = { D: 'Democrat', R: 'Republican', I: 'Independent' };
  const colors = partyColors[rep.party];

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 80).springify()}
      className="mx-4 mb-3"
    >
      <Pressable
        onPress={() => onContact(rep)}
        className={cn(
          'bg-slate-800/70 rounded-xl p-4 border',
          colors.border
        )}
      >
        <View className="flex-row">
          <Image
            source={{ uri: rep.imageUrl }}
            className="w-16 h-16 rounded-full"
          />
          <View className="flex-1 ml-4">
            <View className="flex-row items-center mb-1">
              <Text className="text-white font-semibold text-lg">{rep.name}</Text>
              <View className={cn('px-2 py-0.5 rounded-full ml-2', colors.bg)}>
                <Text className={cn('text-xs font-medium', colors.text)}>
                  {rep.party}
                </Text>
              </View>
            </View>

            <Text className="text-slate-400 text-sm mb-2">
              {rep.chamber === 'house' ? 'Representative' : 'Senator'} -{' '}
              {rep.state}
              {rep.district ? ` District ${rep.district}` : ''}
            </Text>

            <View className="flex-row items-center">
              <View
                className={cn(
                  'px-2 py-1 rounded-full mr-2',
                  rep.chamber === 'house' ? 'bg-blue-900/40' : 'bg-purple-900/40'
                )}
              >
                <Text
                  className={cn(
                    'text-xs font-medium',
                    rep.chamber === 'house' ? 'text-blue-400' : 'text-purple-400'
                  )}
                >
                  {rep.chamber === 'house' ? 'House' : 'Senate'}
                </Text>
              </View>
              <Text className="text-slate-500 text-xs">
                {partyNames[rep.party]}
              </Text>
            </View>
          </View>

          <View className="justify-center">
            <ChevronRight size={24} color="#64748B" />
          </View>
        </View>

        {/* Quick Contact Buttons */}
        <View className="flex-row mt-4 pt-4 border-t border-slate-700/50">
          {rep.contactPhone && (
            <Pressable
              onPress={() => Linking.openURL(`tel:${rep.contactPhone}`)}
              className="flex-row items-center bg-slate-700/50 px-3 py-2 rounded-lg mr-2"
            >
              <Phone size={14} color="#64748B" />
              <Text className="text-slate-300 text-xs ml-1.5">Call</Text>
            </Pressable>
          )}
          {rep.contactEmail && (
            <Pressable
              onPress={() => Linking.openURL(`mailto:${rep.contactEmail}`)}
              className="flex-row items-center bg-slate-700/50 px-3 py-2 rounded-lg mr-2"
            >
              <Mail size={14} color="#64748B" />
              <Text className="text-slate-300 text-xs ml-1.5">Email</Text>
            </Pressable>
          )}
          {rep.website && (
            <Pressable
              onPress={() => Linking.openURL(rep.website!)}
              className="flex-row items-center bg-slate-700/50 px-3 py-2 rounded-lg mr-2"
            >
              <Globe size={14} color="#64748B" />
              <Text className="text-slate-300 text-xs ml-1.5">Website</Text>
            </Pressable>
          )}
          {rep.socialMedia?.twitter && (
            <Pressable
              onPress={() =>
                Linking.openURL(
                  `https://twitter.com/${rep.socialMedia!.twitter!.replace('@', '')}`
                )
              }
              className="flex-row items-center bg-slate-700/50 px-3 py-2 rounded-lg"
            >
              <Twitter size={14} color="#1DA1F2" />
              <Text className="text-slate-300 text-xs ml-1.5">X</Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function ContactModal({
  rep,
  onClose,
}: {
  rep: Representative;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');

  const partyColors = {
    D: { bg: 'bg-blue-900/50', text: 'text-blue-400' },
    R: { bg: 'bg-red-900/50', text: 'text-red-400' },
    I: { bg: 'bg-purple-900/50', text: 'text-purple-400' },
  };
  const colors = partyColors[rep.party];

  const sendEmail = () => {
    if (rep.contactEmail) {
      const subject = encodeURIComponent('Message from a Constituent');
      const body = encodeURIComponent(message);
      Linking.openURL(`mailto:${rep.contactEmail}?subject=${subject}&body=${body}`);
    }
  };

  return (
    <View className="absolute inset-0 bg-black/80 justify-end">
      <View className="bg-slate-900 rounded-t-3xl p-6">
        <View className="w-12 h-1 bg-slate-700 rounded-full self-center mb-6" />

        <View className="flex-row items-center mb-6">
          <Image
            source={{ uri: rep.imageUrl }}
            className="w-14 h-14 rounded-full"
          />
          <View className="ml-4 flex-1">
            <Text className="text-white font-semibold text-lg">{rep.name}</Text>
            <Text className="text-slate-400 text-sm">
              {rep.chamber === 'house' ? 'Representative' : 'Senator'} - {rep.state}
            </Text>
          </View>
          <View className={cn('px-2 py-1 rounded-full', colors.bg)}>
            <Text className={cn('text-sm font-medium', colors.text)}>
              {rep.party}
            </Text>
          </View>
        </View>

        <Text className="text-white font-semibold mb-2">Send a message</Text>
        <Text className="text-slate-400 text-sm mb-4">
          Let your representative know your thoughts on current legislation
        </Text>

        <TextInput
          placeholder="Write your message here..."
          placeholderTextColor="#64748B"
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          className="bg-slate-800 rounded-xl p-4 text-white border border-slate-700 mb-4"
          style={{ minHeight: 120 }}
        />

        <View className="flex-row">
          <Pressable
            onPress={onClose}
            className="flex-1 bg-slate-800 py-4 rounded-xl mr-2"
          >
            <Text className="text-slate-300 font-semibold text-center">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={sendEmail}
            className="flex-1 bg-amber-500 py-4 rounded-xl ml-2"
          >
            <Text className="text-slate-900 font-semibold text-center">
              Send Email
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function RepresentativesScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChamber, setSelectedChamber] = useState<'all' | 'house' | 'senate'>(
    'all'
  );
  const [selectedRep, setSelectedRep] = useState<Representative | null>(null);

  const filteredReps = mockRepresentatives.filter((rep) => {
    if (selectedChamber !== 'all' && rep.chamber !== selectedChamber) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        rep.name.toLowerCase().includes(query) ||
        rep.state.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const houseReps = mockRepresentatives.filter((r) => r.chamber === 'house');
  const senateReps = mockRepresentatives.filter((r) => r.chamber === 'senate');

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="px-4 py-3">
          <Text className="text-2xl font-bold text-white">Representatives</Text>
          <Text className="text-slate-400 text-sm mt-1">
            Contact your elected officials
          </Text>

          {/* Search Bar */}
          <View className="flex-row items-center bg-slate-800 rounded-xl px-4 py-3 border border-slate-700/50 mt-4">
            <Search size={20} color="#64748B" />
            <TextInput
              placeholder="Search by name or state..."
              placeholderTextColor="#64748B"
              value={searchQuery}
              onChangeText={setSearchQuery}
              className="flex-1 text-white ml-3 text-base"
            />
          </View>
        </View>

        {/* Stats */}
        <View className="flex-row px-4 mb-4">
          <View className="flex-1 bg-blue-900/30 rounded-xl p-3 mr-2 border border-blue-800/30">
            <View className="flex-row items-center mb-1">
              <Building2 size={16} color="#3B82F6" />
              <Text className="text-blue-400 text-xs ml-1.5 font-medium">House</Text>
            </View>
            <Text className="text-white font-bold text-xl">{houseReps.length}</Text>
            <Text className="text-slate-400 text-xs">Representatives</Text>
          </View>
          <View className="flex-1 bg-purple-900/30 rounded-xl p-3 ml-2 border border-purple-800/30">
            <View className="flex-row items-center mb-1">
              <Users size={16} color="#8B5CF6" />
              <Text className="text-purple-400 text-xs ml-1.5 font-medium">Senate</Text>
            </View>
            <Text className="text-white font-bold text-xl">{senateReps.length}</Text>
            <Text className="text-slate-400 text-xs">Senators</Text>
          </View>
        </View>

        {/* Chamber Filter */}
        <View className="flex-row px-4 mb-4">
          {(['all', 'house', 'senate'] as const).map((chamber) => (
            <Pressable
              key={chamber}
              onPress={() => setSelectedChamber(chamber)}
              className={cn(
                'flex-1 py-2.5 rounded-xl mr-2',
                selectedChamber === chamber ? 'bg-amber-500' : 'bg-slate-800'
              )}
            >
              <Text
                className={cn(
                  'text-center font-medium',
                  selectedChamber === chamber ? 'text-slate-900' : 'text-slate-300'
                )}
              >
                {chamber === 'all' ? 'All' : chamber === 'house' ? 'House' : 'Senate'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Representatives List */}
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
        >
          {filteredReps.map((rep, index) => (
            <RepresentativeCard
              key={rep.id}
              rep={rep}
              index={index}
              onContact={setSelectedRep}
            />
          ))}

          {filteredReps.length === 0 && (
            <View className="items-center py-12">
              <Search size={48} color="#64748B" />
              <Text className="text-slate-400 text-lg mt-4">
                No representatives found
              </Text>
              <Text className="text-slate-500 text-sm mt-1">
                Try a different search
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Contact Modal */}
      {selectedRep && (
        <ContactModal rep={selectedRep} onClose={() => setSelectedRep(null)} />
      )}
    </View>
  );
}
