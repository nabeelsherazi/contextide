import { useStore, type RightTab } from "../state/store";
import { RunPanel } from "./RunPanel";
import { OutputsPanel } from "./OutputsPanel";
import { DiffPanel } from "./DiffPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function RightPanel() {
  const tab = useStore((s) => s.rightTab);
  return (
    <aside className="flex w-[360px] flex-none flex-col border-l border-rule bg-glass backdrop-blur-xl max-[1100px]:w-[320px]" data-testid="right-panel">
      <Tabs value={tab} onValueChange={(t) => useStore.setState({ rightTab: t as RightTab })} className="min-h-0 flex-1 gap-0">
        <TabsList className="h-auto gap-1 bg-transparent px-3.5 pt-3 pb-1.5">
          {(["run", "outputs", "diff"] as const).map((t) => (
            <TabsTrigger key={t} value={t} className="h-8 flex-none capitalize" data-testid={`tab-${t}`}>
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-1 pb-10">
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
