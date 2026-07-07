// Parse a filled "Pool Specification — Sales Intake" PDF (see spec-intake-pdf.js)
// back into the client fields + Pool Specs shape used by the app. Reads AcroForm
// field values via pdf.js (bundled with pdf-parse as pdfjs-dist).
//
// The generator makes field names unique by appending _<seq> (owner_builder_0,
// pb_size_9, …). We strip that suffix to recover the stable base name.

function baseName(n) { return String(n).replace(/_\d+$/, ''); }

async function parseIntake(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false,
  }).promise;

  let fieldObjs;
  try {
    fieldObjs = await doc.getFieldObjects();
  } finally {
    await doc.destroy?.();
  }
  if (!fieldObjs || !Object.keys(fieldObjs).length) {
    throw new Error('no fillable fields found — is this the Sales Rep Form?');
  }

  const text = {};      // base name -> trimmed text value
  const checked = {};   // base name -> boolean
  const notesLines = [];
  for (const [rawName, arr] of Object.entries(fieldObjs)) {
    const f = Array.isArray(arr) ? arr[0] : arr;
    if (!f) continue;
    const base = baseName(rawName);
    if (f.type === 'checkbox') {
      checked[base] = !!(f.value && f.value !== 'Off');
    } else {
      const str = (f.value == null ? '' : String(f.value)).trim();
      if (base === 'notes') { if (str) notesLines.push(str); }
      else text[base] = str;
    }
  }

  const t = k => text[k] || '';
  const ck = k => !!checked[k];

  // A section counts as "included" if its checkbox is ticked OR the rep filled in
  // any of its detail fields (a common way to forget the checkbox).
  const specs = {
    poolBase: {
      price: 0,
      shape: (ck('pb_shape_freeform') || (!!t('pb_freeform') && !ck('pb_shape_geometric'))) ? 'freeform' : 'geometric',
      freeform: t('pb_freeform'),
      size: t('pb_size'),
      depth: t('pb_depth'),
      jets: t('pb_jets'),
      ledLights: t('pb_led'),
      sunShelf: { included: ck('pb_sunshelf_inc') || !!t('pb_sunshelf_det'), details: t('pb_sunshelf_det') },
      spillover: { included: ck('pb_spillover_inc') || !!t('pb_spillover_det'), details: t('pb_spillover_det') },
      ledgeSeating: { included: ck('pb_ledge_inc') || !!t('pb_ledge_det'), details: t('pb_ledge_det') },
    },
    spaBase: {
      included: ck('spa_inc') || !!(t('spa_size') || t('spa_jets') || t('spa_led') || t('spa_det')),
      price: 0, size: t('spa_size'), jets: t('spa_jets'), ledLights: t('spa_led'), details: t('spa_det'),
    },
    waterFeature: { included: ck('wf_inc') || !!t('wf_det'), price: 0, details: t('wf_det') },
    coldPlunge: { included: ck('cp_inc') || !!(t('cp_det') || t('cp_led') || t('cp_addl')), price: 0, details: t('cp_det'), ledLights: t('cp_led'), additionalDetails: t('cp_addl') },
    fireFeature: { included: ck('ff_inc') || !!t('ff_det'), price: 0, details: t('ff_det') },
    equipmentPad: t('pb_equippad'),
    addOns: [],
  };

  // Sales Rep / Date have no dedicated client fields — fold them into notes so the
  // information isn't lost, above whatever the rep wrote in the Notes lines.
  const metaLine = [t('sales_rep') && ('Sales Rep: ' + t('sales_rep')), t('date') && ('Intake date: ' + t('date'))]
    .filter(Boolean).join('  •  ');
  const notes = [metaLine, notesLines.join('\n')].filter(Boolean).join('\n');

  return { name: t('owner_builder'), address: t('address'), phone: t('phone'), email: t('email'), notes, specs };
}

module.exports = { parseIntake };
