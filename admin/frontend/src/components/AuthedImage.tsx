import type { ImgHTMLAttributes } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useAuthedMediaUrl } from "../lib/media-url";

export function AuthedImage({ src, siteKey, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string; siteKey?: string }) {
  const url = useAuthedMediaUrl(src, siteKey);
  return <img {...props} src={url || undefined} />;
}

export function AuthedImageNodeView({ node, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper contentEditable={false} className={selected ? "outline outline-2 outline-cyan-500" : ""}>
      <AuthedImage
        src={node.attrs.src ?? ""}
        alt={node.attrs.alt ?? ""}
        width={node.attrs.width ?? undefined}
        height={node.attrs.height ?? undefined}
        className="max-w-full h-auto"
      />
    </NodeViewWrapper>
  );
}
