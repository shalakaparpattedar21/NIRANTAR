
'use strict';

let sb = null;
try {
  if (NIRANTAR_CONFIG.supabaseUrl.startsWith('https://') &&
      NIRANTAR_CONFIG.supabaseAnonKey.length > 20) {
   sb = supabase.createClient(
  NIRANTAR_CONFIG.supabaseUrl,
  NIRANTAR_CONFIG.supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      storageKey: 'nirantar_session',
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
  }
} catch(e) { console.warn('[NIRANTAR] Supabase not configured.', e.message); }

const state = {
  user: null, profile: null,
  realtimeChannels: [],
  _profileComplete: false,
  _dashboardLoaded: false,
  _pendingBookingProfilePrompted: false,
  pendingAction: sessionStorage.getItem('nirantar_pending_action') || null,
};

const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const show = id => { const e=$(id); if(e) e.classList.remove('hidden'); };
const hide = id => { const e=$(id); if(e) e.classList.add('hidden'); };
const AUTH_TIMEOUT_MS = 45000;
const DATA_TIMEOUT_MS = 45000;
const BOOKING_TIMEOUT_MS = 60000;

function showOverlay(modalId) {
  show('overlay');
  ['modal-login','modal-signup','modal-profile1','modal-profile2',
   'modal-booking','modal-confirm'].forEach(hide);
  show(modalId);
  document.body.style.overflow = 'hidden';
}
function closeOverlay() { hide('overlay'); document.body.style.overflow = ''; }

function showPage(page) {
  ['page-main','page-dashboard'].forEach(p => {
    const el = $(p); if(el) el.classList.toggle('hidden', p !== page);
  });
  if (page === 'page-main') window.scrollTo({ top:0, behavior:'smooth' });
}

function hideLoader() {
  const loader = $('session-loader');
  if (!loader) return;
  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 300);
}

async function openDashboard() {
  if (!state.user) return;
  closeOverlay();
  updateNav();
  showPage('page-dashboard');
  hideLoader();
  await initDashboard();
}

function showToast(msg, type='info') {
  $$('.toast').forEach(t => { if(t.textContent===msg) t.remove(); });
  const t = document.createElement('div');
  t.className = `toast toast-${type}`; t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => { requestAnimationFrame(() => t.classList.add('show')); });
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4200);
}

function setLoading(btnId, loading) {
  const btn = $(btnId); if(!btn) return;
  btn.disabled = loading;
  if (loading) {
    if (!btn.dataset.orig) btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = '<span class="btn-spinner"></span>Please wait...';
  } else {
    btn.innerHTML = btn.dataset.orig || 'Submit';
    delete btn.dataset.orig;
  }
}

function withTimeout(promise, ms = DATA_TIMEOUT_MS, message = 'Request timed out. Please check your internet connection and try again.') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function setPendingAction(action) {
  state.pendingAction = action;
  state._pendingBookingProfilePrompted = false;
  if (action) {
    sessionStorage.setItem('nirantar_pending_action', action);
  } else {
    sessionStorage.removeItem('nirantar_pending_action');
  }
}

function consumePendingAction(action) {
  if (state.pendingAction !== action) return false;
  setPendingAction(null);
  return true;
}

function resumePendingBooking() {
  if (state.pendingAction !== 'booking') return;
  if (!state._profileComplete) {
    if (state._pendingBookingProfilePrompted) return;
    state._pendingBookingProfilePrompted = true;
    showToast('Please complete your health profile before booking.', 'info');
    setTimeout(() => showOverlay('modal-profile1'), 500);
    return;
  }
  consumePendingAction('booking');
  setTimeout(() => openBooking(), 600);
}

function validateField(input, rules) {
  if (!input) return false;
  const val = input.value.trim();
  let error = '';
  if      (rules.required && !val)                                   error = 'Required.';
  else if (rules.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val))  error = 'Valid email required.';
  else if (rules.minLen && val.length < rules.minLen)                error = `Min ${rules.minLen} chars.`;
  else if (rules.numeric && val && isNaN(+val))                      error = 'Must be a number.';
  else if (rules.min !== undefined && +val < rules.min)              error = `Min ${rules.min}.`;
  else if (rules.max !== undefined && +val > rules.max)              error = `Max ${rules.max}.`;

  input.classList.toggle('input-error', !!error);
  input.classList.toggle('input-ok', !error && !!val);
  let hint = input.closest('.form-group')?.querySelector('.field-error');
  if (error) {
    if (!hint) { hint = document.createElement('span'); hint.className = 'field-error';
      input.parentElement.appendChild(hint); }
    hint.textContent = error;
  } else if (hint) hint.remove();
  return !error;
}
function clearFieldError(input) {
  if (!input) return;
  input.classList.remove('input-error');
  input.closest('.form-group')?.querySelector('.field-error')?.remove();
}

function isProfileComplete(p) {
  return !!(p?.phone?.trim() && p?.gender?.trim() && p?.age > 0 && p?.height_cm > 0);
}

if (sb) {
  sb.auth.onAuthStateChange(async (event, session) => {
    console.log('[Auth]', event, session?.user?.email ?? 'signed out');
    if (session?.user) {
      state.user = session.user;
      await loadProfile();
      updateNav();
      state._profileComplete = isProfileComplete(state.profile);
      if (event === 'INITIAL_SESSION') {
        await openDashboard();
        resumePendingBooking();
      }
      if (event === 'SIGNED_IN') {
        await openDashboard();
        const name = (state.profile?.name || state.user?.user_metadata?.name || '').split(' ')[0];
        showToast(name ? `Welcome back, ${name}!` : 'Welcome back!', 'success');
        resumePendingBooking();
      }
    } else {
      state.user = null; state.profile = null; state._profileComplete = false;
      state._dashboardLoaded = false;
      state._pendingBookingProfilePrompted = false;
      state.realtimeChannels.forEach(ch => sb.removeChannel(ch));
      state.realtimeChannels = [];
      updateNav();
      showPage('page-main');
      hideLoader();
    }
  });
}

async function restoreSession() {

}
function updateNav() {

  const loggedIn = !!state.user;

  const guestNav = $('nav-auth');
  const userNav = $('nav-user');
  const userName = $('nav-username');
  const displayName = state.profile?.name || state.user?.user_metadata?.name || state.user?.email?.split('@')[0] || '';

  if (guestNav) guestNav.classList.toggle('hidden', loggedIn);
  if (userNav) userNav.classList.toggle('hidden', !loggedIn);
  const mainNav = $('main-nav'); if (mainNav) mainNav.classList.toggle('user-logged-in', loggedIn);
  if (userName) userName.textContent = loggedIn ? displayName : '';

  document.querySelectorAll('.guest-only').forEach(el => {
    el.style.display = loggedIn ? 'none' : '';
  });

  document.querySelectorAll('.auth-only').forEach(el => {
    el.style.display = loggedIn ? '' : 'none';
  });

  const dashBtn = $('nav-dashboard-btn');

  if (dashBtn) {
    dashBtn.onclick = openDashboard;
  }

  const logoutBtn = $('nav-logout-btn');

  if (logoutBtn) {
    logoutBtn.onclick = logout;
  }
}
function openLogin()       { showOverlay('modal-login');  }
function openSignup()      { showOverlay('modal-signup'); }
function switchToSignup()  { showOverlay('modal-signup'); }
function switchToLogin()   { showOverlay('modal-login');  }

async function signInWithGoogle(btnId) {
  if (!sb) { showToast('Supabase not configured.', 'error'); return; }
  setLoading(btnId, true);
  try {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await withTimeout(sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    }), AUTH_TIMEOUT_MS, 'Google sign in is taking too long. Please check your internet connection and try again.');
    if (error) throw error;
  } catch (err) {
    setLoading(btnId, false);
    showToast(err.message || 'Could not start Google sign in.', 'error');
  }
}

async function loginUser() {

  if (!sb) {
    showToast('Supabase not configured.', 'error');
    return;
  }

  const email = $('login-email')?.value.trim();
  const password = $('login-pwd')?.value;

  if (!email || !password) {
    showToast('Please enter email and password.', 'error');
    return;
  }

  setLoading('btn-login', true);

  try {

    const { data, error } = await withTimeout(
      sb.auth.signInWithPassword({
        email,
        password
      }),
      AUTH_TIMEOUT_MS,
      'Sign in is taking too long. Please check your internet connection and try again.'
    );

    if (error) throw error;

    if (!data?.user) {
      throw new Error('Login failed.');
    }

    state.user = data.user;

    await loadProfile();

    state._profileComplete = isProfileComplete(state.profile);

    closeOverlay();

    updateNav();

    await openDashboard();

    showToast('Welcome back!', 'success');

    resumePendingBooking();

  } catch (err) {

    console.error(err);

    showToast(
      err.message || 'Login failed.',
      'error'
    );

  } finally {

    setLoading('btn-login', false);

  }
}

async function signupUser() {
  if (!sb) { showToast('Supabase not configured.', 'error'); return; }
  const nameEl = $('signup-name'), emailEl = $('signup-email'), pwdEl = $('signup-pwd');
  const confirmEl = $('signup-confirm');
  const v1 = validateField(nameEl,  { required:true, minLen:2 });
  const v2 = validateField(emailEl, { required:true, email:true });
  const v3 = validateField(pwdEl,   { required:true, minLen:8 });
  let v4 = true;
  if (confirmEl && pwdEl.value !== confirmEl.value) {
    confirmEl.classList.add('input-error');
    let h = confirmEl.closest('.form-group')?.querySelector('.field-error');
    if (!h) { h = document.createElement('span'); h.className = 'field-error'; confirmEl.parentElement.appendChild(h); }
    h.textContent = 'Passwords do not match.'; v4 = false;
  } else if (confirmEl) { clearFieldError(confirmEl); confirmEl.classList.add('input-ok'); }
  if (!v1||!v2||!v3||!v4) return;
  setLoading('btn-signup', true);
  try {
    const { data, error } = await withTimeout(sb.auth.signUp({
      email: emailEl.value.trim(), password: pwdEl.value,
      options: { data: { name: nameEl.value.trim() } }
    }), AUTH_TIMEOUT_MS, 'Account creation is taking too long. Please check your internet connection and try again.');
    if (error) {
      const msg = error.message.toLowerCase().includes('already')
        ? 'Email already registered. Please log in.' : error.message;
      showToast(msg, 'error');
      if (error.message.toLowerCase().includes('already')) setTimeout(()=>showOverlay('modal-login'), 1800);
      return;
    }
    if (data?.session) {
      state.user = data.user;
      await loadProfile();
      updateNav();
      state._profileComplete = isProfileComplete(state.profile);
      await openDashboard();
      showToast("Account created. Let's set up your health profile.", 'success');
      if (!state._profileComplete) {
        setTimeout(() => showOverlay('modal-profile1'), 500);
      } else if (state.pendingAction === 'booking') {
        consumePendingAction('booking');
        setTimeout(() => openBooking(), 600);
      } else {
        setPendingAction(null);
      }
    } else {
      showToast('Account created. Please verify your email, then log in.', 'success');
      setTimeout(()=>showOverlay('modal-login'), 2500);
    }
  } catch (err) {
    showToast(err.message || 'Could not create account.', 'error');
  } finally {
    setLoading('btn-signup', false);
  }
}

async function logout() {
  if (!sb) return;

  resetPublicSession();

  try {
    await withTimeout(
      sb.auth.signOut({ scope: 'local' }),
      AUTH_TIMEOUT_MS,
      'Sign out is taking too long. Please check your internet connection and try again.'
    );
  } catch (err) {
    console.warn('[NIRANTAR] Sign out request did not complete.', err);
  }

  localStorage.removeItem('nirantar_session');

  showToast('Signed out.', 'info');
}

function resetPublicSession() {
  state.realtimeChannels.forEach(ch => sb?.removeChannel(ch));

  state.realtimeChannels = [];
  state.user = null;
  state.profile = null;
  state._profileComplete = false;
  state._dashboardLoaded = false;
  state._pendingBookingProfilePrompted = false;
  setPendingAction(null);

  closeOverlay();
  updateNav();
  showPage('page-main');
}

async function loadProfile() {
  if (!sb||!state.user) return;
  try {
    const { data, error } = await withTimeout(
      sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle(),
      DATA_TIMEOUT_MS,
      'Profile is taking too long to load. Please check your internet connection and try again.'
    );
    if (error) {
      console.warn('[NIRANTAR] Could not load profile:', error);
    }
    state.profile = data || null;
  } catch (err) {
    console.warn('[NIRANTAR] Profile load skipped:', err);
    state.profile = null;
  }
}

function calcBMI() {
  const hEl=$('p-height'), wEl=$('p-weight'), numEl=$('bmi-number'), lblEl=$('bmi-label');
  if (!hEl||!wEl) return null;
  const h = parseFloat(hEl.value)/100, w = parseFloat(wEl.value);
  if (!h||!w||isNaN(h)||isNaN(w)||h<=0||w<=0) {
    if (numEl) { numEl.textContent='—'; numEl.style.color=''; }
    if (lblEl) lblEl.textContent='Enter height and weight above';
    return null;
  }
  const bmi = (w/(h*h)).toFixed(1), b = +bmi;
  const cat = b<18.5?'Underweight':b<25?'Healthy Weight':b<30?'Overweight':'Obese';
  const col = b<18.5?'#3B7DD8':b<25?'#059669':b<30?'#D97706':'#DC2626';
  if (numEl) { numEl.textContent=bmi; numEl.style.color=col; }
  if (lblEl) lblEl.textContent=`BMI Category: ${cat}`;
  return parseFloat(bmi);
}

function goToProfile2() {
  const ok = [
    validateField($('p-gender'), { required:true }),
    validateField($('p-age'),    { required:true, numeric:true, min:1, max:120 }),
    validateField($('p-phone'),  { required:true }),
    validateField($('p-height'), { required:true, numeric:true, min:50, max:300 }),
    validateField($('p-weight'), { required:true, numeric:true, min:10, max:500 }),
  ].every(Boolean);
  if (!ok) { showToast('Please fill in all fields.', 'error'); return; }
  if (!calcBMI()) { showToast('Please enter valid height and weight.', 'error'); return; }
  showOverlay('modal-profile2');
}
function backToProfile1() { showOverlay('modal-profile1'); }
function toggleChip(el)   { el.classList.toggle('active'); }

function calculateBmiFromValues(heightCm, weightKg) {
  const h = parseFloat(heightCm) / 100;
  const w = parseFloat(weightKg);
  if (!h || !w || isNaN(h) || isNaN(w) || h <= 0 || w <= 0) return null;
  return parseFloat((w / (h * h)).toFixed(1));
}

function setInputValue(id, value = '') {
  const el = $(id);
  if (el) el.value = value ?? '';
}

function setChipSelection(containerId, values = []) {
  const selected = new Set(values || []);
  $$(`#${containerId} .chip`).forEach(chip => {
    chip.classList.toggle('active', selected.has(chip.textContent.trim()));
  });
}

function populateProfileForms() {
  const p = state.profile || {};
  setInputValue('profile-name', p.name || state.user?.user_metadata?.name || state.user?.email?.split('@')[0] || '');
  setInputValue('profile-email', p.email || state.user?.email || '');
  setInputValue('profile-phone', p.phone);
  setInputValue('profile-gender', p.gender);
  setInputValue('profile-age', p.age);
  setInputValue('profile-height', p.height_cm);
  setInputValue('profile-weight', p.weight_kg);
  setInputValue('profile-activity', p.activity_level);
  setInputValue('profile-history', p.medical_history);
  setChipSelection('profile-chip-wrap', p.pain_areas);
}

function renderProfileTab() {
  if (!state.user) return;
  const p = state.profile || {};
  populateProfileForms();
  const displayName = p.name || state.user.user_metadata?.name || state.user.email?.split('@')[0] || 'Patient';
  const email = p.email || state.user.email || '';
  const initials = displayName.trim().slice(0,1).toUpperCase() || 'P';
  const avatar = $('profile-avatar'); if (avatar) avatar.textContent = initials;
  const sideAvatar = $('sidebar-avatar'); if (sideAvatar) sideAvatar.textContent = initials;
  const nameEl = $('profile-display-name'); if (nameEl) nameEl.textContent = displayName;
  const emailEl = $('profile-display-email'); if (emailEl) emailEl.textContent = email;
  const sideName = $('sidebar-name'); if (sideName) sideName.textContent = displayName;
  const sideEmail = $('sidebar-email'); if (sideEmail) sideEmail.textContent = email;
  const bmi = $('profile-summary-bmi'); if (bmi) bmi.textContent = p.bmi || '-';
  const age = $('profile-summary-age'); if (age) age.textContent = p.age || '-';
  const activity = $('profile-summary-activity'); if (activity) activity.textContent = p.activity_level ? p.activity_level.split(' ')[0] : '-';
}

function readProfilePayload(prefix, chipContainerId) {
  const height = $(`${prefix}-height`)?.value;
  const weight = $(`${prefix}-weight`)?.value;
  const name = prefix === 'p'
    ? (state.user.user_metadata?.name || $('signup-name')?.value?.trim() || state.profile?.name || state.user.email.split('@')[0])
    : ($(`${prefix}-name`)?.value?.trim() || state.profile?.name || state.user.email.split('@')[0]);
  return {
    id: state.user.id,
    name,
    email: state.user.email,
    phone:           $(`${prefix}-phone`).value.trim(),
    gender:          $(`${prefix}-gender`).value,
    age:             parseInt($(`${prefix}-age`).value),
    height_cm:       parseFloat(height),
    weight_kg:       parseFloat(weight),
    bmi:             prefix === 'p' ? calcBMI() : calculateBmiFromValues(height, weight),
    activity_level:  $(`${prefix}-activity`).value,
    medical_history: $(`${prefix}-history`)?.value?.trim() || '',
    pain_areas:      [...$$(`#${chipContainerId} .chip.active`)].map(c=>c.textContent.trim()),
  };
}

async function upsertProfile(payload, btnId) {
  setLoading(btnId, true);
  try {
    const { error } = await withTimeout(
      sb.from('profiles').upsert(payload, { onConflict: 'id' }),
      DATA_TIMEOUT_MS,
      'Profile save is taking too long. Please check your internet connection and try again.'
    );
    if (error) throw error;
    await loadProfile();
    state._profileComplete = true;
    if (state.pendingAction === 'booking') {
      consumePendingAction('booking');
      setTimeout(() => openBooking(), 400);
    }
    updateNav();
    renderDashboardHeader();
    renderProfileTab();
    return true;
  } catch (err) {
    showToast('Could not save profile: ' + (err.message || 'Please try again.'), 'error');
    return false;
  } finally {
    setLoading(btnId, false);
  }
}

async function saveProfile() {
  if (!sb||!state.user) return;
  if (!validateField($('p-activity'), { required:true })) {
    showToast('Please select your activity level.', 'error'); return; }
  const saved = await upsertProfile(readProfilePayload('p', 'chip-wrap'), 'btn-save-profile');
  if (!saved) return;
  await openDashboard();
  showToast('Profile saved. Welcome to NIRANTAR.', 'success');
}

async function saveDashboardProfile(event) {
  event?.preventDefault();
  if (!sb||!state.user) return;
  const ok = [
    validateField($('profile-name'),   { required:true, minLen:2 }),
    validateField($('profile-phone'),  { required:true }),
    validateField($('profile-gender'), { required:true }),
    validateField($('profile-age'),    { required:true, numeric:true, min:1, max:120 }),
    validateField($('profile-height'), { required:true, numeric:true, min:50, max:300 }),
    validateField($('profile-weight'), { required:true, numeric:true, min:10, max:500 }),
    validateField($('profile-activity'), { required:true }),
  ].every(Boolean);
  if (!ok) { showToast('Please complete the required profile fields.', 'error'); return; }
  const saved = await upsertProfile(readProfilePayload('profile', 'profile-chip-wrap'), 'btn-profile-update');
  if (saved) showToast('Profile changes saved.', 'success');
}

function openBooking() {
  if (!state.user) { setPendingAction('booking'); openLogin(); return; }
  if (!state._profileComplete) {
    setPendingAction('booking');
    showToast('Please complete your health profile first.', 'error');
    setTimeout(()=>showOverlay('modal-profile1'), 400); return;
  }
  const dateEl = $('b-date');
  if (dateEl) { dateEl.setAttribute('min', new Date().toISOString().split('T')[0]); dateEl.value=''; }
  showOverlay('modal-booking');
}
function selectMode(el) { $$('.mode-option').forEach(m=>m.classList.remove('active')); el.classList.add('active'); }
function updatePainSlider() {
  const s=$('pain-slider'), l=$('pain-value'); if(!s||!l) return;
  const v=+s.value, pct=((v-1)/9*100).toFixed(0);
  const col = v<=3?'#059669':v<=6?'#D97706':'#DC2626';
  l.textContent=v; s.style.background=`linear-gradient(to right,${col} ${pct}%,var(--border) ${pct}%)`;
}

async function submitBooking() {
  if (!sb||!state.user) return;
  const problemEl=$('b-problem'), dateEl=$('b-date');
  if (!validateField(problemEl,{required:true,minLen:10})|!validateField(dateEl,{required:true})) {
    showToast('Please fill in all required fields.','error'); return; }
  setLoading('btn-book-submit', true);
  try {
    const { data: sessionData, error: sessionError } = await withTimeout(
      sb.auth.getSession(),
      AUTH_TIMEOUT_MS,
      'Login session check is taking too long. Please refresh and try again.'
    );
    if (sessionError) throw sessionError;
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Please log in again before booking.');

    const bookingId = crypto.randomUUID();
    const payload = {
      id:                  bookingId,
      patient_id:          state.user.id,
      patient_name:        state.profile?.name||'',
      patient_phone:       state.profile?.phone||'',
      patient_email:       state.user.email,
      problem_description: problemEl.value.trim(),
      symptoms:            $('b-symptoms')?.value.trim()||'',
      pain_duration:       $('b-duration')?.value.trim()||'',
      pain_intensity:      parseInt($('pain-slider')?.value||5),
      previous_treatments: $('b-prev')?.value.trim()||'',
      preferred_date:      dateEl.value,
      preferred_time:      $('b-time')?.value||'',
      mode: document.querySelector('.mode-option.active')?.textContent.trim()||'In-Person',
      status: 'pending'
    };

    await insertAppointment(payload, token);
    const refEl=$('confirm-ref'); if(refEl) refEl.textContent='#NRT-'+bookingId.slice(0,6).toUpperCase();
    showOverlay('modal-confirm');
    await loadMyAppointments();
  } catch(err) {
    const message = err.message && (err.message.includes('timed out') || err.message.includes('taking too long'))
      ? 'The appointment request is taking too long. Please check your internet connection and try again.'
      : (err.message || 'Could not submit appointment. Please try again.');
    showToast(message,'error');
  }
  finally { setLoading('btn-book-submit', false); }
}

async function insertAppointment(payload, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BOOKING_TIMEOUT_MS);
  try {
    const res = await fetch(`${NIRANTAR_CONFIG.supabaseUrl}/rest/v1/appointments`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        apikey: NIRANTAR_CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let message = 'Could not submit appointment. Please try again.';
      try {
        const err = await res.json();
        message = err.message || err.details || message;
      } catch (_) {}
      throw new Error(message);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The appointment request timed out. Please check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
function goToDashboard() { openDashboard(); }

async function initDashboard() {
  if (!state.user) return;
  state._dashboardLoaded = true;
  const tasks = [
    ['dashboard header', renderDashboardHeader],
    ['profile', renderProfileTab],
    ['appointments', loadMyAppointments],
    ['recovery plans', loadRecoveryPlans],
    ['exercises', loadAssignedExercises],
    ['therapist messages', loadTherapistMessages],
    ['pain journal', loadPainJournalDash],
    ['progress', loadProgressDash],
    ['notifications', loadNotifications],
  ];

  const results = await Promise.allSettled(tasks.map(([, task]) => task()));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(`[NIRANTAR] Could not load ${tasks[index][0]}:`, result.reason);
    }
  });
  subscribeRealtime();
  initSidebarTabs();
}

function renderDashboardHeader() {
  const p = state.profile, u = state.user;
  if (!u) return;
  const name = (p?.name||u.email||'').split(/[\s@]/)[0]||'there';
  const el = $('dash-name'); if(el) el.textContent = `Welcome back, ${name}`;
  const bmiEl = $('dash-bmi'); if(bmiEl) bmiEl.textContent = p?.bmi||'—';
  const actEl = $('dash-activity'); if(actEl) actEl.textContent = p?.activity_level?.split(' ')[0]||'—';
}

function initSidebarTabs() {
  const links = $$('.side-link');
  const tabs  = $$('.dashboard-tab');
  if (!links.length) return;

  function activateTab(tabName) {
    links.forEach(l => l.classList.remove('active'));
    tabs.forEach(t => t.classList.remove('active'));
    const link = document.querySelector(`.side-link[data-tab="${tabName}"]`);
    const tab  = $(`${tabName}-tab`);
    if (link) link.classList.add('active');
    if (tab)  tab.classList.add('active');
    // Lazy-load tab data
    if (tabName === 'exercises')  loadAssignedExercises();
    if (tabName === 'profile')    renderProfileTab();
    if (tabName === 'recovery')   loadRecoveryPlans();
    if (tabName === 'messages')   loadTherapistMessages();
    if (tabName === 'journal')    renderPainJournalTab();
    if (tabName === 'progress')   loadProgressDash();
    if (tabName === 'wellness')   loadWellnessDash();
    if (tabName === 'appointments') loadMyAppointments();
  }

  links.forEach(link => {
    link.addEventListener('click', () => activateTab(link.dataset.tab));
  });
}

function switchDashTab(tabName) {
  const links = $$('.side-link'), tabs = $$('.dashboard-tab');
  links.forEach(l => l.classList.remove('active'));
  tabs.forEach(t => t.classList.remove('active'));
  const link = document.querySelector(`.side-link[data-tab="${tabName}"]`);
  const tab  = $(`${tabName}-tab`);
  if (link) link.classList.add('active');
  if (tab)  tab.classList.add('active');
  if (tabName === 'profile') renderProfileTab();
}

function subscribeRealtime() {
  if (!sb||!state.user) return;
  state.realtimeChannels.forEach(ch => sb.removeChannel(ch));
  state.realtimeChannels = [];

  const ch = sb.channel('patient-'+state.user.id)
    .on('postgres_changes',{ event:'UPDATE', schema:'public', table:'appointments',
      filter:`patient_id=eq.${state.user.id}` }, payload => {
      if (payload.new.status==='confirmed') showToast('Your appointment has been confirmed.','success');
      if (payload.new.status==='rejected')  showToast('Your appointment could not be confirmed. Please rebook.','error');
      loadMyAppointments();
    })
    .on('postgres_changes',{ event:'INSERT', schema:'public', table:'therapist_messages',
      filter:`patient_id=eq.${state.user.id}` }, () => {
      showToast('New message from your therapist.','success');
      loadTherapistMessages();
      loadNotifications();
    })
    .on('postgres_changes',{ event:'*', schema:'public', table:'recovery_plans',
      filter:`patient_id=eq.${state.user.id}` }, () => {
      showToast('Your recovery plan has been updated.','info');
      loadRecoveryPlans();
    })
    .on('postgres_changes',{ event:'*', schema:'public', table:'patient_exercises',
      filter:`patient_id=eq.${state.user.id}` }, () => {
      showToast('New exercises assigned to you.','success');
      loadAssignedExercises();
    })
    .on('postgres_changes',{ event:'INSERT', schema:'public', table:'notifications',
      filter:`patient_id=eq.${state.user.id}` }, payload => {
      showToast(payload.new.title,'info');
      loadNotifications();
    })
    .subscribe();

  state.realtimeChannels.push(ch);
}

async function loadMyAppointments() {
  if (!sb||!state.user) return;
  const { data } = await sb.from('appointments').select('*')
    .eq('patient_id', state.user.id).order('created_at',{ascending:false}).limit(10);
  const el = $('appt-list'); if(!el) return;

  const upcoming = (data||[]).filter(a=>a.status==='confirmed').length;
  const statEl = $('stat-upcoming'); if(statEl) statEl.textContent = upcoming||'0';

  if (!data?.length) {
    el.innerHTML=`<div class="empty-state"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><p>No appointments yet.</p><button class="btn btn-primary btn-sm" onclick="openBooking()">Book Your First Session</button></div>`;
    return;
  }

  const upcomingEl = $('upcoming-appointment');
  if (upcomingEl) {
    const next = data.find(a=>a.status==='confirmed');
    if (next) {
      upcomingEl.innerHTML=`<div class="upcoming-appt-card"><div class="upcoming-date">${fmtDate(next.preferred_date)}</div><div class="upcoming-time">${next.preferred_time||'Time TBC'} · ${next.mode}</div><div class="upcoming-problem">${(next.problem_description||'').substring(0,60)}…</div><span class="appt-badge appt-badge-confirmed">Confirmed</span></div>`;
    } else {
      upcomingEl.innerHTML=`<p class="empty-msg">No upcoming confirmed appointments.<br><button class="btn btn-primary btn-sm" onclick="openBooking()" style="margin-top:10px">Book Session</button></p>`;
    }
  }

  el.innerHTML = data.map(a=>`
    <div class="appt-row">
      <div class="appt-row-info">
        <div class="appt-row-date">${fmtDate(a.preferred_date)} · ${a.preferred_time||''} · <em>${a.mode}</em></div>
        <div class="appt-row-problem">${(a.problem_description||'').substring(0,70)}${(a.problem_description||'').length>70?'…':''}</div>
        ${a.admin_notes?`<div class="appt-row-note">${a.admin_notes}</div>`:''}
      </div>
      <span class="appt-badge appt-badge-${a.status}">${a.status.charAt(0).toUpperCase()+a.status.slice(1)}</span>
    </div>`).join('');
}

async function loadRecoveryPlans() {
  if (!sb||!state.user) return;
  const { data } = await sb.from('recovery_plans')
    .select('*, recovery_milestones(*)')
    .eq('patient_id', state.user.id)
    .order('created_at',{ascending:false});

  const container = $('recovery-plan-container'); if(!container) return;
  if (!data?.length) {
    container.innerHTML=`<div class="empty-state"><svg viewBox="0 0 24 24" width="40" height="40"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><p>Your physiotherapist hasn't assigned a recovery plan yet.<br>It will appear here after your first session.</p></div>`;
    const scoreEl=$('recovery-score'); if(scoreEl) scoreEl.textContent='—';
    return;
  }

  const activePlan = data.find(p=>p.status==='active') || data[0];
  const milestones = (activePlan.recovery_milestones||[]).sort((a,b)=>a.week_number-b.week_number);
  const done = milestones.filter(m=>m.completed).length;
  const total = milestones.length;
  const pct = total ? Math.round((done/total)*100) : activePlan.recovery_score||0;

  const scoreEl=$('recovery-score'); if(scoreEl) scoreEl.textContent=pct+'%';

  container.innerHTML = data.map(plan => {
    const ms = (plan.recovery_milestones||[]).sort((a,b)=>a.week_number-b.week_number);
    const d = ms.filter(m=>m.completed).length;
    const t = ms.length;
    const p = t ? Math.round((d/t)*100) : plan.recovery_score||0;
    return `
    <div class="recovery-plan-card ${plan.status==='active'?'active-plan':''}">
      <div class="plan-header">
        <div>
          <div class="plan-status-badge plan-status-${plan.status}">${plan.status}</div>
          <h3 class="plan-title">${plan.title}</h3>
          ${plan.condition?`<p class="plan-condition">${plan.condition}</p>`:''}
        </div>
        <div class="plan-score-ring">
          <svg viewBox="0 0 64 64" width="64" height="64">
            <circle cx="32" cy="32" r="26" fill="none" stroke="var(--teal-pale)" stroke-width="5"/>
            <circle cx="32" cy="32" r="26" fill="none" stroke="var(--teal-mid)" stroke-width="5"
              stroke-dasharray="${2*Math.PI*26}" stroke-dashoffset="${2*Math.PI*26*(1-p/100)}"
              stroke-linecap="round" transform="rotate(-90 32 32)"/>
          </svg>
          <span class="plan-score-num">${p}%</span>
        </div>
      </div>

      <div class="plan-meta-row">
        ${plan.start_date?`<div class="plan-meta-item"><span class="meta-label">Started</span><span>${fmtDate(plan.start_date)}</span></div>`:''}
        ${plan.estimated_end_date?`<div class="plan-meta-item"><span class="meta-label">Est. End</span><span>${fmtDate(plan.estimated_end_date)}</span></div>`:''}
        <div class="plan-meta-item"><span class="meta-label">Milestones</span><span>${d}/${t} done</span></div>
      </div>

      ${plan.therapist_notes?`<div class="therapist-note-box"><div class="therapist-note-label">Therapist Note</div>${plan.therapist_notes}</div>`:''}
      ${(plan.movement_restrictions||[]).length?`<div class="precaution-box restriction-box"><strong>Restrictions:</strong> ${plan.movement_restrictions.join(', ')}</div>`:''}
      ${(plan.precautions||[]).length?`<div class="precaution-box"><strong>Precautions:</strong> ${plan.precautions.join(', ')}</div>`:''}

      ${ms.length?`
      <div class="milestones-section">
        <div class="milestones-header">
          <h4>Weekly Milestones</h4>
          <span class="milestones-count">${d}/${t} completed</span>
        </div>
        <div class="milestones-list">
          ${ms.map(m=>`
            <div class="milestone-row ${m.completed?'milestone-done':''}">
              <div class="milestone-check ${m.completed?'check-done':''}" onclick="togglePatientMilestone('${m.id}',${m.completed})">
                ${m.completed?`<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`:''}
              </div>
              <div class="milestone-content">
                <div class="milestone-week">Week ${m.week_number}</div>
                <div class="milestone-title">${m.title}</div>
                ${m.description?`<div class="milestone-desc">${m.description}</div>`:''}
                ${m.completed&&m.completed_at?`<div class="milestone-done-date">${fmtDate(m.completed_at)}</div>`:''}
              </div>
            </div>`).join('')}
        </div>
      </div>`:''}
    </div>`;
  }).join('');
}

async function togglePatientMilestone(milestoneId, currentState) {
  if (!sb) return;
  const completed = !currentState;
  const { error } = await sb.from('recovery_milestones').update({
    completed, completed_at: completed ? new Date().toISOString() : null
  }).eq('id', milestoneId);
  if (error) { showToast('Could not update milestone.','error'); return; }
  if (completed) showToast('Milestone completed.','success');
  await loadRecoveryPlans();
}

async function loadAssignedExercises() {
  if (!sb||!state.user) return;
  const { data } = await sb.from('patient_exercises')
    .select('*, exercises(*)')
    .eq('patient_id', state.user.id)
    .eq('is_active', true)
    .order('assigned_date',{ascending:false});

  const container = $('exercise-container'); if(!container) return;

  // Update stat
  const completedToday = await getTodayCompletions();
  const statEl=$('exercise-count'); if(statEl) statEl.textContent = completedToday||'0';

  if (!data?.length) {
    container.innerHTML=`<div class="empty-state"><svg viewBox="0 0 24 24" width="40" height="40"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg><p>No exercises assigned yet.<br>Your therapist will assign specific exercises<br>tailored to your condition after assessment.</p></div>`;
    return;
  }

  container.innerHTML = data.map(pe => {
    const ex = pe.exercises;
    if (!ex) return '';
    const reps = pe.reps_override || ex.reps;
    const sets = pe.sets_override || ex.sets;
    return `
    <div class="exercise-card-patient" id="pex-${pe.id}">
      <div class="exercise-thumb-patient">
        ${ex.thumbnail_url?`<img src="${ex.thumbnail_url}" alt="${ex.title}" onerror="this.style.display='none'">`:''}
        <div class="exercise-thumb-overlay">
          <span class="exercise-cat-badge">${ex.category}</span>
          <span class="exercise-diff-badge diff-${ex.difficulty}">${ex.difficulty}</span>
        </div>
        ${ex.video_url?`<button class="exercise-play-overlay" onclick="openExerciseVideo('${ex.video_url}','${ex.title}')">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.9)"/><polygon points="10 8 16 12 10 16" fill="var(--teal)"/></svg>
        </button>`:''}
      </div>
      <div class="exercise-body-patient">
        <h3 class="exercise-title-patient">${ex.title}</h3>
        ${ex.body_area?`<p class="exercise-area">${ex.body_area}</p>`:''}
        <div class="exercise-specs">
          ${ex.duration_min?`<span>⏱ ${ex.duration_min} min</span>`:''}
          ${reps?`<span>${reps} reps</span>`:''}
          ${sets?`<span>${sets} sets</span>`:''}
        </div>
        ${ex.description?`<p class="exercise-desc-patient">${ex.description}</p>`:''}
        ${pe.notes?`<div class="therapist-note-box" style="margin-top:10px;font-size:0.82rem"><em>${pe.notes}</em></div>`:''}
        ${ex.precautions?`<div class="precaution-box" style="margin-top:8px;font-size:0.8rem">${ex.precautions}</div>`:''}
        ${ex.instructions?`<details class="exercise-instructions"><summary>Step-by-step instructions</summary><div class="instructions-body">${ex.instructions}</div></details>`:''}
        <div class="exercise-actions-patient">
          ${ex.video_url?`<button class="btn btn-ghost btn-sm" onclick="openExerciseVideo('${ex.video_url}','${ex.title}')">▶ Watch Video</button>`:''}
          <button class="btn btn-primary btn-sm" onclick="markExerciseDone('${pe.id}','${ex.id}',this)">Mark Done</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function getTodayCompletions() {
  if (!sb||!state.user) return 0;
  const today = new Date().toISOString().split('T')[0];
  const { count } = await sb.from('exercise_completions')
    .select('*',{count:'exact',head:true})
    .eq('patient_id', state.user.id)
    .gte('completed_at', today+'T00:00:00')
    .lte('completed_at', today+'T23:59:59');
  return count||0;
}

let _exerciseVideoModal = null;
function openExerciseVideo(url, title) {

  let modal = $('exercise-video-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'exercise-video-modal';
    modal.className = 'exercise-video-overlay';
    modal.innerHTML = `
      <div class="exercise-video-panel">
        <div class="exercise-video-header">
          <h3 id="exercise-video-title"></h3>
          <button onclick="closeExerciseVideo()" class="modal-close-btn">Close</button>
        </div>
        <div class="exercise-video-body">
          <div id="exercise-video-frame"></div>
        </div>
      </div>`;
    modal.addEventListener('click', e => { if(e.target===modal) closeExerciseVideo(); });
    document.body.appendChild(modal);
  }
  const titleEl = $('exercise-video-title'); if(titleEl) titleEl.textContent = title||'Exercise';
  const frameEl = $('exercise-video-frame');
  if (frameEl) {
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?]+)/);
    if (ytMatch) {
      frameEl.innerHTML = `<iframe src="https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1" frameborder="0" allowfullscreen allow="autoplay"></iframe>`;
    } else {
      frameEl.innerHTML = `<div style="padding:40px;text-align:center"><p style="margin-bottom:16px;color:var(--text-muted)">Video link:</p><a href="${url}" target="_blank" class="btn btn-primary">Open Video ↗</a></div>`;
    }
  }
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeExerciseVideo() {
  const modal = $('exercise-video-modal');
  if (modal) { modal.style.display='none'; const f=$('exercise-video-frame'); if(f) f.innerHTML=''; }
  document.body.style.overflow = '';
}

async function markExerciseDone(patientExerciseId, exerciseId, btn) {
  if (!sb||!state.user) return;
  btn.disabled = true; btn.textContent = 'Done'; btn.classList.add('btn-done');
  const { error } = await sb.from('exercise_completions').insert({
    patient_id: state.user.id, exercise_id: exerciseId,
    patient_exercise_id: patientExerciseId, caused_pain: false
  });
  if (error) { showToast('Could not save. Try again.','error'); btn.disabled=false; btn.textContent='Mark Done'; return; }
  showToast('Exercise completed.','success');
  // Update count
  const c = await getTodayCompletions();
  const statEl=$('exercise-count'); if(statEl) statEl.textContent=c;
}
async function loadTherapistMessages() {
  if (!sb||!state.user) return;
  const { data } = await sb.from('therapist_messages')
    .select('*').eq('patient_id', state.user.id)
    .order('is_pinned',{ascending:false})
    .order('created_at',{ascending:false});

  const latestEl = $('latest-therapist-message');
  if (latestEl && data?.length) {
    const pinned = data.find(m=>m.is_pinned) || data[0];
    latestEl.innerHTML = `<p>${pinned.body}</p><div class="message-meta-dash">— Dr. Janhavi · ${fmtDate(pinned.created_at)}</div>`;
  } else if (latestEl) {
    latestEl.innerHTML = `<p class="empty-msg" style="color:var(--text-muted);font-style:italic">No messages from your therapist yet.</p>`;
  }

  if (data?.length) {
    const unread = data.filter(m=>!m.is_read).map(m=>m.id);
    if (unread.length) await sb.from('therapist_messages').update({is_read:true}).in('id', unread);
  }

  const container = $('messages-container'); if(!container) return;
  if (!data?.length) {
    container.innerHTML=`<div class="empty-state"><svg viewBox="0 0 24 24" width="40" height="40"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><p>No messages yet. Your therapist's advice,<br>reminders, and motivation will appear here.</p></div>`;
    return;
  }
  container.innerHTML = data.map(msg=>`
    <div class="message-card-patient ${msg.is_pinned?'pinned-msg':''}">
      <div class="message-type-bar type-bar-${msg.message_type}"></div>
      <div class="message-card-body">
        <div class="message-card-header">
          <div class="message-type-tag type-tag-${msg.message_type}">${msg.message_type.replace('_',' ')}</div>
          ${msg.is_pinned?'<span class="pin-indicator">Pinned</span>':''}
          <span class="message-date">${fmtDate(msg.created_at)}</span>
        </div>
        <h4 class="message-title-patient">${msg.title}</h4>
        <p class="message-body-patient">${msg.body}</p>
        <div class="message-sig">— Dr. Janhavi Parpattedar, NIRANTAR</div>
      </div>
    </div>`).join('');
}

async function loadPainJournalDash() {
  if (!sb||!state.user) return;
  const { data } = await sb.from('pain_journal')
    .select('*').eq('patient_id', state.user.id)
    .order('log_date',{ascending:false}).limit(1);
  const painStatEl = $('pain-score');
  if (painStatEl && data?.length) painStatEl.textContent = `${data[0].pain_level}/10`;

  const { data: allLogs } = await sb.from('pain_journal')
    .select('log_date').eq('patient_id', state.user.id)
    .order('log_date',{ascending:false}).limit(30);
  const streak = calcStreak(allLogs||[]);
  const streakEl=$('streak-count'); if(streakEl) streakEl.textContent=streak>0?`${streak} Days`:'0 Days';
}

async function renderPainJournalTab() {
  if (!sb||!state.user) return;
  const container = $('pain-journal-entries'); if(!container) return;
  const { data } = await sb.from('pain_journal').select('*')
    .eq('patient_id', state.user.id).order('log_date',{ascending:false}).limit(20);
  if (!data?.length) {
    container.innerHTML=`<p class="empty-msg">No journal entries yet. Log your first entry above.</p>`;
  } else {
    container.innerHTML = data.map(e=>`
      <div class="journal-entry-card">
        <div class="journal-entry-date">${fmtDate(e.log_date)}</div>
        <div class="journal-entry-body">
          <div class="journal-metrics">
            <span class="journal-metric"><span class="metric-label">Pain</span><span class="metric-val pain-val-${e.pain_level>=7?'high':e.pain_level>=4?'mid':'low'}">${e.pain_level}/10</span></span>
            <span class="journal-metric"><span class="metric-label">Stiffness</span><span class="metric-val">${e.stiffness||0}/10</span></span>
            <span class="journal-metric"><span class="metric-label">Mood</span><span class="metric-val">${moodEmoji(e.mood)}</span></span>
            <span class="journal-metric"><span class="metric-label">Sleep</span><span class="metric-val">${e.sleep_quality||'—'}/10</span></span>
          </div>
          ${e.pain_areas?.length?`<div class="journal-areas">Areas: ${e.pain_areas.join(', ')}</div>`:''}
          ${e.notes?`<div class="journal-note">"${e.notes}"</div>`:''}
        </div>
      </div>`).join('');
  }
}

async function submitPainJournal() {
  if (!sb||!state.user) return;
  const today = new Date().toISOString().split('T')[0];
  const pain     = parseInt($('journal-pain')?.value||0);
  const stiffness= parseInt($('journal-stiffness')?.value||0);
  const mood     = $('journal-mood')?.value||'okay';
  const sleep    = parseInt($('journal-sleep')?.value||5);
  const areas    = [...$$('#journal-pain-areas .chip.active')].map(c=>c.textContent.trim());
  const notes    = $('journal-notes')?.value?.trim()||'';
  const btn = $('btn-journal-save');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }
  const { error } = await sb.from('pain_journal').upsert({
    patient_id: state.user.id, log_date: today,
    pain_level: pain, stiffness, mood, sleep_quality: sleep,
    pain_areas: areas, notes
  },{ onConflict:'patient_id,log_date' });
  if (btn) { btn.disabled=false; btn.textContent='Save Today\'s Entry'; }
  if (error) { showToast('Could not save journal entry.','error'); return; }
  showToast('Pain journal entry saved.','success');
  await loadPainJournalDash();
  await renderPainJournalTab();
}

async function loadProgressDash() {
  if (!sb||!state.user) return;
  const { data: progress } = await sb.from('progress_entries')
    .select('*').eq('patient_id', state.user.id)
    .order('entry_date',{ascending:true}).limit(14);
  const { data: plans } = await sb.from('recovery_plans')
    .select('recovery_score').eq('patient_id', state.user.id)
    .eq('status','active').limit(1);

  const container = $('progress-charts'); if(!container) return;
  const plan = plans?.[0];

  if (!progress?.length) {
    container.innerHTML=`<p class="empty-msg" style="padding:24px">Progress data will appear here as you log your recovery. Keep using the pain journal daily!</p>`;
    return;
  }
  const painData     = progress.map(e=>parseFloat(e.pain_avg)||0);
  const flexData     = progress.map(e=>e.flexibility||0);
  const labels       = progress.map(e=>e.entry_date?.slice(5)||'');
  const maxPain      = Math.max(...painData,1);
  const avgPain      = painData.length ? (painData.reduce((s,v)=>s+v,0)/painData.length).toFixed(1) : '—';

  container.innerHTML = `
    <div class="progress-stat-row">
      <div class="progress-stat"><span class="ps-num">${avgPain}</span><span class="ps-label">Avg Pain</span></div>
      <div class="progress-stat"><span class="ps-num">${plan?.recovery_score||'—'}%</span><span class="ps-label">Recovery Score</span></div>
      <div class="progress-stat"><span class="ps-num">${flexData[flexData.length-1]||'—'}%</span><span class="ps-label">Flexibility</span></div>
    </div>
    <div class="mini-chart-card">
      <div class="chart-title">Pain Level Trend</div>
      <div class="bar-chart">
        ${painData.map((v,i)=>`
          <div class="bar-col">
            <div class="bar-fill ${v>=7?'bar-high':v>=4?'bar-mid':'bar-low'}"
              style="height:${Math.round((v/10)*100)}%" title="${v}/10"></div>
            <div class="bar-label">${labels[i]}</div>
          </div>`).join('')}
      </div>
    </div>
    ${flexData.some(v=>v>0)?`
    <div class="mini-chart-card">
      <div class="chart-title">Flexibility Progress</div>
      <div class="bar-chart">
        ${flexData.map((v,i)=>`
          <div class="bar-col">
            <div class="bar-fill bar-teal" style="height:${v}%" title="${v}%"></div>
            <div class="bar-label">${labels[i]}</div>
          </div>`).join('')}
      </div>
    </div>`:''}`
}

async function loadWellnessDash() {
  if (!sb||!state.user) return;
  const today = new Date().toISOString().split('T')[0];
  const { data } = await sb.from('wellness_logs').select('*')
    .eq('patient_id', state.user.id).eq('log_date', today).single().catch(()=>({data:null}));
  const log = data || { water_glasses:0, posture_checked:false, stretched:false, breathing_done:false };
  // Sync checkboxes
  const wg=$('wellness-water'); if(wg) wg.value=log.water_glasses;
  const pc=$('wellness-posture'); if(pc) pc.checked=log.posture_checked;
  const st=$('wellness-stretch'); if(st) st.checked=log.stretched;
  const br=$('wellness-breathe'); if(br) br.checked=log.breathing_done;
  updateWellnessProgress();
}

async function saveWellnessLog() {
  if (!sb||!state.user) return;
  const today = new Date().toISOString().split('T')[0];
  const water   = parseInt($('wellness-water')?.value||0);
  const posture = $('wellness-posture')?.checked||false;
  const stretch = $('wellness-stretch')?.checked||false;
  const breathe = $('wellness-breathe')?.checked||false;
  const done = [posture,stretch,breathe].filter(Boolean).length;
  const { error } = await sb.from('wellness_logs').upsert({
    patient_id: state.user.id, log_date: today,
    water_glasses: water, posture_checked: posture,
    stretched: stretch, breathing_done: breathe,
    tasks_completed: done, tasks_total: 3
  },{ onConflict:'patient_id,log_date' });
  if (error) { showToast('Could not save wellness log.','error'); return; }
  showToast('Wellness log saved.','success');
  updateWellnessProgress();
}

function updateWellnessProgress() {
  const checks = [
    $('wellness-posture')?.checked,
    $('wellness-stretch')?.checked,
    $('wellness-breathe')?.checked,
    (parseInt($('wellness-water')?.value||0) >= 6),
  ].filter(Boolean).length;
  const pct = Math.round((checks/4)*100);
  const bar = $('wellness-progress-bar'); if(bar) bar.style.width=pct+'%';
  const label = $('wellness-progress-label'); if(label) label.textContent=`${pct}% of daily wellness goals completed`;
}

async function loadNotifications() {
  if (!sb||!state.user) return;
  const { data } = await sb.from('notifications')
    .select('*').eq('patient_id', state.user.id)
    .eq('is_read', false).order('created_at',{ascending:false}).limit(10);
  const badge = $('notif-count');
  if (badge) { badge.textContent=(data?.length||0); badge.style.display=data?.length?'inline-flex':'none'; }
  const list = $('notifications-list'); if(!list) return;
  if (!data?.length) { list.innerHTML='<p class="empty-msg">You\'re all caught up!</p>'; return; }
  list.innerHTML = data.map(n=>`
    <div class="notif-item notif-${n.type}" onclick="markNotifRead('${n.id}',this)">
      <div class="notif-icon">${n.type.charAt(0).toUpperCase()}</div>
      <div class="notif-body">
        <div class="notif-title">${n.title}</div>
        <div class="notif-text">${n.body}</div>
        <div class="notif-time">${fmtDate(n.created_at)}</div>
      </div>
    </div>`).join('');
}
async function markNotifRead(id, el) {
  if (!sb) return;
  el.style.opacity='0.5';
  await sb.from('notifications').update({is_read:true}).eq('id',id);
  await loadNotifications();
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
}
function moodEmoji(m) {
  return {great:'Great',good:'Good',okay:'Okay',bad:'Bad',terrible:'Terrible'}[m]||'Okay';
}
function calcStreak(logs) {
  if (!logs.length) return 0;
  let streak=0; const today=new Date(); today.setHours(0,0,0,0);
  for (let i=0;i<logs.length;i++) {
    const d=new Date(logs[i].log_date), exp=new Date(today);
    exp.setDate(today.getDate()-i);
    if (d.toDateString()===exp.toDateString()) streak++;
    else break;
  }
  return streak;
}

function switchTab(tabId, btn) {
  $$('.tab-btn').forEach(b=>b.classList.remove('active'));
  $$('.tab-panel').forEach(p=>p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const panel = $(`tab-${tabId}`); if(panel) panel.classList.add('active');
}
function toggleKCard(el) {
  el.classList.toggle('open');
  const t = el.querySelector('.k-card-toggle');
  if (t) t.textContent = el.classList.contains('open')?'Show less':'Read more';
}

const reviewData = [
  { text:'My back pain improved within three weeks. The personalised exercise programme genuinely changed how I move every day.',author:'Priya S.',role:'Lower Back Pain Patient',stars:5},
  { text:'Professional and deeply caring approach. The physiotherapist listened carefully and tailored every session to my condition.',author:'Rohit M.',role:'Sports Injury Recovery',stars:5},
  { text:'Highly recommend NIRANTAR to anyone dealing with chronic pain. After years of struggling, I have finally found lasting relief.',author:'Anita K.',role:'Chronic Pain Management',stars:5},
  { text:'The best physiotherapy experience I have had. The team is knowledgeable and genuinely invested in each patient\'s recovery.',author:'Sameer D.',role:'Post-Surgery Rehabilitation',stars:5},
  { text:'After my knee surgery I was nervous about rehabilitation. NIRANTAR made the process smooth, manageable, and well structured.',author:'Kavya R.',role:'ACL Reconstruction',stars:5},
  { text:'The online video sessions were just as effective as in-person visits. The standard of care never dropped at all.',author:'Ashwin P.',role:'Remote Consultation',stars:4},
  { text:'My frozen shoulder is almost completely resolved after six weeks. I can raise my arm again — something I thought impossible.',author:'Meena T.',role:'Shoulder Rehabilitation',stars:5},
  { text:'The team\'s deep understanding of neurological conditions gave our family so much confidence throughout the recovery journey.',author:'Raj N.',role:'Stroke Rehabilitation',stars:5},
];
function buildConveyor() {
  const track = $('conveyor-track'); if(!track) return;
  const all = [...reviewData,...reviewData];
  track.innerHTML = all.map(r=>{
    const stars = Array(r.stars).fill('<div class="review-star"></div>').join('')+
                  Array(5-r.stars).fill('<div class="review-star" style="opacity:0.2"></div>').join('');
    return `<div class="review-card"><div class="review-stars">${stars}</div><p class="review-text">${r.text}</p><div class="review-author">${r.author}</div><div class="review-patient">${r.role}</div></div>`;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {

  buildConveyor();
  updatePainSlider();

  setTimeout(() => hideLoader(), 3000);

  $('overlay')?.addEventListener('click', e => {
    if (e.target === $('overlay')) closeOverlay();
  });

  $('login-pwd')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginUser();
  });

  $('login-email')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginUser();
  });

  ['wellness-posture', 'wellness-stretch', 'wellness-breathe'].forEach(id => {
    $(id)?.addEventListener('change', () => {
      updateWellnessProgress();
      saveWellnessLog();
    });
  });

  $('wellness-water')?.addEventListener('input', () => {
    updateWellnessProgress();
  });

  ['journal-pain', 'journal-stiffness', 'journal-sleep'].forEach(id => {
    const el = $(id);
    if (!el) return;

    const labelId = id + '-val';

    el.addEventListener('input', () => {
      const l = $(labelId);
      if (l) l.textContent = el.value;
    });
  });

  $('pain-slider')?.addEventListener('input', updatePainSlider);

  $('p-height')?.addEventListener('input', calcBMI);
  $('p-weight')?.addEventListener('input', calcBMI);

  $('signup-pwd')?.addEventListener('input', e => {
    const val = e.target.value;
    const bar = $('pwd-strength-bar');
    const lbl = $('pwd-strength-label');

    if (!bar) return;

    const score = [
      val.length >= 8,
      /[A-Z]/.test(val),
      /[0-9]/.test(val),
      /[^A-Za-z0-9]/.test(val)
    ].filter(Boolean).length;

    const colors = [
      'var(--border)',
      '#DC2626',
      '#D97706',
      '#2A9D8F',
      '#059669'
    ];

    const labels = [
      '',
      'Weak',
      'Fair',
      'Good',
      'Strong'
    ];

    bar.style.width = (score * 25) + '%';
    bar.style.background = colors[score];

    if (lbl) {
      lbl.textContent = val.length ? labels[score] : '';
      lbl.style.color = colors[score];
    }
  });

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const t = document.querySelector(a.getAttribute('href'));

      if (t) {
        e.preventDefault();
        t.scrollIntoView({
          behavior: 'smooth'
        });
      }
    });
  });

});
