import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { DistrictPicker } from "@/components/civic/DistrictPicker";

interface EditableProfile {
  displayName: string;
  username: string;
  bio: string;
  location: string;
  avatar: string;
}

/**
 * Change your own name, handle, bio, location and picture.
 *
 * The endpoint for this has existed since the beginning and nothing but the
 * signup form ever called it, so an account was whatever it was on the day it
 * was made — permanently. On a platform that asks people to put their name to
 * public positions on legislation, not being able to correct that name is not
 * a missing nicety.
 *
 * WHAT IS NOT EDITABLE FROM HERE: anything that would rewrite the record.
 * Positions, posts and votes are what somebody said in public and stay as they
 * were said. Changing your display name does not change what you backed.
 */
export function EditProfileDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: EditableProfile;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [location, setLocation] = useState(profile.location);
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const preview = image ?? profile.avatar;

  async function pickAvatar(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      // api.raw, not fetch: a bare relative path goes to the web origin, and
      // the API is a different host in every deployed configuration.
      const response = await api.raw("/api/media/upload", { method: "POST", body });
      if (!response.ok) throw new Error(String(response.status));

      const result = (await response.json()) as { media?: { url?: string } };
      if (!result.media?.url) throw new Error("no url");

      setImage(result.media.url);
    } catch {
      toast.error("Couldn't upload that picture");
    } finally {
      setUploading(false);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      // Only what actually changed. Sending every field back would rewrite a
      // username to itself and trip the uniqueness check on the way past.
      const changes: Record<string, string> = {};
      if (name.trim() && name.trim() !== profile.displayName) changes.name = name.trim();
      if (username.trim() && username.trim() !== profile.username) {
        changes.username = username.trim().toLowerCase();
      }
      if (bio !== profile.bio) changes.bio = bio;
      if (location !== profile.location) changes.location = location;
      if (image) changes.image = image;

      if (Object.keys(changes).length === 0) return Promise.resolve(null);
      return api.patch("/api/users/me", changes);
    },
    onSuccess: () => {
      toast.success("Profile updated");
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["public-user"] });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      // The one failure a person can actually fix, said plainly.
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      toast.error(message.includes("taken") ? "That username is taken" : "Couldn't save that");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Reported at 1476x661: "brings up a screen to large to see the entire
          contents and unable to scroll to navigate". The base dialog now
          scrolls; this keeps Save on screen while it does, because a form you
          have to scroll to submit is only half fixed. */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden sm:max-w-md">
        <DialogHeader className="shrink-0 pb-4">
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Your positions and posts stay exactly as you made them.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" data-testid="edit-profile-scroll">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="relative h-20 w-20 shrink-0 rounded-full"
              aria-label="Change your picture"
            >
              <img
                src={preview}
                alt=""
                className="h-20 w-20 rounded-full border-2 border-amber-500/30 object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity hover:opacity-100">
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                ) : (
                  <Camera className="h-5 w-5 text-white" />
                )}
              </span>
            </button>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void pickAvatar(file);
                event.target.value = "";
              }}
            />

            <p className="text-sm text-muted-foreground">
              A picture is optional. Nothing here is verified as your likeness.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-username">Username</Label>
            <Input
              id="edit-username"
              value={username}
              maxLength={30}
              onChange={(event) => setUsername(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers and underscores.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-bio">Bio</Label>
            <Textarea
              id="edit-bio"
              value={bio}
              maxLength={500}
              rows={3}
              onChange={(event) => setBio(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-location">Location</Label>
            <Input
              id="edit-location"
              value={location}
              maxLength={100}
              onChange={(event) => setLocation(event.target.value)}
            />
            {/*
              Free text, shown on the profile card, parsed by nothing. The
              structured jurisdiction below is a separate question with a
              separate answer, because "Brooklyn, NY" cannot be counted and
              NY-8 can.
            */}
            <p className="text-xs text-muted-foreground">
              Shown on your profile. Not used to place your vote.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            {/* Saves on its own, immediately — it is a right rather than a form
                field, and taking it back must not be queued behind a Save. */}
            <DistrictPicker />
          </div>
        </div>

        <DialogFooter className="shrink-0 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending || uploading} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
