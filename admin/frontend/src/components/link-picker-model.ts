export type LinkMode = "none" | "page" | "fragment" | "custom";

export interface LinkPickerState {
  mode: LinkMode;
  selectedPage: string;
  fragment: string;
  custom: string;
}

export function detectLinkMode(value: string, pagePaths: string[]): LinkPickerState {
  if (!value) {
    return { mode: "none", selectedPage: "", fragment: "", custom: "" };
  }

  if (value.startsWith("#")) {
    return {
      mode: "fragment",
      selectedPage: "",
      fragment: value.slice(1),
      custom: "",
    };
  }

  if (pagePaths.includes(value)) {
    return {
      mode: "page",
      selectedPage: value,
      fragment: "",
      custom: "",
    };
  }

  return {
    mode: "custom",
    selectedPage: "",
    fragment: "",
    custom: value,
  };
}

export function fragmentToHref(fragment: string): string {
  const normalized = fragment.trim().replace(/^#+/, "");
  return normalized ? `#${normalized}` : "#";
}
