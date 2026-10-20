import { Command } from "cmdk";
import { useStore, setProject, setVersion, toggle, openModal, currentVersion, setPrefs } from "../state/store";

const toggleTheme = () => setPrefs({ theme: document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light" });
import { activeEditor, runCommand } from "../editor/active";
import * as cmd from "../editor/commands";
import { allItems } from "./items";
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
    <div className="cx-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <Command className="cx-palette" label="Command palette" loop data-testid="palette" onKeyDown={(e) => e.key === "Escape" && close()}>
        <Command.Input autoFocus placeholder="Type a command, block, version…" data-testid="palette-input" />
        <Command.List>
          <Command.Empty>Nothing found.</Command.Empty>
          <Command.Group heading="Actions">
            <Command.Item onSelect={act(() => startRunFromPanel())}>Run current version ⌘↵</Command.Item>
            <Command.Item onSelect={act(() => toggle("rendered"))}>Toggle rendered view ⌘⇧R</Command.Item>
            <Command.Item onSelect={act(() => openModal({ t: "new-version", fork: s.version ?? undefined }))}>New version (fork)</Command.Item>
            <Command.Item onSelect={act(() => openModal({ t: "new-project" }))}>New project</Command.Item>
            <Command.Item onSelect={act(() => openModal({ t: "new-data" }))}>New data source</Command.Item>
            <Command.Item onSelect={act(() => openModal({ t: "new-block", kind: "directive" }))}>New library directive</Command.Item>
            <Command.Item onSelect={act(() => openModal({ t: "new-block", kind: "section" }))}>New library section</Command.Item>
            <Command.Item onSelect={act(() => openModal({ t: "new-block", kind: "schema" }))}>New output schema</Command.Item>
            <Command.Item onSelect={act(() => openModal({ t: "new-block", kind: "tool" }))}>New tool</Command.Item>
            <Command.Item onSelect={act(() => toggle("left"))}>Toggle library drawer ⌘\</Command.Item>
            <Command.Item onSelect={act(() => toggle("right"))}>Toggle run panel ⌘⇧\</Command.Item>
            <Command.Item onSelect={act(() => useStore.setState({ left: false, right: false }))}>Focus mode ⌘.</Command.Item>
            <Command.Item onSelect={act(() => openModal({ t: "settings" }))}>Settings</Command.Item>
            <Command.Item onSelect={act(startTour)}>Replay tutorial</Command.Item>
            <Command.Item value="toggle day night theme" onSelect={act(toggleTheme)}>
              Switch to {document.documentElement.getAttribute("data-theme") === "light" ? "night" : "day"}
            </Command.Item>
            <Command.Item onSelect={act(() => openModal({ t: "settings", tab: "endpoints" }))}>Settings: endpoints</Command.Item>
            <Command.Item onSelect={act(() => useStore.setState({ view: { t: "project" } }))}>Project settings & scoring</Command.Item>
          </Command.Group>
          {ed && (
            <Command.Group heading="Edit">
              <Command.Item onSelect={act(() => runCommand(cmd.makeDirective))}>Make directive ⌘⇧D</Command.Item>
              <Command.Item onSelect={act(() => runCommand(cmd.groupAsSection("")))}>Group as section ⌘⇧G</Command.Item>
              <Command.Item onSelect={act(() => runCommand(cmd.ungroupSection))}>Ungroup section</Command.Item>
              <Command.Item onSelect={act(() => runCommand(cmd.toggleMute))}>Mute / unmute card ⌘⇧M</Command.Item>
              <Command.Item onSelect={act(() => saveSelectionToLibrary("library"))}>Save selection to library…</Command.Item>
              <Command.Item onSelect={act(() => runCommand(cmd.addMessage("system")))}>Add system message</Command.Item>
              <Command.Item onSelect={act(() => runCommand(cmd.addMessage("assistant")))}>Add assistant prefill</Command.Item>
            </Command.Group>
          )}
          {ed && (
            <Command.Group heading="Insert">
              {allItems(s.ws, s.project ?? undefined, flavor).map((it) => (
                <Command.Item key={it.id} value={`insert ${it.group} ${it.label} ${it.hint ?? ""}`} onSelect={act(() => applyItem(activeEditor()!.view, it))}>
                  <span className="cx-menu-icon">{it.icon}</span> {it.label} <span className="cx-menu-hint">{it.group}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="Go to">
            {p?.versions.map((x) => (
              <Command.Item key={x.id} value={`version ${x.id} ${x.subtitle}`} onSelect={act(() => setVersion(x.id))}>
                Version {x.title} <span className="cx-menu-hint">{x.subtitle}</span>
              </Command.Item>
            ))}
            {s.ws.projects.map((x) => (
              <Command.Item key={x.name} value={`project ${x.name}`} onSelect={act(() => setProject(x.name))}>
                Project {x.name}
              </Command.Item>
            ))}
            {p?.data.map((d) => (
              <Command.Item key={d.name} value={`data ${d.name}`} onSelect={act(() => useStore.setState({ view: { t: "data", name: d.name } }))}>
                Data {d.name}
              </Command.Item>
            ))}
            {s.ws.blocks
              .filter((b) => b.scope === "library" || b.project === s.project)
              .map((b) => (
                <Command.Item key={b.file} value={`open ${b.kind} ${b.type} ${b.fn} ${b.flavor}`} onSelect={act(() => useStore.setState({ view: { t: "block", key: b.key, flavor: b.flavor, file: b.file } }))}>
                  Open {b.kind}: {b.fn} <span className="cx-menu-hint">{b.flavor}</span>
                </Command.Item>
              ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
