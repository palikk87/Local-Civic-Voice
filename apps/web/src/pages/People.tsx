// Web port of webapp/mobile/src/app/(tabs)/people.tsx
// The mobile screen's Supabase queries are hard-disabled; the backend serves the
// same three sections at /api/users/discover|active|new plus /api/users/search.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { failureMessage } from "@/lib/request-failure";
import { Search, UserPlus, TrendingUp, Clock, X, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { UserCard } from "@/components/people/UserCard";
import { SectionHeader } from "@/components/people/SectionHeader";
import { useCurrentUser } from "@/hooks/use-civic-auth";
import {
  useDiscoverUsers,
  useActiveUsers,
  useNewUsers,
  useSearchUsers,
  queryKeys,
} from "@/lib/mobile/api-hooks";
import { useDebounce } from "@/hooks/use-debounce";

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
    </div>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="rounded-2xl bg-card p-6 text-center">
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

export default function People() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const currentUserId = user?.id;
  const [searchQuery, setSearchQuery] = useState<string>("");
  const debouncedQuery = useDebounce(searchQuery, 350);

  const {
    data: suggestedData,
    isLoading: suggestedLoading,
    isError: suggestedFailed,
    error: suggestedError,
  } = useDiscoverUsers();
  const {
    data: activeData,
    isLoading: activeLoading,
    isError: activeFailed,
    error: activeError,
  } = useActiveUsers();
  const { data: newData, isLoading: newMembersLoading } = useNewUsers();
  const { data: searchData, isLoading: searchLoading } = useSearchUsers(debouncedQuery);

  const suggestedUsers = suggestedData?.results ?? [];
  const activeCitizens = activeData?.results ?? [];
  const newMembers = newData?.results ?? [];
  const searchResults = searchData?.results ?? [];

  const handleUserPress = (userId: string) => {
    navigate(`/user/${userId}`);
  };

  const handleFollowChange = () => {
    // Invalidate queries to refresh follow states
    queryClient.invalidateQueries({ queryKey: queryKeys.usersDiscover() });
    queryClient.invalidateQueries({ queryKey: queryKeys.usersActive() });
    queryClient.invalidateQueries({ queryKey: queryKeys.usersNew() });
  };

  const isSearching = searchQuery.length > 0;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="pb-4 pt-2">
          <h1 className="mb-4 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Discover People
          </h1>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or username..."
              autoCapitalize="none"
              autoCorrect="off"
              className="h-12 rounded-xl pl-11 pr-10 text-[15px]"
            />
            {searchQuery.length > 0 ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X size={18} strokeWidth={2} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="pb-8">
          {/* Search Results */}
          {isSearching ? (
            <div>
              <p className="mb-3 text-sm text-muted-foreground">
                {searchLoading
                  ? "Searching..."
                  : `${searchResults.length} results for "${searchQuery}"`}
              </p>
              {searchLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
                </div>
              ) : searchResults.length > 0 ? (
                searchResults.map((u) => (
                  <UserCard
                    key={u.id}
                    user={u}
                    currentUserId={currentUserId}
                    onPress={() => handleUserPress(u.id)}
                    onFollowChange={handleFollowChange}
                  />
                ))
              ) : (
                <div className="py-8 text-center">
                  <p className="text-muted-foreground">No users found matching your search.</p>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Suggested For You */}
              <SectionHeader
                icon={<UserPlus size={18} color="#F59E0B" strokeWidth={2} />}
                title="Suggested For You"
                subtitle="People you might know"
              />
              {suggestedLoading ? (
                <LoadingBlock />
              ) : suggestedUsers.length > 0 ? (
                suggestedUsers.slice(0, 3).map((u) => (
                  <UserCard
                    key={u.id}
                    user={u}
                    currentUserId={currentUserId}
                    onPress={() => handleUserPress(u.id)}
                    onFollowChange={handleFollowChange}
                  />
                ))
              ) : suggestedFailed ? (
                /* "No suggestions" is a statement about the people on this
                   platform. It must not be produced by a failed request. */
                <EmptyBlock message={failureMessage(suggestedError, "suggestions").detail} />
              ) : (
                <EmptyBlock message="No suggestions available right now." />
              )}

              {/* Active Citizens */}
              <SectionHeader
                icon={<TrendingUp size={18} color="#22C55E" strokeWidth={2} />}
                title="Active Citizens"
                subtitle="Most engaged community members"
              />
              {activeLoading ? (
                <LoadingBlock />
              ) : activeCitizens.length > 0 ? (
                activeCitizens.slice(0, 3).map((u) => (
                  <UserCard
                    key={u.id}
                    user={u}
                    currentUserId={currentUserId}
                    onPress={() => handleUserPress(u.id)}
                    onFollowChange={handleFollowChange}
                  />
                ))
              ) : activeFailed ? (
                <EmptyBlock message={failureMessage(activeError, "this list").detail} />
              ) : (
                <EmptyBlock message="No active citizens to show." />
              )}

              {/* New Members */}
              <SectionHeader
                icon={<Clock size={18} color="#3B82F6" strokeWidth={2} />}
                title="New Members"
                subtitle="Recently joined the community"
              />
              {newMembersLoading ? (
                <LoadingBlock />
              ) : newMembers.length > 0 ? (
                newMembers.slice(0, 3).map((u) => (
                  <UserCard
                    key={u.id}
                    user={u}
                    currentUserId={currentUserId}
                    onPress={() => handleUserPress(u.id)}
                    onFollowChange={handleFollowChange}
                  />
                ))
              ) : (
                <EmptyBlock message="No new members to show." />
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
