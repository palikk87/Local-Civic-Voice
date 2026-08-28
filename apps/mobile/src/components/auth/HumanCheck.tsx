/**
 * THE BOT TEST ON SIGN-UP — Constitution Article I §3.
 *
 * Phone twin of apps/web/src/components/auth/HumanCheck.tsx, and NOT a copy of
 * it: Turnstile is a browser widget, so on the phone it is rendered inside a
 * WebView that posts the token back out.
 *
 * IT DRAWS NOTHING WHEN NOTHING IS CONFIGURED. The server says whether a
 * challenge is required; with no key set this renders null and sign-up
 * proceeds, and the platform does not pretend to have checked. That state is
 * reported by name at /health.
 *
 * IF THE WEBVIEW CANNOT LOAD, sign-up is not blocked forever — the form falls
 * back to sending no token, and the server refuses it. That is the honest
 * outcome: the check is configured, so it is enforced, and the person sees why
 * rather than a button that never enables.
 */

import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/api';

interface Challenge {
  provider: string;
  configured: boolean;
  siteKey: string | null;
}

/** Read once, so the form knows whether to wait for a token. */
export function useHumanCheck() {
  return useQuery({
    queryKey: ['auth-challenge'],
    queryFn: () => api.get<Challenge>('/api/auth-challenge'),
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * The page loaded into the WebView.
 *
 * Deliberately tiny and self-contained: it renders the widget and posts the
 * token to the native side. Nothing about the citizen is in it — no session, no
 * email, no name — so the WebView never sees anything worth protecting.
 */
function challengePage(siteKey: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <style>
      body { margin: 0; background: transparent; display: flex; justify-content: center; }
    </style>
  </head>
  <body>
    <div class="cf-turnstile"
         data-sitekey="${siteKey}"
         data-theme="auto"
         data-callback="onPass"
         data-expired-callback="onGone"
         data-error-callback="onGone"></div>
    <script>
      function onPass(token) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ token: token }));
      }
      function onGone() {
        window.ReactNativeWebView.postMessage(JSON.stringify({ token: null }));
      }
    </script>
  </body>
</html>`;
}

export function HumanCheck({ onToken }: { onToken: (token: string | null) => void }) {
  const { data } = useHumanCheck();
  const [failed, setFailed] = useState(false);

  const html = useMemo(
    () => (data?.siteKey ? challengePage(data.siteKey) : null),
    [data?.siteKey],
  );

  // No challenge is configured. Draw nothing — and say nothing to the visitor,
  // because a notice on a sign-up form announcing that the bot test is off is
  // an invitation. Operators see it at /health.
  if (!data?.configured || !html) return null;

  return (
    <View testID="human-check" className="mt-2 h-20 overflow-hidden">
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://ayeandnay.com' }}
        style={{ backgroundColor: 'transparent' }}
        scrollEnabled={false}
        onError={() => {
          setFailed(true);
          onToken(null);
        }}
        onMessage={(event) => {
          try {
            const parsed = JSON.parse(event.nativeEvent.data) as { token: string | null };
            onToken(parsed.token);
          } catch {
            onToken(null);
          }
        }}
      />
      {failed ? (
        <Text testID="human-check-failed" className="mt-1 text-xs text-slate-500">
          The check could not load. Close and try again.
        </Text>
      ) : null}
    </View>
  );
}
