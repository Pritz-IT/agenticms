import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { richTextExtensions } from "./rich-text-extensions";
import { ImagePicker } from "./ImagePicker";
import { DEFAULT_SITE_KEY } from "../site-routing";
import "./rich-text-editor.css";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  mediaUpload?: (file: File) => Promise<string>;
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`px-2 py-1 text-sm rounded transition-colors focus-visible:outline focus-visible:outline-cyan-500 ${
        active
          ? "bg-neutral-600 text-white"
          : "text-neutral-400 hover:bg-neutral-700 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ value, onChange, placeholder, mediaUpload }: RichTextEditorProps) {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const [imageOpen, setImageOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const altInput = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: richTextExtensions({ placeholder, postMedia: !!mediaUpload }),
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Sync external value changes (e.g. locale switch)
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  if (!editor) return null;

  const setLink = () => {
    const url = window.prompt("Enter URL", editor.getAttributes("link").href ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  };

  const insertImage = () => {
    if (!alt.trim()) {
      altInput.current?.setCustomValidity("Describe the image before inserting it.");
      altInput.current?.reportValidity();
      return;
    }
    if (!imageSrc) return;
    editor.chain().focus().insertContent({
      type: "figure",
      content: [
        { type: "image", attrs: { src: imageSrc, alt: alt.trim() } },
        ...(caption.trim() ? [{ type: "figcaption", content: [{ type: "text", text: caption.trim() }] }] : []),
      ],
    }).run();
    setImageOpen(false);
    setImageSrc("");
    setAlt("");
    setCaption("");
  };

  return (
    <div className="min-w-0 border border-neutral-700 rounded overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-neutral-800 border-b border-neutral-700">
        <ToolbarButton
          title="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          title="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </ToolbarButton>

        <span className="w-px h-5 bg-neutral-600 mx-1" />

        <ToolbarButton
          title="Heading 2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          title="Heading 3"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </ToolbarButton>
        <ToolbarButton title="Heading 4" active={editor.isActive("heading", { level: 4 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}>
          H4
        </ToolbarButton>

        <span className="w-px h-5 bg-neutral-600 mx-1" />

        <ToolbarButton
          title="Bullet List"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • List
        </ToolbarButton>
        <ToolbarButton
          title="Ordered List"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </ToolbarButton>

        <span className="w-px h-5 bg-neutral-600 mx-1" />

        <ToolbarButton
          title="Blockquote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </ToolbarButton>
        <ToolbarButton
          title="Divider"
          active={false}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          —
        </ToolbarButton>

        <span className="w-px h-5 bg-neutral-600 mx-1" />

        <ToolbarButton
          title="Link"
          active={editor.isActive("link")}
          onClick={setLink}
        >
          Link
        </ToolbarButton>
        <ToolbarButton
          title="Image"
          active={imageOpen}
          onClick={() => setImageOpen(!imageOpen)}
        >
          Image
        </ToolbarButton>
        <ToolbarButton title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          Table
        </ToolbarButton>
        {editor.isActive("table") && <>
          <ToolbarButton title="Add row" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</ToolbarButton>
          <ToolbarButton title="Remove row" onClick={() => editor.chain().focus().deleteRow().run()}>− Row</ToolbarButton>
          <ToolbarButton title="Add column" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column</ToolbarButton>
          <ToolbarButton title="Remove column" onClick={() => editor.chain().focus().deleteColumn().run()}>− Column</ToolbarButton>
          <ToolbarButton title="Toggle header row" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Header row</ToolbarButton>
        </>}
      </div>

      {imageOpen && (
        <div role="group" aria-label="Insert image" className="space-y-3 border-b border-neutral-700 bg-neutral-900 p-4">
          <ImagePicker siteKey={siteKey} value={imageSrc} onChange={setImageSrc} mediaUpload={mediaUpload} allowCustomUrl={false} />
          <label className="flex flex-col gap-1 text-sm text-neutral-400">
            Alt text (required)
            <input ref={altInput} aria-required="true" value={alt} onChange={(event) => {
              event.target.setCustomValidity("");
              setAlt(event.target.value);
            }} placeholder="Describe what the image shows" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-neutral-400">
            Caption (optional)
            <input value={caption} onChange={(event) => setCaption(event.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={!imageSrc} onClick={insertImage} className="ui-button ui-button-primary">Insert image</button>
            <button type="button" onClick={() => setImageOpen(false)} className="ui-button">Cancel</button>
          </div>
        </div>
      )}

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="rich-text-editor prose prose-invert prose-sm max-w-none overflow-x-auto p-4 focus:outline-none"
        style={{ minHeight: 200 }}
      />
    </div>
  );
}
