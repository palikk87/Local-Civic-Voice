// Web port of mobile/src/components/CreatePostModal.tsx
import { useState, useRef, useCallback, type ChangeEvent } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  X,
  AtSign,
  Image as ImageIcon,
  Video,
  FileText,
  Scale,
  Gavel,
  ChevronRight,
  Play,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { useTimelineStore, type TaggedUser } from "@/lib/mobile/timeline-store";
import { currentUser } from "@/lib/mobile/mock-data";
import type { User } from "@/lib/mobile/types";
import { cn } from "@/lib/utils";
import ReferenceSearchModal, {
  type GovernmentReference,
  type ReferenceType,
} from "./ReferenceSearchModal";

interface CreatePostModalProps {
  visible: boolean;
  onClose: () => void;
  initialContent?: string;
  shareMode?: {
    type: "bill" | "post" | "executive_order" | "scotus_case";
    id: string;
    title: string;
  };
}

interface MediaItem {
  uri: string;
  type: "image" | "video";
  file?: File;
}

interface UploadedMedia {
  id: string;
  uri: string;
  type: "image" | "video";
  thumbnailUrl?: string;
}

type CreatePostStep = "reference" | "compose";

export default function CreatePostModal({
  visible,
  onClose,
  initialContent = "",
  shareMode,
}: CreatePostModalProps) {
  // Step state - if shareMode is provided, skip reference selection
  const [currentStep, setCurrentStep] = useState<CreatePostStep>(
    shareMode ? "compose" : "reference"
  );

  // Reference selection state
  const [showReferenceSearch, setShowReferenceSearch] = useState(false);
  const [selectedReference, setSelectedReference] = useState<GovernmentReference | null>(
    shareMode
      ? {
          id: shareMode.id,
          type: shareMode.type as ReferenceType,
          title: shareMode.title,
          status: "unknown",
        }
      : null
  );

  // Compose state
  const [content, setContent] = useState(initialContent);
  const [showUserSuggestions, setShowUserSuggestions] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Media state
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [, setUploadedMedia] = useState<UploadedMedia[]>([]);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const createPost = useTimelineStore((s) => s.createPost);
  const shareContent = useTimelineStore((s) => s.shareContent);
  const searchUsers = useTimelineStore((s) => s.searchUsers);

  const suggestedUsers = searchUsers(userQuery);

  const handleTextChange = useCallback(
    (text: string) => {
      setContent(text);

      // Check for @ mentions
      const lastAtIndex = text.lastIndexOf("@", cursorPosition);
      if (lastAtIndex !== -1) {
        const textAfterAt = text.slice(lastAtIndex + 1, cursorPosition + 1);
        const hasSpace = textAfterAt.includes(" ");

        if (!hasSpace && textAfterAt.length > 0) {
          setUserQuery(textAfterAt);
          setShowUserSuggestions(true);
        } else if (textAfterAt.length === 0) {
          setUserQuery("");
          setShowUserSuggestions(true);
        } else {
          setShowUserSuggestions(false);
        }
      } else {
        setShowUserSuggestions(false);
      }
    },
    [cursorPosition]
  );

  const handleSelectionChange = useCallback(() => {
    setCursorPosition(inputRef.current?.selectionStart ?? 0);
  }, []);

  const handleSelectUser = useCallback(
    (user: User) => {
      const lastAtIndex = content.lastIndexOf("@", cursorPosition);
      if (lastAtIndex !== -1) {
        const beforeAt = content.slice(0, lastAtIndex);
        const afterCursor = content.slice(cursorPosition);
        const newContent = `${beforeAt}@${user.username} ${afterCursor}`;
        setContent(newContent);
      }
      setShowUserSuggestions(false);
      inputRef.current?.focus();
    },
    [content, cursorPosition]
  );

  const handleReferenceSelect = (reference: GovernmentReference) => {
    setSelectedReference(reference);
    setCurrentStep("compose");
    setShowReferenceSearch(false);
  };

  const uploadMediaToServer = async (item: MediaItem): Promise<UploadedMedia | null> => {
    try {
      const formData = new FormData();
      if (item.file) {
        formData.append("file", item.file, item.file.name);
      }
      formData.append("type", item.type);

      const response = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        return {
          id: data.id,
          uri: data.url,
          type: item.type,
          thumbnailUrl: data.thumbnailUrl,
        };
      }

      // Fallback: use local URI as mock upload
      return {
        id: `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        uri: item.uri,
        type: item.type,
        thumbnailUrl: item.type === "video" ? item.uri : undefined,
      };
    } catch {
      // Fallback on error
      return {
        id: `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        uri: item.uri,
        type: item.type,
        thumbnailUrl: item.type === "video" ? item.uri : undefined,
      };
    }
  };

  const handlePickImage = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const newItems: MediaItem[] = files.map((file) => ({
      uri: URL.createObjectURL(file),
      type: "image",
      file,
    }));
    setMediaItems((prev) => [...prev, ...newItems].slice(0, 4));
    e.target.value = "";
  };

  const handlePickVideo = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const newItem: MediaItem = {
      uri: URL.createObjectURL(file),
      type: "video",
      file,
    };
    setMediaItems((prev) => [...prev, newItem].slice(0, 4));
    e.target.value = "";
  };

  const removeMedia = (index: number) => {
    setMediaItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePost = async () => {
    if (!selectedReference) return;
    if (!content.trim() && mediaItems.length === 0) return;

    setIsPosting(true);
    setPostError(null);

    try {
      // Upload media files
      let uploadedMediaIds: string[] = [];
      if (mediaItems.length > 0) {
        setIsUploadingMedia(true);
        const uploadPromises = mediaItems.map((item) => uploadMediaToServer(item));
        const results = await Promise.all(uploadPromises);
        const successful = results.filter((r): r is UploadedMedia => r !== null);
        setUploadedMedia(successful);
        uploadedMediaIds = successful.map((m) => m.id);
        setIsUploadingMedia(false);
      }

      // Publish to the server. Both paths attach the post to the selected
      // reference so it counts toward that action's public pulse.
      if (shareMode) {
        await shareContent(
          shareMode.type as "bill" | "executive_order" | "scotus_case",
          shareMode.id,
          shareMode.title,
          content,
          uploadedMediaIds
        );
      } else {
        await createPost(
          content,
          "text",
          selectedReference.type,
          selectedReference.id,
          selectedReference.title,
          uploadedMediaIds
        );
      }

      // Reset and close
      resetState();
      onClose();
    } catch (error) {
      setIsPosting(false);
      setIsUploadingMedia(false);
      setPostError(error instanceof Error ? error.message : "Could not post. Please try again.");
    }
  };

  const resetState = () => {
    setContent("");
    setSelectedReference(null);
    setCurrentStep(shareMode ? "compose" : "reference");
    setMediaItems([]);
    setUploadedMedia([]);
    setShowUserSuggestions(false);
    setIsPosting(false);
    setIsUploadingMedia(false);
    setPostError(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const canPost = Boolean(selectedReference) && (content.trim().length > 0 || mediaItems.length > 0);

  const getReferenceIcon = (type: ReferenceType) => {
    switch (type) {
      case "bill":
        return <FileText size={18} color="#F59E0B" />;
      case "executive_order":
        return <Scale size={18} color="#F59E0B" />;
      case "scotus_case":
        return <Gavel size={18} color="#F59E0B" />;
    }
  };

  const getReferenceTypeBadge = (type: ReferenceType) => {
    switch (type) {
      case "bill":
        return { bg: "bg-blue-500/20", text: "text-blue-400", label: "Bill" };
      case "executive_order":
        return { bg: "bg-purple-500/20", text: "text-purple-400", label: "Executive Order" };
      case "scotus_case":
        return { bg: "bg-rose-500/20", text: "text-rose-400", label: "SCOTUS Case" };
    }
  };

  const renderReferenceStep = () => (
    <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1">
      <div className="px-4 py-6">
        <p className="text-white text-xl font-bold mb-2">What are you responding to?</p>
        <p className="text-slate-400 text-base">
          Select a bill, executive order, or Supreme Court case to reference in your post.
        </p>
      </div>

      {/* Quick select buttons */}
      <div className="px-4 space-y-3">
        <button
          onClick={() => setShowReferenceSearch(true)}
          className="w-full flex items-center p-4 bg-slate-800/60 rounded-xl border border-slate-700/50 hover:bg-slate-700/60 transition-colors text-left"
        >
          <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
            <FileText size={24} color="#3B82F6" />
          </div>
          <div className="flex-1 ml-4">
            <p className="text-white font-semibold text-base">Search Bills</p>
            <p className="text-slate-400 text-sm">Congressional bills and legislation</p>
          </div>
          <ChevronRight size={20} color="#64748B" />
        </button>

        <button
          onClick={() => setShowReferenceSearch(true)}
          className="w-full flex items-center p-4 bg-slate-800/60 rounded-xl border border-slate-700/50 hover:bg-slate-700/60 transition-colors text-left"
        >
          <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
            <Scale size={24} color="#A855F7" />
          </div>
          <div className="flex-1 ml-4">
            <p className="text-white font-semibold text-base">Executive Orders</p>
            <p className="text-slate-400 text-sm">Presidential executive orders</p>
          </div>
          <ChevronRight size={20} color="#64748B" />
        </button>

        <button
          onClick={() => setShowReferenceSearch(true)}
          className="w-full flex items-center p-4 bg-slate-800/60 rounded-xl border border-slate-700/50 hover:bg-slate-700/60 transition-colors text-left"
        >
          <div className="w-12 h-12 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
            <Gavel size={24} color="#F43F5E" />
          </div>
          <div className="flex-1 ml-4">
            <p className="text-white font-semibold text-base">Supreme Court Cases</p>
            <p className="text-slate-400 text-sm">SCOTUS decisions and pending cases</p>
          </div>
          <ChevronRight size={20} color="#64748B" />
        </button>
      </div>
    </MotionDiv>
  );

  const renderComposeStep = () => {
    const badge = selectedReference ? getReferenceTypeBadge(selectedReference.type) : null;

    return (
      <MotionDiv initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex-1 flex flex-col min-h-0">
        {/* Selected Reference Preview */}
        {selectedReference ? (
          <button
            onClick={() => {
              if (!shareMode) {
                setCurrentStep("reference");
              }
            }}
            className="mx-4 mt-4 p-3 bg-slate-800/60 rounded-xl border border-slate-700/50 hover:bg-slate-700/60 transition-colors text-left shrink-0"
          >
            <div className="flex items-start">
              <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center mr-3 shrink-0">
                {getReferenceIcon(selectedReference.type)}
              </div>
              <div className="flex-1">
                <p className="text-slate-400 text-xs mb-1">Referencing</p>
                <p className="text-white font-medium line-clamp-2">{selectedReference.title}</p>
                {badge ? (
                  <div className="flex items-center mt-2">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", badge.bg, badge.text)}>
                      {badge.label}
                    </span>
                    {!shareMode ? (
                      <span className="text-slate-500 text-xs ml-2">Tap to change</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </button>
        ) : null}

        {/* Author */}
        <div className="flex px-4 pt-4 shrink-0">
          <img src={currentUser.avatar} alt={currentUser.displayName} className="w-12 h-12 rounded-full" />
          <div className="flex-1 ml-3">
            <p className="text-white font-semibold">{currentUser.displayName}</p>
            <p className="text-slate-400 text-sm">@{currentUser.username}</p>
          </div>
        </div>

        {/* Input */}
        <div className="flex-1 px-4 pt-4 relative overflow-y-auto min-h-0">
          <textarea
            ref={inputRef}
            value={content}
            onChange={(e) => handleTextChange(e.target.value)}
            onSelect={handleSelectionChange}
            placeholder="Share your thoughts on this..."
            autoFocus
            className="w-full bg-transparent text-white text-lg outline-none resize-none placeholder:text-slate-500"
            style={{ minHeight: 100 }}
          />

          {/* Posting failure — the post was not saved, so say so plainly */}
          {postError ? (
            <MotionDiv
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 flex items-start bg-red-500/15 border border-red-500/30 rounded-xl px-3 py-2.5"
            >
              <AlertCircle size={16} color="#F87171" className="mt-0.5 shrink-0" />
              <p className="text-red-300 text-sm ml-2 flex-1">{postError}</p>
            </MotionDiv>
          ) : null}

          {/* Media Previews */}
          {mediaItems.length > 0 ? (
            <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
              <div className="flex gap-2 overflow-x-auto">
                {mediaItems.map((item, index) => (
                  <div key={index} className="relative shrink-0">
                    <img src={item.uri} alt="" className="w-24 h-24 rounded-lg object-cover" />
                    {item.type === "video" ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg">
                        <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center">
                          <Play size={16} color="#0F172A" />
                        </div>
                      </div>
                    ) : null}
                    <button
                      onClick={() => removeMedia(index)}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center"
                    >
                      <X size={14} color="#FFFFFF" />
                    </button>
                  </div>
                ))}
              </div>
            </MotionDiv>
          ) : null}

          {/* User Suggestions */}
          {showUserSuggestions && suggestedUsers.length > 0 ? (
            <MotionDiv
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-0 left-4 right-4 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden overflow-y-auto"
              style={{ maxHeight: 200 }}
            >
              {suggestedUsers.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectUser(item)}
                  className="w-full flex items-center p-3 border-b border-slate-700/50 hover:bg-slate-700/40 text-left"
                >
                  <img src={item.avatar} alt={item.displayName} className="w-10 h-10 rounded-full" />
                  <div className="ml-3">
                    <p className="text-white font-medium">{item.displayName}</p>
                    <p className="text-slate-400 text-sm">@{item.username}</p>
                  </div>
                </button>
              ))}
            </MotionDiv>
          ) : null}
        </div>

        {/* Bottom Actions */}
        <div className="px-4 py-3 border-t border-slate-800 shrink-0">
          {/* Media buttons */}
          <div className="flex items-center mb-3">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handlePickImage}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handlePickVideo}
            />

            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={mediaItems.length >= 4}
              className={cn(
                "flex items-center p-2 rounded-lg mr-2",
                mediaItems.length >= 4 ? "bg-slate-800/30" : "bg-slate-800/60"
              )}
            >
              <ImageIcon size={20} color={mediaItems.length >= 4 ? "#475569" : "#F59E0B"} />
              <span
                className={cn(
                  "text-sm ml-1 font-medium",
                  mediaItems.length >= 4 ? "text-slate-600" : "text-amber-500"
                )}
              >
                Photo
              </span>
            </button>

            <button
              onClick={() => videoInputRef.current?.click()}
              disabled={mediaItems.length >= 4}
              className={cn(
                "flex items-center p-2 rounded-lg mr-2",
                mediaItems.length >= 4 ? "bg-slate-800/30" : "bg-slate-800/60"
              )}
            >
              <Video size={20} color={mediaItems.length >= 4 ? "#475569" : "#F59E0B"} />
              <span
                className={cn(
                  "text-sm ml-1 font-medium",
                  mediaItems.length >= 4 ? "text-slate-600" : "text-amber-500"
                )}
              >
                Video
              </span>
            </button>
          </div>

          <div className="flex items-center">
            <button
              onClick={() => {
                const newContent = content + "@";
                setContent(newContent);
                setCursorPosition(newContent.length);
                setShowUserSuggestions(true);
                setUserQuery("");
                inputRef.current?.focus();
              }}
              className="flex items-center p-2 rounded-lg bg-slate-800/60"
            >
              <AtSign size={20} color="#F59E0B" />
              <span className="text-amber-500 text-sm ml-1 font-medium">Mention</span>
            </button>

            <div className="flex-1" />

            <span className="text-slate-500 text-sm">{content.length}/500</span>
          </div>
        </div>
      </MotionDiv>
    );
  };

  return (
    <>
      <Dialog open={visible} onOpenChange={(open) => (!open ? handleClose() : undefined)}>
        <DialogContent className="bg-slate-900 border-slate-800 p-0 max-w-lg w-full h-[85vh] flex flex-col overflow-hidden [&>button]:hidden">
          <div className="flex-1 flex flex-col min-h-0 bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
              <button onClick={handleClose} className="w-10 h-10 flex items-center justify-center">
                <X size={24} color="#94A3B8" />
              </button>

              <span className="text-white font-semibold text-lg">
                {currentStep === "reference" ? "New Post" : "Compose"}
              </span>

              <button
                onClick={handlePost}
                disabled={!canPost || isPosting || isUploadingMedia}
                className={cn(
                  "px-4 py-2 rounded-full flex items-center justify-center min-w-16",
                  canPost && !isPosting && !isUploadingMedia ? "bg-amber-500" : "bg-slate-700"
                )}
              >
                {isPosting || isUploadingMedia ? (
                  <Loader2 size={16} className="animate-spin text-slate-900" />
                ) : (
                  <span className={cn("font-semibold", canPost ? "text-slate-900" : "text-slate-500")}>
                    Post
                  </span>
                )}
              </button>
            </div>

            {/* Content based on step */}
            {currentStep === "reference" ? renderReferenceStep() : renderComposeStep()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reference Search Modal */}
      <ReferenceSearchModal
        visible={showReferenceSearch}
        onClose={() => setShowReferenceSearch(false)}
        onSelect={handleReferenceSelect}
      />
    </>
  );
}
