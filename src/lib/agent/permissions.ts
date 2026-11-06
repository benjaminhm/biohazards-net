/*
 * lib/agent/permissions.ts
 *
 * Structured refusals. When an agent tries something it may not do, the tool
 * result is this JSON so the model can tell staff plainly who does it instead.
 */
import { ToolError } from './loop'

export interface PermissionBlock {
  blocked_action: string
  required_permission: string
  handled_by: string
  message: string
}

export function permissionBlock(b: PermissionBlock): PermissionBlock {
  return { ...b }
}

/** Throw from a tool: the loop hands the JSON back as an is_error tool_result. */
export function blocked(b: PermissionBlock): never {
  throw new ToolError(JSON.stringify(permissionBlock(b)))
}

/** Actions no agent has, with who does them instead. */
export const STAFF_ONLY_ACTIONS: Record<string, { required_permission: string; handled_by: string; message: string }> = {
  send_email: { required_permission: 'staff_send', handled_by: 'staff', message: 'Agents never email clients. Staff send emails from the job file.' },
  send_sms: { required_permission: 'staff_send', handled_by: 'staff', message: 'Agents never text clients. Staff send SMS from the job file.' },
  share_link: { required_permission: 'staff_send', handled_by: 'staff', message: 'Agents never share links. Staff share from the job file.' },
  release_to_portal: { required_permission: 'staff_release', handled_by: 'staff', message: 'Agents never release documents to the client portal. Staff release from the job file.' },
  payment_reminder: { required_permission: 'staff_send', handled_by: 'staff', message: 'Agents never send payment reminders. Staff send them from Payment Overdue on the job.' },
  xero_sync: { required_permission: 'staff_xero', handled_by: 'staff', message: 'Agents read the Xero status only. Staff trigger Xero from the job file.' },
  delete: { required_permission: 'staff_delete', handled_by: 'staff', message: 'Agents cannot delete anything. Staff delete from the job file.' },
}

export function staffOnlyBlock(action: string): PermissionBlock {
  const known = STAFF_ONLY_ACTIONS[action]
  return permissionBlock({
    blocked_action: action,
    required_permission: known?.required_permission ?? 'staff',
    handled_by: known?.handled_by ?? 'staff',
    message: known?.message ?? `${action.replace(/_/g, ' ')} is not available to agents. Staff do it from the job file.`,
  })
}
