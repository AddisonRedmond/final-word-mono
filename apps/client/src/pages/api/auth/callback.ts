import type { NextApiRequest, NextApiResponse } from 'next'
import { createSupabaseApiRouteClient } from '@/utils/supabase/server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const code = req.query.code as string | undefined

  if (code) {
    try {
      const supabase = createSupabaseApiRouteClient(req, res)
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) {
        return res.redirect('/')
      }
    } catch {
      // fall through to error redirect
    }
  }

  return res.redirect('/sign-in?error=auth-code-error')
}
