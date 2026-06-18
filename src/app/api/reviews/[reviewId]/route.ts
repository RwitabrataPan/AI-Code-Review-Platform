import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { reviewId } = await params
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: {
      findings: { where: { published: true }, orderBy: { severity: 'asc' } },
      pullRequest: { include: { repository: true } },
    },
  })

  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(review)
}
