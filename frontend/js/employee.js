// Employee dashboard frontend
// Uses Fetch API, Bootstrap modals, Chart.js

const apiBase = 'http://localhost:5000/api';
let user = null;
let employeeId = null;
let goals = [];
let statusChart, weightChart, trendChart;

// Utility UI helpers
function showAlert(containerId, message, type = 'danger', timeout = 5000) {
  const el = document.getElementById(containerId);
  el.innerHTML = `<div class="alert alert-${type} alert-sm">${escapeHtml(message)}</div>`;
  if (window.AppUX) AppUX.toast(type === 'danger' ? 'error' : type, message);
  if (timeout) setTimeout(() => el.innerHTML = '', timeout);
}

function $el(id){ return document.getElementById(id); }

function formatPercent(n) { return (Math.round(n * 10) / 10) + '%'; }

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAuthHeaders(hasBody = true) {
  const headers = {};
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (user?.token) headers['Authorization'] = `Bearer ${user.token}`;
  return headers;
}

function setLoading(button, loading=true, text=''){
  if (window.AppUX) return AppUX.setButtonLoading(button, loading, text || 'Working');
  if (!button) return;
  if (loading) { button.disabled = true; button.dataset.orig = button.innerHTML; button.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${text}`; }
  else { button.disabled = false; if (button.dataset.orig) button.innerHTML = button.dataset.orig; }
}

// Role protection
function protect() {
  try {
    user = JSON.parse(localStorage.getItem('user')) || JSON.parse(sessionStorage.getItem('user'));
  } catch(e){ user = null; }
  if (!user || user.role !== 'employee') {
    window.location.href = 'login.html';
    return false;
  }
  employeeId = user._id || user.id || user.employeeId;
  document.getElementById('employeeName').textContent = user.name || user.email || 'Employee';
  document.getElementById('userWelcome').textContent = `${user.email || ''}`;
  return true;
}

// Fetching data
async function fetchGoals() {
  try {
    const res = await fetch(`${apiBase}/goals/${employeeId}`, {
      headers: getAuthHeaders(false)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.message || 'Failed to load goals');
    }
    goals = await res.json();
    return goals;
  } catch (err) { showAlert('goalsAlert', err.message || err); goals = []; return []; }
}

// Rendering summary cards
function renderSummary() {
  const total = goals.length;
  const totalWeight = goals.reduce((s,g)=> s + Number(g.weightage || 0),0);
  const counts = {draft:0, submitted:0, approved:0, returned:0};
  goals.forEach(g => counts[g.status] = (counts[g.status] || 0) + 1);

  const cards = [
    {title:'Total Goals', value: total, color:'bg-primary'},
    {title:'Total Weightage', value: totalWeight + '%', color:'bg-info'},
    {title:'Draft', value: counts.draft || 0, color:'bg-secondary'},
    {title:'Submitted', value: counts.submitted || 0, color:'bg-warning text-dark'},
    {title:'Approved', value: counts.approved || 0, color:'bg-success'},
    {title:'Returned', value: counts.returned || 0, color:'bg-danger'}
  ];

  const container = document.getElementById('summaryRow');
  container.innerHTML = '';
  cards.forEach(c=>{
    const col = document.createElement('div'); col.className = 'col-6 col-md-4 col-xl-2';
    col.innerHTML = `<div class="card summary-card shadow-sm"><div class="card-body d-flex align-items-center justify-content-between"><div><small class="text-muted">${c.title}</small><div class="fs-5 fw-semibold">${c.value}</div></div><div><span class="badge ${c.color} rounded-pill px-3 py-2"></span></div></div></div>`;
    container.appendChild(col);
  });
}

function showWeightageWarning() {
  const totalWeight = goals.reduce((sum, goal) => sum + Number(goal.weightage || 0), 0);
  if (totalWeight > 100) {
    showAlert('goalsAlert', `Total weightage is ${totalWeight}%. It must not exceed 100%. Ask your manager or admin to adjust the shared goal weightage.`, 'warning', 0);
  }
}

// Render goals table
function renderGoalsTable() {
  const tbody = document.getElementById('goalsTbody');
  tbody.innerHTML = '';
  if (!goals.length) {
    document.getElementById('emptyGoals').innerHTML = window.AppUX
      ? AppUX.emptyState('No goals yet', 'Create your first goal to start building a complete 100% goal sheet.', 'bi-clipboard-plus')
      : '<div>No goals yet. Click "New Goal" to create one.</div>';
    document.getElementById('emptyGoals').style.display = 'block';
    return;
  }
  document.getElementById('emptyGoals').style.display = 'none';

  goals.forEach(g=>{
    const tr = document.createElement('tr');
    const sharedBadge = (g.isShared || g.sharedGoalId) ? `<span class="shared-badge">Shared</span>` : '';
    const progress = Number(g.progress || 0);
    const statusClass = {
      draft: 'status-draft badge bg-secondary',
      submitted: 'status-submitted badge bg-warning text-dark',
      approved: 'status-approved badge bg-success',
      returned: 'status-returned badge bg-danger'
    }[g.status] || 'badge bg-light';

    tr.innerHTML = `
      <td>${g.title || '-'} ${sharedBadge}</td>
      <td>${g.thrustArea || '-'}</td>
      <td>${g.uomType || '-'}</td>
      <td>${g.scoreType || '-'}</td>
      <td>${g.target || '-'}</td>
      <td>${g.weightage || 0}%</td>
      <td><span class="${statusClass}">${g.status}</span></td>
      <td style="min-width:160px"><div class="d-flex align-items-center"><div class="flex-grow-1 me-2"><div class="progress" style="height:10px"><div class="progress-bar" role="progressbar" style="width:${progress}%"></div></div></div><small class="text-muted">${progress}%</small></div></td>
      <td class="text-end table-actions">
        <button class="btn btn-sm btn-outline-primary" data-action="view" data-id="${g._id}"><i class="bi bi-eye"></i></button>
        <button class="btn btn-sm btn-outline-success" data-action="update" data-id="${g._id}"><i class="bi bi-pencil-square"></i></button>
        <button class="btn btn-sm btn-outline-info" data-action="updates" data-id="${g._id}"><i class="bi bi-list-ul"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${g._id}"><i class="bi bi-trash"></i></button>
      </td>
    `;

    // Hide edit/delete for approved goals
    if (g.status === 'approved') {
      tr.querySelectorAll('[data-action="update"], [data-action="delete"]').forEach(b=>b.style.display='none');
    }

    // Only allow edit/delete for draft/returned
    if (!['draft','returned'].includes(g.status)) {
      tr.querySelectorAll('[data-action="update"], [data-action="delete"]').forEach(b=>b.style.display='none');
    }

    if (g.status !== 'approved') {
      tr.querySelectorAll('[data-action="updates"]').forEach(b=>b.style.display='none');
    }

    tbody.appendChild(tr);
  });
}

// Chart rendering
function renderCharts() {
  const ctxStatus = document.getElementById('statusDoughnut').getContext('2d');
  const ctxWeight = document.getElementById('weightBar').getContext('2d');
  const ctxTrend = document.getElementById('quarterTrend').getContext('2d');

  const counts = {draft:0, submitted:0, approved:0, returned:0};
  goals.forEach(g=>counts[g.status] = (counts[g.status]||0)+1);
  const statusData = [counts.approved||0, counts.submitted||0, counts.returned||0, counts.draft||0];

  const labels = ['Approved','Submitted','Returned','Draft'];

  if (statusChart) statusChart.destroy();
  statusChart = new Chart(ctxStatus, {type:'doughnut', data:{labels, datasets:[{data:statusData, backgroundColor:['#198754','#ffc107','#dc3545','#6c757d']}]} });

  // Weight distribution
  const weightLabels = goals.map(g=>g.title || g._id.slice(0,6));
  const weightData = goals.map(g=>Number(g.weightage||0));
  if (weightChart) weightChart.destroy();
  weightChart = new Chart(ctxWeight, {type:'bar', data:{labels:weightLabels, datasets:[{label:'Weightage %', data:weightData, backgroundColor:'#0d6efd'}]}, options:{scales:{y:{beginAtZero:true}}}});

  // Quarterly trend (aggregate updates)
  const quarterMap = {Q1:[],Q2:[],Q3:[],Q4:[]};
  // assume each goal.progress is current percent; fallback to 0
  goals.forEach(g=>{
    // distribute this goal's progress equally into current quarter placeholder
    const q = (new Date()).getMonth() < 3 ? 'Q1' : (new Date()).getMonth() < 6 ? 'Q2' : (new Date()).getMonth() < 9 ? 'Q3' : 'Q4';
    quarterMap[q].push(Number(g.progress||0));
  });
  const qLabels = ['Q1','Q2','Q3','Q4'];
  const qData = qLabels.map(q=>{
    const arr = quarterMap[q];
    if (!arr.length) return 0;
    return Math.round(arr.reduce((s,v)=>s+v,0)/arr.length);
  });
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctxTrend, {type:'line', data:{labels:qLabels, datasets:[{label:'Avg Progress %', data:qData, borderColor:'#0d6efd', backgroundColor:'rgba(13,110,253,0.08)', tension:0.3}]}, options:{scales:{y:{beginAtZero:true,max:100}}}});
}

// Open Create/Edit Modal
function openGoalModal(goal=null){
  const modal = new bootstrap.Modal(document.getElementById('goalModal'));
  document.getElementById('goalFormAlert').innerHTML = '';
  document.getElementById('goalForm').reset();
  document.getElementById('goalId').value = '';
  
  // Check if goal is returned - disable editing
  const isReturned = goal && goal.status === 'returned';
  
  if (goal) {
      document.getElementById('goalModalTitle').textContent = isReturned ? 'Edit Returned Goal' : 'Edit Goal';
      document.getElementById('goalId').value = goal._id;
      document.getElementById('thrustArea').value = goal.thrustArea || '';
      document.getElementById('title').value = goal.title || '';
      document.getElementById('description').value = goal.description || '';
      document.getElementById('uom').value = goal.uomType || '';
      document.getElementById('scoreType').value = goal.scoreType || 'max';
      document.getElementById('deadline').value = goal.deadline ? new Date(goal.deadline).toISOString().slice(0,10) : '';
      document.getElementById('target').value = goal.target || '';
      document.getElementById('weightage').value = goal.weightage || '';
      syncGoalTypeControls();
      
      // Show manager notes if goal was returned
      if (isReturned && goal.managerNotes) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-info';
        alert.innerHTML = `<strong>Manager Notes:</strong> ${goal.managerNotes}`;
        document.getElementById('goalFormAlert').appendChild(alert);
      }
      
      // Disable form when approved or submitted only, not when returned
      const inputs = document.querySelectorAll('#goalForm input, #goalForm select, #goalForm textarea');
      const isEditable = !['approved', 'submitted'].includes(goal.status);
      inputs.forEach(input => {
        input.disabled = !isEditable;
      });
      document.getElementById('saveGoalBtn').style.display = isEditable ? 'block' : 'none';

      if (goal.isShared || goal.sharedGoalId) {
        const sharedInputs = ['thrustArea', 'title', 'description', 'uom', 'scoreType', 'deadline', 'target'];
        sharedInputs.forEach((id) => {
          const element = document.getElementById(id);
          if (element) {
            element.disabled = true;
            if (element.tagName === 'INPUT') {
              element.setAttribute('readonly', '');
            }
          }
        });
        document.getElementById('weightage').disabled = false;
        document.getElementById('weightage').removeAttribute('readonly');
        document.getElementById('goalFormAlert').insertAdjacentHTML('beforeend', '<div class="alert alert-warning mt-2">Shared goals may only adjust weightage.</div>');
      } else {
        document.getElementById('title').removeAttribute('readonly');
        document.getElementById('target').removeAttribute('readonly');
      }
  } else {
    document.getElementById('goalModalTitle').textContent = 'New Goal';
    document.getElementById('weightage').value = '';
    document.getElementById('title').removeAttribute('readonly'); document.getElementById('target').removeAttribute('readonly');
    document.getElementById('saveGoalBtn').style.display = 'block';
    
    const inputs = document.querySelectorAll('#goalForm input, #goalForm select, #goalForm textarea');
    inputs.forEach(input => {
      input.disabled = false;
    });
    syncGoalTypeControls();
  }
  // show current total weightage
  updateWeightProgressText();
  modal.show();
}

function updateWeightProgressText(){
  const id = document.getElementById('goalId').value;
  const current = Number(document.getElementById('weightage').value || 0);
  const totalWithoutCurrentGoal = goals.reduce((sum, goal) => {
    if (id && goal._id === id) return sum;
    return sum + Number(goal.weightage || 0);
  }, 0);
  const text = `Existing total: ${formatWeightage(totalWithoutCurrentGoal)}% · After this: ${formatWeightage(totalWithoutCurrentGoal + current)}%`;
  document.getElementById('weightProgressText').textContent = text;
}

function formatWeightage(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function syncGoalTypeControls() {
  const uom = document.getElementById('uom').value;
  const scoreType = document.getElementById('scoreType');
  const target = document.getElementById('target');
  const deadline = document.getElementById('deadline');

  Array.from(scoreType.options).forEach((option) => {
    option.hidden = false;
    option.disabled = false;
  });
  scoreType.disabled = false;
  target.disabled = false;
  target.removeAttribute('readonly');
  target.required = true;
  deadline.required = false;

  if (uom === 'timeline') {
    scoreType.value = 'timeline';
    Array.from(scoreType.options).forEach((option) => {
      option.hidden = option.value !== 'timeline';
      option.disabled = option.value !== 'timeline';
    });
    scoreType.disabled = true;
    target.value = 0;
    target.disabled = true;
    target.setAttribute('readonly', '');
    target.required = false;
    deadline.required = true;
    return;
  }

  if (uom === 'zero') {
    scoreType.value = 'zero';
    Array.from(scoreType.options).forEach((option) => {
      option.hidden = option.value !== 'zero';
      option.disabled = option.value !== 'zero';
    });
    scoreType.disabled = true;
    target.value = 0;
    target.disabled = true;
    target.setAttribute('readonly', '');
    target.required = false;
    return;
  }

  Array.from(scoreType.options).forEach((option) => {
    option.hidden = !['min', 'max'].includes(option.value);
    option.disabled = !['min', 'max'].includes(option.value);
  });

  if (!['min', 'max'].includes(scoreType.value)) {
    scoreType.value = 'min';
  }
}

// Save goal (create or update)
async function saveGoal(){
  if (window._savingGoal) return;
  const id = document.getElementById('goalId').value;
  
  // Check if trying to edit returned goal
  const currentGoal = goals.find(g => g._id === id);
  if (currentGoal && ['submitted', 'approved'].includes(currentGoal.status)) {
    return showAlert('goalFormAlert', 'Cannot edit goals after submission or approval.', 'danger');
  }
  
  const data = {
    thrustArea: document.getElementById('thrustArea').value.trim(),
    title: document.getElementById('title').value.trim(),
    description: document.getElementById('description').value.trim(),
    uomType: document.getElementById('uom').value,
    scoreType: document.getElementById('scoreType').value,
    deadline: document.getElementById('deadline').value || null,
    target: Number(document.getElementById('target').value || 0),
    weightage: Number(document.getElementById('weightage').value || 0),
    employeeId
  };

  if (data.uomType === 'timeline') {
    data.scoreType = 'timeline';
    data.target = 0;
  }

  if (data.uomType === 'zero') {
    data.scoreType = 'zero';
    data.target = 0;
  }

  const isSharedGoal = currentGoal?.isShared || currentGoal?.sharedGoalId;

  if (isSharedGoal) {
    Object.assign(data, {
      thrustArea: undefined,
      title: undefined,
      description: undefined,
      uomType: undefined,
      scoreType: undefined,
      deadline: undefined,
      target: undefined
    });
  }

  // Validation
  if (!isSharedGoal && !data.title) return showAlert('goalFormAlert','Title is required','danger');
  if (!isSharedGoal && !data.uomType) return showAlert('goalFormAlert','UoM Type is required','danger');
  if (!isSharedGoal && !data.scoreType) return showAlert('goalFormAlert','Score Type is required','danger');
  if (!isSharedGoal && ['numeric', 'percentage'].includes(data.uomType) && data.target <= 0) return showAlert('goalFormAlert','Target must be greater than 0','danger');
  if (!isSharedGoal && data.uomType === 'timeline' && !data.deadline) return showAlert('goalFormAlert','Deadline is required for timeline goals','danger');
  if (!data.weightage) return showAlert('goalFormAlert','Weightage is required','danger');
  if (data.weightage < 10) return showAlert('goalFormAlert','Weightage must be at least 10%','danger');
  const existingGoalCount = goals.length - (id ? 1 : 0);
  if (!id && existingGoalCount >= 8) return showAlert('goalFormAlert','Maximum 8 goals allowed','danger');

  // Check total weight won't exceed 100 when creating
  const currentTotal = goals.reduce((s,g)=> s + Number(g.weightage||0),0) - (id ? (Number(goals.find(g=>g._id===id)?.weightage||0)) : 0);
  if (currentTotal + data.weightage > 100) return showAlert('goalFormAlert','Total weightage cannot exceed 100%','danger');

  try {
    window._savingGoal = true;
    setLoading(document.getElementById('saveGoalBtn'), true, 'Saving');
    let res;
    if (id) {
      res = await fetch(`${apiBase}/goals/update/${id}`, {
        method:'PUT',
        headers:getAuthHeaders(),
        body:JSON.stringify(data),
        signal: AbortSignal.timeout(30000) // 30s timeout
      });
    } else {
      res = await fetch(`${apiBase}/goals/create`, {
        method:'POST',
        headers:getAuthHeaders(),
        body:JSON.stringify(data),
        signal: AbortSignal.timeout(30000) // 30s timeout
      });
    }
    const json = await res.json();
    if (!res.ok) {
      if (res.status === 401) throw new Error('Session expired. Please log in again.');
      throw new Error(json.message || 'Failed to save goal');
    }
    bootstrap.Modal.getInstance(document.getElementById('goalModal')).hide();
    await loadAll();
    showAlert('goalsAlert', id ? 'Goal updated successfully' : 'Goal created successfully', 'success');
  } catch (err) {
    showAlert('goalFormAlert', err.message || err, 'danger');
  }
  finally {
    window._savingGoal = false;
    setLoading(document.getElementById('saveGoalBtn'), false);
  }
}

async function deleteGoal(id){
  const confirmed = window.AppUX
    ? await AppUX.confirm({
        title: 'Delete goal?',
        message: 'This draft goal will be permanently removed from your sheet.',
        confirmText: 'Delete goal',
        variant: 'danger'
      })
    : confirm('Delete this draft goal?');
  if (!confirmed) return;
  try {
    const deleteBtn = document.querySelector(`[data-action="delete"][data-id="${id}"]`);
    setLoading(deleteBtn, true, '');
    const res = await fetch(`${apiBase}/goals/delete/${id}`, {
      method:'DELETE',
      headers: getAuthHeaders(false),
      signal: AbortSignal.timeout(30000) // 30s timeout
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error('Session expired. Please log in again.');
      throw new Error(json.message || 'Failed to delete');
    }
    showAlert('goalsAlert','Goal deleted','success');
    await loadAll();
  } catch(err){
    showAlert('goalsAlert', err.message || err, 'danger');
  }
}

// Submit goal sheet
async function submitGoals(){
  // Prevent double submission
  if (window._submittingGoals) return showAlert('goalsAlert', 'Submission in progress...', 'info');
  
  const total = goals.reduce((s,g)=> s + Number(g.weightage||0),0);
  if (total !== 100) return showAlert('goalsAlert','Total weightage must equal 100% to submit','danger');
  const confirmed = window.AppUX
    ? await AppUX.confirm({
        title: 'Submit goal sheet?',
        message: 'Your goals will be locked for manager review after submission.',
        confirmText: 'Submit sheet',
        variant: 'success'
      })
    : confirm('Submit goal sheet? After submission goals will be locked.');
  if (!confirmed) return;
  try {
    window._submittingGoals = true;
    const submitBtn = document.getElementById('submitGoalsBtn');
    setLoading(submitBtn, true, 'Submitting');
    const res = await fetch(`${apiBase}/goals/submit/${employeeId}`, {
      method:'PUT',
      headers: getAuthHeaders(false),
      signal: AbortSignal.timeout(30000) // 30s timeout
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Submit failed');
    showAlert('goalsAlert','Goal sheet submitted','success');
    await loadAll();
  } catch(err){
    showAlert('goalsAlert', err.message || err, 'danger');
  }
  finally {
    window._submittingGoals = false;
    setLoading(document.getElementById('submitGoalsBtn'), false);
  }
}

// Updates modal
async function openUpdateModal(goalId){
  const goal = goals.find(g=>g._id===goalId);
  if (!goal) return showAlert('goalsAlert','Goal not found','danger');
  document.getElementById('updateGoalId').value = goalId;
  document.getElementById('updPlanned').textContent = goal.target || '-';
  document.getElementById('updGoalTitle').textContent = goal.title || '-';
  document.getElementById('updScore').textContent = (goal.progress||0) + '%';
  document.getElementById('updManagerComments').textContent = goal.managerComments || '-';

  // fetch existing updates
  try {
    const res = await fetch(`${apiBase}/updates/${goalId}`, {
      headers: getAuthHeaders(false)
    });
    if (res.ok) {
      const updates = await res.json();
      if (updates.length) {
        document.getElementById('updScore').textContent = `${Number(updates[0].progressScore || 0).toFixed(1)}%`;
        document.getElementById('updManagerComments').textContent = updates.find(u => u.managerComment)?.managerComment || '-';
      }
      const list = updates.map(u=>`<li class="mb-2"><strong>${escapeHtml(u.quarter)}</strong> - ${escapeHtml(u.actualAchievement ?? '-')} (${escapeHtml(u.progressStatus)})<div class="muted-small">${escapeHtml(u.employeeComment || '')} ${u.managerComment ? '<br><em>Manager: '+escapeHtml(u.managerComment)+'</em>' : ''}</div></li>`).join('');
      document.getElementById('recentUpdates').innerHTML = list || (window.AppUX ? AppUX.emptyState('No updates yet', 'Quarterly progress updates will appear here.', 'bi-journal-text') : '<li class="text-muted">No updates yet.</li>');
    }
  } catch(e){ /* ignore */ }

  bootstrap.Modal.getOrCreateInstance(document.getElementById('updateModal')).show();
}

async function saveUpdate(){
  if (window._savingUpdate) return;
  const actualInput = document.getElementById('actual').value;
  const data = {
    goalId: document.getElementById('updateGoalId').value,
    quarter: document.getElementById('quarter').value,
    actualAchievement: Number(actualInput),
    progressStatus: document.getElementById('progressStatus').value,
    employeeComment: document.getElementById('empComment').value,
    completionDate: document.getElementById('completionDate').value || null
  };
  if (!data.goalId) return showAlert('updateAlert','Goal ID missing','danger');
  if (actualInput === '') return showAlert('updateAlert','Actual achievement is required','danger');
  if (Number.isNaN(data.actualAchievement) || data.actualAchievement < 0) return showAlert('updateAlert','Actual achievement must be non-negative','danger');
  try {
    window._savingUpdate = true;
    setLoading(document.getElementById('saveUpdateBtn'), true, 'Saving');
    const res = await fetch(`${apiBase}/updates/create`, {method:'POST', headers:getAuthHeaders(), body:JSON.stringify(data), signal: AbortSignal.timeout(30000)});
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to save update');
    bootstrap.Modal.getInstance(document.getElementById('updateModal')).hide();
    await loadAll();
    showAlert('goalsAlert','Quarterly update saved','success');
  } catch(err){ showAlert('updateAlert', err.message || err); }
  finally{
    window._savingUpdate = false;
    setLoading(document.getElementById('saveUpdateBtn'), false);
  }
}

// Load all data and render
async function loadAll(){
  const tbody = document.getElementById('goalsTbody');
  if (tbody && window.AppUX) tbody.innerHTML = AppUX.tableLoading(9, 'Loading your goals...');
  await fetchGoals();
  renderSummary();
  renderGoalsTable();
  renderCharts();
  showWeightageWarning();
  // set submit button state
  const total = goals.reduce((s,g)=> s + Number(g.weightage||0),0);
  const submitBtn = document.getElementById('submitGoalsBtn');
  const hasSubmittableGoals = goals.some(g=>g.status === 'draft' || g.status === 'returned');
  submitBtn.disabled = (total !== 100) || !hasSubmittableGoals;
  document.getElementById('overallScore').textContent = Math.round((goals.reduce((s,g)=> s + Number(g.progress||0),0) / (goals.length||1))) + '%';
  document.getElementById('overallProgressBar').style.width = document.getElementById('overallScore').textContent;
}

// Event delegation for table actions
document.addEventListener('click', async (e)=>{
  const actionBtn = e.target.closest('[data-action]');
  if (!actionBtn) return;
  const action = actionBtn.dataset.action;
  const id = actionBtn.dataset.id;
  if (action === 'update') openGoalModal(goals.find(g=>g._id===id));
  if (action === 'delete') deleteGoal(id);
  if (action === 'updates') openUpdateModal(id);
  if (action === 'view') {
    const g = goals.find(x=>x._id===id);
    if (g) { alert(`Title: ${g.title}\nDescription: ${g.description || '-'}\nStatus: ${g.status}`); }
  }
});

// Wire UI (defensive)
if ($el('openCreateBtn')) $el('openCreateBtn').addEventListener('click', ()=>{ openGoalModal(); });
if ($el('saveGoalBtn')) $el('saveGoalBtn').addEventListener('click', ()=>{ saveGoal(); });
if ($el('weightage')) $el('weightage').addEventListener('input', ()=>{ updateWeightProgressText(); });
if ($el('uom')) $el('uom').addEventListener('change', ()=>{ syncGoalTypeControls(); updateWeightProgressText(); });
if ($el('submitGoalsBtn')) $el('submitGoalsBtn').addEventListener('click', ()=>{ submitGoals(); });
if ($el('saveUpdateBtn')) $el('saveUpdateBtn').addEventListener('click', ()=>{ saveUpdate(); });
if ($el('logoutBtn')) $el('logoutBtn').addEventListener('click', ()=>{ localStorage.removeItem('user'); sessionStorage.removeItem('user'); window.location.href='login.html'; });

// Init
async function init(){
  if (!protect()) return;
  await loadAll();
  // auto-refresh every 60s
  setInterval(loadAll, 60000);
}

init();




