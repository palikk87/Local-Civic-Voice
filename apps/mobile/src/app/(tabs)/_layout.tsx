import React from 'react';
import { Tabs } from 'expo-router';
import { Home, Compass, Landmark, User, Newspaper, BookOpen, UsersRound } from 'lucide-react-native';
import { View } from 'react-native';
import { usePermissions } from '@/lib/auth/use-civic-auth';

export default function TabLayout() {
  // Guests don't see links to member-only screens (timeline, profile) — same rule the
  // web app's AppShell nav applies. The screens themselves stay gated by <AuthGate />.
  const { can } = usePermissions();
  const showTimeline = can('viewTimeline');
  const showProfile = can('viewProfile');

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0F172A',
          borderTopColor: '#1E293B',
          borderTopWidth: 1,
          height: 85,
          paddingTop: 8,
          paddingBottom: 28,
        },
        tabBarActiveTintColor: '#F59E0B',
        tabBarInactiveTintColor: '#64748B',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color, size }) => (
            <Home size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="timeline"
        options={{
          title: 'Timeline',
          tabBarItemStyle: showTimeline ? undefined : { display: 'none' },
          tabBarIcon: ({ color, size }) => (
            <Newspaper size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, size }) => (
            <BookOpen size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => (
            <Compass size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="people"
        options={{
          title: 'People',
          tabBarIcon: ({ color, size }) => (
            <UsersRound size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="government"
        options={{
          title: 'Government',
          // Longest label in a seven-tab bar — shrink it so it doesn't clip.
          tabBarLabelStyle: { fontSize: 9.5, fontWeight: '600' },
          tabBarIcon: ({ color, size }) => (
            <Landmark size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarItemStyle: showProfile ? undefined : { display: 'none' },
          tabBarIcon: ({ color, size }) => (
            <User size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
    </Tabs>
  );
}
