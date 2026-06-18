import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

function getAppAuth() {
  return {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  }
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const auth = createAppAuth(getAppAuth())
  const { token } = await auth({ type: 'installation', installationId })
  return token
}

export function getAppOctokit(): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: getAppAuth(),
  })
}

export function getInstallationOctokit(token: string): Octokit {
  return new Octokit({ auth: token })
}
