// First-launch tutorial: a short spotlight tour (~60 seconds). Replayable from Settings.
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { Button } from "@/components/ui/button";

const SEEN_KEY = "contextide:tutorial-seen";

export const tutorialSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
};

export function startTour() {
  useStore.setState({ tour: 0, left: true, right: true, rendered: false, modal: null, palette: false, view: { t: "version" } });
}
export function endTour() {
  markSeen();
  useStore.setState({ tour: null });
}

interface Step {
  target?: string;
  place?: "right" | "left" | "below" | "above";
  title: string;
  body: ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Welcome to ContextIDE",
    body: (
      <>
        What goes into a model's context decides what comes out. This is a writing desk for composing prompts out of reusable blocks, trying alternatives side by side, and testing them against your models. Everything is plain text in a folder.
      </>
    ),
  },
  {
    target: "[data-testid=version-tabs]",
    place: "below",
    title: "Projects and versions",
    body: <>A project is one workflow. Each tab is an alternative version of its prompt — A, B, C — with a subtitle for the idea behind it. Fork one with + to try something new.</>,
  },
  {
    target: ".cx-canvas",
    place: "right",
    title: "The page",
    body: (
      <>
        Click anywhere and type freeform text; every card sits on its own line. Type <kbd>/</kbd> on an empty line to insert a block, or select text and right-click to turn it into a directive or a section.
      </>
    ),
  },
  {
    target: ".cx-canvas .cx-section:has(.cx-directive, .cx-use)",
    place: "right",
    title: "Directives and sections",
    body: (
      <>
        A <b>directive</b> is a one- or two-sentence instruction. A <b>section</b> groups directives and text under a title, rendered as a <code>## heading</code>, <code>&lt;xml&gt;</code> tags, or no frame at all.
      </>
    ),
  },
  {
    target: "[data-testid=library]",
    place: "right",
    title: "The library",
    body: (
      <>
        Blocks you reuse across projects. Drag one onto the page and it stays a <b>live reference</b>. Blocks can have <b>flavors</b> — Claude, Gemini, General — and the version's flavor picks the wording.
      </>
    ),
  },
  {
    target: "[data-testid=group-data]",
    place: "right",
    title: "Data, insertions, tools",
    body: (
      <>
        <b>Data</b> sources hold the items under test, with transforms like shuffle, head and template. <b>Insertions</b> drop in values like today's date or a variable. <b>Tools</b> and <b>schemas</b> define function calls and structured output.
      </>
    ),
  },
  {
    target: "[data-testid=status]",
    place: "above",
    title: "Know your context",
    body: <>Estimated tokens, and the <b>stable prefix</b>: everything before the first part that changes between runs — the part a prompt cache can reuse. It's tinted on the page.</>,
  },
  {
    target: "[data-testid=right-panel]",
    place: "left",
    title: "Run and compare",
    body: <>Run against any OpenAI-compatible endpoint, like LM Studio or llama-server. Runs are saved; score them against an answer key, diff outputs, and ablate cards to see which ones matter.</>,
  },
];

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function useTargetBox(selector: string | undefined, step: number): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = selector ? document.querySelector(selector) : null;
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight);
      setBox({ top: top - 6, left: r.left - 6, width: r.width + 12, height: Math.max(0, bottom - top) + 12 });
    };
    measure();
    const t = window.setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [selector, step]);
  return box;
}

const CARD_W = 340;

export function Tour() {
  const step = useStore((s) => s.tour);
  const vfs = useStore((s) => s.vfs);
  const s = step === null ? null : STEPS[step];
  const box = useTargetBox(s?.target, step ?? -1);

  // first launch: start once a workspace is open
  useEffect(() => {
    if (vfs && !tutorialSeen() && useStore.getState().tour === null) startTour();
  }, [vfs]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step]);

  if (step === null || !s) return null;
  const last = step === STEPS.length - 1;
  function next() {
    const cur = useStore.getState().tour;
    if (cur === null) return;
    if (cur >= STEPS.length - 1) endTour();
    else useStore.setState({ tour: cur + 1 });
  }
  function back() {
    const cur = useStore.getState().tour;
    if (cur) useStore.setState({ tour: cur - 1 });
  }

  // place the card next to the target, clamped to the viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let style: React.CSSProperties;
  if (!box) style = { left: vw / 2 - CARD_W / 2, top: vh * 0.28 };
  else {
    const gap = 14;
    let left = box.left;
    let top = box.top;
    switch (s.place) {
      case "right":
        left = box.left + box.width + gap;
        top = box.top + 24;
        break;
      case "left":
        left = box.left - CARD_W - gap;
        top = box.top + 24;
        break;
      case "above":
        top = box.top - 220;
        left = box.left + box.width / 2 - CARD_W / 2;
        break;
      default:
        top = box.top + box.height + gap;
    }
    style = { left: Math.min(Math.max(12, left), vw - CARD_W - 12), top: Math.min(Math.max(12, top), vh - 240) };
  }

  return (
    <div className="cx-tour" data-testid="tour" role="dialog" aria-label="Tutorial">
      {box ? <div className="cx-tour-spot" style={box} /> : <div className="cx-tour-dim" />}
      <div className="cx-tour-card" style={{ ...style, width: CARD_W }}>
        <div className="cx-tour-step">
          {step + 1} / {STEPS.length}
        </div>
        <h3>{s.title}</h3>
        <p>{s.body}</p>
        <div className="cx-tour-foot">
          <Button variant="ghost" size="sm" onClick={endTour} data-testid="tour-skip">
            Skip
          </Button>
          <span className="cx-tour-dots">
            {STEPS.map((_, i) => (
              <span key={i} className={i === step ? "on" : ""} />
            ))}
          </span>
          {step > 0 && (
            <Button variant="outline" size="sm" onClick={back}>
              Back
            </Button>
          )}
          <Button size="sm" onClick={next} data-testid="tour-next" autoFocus>
            {last ? "Start writing" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
