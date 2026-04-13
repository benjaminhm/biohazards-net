'use client'

import { useEffect, useReducer } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { proseToTipTapHtml } from '@/lib/richTextPrint'

interface Props {
  value: string
  onChange: (html: string) => void
  /** Approximate minimum height in px */
  minHeight?: number
}

function ToolbarButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 10px',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: active ? 'rgba(255,107,53,0.12)' : 'var(--surface)',
        color: 'var(--text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  )
}

/**
 * Rich text for document body fields (bold, italic, lists). Stores HTML in JSON.
 */
export default function RichTextEditor({ value, onChange, minHeight = 140 }: Props) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false })],
    content: proseToTipTapHtml(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'doc-rich-editor-prose',
        style: `min-height:${minHeight}px`,
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const next = proseToTipTapHtml(value)
    const cur = editor.getHTML()
    if (cur === next) return
    editor.commands.setContent(next, { emitUpdate: false })
  }, [value, editor])

  useEffect(() => {
    if (!editor) return
    const fn = () => rerender()
    editor.on('selectionUpdate', fn)
    editor.on('transaction', fn)
    return () => {
      editor.off('selectionUpdate', fn)
      editor.off('transaction', fn)
    }
  }, [editor])

  if (!editor) {
    return (
      <div
        style={{
          minHeight,
          borderRadius: 4,
          background: 'rgba(0,0,0,0.02)',
          border: '1px solid var(--border)',
        }}
      />
    )
  }

  return (
    <div
      className="doc-rich-editor"
      style={{
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'rgba(0,0,0,0.02)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: '8px 10px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        <ToolbarButton
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • List
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </ToolbarButton>
        <ToolbarButton
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          Undo
        </ToolbarButton>
        <ToolbarButton
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          Redo
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
