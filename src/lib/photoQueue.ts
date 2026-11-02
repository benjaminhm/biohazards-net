/*
 * Photos wait here when the signal drops, then upload on their own.
 * A job cannot be closed out while any of its photos are still in this queue.
 */

const DB_NAME = 'fcq-photo-queue'
const STORE = 'pending'

export interface QueuedPhoto {
  id: string
  jobId: string
  stepId: string
  blob: Blob
  deviceTime: string
  lat: number | null
  lng: number | null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = run(tx.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function queuePhoto(item: QueuedPhoto) {
  return withStore('readwrite', store => store.put(item))
}

export function listQueued() {
  return withStore<QueuedPhoto[]>('readonly', store => store.getAll())
}

export function removeQueued(id: string) {
  return withStore('readwrite', store => store.delete(id))
}

export async function pendingCount(jobId?: string) {
  const rows = await listQueued()
  return jobId ? rows.filter(row => row.jobId === jobId).length : rows.length
}

let flushing = false

export async function flushPhotoQueue() {
  if (flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) return
  flushing = true
  try {
    const rows = await listQueued()
    for (const item of rows) {
      const form = new FormData()
      form.set('file', item.blob, 'photo.jpg')
      form.set('job_id', item.jobId)
      form.set('step_id', item.stepId)
      form.set('device_time', item.deviceTime)
      if (item.lat != null) form.set('lat', String(item.lat))
      if (item.lng != null) form.set('lng', String(item.lng))
      const res = await fetch('/api/tech/photos', { method: 'POST', body: form })
      if (!res.ok) break
      await removeQueued(item.id)
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('fcq-photos-flushed'))
  } finally {
    flushing = false
  }
}
