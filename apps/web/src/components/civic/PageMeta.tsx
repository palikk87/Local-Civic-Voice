import { useEffect } from "react";

/**
 * WHAT THIS PAGE IS, IN THE TAB AND IN A SHARED LINK.
 *
 * Every path on this site served one title and one description, written into
 * index.html: "AYE & NAY — Your voice on every bill, order, and ruling". So
 * every law anybody has ever shared to a group chat, to X or to Facebook
 * showed the site's banner rather than the law's name, and every tab read the
 * same thing.
 *
 * WHAT THIS FIXES AND WHAT IT DOES NOT. This runs in the browser, so it fixes
 * the tab, the history entry, and anything reading the live document. It does
 * NOT fix the preview a social network shows: those bots read the HTML as
 * served and do not run JavaScript. That is what scripts/prerender.mjs is for —
 * it writes these same tags into the file. The two are deliberately fed from
 * the same values so they cannot disagree.
 *
 * Tags are updated in place and never removed, so navigating between records
 * replaces the content rather than leaving a stack of stale ones behind.
 */
function upsert(selector: string, create: () => HTMLElement, content: string) {
  let tag = document.head.querySelector<HTMLElement>(selector);
  if (!tag) {
    tag = create();
    document.head.appendChild(tag);
  }
  if (tag instanceof HTMLMetaElement) tag.content = content;
  else tag.setAttribute("href", content);
}

export function PageMeta({
  title,
  description,
  canonical,
  type = "article",
}: {
  title: string;
  description?: string;
  /** The one address this page should be indexed under. */
  canonical?: string;
  type?: "website" | "article";
}) {
  useEffect(() => {
    document.title = title;

    const meta = (name: string, content: string, attr: "name" | "property" = "name") =>
      upsert(
        `meta[${attr}="${name}"]`,
        () => {
          const tag = document.createElement("meta");
          tag.setAttribute(attr, name);
          return tag;
        },
        content,
      );

    meta("og:title", title, "property");
    meta("twitter:title", title);
    meta("og:type", type, "property");

    if (description) {
      meta("description", description);
      meta("og:description", description, "property");
      meta("twitter:description", description);
    }

    if (canonical) {
      upsert(
        'link[rel="canonical"]',
        () => {
          const link = document.createElement("link");
          link.rel = "canonical";
          return link;
        },
        canonical,
      );
      meta("og:url", canonical, "property");
    }
  }, [title, description, canonical, type]);

  return null;
}
