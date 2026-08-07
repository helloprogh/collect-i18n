const MESSAGE_KEYS = {
  refreshed: 'billing.messages.refreshed', reminderSent: 'billing.messages.reminderSent', paymentRecorded: 'billing.messages.paymentRecorded',
  refundCreated: 'billing.messages.refundCreated', invoiceVoided: 'billing.messages.invoiceVoided', reconciled: 'billing.messages.reconciled',
  downloaded: 'billing.messages.downloaded', exported: 'billing.messages.exported', noteSaved: 'billing.messages.noteSaved',
}
const ERROR_KEYS = {
  loadFailed: 'billing.errors.loadFailed', paymentFailed: 'billing.errors.paymentFailed', duplicatePayment: 'billing.errors.duplicatePayment',
  invoiceLocked: 'billing.errors.invoiceLocked', reconcileFailed: 'billing.errors.reconcileFailed', permissionDenied: 'billing.errors.permissionDenied',
  serviceUnavailable: 'billing.errors.serviceUnavailable',
}
export const operationMessage = (t, action) => t(MESSAGE_KEYS[action])
export const operationError = (t, code) => t(ERROR_KEYS[code])
