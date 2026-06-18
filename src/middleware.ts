import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth(req => {
  const { nextUrl, auth: session } = req as typeof req & { auth: unknown }
  const isLoggedIn = !!session

  const isProtected =
    nextUrl.pathname.startsWith('/dashboard') ||
    nextUrl.pathname.startsWith('/reviews') ||
    nextUrl.pathname.startsWith('/repos')

  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL('/', nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/dashboard/:path*', '/reviews/:path*', '/repos/:path*'],
}
