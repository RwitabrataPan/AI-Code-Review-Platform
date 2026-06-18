import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getAppOctokit, getInstallationToken } from '@/lib/github/app'
import { Octokit } from '@octokit/rest'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const installationId = request.nextUrl.searchParams.get('installation_id')
  if (!installationId) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const numericId = Number(installationId)

  try {
    const appOctokit = getAppOctokit()
    const { data: installation } = await (appOctokit as any).request(
      'GET /app/installations/{installation_id}',
      { installation_id: numericId }
    )

    await prisma.installation.upsert({
      where: { githubInstallId: numericId },
      update: { active: true },
      create: {
        githubInstallId: numericId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        userId: session.user.id,
      },
    })

    const token = await getInstallationToken(numericId)
    const installOctokit = new Octokit({ auth: token })
    const { data } = await installOctokit.apps.listReposAccessibleToInstallation({ per_page: 100 })

    const installRecord = await prisma.installation.findUniqueOrThrow({
      where: { githubInstallId: numericId },
    })

    await Promise.all(
      data.repositories.map(r =>
        prisma.repository.upsert({
          where: { githubRepoId: r.id },
          update: { fullName: r.full_name, private: r.private },
          create: {
            githubRepoId: r.id,
            fullName: r.full_name,
            private: r.private,
            installationId: installRecord.id,
          },
        })
      )
    )
  } catch (err) {
    console.error('Installation callback error:', err)
  }

  return NextResponse.redirect(new URL('/dashboard', request.url))
}
