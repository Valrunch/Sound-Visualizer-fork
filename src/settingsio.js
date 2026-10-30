import GLib from 'gi://GLib';

const NOT_EXPORTED = new Set([
  'visualizer-location',
  'glow-color-expanded',
  'spect-value-expanded',
  'spect-over-ride-bool',
  'spect-over-ride',
  'fill-visualizer',
]);

export function serializeSettings(settings) {
  const data = {};
  for (const key of settings.settings_schema.list_keys()) {
    if (!NOT_EXPORTED.has(key))
      data[key] = settings.get_value(key).print(true);
  }
  return JSON.stringify(data, null, 2);
}

export function applySettings(settings, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('This file is not valid JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    throw new Error('This file does not contain visualizer settings');

  const schema = settings.settings_schema;
  const skipped = [];
  let imported = 0;
  for (const [key, printed] of Object.entries(data)) {
    if (NOT_EXPORTED.has(key) || typeof printed !== 'string' || !schema.has_key(key)) {
      skipped.push(key);
      continue;
    }
    try {
      const info = schema.get_key(key);
      const value = GLib.Variant.parse(info.get_value_type(), printed, null, null);
      if (!info.range_check(value)) {
        skipped.push(key);
        continue;
      }
      settings.set_value(key, value);
      imported++;
    } catch (e) {
      skipped.push(key);
    }
  }
  return {imported, skipped};
}
