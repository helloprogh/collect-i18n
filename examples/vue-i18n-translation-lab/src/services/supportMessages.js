const MESSAGE_KEYS = {
  created: 'support.messages.created', refreshed: 'support.messages.refreshed', assigned: 'support.messages.assigned',
  replied: 'support.messages.replied', escalated: 'support.messages.escalated', resolved: 'support.messages.resolved',
  closed: 'support.messages.closed', merged: 'support.messages.merged', exported: 'support.messages.exported', noteSaved: 'support.messages.noteSaved',
}
const ERROR_KEYS = {
  loadFailed: 'support.errors.loadFailed', createFailed: 'support.errors.createFailed', assignFailed: 'support.errors.assignFailed',
  replyFailed: 'support.errors.replyFailed', conflict: 'support.errors.conflict', permissionDenied: 'support.errors.permissionDenied',
  serviceUnavailable: 'support.errors.serviceUnavailable',
}
export const operationMessage = (t, action) => t(MESSAGE_KEYS[action])
export const operationError = (t, code) => t(ERROR_KEYS[code])
