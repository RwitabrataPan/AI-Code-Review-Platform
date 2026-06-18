import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export default async function PRPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/')

  const { owner, repo, number } = await params
  const fullName = `${owner}/${repo}`
  const prNumber = parseInt(number, 10)

  const pr = await prisma.pullRequest.findFirst({
    where: { repository: { fullName }, number: prNumber },
    include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })

  if (!pr || pr.reviews.length === 0) notFound()

  redirect(`/reviews/${pr.reviews[0].id}`)
}
