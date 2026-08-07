const MESSAGE_KEYS = {
  refreshed: 'inventory.messages.refreshed', adjusted: 'inventory.messages.adjusted', transferred: 'inventory.messages.transferred',
  reserved: 'inventory.messages.reserved', released: 'inventory.messages.released', countStarted: 'inventory.messages.countStarted',
  frozen: 'inventory.messages.frozen', exported: 'inventory.messages.exported', replenishmentCreated: 'inventory.messages.replenishmentCreated',
}
const ERROR_KEYS = {
  loadFailed: 'inventory.errors.loadFailed', adjustFailed: 'inventory.errors.adjustFailed', insufficient: 'inventory.errors.insufficient',
  locked: 'inventory.errors.locked', batchExpired: 'inventory.errors.batchExpired', warehouseOffline: 'inventory.errors.warehouseOffline',
  serviceUnavailable: 'inventory.errors.serviceUnavailable',
}
export const operationMessage = (t, action) => t(MESSAGE_KEYS[action])
export const operationError = (t, code) => t(ERROR_KEYS[code])
