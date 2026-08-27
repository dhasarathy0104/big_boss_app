// Every employee's machine is assumed to be on India time — there is no
// per-user timezone field anywhere in this system, and the whole team is
// India-based, so IST is hardcoded here rather than added as a real setting.
const IST_OFFSET_MINUTES = 5 * 60 + 30;

function istMinutesOfDay(isoUtc) {
  const utc = new Date(isoUtc);
  const istMs = utc.getTime() + IST_OFFSET_MINUTES * 60_000;
  const ist = new Date(istMs);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function parseHHMM(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// NULL start/end means no restriction. A window that crosses midnight
// (e.g. 22:00–06:00) is supported by treating "outside" as strictly
// between end and start instead of assuming start < end.
export function isWithinTrackingWindow(isoUtc, startHHMM, endHHMM) {
  const start = parseHHMM(startHHMM);
  const end = parseHHMM(endHHMM);
  if (start === null || end === null) return true;

  const nowMin = istMinutesOfDay(isoUtc);
  if (start <= end) return nowMin >= start && nowMin < end;
  return nowMin >= start || nowMin < end;
}

export function isValidHHMMOrEmpty(v) {
  if (v === null || v === undefined || v === '') return true;
  return parseHHMM(v) !== null;
}
