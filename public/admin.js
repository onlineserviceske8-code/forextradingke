const $ = selector => document.querySelector(selector);
async function api(url, options={}) {
  const response = await fetch(url, { headers:{ 'Content-Type':'application/json' }, credentials:'include', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function showDash(show) {
  $('#loginView').hidden = show;
  $('#dashView').hidden = !show;
}
async function loadSettings() {
  try {
    const data = await api('/api/admin/settings');
    const s = data.settings;
    $('#siteTitle').value = s.siteTitle || '';
    $('#siteTagline').value = s.siteTagline || '';
    $('#paymentAmount').value = s.paymentAmount || '';
    $('#announcement').value = s.announcement || '';
    $('#oandaApiKey').value = s.oandaApiKey || '';
    $('#oandaAccountId').value = s.oandaAccountId || '';
    $('#oandaEnv').value = s.oandaEnv || 'practice';
  } catch (error) {
    if (/sign-in/i.test(error.message)) { showDash(false); return; }
    $('#settingsMessage').textContent = error.message;
  }
}
$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const message = $('#loginMessage');
  button.disabled = true;
  message.className = 'admin-msg';
  message.textContent = 'Signing in…';
  try {
    await api('/api/admin/login', { method:'POST', body:JSON.stringify({ username:$('#adminUser').value, password:$('#adminPass').value }) });
    $('#adminPass').value = '';
    message.textContent = '';
    showDash(true);
    loadSettings();
  } catch (error) {
    message.className = 'admin-msg error';
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = $('#settingsMessage');
  button.disabled = true;
  message.className = 'admin-msg';
  message.textContent = 'Saving…';
  try {
    const result = await api('/api/admin/settings', { method:'PUT', body:JSON.stringify({
      siteTitle:$('#siteTitle').value,
      siteTagline:$('#siteTagline').value,
      paymentAmount:$('#paymentAmount').value,
      announcement:$('#announcement').value,
      oandaApiKey:$('#oandaApiKey').value,
      oandaAccountId:$('#oandaAccountId').value,
      oandaEnv:$('#oandaEnv').value
    }) });
    message.textContent = 'Saved. Changes are live on the website.';
    message.className = 'admin-msg';
    $('#paymentAmount').value = result.settings.paymentAmount;
    $('#oandaApiKey').value = result.settings.oandaApiKey || '';
    $('#oandaAccountId').value = result.settings.oandaAccountId || '';
    $('#oandaEnv').value = result.settings.oandaEnv || 'practice';
  } catch (error) {
    message.className = 'admin-msg error';
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#reloadButton').addEventListener('click', () => {
  $('#settingsMessage').textContent = '';
  loadSettings();
});
$('#logoutButton').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method:'POST', body:'{}' }); } catch {}
  showDash(false);
});
api('/api/admin/session').then(result => {
  if (result.authenticated) { showDash(true); loadSettings(); }
  else {
    showDash(false);
    if (result.configured === false) {
      const message = $('#loginMessage');
      message.className = 'admin-msg error';
      message.textContent = 'Admin is not configured. Set ADMIN_PASSWORD on the server.';
    }
  }
}).catch(() => showDash(false));
