import { useStore, type RightTab } from "../state/store";
import { RunPanel } from "./RunPanel";
import { OutputsPanel } from "./OutputsPanel";
import { DiffPanel } from "./DiffPanel";

const TABS: [RightTab, string][] = [
  ["run", "Run"],
  ["outputs", "Outputs"],
  ["diff", "Diff"],
];

export function RightPanel() {
  const tab = useStore((s) => s.rightTab);
  return (
    <aside className="cx-drawer cx-right" data-testid="right-panel">
      <div className="cx-drawer-tabs">
        {TABS.map(([t, l]) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => useStore.setState({ rightTab: t })} data-testid={`tab-${t}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="cx-drawer-body">
        {tab === "run" && <RunPanel />}
        {tab === "outputs" && <OutputsPanel />}
        {tab === "diff" && <DiffPanel />}
      </div>
    </aside>
  );
}
