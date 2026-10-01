'use strict';

// The common request carries direction separately from legacy sort flags. A
// legacy flag value still wins when direct network callers omit order_by.
function getSortOrder(params = {}, legacyValue) {
  const requested = String(params.order_by ?? '').trim().toLowerCase();
  if (requested === 'asc' || requested === 'desc') return requested;
  return String(legacyValue ?? '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

module.exports = { getSortOrder };
