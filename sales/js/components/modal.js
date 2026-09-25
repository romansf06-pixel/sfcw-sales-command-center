// Minimal reusable modal — used for "Set Follow-Up" and similar small forms
// that multiple views need without each reimplementing an overlay.
import { FOLLOWUP_PRESETS, escapeHtml, toast } from '../util.js';
import { api } from '../api.js';

export function showModal(innerHtml) {
  let el = document.getElementById('modal-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'modal-overlay';
    el.className = 'palette-overlay';
    el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="palette" style="padding:18px;">${innerHtml}</div>`;
  el.classList.add('open');
  return el;
}
export function closeModal() {
  const el = document.getElementById('modal-overlay');
  if (el) el.classList.remove('open');
}

export function openFollowupModal(leadId, onSaved) {
  const presets = FOLLOWUP_PRESETS.map(([label, ms], i) =>
    `<button class="btn" data-preset="${ms}" style="margin:3px;">${escapeHtml(label)}</button>`).join('');
  const el = showModal(`
    <div class="card-title">Set Follow-Up</div>
    <div style="display:flex;flex-wrap:wrap;margin-bottom:10px;">${presets}<button class="btn" data-preset="custom" style="margin:3px;">Custom</button></div>
    <input type="datetime-local" id="fu-custom" style="display:none;width:100%;margin-bottom:10px;">
    <input type="text" id="fu-reason" placeholder="Reason (optional)" style="width:100%;margin-bottom:8px;">
    <textarea id="fu-note" placeholder="Note (optional)" style="width:100%;min-height:60px;margin-bottom:10px;"></textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn ghost" id="fu-cancel">Cancel</button>
      <button class="btn primary" id="fu-save" disabled>Save Follow-Up</button>
    </div>
  `);
  let dueAt = null;
  el.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', () => {
    el.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('primary'));
    btn.classList.add('primary');
    const customInput = el.querySelector('#fu-custom');
    if (btn.dataset.preset === 'custom') {
      customInput.style.display = 'block';
      dueAt = customInput.value ? new Date(customInput.value).getTime() : null;
    } else {
      customInput.style.display = 'none';
      dueAt = Date.now() + Number(btn.dataset.preset);
    }
    el.querySelector('#fu-save').disabled = !dueAt;
  }));
  el.querySelector('#fu-custom').addEventListener('input', (e) => {
    dueAt = e.target.value ? new Date(e.target.value).getTime() : null;
    el.querySelector('#fu-save').disabled = !dueAt;
  });
  el.querySelector('#fu-cancel').addEventListener('click', closeModal);
  el.querySelector('#fu-save').addEventListener('click', async () => {
    try {
      await api.addFollowup(leadId, dueAt, el.querySelector('#fu-reason').value || null, el.querySelector('#fu-note').value || null);
      toast('Follow-up saved');
      closeModal();
      if (onSaved) onSaved();
    } catch (e) { toast('Error: ' + e.message); }
  });
}
