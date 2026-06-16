import { createContext, useContext } from "react";
import type { LayoutKeyType } from "../../api/types";

export interface FieldMeta {
  key: string;
  type: LayoutKeyType;
  relatedKeys?: string[];
  rect?: DOMRect;
}

export interface VisualEditorContextType {
  contentMap: Record<string, string>;
  keyTypes: Record<string, LayoutKeyType>;
  onContentChange: (key: string, value: string) => void;
  onFieldClick: (field: FieldMeta, element: HTMLElement) => void;
}

export const VisualEditorContext = createContext<VisualEditorContextType | null>(null);

export function useVisualEditor() {
  return useContext(VisualEditorContext);
}
