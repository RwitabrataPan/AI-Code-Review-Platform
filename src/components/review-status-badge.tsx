import { Badge } from '@/components/ui/badge'

const CONFIG = {
  PENDING:    { label: 'Pending',    className: 'bg-yellow-100 text-yellow-800' },
  PROCESSING: { label: 'Processing', className: 'bg-blue-100 text-blue-800 animate-pulse' },
  COMPLETED:  { label: 'Completed',  className: 'bg-green-100 text-green-800' },
  FAILED:     { label: 'Failed',     className: 'bg-red-100 text-red-800' },
} as const

type Status = keyof typeof CONFIG

export function ReviewStatusBadge({ status }: { status: Status }) {
  const { label, className } = CONFIG[status] ?? CONFIG.PENDING
  return <Badge className={className}>{label}</Badge>
}
