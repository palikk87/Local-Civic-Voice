import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  TextInput,
  Linking,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Search,
  Phone,
  Globe,
  Twitter,
  ChevronRight,
  ChevronDown,
  Check,
  Building2,
  Users,
  Landmark,
  Scale,
  Crown,
  X,
  ListOrdered,
  MapPin,
  AlertCircle,
  RefreshCw,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  fetchMembers,
  fetchOfficials,
  initials,
  sinceLabel,
  statesFromMembers,
  EXECUTIVE_GROUPS,
  type Chamber,
  type Member,
  type MemberListResponse,
  type Official,
  type OfficialsResponse,
  type Party,
} from '@/lib/government-service';
import { cn } from '@/lib/cn';
import { ordinal } from '@/lib/ordinal';

type Section = 'congress' | 'executive' | 'judicial' | 'leadership';

const SECTIONS: Array<{ key: Section; label: string; icon: typeof Landmark }> = [
  { key: 'congress', label: 'Congress', icon: Landmark },
  { key: 'executive', label: 'Executive', icon: Crown },
  { key: 'judicial', label: 'SCOTUS', icon: Scale },
  { key: 'leadership', label: 'Leadership', icon: ListOrdered },
];

const PARTY_STYLES: Record<Party, { bg: string; text: string; border: string }> = {
  D: { bg: 'bg-blue-900/50', text: 'text-blue-400', border: 'border-blue-700/50' },
  R: { bg: 'bg-red-900/50', text: 'text-red-400', border: 'border-red-700/50' },
  I: { bg: 'bg-purple-900/50', text: 'text-purple-400', border: 'border-purple-700/50' },
};

const NEUTRAL_STYLE = {
  bg: 'bg-slate-700/50',
  text: 'text-slate-300',
  border: 'border-slate-700/50',
};

/** Official portrait, falling back to initials when there's no photo on file. */
function Portrait({
  name,
  photoUrl,
  size = 64,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!photoUrl || failed) {
    return (
      <View
        className="items-center justify-center rounded-full bg-slate-700"
        style={{ width: size, height: size }}
      >
        <Text className="font-semibold text-slate-300" style={{ fontSize: size * 0.34 }}>
          {initials(name)}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: photoUrl }}
      onError={() => setFailed(true)}
      className="rounded-full bg-slate-700"
      style={{ width: size, height: size }}
    />
  );
}

function ContactRow({ person }: { person: Member | Official }) {
  const twitter = 'twitter' in person ? person.twitter : null;

  const buttons: Array<{ key: string; label: string; icon: typeof Phone; color: string; onPress: () => void }> = [];

  if (person.phone) {
    buttons.push({
      key: 'call',
      label: 'Call',
      icon: Phone,
      color: '#6E8A7C',
      onPress: () => Linking.openURL(`tel:${person.phone!.replace(/[^\d+]/g, '')}`),
    });
  }
  if (person.website) {
    buttons.push({
      key: 'site',
      label: 'Website',
      icon: Globe,
      color: '#6E8A7C',
      onPress: () => Linking.openURL(person.website!),
    });
  }
  if (twitter) {
    buttons.push({
      key: 'x',
      label: 'X',
      icon: Twitter,
      color: '#1DA1F2',
      onPress: () => Linking.openURL(`https://twitter.com/${twitter.replace('@', '')}`),
    });
  }

  if (buttons.length === 0) return null;

  return (
    <View className="mt-4 flex-row border-t border-slate-700/50 pt-4">
      {buttons.map((button) => (
        <Pressable
          key={button.key}
          onPress={button.onPress}
          className="mr-2 flex-row items-center rounded-lg bg-slate-700/50 px-3 py-2"
        >
          <button.icon size={14} color={button.color} />
          <Text className="ml-1.5 text-xs text-slate-300">{button.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function MemberCard({
  member,
  index,
  onPress,
}: {
  member: Member;
  index: number;
  onPress: (member: Member) => void;
}) {
  const colors = PARTY_STYLES[member.party];

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 12) * 40).springify()} className="mx-4 mb-3">
      <Pressable
        onPress={() => onPress(member)}
        className={cn('rounded-xl border bg-slate-800/70 p-4', colors.border)}
      >
        <View className="flex-row">
          <Portrait name={member.name} photoUrl={member.photoUrl} />
          <View className="ml-4 flex-1">
            <View className="mb-1 flex-row items-center">
              <Text className="flex-1 text-lg font-semibold text-white" numberOfLines={1}>
                {member.name}
              </Text>
              <View className={cn('ml-2 rounded-full px-2 py-0.5', colors.bg)}>
                <Text className={cn('text-xs font-medium', colors.text)}>{member.party}</Text>
              </View>
            </View>

            <Text className="mb-2 text-sm text-slate-400">{member.title}</Text>

            {member.leadershipRole ? (
              <View className="mb-2 self-start rounded-full bg-amber-500/20 px-2 py-1">
                <Text className="text-xs font-semibold text-amber-400">{member.leadershipRole}</Text>
              </View>
            ) : null}

            <View className="flex-row items-center">
              <View
                className={cn(
                  'mr-2 rounded-full px-2 py-1',
                  member.chamber === 'house' ? 'bg-blue-900/40' : 'bg-purple-900/40'
                )}
              >
                <Text
                  className={cn(
                    'text-xs font-medium',
                    member.chamber === 'house' ? 'text-blue-400' : 'text-purple-400'
                  )}
                >
                  {member.chamber === 'house' ? 'House' : 'Senate'}
                </Text>
              </View>
              <Text className="text-xs text-slate-500">{member.partyName}</Text>
            </View>
          </View>

          <View className="justify-center">
            <ChevronRight size={24} color="#6E8A7C" />
          </View>
        </View>

        <ContactRow person={member} />
      </Pressable>
    </Animated.View>
  );
}

function OfficialCard({
  official,
  index,
  onPress,
  rank,
}: {
  official: Official;
  index: number;
  onPress: (official: Official) => void;
  rank?: number | null;
}) {
  const colors = official.party ? PARTY_STYLES[official.party] : NEUTRAL_STYLE;

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 12) * 40).springify()} className="mx-4 mb-3">
      <Pressable
        onPress={() => onPress(official)}
        className={cn('rounded-xl border bg-slate-800/70 p-4', colors.border)}
      >
        <View className="flex-row">
          {rank ? (
            <View className="mr-3 h-8 w-8 items-center justify-center rounded-full bg-amber-500/20">
              <Text className="text-sm font-bold text-amber-400">{rank}</Text>
            </View>
          ) : null}

          <Portrait name={official.name} photoUrl={official.photoUrl} />

          <View className="ml-4 flex-1">
            <View className="mb-1 flex-row items-center">
              <Text className="flex-1 text-lg font-semibold text-white" numberOfLines={1}>
                {official.name}
              </Text>
              {official.party ? (
                <View className={cn('ml-2 rounded-full px-2 py-0.5', colors.bg)}>
                  <Text className={cn('text-xs font-medium', colors.text)}>{official.party}</Text>
                </View>
              ) : null}
            </View>

            <Text className="text-sm text-slate-400">{official.title}</Text>

            <View className="mt-2 flex-row flex-wrap items-center">
              {official.acting ? (
                <View className="mb-1 mr-2 rounded-full bg-amber-500/20 px-2 py-1">
                  <Text className="text-xs font-semibold text-amber-400">Acting</Text>
                </View>
              ) : null}
              {official.appointedBy ? (
                <Text className="mb-1 mr-2 text-xs text-slate-500">
                  Appointed by {official.appointedBy}
                </Text>
              ) : null}
              {official.since ? (
                <Text className="mb-1 text-xs text-slate-500">Since {sinceLabel(official.since)}</Text>
              ) : null}
            </View>
          </View>

          <View className="justify-center">
            <ChevronRight size={24} color="#6E8A7C" />
          </View>
        </View>

        <ContactRow person={official} />
      </Pressable>
    </Animated.View>
  );
}

function SectionHeading({ title, blurb, count }: { title: string; blurb?: string; count?: number }) {
  return (
    <View className="mx-4 mb-3 mt-5">
      <View className="flex-row items-center">
        <Text className="text-lg font-bold text-white">{title}</Text>
        {count !== undefined ? (
          <View className="ml-2 rounded-full bg-slate-800 px-2 py-0.5">
            <Text className="text-xs font-medium text-slate-400">{count}</Text>
          </View>
        ) : null}
      </View>
      {blurb ? <Text className="mt-0.5 text-xs text-slate-500">{blurb}</Text> : null}
    </View>
  );
}

/** Detail sheet — full record plus the "message your rep" form for members of Congress. */
function DetailSheet({
  person,
  onClose,
}: {
  person: Member | Official;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const isMember = 'chamber' in person;
  const colors = person.party ? PARTY_STYLES[person.party] : NEUTRAL_STYLE;

  const subtitle = isMember ? (person as Member).title : (person as Official).title;

  const sendEmail = () => {
    const site = person.website;
    if (!site) return;
    // Congressional offices take constituent mail through a web form rather than a
    // public inbox, so open their contact page with the drafted message copied out.
    Linking.openURL(site.endsWith('/') ? `${site}contact` : `${site}/contact`);
  };

  return (
    <View className="absolute inset-0 justify-end bg-black/80">
      <Pressable className="flex-1" onPress={onClose} />
      <View className="max-h-[85%] rounded-t-3xl bg-slate-900">
        <ScrollView contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={false}>
          <View className="mb-6 h-1 w-12 self-center rounded-full bg-slate-700" />

          <View className="mb-5 flex-row items-center">
            <Portrait name={person.name} photoUrl={person.photoUrl} size={64} />
            <View className="ml-4 flex-1">
              <Text className="text-lg font-semibold text-white">{person.name}</Text>
              <Text className="text-sm text-slate-400">{subtitle}</Text>
            </View>
            {person.party ? (
              <View className={cn('rounded-full px-2 py-1', colors.bg)}>
                <Text className={cn('text-sm font-medium', colors.text)}>{person.party}</Text>
              </View>
            ) : null}
            <Pressable onPress={onClose} className="ml-3 rounded-full bg-slate-800 p-2">
              <X size={18} color="#8FA79A" />
            </Pressable>
          </View>

          {/* Facts */}
          <View className="mb-5 rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            {isMember ? (
              <>
                <DetailRow label="Chamber" value={(person as Member).chamber === 'house' ? 'House of Representatives' : 'Senate'} />
                <DetailRow label="State" value={(person as Member).stateName} />
                {(person as Member).district !== null ? (
                  <DetailRow label="District" value={String((person as Member).district)} />
                ) : null}
                {(person as Member).leadershipRole ? (
                  <DetailRow label="Leadership" value={(person as Member).leadershipRole!} />
                ) : null}
                {(person as Member).servingSince ? (
                  <DetailRow label="Serving since" value={String((person as Member).servingSince)} />
                ) : null}
              </>
            ) : (
              <>
                <DetailRow label="Branch" value={capitalise((person as Official).branch)} />
                {(person as Official).acting ? <DetailRow label="Status" value="Acting" /> : null}
                {(person as Official).appointedBy ? (
                  <DetailRow label="Appointed by" value={(person as Official).appointedBy!} />
                ) : null}
                {(person as Official).since ? (
                  <DetailRow label="In office since" value={sinceLabel((person as Official).since)!} />
                ) : null}
                {(person as Official).successionOrder ? (
                  <DetailRow
                    label="Line of succession"
                    value={`#${(person as Official).successionOrder}`}
                  />
                ) : null}
              </>
            )}
            {person.phone ? <DetailRow label="Phone" value={person.phone} /> : null}
            {'office' in person && person.office ? (
              <DetailRow label="Office" value={person.office} />
            ) : null}
          </View>

          {!isMember && (person as Official).bio ? (
            <Text className="mb-5 text-sm leading-5 text-slate-400">{(person as Official).bio}</Text>
          ) : null}

          <ContactRow person={person} />

          {/* Constituent message — members of Congress only */}
          {isMember ? (
            <View className="mt-6">
              <Text className="mb-2 font-semibold text-white">Send a message</Text>
              <Text className="mb-4 text-sm text-slate-400">
                Let your representative know your thoughts on current legislation
              </Text>

              <TextInput
                placeholder="Write your message here..."
                placeholderTextColor="#6E8A7C"
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                className="mb-4 rounded-xl border border-slate-700 bg-slate-800 p-4 text-white"
                style={{ minHeight: 120 }}
              />

              <View className="flex-row">
                <Pressable onPress={onClose} className="mr-2 flex-1 rounded-xl bg-slate-800 py-4">
                  <Text className="text-center font-semibold text-slate-300">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={sendEmail}
                  disabled={!person.website}
                  className={cn(
                    'ml-2 flex-1 rounded-xl py-4',
                    person.website ? 'bg-amber-500' : 'bg-slate-800'
                  )}
                >
                  <Text
                    className={cn(
                      'text-center font-semibold',
                      person.website ? 'text-slate-900' : 'text-slate-500'
                    )}
                  >
                    Open contact form
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between border-b border-slate-700/30 py-2">
      <Text className="mr-4 text-sm text-slate-500">{label}</Text>
      <Text className="flex-1 text-right text-sm text-slate-300">{value}</Text>
    </View>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function FilterPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn('mr-2 rounded-full px-3.5 py-2', active ? 'bg-amber-500' : 'bg-slate-800')}
    >
      <Text className={cn('text-sm font-medium', active ? 'text-slate-900' : 'text-slate-300')}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function GovernmentScreen() {
  const [section, setSection] = useState<Section>('congress');
  const [searchQuery, setSearchQuery] = useState('');
  const [chamber, setChamber] = useState<Chamber | 'all'>('all');
  const [party, setParty] = useState<Party | 'all'>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [selected, setSelected] = useState<Member | Official | null>(null);

  const [congress, setCongress] = useState<MemberListResponse | null>(null);
  const [officials, setOfficials] = useState<OfficialsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [members, gov] = await Promise.all([fetchMembers(), fetchOfficials()]);
      setCongress(members);
      setOfficials(gov);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load government data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const members = congress?.representatives ?? [];
  const states = useMemo(() => statesFromMembers(members), [members]);
  const selectedStateLabel = useMemo(() => {
    if (stateFilter === 'all') return 'All states';
    const match = states.find((s) => s.code === stateFilter);
    return match ? `${match.name} (${match.code})` : stateFilter;
  }, [states, stateFilter]);

  // Filtering happens client-side so the chips respond instantly against the
  // already-loaded roster; the same filters exist server-side for direct API use.
  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return members.filter((m) => {
      if (chamber !== 'all' && m.chamber !== chamber) return false;
      if (party !== 'all' && m.party !== party) return false;
      if (stateFilter !== 'all' && m.state !== stateFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.stateName.toLowerCase().includes(q) ||
        m.state.toLowerCase() === q ||
        (m.leadershipRole?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [members, chamber, party, stateFilter, searchQuery]);

  const filteredOfficials = useCallback(
    (list: Official[]) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return list;
      return list.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.title.toLowerCase().includes(q) ||
          (o.bio?.toLowerCase().includes(q) ?? false)
      );
    },
    [searchQuery]
  );

  const searchPlaceholder =
    section === 'congress' ? 'Search by name, state or role...' : 'Search by name or title...';

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0C1D18', '#17362A', '#0C1D18']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="px-4 py-3">
          <Text className="text-2xl font-bold text-white">Government</Text>
          <Text className="mt-1 text-sm text-slate-400">
            Every federal official, across all three branches
          </Text>

          <View className="mt-4 flex-row items-center rounded-xl border border-slate-700/50 bg-slate-800 px-4 py-3">
            <Search size={20} color="#6E8A7C" />
            <TextInput
              placeholder={searchPlaceholder}
              placeholderTextColor="#6E8A7C"
              value={searchQuery}
              onChangeText={setSearchQuery}
              className="ml-3 flex-1 text-base text-white"
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <X size={18} color="#6E8A7C" />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Branch tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
        >
          {SECTIONS.map((item) => {
            const active = section === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setSection(item.key)}
                className={cn(
                  'mr-2 flex-row items-center rounded-xl px-4 py-2.5',
                  active ? 'bg-amber-500' : 'bg-slate-800'
                )}
              >
                <item.icon size={16} color={active ? '#0C1D18' : '#8FA79A'} />
                <Text
                  className={cn(
                    'ml-1.5 font-medium',
                    active ? 'text-slate-900' : 'text-slate-300'
                  )}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#F59E0B" />
            <Text className="mt-4 text-slate-400">Loading the federal government...</Text>
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center px-8">
            <AlertCircle size={48} color="#F59E0B" />
            <Text className="mt-4 text-center text-lg text-white">Couldn't load government data</Text>
            {/* NOT the raw error. That is whatever threw — on web the same
                branch printed TanStack Query's own
                `["congress-members"] data is undefined`, brackets and all, at
                a reader. An error a person cannot act on should say what they
                CAN do. Web twin: apps/web/src/pages/Government.tsx. */}
            <Text className="mt-1 text-center text-sm text-slate-400">
              The roster comes from congress.gov. If this keeps happening, the sync may
              not have run yet.
            </Text>
            <Pressable onPress={onRefresh} className="mt-5 rounded-xl bg-amber-500 px-5 py-3">
              <Text className="font-semibold text-slate-900">Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />
            }
          >
            {/* THE FRESHNESS STRIP THAT WAS HERE ANSWERED THE WRONG QUESTION.
                It reports on GovernmentReference — bills, executive orders,
                court cases — so on a screen headed "Every federal official" it
                announced a count of laws and quoted a BILL TITLE as "the most
                recent action we hold". Somebody looking up their senator was
                told about sanctions on the People's Republic of China.

                This screen is about people. The references strip moved to
                Discover, where the references are.

                What replaces it is the RIGHT question for this screen,
                answered from the roster this screen actually shows.
                Web twin: apps/web/src/pages/Government.tsx. */}
            {officials?.lastUpdated || congress ? (
              <View className="mx-4 mb-4 flex-row items-start">
                <View className="mt-0.5">
                  <RefreshCw size={13} color="#8FA79A" />
                </View>
                <Text className="ml-1.5 flex-1 text-xs text-slate-400">
                  {members.length > 0
                    ? `${members.length} members of Congress`
                    : 'Congress roster'}
                  {congress?.source === 'fallback' ? ' (cached snapshot)' : ''} from Congress.gov
                  {officials?.lastUpdated
                    ? ` · Executive and judicial checked ${new Date(officials.lastUpdated).toLocaleDateString()}`
                    : ''}
                </Text>
              </View>
            ) : null}

            {section === 'congress' ? (
              <>
                {/* Chamber counts */}
                <View className="mb-4 flex-row px-4">
                  <View className="mr-2 flex-1 rounded-xl border border-blue-800/30 bg-blue-900/30 p-3">
                    <View className="mb-1 flex-row items-center">
                      <Building2 size={16} color="#3B82F6" />
                      <Text className="ml-1.5 text-xs font-medium text-blue-400">House</Text>
                    </View>
                    <Text className="text-xl font-bold text-white">{congress?.counts?.house ?? 0}</Text>
                    <Text className="text-xs text-slate-400">Representatives</Text>
                  </View>
                  <View className="ml-2 flex-1 rounded-xl border border-purple-800/30 bg-purple-900/30 p-3">
                    <View className="mb-1 flex-row items-center">
                      <Users size={16} color="#8B5CF6" />
                      <Text className="ml-1.5 text-xs font-medium text-purple-400">Senate</Text>
                    </View>
                    <Text className="text-xl font-bold text-white">{congress?.counts?.senate ?? 0}</Text>
                    <Text className="text-xs text-slate-400">Senators</Text>
                  </View>
                </View>

                {/* Chamber + party filters */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10 }}
                >
                  <FilterPill label="All" active={chamber === 'all'} onPress={() => setChamber('all')} />
                  <FilterPill label="House" active={chamber === 'house'} onPress={() => setChamber('house')} />
                  <FilterPill label="Senate" active={chamber === 'senate'} onPress={() => setChamber('senate')} />
                  <View className="mx-1 w-px bg-slate-700" />
                  <FilterPill label="All parties" active={party === 'all'} onPress={() => setParty('all')} />
                  <FilterPill label="Democrat" active={party === 'D'} onPress={() => setParty('D')} />
                  <FilterPill label="Republican" active={party === 'R'} onPress={() => setParty('R')} />
                  <FilterPill label="Independent" active={party === 'I'} onPress={() => setParty('I')} />
                </ScrollView>

                {/* State filter — dropdown into a scrollable picker sheet */}
                <View className="mb-3 px-4">
                  <Pressable
                    onPress={() => setStatePickerOpen(true)}
                    className="min-h-[44px] flex-row items-center rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2.5"
                  >
                    <MapPin size={14} color="#6E8A7C" />
                    <Text className="ml-2 flex-1 text-sm text-white">{selectedStateLabel}</Text>
                    <ChevronDown size={16} color="#8FA79A" />
                  </Pressable>
                </View>

                <Text className="mb-2 px-4 text-xs text-slate-500">
                  {/* The congress number arrives with the roster, so until it
                      does this read "members of the th Congress". */}
                  Showing {filteredMembers.length} of {members.length} members
                  {congress?.congress ? ` of the ${ordinal(congress.congress)} Congress` : null}
                </Text>

                {filteredMembers.map((member, index) => (
                  <MemberCard key={member.id} member={member} index={index} onPress={setSelected} />
                ))}

                {filteredMembers.length === 0 ? <EmptyState /> : null}
              </>
            ) : null}

            {section === 'executive' && officials
              ? EXECUTIVE_GROUPS.map((group) => {
                  const list = filteredOfficials(
                    officials.executive.filter((o) => o.group === group.key)
                  );
                  if (list.length === 0) return null;
                  return (
                    <View key={group.key}>
                      <SectionHeading title={group.label} blurb={group.blurb} count={list.length} />
                      {list.map((official, index) => (
                        <OfficialCard
                          key={official.id}
                          official={official}
                          index={index}
                          onPress={setSelected}
                        />
                      ))}
                    </View>
                  );
                })
              : null}

            {section === 'judicial' && officials ? (
              <>
                <SectionHeading
                  title="Supreme Court of the United States"
                  blurb="Nine Justices, appointed for life. Chief Justice first, then Associate Justices by seniority."
                  count={officials.judicial.length}
                />
                {filteredOfficials(officials.judicial).map((justice, index) => (
                  <OfficialCard
                    key={justice.id}
                    official={justice}
                    index={index}
                    onPress={setSelected}
                  />
                ))}
                {filteredOfficials(officials.judicial).length === 0 ? <EmptyState /> : null}
              </>
            ) : null}

            {section === 'leadership' && officials ? (
              <>
                <SectionHeading
                  title="Congressional Leadership"
                  blurb="Members currently holding a leadership post"
                  count={officials.congressionalLeadership.length}
                />
                {filteredOfficials(officials.congressionalLeadership).map((leader, index) => (
                  <OfficialCard
                    key={`${leader.id}-lead`}
                    official={leader}
                    index={index}
                    onPress={setSelected}
                  />
                ))}

                <SectionHeading
                  title="Presidential Line of Succession"
                  blurb="Statutory order of offices. Officials serving in an acting capacity are not eligible to act as President."
                  count={officials.succession.length}
                />
                {filteredOfficials(officials.succession).map((person, index) => (
                  <OfficialCard
                    key={`${person.id}-succ`}
                    official={person}
                    index={index}
                    rank={person.successionOrder}
                    onPress={setSelected}
                  />
                ))}
              </>
            ) : null}

            {/* Provenance */}
            {congress ? (
              <Text className="mt-6 px-4 text-center text-xs text-slate-600">
                Congress roster from Congress.gov
                {congress.source === 'fallback' ? ' (cached snapshot)' : ''} · Executive and
                judicial data verified{' '}
                {officials ? new Date(officials.lastUpdated).toLocaleDateString() : ''}
              </Text>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>

      {statePickerOpen ? (
        <StatePickerSheet
          states={states}
          value={stateFilter}
          onSelect={(code) => {
            setStateFilter(code);
            setStatePickerOpen(false);
          }}
          onClose={() => setStatePickerOpen(false)}
        />
      ) : null}

      {selected ? <DetailSheet person={selected} onClose={() => setSelected(null)} /> : null}
    </View>
  );
}

/** Scrollable state picker — one row per state the roster covers, plus "All states". */
function StatePickerSheet({
  states,
  value,
  onSelect,
  onClose,
}: {
  states: Array<{ code: string; name: string }>;
  value: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  const options = [{ code: 'all', name: 'All states' }, ...states];

  return (
    <View className="absolute inset-0 justify-end bg-black/80">
      <Pressable className="flex-1" onPress={onClose} />
      <View className="max-h-[70%] rounded-t-3xl bg-slate-900">
        <View className="mt-3 h-1 w-12 self-center rounded-full bg-slate-700" />
        <View className="flex-row items-center justify-between px-6 py-4">
          <Text className="text-lg font-bold text-white">Filter by state</Text>
          <Pressable onPress={onClose} className="h-9 w-9 items-center justify-center rounded-full bg-slate-800">
            <X size={18} color="#8FA79A" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator>
          {options.map((option) => {
            const active = value === option.code;
            return (
              <Pressable
                key={option.code}
                onPress={() => onSelect(option.code)}
                className={cn(
                  'min-h-[48px] flex-row items-center border-t border-slate-800 px-6 py-3',
                  active ? 'bg-slate-800/60' : ''
                )}
              >
                <Text
                  className={cn(
                    'flex-1 text-base',
                    active ? 'font-semibold text-white' : 'text-slate-300'
                  )}
                >
                  {option.code === 'all' ? option.name : `${option.name} (${option.code})`}
                </Text>
                {active ? <Check size={18} color="#60A5FA" /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

function EmptyState() {
  return (
    <View className="items-center py-12">
      <Search size={48} color="#6E8A7C" />
      <Text className="mt-4 text-lg text-slate-400">No officials found</Text>
      <Text className="mt-1 text-sm text-slate-500">Try a different search or filter</Text>
    </View>
  );
}
