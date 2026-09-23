const normalizeComparable = (value) => String(value ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
  .trim();

const asList = (value) => Array.isArray(value) ? value : [value];

const getRecordValue = (record, fields = []) => {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record || {}, field)) continue;
    const value = record[field];
    if (value !== undefined && value !== null && value !== '') {
      return { field, value };
    }
  }
  return null;
};

const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const matchesExpectation = (value, expectation) => {
  const comparator = String(expectation?.comparator || '').toLowerCase();
  if (comparator === 'present') return value !== undefined && value !== null && value !== '';

  if (comparator === 'equals_any') {
    const expected = asList(expectation?.values || [])
      .map(normalizeComparable)
      .filter(Boolean);
    return asList(value).some((candidate) => expected.includes(normalizeComparable(candidate)));
  }

  if (comparator === 'range') {
    const numeric = toNumber(value);
    if (numeric === null) return false;
    const min = expectation?.min == null ? -Infinity : Number(expectation.min);
    const max = expectation?.max == null ? Infinity : Number(expectation.max);
    return Number.isFinite(min) && Number.isFinite(max) && numeric >= min && numeric <= max;
  }

  return false;
};

/**
 * Compare returned ad records with one DS tier's verification expectations.
 * The result intentionally includes the field names observed in the records;
 * this is the useful feedback when DS's candidate name is not indexed here.
 */
export function verifyAiExpectations(expectations = [], records = []) {
  const rows = Array.isArray(records) ? records : [];
  const filters = (Array.isArray(expectations) ? expectations : []).map((expectation) => {
    const fields = Array.isArray(expectation?.record_fields)
      ? expectation.record_fields.map(String)
      : [];
    const observedFields = new Set();
    let checked = 0;
    let failed = 0;

    for (const record of rows) {
      const match = getRecordValue(record, fields);
      if (!match) {
        continue;
      }
      observedFields.add(match.field);
      checked += 1;
      if (!matchesExpectation(match.value, expectation)) failed += 1;
    }

    // A field absent from every returned row cannot be called a violation:
    // there is no record data with which to test the planner's guess.
    const status = checked === 0 ? 'unverifiable' : failed > 0 ? 'violated' : 'verified';
    return {
      filter: expectation?.filter || null,
      comparator: expectation?.comparator || null,
      status,
      candidateFields: fields,
      actualFields: [...observedFields],
      recordsChecked: checked,
      recordsFailed: failed,
    };
  });

  return {
    recordsChecked: rows.length,
    filters,
  };
}

export function mergeAiExpectationReports(previous, next) {
  if (!previous) return next;
  const nextFilters = new Map((next?.filters || []).map((entry) => [entry.filter, entry]));
  const filters = (previous.filters || []).map((entry) => {
    const current = nextFilters.get(entry.filter);
    if (!current) return entry;
    const actualFields = [...new Set([...(entry.actualFields || []), ...(current.actualFields || [])])];
    const recordsChecked = (entry.recordsChecked || 0) + (current.recordsChecked || 0);
    const recordsFailed = (entry.recordsFailed || 0) + (current.recordsFailed || 0);
    const status = recordsChecked === 0
      ? 'unverifiable'
      : recordsFailed > 0
        ? 'violated'
        : 'verified';
    return { ...entry, status, actualFields, recordsChecked, recordsFailed };
  });
  return {
    recordsChecked: (previous.recordsChecked || 0) + (next?.recordsChecked || 0),
    filters,
  };
}
