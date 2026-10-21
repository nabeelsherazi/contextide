// Small line icons for the editor's vanilla-DOM node views (the React UI uses lucide via ui/icons.tsx).
// Paths follow lucide's 24px grid so both sets match.

const PATHS: Record<string, string[]> = {
  clock: ["M12 6v6l4 2", "circle:12,12,9"],
  variable: ["M8 21s-4-3-4-9 4-9 4-9", "M16 3s4 3 4 9-4 9-4 9", "M15 9l-6 6", "M9 9l6 6"],
  hash: ["M4 9h16", "M4 15h16", "M10 3 8 21", "M16 3l-2 18"],
  dice: ["rect:3,3,18,18,2", "circle:8,8,1.2", "circle:16,16,1.2", "circle:12,12,1.2"],
  shuffle: ["M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22", "m18 2 4 4-4 4", "M2 6h1.9c1.5 0 2.9.9 3.6 2.2", "M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8", "m18 14 4 4-4 4"],
  link: ["M9 17H7A5 5 0 0 1 7 7h2", "M15 7h2a5 5 0 1 1 0 10h-2", "M8 12h8"],
  data: ["rect:3,3,18,18,2", "M3 9h18", "M3 15h18", "M9 3v18"],
  tool: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"],
  schema: ["M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1", "M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"],
  eye: ["M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0", "circle:12,12,3"],
  eyeOff: ["M10.73 5.08A10.43 10.43 0 0 1 12 5c4.97 0 8.4 3.36 9.94 6.65a1 1 0 0 1 0 .7 10.8 10.8 0 0 1-1.44 2.49", "M14.08 14.16a3 3 0 0 1-4.24-4.24", "M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14", "m2 2 20 20"],
  more: ["circle:5,12,1", "circle:12,12,1", "circle:19,12,1"],
  x: ["M18 6 6 18", "m6 6 12 12"],
};

const NS = "http://www.w3.org/2000/svg";

export function svgIcon(name: string, cls = "cx-icon"): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS[name] ?? PATHS.more) {
    const [kind, args] = d.split(":");
    let el: SVGElement;
    if (kind === "circle" && args) {
      const [cx, cy, r] = args.split(",");
      el = document.createElementNS(NS, "circle");
      el.setAttribute("cx", cx);
      el.setAttribute("cy", cy);
      el.setAttribute("r", r);
    } else if (kind === "rect" && args) {
      const [x, y, w, hgt, rx] = args.split(",");
      el = document.createElementNS(NS, "rect");
      Object.entries({ x, y, width: w, height: hgt, rx }).forEach(([k, v]) => el.setAttribute(k, v));
    } else {
      el = document.createElementNS(NS, "path");
      el.setAttribute("d", d);
    }
    svg.appendChild(el);
  }
  return svg;
}
