/**
 * Seeds sample citizen accounts and posts so the social feed feels alive.
 * Posts are attached to real government references (bills / orders / rulings),
 * matching the Civic Voice model where every post is commentary on legislation.
 *
 * Idempotent: skips users/posts that already exist.
 */
import { auth } from "../src/auth";
import { prisma } from "../src/prisma";

const CITIZENS = [
  { username: "maria_advocate", name: "Maria Alvarez", bio: "Community organizer. Housing & healthcare." },
  { username: "j_thompson", name: "James Thompson", bio: "Veteran. Small business owner. Fiscal hawk." },
  { username: "priya_reads", name: "Priya Nair", bio: "Law student following SCOTUS closely." },
  { username: "deshawn_civic", name: "DeShawn Carter", bio: "Voting rights. Climate. Local politics nerd." },
  { username: "kelly_pnw", name: "Kelly Brooks", bio: "Teacher in the PNW. Education policy watcher." },
];

// Post templates keyed loosely by topic; referenceTitle filled from the real ref.
const POST_TEMPLATES = [
  "This ruling is going to ripple out for years. Still reading the full opinion but the reasoning on {t} feels narrower than the headlines suggest.",
  "Finally something concrete. Whatever side you're on, {t} deserves a real public debate — not just cable news soundbites.",
  "Voted OPPOSE on this. The intent behind {t} is good but the implementation details worry me.",
  "Voted SUPPORT. We've waited too long for movement on {t}. Curious where everyone else lands.",
  "Can someone break down what {t} actually changes day-to-day? The summary is dense.",
  "The Public Pulse on {t} is way more split than I expected. That's… actually kind of healthy?",
  "My representative has been silent on {t}. Calling their office tomorrow. Who's with me?",
];

async function ensureCitizen(c: (typeof CITIZENS)[number]) {
  const email = `${c.username}@civicvoice.app`;
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username: c.username }] },
  });
  if (existing) return existing;

  await auth.api.signUpEmail({
    body: { email, password: "CivicVoice2024!", name: c.name },
  });
  return prisma.user.update({
    where: { email },
    data: { username: c.username, bio: c.bio },
  });
}

async function main() {
  const refs = await prisma.governmentReference.findMany({
    take: 8,
    orderBy: { createdAt: "desc" },
    select: { id: true, referenceType: true, title: true },
  });

  if (refs.length === 0) {
    console.log("No government references found — nothing to attach posts to.");
    return;
  }

  const existingPosts = await prisma.post.count();
  if (existingPosts > 0) {
    console.log(`Feed already has ${existingPosts} posts — skipping post seed.`);
  }

  const users = [];
  for (const c of CITIZENS) users.push(await ensureCitizen(c));
  console.log(`Ensured ${users.length} citizen accounts.`);

  if (existingPosts === 0) {
    let created = 0;
    for (let i = 0; i < POST_TEMPLATES.length; i++) {
      const ref = refs[i % refs.length];
      const author = users[i % users.length];
      const template = POST_TEMPLATES[i];
      // refs comes from the database and can legitimately be empty, in which
      // case the modulo above yields undefined rather than wrapping.
      if (!ref || !author || !template) continue;
      const content = template.replace(/\{t\}/g, `"${ref.title}"`);
      await prisma.post.create({
        data: {
          content,
          authorId: author.id,
          referenceType: ref.referenceType,
          referenceId: ref.id,
          referenceTitle: ref.title,
        },
      });
      created++;
    }
    console.log(`Created ${created} sample posts.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
