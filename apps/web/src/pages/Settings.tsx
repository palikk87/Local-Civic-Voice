import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings as SettingsIcon, Save } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface NotificationPreferences {
  likes: boolean;
  comments: boolean;
  replies: boolean;
  mentions: boolean;
  follows: boolean;
  reposts: boolean;
  newFollowerPosts: boolean;
}

export default function Settings() {
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    likes: true,
    comments: true,
    replies: true,
    mentions: true,
    follows: true,
    reposts: true,
    newFollowerPosts: true,
  });

  // The backend answers with { preferences: {...} } and takes PUT — same call the
  // mobile notification-settings screen makes (mobile/src/lib/notification-store.ts).
  const { data: loadedPreferences, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () =>
      api.get<{ preferences: NotificationPreferences }>(
        "/api/notifications/preferences"
      ),
  });

  useEffect(() => {
    if (loadedPreferences?.preferences) {
      setPreferences(loadedPreferences.preferences);
    }
  }, [loadedPreferences]);

  const saveMutation = useMutation({
    mutationFn: (next: NotificationPreferences) =>
      api.put("/api/notifications/preferences", next),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["notification-preferences"],
      });
      toast.success("Preferences saved!");
    },
    onError: () => {
      toast.error("Failed to save preferences");
    },
  });

  const togglePreference = (key: keyof NotificationPreferences) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Enable all / Disable all — same shortcuts the mobile screen offers, and like
  // mobile they save straight away rather than waiting for the Save button.
  const setAll = (value: boolean) => {
    const next: NotificationPreferences = {
      likes: value,
      comments: value,
      replies: value,
      mentions: value,
      follows: value,
      reposts: value,
      newFollowerPosts: value,
    };
    setPreferences(next);
    saveMutation.mutate(next);
  };

  const allEnabled = Object.values(preferences).every((v) => v === true);
  const allDisabled = Object.values(preferences).every((v) => v === false);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <SettingsIcon className="h-6 w-6 text-accent" />
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your notification and preference settings.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-4 rounded-lg border border-border bg-card p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-12" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-border bg-card p-6">
              <h2 className="font-semibold text-foreground">Notifications</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose which notifications you'd like to receive.
              </p>

              <Separator className="my-4" />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Likes</p>
                    <p className="text-sm text-muted-foreground">
                      When someone likes your post
                    </p>
                  </div>
                  <Switch
                    checked={preferences.likes}
                    onCheckedChange={() => togglePreference("likes")}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Comments</p>
                    <p className="text-sm text-muted-foreground">
                      When someone comments on your post
                    </p>
                  </div>
                  <Switch
                    checked={preferences.comments}
                    onCheckedChange={() => togglePreference("comments")}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Replies</p>
                    <p className="text-sm text-muted-foreground">
                      When someone replies to your comment
                    </p>
                  </div>
                  <Switch
                    checked={preferences.replies}
                    onCheckedChange={() => togglePreference("replies")}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Mentions</p>
                    <p className="text-sm text-muted-foreground">
                      When you're mentioned in a post or comment
                    </p>
                  </div>
                  <Switch
                    checked={preferences.mentions}
                    onCheckedChange={() => togglePreference("mentions")}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Follows</p>
                    <p className="text-sm text-muted-foreground">
                      When someone follows you
                    </p>
                  </div>
                  <Switch
                    checked={preferences.follows}
                    onCheckedChange={() => togglePreference("follows")}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Reposts</p>
                    <p className="text-sm text-muted-foreground">
                      When someone shares your post
                    </p>
                  </div>
                  <Switch
                    checked={preferences.reposts}
                    onCheckedChange={() => togglePreference("reposts")}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">New posts from followers</p>
                    <p className="text-sm text-muted-foreground">
                      When someone you follow posts
                    </p>
                  </div>
                  <Switch
                    checked={preferences.newFollowerPosts}
                    onCheckedChange={() => togglePreference("newFollowerPosts")}
                  />
                </div>
              </div>

              <Separator className="my-6" />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  onClick={() => saveMutation.mutate(preferences)}
                  disabled={saveMutation.isPending}
                  className="w-full sm:w-auto"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saveMutation.isPending ? "Saving…" : "Save preferences"}
                </Button>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setAll(true)}
                    disabled={saveMutation.isPending || allEnabled}
                    className="flex-1 sm:flex-none"
                  >
                    Enable all
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setAll(false)}
                    disabled={saveMutation.isPending || allDisabled}
                    className="flex-1 sm:flex-none"
                  >
                    Disable all
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
