function normalizeVerdict(rawVerdict) {
  if (!rawVerdict || typeof rawVerdict !== 'string') {
    return 'OTHER';
  }

  const value = rawVerdict.trim().toUpperCase().replace(/\s+/g, '_');

  if (['ACCEPTED', 'OK'].includes(value)) {
    return 'ACCEPTED';
  }

  if (
    [
      'WRONG_ANSWER',
      'TIME_LIMIT_EXCEEDED',
      'MEMORY_LIMIT_EXCEEDED',
      'RUNTIME_ERROR',
      'COMPILATION_ERROR',
      'COMPILE_ERROR',
    ].includes(value)
  ) {
    return 'FAILED';
  }

  return 'OTHER';
}

module.exports = normalizeVerdict;