-- Every fabricated vote, gone.
--
-- Each record carried a "seed tally" — between 400 and 4,999 invented supporters
-- and between 300 and 3,999 invented opponents, derived from a hash of its id —
-- so that a brand-new card would not appear with a dead 0-0. Those numbers were
-- added into the public tally, which is the Public Pulse: the number this
-- platform exists to report, the number the B2B feed sells, and the number
-- Article III of the Bill of Rights promises is "the true will of the people".
--
-- A live check found all 33 stored records carrying seed votes and not one
-- carrying a real one. The entire published pulse was invented.
--
-- The Constitution of this platform, Article III, Section 3: every data point
-- must link back to an official source "to prevent the 'Digital Government'
-- from drifting into fiction". A hash of a bill number is not a source.
--
-- WHAT THIS DOES
--
-- `supportVotes` and `opposeVotes` hold the public tally: real weighted votes
-- PLUS the seed layer. Subtracting the seed leaves exactly the real weighted
-- count, so no real vote is lost and no arithmetic is guessed. GREATEST(...,0)
-- guards the one case where they could disagree — a row whose tally was written
-- before its seed was, which would otherwise go negative.
--
-- The seed columns are set to zero and stay in the schema. Dropping them would
-- not be additive, and keeping them at zero costs nothing: the code that wrote
-- them is deleted, and every remaining reader adds zero.
--
-- WHAT CARDS LOOK LIKE AFTER THIS
--
-- Mostly 0-0, until people vote. That is the point. A card that says nobody has
-- voted yet is telling the truth; a card that says four thousand people support
-- a bill nobody has read is not, and the second one poisons every number
-- downstream of it — the pulse, the trending list, the enterprise feed.
--
-- IDEMPOTENT: after this runs, both seed columns are zero, so a second run
-- subtracts nothing.
--
-- Touches only GovernmentReference. This database is shared with another
-- project.

UPDATE "GovernmentReference"
   SET "supportVotes" = GREATEST("supportVotes" - "seedSupport", 0),
       "opposeVotes"  = GREATEST("opposeVotes" - "seedOppose", 0),
       "seedSupport"  = 0,
       "seedOppose"   = 0
 WHERE "seedSupport" <> 0 OR "seedOppose" <> 0;
