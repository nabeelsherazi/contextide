import { useStore, currentProject, setVersion } from "../state/store";
import { patchProject } from "../state/actions";
import { Field, KeyValues, Hint } from "./widgets";
import { EvalForm } from "./EvalForm";
import { PageHeader, Panel } from "./PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ProjectPage() {
  const s = useStore();
  const p = currentProject(s);
  if (!p) return null;
  return (
    <div data-testid="project-page">
      <PageHeader kind="workflow" title={p.name} />
      <Panel title="Description">
        <Field multiline value={p.settings.description ?? ""} placeholder="What is this workflow for?" onCommit={(v) => patchProject({ description: v || undefined })} />
      </Panel>
      <Panel title="Variables">
        <Hint>
          Available as <code>{'{{ var("name") }}'}</code>. These override workspace variables of the same name.
        </Hint>
        <KeyValues value={p.settings.vars ?? {}} onChange={(vars) => patchProject({ vars: Object.keys(vars).length ? vars : undefined })} testid="project-vars" />
      </Panel>
      <Panel title="Scoring">
        <EvalForm />
      </Panel>
      <Panel title="Versions">
        <ul className="flex flex-col gap-1">
          {p.versions.map((v) => (
            <li key={v.id} className="flex items-baseline gap-2">
              <Button variant="link" className="font-serif text-[17px]" onClick={() => setVersion(v.id)}>
                {v.title}
              </Button>
              <span className="font-serif text-ink-2 italic">{v.subtitle}</span>
              <Badge variant="secondary">{v.flavor}</Badge>
              <span className="text-ink-3">{p.runs.filter((r) => r.version === v.id).length} runs</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
