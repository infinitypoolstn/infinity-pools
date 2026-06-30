// Phase-lifecycle automation: phase completion -> next phase activates,
// dashboard alerts + Gmail to all employees, payment request to the client.
// Daily 7 AM digest covers approaching/overdue phase due dates and tasks.
const store = require('./store');
const mailer = require('./mailer');

const fmtMoney = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

function phaseWeeksSpan(time) {
  // "Weeks 3-5" -> 3 weeks, "Week 9" -> 1 week
  const m = (time || '').match(/(\d+)\s*-\s*(\d+)/);
  return m ? (Number(m[2]) - Number(m[1]) + 1) : 1;
}

function paymentSecurityBlurb() {
  return `<p style="font-size:13px;color:#4a6b85;background:#eef6fc;border:1px solid #d7e8f5;border-radius:8px;padding:10px 14px;">
    <b>About this payment link:</b> payments are processed securely by Intuit QuickBooks — the same company behind TurboTax.
    Infinity Pools never sees or stores your card or bank details. The link opens your invoice on QuickBooks' secure (https) payment page,
    where you can pay by bank transfer (ACH) or card and download a receipt. If you'd rather pay by check, just reply to this email.</p>`;
}

function feeNote() {
  const q = store.data.settings.quickbooks;
  if (!q.passFeesToClient) return '';
  return `<p style="font-size:13px;color:#4a6b85;">Processing fees: ${q.achFeeNote}; ${q.ccFeeNote}. Checks incur no fee.</p>`;
}

/** Email the client a payment request for a phase draw. */
async function sendPaymentRequest(client, phase) {
  const amount = store.phaseAmount(client, phase);
  if (amount <= 0) return null;
  // Every phase draw is a partial payment against the single master invoice created
  // at signing — no per-phase invoices. Use a manually pasted per-phase link if set,
  // otherwise the master invoice's guest-pay link.
  const link = phase.paymentLink || (client.quickbooks && client.quickbooks.payLink) || phase.payLink || '';
  const portal = `/portal/${client.portalToken}`;
  const rec = await mailer.send({
    to: client.email,
    subject: `Infinity Pools — ${phase.name} payment due for ${client.address}`,
    html: `<p>Hi ${client.name.split(' ')[0]},</p>
      <p>Your pool build at <b>${client.address}</b> is moving into the <b>${phase.name}</b> phase.
      Per your contract's Budget &amp; Timeline, the draw for this phase is:</p>
      <p style="font-size:26px;font-weight:700;color:#0a5ea8;margin:10px 0;">${fmtMoney(amount)} <span style="font-size:13px;color:#6b8aa5;font-weight:400;">(${phase.drawPct}% of contract total)</span></p>
      ${link ? `<p><a href="${link}" style="display:inline-block;background:#0a5ea8;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">Pay securely with QuickBooks</a></p>` : '<p>We will follow up with your secure QuickBooks payment link shortly. You may also pay by check.</p>'}
      ${feeNote()}
      ${paymentSecurityBlurb()}
      <p>You can follow your build progress any time on your <a href="${portal}">project page</a>.</p>
      <p>Thank you!<br>Infinity Pools</p>`,
  });
  phase.paymentRequestedAt = new Date().toISOString();
  store.save();
  return rec;
}

/**
 * Auto-create the configured task workflow for a phase that just became
 * active. Due dates are offset from today; assignees get one email each
 * listing their new tasks.
 */
async function spawnPhaseTasks(client, phase) {
  const templates = (store.data.settings.taskTemplates || {})[phase.key] || [];
  const created = [];
  for (const t of templates) {
    if (!t.title || !String(t.title).trim()) continue;
    const due = new Date();
    due.setDate(due.getDate() + (Number(t.dueOffsetDays) || 0));
    const task = {
      id: store.id(), title: t.title, details: t.details || '',
      employeeId: t.employeeId || null, clientId: client.id,
      dueDate: due.toISOString().slice(0, 10), status: 'open',
      createdAt: new Date().toISOString(), source: 'auto',
    };
    store.data.tasks.push(task);
    created.push(task);
  }
  if (!created.length) return created;
  store.addAlert(`${client.address}: ${created.length} task(s) auto-created for ${phase.name}`, { clientId: client.id, type: 'info' });

  // one email per assignee with their new tasks
  const byEmp = {};
  for (const t of created) if (t.employeeId) (byEmp[t.employeeId] = byEmp[t.employeeId] || []).push(t);
  for (const [empId, tasks] of Object.entries(byEmp)) {
    const emp = store.data.employees.find(e => e.id === empId);
    if (!emp || !emp.email) continue;
    await mailer.send({
      to: emp.email,
      subject: `New tasks — ${phase.name} at ${client.address}`,
      html: `<p>Hi ${emp.name.split(' ')[0]},</p>
        <p>The <b>${phase.name}</b> phase just started at <b>${client.address}</b>. Your tasks:</p>
        <ul>${tasks.map(t => `<li><b>${t.title}</b> — due ${fmtDate(t.dueDate)}</li>`).join('')}</ul>`,
    });
  }
  store.save();
  return created;
}

/** Mark a phase complete, activate the next, alert everyone. */
async function completePhase(client, phaseKey) {
  const idx = client.phases.findIndex(p => p.key === phaseKey);
  if (idx === -1) throw new Error('Unknown phase');
  const phase = client.phases[idx];
  phase.status = 'complete';
  phase.completedAt = new Date().toISOString();

  const next = client.phases[idx + 1] || null;
  let nextMsg = '';
  if (next) {
    next.status = 'active';
    next.startedAt = new Date().toISOString();
    if (!next.dueDate) {
      const due = new Date();
      due.setDate(due.getDate() + 7 * phaseWeeksSpan(next.time));
      next.dueDate = due.toISOString().slice(0, 10);
    }
    nextMsg = `Next phase: <b>${next.name}</b>, target completion ${fmtDate(next.dueDate)}.`;
  } else {
    client.status = 'completed';
    nextMsg = 'This was the final phase — the build is complete! 🎉';
  }

  store.addAlert(`${client.address}: ${phase.name} complete. ${next ? 'Now in ' + next.name + ' (due ' + fmtDate(next.dueDate) + ')' : 'BUILD COMPLETE'}`, { clientId: client.id, type: 'phase' });

  // Email every employee
  const emails = mailer.allEmployeeEmails();
  if (emails.length) {
    await mailer.send({
      to: emails,
      subject: `[${client.address}] ${phase.name} complete${next ? ' → ' + next.name + ' now active' : ' — BUILD COMPLETE'}`,
      html: `<p><b>${client.address}</b> (${client.name})</p>
        <p>The <b>${phase.name}</b> phase was marked complete on ${fmtDate(phase.completedAt)}.</p>
        <p>${nextMsg}</p>
        ${next && next.drawPct > 0 ? `<p>The ${next.drawPct}% draw (${fmtMoney(store.phaseAmount(client, next))}) payment request ${client.email ? 'has been emailed to the client' : 'needs to be sent'}.</p>` : ''}`,
    });
  }

  // Payment request to client for the next phase draw
  if (next && next.drawPct > 0 && client.email) {
    await sendPaymentRequest(client, next);
  }
  // Auto-create the next phase's task workflow
  if (next) await spawnPhaseTasks(client, next);
  store.save();
  return { phase, next };
}

/** Daily digest: phases due soon/overdue + tasks due soon/overdue. */
async function dailyDigest() {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(); soon.setDate(soon.getDate() + (store.data.settings.alertDaysBefore || 3));
  const soonStr = soon.toISOString().slice(0, 10);

  const phaseItems = [];
  for (const c of store.data.clients) {
    if (c.status !== 'active') continue;
    for (const p of c.phases) {
      if (p.status === 'active' && p.dueDate) {
        if (p.dueDate < today) phaseItems.push({ c, p, label: 'OVERDUE' });
        else if (p.dueDate <= soonStr) phaseItems.push({ c, p, label: 'due soon' });
      }
    }
  }
  const taskItems = store.data.tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate <= soonStr);

  if (!phaseItems.length && !taskItems.length) return null;

  for (const i of phaseItems) {
    store.addAlert(`${i.c.address}: ${i.p.name} is ${i.label} (due ${fmtDate(i.p.dueDate)})`, { clientId: i.c.id, type: i.label === 'OVERDUE' ? 'error' : 'warning' });
  }
  for (const t of taskItems) {
    const emp = store.data.employees.find(e => e.id === t.employeeId);
    store.addAlert(`Task "${t.title}" (${emp ? emp.name : 'unassigned'}) due ${fmtDate(t.dueDate)}`, { clientId: t.clientId, type: 'warning' });
  }

  const emails = mailer.allEmployeeEmails();
  if (emails.length) {
    const phaseRows = phaseItems.map(i => `<li><b>${i.c.address}</b> — ${i.p.name} <span style="color:${i.label === 'OVERDUE' ? '#b00020' : '#9a6700'}">${i.label}</span> (due ${fmtDate(i.p.dueDate)})</li>`).join('');
    const taskRows = taskItems.map(t => {
      const emp = store.data.employees.find(e => e.id === t.employeeId);
      const cl = store.data.clients.find(c => c.id === t.clientId);
      return `<li>"${t.title}" — ${emp ? emp.name : 'unassigned'}${cl ? ' @ ' + cl.address : ''} (due ${fmtDate(t.dueDate)})</li>`;
    }).join('');
    await mailer.send({
      to: emails,
      subject: `Infinity Pools daily alert — ${phaseItems.length} phase(s), ${taskItems.length} task(s) need attention`,
      html: `${phaseRows ? '<p><b>Build phases:</b></p><ul>' + phaseRows + '</ul>' : ''}
             ${taskRows ? '<p><b>Tasks:</b></p><ul>' + taskRows + '</ul>' : ''}`,
    });
  }
  return { phases: phaseItems.length, tasks: taskItems.length };
}

/** Reminder email for one task. */
async function taskReminder(task) {
  const emp = store.data.employees.find(e => e.id === task.employeeId);
  if (!emp || !emp.email) throw new Error('Task has no assignee with an email address');
  const cl = store.data.clients.find(c => c.id === task.clientId);
  return mailer.send({
    to: emp.email,
    subject: `Task reminder: ${task.title}${cl ? ' — ' + cl.address : ''}`,
    html: `<p>Hi ${emp.name.split(' ')[0]},</p>
      <p>Reminder about your task${cl ? ` for <b>${cl.address}</b>` : ''}:</p>
      <p style="font-size:17px;font-weight:600;color:#0a5ea8;">${task.title}</p>
      ${task.details ? `<p>${task.details}</p>` : ''}
      <p>Due: <b>${fmtDate(task.dueDate)}</b></p>`,
  });
}

module.exports = { completePhase, sendPaymentRequest, dailyDigest, taskReminder, spawnPhaseTasks, fmtMoney, fmtDate };
