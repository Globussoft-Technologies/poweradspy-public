export function daysRunning(firstSeen, lastSeen) {
  const firstSeenDate = new Date(firstSeen);
  const lastSeenDate = new Date(lastSeen);

  const differenceTime = lastSeenDate - firstSeenDate;

  const days = Math.round(differenceTime / (24 * 60 * 60 * 1000));
  return days === 0 ? 1 : days;
}

export default function convertTimeStamp(timestamp) {
  const date = new Date(timestamp * 1000);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
