# The reference app, as it was built

Two built chunks captured from `civicvoice.vibecode.run` on 2026-08-17, kept
because that deployment is somebody else's and can stop existing without notice.

They are minified production output, not source — nobody should read them for
style. They are here as *evidence*, because twice now the question "how did the
old build actually do this" has been answerable only by fetching them, and
answering it from memory produced a wrong conclusion both times.

| file | what it settles |
|---|---|
| `CitizensBrief.chunk.js` | The brief card: its four states, its copy, and the fact that the only button it ever had was "Check the source again" in the empty state. There was no "Get Citizen Brief" button in the deployed build. |
| `use-government-references.chunk.js` | The data hook. Character-for-character the same polling design this repo had — a 4s `refetchInterval` while `contentStatus` is `brief_pending` or `fetching`. |

That second one is the important one. It proves the old client and ours were the
same, so the load loop was never a client bug: the old build looked fine because
its server finished the work and settled the row. When the server does not
settle, that identical client spins forever.

Both were superseded on 2026-08-17. The brief is now asked for rather than
started automatically, every state terminates, and the brief itself is one
neutral paragraph plus the case for and against — written from the full official
text of the law and nothing else. See `backend/src/services/citizen-brief.ts`.
