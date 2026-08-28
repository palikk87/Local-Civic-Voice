import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  SafeAreaView,
  Modal,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Plus,
  Bell,
  AlertTriangle,
  Info,
  AlertCircle,
  X,
  Calendar,
  User,
} from 'lucide-react-native';
import { useAdminStore, Announcement } from '@/lib/admin-store';
import * as Haptics from 'expo-haptics';

interface AnnouncementCardProps {
  announcement: Announcement;
}

function AnnouncementCard({ announcement }: AnnouncementCardProps) {
  const getTypeStyle = (type: string) => {
    switch (type) {
      case 'info':
        return { bg: 'bg-blue-500/20', border: 'border-blue-500/50', icon: <Info size={20} color="#3B82F6" /> };
      case 'warning':
        return { bg: 'bg-orange-500/20', border: 'border-orange-500/50', icon: <AlertTriangle size={20} color="#F97316" /> };
      case 'alert':
        return { bg: 'bg-red-500/20', border: 'border-red-500/50', icon: <AlertCircle size={20} color="#EF4444" /> };
      default:
        return { bg: 'bg-slate-700/50', border: 'border-slate-600', icon: <Bell size={20} color="#64748B" /> };
    }
  };

  const typeStyle = getTypeStyle(announcement.type);

  return (
    <View className={`rounded-2xl p-4 mb-3 border ${typeStyle.bg} ${typeStyle.border}`}>
      <View className="flex-row items-start">
        <View className="w-10 h-10 bg-slate-800/50 rounded-xl items-center justify-center">
          {typeStyle.icon}
        </View>
        <View className="flex-1 ml-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-white font-semibold text-base flex-1">{announcement.title}</Text>
            {!announcement.isActive && (
              <View className="bg-slate-700 px-2 py-0.5 rounded-full">
                <Text className="text-slate-400 text-xs">Expired</Text>
              </View>
            )}
          </View>
          <Text className="text-slate-300 mt-2">{announcement.content}</Text>

          <View className="flex-row items-center mt-3 gap-4">
            <View className="flex-row items-center">
              <User size={12} color="#64748B" />
              <Text className="text-slate-500 text-xs ml-1">{announcement.createdBy}</Text>
            </View>
            <View className="flex-row items-center">
              <Calendar size={12} color="#64748B" />
              <Text className="text-slate-500 text-xs ml-1">
                {new Date(announcement.createdAt).toLocaleDateString()}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function AdminAnnouncementsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<'info' | 'warning' | 'alert'>('info');

  const announcements = useAdminStore((s) => s.announcements);
  const fetchAnnouncements = useAdminStore((s) => s.fetchAnnouncements);
  const createAnnouncement = useAdminStore((s) => s.createAnnouncement);

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAnnouncements();
    setRefreshing(false);
  };

  const handleCreate = async () => {
    if (!title.trim() || !content.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    const result = await createAnnouncement(title.trim(), content.trim(), type);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowCreateModal(false);
      setTitle('');
      setContent('');
      setType('info');
    } else {
      Alert.alert('Error', result.error || 'Failed to create announcement');
    }
  };

  const typeOptions = [
    { key: 'info', label: 'Info', color: 'bg-blue-500', icon: <Info size={16} color="white" /> },
    { key: 'warning', label: 'Warning', color: 'bg-orange-500', icon: <AlertTriangle size={16} color="white" /> },
    { key: 'alert', label: 'Alert', color: 'bg-red-500', icon: <AlertCircle size={16} color="white" /> },
  ];

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold ml-2">Announcements</Text>
        <View className="flex-1" />
        <TouchableOpacity
          onPress={() => setShowCreateModal(true)}
          className="bg-amber-500 p-2 rounded-xl"
        >
          <Plus size={20} color="#0F172A" />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1 px-4 py-4"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />
        }
        showsVerticalScrollIndicator={false}
      >
        {announcements.length === 0 ? (
          <View className="flex-1 items-center justify-center py-20">
            <Bell size={48} color="#475569" />
            <Text className="text-slate-400 text-lg mt-4">No announcements</Text>
            <Text className="text-slate-500 text-sm mt-1">Create one to notify all users</Text>
          </View>
        ) : (
          announcements.map((announcement) => (
            <AnnouncementCard key={announcement.id} announcement={announcement} />
          ))
        )}
        <View className="h-8" />
      </ScrollView>

      {/* Create Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-slate-800 max-h-[85%] rounded-t-3xl p-6">
            <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-4" />
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-white text-xl font-bold">New Announcement</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <Text className="text-slate-400 mb-2">Type</Text>
            <View className="flex-row gap-2 mb-4">
              {typeOptions.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => setType(option.key as 'info' | 'warning' | 'alert')}
                  className={`flex-1 flex-row items-center justify-center py-3 rounded-xl ${
                    type === option.key ? option.color : 'bg-slate-700'
                  }`}
                >
                  {option.icon}
                  <Text className="text-white font-medium ml-2">{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text className="text-slate-400 mb-2">Title</Text>
            <TextInput
              className="bg-slate-700 text-white rounded-xl p-4 mb-4"
              placeholder="Announcement title..."
              placeholderTextColor="#64748B"
              value={title}
              onChangeText={setTitle}
            />

            <Text className="text-slate-400 mb-2">Content</Text>
            <TextInput
              className="bg-slate-700 text-white rounded-xl p-4 mb-4"
              placeholder="Write your announcement..."
              placeholderTextColor="#64748B"
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <TouchableOpacity
              onPress={handleCreate}
              className="bg-amber-500 py-4 rounded-xl items-center mb-3"
            >
              <Text className="text-slate-900 font-bold">Publish Announcement</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setShowCreateModal(false);
                setTitle('');
                setContent('');
                setType('info');
              }}
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
