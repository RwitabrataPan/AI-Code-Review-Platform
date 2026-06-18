export interface PullRequestWebhookPayload {
  action: string
  pull_request: {
    id: number
    number: number
    title: string
    body: string | null
    state: string
    head: { sha: string; ref: string }
    base: { sha: string; ref: string }
    user: { login: string }
  }
  repository: {
    id: number
    full_name: string
    name: string
    owner: { login: string }
    private: boolean
  }
  installation: { id: number }
}

export interface InstallationWebhookPayload {
  action: string
  installation: {
    id: number
    account: { login: string; type: string }
  }
  repositories?: Array<{ id: number; full_name: string; private: boolean; name: string }>
}
