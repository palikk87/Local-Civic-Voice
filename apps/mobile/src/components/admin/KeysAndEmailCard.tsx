// Which keys this server actually holds, and does email actually send.
// Web twin: apps/web/src/components/admin/KeysAndEmailCard.tsx
//
// WHY THIS IS A SCREEN AND NOT AN ENDPOINT. Three separate times on this
// project a key was set and the thing it powers did not work, and each time the
// only way to find out which of the two was wrong involved reading source code
// or typing curl. Answering "is my key working?" should not require either.
//
// No key is ever shown. The fingerprint is four hex characters of its digest —
// enough to compare against what you pasted, worth nothing to anybody reading
// over your shoulder.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { CheckCircle2, XCircle, AlertTriangle, KeySquare, Send } from 'lucide-react-native';

import { BACKEND_URL } from '@/lib/config';
import { adminAuthHeader, adminCan, useAdminStore } from '@/lib/admin-store';

type SecretSource = 'database' | 'environment' | 'unset';

interface KeyStatus {
  name: string;
  present: boolean;
  fingerprint: string | null;
  length: number | null;
  looksRight: boolean;
  powers: string;
  withoutIt: string;
  /** Which of the two places the value in use came from. */
  source: SecretSource;
}

interface StoredSecretInfo {
  name: string;
  source: SecretSource;
  storedInDatabase: boolean;
  presentInEnvironment: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface KeyStorage {
  stored: StoredSecretInfo[];
  storable: string[];
  encryptionAvailable: boolean;
  encryptionUnavailableReason: string | null;
  encryptionSource: string | null;
  encryptionCaveat: string | null;
  note: string;
  cannotBeStored: { names: string[]; why: string };
}

interface TestResult {
  sent: boolean;
  from?: string;
  note?: string;
  detail?: string;
}

export function KeysAndEmailCard() {
  const session = useAdminStore((s) => s.session);
  // ASK WHAT THE ROLE MAY DO, NOT WHAT IT IS CALLED. Both of these were
  // `role === 'superadmin'`, so a role granted these exact capabilities was
  // refused nothing by the server and shown neither control here.
  const canManageKeys = adminCan(session, 'keys.manage');
  const canTestEmail = adminCan(session, 'email.test');

  const [keys, setKeys] = useState<KeyStatus[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [storage, setStorage] = useState<KeyStorage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped after a key is stored or cleared, to re-read what the server holds. */
  const [reloadToken, setReloadToken] = useState(0);

  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/admin/keys`, {
          headers: adminAuthHeader(),
        });
        const body = (await response.json()) as {
          data?: { keys: KeyStatus[]; warnings: string[]; storage?: KeyStorage };
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.data) {
          setLoadError(body.error ?? 'Could not read the key status.');
          return;
        }
        setKeys(body.data.keys);
        setWarnings(body.data.warnings);
        setStorage(body.data.storage ?? null);
      } catch {
        if (!cancelled) setLoadError('Could not reach the API.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function sendTest() {
    const address = to.trim();
    if (!address) {
      setResult({ sent: false, detail: 'Enter an address to send the test to.' });
      return;
    }

    setSending(true);
    setResult(null);
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/email-health/test`, {
        method: 'POST',
        headers: { ...adminAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: address }),
      });
      const body = (await response.json()) as TestResult & { error?: string };
      // On failure the endpoint answers 502/503 carrying the provider's own
      // words. That sentence is the answer, so it is shown rather than replaced.
      setResult(
        response.ok
          ? body
          : { sent: false, detail: body.detail ?? body.error ?? 'The test could not be sent.' },
      );
    } catch {
      setResult({ sent: false, detail: 'Could not reach the API.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <View className="bg-slate-800/40 rounded-2xl p-4 mb-6">
      <View className="flex-row items-center mb-1">
        <KeySquare size={18} color="#F59E0B" />
        <Text className="text-white font-semibold ml-2">API keys and email</Text>
      </View>
      <Text className="text-slate-400 text-sm">
        What this API process can actually see. A key set anywhere else — the web host, a
        build-time variable, another service — is not used and does not appear here.
      </Text>

      {warnings.map((warning) => (
        <View
          key={warning}
          className="flex-row gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 mt-3"
        >
          <AlertTriangle size={16} color="#F59E0B" />
          <Text className="flex-1 text-slate-200 text-sm">{warning}</Text>
        </View>
      ))}

      {loadError ? (
        <Text className="text-red-400 text-sm mt-3">{loadError}</Text>
      ) : !keys ? (
        <Text className="text-slate-400 text-sm mt-3">Checking…</Text>
      ) : (
        <View className="mt-3">
          {keys.map((key) => (
            <View key={key.name} className="flex-row gap-2 mb-3">
              {key.present ? (
                <CheckCircle2 size={16} color={key.looksRight ? '#10B981' : '#F59E0B'} />
              ) : (
                <XCircle size={16} color="#F87171" />
              )}
              <View className="flex-1">
                <Text className="text-white text-sm">
                  {key.name}{' '}
                  {key.present ? (
                    <Text className="text-slate-400">
                      · {key.fingerprint} · {key.length} chars
                      {key.looksRight ? '' : ' · unexpected format'}
                    </Text>
                  ) : (
                    <Text className="text-red-400">· not set</Text>
                  )}
                </Text>
                <Text className="text-slate-400 text-sm">{key.powers}</Text>
                {!key.present ? (
                  <Text className="text-amber-400 text-sm">{key.withoutIt}</Text>
                ) : null}
                {key.present && key.source === 'database' ? (
                  <Text className="text-emerald-400 text-xs mt-1">
                    Stored here, in the platform's own database. Moves with it to any host.
                  </Text>
                ) : null}
                {key.present && key.source === 'environment' ? (
                  <Text className="text-slate-500 text-xs mt-1">
                    Set as a variable on whatever host runs this API. Re-typing it is part of
                    moving.
                  </Text>
                ) : null}
                {canManageKeys && storage ? (
                  <KeyEditor
                    name={key.name}
                    stored={storage.stored.find((entry) => entry.name === key.name)}
                    canStore={storage.encryptionAvailable}
                    whyNot={storage.encryptionUnavailableReason}
                    onChanged={() => setReloadToken((n) => n + 1)}
                  />
                ) : null}
              </View>
            </View>
          ))}
          <Text className="text-slate-500 text-xs">
            The four characters after each name are a fingerprint of the stored value, not part
            of the key.
          </Text>
          {storage ? (
            <View className="mt-3 rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
              <Text className="text-slate-400 text-xs">{storage.note}</Text>
              {storage.encryptionCaveat ? (
                <Text className="text-amber-400 text-xs mt-2">{storage.encryptionCaveat}</Text>
              ) : null}
              <Text className="text-slate-500 text-xs mt-2">
                {storage.cannotBeStored.names.join(', ')} stay on the host.{' '}
                {storage.cannotBeStored.why}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      <View className="h-px bg-slate-700/50 my-4" />

      <Text className="text-white font-semibold">Send a test email</Text>
      <Text className="text-slate-400 text-sm mt-1">
        The only way to know for certain. A key can be perfectly valid and every message still
        be refused, because Resend rejects mail from a domain that is not verified in the
        account the key belongs to — and that looks exactly like a bad key.
      </Text>

      {canTestEmail ? (
        <>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="you@example.com"
            placeholderTextColor="#475569"
            keyboardType="email-address"
            autoCapitalize="none"
            className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white mt-3"
          />
          <Pressable
            disabled={sending}
            onPress={() => void sendTest()}
            className="bg-amber-500 rounded-xl py-3 items-center mt-3 flex-row justify-center"
            style={{ opacity: sending ? 0.6 : 1 }}
          >
            {sending ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <>
                <Send size={16} color="#0F172A" />
                <Text className="text-slate-900 font-semibold ml-2">Send test</Text>
              </>
            )}
          </Pressable>

          {result ? (
            <View
              className={`rounded-xl border p-3 mt-3 ${
                result.sent
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-red-500/40 bg-red-500/10'
              }`}
            >
              {result.sent ? (
                <>
                  <Text className="text-slate-100 text-sm">
                    Accepted by the provider, sent from {result.from}.
                  </Text>
                  <Text className="text-slate-400 text-sm mt-1">{result.note}</Text>
                </>
              ) : (
                <>
                  <Text className="text-slate-100 text-sm">Not sent.</Text>
                  {/* Verbatim. This sentence usually names the problem. */}
                  <Text className="text-slate-400 text-xs mt-1">{result.detail}</Text>
                </>
              )}
            </View>
          ) : null}
        </>
      ) : (
        <Text className="text-slate-400 text-sm mt-3">
          A superadmin sends the test — it spends the mail quota and can be pointed at any
          address.
        </Text>
      )}
    </View>
  );
}

/**
 * Set or clear one key, from the phone that is already in your hand.
 * Web twin: apps/web/src/components/admin/KeysAndEmailCard.tsx
 *
 * WHY THIS EXISTS. Rotating a key used to mean opening the hosting dashboard on
 * a computer and redeploying, which put every rotation behind one person and
 * one browser tab. It takes effect on the next request now: the server reads
 * its secrets live rather than snapshotting them at boot, so nothing restarts.
 *
 * WRITE-ONLY, ALWAYS. There is no code path on the server that returns a stored
 * key, so there is nothing here that could reveal one. The box is always empty;
 * what confirms a paste worked is the fingerprint and length above it changing.
 */
function KeyEditor({
  name,
  stored,
  canStore,
  whyNot,
  onChanged,
}: {
  name: string;
  stored: StoredSecretInfo | undefined;
  canStore: boolean;
  whyNot: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    const pasted = value.trim();
    if (!pasted) {
      setMessage({ ok: false, text: 'Paste a key first.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/keys/${name}`, {
        method: 'PUT',
        headers: { ...adminAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: pasted }),
      });
      const body = (await response.json()) as { data?: { message: string }; error?: string };
      if (!response.ok || !body.data) {
        setMessage({ ok: false, text: body.error ?? 'Could not store the key.' });
        return;
      }
      setValue('');
      setOpen(false);
      setMessage({ ok: true, text: body.data.message });
      onChanged();
    } catch {
      setMessage({ ok: false, text: 'Could not reach the API.' });
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/keys/${name}`, {
        method: 'DELETE',
        headers: adminAuthHeader(),
      });
      const body = (await response.json()) as { data?: { message: string }; error?: string };
      if (!response.ok || !body.data) {
        setMessage({ ok: false, text: body.error ?? 'Could not clear the key.' });
        return;
      }
      setMessage({ ok: true, text: body.data.message });
      onChanged();
    } catch {
      setMessage({ ok: false, text: 'Could not reach the API.' });
    } finally {
      setBusy(false);
    }
  }

  if (!canStore) {
    // Said once per key rather than hidden: somebody looking for the box needs
    // to know why there isn't one, and what to do about it.
    return (
      <Text className="text-slate-500 text-xs mt-1">
        {whyNot ?? 'Keys cannot be stored on this deployment.'}
      </Text>
    );
  }

  return (
    <View className="mt-2">
      {message ? (
        <Text className={`text-xs mb-2 ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </Text>
      ) : null}

      {open ? (
        <View>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={`Paste ${name}`}
            placeholderTextColor="#475569"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            className="bg-slate-900 text-white rounded-xl px-3 py-2 text-sm"
          />
          <View className="flex-row gap-2 mt-2">
            <Pressable
              onPress={save}
              disabled={busy}
              className="bg-amber-500 rounded-xl px-4 py-2 min-h-[44px] justify-center"
            >
              {busy ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <Text className="text-slate-900 font-semibold text-sm">Save</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                setOpen(false);
                setValue('');
              }}
              disabled={busy}
              className="rounded-xl px-4 py-2 min-h-[44px] justify-center"
            >
              <Text className="text-slate-400 text-sm">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="flex-row items-center gap-2 flex-wrap">
          <Pressable
            onPress={() => setOpen(true)}
            className="border border-slate-600 rounded-xl px-3 py-2 min-h-[44px] justify-center"
          >
            <Text className="text-slate-200 text-sm">
              {stored?.storedInDatabase ? 'Replace' : 'Store here'}
            </Text>
          </Pressable>
          {stored?.storedInDatabase ? (
            <Pressable
              onPress={clear}
              disabled={busy}
              className="rounded-xl px-3 py-2 min-h-[44px] justify-center"
            >
              {busy ? (
                <ActivityIndicator color="#F87171" />
              ) : (
                <Text className="text-red-400 text-sm">Clear</Text>
              )}
            </Pressable>
          ) : null}
          {stored?.storedInDatabase && stored.updatedBy ? (
            <Text className="text-slate-500 text-xs">
              set by {stored.updatedBy}
              {stored.updatedAt ? ` on ${new Date(stored.updatedAt).toLocaleDateString()}` : ''}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
