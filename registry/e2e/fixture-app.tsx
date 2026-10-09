// Copied over src/App.tsx of each freshly scaffolded app by install-smoke.mjs: imports and renders
// every registry item exactly as a consumer would after `shadcn add`, so `tsc -b && vite build`
// type-checks and bundles all of them against the real installed primitives.
import { toFormErrors } from "@/lib/mantle-errors";

export default function App() {
  return <pre>{JSON.stringify(toFormErrors(new Error("smoke")))}</pre>;
}
