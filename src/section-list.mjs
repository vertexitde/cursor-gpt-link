// From 3.31 the model picker builds its sections as a list of
// {id, items, title} entries, once for the menu and once for the grouped view,
// and one renderer per view draws them. A link adds its entries right before
// the pinned models, after whatever a companion added, so the order follows
// the install order. Each renderer is taught once to show an entry's own
// trailing label, which is where the usage of a subscription goes.
const rendererMarker = '/*cursor-links: section trailing*/';
const listPattern = /(\{id:"promoted",items:([\w$]+)\.promoted,title:[\w$]+\?\.promotedSectionTitle\}(?:,\{id:"[\w-]+-models",[^{}]*\})*)(,\{id:"pinned-others",)/g;

export function patchSectionRenderers(source) {
  if (source.includes(rendererMarker)) return source;
  let count = 0;
  const out = source.replace(/trailing:([\w$]+)\.id==="promoted"\?/g, (match, section) => {
    count++;
    return `trailing:${section}.trailing!==void 0${rendererMarker}?${section}.trailing:${section}.id==="promoted"?`;
  });
  if (count !== 2) throw new Error(`Picker section renderers: ${count} matches`);
  return out;
}

// entries(group) returns the entries to add, given the name of the grouped
// models in that list. Entries already present are left alone.
export function insertListSections(source, entries) {
  let count = 0;
  const out = source.replace(listPattern, (match, head, group, tail) => {
    count++;
    const added = entries(group).filter(entry => !head.includes(entry.slice(0, entry.indexOf(',items:') + 1)));
    return head + added.map(entry => ',' + entry).join('') + tail;
  });
  if (count !== 2) throw new Error(`Picker section lists: ${count} matches`);
  return patchSectionRenderers(out);
}
