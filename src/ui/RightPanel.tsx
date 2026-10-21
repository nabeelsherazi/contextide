import { useStore, type RightTab } from "../state/store";
import { RunPanel } from "./RunPanel";
import { OutputsPanel } from "./OutputsPanel";
import { DiffPanel } from "./DiffPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function RightPanel() {
  const tab = useStore((s) => s.rightTab);
  return (
    <aside className="flex w-[376px] flex-none flex-col border-l border-rule bg-glass backdrop-blur-xl max-[1100px]:w-[328px]" data-testid="right-panel">
      <Tabs value={tab} onValueChange={(t) => useStore.setState({ rightTab: t as RightTab })} className="min-h-0 flex-1 gap-0">
        <TabsList className="h-12 w-full justify-start gap-1 rounded-none border-b border-rule bg-transparent px-3 py-0">
          {(["run", "outputs", "diff"] as const).map((t) => (
            <TabsTrigger key={t} value={t} className="group/rt h-full flex-none rounded-none border-0 px-3 pt-1 text-[16.5px] capitalize data-[state=active]:bg-transparent" data-testid={`tab-${t}`}>
              {t}
              <span className="cx-rope-h pointer-events-none absolute inset-x-3 bottom-[-1px] h-[2px] scale-x-0 transition-transform duration-300 ease-[var(--ease)] group-data-[state=active]/rt:scale-x-100" aria-hidden />
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-12">
          <TabsContent value="run">
            <RunPanel />
          </TabsContent>
          <TabsContent value="outputs">
            <OutputsPanel />
          </TabsContent>
          <TabsContent value="diff">
            <DiffPanel />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}
