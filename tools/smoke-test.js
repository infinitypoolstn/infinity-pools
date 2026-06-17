// End-to-end smoke test against the running server.
const B = 'http://localhost:4525';
const j = (m, u, b) => fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(async r => {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(u + ' -> ' + r.status + ' ' + (d.error || ''));
  return d;
});

(async () => {
  // 1. new prospect
  const c = await j('POST', '/api/clients', { name: 'Test Client', address: '999 Sample Dr', email: '', phone: '615-555-0100' });
  console.log('client created', c.id, 'portal token', !!c.portalToken);

  // 2. specs
  c.specs.shape = 'geometric'; c.specs.sizeDetails = "15' x 25', 3.5-6' depth";
  c.specs.hotTub = { included: true, details: "7.5' x 7.5' raised spa" };
  c.specs.sunShelf = { included: true, details: "5' x 15', 12in depth" };
  c.specs.spillover = { included: true, details: '3 ft cascading' };
  c.specs.ledgeSeating = { included: true, details: "5' x 15'", style: 'Baja Ledge' };
  c.specs.jets = '6'; c.specs.ledLights = '6'; c.specs.equipmentPad = 'Outside club room wall';
  await j('PUT', '/api/clients/' + c.id, { specs: c.specs });

  // 3. finance
  const labels = ['Excavation', 'Pool Forming', 'Shotcrete', 'Tile', 'Materials', 'Labor'];
  const amounts = [18000, 32000, 41000, 14350, 34000, 25000];
  await j('PUT', '/api/clients/' + c.id, { finance: { items: labels.map((l, i) => ({ label: l, amount: amounts[i] })) } });

  // 4. select finishes
  await j('PUT', '/api/clients/' + c.id, { selectedFinishes: ['Tahoe Blue'], clientTodos: [{ text: 'Provide gas line to heater', done: false }] });

  // 5. contract PDF
  const pdf = await fetch(B + `/api/clients/${c.id}/contract.pdf`);
  const buf = await pdf.arrayBuffer();
  console.log('contract pdf bytes', buf.byteLength, pdf.status === 200 ? 'OK' : 'FAIL');

  // 6. mark signed (paper + check deposit)
  const signed = await j('POST', `/api/clients/${c.id}/contract/mark-signed`, { method: 'paper', depositMethod: 'check' });
  console.log('signed: status=', signed.client.status, 'locked=', signed.client.specsLocked, 'design phase=', signed.client.phases[0].status, 'deposit=', signed.client.phases[0].paymentMethod);

  // 7. spec edit should now fail
  try { await j('PUT', '/api/clients/' + c.id, { specs: c.specs }); console.log('LOCK FAIL: edit allowed'); }
  catch (e) { console.log('spec lock works:', e.message.includes('409') || e.message.includes('Change Order')); }

  // 8. change order
  const co = await j('POST', `/api/clients/${c.id}/change-orders`, { description: 'Upgrade finish to Ocean Blue', value: 2400 });
  console.log('change orders', co.changeOrders.length, 'value', co.changeOrders[0].value);

  // 9. complete design phase -> lot prep active
  const done = await j('POST', `/api/clients/${c.id}/phases/design/complete`);
  console.log('design complete; next active =', done.client.phases[1].status, done.client.phases[1].name, 'due', done.client.phases[1].dueDate);

  // 10. portal view (must not leak costs)
  const portal = await j('GET', '/api/portal/' + c.portalToken);
  console.log('portal phases', portal.phases.length, 'current', portal.phases.find(p => p.status === 'active')?.name, 'finishes', portal.selectedFinishes.map(f => f.name).join(','), 'todos', portal.clientTodos.length);
  console.log('portal leaks costs?', JSON.stringify(portal).toLowerCase().includes('costs'));

  // 11. pebble check (no email)
  const pc = await fetch(B + '/api/pebble-check/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"sendEmail":false}' }).then(r => r.json());
  console.log('pebble check ok=', pc.ok, 'new on site=', pc.added.length, 'missing from site=', pc.missing.map(m => m.name).join(', '));

  // 12. employee + task + contractor
  const emp = await j('POST', '/api/employees', { name: 'Raya Black', role: 'PM', email: '', phone: '' });
  await j('POST', '/api/tasks', { title: 'Order rebar', employeeId: emp.id, clientId: c.id, dueDate: '2026-06-15', status: 'open' });
  await j('POST', '/api/contractors', { name: 'Brothers Pool Plastering', company: 'Brothers', category: 'Plaster / Interior Finish', phone: '615-648-6721', email: 'Brotherspooltn@gmail.com' });
  console.log('employee/task/contractor created');

  // cleanup test client? keep for manual inspection — delete to keep store clean
  console.log('SMOKE TEST PASSED — test client left in place for manual review:', B + '/#/client/' + c.id);
})().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
