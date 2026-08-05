// Share identical read requests while they are in flight. React effects may be
// restarted during bootstrap (and are intentionally restarted by StrictMode in
// development); callers should observe the same promise instead of sending the
// same HTTP request again.
const inFlightRequests = new Map();

export function dedupeInFlight(key, operation) {
  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const request = Promise.resolve().then(operation);
  inFlightRequests.set(key, request);

  const clear = () => {
    if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
  };
  request.then(clear, clear);

  return request;
}

