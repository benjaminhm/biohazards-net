'use client'

import { useEffect, useReducer } from 'react'
import { Extension } from '@tiptap/core'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { proseToTipTapHtml } from '@/lib/richTextPrint'

interface Props {
  value: string
  onChange: (html: string) => void
  /** Approximate minimum height in px */
  minHeight?: number
}

const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20]

const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: element => {
              const raw = element.style.fontSize || ''
              const match = raw.match(/^\s*(\d+(?:\.\d+)?)\s*px\s*$/i)
              return match ? match[1] : null
            },
            renderHTML: attributes => {
              const size = Number(attributes.fontSize)
              if (!Number.isFinite(size) || size <= 0) return {}
              return { style: `font-size: ${size}px` }
            },
          },
        },
      },
    ]
  },
})

function normalizeFontSize(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return String(raw)
  if (typeof raw !== 'string') return ''
  const match = raw.match(/^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i)
  return match ? match[1] : ''
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
        border: active ? '1px solid #60a5fa' : '1px solid #3a3a3a',
        background: active ? 'rgba(96,165,250,0.22)' : '#181818',
        color: '#f5f5f5',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  )
}

/**
 * Rich text for document body fields (formatting + alignment + font size). Stores HTML in JSON.
 */
export default function RichTextEditor({ value, onChange, minHeight = 140 }: Props) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      TextStyle,
      FontSize,
      Underline,
      TextAlign.configure({ types: ['paragraph'] }),
    ],
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

  const activeFontSize = normalizeFontSize(editor.getAttributes('textStyle').fontSize)

  const setFontSize = (next: string) => {
    const parsed = Number(next)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      editor.chain().focus().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run()
      return
    }
    editor.chain().focus().setMark('textStyle', { fontSize: String(parsed) }).run()
  }

  return (
    <div
      className="doc-rich-editor"
      style={{
        borderRadius: 8,
        border: '1px solid #2a2a2a',
        background: '#050505',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: '8px 10px',
          borderBottom: '1px solid #2a2a2a',
          background: '#0f0f0f',
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
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          U
        </ToolbarButton>
        <div style={{ width: 1, height: 26, background: '#2a2a2a', margin: '0 2px' }} />
        <ToolbarButton
          active={editor.isActive({ textAlign: 'left' })}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        >
          Left
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive({ textAlign: 'center' })}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        >
          Center
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive({ textAlign: 'right' })}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        >
          Right
        </ToolbarButton>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 2 }}>
          <span style={{ fontSize: 12, color: '#a3a3a3' }}>Size</span>
          <select
            value={activeFontSize}
            onChange={e => setFontSize(e.target.value)}
            style={{
              height: 30,
              padding: '0 8px',
              borderRadius: 6,
              border: '1px solid #3a3a3a',
              background: '#181818',
              color: '#f5f5f5',
              fontSize: 12,
              fontWeight: 600,
              outline: 'none',
            }}
          >
            <option value="">Default</option>
            {FONT_SIZES.map(size => (
              <option key={size} value={String(size)}>
                {size}px
              </option>
            ))}
          </select>
        </label>
        <div style={{ width: 1, height: 26, background: '#2a2a2a', margin: '0 2px' }} />
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
