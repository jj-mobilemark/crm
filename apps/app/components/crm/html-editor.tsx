"use client";

import Link from "@carbon/icons-react/es/Link";
import ListBulleted from "@carbon/icons-react/es/ListBulleted";
import ListNumbered from "@carbon/icons-react/es/ListNumbered";
import TextBold from "@carbon/icons-react/es/TextBold";
import TextItalic from "@carbon/icons-react/es/TextItalic";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Toggle } from "@crm/ui/components/toggle";
import { cn } from "@crm/ui/lib/utils";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

const MERGE_FIELDS = [
	{ token: "{{firstName}}", label: "First name" },
	{ token: "{{lastName}}", label: "Last name" },
	{ token: "{{companyName}}", label: "Company" },
	{ token: "{{title}}", label: "Title" },
	{ token: "{{senderName}}", label: "Sender" },
] as const;

type HtmlEditorProps = {
	value: string;
	onChange: (html: string) => void;
	placeholder?: string;
	id?: string;
	className?: string;
};

/**
 * TipTap WYSIWYG that reads/writes HTML for sequence email bodies.
 *
 * Kept in `apps/app` (not packages/ui) so TipTap stays a feature dependency
 * rather than a design-system one.
 */
export function HtmlEditor({
	value,
	onChange,
	placeholder = "Write the email…",
	id,
	className,
}: HtmlEditorProps) {
	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			StarterKit.configure({
				heading: false,
				codeBlock: false,
				blockquote: false,
				horizontalRule: false,
				code: false,
			}),
			LinkExtension.configure({
				openOnClick: false,
				HTMLAttributes: {
					rel: "noopener noreferrer",
					target: "_blank",
				},
			}),
			Placeholder.configure({ placeholder }),
		],
		content: value || "<p></p>",
		onUpdate: ({ editor: next }) => {
			onChange(next.getHTML());
		},
		editorProps: {
			attributes: {
				id: id ?? "",
				class:
					"tiptap-editor min-h-36 px-3 py-2 text-sm outline-none [&_a]:text-primary [&_a]:underline [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
			},
		},
	});

	// Sync when the parent replaces the whole value (e.g. step reset), but not
	// on every keystroke from our own onUpdate.
	useEffect(() => {
		if (!editor) return;
		const current = editor.getHTML();
		if (normalizeHtml(current) === normalizeHtml(value || "<p></p>")) return;
		editor.commands.setContent(value || "<p></p>", { emitUpdate: false });
	}, [editor, value]);

	if (!editor) {
		return (
			<div
				className={cn(
					"min-h-48 rounded-md border border-input bg-transparent",
					className,
				)}
			/>
		);
	}

	return (
		<div
			className={cn(
				"flex flex-col overflow-hidden rounded-md border border-input bg-transparent",
				className,
			)}
		>
			<div className="flex flex-wrap items-center gap-1 border-b px-1.5 py-1">
				<Toggle
					size="sm"
					pressed={editor.isActive("bold")}
					onPressedChange={() => editor.chain().focus().toggleBold().run()}
					aria-label="Bold"
				>
					<Icon icon={TextBold} />
				</Toggle>
				<Toggle
					size="sm"
					pressed={editor.isActive("italic")}
					onPressedChange={() => editor.chain().focus().toggleItalic().run()}
					aria-label="Italic"
				>
					<Icon icon={TextItalic} />
				</Toggle>
				<Toggle
					size="sm"
					pressed={editor.isActive("bulletList")}
					onPressedChange={() =>
						editor.chain().focus().toggleBulletList().run()
					}
					aria-label="Bullet list"
				>
					<Icon icon={ListBulleted} />
				</Toggle>
				<Toggle
					size="sm"
					pressed={editor.isActive("orderedList")}
					onPressedChange={() =>
						editor.chain().focus().toggleOrderedList().run()
					}
					aria-label="Numbered list"
				>
					<Icon icon={ListNumbered} />
				</Toggle>
				<Toggle
					size="sm"
					pressed={editor.isActive("link")}
					onPressedChange={() => {
						if (editor.isActive("link")) {
							editor.chain().focus().unsetLink().run();
							return;
						}
						const previous = editor.getAttributes("link").href as
							| string
							| undefined;
						const url = window.prompt("Link URL", previous ?? "https://");
						if (url === null) return;
						const trimmed = url.trim();
						if (!trimmed) {
							editor.chain().focus().unsetLink().run();
							return;
						}
						editor
							.chain()
							.focus()
							.extendMarkRange("link")
							.setLink({ href: trimmed })
							.run();
					}}
					aria-label="Link"
				>
					<Icon icon={Link} />
				</Toggle>

				<span className="mx-1 h-4 w-px bg-border" />

				{MERGE_FIELDS.map((field) => (
					<Button
						key={field.token}
						type="button"
						size="sm"
						variant="ghost"
						onClick={() =>
							editor.chain().focus().insertContent(field.token).run()
						}
					>
						{field.label}
					</Button>
				))}
			</div>

			<EditorContent editor={editor} />
		</div>
	);
}

function normalizeHtml(html: string): string {
	return html.replace(/\s+/g, " ").trim();
}
