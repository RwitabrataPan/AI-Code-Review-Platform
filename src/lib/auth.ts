import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import { prisma } from './db'
import { encrypt } from './crypto'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ account, profile }) {
      if (!account?.providerAccountId || !profile) return false

      await prisma.user.upsert({
        where: { githubId: Number(account.providerAccountId) },
        update: {
          login: (profile as { login?: string }).login ?? profile.name ?? '',
          email: profile.email ?? undefined,
          avatarUrl: ((profile as any).avatar_url ?? (profile as any).image) as string | undefined,
          accessToken: encrypt(account.access_token ?? ''),
        },
        create: {
          githubId: Number(account.providerAccountId),
          login: (profile as { login?: string }).login ?? profile.name ?? '',
          email: profile.email ?? undefined,
          avatarUrl: ((profile as any).avatar_url ?? (profile as any).image) as string | undefined,
          accessToken: encrypt(account.access_token ?? ''),
        },
      })

      return true
    },

    async jwt({ token, account, profile }) {
      if (account?.providerAccountId) {
        const user = await prisma.user.findUnique({
          where: { githubId: Number(account.providerAccountId) },
          select: { id: true },
        })
        token.userId = user?.id
        token.login = (profile as { login?: string })?.login
      }
      return token
    },

    async session({ session, token }) {
      session.user.id = token.userId as string
      session.user.login = token.login as string
      return session
    },
  },
})
