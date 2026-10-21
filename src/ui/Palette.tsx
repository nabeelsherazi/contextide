import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { useStore, setProject, setVersion, toggle, openModal, currentVersion, setPrefs } from "../state/store";

const toggleTheme = () => setPrefs({ theme: document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light" });
import { activeEditor, runCommand } from "../editor/active";
import * as cmd from "../editor/commands";
import { allItems } from "./items";
import { Icon } from "./icons";
import { applyItem } from "./Editor";
import { startRunFromPanel } from "./RunPanel";
import { saveSelectionToLibrary } from "./modals/Modals";
import { startTour } from "./Tour";

export function Palette() {
  const s = useStore();
  if (!s.palette) return null;
  const close = () => useStore.setState({ palette: false });
  const v = currentVersion(s);
  const flavor = v?.flavor ?? "general";
  const act = (f: () => void) => () => {
    close();
    setTimeout(f, 0);
  };
  const ed = activeEditor();
  const p = s.ws.projects.find((x) => x.name === s.project);
  return (
    <CommandDialog open onOpenChange={(o) => !o && close()} title="Command palette" description="Run a command, insert a block, or jump somewhere" className="top-[12vh] translate-y-0 sm:max-w-[620px]" showCloseButton={false}>
        <CommandInput autoFocus placeholder="Type a command, block, version…" data-testid="palette-input" />
        <CommandList data-testid="palette">
          <CommandEmpty>Nothing found.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem onSelect={act(() => startRunFromPanel())}>Run current version<CommandShortcut>⌘↵</CommandShortcut></CommandItem>
            <CommandItem onSelect={act(() => toggle("rendered"))}>Toggle rendered view<CommandShortcut>⌘⇧R</CommandShortcut></CommandItem>
            <CommandItem onSelect={act(() => openModal({ t: "new-version", fork: s.version ?? undefined }))}>New version (fork)</CommandItem>
            <CommandItem onSelect={act(() => openModal({ t: "new-project" }))}>New workflow</CommandItem>
            <CommandItem onSelect={act(() => openModal({ t: "new-data" }))}>New data source</CommandItem>
            <CommandItem onSelect={act(() => openModal({ t: "new-block", kind: "directive" }))}>New library directive</CommandItem>
            <CommandItem onSelect={act(() => openModal({ t: "new-block", kind: "section" }))}>New library section</CommandItem>
            <CommandItem onSelect={act(() => openModal({ t: "new-block", kind: "schema" }))}>New output schema</CommandItem>
            <CommandItem onSelect={act(() => openModal({ t: "new-block", kind: "tool" }))}>New tool</CommandItem>
            <CommandItem onSelect={act(() => toggle("left"))}>Toggle library drawer<CommandShortcut>⌘\</CommandShortcut></CommandItem>
            <CommandItem onSelect={act(() => toggle("right"))}>Toggle run panel<CommandShortcut>⌘⇧\</CommandShortcut></CommandItem>
            <CommandItem onSelect={act(() => useStore.setState({ left: false, right: false }))}>Focus mode<CommandShortcut>⌘.</CommandShortcut></CommandItem>
            <CommandItem onSelect={act(() => openModal({ t: "settings" }))}>Settings</CommandItem>
            <CommandItem onSelect={act(startTour)}>Replay tutorial</CommandItem>
            <CommandItem value="toggle day night theme" onSelect={act(toggleTheme)}>
              Switch to {document.documentElement.getAttribute("data-theme") === "light" ? "night" : "day"}
            </CommandItem>
            <CommandItem onSelect={act(() => openModal({ t: "settings", tab: "endpoints" }))}>Settings: endpoints</CommandItem>
            <CommandItem onSelect={act(() => useStore.setState({ view: { t: "project" } }))}>Workflow settings & scoring</CommandItem>
          </CommandGroup>
          {ed && (
            <CommandGroup heading="Edit">
              <CommandItem onSelect={act(() => runCommand(cmd.makeDirective))}>Make directive<CommandShortcut>⌘⇧D</CommandShortcut></CommandItem>
              <CommandItem onSelect={act(() => runCommand(cmd.groupAsSection("")))}>Group as section<CommandShortcut>⌘⇧G</CommandShortcut></CommandItem>
              <CommandItem onSelect={act(() => runCommand(cmd.ungroupSection))}>Ungroup section</CommandItem>
              <CommandItem onSelect={act(() => runCommand(cmd.toggleMute))}>Mute / unmute card<CommandShortcut>⌘⇧M</CommandShortcut></CommandItem>
              <CommandItem onSelect={act(() => saveSelectionToLibrary("library"))}>Save selection to library…</CommandItem>
              <CommandItem onSelect={act(() => runCommand(cmd.addMessage("system")))}>Add system message</CommandItem>
              <CommandItem onSelect={act(() => runCommand(cmd.addMessage("assistant")))}>Add assistant prefill</CommandItem>
            </CommandGroup>
          )}
          {ed && (
            <CommandGroup heading="Insert">
              {allItems(s.ws, s.project ?? undefined, flavor).map((it) => (
                <CommandItem key={it.id} value={`insert ${it.group} ${it.label} ${it.hint ?? ""}`} onSelect={act(() => applyItem(activeEditor()!.view, it))}>
                  <Icon name={it.icon} className="text-ink-3" /> {it.label} <CommandShortcut>{it.group}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Go to">
            {p?.versions.map((x) => (
              <CommandItem key={x.id} value={`version ${x.id} ${x.subtitle}`} onSelect={act(() => setVersion(x.id))}>
                Version {x.title} <CommandShortcut>{x.subtitle}</CommandShortcut>
              </CommandItem>
            ))}
            {s.ws.projects.map((x) => (
              <CommandItem key={x.name} value={`workflow ${x.name}`} onSelect={act(() => setProject(x.name))}>
                Workflow {x.name}
              </CommandItem>
            ))}
            {p?.data.map((d) => (
              <CommandItem key={d.name} value={`data ${d.name}`} onSelect={act(() => useStore.setState({ view: { t: "data", name: d.name } }))}>
                Data {d.name}
              </CommandItem>
            ))}
            {s.ws.blocks
              .filter((b) => b.scope === "library" || b.project === s.project)
              .map((b) => (
                <CommandItem key={b.file} value={`open ${b.kind} ${b.type} ${b.fn} ${b.flavor}`} onSelect={act(() => useStore.setState({ view: { t: "block", key: b.key, flavor: b.flavor, file: b.file } }))}>
                  Open {b.kind}: {b.fn} <CommandShortcut>{b.flavor}</CommandShortcut>
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
    </CommandDialog>
  );
}
