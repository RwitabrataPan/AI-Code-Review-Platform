import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: { reviewId: string } }
): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const review = await prisma.review.findUnique({
    where: { id: params.reviewId },
    include: {
      findings: { where: { published: true }, orderBy: { severity: 'asc' } },
      pullRequest: { include: { repository: true } },
    },
  })

  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(review)
}
