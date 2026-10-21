// Icon names shared by the library, slash menu and palette (the editor's node views use editor/icons.ts).
import { Braces, ChevronRight, Clock, Dices, Hash, PanelTop, Shuffle, Table2, Variable, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  directive: ChevronRight,
  section: PanelTop,
  clock: Clock,
  variable: Variable,
  hash: Hash,
  dice: Dices,
  shuffle: Shuffle,
  tool: Wrench,
  schema: Braces,
  data: Table2,
};

export function Icon(p: { name: string; className?: string }) {
  const C = ICONS[p.name] ?? ChevronRight;
  return <C className={cn("size-3.5 flex-none", p.className)} strokeWidth={1.6} aria-hidden />;
}
