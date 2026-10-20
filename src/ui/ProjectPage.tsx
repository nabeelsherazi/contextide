import { useStore, currentProject, setVersion } from "../state/store";
import { patchProject } from "../state/actions";
import { Field, KeyValues } from "./widgets";
import { EvalForm } from "./EvalForm";

export function ProjectPage() {
  const s = useStore();
  const p = currentProject(s);
  if (!p) return null;
  return (
    <div className="cx-projectpage" data-testid="project-page">
      <header className="cx-page-head">
        <button className="cx-btn small ghost" onClick={() => useStore.setState({ view: { t: "version" } })}>
          ← {s.version ?? "back"}
        </button>
        <span className="cx-page-title static">
          <span className="cx-page-kind">project</span>
          <span className="cx-page-id">{p.name}</span>
        </span>
      </header>
      <div className="cx-card-panel">
        <h3>Description</h3>
        <Field multiline value={p.settings.description ?? ""} placeholder="What is this workflow for?" onCommit={(v) => patchProject({ description: v || undefined })} />
      </div>
      <div className="cx-card-panel">
        <h3>Variables</h3>
        <p className="cx-fine">
          Available as <code>{'{{ var("name") }}'}</code>. These override workspace variables of the same name.
        </p>
        <KeyValues value={p.settings.vars ?? {}} onChange={(vars) => patchProject({ vars: Object.keys(vars).length ? vars : undefined })} />
      </div>
      <div className="cx-card-panel">
        <h3>Scoring</h3>
        <EvalForm />
      </div>
      <div className="cx-card-panel">
        <h3>Versions</h3>
        <ul className="cx-plain-list">
          {p.versions.map((v) => (
            <li key={v.id}>
              <button className="cx-link" onClick={() => setVersion(v.id)}>
                {v.title}
              </button>{" "}
              {v.subtitle} <span className="cx-flavor">{v.flavor}</span> <span className="cx-muted-text">{p.runs.filter((r) => r.version === v.id).length} runs</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
