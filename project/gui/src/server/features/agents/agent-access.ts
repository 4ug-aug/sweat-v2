export function canManageAgentAccess(account: {
  role?: string | null
}): boolean {
  return account.role === 'admin'
}
