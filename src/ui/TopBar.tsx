import { useStore, setProject, setVersion, toggle, openModal, currentProject } from "../state/store";

export function TopBar() {
  const s = useStore();
  const p = currentProject(s);
  return (
    <header className="cx-topbar">
      <button className="cx-icon-btn" title="Toggle library (⌘\)" onClick={() => toggle("left")} data-testid="toggle-left">
        ☰
      </button>
      <select
        className="cx-project-select"
        value={s.project ?? ""}
        onChange={(e) => (e.target.value === "__new" ? openModal({ t: "new-project" }) : setProject(e.target.value))}
        data-testid="project-select"
      >
        {s.ws.projects.map((x) => (
          <option key={x.name} value={x.name}>
            {x.name}
          </option>
        ))}
        <option value="__new">+ New project…</option>
      </select>
      <button className={`cx-icon-btn${s.view.t === "project" ? " on" : ""}`} title="Project settings" onClick={() => useStore.setState({ view: { t: "project" } })}>
        ⚙︎
      </button>
      <nav className="cx-tabs" data-testid="version-tabs">
        {p?.versions.map((v) => (
          <button
            key={v.id}
            className={`cx-tab${v.id === s.version && s.view.t === "version" ? " active" : ""}`}
            onClick={() => setVersion(v.id)}
            onDoubleClick={() => openModal({ t: "version-settings", id: v.id })}
            title={`${v.id}${v.subtitle ? " · " + v.subtitle : ""} · ${v.flavor} — double-click to rename`}
            data-testid={`version-tab-${v.id}`}
          >
            <b>{v.title}</b>
            {v.subtitle && <span className="cx-tab-sub">{v.subtitle}</span>}
          </button>
        ))}
        <button className="cx-tab cx-tab-add" title="New version (fork current)" onClick={() => openModal({ t: "new-version", fork: s.version ?? undefined })} data-testid="new-version">
          +
        </button>
      </nav>
      <span className="cx-spacer" />
      <button className={`cx-btn small${s.rendered ? " on" : ""}`} onClick={() => toggle("rendered")} title="Show exactly what the model receives (⌘⇧R)" data-testid="toggle-rendered">
        {s.rendered ? "Editing view" : "Rendered view"}
      </button>
      <button className="cx-btn small ghost" onClick={() => useStore.setState({ palette: true })} title="Command palette">
        ⌘K
      </button>
      <button className="cx-icon-btn" title="Settings" onClick={() => openModal({ t: "settings" })} data-testid="open-settings">
        ⚙
      </button>
      <button className="cx-icon-btn" title="Toggle run panel (⌘⇧\)" onClick={() => toggle("right")} data-testid="toggle-right">
        ◧
      </button>
    </header>
  );
}
