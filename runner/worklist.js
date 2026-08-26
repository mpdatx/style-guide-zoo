import { isCurrent, readRecord, recordPath } from './record.js';

function applyFilter(items, ids, label) {
  if (!ids || ids.length === 0) return items;
  const known = new Set(items.map((i) => i.id));
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`Unknown ${label} id: ${id}`);
  }
  const wanted = new Set(ids);
  return items.filter((i) => wanted.has(i.id));
}

/**
 * Enumerate every generation that still needs to happen.
 * A run is skipped when a record exists that was produced from exactly the
 * current guide, passage, and template content, and succeeded.
 */
export async function buildWorklist({
  guides, passages, template, runsPerCell, resultsDir, filters = {}, force = false
}) {
  const selectedGuides = applyFilter(guides, filters.guideIds, 'guide');
  const selectedPassages = applyFilter(passages, filters.passageIds, 'passage');

  const items = [];
  for (const guide of selectedGuides) {
    for (const passage of selectedPassages) {
      for (let runIndex = 1; runIndex <= runsPerCell; runIndex += 1) {
        const path = recordPath(resultsDir, guide.id, passage.id, runIndex);
        if (!force && isCurrent(await readRecord(path), { guide, passage, template })) {
          continue;
        }
        items.push({ guide, passage, template, runIndex, path });
      }
    }
  }
  return items;
}
