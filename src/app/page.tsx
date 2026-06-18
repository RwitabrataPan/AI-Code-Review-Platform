import { Button } from '@/components/ui/button'
import { auth, signIn } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function LandingPage() {
  const session = await auth()
  if (session?.user) redirect('/dashboard')

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted px-4">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-5xl font-bold tracking-tight">
          AI Code Review
        </h1>
        <p className="text-xl text-muted-foreground">
          Security vulnerabilities and code smells caught automatically on every Pull Request.
          Powered by Claude.
        </p>
        <div className="flex gap-4 justify-center">
          <form action={async () => {
            'use server'
            await signIn('github', { redirectTo: '/dashboard' })
          }}>
            <Button type="submit" size="lg">
              Login with GitHub
            </Button>
          </form>
        </div>
        <p className="text-sm text-muted-foreground">
          Connects to your GitHub repositories via GitHub App integration.
        </p>
      </div>
    </main>
  )
}
