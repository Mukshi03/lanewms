'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const next = AUTH.safeNext(new URLSearchParams(location.search).get('next'));
  const goApp = () => location.replace('index.html' + next);

  if(AUTH.get()){ goApp(); return; }

  const form = $('#loginForm'), err = $('#loginErr'), email = $('#email'), pw = $('#password'), btn = $('#submitBtn');
  const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase();

  let demos = [];
  AUTH.ready.then(() => {
    demos = AUTH.demoAccounts();
    $('#demoList').innerHTML = demos.map((a,i) =>
      `<button type="button" class="demo-acc" data-i="${i}" aria-label="Use the ${esc(a.role)} demo account"><span class="avatar">${esc(initials(a.name))}</span><span><b>${esc(a.role)}</b><small>${esc(a.email)}</small></span><span class="demo-fill">Use</span></button>`).join('');
    $('.demo').hidden = !demos.length;
  });

  $('#demoList').addEventListener('click', e => {
    const b = e.target.closest('.demo-acc'); if(!b) return;
    const a = demos[+b.dataset.i];
    email.value = a.email; pw.value = a.password; showErr('');
    document.querySelectorAll('.demo-acc').forEach(x => x.classList.toggle('on', x === b));
    btn.focus();
  });

  $('#pwToggle').addEventListener('click', e => {
    const show = pw.type === 'password'; pw.type = show ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-pressed', String(show));
    e.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  $('#forgot').addEventListener('click', () => { $('#forgotNote').hidden = !$('#forgotNote').hidden; });

  function showErr(msg){
    err.textContent = msg;
    form.classList.remove('shake');
    if(msg){ void form.offsetWidth; form.classList.add('shake'); }
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if(btn.disabled) return;
    btn.disabled = true; btn.textContent = 'Signing in…';
    try{
      await AUTH.signIn(email.value, pw.value, $('#remember').checked);
      document.body.classList.add('leaving');
      setTimeout(goApp, 180);
    }catch(ex){
      btn.disabled = false; btn.textContent = 'Sign in';
      showErr(ex.message);
      (email.value.trim() ? pw : email).focus();
    }
  });

  [email, pw].forEach(i => i.addEventListener('input', () => { if(err.textContent) showErr(''); }));
  email.focus();
})();
