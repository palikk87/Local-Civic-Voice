/**
 * THE PICTURE SOMEBODY SEES BEFORE THEY SEE THE PAGE.
 *
 * A link to a law, pasted into a text message or onto Facebook, used to show
 * the same house image every time: the site's banner, identical for all 1,900
 * records. The preview is the whole of what most people ever see of a shared
 * link — they decide from it whether to tap — and ours said nothing about which
 * law it was.
 *
 * So each record gets its own card: the branch it came from, its number, its
 * title, and where the Public Pulse actually stands on it. It is the law card
 * from the app, drawn at the size the preview bots ask for.
 *
 * WHY DRAWN RATHER THAN SCREENSHOTTED. A real screenshot means running a
 * browser 1,900 times inside a deploy, and it captures a page built for a
 * scrolling reader — small type, a navigation bar, half a card cut off at the
 * fold. What a preview needs is the same information composed for a 1200×630
 * thumbnail that is often shown at a third of that. This draws it directly, at
 * that size, from the same numbers the page renders.
 *
 * WHEN NOBODY HAS VOTED, THE BAR SAYS SO. Painting an empty tally as a full bar
 * of opposition is the exact failure PublicPulseBar.tsx was rewritten to avoid,
 * and a share preview is the worst place to repeat it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const HERE = new URL(".", import.meta.url).pathname;
const FONT_DIR = join(HERE, "..", "assets", "fonts");

/** The felt table, its brass, and the two sides. Taken from src/index.css. */
const FELT = "#0C1D18";
const FELT_LIFTED = "#17362A";
const GOLD = "#F59E0B";
const AYE = "#4ADE80";
const NAY = "#9F1239";
const INK = "#FFFFFF";
const MUTED = "#8CA79B";
const NAY_TEXT = "#F4667F";
const GOLD_DIM = "#6B4E12";
const HAIRLINE = "#2C5C48";

const WIDTH = 1200;
const HEIGHT = 630;

/**
 * THE APP'S OWN TYPE, not a lookalike. Bodoni Moda sets the law's name on the
 * record page and Public Sans sets everything around it — src/index.css. A card
 * meant to look like the page has to be set in the page's faces or it reads as
 * somebody else's screenshot.
 */
const fonts = [
  { name: "Bodoni Moda", weight: 600, style: "normal", data: readFileSync(join(FONT_DIR, "BodoniModa-SemiBold.ttf")) },
  { name: "Public Sans", weight: 400, style: "normal", data: readFileSync(join(FONT_DIR, "PublicSans-Regular.ttf")) },
  { name: "Public Sans", weight: 600, style: "normal", data: readFileSync(join(FONT_DIR, "PublicSans-SemiBold.ttf")) },
  { name: "Public Sans", weight: 700, style: "normal", data: readFileSync(join(FONT_DIR, "PublicSans-Bold.ttf")) },
];

/** Satori takes React elements; this is the same shape without a JSX step. */
const h = (type, style, ...children) => {
  // Nulls are how "nobody is known" and "no portrait" are expressed above;
  // satori would otherwise try to lay them out.
  const kept = children.filter((child) => child !== null && child !== undefined);
  return {
    type,
    props: { style, ...(kept.length ? { children: kept.length === 1 ? kept[0] : kept } : {}) },
  };
};

const BRANCH = {
  bill: "BILL",
  executive_order: "EXECUTIVE ORDER",
  scotus_case: "SUPREME COURT",
};

/**
 * The record's number, said the way somebody would say it out loud.
 *
 * The slug already carries it — hr-4836-119, eo-14399 — so this reads that
 * rather than inventing a second source. A Supreme Court slug is a case name
 * and carries no number, so it gets the court instead of a fabricated citation.
 */
export function referenceLabel(record) {
  const slug = record.slug ?? "";
  if (record.referenceType === "executive_order") {
    const number = slug.replace(/^eo-/, "");
    return number ? `Executive Order ${number}` : "Executive Order";
  }
  if (record.referenceType === "scotus_case") return "Supreme Court of the United States";

  const bill = /^([a-z]+)-(\d+)-(\d+)$/.exec(slug);
  if (!bill) return "United States Congress";
  const [, kind, number, congress] = bill;
  const chamber =
    { hr: "H.R.", s: "S.", hjres: "H.J.Res.", sjres: "S.J.Res.", hconres: "H.Con.Res.", sconres: "S.Con.Res.", hres: "H.Res.", sres: "S.Res." }[kind] ??
    kind.toUpperCase();
  const ordinal = Number(congress);
  const suffix = ordinal % 10 === 1 && ordinal % 100 !== 11 ? "st" : ordinal % 10 === 2 && ordinal % 100 !== 12 ? "nd" : ordinal % 10 === 3 && ordinal % 100 !== 13 ? "rd" : "th";
  return `${chamber} ${number} · ${ordinal}${suffix} Congress`;
}

/**
 * A long title at 52px runs past three lines and off the card. Cut on a word,
 * and say it was cut — a title that simply stops mid-word reads as a rendering
 * fault rather than an abbreviation.
 */
function fitTitle(title) {
  const text = (title ?? "").replace(/\s+/g, " ").trim();
  const LIMIT = 66;
  if (text.length <= LIMIT) return text;
  return `${text.slice(0, LIMIT).replace(/\s+\S*$/, "")}…`;
}

/**
 * THE PUBLIC PULSE PANEL, as it stands on the record page.
 *
 * The same three parts in the same order: the bar, then Aye and Nay side by
 * side with their share and their count, then the total underneath.
 *
 * AN EMPTY TALLY IS DRAWN EMPTY. The page shows 0% and 0 votes on both sides
 * with a blank track, and says so; it does not paint a full bar of opposition.
 * That was a real bug on the page once (see PublicPulseBar.tsx) and a share
 * preview is the worst place to bring it back — most people who see this image
 * never open the page to be corrected.
 */
function pulsePanel(record) {
  const aye = record.supportVotes ?? 0;
  const nay = record.opposeVotes ?? 0;
  const total = aye + nay;
  const ayePct = total ? Math.round((aye / total) * 100) : 0;
  const nayPct = total ? 100 - ayePct : 0;

  const side = (label, pct, count, colour) =>
    h("div",
      {
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        flexBasis: 0,
        gap: 2,
        backgroundColor: "#102A21",
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 14,
        padding: "16px 18px",
      },
      h("div", { display: "flex", fontFamily: "Public Sans", fontSize: 15, fontWeight: 700, letterSpacing: 2, color: MUTED }, label),
      h("div", { display: "flex", fontFamily: "Bodoni Moda", fontSize: 52, fontWeight: 600, color: colour, lineHeight: 1.1 }, `${pct}%`),
      h("div", { display: "flex", fontFamily: "Public Sans", fontSize: 17, color: MUTED }, `${count.toLocaleString()} vote${count === 1 ? "" : "s"}`),
    );

  return h("div",
    {
      display: "flex",
      flexDirection: "column",
      width: 430,
      gap: 16,
      backgroundColor: FELT_LIFTED,
      border: `1px solid ${GOLD_DIM}`,
      borderRadius: 20,
      padding: 26,
    },
    h("div", { display: "flex", fontFamily: "Public Sans", fontSize: 17, fontWeight: 700, letterSpacing: 3, color: GOLD }, "PUBLIC PULSE"),

    total === 0
      ? h("div", { display: "flex", width: "100%", height: 16, borderRadius: 999, backgroundColor: "#1E4736" })
      : h("div", { display: "flex", width: "100%", height: 16, borderRadius: 999, backgroundColor: NAY, overflow: "hidden" },
          h("div", { display: "flex", width: `${ayePct}%`, height: "100%", backgroundColor: AYE }),
        ),

    h("div", { display: "flex", gap: 14 },
      side("AYE", ayePct, aye, AYE),
      side("NAY", nayPct, nay, NAY_TEXT),
    ),

    h("div",
      { display: "flex", justifyContent: "center", fontFamily: "Public Sans", fontSize: 17, color: MUTED },
      total === 0 ? "No recorded vote yet" : `${total.toLocaleString()} total votes cast`,
    ),
  );
}

/** The gold ring of the AYE & NAY seal, drawn rather than fetched. */
function seal() {
  return h("div",
    {
      display: "flex",
      width: 40,
      height: 40,
      borderRadius: 999,
      border: `2px solid ${GOLD}`,
      alignItems: "center",
      justifyContent: "center",
    },
    h("div", { display: "flex", width: 14, height: 14, borderRadius: 999, backgroundColor: GOLD }),
  );
}

/**
 * WHO IS BEHIND IT, WITH THEIR FACE — the same line the record page carries.
 *
 * "The photo personifies the page, otherwise it just feels bland." A preview is
 * the version of the page most people ever see, so it needs the person more
 * than the page does.
 *
 * NOTHING IS DRAWN WHEN NOBODY IS KNOWN. A per curiam ruling has no author and
 * a bill the provenance pass has not reached has no sponsor; both get no row
 * rather than a grey circle standing in for a human being. The portrait is
 * likewise optional — a face that would not download leaves the name, which is
 * the half that matters.
 */
function attributionRow(record) {
  const who = record.attribution;
  if (!who?.name) return null;

  const party =
    who.party === "D" ? "Democrat" : who.party === "R" ? "Republican" : who.party ? "Independent" : null;
  const under = [party, who.state].filter(Boolean).join(" — ");

  return h("div", { display: "flex", alignItems: "center", gap: 14, paddingTop: 4 },
    record.portrait
      ? {
          type: "img",
          props: {
            src: record.portrait,
            width: 56,
            height: 56,
            style: { borderRadius: 999, objectFit: "cover", border: `2px solid ${HAIRLINE}` },
          },
        }
      : null,
    h("div", { display: "flex", flexDirection: "column" },
      h("div", { display: "flex", fontSize: 22, fontWeight: 600, color: INK }, `${who.role} ${who.name}`),
      under ? h("div", { display: "flex", fontSize: 19, color: MUTED }, under) : null,
    ),
  );
}

function card(record) {
  return h("div",
    {
      display: "flex",
      flexDirection: "column",
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: FELT,
      padding: "44px 56px",
      fontFamily: "Public Sans",
    },

    // The masthead, the way the page wears it.
    h("div", { display: "flex", alignItems: "center", gap: 14 },
      seal(),
      h("div", { display: "flex", fontFamily: "Bodoni Moda", fontSize: 30, fontWeight: 600, letterSpacing: 1, color: INK }, "AYE"),
      h("div", { display: "flex", fontFamily: "Bodoni Moda", fontSize: 30, fontWeight: 600, color: GOLD }, "&"),
      h("div", { display: "flex", fontFamily: "Bodoni Moda", fontSize: 30, fontWeight: 600, letterSpacing: 1, color: INK }, "NAY"),
    ),

    // The law on the left, where the public stands on the right.
    h("div", { display: "flex", flexGrow: 1, alignItems: "center", gap: 44, paddingTop: 26, paddingBottom: 22 },
      h("div", { display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, gap: 18 },
        h("div", { display: "flex", fontSize: 17, fontWeight: 700, letterSpacing: 3, color: GOLD },
          BRANCH[record.referenceType] ?? "RECORD"),
        h("div",
          { display: "flex", fontFamily: "Bodoni Moda", fontSize: 58, fontWeight: 600, lineHeight: 1.14, color: INK },
          fitTitle(record.title)),
        h("div", { display: "flex", fontSize: 21, color: MUTED }, referenceLabel(record)),
        attributionRow(record),
      ),
      pulsePanel(record),
    ),

    // The hairline and the address, as the page closes.
    h("div", { display: "flex", flexDirection: "column", gap: 14 },
      h("div", { display: "flex", width: "100%", height: 1, backgroundColor: HAIRLINE }),
      h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" },
        h("div", { display: "flex", fontSize: 19, color: MUTED }, "Every tally is a public record."),
        h("div", { display: "flex", fontSize: 19, fontWeight: 600, color: GOLD }, "ayeandnay.com"),
      ),
    ),
  );
}

/** One record in, one PNG out. */
export async function renderCard(record) {
  const svg = await satori(card(record), { width: WIDTH, height: HEIGHT, fonts });
  return new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng();
}
