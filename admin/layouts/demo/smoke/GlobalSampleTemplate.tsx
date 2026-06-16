import { smokeLabel } from "./components/tokens";

export const keys = {
  "hero.title": { type: "text", initial: "Global Sample Template" },
};

export default function Home() {
  return <main>{smokeLabel}</main>;
}
