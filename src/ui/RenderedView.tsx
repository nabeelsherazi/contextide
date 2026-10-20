import { useStore, toast } from "../state/store";
import { Button } from "@/components/ui/button";
import { CheckRow } from "./widgets";
import { useState } from "react";
import { promptText } from "../core/render";
import { buildRequest, curlFor, tsLiteralFor } from "../core/request";
import { currentProject, currentVersion } from "../state/store";
import { mergedRunSettings } from "../core/workspace";

const ws = (t: string, on: boolean) => (on ? t.replace(/ /g, "·").replace(/\t/g, "→   ") : t);

export function copy(text: string, what = "Copied") {
  navigator.clipboard?.writeText(text).then(
    () => toast(what),
    () => {},
  );
}

export function RenderedView() {
  const s = useStore();
  const a = s.analysis;
  const [showWs, setShowWs] = useState(s.prefs.showWhitespace);
  if (!a) return <div className="cx-stage cx-rendered">Nothing rendered yet.</div>;
  const r = a.rendered;
  const p = currentProject(s);
  const v = currentVersion(s);
  const settings = p ? mergedRunSettings(p, v) : {};
  const ep = s.ws.settings.endpoints.find((e) => e.id === settings.endpoint) ?? s.ws.settings.endpoints[0];
  const req = ep ? buildRequest(r, settings, ep) : null;
  let cutDone = false;
  return (
    <div className="cx-stage cx-rendered" data-testid="rendered">
      <div className="cx-rendered-tools">
        <CheckRow checked={showWs} onChange={setShowWs}>
          show whitespace
        </CheckRow>
        <span className="cx-spacer" />
        <Button variant="ghost" size="sm" onClick={() => copy(promptText(r), "Copied prompt")}>
          Copy text
        </Button>
        {req && (
          <>
            <Button variant="ghost" size="sm" onClick={() => copy(JSON.stringify(req.body, null, 2), "Copied request JSON")}>
              Copy JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={() => copy(curlFor(req), "Copied curl")}>
              Copy curl
            </Button>
            <Button variant="ghost" size="sm" onClick={() => copy(tsLiteralFor(r), "Copied TS")}>
              Copy TS
            </Button>
          </>
        )}
      </div>
      {r.messages.map((m, mi) => (
        <section key={mi} className={`cx-r-msg cx-role-${m.role}`}>
          {(r.messages.length > 1 || m.role !== "user") && <div className="cx-r-role">{m.role}</div>}
          <pre className="cx-r-text">
            {m.segments.map((seg, i) => {
              const cut = !cutDone && seg.dynamic && seg.text.length > 0;
              if (cut) cutDone = true;
              const stable = !cutDone;
              const t = seg.kind === "sep" ? (showWs ? "↵\n" : "\n") : ws(seg.text, showWs);
              return (
                <span key={i} className={`cx-seg cx-seg-${seg.kind}${stable ? " cx-stable" : ""}${seg.dynamic ? " cx-dyn" : ""}`} title={`${seg.kind} · ${seg.id}${seg.dynamic ? " · changes between runs" : ""}`}>
                  {cut && <span className="cx-cutmark" title="Stable prefix ends here" />}
                  {t}
                </span>
              );
            })}
          </pre>
        </section>
      ))}
      {r.tools.length > 0 && (
        <section className="cx-r-extra">
          <div className="cx-r-role">tools (API)</div>
          <pre className="cx-r-json">{JSON.stringify(r.tools, null, 2)}</pre>
        </section>
      )}
      {r.responseFormat && (
        <section className="cx-r-extra">
          <div className="cx-r-role">response_format</div>
          <pre className="cx-r-json">{JSON.stringify(r.responseFormat, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
