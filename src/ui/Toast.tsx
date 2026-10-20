import { useEffect, useState } from "react";
import { useStore } from "../state/store";

export function Toast() {
  const t = useStore((s) => s.toast);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!t) return;
    setShow(true);
    const h = window.setTimeout(() => setShow(false), 2600);
    return () => window.clearTimeout(h);
  }, [t]);
  if (!t || !show) return null;
  return (
    <div className="cx-toast" role="status" data-testid="toast">
      {t.msg}
    </div>
  );
}
