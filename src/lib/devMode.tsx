'use client'
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface DevModeCtx { devMode: boolean; toggle: () => void }
const DevModeContext = createContext<DevModeCtx>({ devMode: false, toggle: () => {} })

export function DevModeProvider({ children }: { children: ReactNode }) {
  const [devMode, setDevMode] = useState(false)
  useEffect(() => {
    if (localStorage.getItem('devMode') === 'true') setDevMode(true)
  }, [])
  function toggle() {
    setDevMode(v => { localStorage.setItem('devMode', String(!v)); return !v })
  }
  return <DevModeContext.Provider value={{ devMode, toggle }}>{children}</DevModeContext.Provider>
}

export function useDevMode() { return useContext(DevModeContext) }
