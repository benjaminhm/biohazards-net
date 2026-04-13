/*
 * Tracks dirty state from multiple job sub-forms so we can warn on tab switch / leave.
 */
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type Ctx = {
  register: (id: string, dirty: boolean) => void
  hasUnsaved: boolean
}

const UnsavedChangesContext = createContext<Ctx | null>(null)

const LEAVE_MESSAGE =
  'You have unsaved changes on this job. Leave without saving?'

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirtyIds, setDirtyIds] = useState(() => new Set<string>())

  const register = useCallback((id: string, dirty: boolean) => {
    setDirtyIds(prev => {
      const next = new Set(prev)
      if (dirty) next.add(id)
      else next.delete(id)
      if (next.size === prev.size) {
        let same = true
        for (const k of next) {
          if (!prev.has(k)) {
            same = false
            break
          }
        }
        if (same) return prev
      }
      return next
    })
  }, [])

  const hasUnsaved = dirtyIds.size > 0

  useEffect(() => {
    if (!hasUnsaved) return
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', fn)
    return () => window.removeEventListener('beforeunload', fn)
  }, [hasUnsaved])

  const value = useMemo(() => ({ register, hasUnsaved }), [register, hasUnsaved])

  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>
}

/** Register a form as dirty until unmount or dirty becomes false. */
export function useRegisterUnsavedChanges(id: string, isDirty: boolean) {
  const ctx = useContext(UnsavedChangesContext)
  useEffect(() => {
    if (!ctx) return
    ctx.register(id, isDirty)
    return () => {
      ctx.register(id, false)
    }
  }, [ctx, id, isDirty])
}

export function useUnsavedChanges() {
  const ctx = useContext(UnsavedChangesContext)
  if (!ctx) {
    return { hasUnsaved: false, register: (_id: string, _dirty: boolean) => {} }
  }
  return ctx
}

export function confirmLeaveWhenUnsaved(hasUnsaved: boolean): boolean {
  if (!hasUnsaved) return true
  return typeof window !== 'undefined' && window.confirm(LEAVE_MESSAGE)
}

export { LEAVE_MESSAGE }
