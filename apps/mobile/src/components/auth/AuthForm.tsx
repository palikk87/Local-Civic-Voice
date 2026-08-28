import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  Mail,
  User as UserIcon,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  BookOpen,
  Scroll,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { authClient } from '@/lib/auth/auth-client';
import { HumanCheck, useHumanCheck } from '@/components/auth/HumanCheck';
import { VerifyEmailStep } from './VerifyEmailStep';
import { SESSION_QUERY_KEY } from '@/lib/auth/use-session';
import { api } from '@/lib/api/api';

type Mode = 'signin' | 'signup';

interface AuthFormProps {
  /** Initial mode. People can toggle between sign in / sign up. */
  mode?: Mode;
  /** Called after a successful sign in / sign up. */
  onSuccess?: () => void;
  /** Whether to show the founding-documents footer (sign up screens). */
  showFoundingDocs?: boolean;
}

interface SignInResponse {
  user?: { email?: string };
}

/**
 * Shared AYE & NAY auth form — the phone twin of webapp/src/components/auth/AuthForm.tsx.
 *
 * Same accounts, same endpoints, same rules as the web app:
 *   sign up → POST /api/auth/sign-up/email (Better Auth), then PATCH /api/users/me for the username
 *   sign in → email or username + password. Usernames are resolved by POST /api/login,
 *             exactly like web; the session itself is established through the Expo auth
 *             client so it persists in SecureStore.
 */
export function AuthForm({
  mode: initialMode = 'signin',
  onSuccess,
  showFoundingDocs = true,
}: AuthFormProps) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>(initialMode);

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === 'signup';
  /**
   * CONSTITUTION ARTICLE I §3. Null until the bot test is passed, or forever
   * on a deployment with no key — `challenge` tells the button which, so a
   * missing key never looks like an unsolved puzzle.
   */
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const { data: challenge } = useHumanCheck();

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
  }

  function validate(): string | null {
    const cleanEmail = email.trim();
    if (isSignup) {
      if (!displayName.trim()) return 'Please enter your name.';
      if (!username.trim()) return 'Please choose a username.';
      if (username.includes(' ')) return 'Username cannot contain spaces.';
      if (!cleanEmail || !cleanEmail.includes('@'))
        return 'Please enter a valid email address.';
    } else if (!cleanEmail) {
      return 'Please enter your email or username.';
    }
    if (isSignup && password.length < 6)
      return 'Password must be at least 6 characters.';
    if (!password) return 'Please enter your password.';
    if (isSignup && password !== confirmPassword) return 'Passwords do not match.';
    return null;
  }

  async function handleSignIn() {
    const identifier = email.trim();
    let accountEmail = identifier.toLowerCase();

    // No "@" → a username. The backend resolves it to the account email, the same
    // route the web app posts to.
    if (!identifier.includes('@')) {
      const resolved = await api.post<SignInResponse>('/api/login', {
        identifier,
        password,
      });
      const found = resolved?.user?.email;
      if (!found) throw new Error('No account found with that username.');
      accountEmail = found;
    }

    const { error: err } = await authClient.signIn.email({
      email: accountEmail,
      password,
    });
    if (err) throw new Error(err.message || 'Incorrect email or password.');

    await queryClient.invalidateQueries();
    onSuccess?.();
  }

  async function handleSignUp() {
    // THE TOKEN GOES IN A HEADER, not the body. Better Auth owns the sign-up
    // body and drops fields its schema does not know, so a token put there
    // arrives as nothing at all.
    const { error: err } = await authClient.signUp.email(
      {
        email: email.trim().toLowerCase(),
        password,
        name: displayName.trim(),
      },
      humanToken ? { headers: { 'cf-turnstile-response': humanToken } } : undefined,
    );
    if (err) throw new Error(err.message || 'Could not create your account.');

    // autoSignIn is enabled, so a session now exists. Persist the chosen username.
    // If it's taken (409), surface the message but don't block — the account is
    // already created and signed in.
    let usernameError: string | null = null;
    try {
      await api.patch('/api/users/me', { username: username.trim().toLowerCase() });
    } catch (e) {
      usernameError = e instanceof Error ? e.message : 'That username is taken.';
    }

    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    await queryClient.invalidateQueries();
    if (usernameError) setError(usernameError);

    // CONSTITUTION ARTICLE I, SECTION 3. The account exists and is signed in,
    // but it cannot vote, delegate or post until the emailed code is entered.
    // The server sent that code the moment the account was created, so this is
    // a prompt rather than a trigger — closing it loses nothing except the
    // ability to take part until they come back to it.
    setVerifying(true);
  }

  async function handleSubmit() {
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (isSignup) {
        await handleSignUp();
      } else {
        await handleSignIn();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const fieldWrap =
    'flex-row items-center bg-slate-800/60 border border-slate-700 rounded-xl px-4';
  const fieldInput = 'flex-1 py-4 px-3 text-white text-base';

  // The account is made; the code is what is left. Shown in place of the form
  // rather than over it, so there is one obvious next thing to do.
  if (verifying) {
    return (
      <VerifyEmailStep
        email={email.trim().toLowerCase()}
        onVerified={() => {
          setVerifying(false);
          onSuccess?.();
        }}
        onSkip={() => {
          setVerifying(false);
          onSuccess?.();
        }}
      />
    );
  }

  return (
    <View>
      {isSignup ? (
        <>
          <View className="mb-4">
            <Text className="text-slate-300 font-medium mb-2">Full name</Text>
            <View className={fieldWrap}>
              <UserIcon size={20} color="#64748B" />
              <TextInput
                className={fieldInput}
                placeholder="Jane Citizen"
                placeholderTextColor="#64748B"
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
              />
            </View>
          </View>

          <View className="mb-4">
            <Text className="text-slate-300 font-medium mb-2">Username</Text>
            <View className={fieldWrap}>
              <Text className="text-slate-500 text-base">@</Text>
              <TextInput
                className="flex-1 py-4 px-2 text-white text-base"
                placeholder="janecitizen"
                placeholderTextColor="#64748B"
                value={username}
                onChangeText={(text) => setUsername(text.toLowerCase().replace(/\s/g, ''))}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>
        </>
      ) : null}

      <View className="mb-4">
        <Text className="text-slate-300 font-medium mb-2">
          {isSignup ? 'Email address' : 'Email or username'}
        </Text>
        <View className={fieldWrap}>
          <Mail size={20} color="#64748B" />
          <TextInput
            className={fieldInput}
            placeholder={isSignup ? 'you@example.com' : 'you@example.com or username'}
            placeholderTextColor="#64748B"
            value={email}
            onChangeText={setEmail}
            keyboardType={isSignup ? 'email-address' : 'default'}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <View className="mb-4">
        <Text className="text-slate-300 font-medium mb-2">Password</Text>
        <View className={fieldWrap}>
          <Lock size={20} color="#64748B" />
          <TextInput
            className={fieldInput}
            placeholder={isSignup ? 'At least 6 characters' : 'Your password'}
            placeholderTextColor="#64748B"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            hitSlop={8}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeOff size={20} color="#64748B" />
            ) : (
              <Eye size={20} color="#64748B" />
            )}
          </Pressable>
        </View>
      </View>

      {isSignup ? (
        <View className="mb-4">
          <Text className="text-slate-300 font-medium mb-2">Confirm password</Text>
          <View className={fieldWrap}>
            <Lock size={20} color="#64748B" />
            <TextInput
              className={fieldInput}
              placeholder="Re-enter password"
              placeholderTextColor="#64748B"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>
      ) : null}

      {/* CONSTITUTION ARTICLE I §3. Renders nothing when no key is configured,
          so a deployment without one still works and simply does not claim to
          have checked. */}
      {isSignup ? <HumanCheck onToken={setHumanToken} /> : null}

      {error ? <Text className="text-red-400 mb-4 text-center">{error}</Text> : null}

      <Pressable
        onPress={handleSubmit}
        disabled={loading || (isSignup && challenge?.configured === true && !humanToken)}
        className="bg-amber-500 rounded-xl py-4 flex-row items-center justify-center mb-5"
        style={{
          opacity:
            loading || (isSignup && challenge?.configured === true && !humanToken) ? 0.7 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator color="#0F172A" />
        ) : (
          <>
            <Text className="text-slate-900 font-bold text-lg mr-2">
              {isSignup ? 'Create Account' : 'Sign In'}
            </Text>
            <ArrowRight size={20} color="#0F172A" />
          </>
        )}
      </Pressable>

      <View className="flex-row justify-center">
        <Text className="text-slate-400">
          {isSignup ? 'Already have an account? ' : "Don't have an account? "}
        </Text>
        <Pressable onPress={() => switchMode(isSignup ? 'signin' : 'signup')}>
          <Text className="text-amber-500 font-semibold">
            {isSignup ? 'Sign In' : 'Sign Up'}
          </Text>
        </Pressable>
      </View>

      {isSignup && showFoundingDocs ? (
        <View className="border-t border-slate-700/50 pt-4 mt-6">
          <Text className="text-slate-500 text-xs text-center mb-3">
            By joining, you agree to operate under our
          </Text>
          <View className="flex-row">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/constitution');
              }}
              className="flex-1 flex-row items-center justify-center bg-slate-800/60 rounded-l-lg py-2.5 px-3 border-r border-slate-700"
            >
              <BookOpen size={14} color="#94A3B8" />
              <Text className="text-slate-300 text-xs font-medium ml-1.5">Constitution</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/bill-of-rights');
              }}
              className="flex-1 flex-row items-center justify-center bg-amber-900/30 rounded-r-lg py-2.5 px-3"
            >
              <Scroll size={14} color="#FCD34D" />
              <Text className="text-amber-300 text-xs font-medium ml-1.5">Bill of Rights</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
