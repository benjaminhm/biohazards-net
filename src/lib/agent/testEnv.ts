/* Placeholder Supabase env so agent modules load in unit tests (no network is used). */
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test'

export {}
