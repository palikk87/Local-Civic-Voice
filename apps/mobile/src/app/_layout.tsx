import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from '@/lib/useColorScheme';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AuthUIProvider } from '@/lib/auth/use-civic-auth';
import { AuthSheet } from '@/components/auth/AuthSheet';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BugReporter } from '@/components/support/BugReporter';
import { VoteAnonymityDialog } from '@/components/VoteAnonymityDialog';
import { JuryGate } from '@/components/JuryGate';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

function RootLayoutNav({ colorScheme }: { colorScheme: 'light' | 'dark' | null | undefined }) {
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
        <Stack.Screen name="bill/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="executive-order/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="scotus/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="record" options={{ headerShown: false }} />
        <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
        <Stack.Screen name="post/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="start" options={{ headerShown: false }} />
        <Stack.Screen name="delegates" options={{ headerShown: false }} />
        <Stack.Screen name="messages" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="notification-settings" options={{ headerShown: false }} />
        <Stack.Screen name="conversation/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="bill-of-rights" options={{ headerShown: false }} />
        <Stack.Screen name="constitution" options={{ headerShown: false }} />
        <Stack.Screen name="article-v" options={{ headerShown: false }} />
        {/* Article IV. Reachable signed out too: a decided case is public. */}
        <Stack.Screen name="jury/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="user/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="admin/login" options={{ headerShown: false }} />
        <Stack.Screen name="admin/dashboard" options={{ headerShown: false }} />
        <Stack.Screen name="admin/users" options={{ headerShown: false }} />
        <Stack.Screen name="admin/posts" options={{ headerShown: false }} />
        <Stack.Screen name="admin/analytics" options={{ headerShown: false }} />
        <Stack.Screen name="admin/announcements" options={{ headerShown: false }} />
        <Stack.Screen name="admin/logs" options={{ headerShown: false }} />
        <Stack.Screen name="admin/settings" options={{ headerShown: false }} />
        <Stack.Screen name="b2b/login" options={{ headerShown: false }} />
        <Stack.Screen name="b2b/dashboard" options={{ headerShown: false }} />
        <Stack.Screen name="b2b/heatmap" options={{ headerShown: false }} />
        <Stack.Screen name="b2b/issues" options={{ headerShown: false }} />
        <Stack.Screen name="b2b/states" options={{ headerShown: false }} />
        <Stack.Screen name="b2b/forecast" options={{ headerShown: false }} />
        <Stack.Screen name="b2b/reports" options={{ headerShown: false }} />
        <Stack.Screen name="b2b/settings" options={{ headerShown: false }} />
        <Stack.Screen name="b2b/team" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
      {/*
        Guests are never redirected out of the app — they browse everything public and
        get prompted only when they try to participate. Same rule as the web app; see
        lib/permissions.ts.
      */}
      <AuthSheet />
      {/*
        ARTICLE IV. A summons puts a banner here; an accepted summons takes them
        to the case and keeps them there. The server enforces it either way —
        this is so the app behaves like it means it, rather than showing a juror
        five hundred failed requests.
      */}
      <JuryGate />
      {/*
        On every screen, including the ones a guest is on. The people most
        likely to hit a blocking bug are the ones who could not get past
        sign-up, and a gate would silence exactly them.
      */}
      <BugReporter />

      {/* Mounted once, above every screen, because the thing that raises the
          question is the vote pipeline rather than any one screen — every
          surface in the app votes through the same function. */}
      <VoteAnonymityDialog />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/*
          One auth provider. A Supabase-Auth AuthProvider used to wrap this one,
          mounting a second, never-populated session that three tab screens read
          from — which is how a signed-in user could still be `undefined` to half
          the app. Better Auth is the only session now.
        */}
        <AuthUIProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
              <RootLayoutNav colorScheme={colorScheme} />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </AuthUIProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
