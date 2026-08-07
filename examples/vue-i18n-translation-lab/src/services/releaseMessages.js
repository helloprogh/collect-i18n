const MESSAGE_KEYS = {
  refreshed: 'releases.messages.refreshed', created: 'releases.messages.created', submitted: 'releases.messages.submitted',
  approved: 'releases.messages.approved', rejected: 'releases.messages.rejected', scheduled: 'releases.messages.scheduled',
  started: 'releases.messages.started', rollbackStarted: 'releases.messages.rollbackStarted',
}
const ERROR_KEYS = {
  loadFailed: 'releases.errors.loadFailed', createFailed: 'releases.errors.createFailed', approvalConflict: 'releases.errors.approvalConflict',
  windowConflict: 'releases.errors.windowConflict', dependencyBlocked: 'releases.errors.dependencyBlocked', permissionDenied: 'releases.errors.permissionDenied',
  serviceUnavailable: 'releases.errors.serviceUnavailable',
}
export const operationMessage = (t, action) => t(MESSAGE_KEYS[action])
export const operationError = (t, code) => t(ERROR_KEYS[code])
