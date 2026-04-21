/*
 * Shared Brain Dump types for the /brain-dump room components.
 * Mirrors the brain_dump_items table (see migration 039).
 */

export type BrainDumpKind = 'todo' | 'reminder' | 'note' | 'moment'
export type BrainDumpStatus = 'open' | 'done' | 'snoozed' | 'archived'

export interface BrainDumpItem {
  id: string
  org_id: string
  capture_id: string | null
  kind: BrainDumpKind
  status: BrainDumpStatus
  text: string
  due_at: string | null
  priority: 0 | 1 | 2
  tags: string[]
  created_at: string
  updated_at: string
  created_by_user_id: string
  created_by_first_name: string
  updated_by_user_id: string
  deleted_at: string | null
  deleted_by_user_id: string | null
}
