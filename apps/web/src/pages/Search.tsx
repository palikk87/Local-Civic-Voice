import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search as SearchIcon, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReferenceCard } from "@/components/civic/ReferenceCard";
import { useDebounce } from "@/hooks/use-debounce";
import { civicApi, postsApi, type GovReference, type PostSearchResult } from "@/lib/civic";
import { api } from "@/lib/api";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

interface SearchResults {
  references: GovReference[];
  nextCursor?: string;
  hasMore: boolean;
}

interface UserResult {
  id: string;
  displayName: string;
  username: string;
  avatar: string;
  bio?: string;
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const debouncedQuery = useDebounce(query, 300);
  const enabled = debouncedQuery.trim().length > 0;
  const [activeTab, setActiveTab] = useState("references");

  // Search references
  const { data: refData, isLoading: refLoading, hasNextPage: refHasNext, fetchNextPage: refFetchNext } =
    useInfiniteQuery({
      queryKey: ["search-references", debouncedQuery],
      queryFn: ({ pageParam }) =>
        civicApi.listReferences({
          search: debouncedQuery,
          limit: 20,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) =>
        lastPage.hasMore ? lastPage.nextCursor : undefined,
      enabled,
    });

  const references = refData?.pages?.flatMap((p) => p.references ?? []) ?? [];

  // PEOPLE AND POSTS, both of which already had endpoints.
  //
  // This screen said "User search — coming soon" over /api/users/search, which
  // has worked the whole time. And nothing anywhere searched what people had
  // written, so the only way to reach a conversation about a bill was to know
  // which bill it was about first.
  const { data: peopleData, isLoading: peopleLoading } = useQuery({
    queryKey: ["search-people", debouncedQuery],
    queryFn: () =>
      api.get<{ results: UserResult[] }>(
        `/api/users/search?q=${encodeURIComponent(debouncedQuery)}`,
      ),
    enabled,
  });
  const people = peopleData?.results ?? [];

  const { data: postData, isLoading: postLoading } = useQuery({
    queryKey: ["search-posts", debouncedQuery],
    queryFn: () => postsApi.search(debouncedQuery),
    enabled,
  });
  const posts: PostSearchResult[] = postData?.results ?? [];

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setSearchParams(value ? { q: value } : {}, { replace: true });
  };

  const clearSearch = () => {
    setQuery("");
    setSearchParams({}, { replace: true });
  };

  return (
    <AppShell wide>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <SearchIcon className="h-6 w-6 text-accent" />
            Search
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find legislation, users, and discussions.
          </p>
        </div>

        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={handleSearch}
            placeholder="Search legislation, users, topics…"
            className="h-12 rounded-2xl pl-9 pr-10"
            autoFocus
          />
          {query ? (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {!enabled ? (
          <div className="rounded-2xl border border-dashed border-border py-16 text-center">
            <SearchIcon className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-display text-lg text-foreground">Start searching</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter a query to find legislation, users, and discussions.
            </p>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList>
              <TabsTrigger value="references">
                Legislation
              </TabsTrigger>
              <TabsTrigger value="posts">
                Posts
              </TabsTrigger>
              <TabsTrigger value="users">
                People
              </TabsTrigger>
            </TabsList>

            <TabsContent value="references" className="mt-6">
              {refLoading ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-64 rounded-lg" />
                  ))}
                </div>
              ) : references.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-20 text-center">
                  <SearchIcon className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-3 font-display text-lg text-foreground">
                    No references found
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try a different search term.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {references.map((ref, i) => (
                      <ReferenceCard key={ref.id} reference={ref} index={i} />
                    ))}
                  </div>

                  {refHasNext ? (
                    <div className="mt-10 flex justify-center">
                      <Button
                        variant="outline"
                        onClick={() => refFetchNext()}
                      >
                        Load more
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </TabsContent>

            <TabsContent value="posts" className="mt-6">
              {postLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-24 w-full rounded-xl" />
                  ))}
                </div>
              ) : posts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-20 text-center">
                  <p className="font-display text-lg text-foreground">Nothing said about this yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Searching matches what people wrote and the law they wrote it about.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {posts.map((post) => (
                    <Link
                      key={post.id}
                      to={
                        post.governmentReferenceId
                          ? `/reference/${post.governmentReferenceId}`
                          : "/timeline"
                      }
                      className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/40"
                    >
                      <p className="text-sm font-semibold text-foreground">
                        {post.author.displayName}{" "}
                        <span className="font-normal text-muted-foreground">
                          @{post.author.username}
                        </span>
                      </p>
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {post.content}
                      </p>
                      {post.referenceTitle ? (
                        <p className="mt-2 truncate text-xs text-muted-foreground">
                          on {post.referenceTitle}
                        </p>
                      ) : null}
                    </Link>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="users" className="mt-6">
              {peopleLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-xl" />
                  ))}
                </div>
              ) : people.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-20 text-center">
                  <p className="font-display text-lg text-foreground">Nobody by that name</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {people.map((person) => (
                    <Link
                      key={person.id}
                      to={`/user/${person.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/40"
                    >
                      <img
                        src={person.avatar}
                        alt=""
                        className="h-10 w-10 rounded-full border border-border"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {person.displayName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          @{person.username}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}
