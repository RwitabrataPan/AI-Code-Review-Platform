import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export default async function PRPage({
  params,
}: {
  params: { owner: string; repo: string; number: string }
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/')

  const fullName = `${params.owner}/${params.repo}`
  const prNumber = parseInt(params.number, 10)

  const pr = await prisma.pullRequest.findFirst({
    where: { repository: { fullName }, number: prNumber },
    include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })

  if (!pr || pr.reviews.length === 0) notFound()

  redirect(`/reviews/${pr.reviews[0].id}`)
}
