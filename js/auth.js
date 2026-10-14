'use strict';
/* Sign-in, users and role access for the prototype.
   There is no server: users and roles are saved in this browser's localStorage, and anyone can
   read this code. It separates roles for a demo; it is not security. Real sign-in needs a backend (see README). */
const AUTH = (() => {
  const SESSION = 'lanewms-session';
  const DB = 'lanewms-auth';
  const TTL = 8 * 36e5; // 8 hours
  const ADMIN = 'Administrator';

  // Demo accounts created on first visit. Their passwords are shown on the sign-in page.
  const DEMO = [
    {email:'admin@graylane.demo',      password:'Admin@2026', name:'Hamza Kadenja',        role:ADMIN,        title:'General Manager'},
    {email:'supervisor@graylane.demo', password:'Super@2026', name:'Warehouse Supervisor', role:'Supervisor', title:'Jeddah warehouses'},
    {email:'operator@graylane.demo',   password:'Oper@2026',  name:'Picker 1',             role:'Operator',   title:'Warehouse operator'},
    {email:'finance@graylane.demo',    password:'Fin@2026',   name:'Finance Officer',      role:'Finance',    title:'Billing & receivables'}
  ];

  // Module ids match NAV in app.js. Settings (users, roles, company) is for Administrators only.
  const DEFAULT_ROLES = {
    [ADMIN]:    {builtin:true, modules:'*'},
    Supervisor: {builtin:true, modules:['home','clients','master','orders','inbound','inventory','outbound','returns','vas','cold','labour','space','transport','shipping','reports']},
    Operator:   {builtin:true, modules:['home','inbound','inventory','outbound','returns','vas','cold','labour']},
    Finance:    {builtin:true, modules:['home','clients','billing','finance','reports']}
  };
  const ADMIN_ONLY = ['settings'];

  const norm = e => String(e || '').trim().toLowerCase();
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* ---------- password hashing (SHA-256, salted with the email) ---------- */
  async function hash(email, pw){
    const text = 'lanewms|' + norm(email) + '|' + pw;
    if(window.crypto && crypto.subtle){
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return 'sha256:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
    }
    let h = 0x811c9dc5; for(let i=0;i<text.length;i++){ h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'fnv:' + h.toString(16); // fallback where Web Crypto is unavailable
  }

  /* ---------- store ---------- */
  let db = null;
  function readDb(){
    try{ const v = JSON.parse(localStorage.getItem(DB) || 'null'); if(v && Array.isArray(v.users) && v.roles) return v; }catch(e){}
    return null;
  }
  function writeDb(){ try{ localStorage.setItem(DB, JSON.stringify(db)); }catch(e){ throw new Error('This browser is blocking storage, so changes cannot be saved.'); } }
  function data(){ return db || (db = readDb()); }

  const ready = (async () => {
    if(data()) return;
    const users = [];
    for(const [i,a] of DEMO.entries()) users.push({id:'U-'+String(i+1).padStart(3,'0'), email:a.email, name:a.name, title:a.title, role:a.role,
      pass:await hash(a.email, a.password), active:true, demo:true, created:new Date().toISOString(), lastLogin:null});
    db = {seq:users.length, users, roles:JSON.parse(JSON.stringify(DEFAULT_ROLES))};
    try{ writeDb(); }catch(e){}
  })();

  /* ---------- session ---------- */
  const stores = () => { try{ return [localStorage, sessionStorage]; }catch(e){ return []; } };
  function rawSession(){
    for(const s of stores()){ try{ const v = JSON.parse(s.getItem(SESSION) || 'null'); if(v) return {v, s}; }catch(e){} }
    return null;
  }
  // The signed-in user, read fresh from the store so role changes and deactivation apply at once.
  function get(){
    db = readDb(); const r = rawSession(); if(!r || !db) return null;
    const u = db.users.find(x => x.id === r.v.id);
    if(!u || !u.active || !(r.v.exp > Date.now())){ try{ r.s.removeItem(SESSION); }catch(e){} return null; }
    return {id:u.id, email:u.email, name:u.name, role:u.role, title:u.title || u.role, exp:r.v.exp};
  }

  async function signIn(email, password, remember){
    await ready; db = readDb() || db;
    const e = norm(email);
    if(!e || !password) throw new Error('Enter your email and password.');
    const u = db.users.find(x => x.email === e);
    if(!u || u.pass !== await hash(e, password)) throw new Error('That email and password do not match an account.');
    if(!u.active) throw new Error('This account is deactivated. Ask your administrator to turn it back on.');
    signOut();
    try{ (remember ? localStorage : sessionStorage).setItem(SESSION, JSON.stringify({id:u.id, exp:Date.now() + TTL})); }
    catch(err){ throw new Error('This browser is blocking storage, so you cannot stay signed in. Allow site data and try again.'); }
    u.lastLogin = new Date().toISOString(); writeDb();
    return get();
  }
  function signOut(){ for(const s of stores()){ try{ s.removeItem(SESSION); }catch(e){} } }

  /* ---------- access ---------- */
  function can(role, module){
    const r = data() && data().roles[role]; if(!r) return false;
    if(r.modules === '*') return true;
    return !ADMIN_ONLY.includes(module) && r.modules.includes(module);
  }
  const isAdmin = s => !!s && s.role === ADMIN;

  // Keep "next" to a same-page hash route so the redirect cannot be pointed at another site.
  function safeNext(v){ return /^#[a-z]+(\.[a-z]+)?$/.test(v || '') ? v : ''; }
  function requireSession(){
    const s = get();
    if(!s){ location.replace('login.html' + (safeNext(location.hash) ? '?next=' + encodeURIComponent(location.hash) : '')); return null; }
    return s;
  }

  /* ---------- user management (Administrator) ---------- */
  function requireAdmin(){ if(!isAdmin(get())) throw new Error('Only an Administrator can do this.'); }
  const activeAdmins = () => data().users.filter(u => u.active && u.role === ADMIN);
  function checkPassword(pw){
    if(String(pw).length < 8) throw new Error('Use a password of at least 8 characters.');
    if(!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new Error('Use at least one letter and one number in the password.');
  }

  async function saveUser(d, id){
    requireAdmin();
    const email = norm(d.email), name = String(d.name || '').trim();
    if(!name) throw new Error('Enter the person\'s name.');
    if(!EMAIL_RE.test(email)) throw new Error('Enter a valid email address.');
    if(!data().roles[d.role]) throw new Error('Choose a role.');
    if(data().users.some(u => u.email === email && u.id !== id)) throw new Error('Another user already has the email ' + email + '.');
    if(!id){
      checkPassword(d.password);
      if(d.password !== d.confirm) throw new Error('The two passwords do not match.');
      const u = {id:'U-'+String(++data().seq).padStart(3,'0'), email, name, title:String(d.title||'').trim(), role:d.role,
        pass:await hash(email, d.password), active:true, demo:false, created:new Date().toISOString(), lastLogin:null};
      data().users.push(u); writeDb(); return u;
    }
    const u = data().users.find(x => x.id === id); if(!u) throw new Error('User not found.');
    if(u.role === ADMIN && d.role !== ADMIN && u.active && activeAdmins().length <= 1) throw new Error('Keep at least one active Administrator. Make someone else an Administrator first.');
    if(u.email !== email){
      // The email is part of the password hash, so changing it needs a new password.
      if(!d.password) throw new Error('Changing the email also needs a new password. Enter one below.');
    }
    if(d.password){ checkPassword(d.password); if(d.password !== d.confirm) throw new Error('The two passwords do not match.'); u.pass = await hash(email, d.password); u.demo = false; }
    Object.assign(u, {email, name, title:String(d.title||'').trim(), role:d.role});
    writeDb(); return u;
  }

  function setActive(id, on){
    requireAdmin();
    const u = data().users.find(x => x.id === id); if(!u) throw new Error('User not found.');
    if(!on && u.id === get().id) throw new Error('You cannot deactivate your own account.');
    if(!on && u.role === ADMIN && activeAdmins().length <= 1) throw new Error('Keep at least one active Administrator.');
    u.active = !!on; writeDb(); return u;
  }

  function deleteUser(id){
    requireAdmin();
    const u = data().users.find(x => x.id === id); if(!u) throw new Error('User not found.');
    if(u.id === get().id) throw new Error('You cannot delete your own account.');
    if(u.role === ADMIN && u.active && activeAdmins().length <= 1) throw new Error('Keep at least one active Administrator.');
    data().users = data().users.filter(x => x.id !== id); writeDb(); return u;
  }

  /* ---------- roles (Administrator) ---------- */
  function setRoleAccess(role, modules){
    requireAdmin();
    const r = data().roles[role]; if(!r) throw new Error('Role not found.');
    if(r.modules === '*') throw new Error('Administrators always have full access.');
    r.modules = [...new Set(['home', ...modules.filter(m => !ADMIN_ONLY.includes(m))])];
    writeDb();
  }
  function addRole(name, copyFrom){
    requireAdmin();
    name = String(name || '').trim().replace(/\s+/g,' ');
    if(!name) throw new Error('Enter a role name.');
    if(name.length > 40) throw new Error('Keep the role name under 40 characters.');
    if(Object.keys(data().roles).some(r => r.toLowerCase() === name.toLowerCase())) throw new Error('A role called ' + name + ' already exists.');
    const src = data().roles[copyFrom];
    data().roles[name] = {builtin:false, modules: src && src.modules !== '*' ? [...src.modules] : ['home']};
    writeDb(); return name;
  }
  function deleteRole(name){
    requireAdmin();
    const r = data().roles[name]; if(!r) throw new Error('Role not found.');
    if(r.builtin) throw new Error('Built-in roles cannot be deleted. You can change what they can open.');
    const n = data().users.filter(u => u.role === name).length;
    if(n) throw new Error(n + ' user(s) have this role. Give them another role first.');
    delete data().roles[name]; writeDb();
  }

  return {
    ADMIN, ADMIN_ONLY, ready, get, signIn, signOut, can, isAdmin, safeNext, requireSession,
    users: () => (data() ? data().users.map(u => ({...u, pass:undefined})) : []),
    roles: () => (data() ? data().roles : {}),
    demoAccounts: () => DEMO.filter(a => (data()?.users || []).some(u => u.email === a.email && u.demo && u.active)),
    saveUser, setActive, deleteUser, setRoleAccess, addRole, deleteRole
  };
})();
