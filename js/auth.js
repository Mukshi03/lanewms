'use strict';
/* Front-end sign-in for the prototype. There is no server, so these accounts are demo accounts
   visible to anyone who reads the page source. Real sign-in needs a backend (see README). */
const AUTH = (() => {
  const KEY = 'lanewms-session';
  const TTL = 8 * 36e5; // 8 hours

  const ACCOUNTS = [
    {email:'admin@graylane.demo',      password:'Admin@2026', name:'Hamza Kadenja',        role:'Administrator', title:'General Manager'},
    {email:'supervisor@graylane.demo', password:'Super@2026', name:'Warehouse Supervisor', role:'Supervisor',    title:'Jeddah warehouses'},
    {email:'operator@graylane.demo',   password:'Oper@2026',  name:'Picker 1',             role:'Operator',      title:'Warehouse operator'},
    {email:'finance@graylane.demo',    password:'Fin@2026',   name:'Finance Officer',      role:'Finance',       title:'Billing & receivables'}
  ];

  // Modules each role can open (ids match NAV in app.js). Administrator sees everything.
  const ACCESS = {
    Administrator: '*',
    Supervisor: ['home','clients','master','orders','inbound','inventory','outbound','returns','vas','cold','labour','space','transport','shipping','reports'],
    Operator:   ['home','inbound','inventory','outbound','returns','vas','cold','labour'],
    Finance:    ['home','clients','billing','finance','reports']
  };

  const store = () => { try{ return [localStorage, sessionStorage]; }catch(e){ return []; } };

  function get(){
    for(const s of store()){
      try{
        const v = JSON.parse(s.getItem(KEY) || 'null');
        if(v && v.email && v.exp > Date.now() && ACCOUNTS.some(a => a.email === v.email)) return v;
        if(v) s.removeItem(KEY);
      }catch(e){}
    }
    return null;
  }

  function signIn(email, password, remember){
    const e = String(email || '').trim().toLowerCase();
    const a = ACCOUNTS.find(x => x.email === e);
    if(!e || !password) throw new Error('Enter your email and password.');
    if(!a || a.password !== password) throw new Error('That email and password do not match an account.');
    const session = {email:a.email, name:a.name, role:a.role, title:a.title, at:Date.now(), exp:Date.now() + TTL};
    signOut();
    try{ (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session)); }
    catch(err){ throw new Error('This browser is blocking storage, so you cannot stay signed in. Allow site data and try again.'); }
    return session;
  }

  function signOut(){ for(const s of store()){ try{ s.removeItem(KEY); }catch(e){} } }

  function can(role, module){ const a = ACCESS[role]; return a === '*' || (!!a && a.includes(module)); }

  // Keep "next" to a same-page hash route so the redirect cannot be pointed at another site.
  function safeNext(v){ return /^#[a-z]+(\.[a-z]+)?$/.test(v || '') ? v : ''; }

  function requireSession(){
    const s = get();
    if(!s){ location.replace('login.html' + (safeNext(location.hash) ? '?next=' + encodeURIComponent(location.hash) : '')); return null; }
    return s;
  }

  return {ACCOUNTS, get, signIn, signOut, can, safeNext, requireSession};
})();
