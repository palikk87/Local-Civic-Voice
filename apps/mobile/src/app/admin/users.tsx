import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  SafeAreaView,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Search,
  Filter,
  UserX,
  UserCheck,
  Shield,
  Trash2,
  Briefcase,
  MoreVertical,
  X,
  Ban,
  Crown,
  User,
} from 'lucide-react-native';
import { Image } from 'expo-image';
import { adminCan, useAdminStore, ManagedUser } from '@/lib/admin-store';
import * as Haptics from 'expo-haptics';

interface UserCardProps {
  user: ManagedUser;
  onBan: () => void;
  onUnban: () => void;
  onDelete: () => void;
  onMakeAdmin: () => void;
  onGiveBusinessAccount: () => void;
  /**
   * What the signed-in role may do, as the server sees it — NOT what the role
   * is called. This was a single owner-or-nothing boolean, so an owner could
   * build a role, grant it "users.delete", and that role would still be shown
   * no delete action. Web twin: apps/web/src/components/admin/UsersTab.tsx.
   */
  can: {
    ban: boolean;
    assignRole: boolean;
    manageB2B: boolean;
    delete: boolean;
  };
}

function UserCard({
  user,
  onBan,
  onUnban,
  onDelete,
  onMakeAdmin,
  onGiveBusinessAccount,
  can,
}: UserCardProps) {
  const [showMenu, setShowMenu] = useState(false);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500';
      case 'banned':
        return 'bg-red-500';
      case 'suspended':
        return 'bg-orange-500';
      default:
        return 'bg-slate-500';
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'superadmin':
        return { color: 'bg-purple-500/20 border-purple-500/50', text: 'text-purple-400', label: 'Super Admin' };
      case 'admin':
        return { color: 'bg-amber-500/20 border-amber-500/50', text: 'text-amber-400', label: 'Admin' };
      case 'moderator':
        return { color: 'bg-blue-500/20 border-blue-500/50', text: 'text-blue-400', label: 'Moderator' };
      default:
        return null;
    }
  };

  const roleBadge = getRoleBadge(user.role);

  return (
    <View className="bg-slate-800/50 rounded-2xl p-4 mb-3">
      <View className="flex-row items-start">
        {/* Avatar */}
        <View className="relative">
          <Image
            source={{ uri: user.avatar }}
            className="w-14 h-14 rounded-full bg-slate-700"
          />
          <View className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-slate-800 ${getStatusColor(user.status)}`} />
        </View>

        {/* User Info */}
        <View className="flex-1 ml-3">
          <View className="flex-row items-center">
            <Text className="text-white font-semibold text-base">{user.displayName}</Text>
            {roleBadge && (
              <View className={`ml-2 px-2 py-0.5 rounded-full border ${roleBadge.color}`}>
                <Text className={`text-xs font-medium ${roleBadge.text}`}>{roleBadge.label}</Text>
              </View>
            )}
          </View>
          <Text className="text-slate-400 text-sm">@{user.username}</Text>
          <Text className="text-slate-500 text-xs mt-1">{user.email}</Text>

          {/* Stats Row */}
          <View className="flex-row mt-2 gap-4">
            <Text className="text-slate-400 text-xs">
              <Text className="text-white font-medium">{user.followers}</Text> followers
            </Text>
            <Text className="text-slate-400 text-xs">
              <Text className="text-white font-medium">{user.votesCount}</Text> votes
            </Text>
            <Text className="text-slate-400 text-xs">
              <Text className="text-white font-medium">{user.postsCount}</Text> posts
            </Text>
          </View>

          {/* Ban Info */}
          {user.status === 'banned' && user.banReason && (
            <View className="mt-2 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
              <Text className="text-red-400 text-xs">Ban reason: {user.banReason}</Text>
              {user.banExpiresAt && (
                <Text className="text-red-300 text-xs mt-1">
                  Expires: {new Date(user.banExpiresAt).toLocaleDateString()}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Menu Button */}
        <TouchableOpacity
          onPress={() => setShowMenu(true)}
          className="p-2 bg-slate-700/50 rounded-lg"
        >
          <MoreVertical size={18} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {/* Action Menu Modal */}
      <Modal
        visible={showMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setShowMenu(false)}
        >
          <View className="bg-slate-800 max-h-[85%] rounded-t-3xl p-4">
            <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-4" />
            <Text className="text-white text-lg font-bold mb-4">Actions for @{user.username}</Text>

            {can.ban ? (
              user.status === 'banned' ? (
                <TouchableOpacity
                  onPress={() => {
                    setShowMenu(false);
                    onUnban();
                  }}
                  className="flex-row items-center p-4 bg-green-500/20 rounded-xl mb-3"
                >
                  <UserCheck size={20} color="#22C55E" />
                  <Text className="text-green-400 font-medium ml-3">Unban User</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    setShowMenu(false);
                    onBan();
                  }}
                  className="flex-row items-center p-4 bg-red-500/20 rounded-xl mb-3"
                >
                  <Ban size={20} color="#EF4444" />
                  <Text className="text-red-400 font-medium ml-3">Ban User</Text>
                </TouchableOpacity>
              )
            ) : null}

            {can.assignRole && (
              <TouchableOpacity
                onPress={() => {
                  setShowMenu(false);
                  onMakeAdmin();
                }}
                className="flex-row items-center p-4 bg-amber-500/20 rounded-xl mb-3"
              >
                <Crown size={20} color="#F59E0B" />
                {/* "Grant Admin Privileges" only appeared for accounts whose
                    role was still "user", so an administrator could be given a
                    role once and never moved again — no demotion, no swap to
                    another role, no way back to plain "user" from this screen.
                    Roles are a picker now, so this offers the picker for
                    anybody. */}
                <Text className="text-amber-400 font-medium ml-3">Change role</Text>
              </TouchableOpacity>
            )}

            {/* ADDS an account, never replaces one. Their citizen login,
                votes, posts and role are untouched — the Public Pulse is a
                count of citizens, and reclassifying one would corrupt the only
                number this platform exists to report. The wording says so
                because a menu item called "Convert" would imply otherwise. */}
            {can.manageB2B && (
              <TouchableOpacity
                onPress={() => {
                  setShowMenu(false);
                  onGiveBusinessAccount();
                }}
                className="flex-row items-center p-4 bg-indigo-500/20 rounded-xl mb-3"
              >
                <Briefcase size={20} color="#818CF8" />
                <Text className="text-indigo-300 font-medium ml-3">Add a business account</Text>
              </TouchableOpacity>
            )}

            {can.delete && (
              <TouchableOpacity
                onPress={() => {
                  setShowMenu(false);
                  onDelete();
                }}
                className="flex-row items-center p-4 bg-red-500/20 rounded-xl mb-3"
              >
                <Trash2 size={20} color="#EF4444" />
                <Text className="text-red-400 font-medium ml-3">Delete User</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => setShowMenu(false)}
              className="flex-row items-center justify-center p-4 bg-slate-700 rounded-xl mt-2"
            >
              <X size={20} color="#94A3B8" />
              <Text className="text-slate-300 font-medium ml-2">Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [banModalUser, setBanModalUser] = useState<ManagedUser | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState('');
  const [adminRoleModal, setAdminRoleModal] = useState<ManagedUser | null>(null);
  /**
   * The roles this deployment actually has.
   *
   * Two hardcoded buttons — "Moderator" and "Admin", with hardcoded
   * descriptions of what each could do — is what was here, and both were wrong
   * twice over: the endpoint behind them did not exist, and what a role may do
   * is now configurable, so a description baked into a button would go stale
   * the first time somebody edited one.
   */
  const [roles, setRoles] = useState<{ slug: string; name: string }[]>([]);

  const session = useAdminStore((s) => s.session);
  const users = useAdminStore((s) => s.users);
  const isLoading = useAdminStore((s) => s.isLoading);
  const fetchUsers = useAdminStore((s) => s.fetchUsers);
  const banUser = useAdminStore((s) => s.banUser);
  const unbanUser = useAdminStore((s) => s.unbanUser);
  const deleteUser = useAdminStore((s) => s.deleteUser);
  const assignRole = useAdminStore((s) => s.assignRole);
  const fetchRoles = useAdminStore((s) => s.fetchRoles);
  const giveBusinessAccount = useAdminStore((s) => s.giveBusinessAccount);

  const can = {
    ban: adminCan(session, 'users.ban'),
    assignRole: adminCan(session, 'users.assignRole'),
    manageB2B: adminCan(session, 'b2b.manage'),
    delete: adminCan(session, 'users.delete'),
  };

  useEffect(() => {
    loadUsers();
  }, [statusFilter]);

  const loadUsers = useCallback(async () => {
    await fetchUsers({
      search: search || undefined,
      status: statusFilter || undefined,
    });
  }, [search, statusFilter, fetchUsers]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUsers();
    setRefreshing(false);
  };

  const handleSearch = () => {
    loadUsers();
  };

  const handleBan = async () => {
    if (!banModalUser || !banReason.trim()) {
      Alert.alert('Error', 'Please provide a ban reason');
      return;
    }

    const duration = banDuration ? parseInt(banDuration) : undefined;
    const result = await banUser(banModalUser.id, banReason.trim(), duration);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBanModalUser(null);
      setBanReason('');
      setBanDuration('');
    } else {
      Alert.alert('Error', result.error || 'Failed to ban user');
    }
  };

  const handleUnban = async (user: ManagedUser) => {
    Alert.alert(
      'Unban User',
      `Are you sure you want to unban @${user.username}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unban',
          onPress: async () => {
            const result = await unbanUser(user.id);
            if (result.success) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else {
              Alert.alert('Error', result.error || 'Failed to unban user');
            }
          },
        },
      ]
    );
  };

  /**
   * Add a business login for somebody who already has an account.
   *
   * Two prompts rather than a form, because this screen has no room for one and
   * the defaults are almost always right: their own username becomes the
   * business login, and the tier is the thing anyone actually chooses. The
   * credentials come back once and are shown in an alert that has to be
   * dismissed — a toast would carry an unrecoverable secret away with it.
   */
  const handleGiveBusinessAccount = (user: ManagedUser) => {
    Alert.alert(
      'Add a business account',
      `This gives @${user.username} a separate login for the analytics portal. Their citizen ` +
        'account is untouched — same password, same votes, same posts, same role.\n\nWhich tier?',
      [
        { text: 'Cancel', style: 'cancel' },
        ...(['basic', 'professional', 'enterprise'] as const).map((tier) => ({
          text: tier,
          onPress: async () => {
            const result = await giveBusinessAccount(user.id, { type: 'research', tier });
            if (result.success && result.credentials) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert(
                'Copy these now',
                `username: ${result.credentials.username}\n` +
                  `password: ${result.credentials.password}\n` +
                  `api key: ${result.credentials.apiKey}\n\n` +
                  'Stored hashed. They cannot be shown again — only rotated.',
              );
            } else {
              Alert.alert('Error', result.error || 'Could not create the business account');
            }
          },
        })),
      ],
    );
  };

  const handleDelete = async (user: ManagedUser) => {
    Alert.alert(
      'Delete User',
      `Are you sure you want to permanently delete @${user.username}? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await deleteUser(user.id);
            if (result.success) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else {
              Alert.alert('Error', result.error || 'Failed to delete user');
            }
          },
        },
      ]
    );
  };

  const handleAssignRole = async (role: string) => {
    if (!adminRoleModal) return;

    const result = await assignRole(adminRoleModal.id, role);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdminRoleModal(null);
    } else {
      Alert.alert('Error', result.error || 'Could not change the role');
    }
  };

  const statusFilters = [
    { key: null, label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'banned', label: 'Banned' },
    { key: 'suspended', label: 'Suspended' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold ml-2">User Management</Text>
        <View className="flex-1" />
        <View className="bg-slate-800 px-3 py-1 rounded-full">
          <Text className="text-slate-400 text-sm">{users.length} users</Text>
        </View>
      </View>

      {/* Search Bar */}
      <View className="px-4 py-3">
        <View className="flex-row items-center bg-slate-800 rounded-xl px-4 py-2">
          <Search size={20} color="#64748B" />
          <TextInput
            className="flex-1 text-white ml-3 py-2"
            placeholder="Search users..."
            placeholderTextColor="#64748B"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <X size={18} color="#64748B" />
            </TouchableOpacity>
          )}
        </View>

        {/* Status Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3 -mx-1"
        >
          {statusFilters.map((filter) => (
            <TouchableOpacity
              key={filter.key ?? 'all'}
              onPress={() => setStatusFilter(filter.key)}
              className={`px-4 py-2 rounded-full mx-1 ${
                statusFilter === filter.key
                  ? 'bg-amber-500'
                  : 'bg-slate-800'
              }`}
            >
              <Text
                className={`font-medium ${
                  statusFilter === filter.key ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Users List */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#F59E0B" size="large" />
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-4"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />
          }
          showsVerticalScrollIndicator={false}
        >
          {users.length === 0 ? (
            <View className="flex-1 items-center justify-center py-20">
              <User size={48} color="#475569" />
              <Text className="text-slate-400 text-lg mt-4">No users found</Text>
            </View>
          ) : (
            users.map((user) => (
              <UserCard
                key={user.id}
                user={user}
                onBan={() => setBanModalUser(user)}
                onUnban={() => handleUnban(user)}
                onDelete={() => handleDelete(user)}
                onMakeAdmin={() => {
                  setAdminRoleModal(user);
                  void fetchRoles().then(setRoles);
                }}
                onGiveBusinessAccount={() => handleGiveBusinessAccount(user)}
                can={can}
              />
            ))
          )}
          <View className="h-8" />
        </ScrollView>
      )}

      {/* Ban Modal */}
      <Modal
        visible={!!banModalUser}
        transparent
        animationType="slide"
        onRequestClose={() => setBanModalUser(null)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-slate-800 rounded-t-3xl p-6">
            <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-4" />
            <Text className="text-white text-xl font-bold mb-4">
              Ban @{banModalUser?.username}
            </Text>

            <Text className="text-slate-400 mb-2">Ban Reason *</Text>
            <TextInput
              className="bg-slate-700 text-white rounded-xl p-4 mb-4"
              placeholder="Enter reason for ban..."
              placeholderTextColor="#64748B"
              value={banReason}
              onChangeText={setBanReason}
              multiline
              numberOfLines={3}
            />

            <Text className="text-slate-400 mb-2">Duration (days, optional)</Text>
            <TextInput
              className="bg-slate-700 text-white rounded-xl p-4 mb-4"
              placeholder="Leave empty for permanent ban"
              placeholderTextColor="#64748B"
              value={banDuration}
              onChangeText={setBanDuration}
              keyboardType="number-pad"
            />

            <TouchableOpacity
              onPress={handleBan}
              className="bg-red-500 py-4 rounded-xl items-center mb-3"
            >
              <Text className="text-white font-bold">Confirm Ban</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setBanModalUser(null);
                setBanReason('');
                setBanDuration('');
              }}
              className="bg-slate-700 py-4 rounded-xl items-center"
            >
              <Text className="text-slate-300 font-medium">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Admin Role Modal */}
      <Modal
        visible={!!adminRoleModal}
        transparent
        animationType="slide"
        onRequestClose={() => setAdminRoleModal(null)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-slate-800 rounded-t-3xl p-6">
            <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-4" />
            <Text className="text-white text-xl font-bold mb-1">
              Role for @{adminRoleModal?.username}
            </Text>
            <Text className="text-slate-400 text-sm mb-4">
              What each role may do is set in the web console under Roles. A change applies to
              their next request, not their next sign-in.
            </Text>

            <TouchableOpacity
              onPress={() => handleAssignRole('user')}
              className="bg-slate-700/40 border border-slate-600 p-4 rounded-xl mb-3"
            >
              <View className="flex-row items-center">
                <Shield size={24} color="#94A3B8" />
                <View className="ml-3 flex-1">
                  <Text className="text-slate-200 font-bold">No administrative access</Text>
                  <Text className="text-slate-400 text-sm">
                    Their citizen account is untouched.
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            {roles.map((role) => (
              <TouchableOpacity
                key={role.slug}
                onPress={() => handleAssignRole(role.slug)}
                className="bg-amber-500/20 border border-amber-500/50 p-4 rounded-xl mb-3"
              >
                <View className="flex-row items-center">
                  <Crown size={24} color="#F59E0B" />
                  <View className="ml-3 flex-1">
                    <Text className="text-amber-400 font-bold">{role.name}</Text>
                    <Text className="text-slate-400 text-sm">{role.slug}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}

            <Text className="text-slate-500 text-xs mb-4">
              The owner is not in this list. There is one, the seat is not assignable, and that
              account cannot be banned, deleted, re-keyed or re-roled by anybody.
            </Text>

            <TouchableOpacity
              onPress={() => setAdminRoleModal(null)}
              className="bg-slate-700 py-4 rounded-xl items-center"
            >
              <Text className="text-slate-300 font-medium">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
