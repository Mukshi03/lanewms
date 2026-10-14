'use strict';
/* ================= utilities ================= */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DAY = 864e5;
// Dates are local calendar days (YYYY-MM-DD). Plain date strings are parsed as local midnight, not UTC.
const pad2 = n => String(n).padStart(2,'0');
const toDate = d => typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d+'T00:00:00') : new Date(d);
const iso = d => { const x=toDate(d); return x.getFullYear()+'-'+pad2(x.getMonth()+1)+'-'+pad2(x.getDate()); };
const today = () => iso(Date.now());
const addDays = (d,n) => { const x=toDate(d); x.setDate(x.getDate()+n); return iso(x); };
const daysBetween = (a,b) => Math.round((toDate(b) - toDate(a))/DAY);
const fmtDate = d => d ? new Date(d+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const n0 = v => Number(v||0).toLocaleString('en-US');
const sar = v => Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const sum = (a,f) => a.reduce((t,x)=>t+(f?f(x):x),0);
const VAT = 0.15;
const KEY = 'lanewms-v2'; // own key, so it never clashes with other Gray Lane builds on the same site
try{ localStorage.removeItem('lanewms-v1'); }catch(e){} // sample records from earlier versions

/* ================= state ================= */
let S;
function blank(){
  return {seq:{}, company:{name:'Gray Lane Logistics',vat:'',cr:'',city:'Jeddah'},
    clients:[],warehouses:[],bins:[],items:[],asns:[],grns:[],tasks:[],stock:[],orders:[],moves:[],charges:[],invoices:[],
    returns:[],vas:[],counts:[],zones:[],vehicles:[],drivers:[],trips:[],spaces:[],bookings:[],users:[],payments:[],
    reasons:['Damaged in warehouse','Count variance','Expired','Customer return','Supplier short shipment','QC rejection']};
}
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }
function load(){ try{ const t = localStorage.getItem(KEY); return t ? JSON.parse(t) : null; }catch(e){ return null; } }
function nid(p,w=5){ S.seq[p]=(S.seq[p]||0)+1; return p+'-'+String(S.seq[p]).padStart(w,'0'); }
const client = id => S.clients.find(c=>c.id===id) || {name:id, rates:{}};
const item = sku => S.items.find(i=>i.sku===sku) || {sku, name:sku};
const wh = id => S.warehouses.find(w=>w.id===id) || {name:id};
function normalizeItems(){
  const yr=today().slice(0,4);
  S.items.forEach(i=>{
    if(!i.code) i.code=nid('ITEM-'+yr);
    if(!i.kind) i.kind='Goods';
    if(!i.variant) i.variant='single';
    if(i.track==null) i.track=true;
    if(i.expiry==null) i.expiry=i.shelf>0;
    if(i.batch==null) i.batch=i.shelf>0;
    if(i.serial==null) i.serial=false;
    if(!i.valMethod) i.valMethod='FIFO';
    if(!i.conversions) i.conversions=[];
    ['name2','category','manufacturer','group','packing','valDate','series'].forEach(k=>{ if(i[k]==null) i[k]=''; });
  });
}
function move(at,type,ref,r,qty){ S.moves.push({at,type,ref,client:r.client,sku:r.sku,lpn:r.lpn,wh:r.wh,bin:r.bin,batch:r.batch,qty}); }
function charge(at,cl,type,ref,qty,rate,note){
  if(!qty || !rate) return;
  S.charges.push({id:nid('CHG',6),at,client:cl,type,ref,qty,rate,amount:+(qty*rate).toFixed(2),note:note||'',invoice:null});
}

/* ================= operations (business logic) ================= */
const OPS = {
  createASN({client:cl,wh:w,eta,ref,dock,lines},at=today()){
    if(!lines.length) throw new Error('Add at least one item line.');
    const a={id:nid('ASN'),client:cl,wh:w,eta,ref:ref||'',dock:dock||'',slot:'',status:'Expected',created:at,lines:lines.map(l=>({...l,qty:+l.qty}))};
    S.asns.push(a); return a;
  },
  suggestBin(w,temp){
    // Storage bins only (never dock, staging, returns or QA), with free capacity, matching temperature first.
    const used=b=>S.stock.filter(s=>s.bin===b.code&&s.wh===w).length+S.tasks.filter(t=>t.status==='Open'&&t.wh===w&&t.to===b.code).length;
    const store=S.bins.filter(b=>b.wh===w&&b.zone==='Storage'&&used(b)<b.cap);
    const match=store.filter(b=>!temp||b.temp===temp||b.temp==='Any');
    const pool=match.length?match:store;
    let best=null,bestN=1e9;
    for(const b of pool){ const n=used(b); if(n<bestN){best=b;bestN=n;} }
    return best?best.code:'DOCK-IN';
  },
  receiveASN(id,at=today(),receivedQty){
    const a=S.asns.find(x=>x.id===id); if(!a||a.status!=='Expected') throw new Error('This ASN is not open for receiving.');
    const grn={id:nid('GRN'),asn:a.id,client:a.client,wh:a.wh,at,lines:[]};
    a.lines.forEach((l,i)=>{
      const q = receivedQty ? +receivedQty[i] : l.qty;
      if(!(q>0)) return;
      const it=item(l.sku);
      const lpn=nid('LPN',6);
      const r={lpn,client:a.client,sku:l.sku,wh:a.wh,bin:'DOCK-IN',batch:l.batch||'',expiry:l.expiry||'',qty:q,alloc:0,status:'Received',received:at};
      S.stock.push(r); move(at,'Receipt',grn.id,r,q);
      S.tasks.push({id:nid('PUT'),lpn,wh:a.wh,from:'DOCK-IN',to:OPS.suggestBin(a.wh,it.temp),status:'Open',created:at,done:null,by:''});
      grn.lines.push({sku:l.sku,expected:l.qty,received:q,diff:q-l.qty,lpn,batch:l.batch,expiry:l.expiry});
    });
    if(!grn.lines.length) throw new Error('Enter a received quantity for at least one line.');
    S.grns.push(grn); a.status='Received'; a.grn=grn.id; a.received=at;
    charge(at,a.client,'Handling in',grn.id,grn.lines.length,client(a.client).rates.inbound,'per pallet');
    return grn;
  },
  putaway(id,bin,at=today(),by='Warehouse team'){
    const t=S.tasks.find(x=>x.id===id); if(!t||t.status!=='Open') throw new Error('Task already done.');
    if(!S.bins.some(b=>b.code===bin&&b.wh===t.wh)) throw new Error('Bin '+bin+' is not in this warehouse.');
    const r=S.stock.find(s=>s.lpn===t.lpn); r.bin=bin; r.status='Available';
    t.to=bin; t.status='Done'; t.done=at; t.by=by; move(at,'Putaway',t.id,r,0);
  },
  createOrder({client:cl,wh:w,customer,due,ref,lines},at=today()){
    if(!lines.length) throw new Error('Add at least one item line.');
    const o={id:nid('OB'),client:cl,wh:w,customer:customer||'',due,ref:ref||'',status:'New',created:at,lines:lines.map(l=>({sku:l.sku,qty:+l.qty,picks:[],short:0}))};
    S.orders.push(o); return o;
  },
  allocate(id){
    const o=S.orders.find(x=>x.id===id); if(!o||o.status!=='New') throw new Error('Only new orders can be allocated.');
    const rule=(client(o.client).rule||'FEFO'), T=today();
    for(const l of o.lines){
      let need=l.qty; l.picks=[];
      const pool=S.stock.filter(s=>s.client===o.client&&s.sku===l.sku&&s.wh===o.wh&&s.status==='Available'&&s.qty-s.alloc>0&&!(s.expiry&&s.expiry<T))
        .sort((a,b)=> rule==='FIFO' ? a.received.localeCompare(b.received) : ((a.expiry||'9999').localeCompare(b.expiry||'9999') || a.received.localeCompare(b.received)));
      for(const s of pool){ if(need<=0)break; const q=Math.min(need,s.qty-s.alloc); s.alloc+=q; l.picks.push({lpn:s.lpn,bin:s.bin,batch:s.batch,expiry:s.expiry,qty:q}); need-=q; }
      l.short=need;
    }
    const allocated=sum(o.lines,l=>l.qty-l.short);
    if(!allocated){ o.lines.forEach(l=>l.short=l.qty); throw new Error('No available stock for this order. It stays as New.'); }
    o.status='Allocated';
    return o;
  },
  releasePick(id,at=today()){
    const o=S.orders.find(x=>x.id===id); if(!o||o.status!=='Allocated') throw new Error('Allocate the order first.');
    o.pick=nid('PICK'); o.status='Picking'; o.pickAt=at;
  },
  confirmPick(id,at=today(),by='Warehouse team'){
    const o=S.orders.find(x=>x.id===id); if(!o||o.status!=='Picking') throw new Error('Release a pick list first.');
    for(const l of o.lines) for(const p of l.picks){
      const s=S.stock.find(x=>x.lpn===p.lpn); if(!s) continue;
      s.qty-=p.qty; s.alloc-=p.qty; move(at,'Pick',o.id,s,-p.qty);
      if(s.qty<=0) S.stock=S.stock.filter(x=>x.lpn!==s.lpn);
    }
    o.status='Picked'; o.pickedAt=at; o.pickedBy=by;
  },
  dispatch(id,at=today()){
    const o=S.orders.find(x=>x.id===id); if(!o||o.status!=='Picked') throw new Error('Confirm picking first.');
    o.dn=nid('DN'); o.status='Dispatched'; o.dispatchedAt=at;
    const c=client(o.client).rates;
    charge(at,o.client,'Order fee',o.id,1,c.order);
    charge(at,o.client,'Handling out',o.id,sum(o.lines,l=>l.picks.length),c.outbound,'per pick line');
  },
  deliver(id,receivedBy,at=today()){
    const o=S.orders.find(x=>x.id===id); if(!o||o.status!=='Dispatched') throw new Error('Only dispatched orders can be delivered.');
    o.status='Delivered'; o.deliveredAt=at; o.pod=receivedBy||'Customer';
  },
  cancelOrder(id){
    const o=S.orders.find(x=>x.id===id); if(!o||!['New','Allocated'].includes(o.status)) throw new Error('Only new or allocated orders can be cancelled.');
    for(const l of o.lines) for(const p of l.picks){ const s=S.stock.find(x=>x.lpn===p.lpn); if(s) s.alloc-=p.qty; }
    o.status='Cancelled';
  },
  setStatus(lpn,status,at=today()){
    const s=S.stock.find(x=>x.lpn===lpn); if(!s) throw new Error('LPN not found.');
    if(s.alloc>0) throw new Error('This pallet is allocated to an order.');
    s.status=status; move(at,'Status: '+status,'',s,0);
  },
  adjust(lpn,newQty,reason,at=today()){
    const s=S.stock.find(x=>x.lpn===lpn); if(!s) throw new Error('LPN not found.');
    newQty=+newQty; if(newQty<s.alloc) throw new Error('New quantity is below the allocated quantity ('+s.alloc+').');
    const d=newQty-s.qty; if(!d) return;
    s.qty=newQty; move(at,'Adjustment',reason||'Adjustment',s,d);
    if(s.qty<=0) S.stock=S.stock.filter(x=>x.lpn!==lpn);
  },
  transfer(lpn,bin,at=today()){
    const s=S.stock.find(x=>x.lpn===lpn); if(!s) throw new Error('LPN not found.');
    if(!S.bins.some(b=>b.code===bin&&b.wh===s.wh)) throw new Error('Bin '+bin+' is not in '+wh(s.wh).name+'.');
    const from=s.bin; s.bin=bin; move(at,'Transfer',from+' → '+bin,s,0);
  },
  createCount(w,bin,at=today()){
    const lines=S.stock.filter(s=>s.wh===w&&s.bin===bin).map(s=>({lpn:s.lpn,sku:s.sku,expected:s.qty,counted:null}));
    if(!lines.length) throw new Error('No pallets in bin '+bin+'.');
    const c={id:nid('CC'),wh:w,bin,status:'Open',created:at,lines}; S.counts.push(c); return c;
  },
  postCount(id,counted,at=today()){
    const c=S.counts.find(x=>x.id===id); if(!c||c.status!=='Open') throw new Error('Count already posted.');
    c.lines.forEach((l,i)=>{ l.counted=+counted[i]; if(l.counted!==l.expected){ try{ OPS.adjust(l.lpn,l.counted,'Cycle count '+c.id,at);}catch(e){ l.note=e.message; } } });
    c.status='Posted'; c.posted=at;
  },
  createReturn(orderId,lines,reason,at=today()){
    const o=S.orders.find(x=>x.id===orderId); if(!o||!['Dispatched','Delivered'].includes(o.status)) throw new Error('Returns need a dispatched or delivered order.');
    const r={id:nid('RMA'),order:o.id,client:o.client,wh:o.wh,reason:reason||'',status:'Requested',created:at,lines:lines.filter(l=>+l.qty>0).map(l=>({sku:l.sku,qty:+l.qty,result:''}))};
    if(!r.lines.length) throw new Error('Enter a return quantity.');
    S.returns.push(r); return r;
  },
  inspectReturn(id,decision,at=today()){
    const r=S.returns.find(x=>x.id===id); if(!r||r.status!=='Requested') throw new Error('Already inspected.');
    for(const l of r.lines){
      l.result=decision;
      if(decision!=='Dispose'){
        const lpn=nid('LPN',6);
        const s={lpn,client:r.client,sku:l.sku,wh:r.wh,bin:'RET-01',batch:'RET',expiry:'',qty:l.qty,alloc:0,status:decision==='Restock'?'Available':'Damaged',received:at};
        S.stock.push(s); move(at,'Return',r.id,s,l.qty);
      }
    }
    r.status='Closed'; r.closed=at;
    charge(at,r.client,'Returns handling',r.id,r.lines.length,client(r.client).rates.inbound,'per line');
  },
  createVAS({client:cl,type,sku,qty,due},at=today()){
    const v={id:nid('VAS'),client:cl,type,sku,qty:+qty,due,status:'Open',created:at}; S.vas.push(v); return v;
  },
  completeVAS(id,at=today()){
    const v=S.vas.find(x=>x.id===id); if(!v||v.status!=='Open') throw new Error('Already completed.');
    v.status='Completed'; v.done=at; charge(at,v.client,'VAS: '+v.type,v.id,v.qty,client(v.client).rates.vas,'per unit');
  },
  reading(zoneId,value,at){
    const z=S.zones.find(x=>x.id===zoneId); z.readings.push({at:at||new Date().toISOString(),v:+value});
    if(z.readings.length>48) z.readings.shift();
  },
  createTrip({vehicle,driver,date,orders}){
    if(!orders.length) throw new Error('Choose at least one dispatched order.');
    const t={id:nid('TRIP'),vehicle,driver,date,orders,status:'Planned'}; S.trips.push(t);
    orders.forEach(oid=>{ const o=S.orders.find(x=>x.id===oid); if(o) o.trip=t.id; }); return t;
  },
  startTrip(id){ const t=S.trips.find(x=>x.id===id); if(t.status!=='Planned') throw new Error('Trip already started.'); t.status='Out for delivery'; },
  completeTrip(id,at=today()){
    const t=S.trips.find(x=>x.id===id); if(t.status!=='Out for delivery') throw new Error('Start the trip first.');
    t.status='Completed'; t.done=at;
    t.orders.forEach(oid=>{ const o=S.orders.find(x=>x.id===oid); if(o&&o.status==='Dispatched'){ OPS.deliver(oid,'Driver POD',at); charge(at,o.client,'Transport',t.id,1,client(o.client).rates.transport,'per drop'); } });
  },
  ship(id,courier){
    const o=S.orders.find(x=>x.id===id); if(!o||!['Picked','Dispatched'].includes(o.status)) throw new Error('Pick the order before booking a courier.');
    o.courier=courier; o.awb='SIM'+String(Math.floor(1e8+Math.random()*9e8));
  },
  captureStorage(at=today()){
    if(S.charges.some(c=>c.type==='Storage'&&c.at===at)) throw new Error('Storage for '+fmtDate(at)+' is already captured.');
    let n=0;
    for(const c of S.clients){
      const pallets=S.stock.filter(s=>s.client===c.id).length;
      if(pallets){ charge(at,c.id,'Storage','Snapshot '+at,pallets,c.rates.storage,'pallet-days'); n++; }
    }
    return n;
  },
  billingRun(cl,to=today()){
    const ch=S.charges.filter(c=>c.client===cl&&!c.invoice&&c.at<=to);
    if(!ch.length) throw new Error('No unbilled charges for this client.');
    const groups={};
    ch.forEach(c=>{ const k=c.type+'|'+c.rate; (groups[k]=groups[k]||{type:c.type,rate:c.rate,qty:0,amount:0,note:c.note}); groups[k].qty+=c.qty; groups[k].amount+=c.amount; });
    const lines=Object.values(groups).map(g=>({...g,amount:+g.amount.toFixed(2)}));
    const subtotal=+sum(lines,l=>l.amount).toFixed(2), vat=+(subtotal*VAT).toFixed(2);
    const from=ch.map(c=>c.at).sort()[0];
    const inv={id:nid('INV'),client:cl,date:to,from,to,lines,subtotal,vat,total:+(subtotal+vat).toFixed(2),status:'Draft',zatca:'Not submitted',paid:0};
    ch.forEach(c=>c.invoice=inv.id); S.invoices.push(inv); return inv;
  },
  issueInvoice(id,at=today()){
    const v=S.invoices.find(x=>x.id===id); if(!v||v.status!=='Draft') throw new Error('Only drafts can be issued.');
    v.status='Issued'; v.date=at; v.due=addDays(at,client(v.client).terms||30);
    v.zatca='Cleared (simulated)'; v.uuid=crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    v.hash=Array.from({length:12},()=>Math.floor(Math.random()*16).toString(16)).join('');
  },
  voidDraft(id){
    const v=S.invoices.find(x=>x.id===id); if(!v||v.status!=='Draft') throw new Error('Only drafts can be deleted.');
    S.charges.forEach(c=>{ if(c.invoice===id) c.invoice=null; }); S.invoices=S.invoices.filter(x=>x.id!==id);
  },
  pay(id,amount,at=today(),method='Bank transfer'){
    const v=S.invoices.find(x=>x.id===id); if(!v||v.status==='Draft') throw new Error('Issue the invoice first.');
    amount=+amount; if(!(amount>0)) throw new Error('Enter an amount.');
    const due=+(v.total-v.paid).toFixed(2); if(amount>due+0.001) throw new Error('Amount is more than the balance ('+sar(due)+').');
    v.paid=+(v.paid+amount).toFixed(2); if(v.paid>=v.total-0.001) v.status='Paid';
    S.payments.push({id:nid('RCPT'),invoice:id,client:v.client,at,amount,method});
  },
  saveItem(d,editSku,at=today()){
    if(!d.client) throw new Error('Choose the company (client) that owns this item.');
    if(!d.name) throw new Error('Enter the primary name.');
    if(!d.sku) throw new Error('Enter a SKU.');
    if(!/^[A-Z0-9][A-Z0-9._-]*$/.test(d.sku)) throw new Error('The SKU can use letters, digits, dots, dashes and underscores only.');
    if(d.conversions.some(c=>c.uom===d.uom)) throw new Error('A unit conversion cannot use the base unit ('+d.uom+') itself.');
    if(d.track&&d.expiry&&!(d.shelf>0)) throw new Error('Enter the shelf life in days, or untick "Has expiry date".');
    const base={client:d.client,name2:d.name2,kind:d.kind,category:d.category,manufacturer:d.manufacturer,uom:d.uom,conversions:d.conversions,group:d.group,temp:d.temp,barcode:d.barcode,
      track:d.track,valMethod:d.valMethod,valDate:d.valDate,valRate:d.valRate,packing:d.packing,batch:d.track&&d.batch,serial:d.track&&d.serial,expiry:d.track&&d.expiry,shelf:d.track&&d.expiry?d.shelf:0};
    if(editSku){
      const it=S.items.find(i=>i.sku===editSku); const {barcode,...shared}=base;
      Object.assign(it,base,{name:d.name});
      if(it.variant==='template') S.items.filter(v=>v.parent===it.sku).forEach(v=>Object.assign(v,shared,{name:d.name+' - '+v.attr.value}));
      return {item:it,variants:0,opening:0};
    }
    if(S.items.some(i=>i.sku===d.sku)) throw new Error('SKU '+d.sku+' already exists.');
    const isVar=d.vtype==='variants';
    const openTotal=d.track?(isVar?sum(d.vopen):d.opening):0;
    if(openTotal>0){
      if(!d.wh) throw new Error('Choose the warehouse that holds the opening stock.');
      if(d.batch&&!d.obatch) throw new Error('Enter the batch number of the opening stock.');
      if(d.expiry&&!d.oexp) throw new Error('Enter the expiry date of the opening stock.');
    }
    const code=()=>nid(d.series==='ITM-.#####'?'ITM':'ITEM-'+at.slice(0,4));
    if(isVar){
      if(!d.vattr) throw new Error('Name the variant attribute, for example Size or Colour.');
      if(!d.vals.length) throw new Error('Enter at least one variant value, separated by commas.');
      const vs=d.vals.map(v=>({v,sku:d.sku+'-'+v.toUpperCase().replace(/[^A-Z0-9]+/g,'')}));
      const seen=new Set(); vs.forEach(x=>{ if(seen.has(x.sku)) throw new Error('Two variant values give the same SKU ('+x.sku+').'); seen.add(x.sku); if(S.items.some(i=>i.sku===x.sku)) throw new Error('SKU '+x.sku+' already exists.'); });
      const tpl={...base,sku:d.sku,code:code(),series:d.series,name:d.name,variant:'template',attrName:d.vattr,barcode:''};
      S.items.push(tpl);
      vs.forEach((x,i)=>{ const it={...base,sku:x.sku,code:code(),series:d.series,name:d.name+' - '+x.v,name2:d.name2?d.name2+' '+x.v:'',variant:'variant',parent:d.sku,attr:{name:d.vattr,value:x.v},barcode:''};
        S.items.push(it); if(d.track&&d.vopen[i]>0) OPS.openingStock(it,d.wh,d.vopen[i],d,at); });
      return {item:tpl,variants:vs.length,opening:openTotal};
    }
    const it={...base,sku:d.sku,code:code(),series:d.series,name:d.name,variant:'single'};
    S.items.push(it);
    if(openTotal>0) OPS.openingStock(it,d.wh,openTotal,d,at);
    return {item:it,variants:0,opening:openTotal};
  },
  openingStock(it,w,qty,d,at=today()){
    const lpn=nid('LPN',6); const bin=OPS.suggestBin(w,it.temp)||'DOCK-IN';
    const r={lpn,client:it.client,sku:it.sku,wh:w,bin,batch:d.obatch||'',expiry:d.oexp||'',qty:+qty,alloc:0,status:'Available',received:d.valDate||at,rate:d.valRate||0};
    S.stock.push(r); move(at,'Opening stock',it.code,r,+qty);
  },
  book({company,type,pallets,from,months,contact},at=today()){
    const b={id:nid('BKG'),company,type,pallets:+pallets,from,months:+months,contact:contact||'',status:'Requested',created:at}; S.bookings.push(b); return b;
  }
};

/* ================= fresh start (no sample records) ================= */
function fresh(){ S=blank(); save(); return S; }

/* ================= navigation map ================= */
const IC={
  home:'<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
  clients:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  master:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  orders:'<path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4"/>',
  inbound:'<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  inventory:'<path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10"/>',
  outbound:'<path d="M12 21V9M7 14l5-5 5 5M4 4h16"/>',
  returns:'<path d="M4 12a8 8 0 1014-5.3M18 3v4h-4"/>',
  vas:'<path d="M4 8h16v12H4zM8 8V5h8v3M4 13h16"/>',
  cold:'<path d="M10 14V4a2 2 0 014 0v10a4 4 0 11-4 0z"/>',
  labour:'<circle cx="12" cy="7" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  space:'<path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6"/>',
  transport:'<path d="M2 6h12v10H2zM14 10h4l3 3v3h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  shipping:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  billing:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  finance:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
  reports:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'
};
const NAV=[
  {g:'OVERVIEW',m:[
    {id:'home',t:'Home',subs:[['dash','Dashboard']]},
    {id:'clients',t:'Clients & Contracts',subs:[['list','Clients'],['rates','Rate cards'],['portal','Client users']]},
    {id:'master',t:'Master Data',subs:[['items','Items'],['wh','Warehouses'],['bins','Bins'],['fleet','Vehicles & drivers'],['reasons','Reason codes']]},
    {id:'orders',t:'Orders (OMS)',subs:[['all','All orders'],['import','Import orders'],['back','Backorders']]}]},
  {g:'WAREHOUSE',m:[
    {id:'inbound',t:'Inbound',subs:[['asn','ASN'],['dock','Dock appointments'],['receive','Receiving'],['grn','GRN'],['putaway','Putaway tasks']]},
    {id:'inventory',t:'Inventory',subs:[['stock','Stock'],['transfer','Transfers'],['count','Cycle counts'],['ledger','Stock ledger'],['expiry','Batch & expiry']]},
    {id:'outbound',t:'Outbound',subs:[['alloc','Allocation'],['pick','Pick lists'],['dispatch','Packing & dispatch'],['pod','Delivery notes & POD']]},
    {id:'returns',t:'Returns (RMA)',subs:[['list','Returns']]},
    {id:'vas',t:'Value-Added Services',subs:[['list','Work orders']]},
    {id:'cold',t:'Cold Chain',subs:[['zones','Temperature zones']]},
    {id:'labour',t:'Labour',subs:[['tasks','Task board'],['prod','Productivity']]},
    {id:'space',t:'Space & Services',subs:[['avail','Availability'],['book','Bookings']]}]},
  {g:'DELIVERY',m:[
    {id:'transport',t:'Transport',subs:[['trips','Trips']]},
    {id:'shipping',t:'Shipping Gateway',subs:[['ship','Courier shipments']]}]},
  {g:'FINANCE & ADMIN',m:[
    {id:'billing',t:'3PL Billing',subs:[['charges','Service charges'],['storage','Storage capture'],['run','Billing run']]},
    {id:'finance',t:'Finance & ZATCA',subs:[['inv','Invoices'],['pay','Payments'],['zatca','ZATCA log'],['ageing','Receivables ageing'],['vat','VAT summary']]},
    {id:'reports',t:'Reports & Analytics',subs:[['bal','Stock balance'],['thru','Throughput'],['client','Client profitability'],['sla','SLA']]},
    {id:'settings',t:'Settings',subs:[['company','Company'],['users','Users & access'],['roles','Roles & permissions'],['data','Data']]}]}
];
const MOD={}; NAV.forEach(g=>g.m.forEach(m=>MOD[m.id]=m));
let route={m:'home',s:'dash'}, openMods=new Set(['home']), filt={};
const ME=AUTH.get();
const allowed=m=>!!ME&&AUTH.can(ME.role,m);
function parseHash(){ const h=(location.hash||'').slice(1).split('.'); if(MOD[h[0]]&&allowed(h[0])){ route={m:h[0],s:(MOD[h[0]].subs.find(s=>s[0]===h[1])||MOD[h[0]].subs[0])[0]}; openMods.add(route.m); } else route={m:'home',s:'dash'}; }
function go(m,s){
  if(!allowed(m)){ toast(`Your role (${ME.role}) does not have access to ${MOD[m].t}.`); return; }
  route={m,s:s||MOD[m].subs[0][0]}; openMods.add(m);
  const h='#'+m+'.'+route.s; try{ if(location.hash!==h) history.pushState(null,'',h); }catch(e){}
  closeMenu(); render(); window.scrollTo(0,0);
  const v=$('#view'); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
  clearTimeout(go.t); go.t=setTimeout(()=>v.classList.remove('enter'),250);
}
function closeMenu(){ $('#side').classList.remove('show'); document.body.classList.remove('menu-open'); }

function renderSide(){
  let h=`<div class="brand"><b>Warehouse Management System</b></div>`;
  for(const g of NAV){
    const mods=g.m.filter(m=>allowed(m.id)); if(!mods.length) continue;
    h+=`<div class="grp">${g.g==='OVERVIEW'?'':`<h3>${g.g}</h3>`}`;
    for(const m of mods){
      const on=route.m===m.id, open=openMods.has(m.id)&&m.subs.length>1;
      h+=`<button class="nav ${on?'on':''} ${open?'open':''}" data-nav="${m.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${IC[m.id]}</svg><span>${m.t}</span>${m.subs.length>1?'<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>':''}</button>`;
      if(open) h+=`<div class="subs">${m.subs.map(s=>`<button class="sub ${on&&route.s===s[0]?'on':''}" data-go="${m.id}.${s[0]}">${s[1]}</button>`).join('')}</div>`;
    }
    h+='</div>';
  }
  $('#side').innerHTML=h;
}

/* ================= view helpers ================= */
function page(title,actions,body,{tabs=true}={}){
  const m=MOD[route.m]; const sub=m.subs.find(s=>s[0]===route.s);
  return `<div class="head"><div><div class="crumb">${m.t}${m.subs.length>1?' / '+sub[1]:''}</div><h1>${title}</h1></div><div class="actions">${actions||''}</div></div>
  ${tabs&&m.subs.length>1?`<nav class="tabs" aria-label="${m.t} sections">${m.subs.map(s=>`<button class="tab ${route.s===s[0]?'on':''}" data-go="${m.id}.${s[0]}">${s[1]}</button>`).join('')}</nav>`:''}${body}`;
}
function table(cols,rows,{empty='Nothing here yet.',click}={}){
  if(!rows.length) return `<div class="empty">${empty}</div>`;
  return `<div class="tbl-wrap"><table><thead><tr>${cols.map(c=>`<th class="${c.n?'num':''}">${c.h}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r=>`<tr ${click?`class="click" tabindex="0" data-open="${click}" data-id="${esc(r.id||r.lpn||r.sku||r.code)}"`:''}>${cols.map(c=>`<td class="${c.n?'num':''}">${c.v(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const card=(title,body,extra='')=>`<section class="card"><div class="card-h"><h2>${title}</h2><div class="row">${extra}</div></div>${body}</section>`;
const btn=(label,act,id,cls='')=>`<button class="btn sm ${cls}" data-act="${act}" data-id="${esc(id||'')}">${label}</button>`;
const STATUS_TONE={Expected:'info',Received:'warn',Open:'warn',Done:'good',New:'mute',Allocated:'info',Picking:'warn',Picked:'warn',Dispatched:'info',Delivered:'good',Cancelled:'mute',Available:'good',Hold:'warn',Damaged:'bad',Requested:'warn',Closed:'good',Completed:'good',Planned:'mute','Out for delivery':'info',Draft:'mute',Issued:'info',Paid:'good',Overdue:'bad',Posted:'good',Approved:'good',Declined:'mute'};
const pill=s=>`<span class="pill p-${STATUS_TONE[s]||'mute'}">${esc(s)}</span>`;
const clName=id=>esc(client(id).name);
const itemCell=sku=>`<span class="mono">${esc(sku)}</span><br><span class="note">${esc(item(sku).name)}</span>`;
function filterBar(key,opts){
  const f=filt[key]||{};
  return `<div class="filters">${opts.map(o=>{
    if(o.type==='text') return `<input data-filt="${key}.${o.id}" placeholder="${o.label}" value="${esc(f[o.id]||'')}" aria-label="${o.label}">`;
    return `<select data-filt="${key}.${o.id}" aria-label="${o.label}"><option value="">${o.label}: all</option>${o.options.map(([v,t])=>`<option value="${esc(v)}" ${f[o.id]===v?'selected':''}>${esc(t)}</option>`).join('')}</select>`;
  }).join('')}</div>`;
}
const activeClients=()=>S.clients.filter(c=>!c.archived);
const clientOpts=()=>activeClients().map(c=>[c.id,c.name]);
const isAdminNow=()=>AUTH.isAdmin(AUTH.get());
function adminOnly(){ if(!isAdminNow()) throw new Error('Only an Administrator can do this.'); }
const whOpts=()=>S.warehouses.map(w=>[w.id,w.name]);
const applyFilt=(key,rows,map)=>{ const f=filt[key]||{}; return rows.filter(r=>Object.entries(f).every(([k,v])=>!v||(map[k]?map[k](r,v):String(r[k])===v))); };
const palletsOf=w=>S.stock.filter(s=>s.wh===w).length;
const isLate=o=>['New','Allocated','Picking','Picked'].includes(o.status)&&o.due<today();
function invState(v){ return v.status==='Issued'&&v.due&&v.due<today()?'Overdue':v.status; }

/* ================= views ================= */
const V={};
V['home.dash']=()=>{
  const T=today();
  const pallets=S.stock.length, cap=sum(S.warehouses,w=>w.capacity);
  const dueToday=S.orders.filter(o=>o.due===addDays(T,1)||o.due===T);
  const shippedToday=S.orders.filter(o=>o.dispatchedAt===T).length;
  const closed=S.orders.filter(o=>o.dispatchedAt);
  const ontime=closed.filter(o=>o.dispatchedAt<=o.due).length;
  const alerts=buildAlerts();
  const days=[...Array(7)].map((_,i)=>addDays(T,i-6));
  const inU=days.map(d=>sum(S.moves.filter(m=>m.type==='Receipt'&&m.at===d),m=>m.qty));
  const outU=days.map(d=>-sum(S.moves.filter(m=>m.type==='Pick'&&m.at===d),m=>m.qty));
  const unbilled=sum(S.charges.filter(c=>!c.invoice),c=>c.amount);
  const overdue=sum(S.invoices.filter(v=>invState(v)==='Overdue'),v=>v.total-v.paid);
  const monthStart=T.slice(0,8)+'01';
  const monthCh=sum(S.charges.filter(c=>c.at>=monthStart),c=>c.amount);
  const queue=[
    ['ASNs expected',S.asns.filter(a=>a.status==='Expected').length,'Inbound','inbound.receive'],
    ['Putaway tasks open',S.tasks.filter(t=>t.status==='Open').length,'Inbound','inbound.putaway'],
    ['Orders to allocate',S.orders.filter(o=>o.status==='New').length,'Outbound','outbound.alloc'],
    ['Pick lists in progress',S.orders.filter(o=>['Allocated','Picking'].includes(o.status)).length,'Outbound','outbound.pick'],
    ['Ready to dispatch',S.orders.filter(o=>o.status==='Picked').length,'Outbound','outbound.dispatch'],
    ['Trips on the road',S.trips.filter(t=>t.status!=='Completed').length,'Transport','transport.trips'],
    ['Cycle counts open',S.counts.filter(c=>c.status==='Open').length,'Inventory','inventory.count'],
    ['Returns to inspect',S.returns.filter(r=>r.status==='Requested').length,'Returns','returns.list'],
    ['VAS work orders open',S.vas.filter(v=>v.status==='Open').length,'VAS','vas.list']].filter(r=>allowed(r[3].split('.')[0]));
  const kpi=(l,v,s,extra='')=>`<div class="card kpi"><span>${l}</span><b>${v}</b>${extra}<small>${s}</small></div>`;
  const max=Math.max(10,...inU,...outU); const step=Math.ceil(max/4/10)*10||10; const top=step*4;
  const X=i=>58+i*72, Y=v=>170-v/top*150;
  const chart=`<svg class="chart" viewBox="0 0 560 200" role="img" aria-label="Units received and shipped per day, last 7 days" style="width:100%;height:auto">
    ${[0,1,2,3,4].map(k=>`<line x1="44" x2="550" y1="${Y(k*step)}" y2="${Y(k*step)}" stroke="var(--line${k?'-2':''})"/><text x="38" y="${Y(k*step)+4}" text-anchor="end">${n0(k*step)}</text>`).join('')}
    ${days.map((d,i)=>`<rect x="${X(i)}" y="${Y(inU[i])}" width="24" height="${170-Y(inU[i])}" rx="2" fill="var(--accent)"><title>Received ${n0(inU[i])}</title></rect><rect x="${X(i)+26}" y="${Y(outU[i])}" width="24" height="${170-Y(outU[i])}" rx="2" fill="var(--accent-2)"><title>Shipped ${n0(outU[i])}</title></rect><text x="${X(i)+25}" y="190" text-anchor="middle">${new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short'})}</text>`).join('')}
  </svg>`;
  return page('Operations Dashboard',`${allowed('inbound')?'<button class="btn" data-act="newASN">+ New ASN</button>':''}${allowed('orders')?'<button class="btn pri" data-act="newOrder">+ Outbound order</button>':''}`,`
  ${setupCard()}
  <section class="grid g-kpi" aria-label="Key figures">
    ${kpi('Active clients',S.clients.length,`${S.items.length} SKUs under management`)}
    ${kpi('Pallets in stock',n0(pallets),`${n0(sum(S.stock,s=>s.qty))} units`)}
    ${kpi('Space utilisation',cap?Math.round(pallets/cap*100)+'%':'—',cap?`${pallets} of ${cap} pallet positions`:'No warehouses yet',`<div class="bar"><i style="width:${cap?Math.min(100,pallets/cap*100):0}%"></i></div>`)}
    ${kpi('Shipped today',shippedToday,`${dueToday.length} orders due today or tomorrow`)}
    ${kpi('On-time dispatch',closed.length?Math.round(ontime/closed.length*100)+'%':'—',`${ontime} of ${closed.length} orders by due date`)}
    ${allowed('billing')||allowed('finance')?kpi('Revenue this month',sar(monthCh),`SAR, ex VAT · ${sar(unbilled)} unbilled`):''}
  </section>
  <section class="grid g-2">
    ${card('Units received vs shipped · last 7 days',`<div class="card-b">${chart}</div>`,`<span class="note"><span style="display:inline-block;width:10px;height:10px;background:var(--accent);border-radius:2px"></span> Received &nbsp; <span style="display:inline-block;width:10px;height:10px;background:var(--accent-2);border-radius:2px"></span> Shipped</span>`)}
    ${card("Today's work queue",table([{h:'Task',v:r=>r[0]},{h:'Module',v:r=>`<span class="note">${r[2]}</span>`},{h:'Open',n:1,v:r=>`<b>${r[1]}</b>`},{h:'',v:r=>`<button class="btn sm" data-go="${r[3]}">Open</button>`}],queue))}
  </section>
  <section class="grid g-3">
    ${card('Alerts',alerts.length?alerts.map(a=>`<div class="alert">${pill(a.lvl)}<div><b>${esc(a.t)}</b><small>${esc(a.d)}</small></div></div>`).join(''):'<div class="empty">No alerts. Everything is within limits.</div>',`<span class="pill p-${alerts.some(a=>a.lvl==='High')?'bad':'mute'}">${alerts.length} open</span>`)}
    ${card('Warehouse occupancy',`<div class="card-b" style="display:flex;flex-direction:column;gap:12px">${S.warehouses.length?'':'<span class="note">No warehouses yet. Add one under Master Data → Warehouses.</span>'}${S.warehouses.map(w=>{const p=palletsOf(w.id),pc=w.capacity?Math.round(p/w.capacity*100):0;return `<div><div class="row" style="justify-content:space-between"><span>${esc(w.name)}</span><b class="num">${pc}%</b></div><div class="bar"><i style="width:${Math.min(100,pc)}%;background:${pc>90?'var(--bad)':pc>80?'var(--accent-2)':'var(--accent)'}"></i></div><span class="note">${p} of ${w.capacity} pallets</span></div>`;}).join('')}<span class="note">Red above 90%, amber above 80%.</span></div>`,`<button class="btn sm" data-go="space.avail">Space</button>`)}
    ${!allowed('billing')?'':card('Billing',`<div class="card-b" style="display:flex;flex-direction:column;gap:12px"><div class="dl"><div><span>Charges this month</span><b>${S.charges.filter(c=>c.at>=monthStart).length}</b></div><div><span>Invoices issued</span><b>${S.invoices.filter(v=>v.status!=='Draft').length}</b></div><div><span>Unbilled, SAR</span><b>${sar(unbilled)}</b></div><div><span>Overdue, SAR</span><b style="color:${overdue?'var(--bad)':'inherit'}">${sar(overdue)}</b></div></div>${mixBar()}<button class="btn sm pri" data-go="billing.run" style="align-self:flex-start">Run billing</button></div>`)}
  </section>
  ${card('Recent outbound orders',ordersTable(S.orders.slice().reverse().slice(0,6)),`<button class="btn sm" data-go="orders.all">All orders</button>`)}`,{tabs:false});
};
function setupCard(){
  const steps=[['Add a warehouse','Sites, type and pallet capacity',S.warehouses.length>0,'master.wh'],
    ['Add storage bins','Locations inside each warehouse',S.bins.some(b=>b.zone==='Storage'),'master.bins'],
    ['Add a client','Company, contact and contract rates',activeClients().length>0,'clients.list'],
    ['Add items','The products each client stores',S.items.length>0,'master.items']];
  if(steps.every(x=>x[2])) return '';
  return card('Get started',`<div class="card-b setup">${steps.map((x,i)=>`<div class="setup-step ${x[2]?'ok':''}"><span class="setup-n">${x[2]?'✓':i+1}</span><div><b>${x[0]}</b><small>${x[1]}</small></div>${x[2]?'<span class="note">Done</span>':allowed(x[3].split('.')[0])?`<button class="btn sm" data-go="${x[3]}">Open</button>`:''}</div>`).join('')}</div>`,`<span class="note">${steps.filter(x=>x[2]).length} of ${steps.length} done</span>`);
}
function mixBar(){
  const g={}; S.charges.forEach(c=>{ const k=c.type.startsWith('VAS')?'VAS':c.type==='Order fee'||c.type==='Handling out'||c.type==='Handling in'||c.type==='Returns handling'?'Handling':c.type; g[k]=(g[k]||0)+c.amount; });
  const tot=sum(Object.values(g))||1; const col={Storage:'var(--accent)',Handling:'var(--info)',Transport:'var(--accent-2)',VAS:'var(--faint)'};
  return `<div><div style="display:flex;height:10px;border-radius:5px;overflow:hidden">${Object.entries(g).map(([k,v])=>`<i style="width:${v/tot*100}%;background:${col[k]||'var(--muted)'}" title="${k}"></i>`).join('')}</div><div class="row note" style="margin-top:6px">${Object.entries(g).map(([k,v])=>`<span>${k} ${Math.round(v/tot*100)}%</span>`).join('')}</div></div>`;
}
function buildAlerts(){
  const out=[], T=today();
  S.zones.forEach(z=>{ const r=z.readings[z.readings.length-1]; if(r&&(r.v<z.min||r.v>z.max)) out.push({lvl:'High',t:`Temperature out of range · ${z.name}`,d:`${r.v}°C now, allowed ${z.min} to ${z.max}°C`}); });
  const near=S.stock.filter(s=>s.expiry&&daysBetween(T,s.expiry)<=30);
  const exp=near.filter(s=>s.expiry<T);
  if(exp.length) out.push({lvl:'High',t:`${exp.length} pallets past expiry`,d:'Move to QA-HOLD and notify clients'});
  if(near.length-exp.length) out.push({lvl:'Medium',t:`${near.length-exp.length} pallets expire within 30 days`,d:'Batch & expiry report lists them by client'});
  const late=S.orders.filter(isLate); if(late.length) out.push({lvl:'Medium',t:`${late.length} orders past due date`,d:late.map(o=>o.id).join(', ')});
  S.warehouses.forEach(w=>{ const pc=palletsOf(w.id)/w.capacity; if(pc>0.9) out.push({lvl:'Medium',t:`${w.name} is ${Math.round(pc*100)}% full`,d:'Plan overflow space or slow inbound'}); });
  const od=S.invoices.filter(v=>invState(v)==='Overdue'); if(od.length) out.push({lvl:'Medium',t:`${od.length} invoices overdue`,d:od.map(v=>v.id+' · '+client(v.client).name).join(', ')});
  const dr=S.invoices.filter(v=>v.status==='Draft'); if(dr.length) out.push({lvl:'Info',t:`${dr.length} draft invoices to review`,d:'Issue them to clear with ZATCA'});
  return out;
}
STATUS_TONE.High='bad'; STATUS_TONE.Medium='warn'; STATUS_TONE.Info='info';

/* --- clients --- */
V['clients.list']=()=>{ const adm=isAdminNow(), arch=S.clients.filter(c=>c.archived);
  return page('Clients',adm?`<button class="btn pri" data-act="newClient">+ New client</button>`:'',card(`${activeClients().length} clients`,table([
  {h:'Client',v:c=>`<b>${esc(c.name)}</b><br><span class="note">${c.id}</span>`},{h:'Industry',v:c=>esc(c.industry)},{h:'Contact',v:c=>esc(c.contact)},
  {h:'Pick rule',v:c=>esc(c.rule)},{h:'SKUs',n:1,v:c=>S.items.filter(i=>i.client===c.id).length},{h:'Pallets',n:1,v:c=>S.stock.filter(s=>s.client===c.id).length},
  {h:'Open orders',n:1,v:c=>S.orders.filter(o=>o.client===c.id&&!['Delivered','Cancelled','Dispatched'].includes(o.status)).length},
  {h:'Unbilled, SAR',n:1,v:c=>sar(sum(S.charges.filter(x=>x.client===c.id&&!x.invoice),x=>x.amount))},
  ...(adm?[{h:'',v:c=>`<div class="row">${btn('Edit','editClient',c.id)}${btn('Remove','removeClient',c.id,'danger')}</div>`}]:[])],activeClients(),{click:'client'}))
  +(arch.length?card(`${arch.length} archived`,table([{h:'Client',v:c=>`<b>${esc(c.name)}</b><br><span class="note">${c.id}</span>`},{h:'Industry',v:c=>esc(c.industry)},{h:'Archived',v:c=>fmtDate(c.archivedAt)},
    ...(adm?[{h:'',v:c=>btn('Restore','restoreClient',c.id)}]:[])],arch))+`<p class="note">Archived clients are hidden from lists and new records. Their orders, invoices and reports are kept.</p>`:'')); };
V['clients.rates']=()=>page('Rate cards','',card('Contract rates per client (SAR, ex VAT)',table([
  {h:'Client',v:c=>`<b>${esc(c.name)}</b>`},{h:'Storage / pallet / day',n:1,v:c=>sar(c.rates.storage)},{h:'Inbound / pallet',n:1,v:c=>sar(c.rates.inbound)},
  {h:'Outbound / pick line',n:1,v:c=>sar(c.rates.outbound)},{h:'Order fee',n:1,v:c=>sar(c.rates.order)},{h:'VAS / unit',n:1,v:c=>sar(c.rates.vas)},{h:'Transport / drop',n:1,v:c=>sar(c.rates.transport)},
  {h:'Terms',v:c=>c.terms+' days'},{h:'',v:c=>btn('Edit rates','editRates',c.id)}],activeClients()))+`<p class="note">Every warehouse event uses these rates to create a service charge automatically. Changing a rate affects new charges only.</p>`);
V['clients.portal']=()=>page('Client users','',card('Portal access',table([{h:'User',v:u=>esc(u.name)},{h:'Client',v:u=>clName(u.wh)},{h:'Can see',v:()=>'Own stock, orders, ASNs, invoices'}],S.users.filter(u=>u.role==='Client user')))+`<p class="note">The client portal (separate login where clients see stock and place orders) is planned as its own app. These records set who gets access.</p>`);

/* --- master --- */
const itemOnHand=i=>i.variant==='template'?sum(S.stock.filter(s=>item(s.sku).parent===i.sku),s=>s.qty):sum(S.stock.filter(s=>s.sku===i.sku),s=>s.qty);
V['master.items']=()=>{ const rows=applyFilt('items',S.items,{q:(r,v)=>(r.sku+r.name+(r.name2||'')+(r.code||'')).toLowerCase().includes(v.toLowerCase())});
  const typ=i=>i.variant==='template'?`<span class="pill p-info">Template · ${S.items.filter(x=>x.parent===i.sku).length} variants</span>`:i.variant==='variant'?`<span class="note">Variant · ${esc(i.attr.name)} ${esc(i.attr.value)}</span>`:i.kind==='Service'?'<span class="pill p-mute">Service</span>':'Single item';
  return page('Items',`<button class="btn pri" data-act="newItem">+ New item</button>`,filterBar('items',[{id:'client',label:'Client',options:clientOpts()},{id:'kind',label:'Type',options:[['Goods','Goods'],['Service','Service']]},{id:'group',label:'Item group',options:[...new Set(S.items.map(i=>i.group).filter(Boolean))].map(g=>[g,g])},{id:'temp',label:'Temperature',options:[['Ambient','Ambient'],['Chilled','Chilled'],['Frozen','Frozen']]},{id:'q',type:'text',label:'Search code, SKU or name'}])+card(`${rows.length} items`,table([
  {h:'Item code',v:i=>`<span class="mono">${esc(i.code)}</span>`},{h:'SKU',v:i=>`<span class="mono">${esc(i.sku)}</span>`},
  {h:'Name',v:i=>`${i.variant==='variant'?'<span class="note">↳ </span>':''}<b>${esc(i.name)}</b>${i.name2?`<br><span class="note" dir="rtl" lang="ar">${esc(i.name2)}</span>`:''}`},
  {h:'Client',v:i=>clName(i.client)},{h:'Item type',v:typ},{h:'Category',v:i=>esc(i.category)||'—'},{h:'Item group',v:i=>esc(i.group)||'—'},{h:'UOM',v:i=>esc(i.uom)},{h:'Temp',v:i=>esc(i.temp)},
  {h:'On hand',n:1,v:i=>i.kind==='Service'||(i.track===false&&i.variant!=='template')?'—':n0(itemOnHand(i))}],rows,{click:'item'}))); };

/* --- item form (from the hand-drawn layout: Item · Item details · Inventory) --- */
let itemEdit=null;
const UOMS=['Piece','Unit','Box','Carton','Pack','Bag','Kg','Litre','Pallet'];
const ITEM_GROUPS=['Food - dry','Food - chilled','Food - frozen','Electronics','Pharmaceutical','Apparel','General merchandise'];
const CATEGORIES=['Groceries','Dairy','Seafood','Appliances','Mobile phones','Medicines','Clothing','Accessories'];
const opt=(arr,sel)=>arr.map(a=>{ const [v,t]=Array.isArray(a)?a:[a,a]; return `<option value="${esc(v)}" ${String(sel)===String(v)?'selected':''}>${esc(t)}</option>`; }).join('');
const dlist=(id,vals)=>`<datalist id="${id}">${[...new Set(vals.filter(Boolean))].map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist>`;
const convRow=(c,base)=>`<div class="crow"><span>1</span><select aria-label="Larger unit"><option value="">Unit…</option>${opt(UOMS,c.uom)}</select><span>=</span><input type="number" min="0" step="any" aria-label="Number of base units" value="${esc(c.factor||'')}" placeholder="Qty"><span class="baseU note">${esc(base)}</span><button type="button" class="icon-btn" data-delrow="1" aria-label="Remove conversion">×</button></div>`;
V['master.itemform']=()=>{
  const it=itemEdit?S.items.find(i=>i.sku===itemEdit):null, ed=!!it;
  const e=it||{kind:'Goods',variant:'single',uom:'Carton',temp:'Ambient',track:true,valMethod:'FIFO',valDate:today(),series:'ITEM-.YYYY.-',conversions:[],batch:false,serial:false,expiry:false};
  const lock=ed?'disabled':'', isTpl=e.variant==='template';
  const vars=ed?S.items.filter(x=>x.parent===e.sku):[];
  const buttons=`<button class="btn" type="button" data-go="master.items">Cancel</button>${ed?'':'<button class="btn" type="submit" form="itemForm" data-and-new="1">Save & new</button>'}<button class="btn pri" type="submit" form="itemForm">${ed?'Save changes':'Save item'}</button>`;
  return `<div class="head"><div><div class="crumb">Master Data / Items / ${ed?'Edit':'New'}</div><h1>${ed?esc(e.name):'New item'}</h1></div><div class="actions">${buttons}</div></div>
  <form id="itemForm" novalidate style="display:flex;flex-direction:column;gap:14px">
  <div class="err" id="itErr" role="alert"></div>

  <section class="card"><div class="card-h"><h2>Item</h2><span class="note">Item code <b class="mono">${ed?esc(e.code):'assigned on save'}</b></span></div>
  <div class="card-b fgrid">
    <label class="field" for="it_series">Series<select id="it_series" name="series" ${lock}>${opt([['ITEM-.YYYY.-','ITEM-.YYYY.- (ITEM-2026-00001)'],['ITM-.#####','ITM-.##### (ITM-00001)']],e.series||'ITEM-.YYYY.-')}</select></label>
    <label class="field" for="it_client">Company name (client) *<select id="it_client" name="client" ${lock}><option value="">Choose…</option>${opt(clientOpts(),e.client)}</select></label>
    <div class="field"><span id="lbl_kind">Type</span><div class="seg" role="radiogroup" aria-labelledby="lbl_kind"><label><input type="radio" name="kind" value="Goods" ${e.kind!=='Service'?'checked':''} ${lock}>Goods</label><label><input type="radio" name="kind" value="Service" ${e.kind==='Service'?'checked':''} ${lock}>Service</label></div></div>
    <label class="field full" for="it_name">Primary name (English) *<input id="it_name" name="name" value="${esc(isTpl||!ed?e.name||'':e.name)}" placeholder="e.g. Basmati rice 5 kg" autocomplete="off"></label>
    <label class="field full" for="it_name2">Secondary name (Arabic)<input id="it_name2" name="name2" dir="rtl" lang="ar" value="${esc(e.name2||'')}" placeholder="مثال: أرز بسمتي ٥ كغ" autocomplete="off"></label>
    <label class="field" for="it_cat">Category<input id="it_cat" name="category" list="dl_cat" value="${esc(e.category||'')}" autocomplete="off"></label>
    <label class="field" for="it_mfr">Manufacturer<input id="it_mfr" name="manufacturer" list="dl_mfr" value="${esc(e.manufacturer||'')}" autocomplete="off"></label>
  </div></section>

  <section class="card"><div class="card-h"><h2>Item details</h2></div>
  <div class="card-b fgrid">
    <div class="field full"><span id="lbl_vt">Item type</span><div class="seg" role="radiogroup" aria-labelledby="lbl_vt"><label><input type="radio" name="vtype" value="single" ${!isTpl?'checked':''} ${lock}>Single item</label><label><input type="radio" name="vtype" value="variants" ${isTpl?'checked':''} ${lock}>Contains variants</label></div></div>
    <label class="field" for="it_uom">Unit of measure *<select id="it_uom" name="uom">${opt(UOMS,e.uom)}</select></label>
    <label class="field" for="it_sku">SKU *<input id="it_sku" name="sku" class="mono" value="${esc(e.sku||'')}" placeholder="e.g. RSF-RICE-5K" autocomplete="off" ${lock}></label>
    <label class="field" for="it_bc">Barcode<input id="it_bc" name="barcode" class="mono" value="${esc(e.barcode||'')}" autocomplete="off"></label>
    <label class="field" for="it_grp">Item group<input id="it_grp" name="group" list="dl_grp" value="${esc(e.group||'')}" autocomplete="off"></label>
    <label class="field" for="it_temp">Temperature class<select id="it_temp" name="temp">${opt(['Ambient','Chilled','Frozen'],e.temp)}</select></label>
    <div class="field full"><span>Unit conversion <span class="note">· how many base units each larger unit holds</span></span><div id="convRows" class="lines">${(e.conversions.length?e.conversions:[{}]).map(c=>convRow(c,e.uom)).join('')}</div><div><button type="button" class="btn sm" data-act="addConv">+ Add conversion</button></div></div>
    <div id="varBox" class="full subbox" ${isTpl?'':'hidden'}>
      ${ed?`<b style="font-size:13px">${vars.length} variants by ${esc(e.attrName||'attribute')}</b>${table([{h:'SKU',v:v=>`<span class="mono">${esc(v.sku)}</span>`},{h:esc(e.attrName||'Value'),v:v=>esc(v.attr.value)},{h:'Name',v:v=>esc(v.name)},{h:'On hand',n:1,v:v=>n0(itemOnHand(v))}],vars)}<span class="note">Changes here (except barcode) apply to every variant.</span>`
      :`<div class="fgrid"><label class="field" for="it_vattr">Variant attribute<input id="it_vattr" name="vattr" placeholder="Size, Colour, Flavour" autocomplete="off"></label><label class="field" for="it_vvals" style="grid-column:2/-1">Values, separated by commas<input id="it_vvals" name="vvals" placeholder="S, M, L, XL" autocomplete="off"></label></div><div id="varPrev"></div>`}
    </div>
  </div></section>

  <section class="card" id="invSec"><div class="card-h"><h2>Inventory</h2><label class="chk"><input type="checkbox" name="track" id="it_track" ${e.track!==false?'checked':''}>Track inventory for this item</label></div>
  <div class="card-b" id="invBody" style="display:flex;flex-direction:column;gap:14px">
    <div class="fgrid">
      ${ed?'':`<label class="field" for="it_open" id="singleOpen">Opening stock<input id="it_open" name="opening" type="number" min="0" step="any" placeholder="0"></label>`}
      <label class="field" for="it_vm">Inventory valuation method<select id="it_vm" name="valMethod">${opt([['FIFO','FIFO (first in, first out)'],['Moving average','Moving average']],e.valMethod)}</select></label>
      <label class="field" for="it_vd">Inventory valuation date<input id="it_vd" name="valDate" type="date" value="${esc(e.valDate||'')}"></label>
      <label class="field" for="it_vr">Valuation rate, SAR per unit<input id="it_vr" name="valRate" type="number" min="0" step="0.01" value="${esc(e.valRate||'')}" placeholder="0.00"></label>
      <label class="field" for="it_pk">Packing<input id="it_pk" name="packing" value="${esc(e.packing||'')}" placeholder="e.g. 12 × 1 L per carton" autocomplete="off"></label>
    </div>
    <div class="row" style="gap:6px 22px">
      <label class="chk"><input type="checkbox" name="batch" ${e.batch?'checked':''}>Has batch number</label>
      <label class="chk"><input type="checkbox" name="serial" ${e.serial?'checked':''}>Has serial number</label>
      <label class="chk"><input type="checkbox" name="expiry" ${e.expiry?'checked':''}>Has expiry date</label>
    </div>
    <div class="fgrid"><label class="field" for="it_shelf" id="shelfF">Shelf life, days<input id="it_shelf" name="shelf" type="number" min="1" value="${esc(e.shelf||'')}" placeholder="e.g. 365"></label></div>
    ${ed?'<p class="note" style="margin:0">Opening stock is entered once, when the item is created. Later stock comes in through Inbound or Inventory adjustments.</p>'
    :`<div class="subbox" id="openLoc" hidden><b style="font-size:13px">Opening stock details</b><div class="fgrid">
      <label class="field" for="it_owh">Warehouse *<select id="it_owh" name="owh"><option value="">Choose…</option>${opt(whOpts(),'')}</select></label>
      <label class="field" for="it_ob" id="openBatch">Batch number *<input id="it_ob" name="obatch" autocomplete="off"></label>
      <label class="field" for="it_oe" id="openExp">Expiry date *<input id="it_oe" name="oexp" type="date"></label>
    </div><span class="note">Opening stock goes to the suggested bin as available stock. It is not billed as an inbound receipt.</span></div>`}
  </div></section>
  <div class="form-foot">${buttons}</div>
  </form>
  ${dlist('dl_cat',[...CATEGORIES,...S.items.map(i=>i.category)])}${dlist('dl_mfr',S.items.map(i=>i.manufacturer))}${dlist('dl_grp',[...ITEM_GROUPS,...S.items.map(i=>i.group)])}`;
};
function renderVarPreview(){
  const fm=$('#itemForm'), box=$('#varPrev'); if(!fm||!box) return;
  const prev={}; box.querySelectorAll('[data-vopen]').forEach(i=>prev[i.dataset.vopen]=i.value);
  const base=(fm.querySelector('[name="sku"]').value.trim().toUpperCase())||'SKU', nm=fm.querySelector('[name="name"]').value.trim()||'Item';
  const vals=fm.querySelector('[name="vvals"]').value.split(',').map(s=>s.trim()).filter(Boolean);
  const track=fm.querySelector('[name="track"]').checked;
  box.innerHTML=vals.length?`<div class="tbl-wrap"><table><thead><tr><th>Value</th><th>SKU</th><th>Name</th>${track?'<th class="num">Opening stock</th>':''}</tr></thead><tbody>${vals.map(v=>`<tr><td>${esc(v)}</td><td class="mono">${esc(base+'-'+v.toUpperCase().replace(/[^A-Z0-9]+/g,''))}</td><td>${esc(nm+' - '+v)}</td>${track?`<td class="num"><input type="number" min="0" step="any" data-vopen="${esc(v)}" value="${esc(prev[v]||'')}" aria-label="Opening stock for ${esc(v)}" style="width:96px;height:32px;border:1px solid var(--line);border-radius:6px;padding:0 6px;background:var(--surface)"></td>`:''}</tr>`).join('')}</tbody></table></div>`
    :'<p class="note" style="margin:0">Enter values separated by commas to preview the variant SKUs.</p>';
}
function updateItemForm(target){
  const fm=$('#itemForm'); if(!fm) return;
  const q=n=>fm.querySelector(`[name="${n}"]`);
  const goods=fm.querySelector('[name="kind"]:checked').value==='Goods';
  const variants=fm.querySelector('[name="vtype"]:checked').value==='variants';
  const track=q('track').checked;
  $('#invSec').hidden=!goods; $('#invBody').hidden=!track; $('#varBox').hidden=!variants;
  const so=$('#singleOpen'); if(so) so.hidden=variants;
  $('#shelfF').hidden=!q('expiry').checked;
  fm.querySelectorAll('.baseU').forEach(s=>s.textContent=q('uom').value);
  const n=target&&target.name;
  if(variants&&(!target||['vvals','sku','name','track','vtype'].includes(n))) renderVarPreview();
  const ol=$('#openLoc');
  if(ol){ const qty=variants?sum([...fm.querySelectorAll('[data-vopen]')],i=>+i.value||0):(+q('opening').value||0);
    ol.hidden=!(goods&&track&&qty>0); $('#openBatch').hidden=!q('batch').checked; $('#openExp').hidden=!q('expiry').checked; }
}
function readItemForm(){
  const fm=$('#itemForm'); const g=n=>{ const el=fm.querySelector(`[name="${n}"]`); return !el?'':el.type==='checkbox'?el.checked:el.value.trim(); };
  const d={series:g('series'),client:g('client'),name:g('name'),name2:g('name2'),kind:fm.querySelector('[name="kind"]:checked').value,category:g('category'),manufacturer:g('manufacturer'),
    vtype:fm.querySelector('[name="vtype"]:checked').value,uom:g('uom'),sku:g('sku').toUpperCase(),barcode:g('barcode'),group:g('group'),temp:g('temp'),
    conversions:[...fm.querySelectorAll('.crow')].map(r=>({uom:r.querySelector('select').value,factor:+r.querySelector('input').value})).filter(c=>c.uom&&c.factor>0),
    track:g('track'),opening:+g('opening')||0,valMethod:g('valMethod'),valDate:g('valDate'),valRate:+g('valRate')||0,packing:g('packing'),
    batch:g('batch'),serial:g('serial'),expiry:g('expiry'),shelf:+g('shelf')||0,wh:g('owh'),obatch:g('obatch'),oexp:g('oexp'),
    vattr:g('vattr'),vals:String(g('vvals')).split(',').map(s=>s.trim()).filter(Boolean),vopen:[...fm.querySelectorAll('[data-vopen]')].map(i=>+i.value||0)};
  if(d.kind==='Service'){ d.track=false; d.vtype='single'; }
  return d;
}
V['master.wh']=()=>page('Warehouses',`<button class="btn pri" data-act="newWH">+ New warehouse</button>`,card('Sites',table([{h:'Code',v:w=>`<span class="mono">${w.id}</span>`},{h:'Name',v:w=>esc(w.name)},{h:'City',v:w=>esc(w.city)},{h:'Type',v:w=>esc(w.type)},{h:'Capacity, pallets',n:1,v:w=>w.capacity},{h:'In use',n:1,v:w=>palletsOf(w.id)},{h:'Bins',n:1,v:w=>S.bins.filter(b=>b.wh===w.id).length}],S.warehouses)));
V['master.bins']=()=>{ const rows=applyFilt('bins',S.bins,{});
  return page('Bins',`<button class="btn pri" data-act="newBin">+ New bin</button>`,filterBar('bins',[{id:'wh',label:'Warehouse',options:whOpts()},{id:'zone',label:'Zone',options:[...new Set(S.bins.map(b=>b.zone))].map(z=>[z,z])}])+card(`${rows.length} bins`,table([{h:'Bin',v:b=>`<span class="mono">${esc(b.code)}</span>`},{h:'Warehouse',v:b=>esc(wh(b.wh).name)},{h:'Zone',v:b=>esc(b.zone)},{h:'Temperature',v:b=>esc(b.temp)},{h:'Pallets',n:1,v:b=>S.stock.filter(s=>s.wh===b.wh&&s.bin===b.code).length+(b.cap<99?' / '+b.cap:'')}],rows))); };
V['master.fleet']=()=>page('Vehicles & drivers',`<button class="btn" data-act="newVehicle">+ Vehicle</button><button class="btn" data-act="newDriver">+ Driver</button>`,`<div class="grid g-2">${card('Vehicles',table([{h:'Code',v:v=>v.id},{h:'Plate',v:v=>esc(v.plate)},{h:'Type',v:v=>esc(v.type)},{h:'Pallets',n:1,v:v=>v.capacity}],S.vehicles))}${card('Drivers',table([{h:'Code',v:d=>d.id},{h:'Name',v:d=>esc(d.name)},{h:'Phone',v:d=>esc(d.phone)}],S.drivers))}</div>`);
V['master.reasons']=()=>page('Reason codes',`<button class="btn pri" data-act="newReason">+ Reason</button>`,card('Used for adjustments, damages and returns',table([{h:'Reason',v:r=>esc(r)}],S.reasons.map(r=>r))));

/* --- orders --- */
function ordersTable(rows,acts){
  return table([{h:'Order',v:o=>`<span class="mono">${o.id}</span>${o.ref?`<br><span class="note">${esc(o.ref)}</span>`:''}`},{h:'Client',v:o=>clName(o.client)},{h:'Customer',v:o=>esc(o.customer)},{h:'Warehouse',v:o=>esc(wh(o.wh).name)},
    {h:'Lines',n:1,v:o=>o.lines.length},{h:'Units',n:1,v:o=>n0(sum(o.lines,l=>l.qty))},{h:'Due',v:o=>`${fmtDate(o.due)}${isLate(o)?' <span class="pill p-bad">Late</span>':''}`},{h:'Status',v:o=>pill(o.status)+(sum(o.lines,l=>l.short)?' <span class="pill p-warn">Short</span>':'')},
    ...(acts?[{h:'',v:acts}]:[])],rows,{click:'order',empty:'No orders match.'});
}
V['orders.all']=()=>{ const rows=applyFilt('ord',S.orders.slice().reverse(),{q:(o,v)=>(o.id+o.customer+o.ref).toLowerCase().includes(v.toLowerCase())});
  return page('All orders',`<button class="btn pri" data-act="newOrder">+ Outbound order</button>`,filterBar('ord',[{id:'client',label:'Client',options:clientOpts()},{id:'status',label:'Status',options:['New','Allocated','Picking','Picked','Dispatched','Delivered','Cancelled'].map(s=>[s,s])},{id:'wh',label:'Warehouse',options:whOpts()},{id:'q',type:'text',label:'Search order or customer'}])+card(`${rows.length} orders`,ordersTable(rows))); };
V['orders.import']=()=>page('Import orders','',card('Paste order lines',`<div class="card-b" style="display:flex;flex-direction:column;gap:10px">
  <p class="note" style="margin:0">One line per order line: <span class="mono">client_id, warehouse_id, customer, due_date, sku, qty</span>. Lines with the same client, warehouse, customer and due date become one order.</p>
  <label class="field" for="imp">Order lines<textarea id="imp" rows="7" class="mono">CL-001, WH-JED-01, Panda Hypermarket #112, ${addDays(today(),2)}, RSF-RICE-5K, 10
CL-001, WH-JED-01, Panda Hypermarket #112, ${addDays(today(),2)}, RSF-OIL-1L, 6
CL-004, WH-JED-01, Online customer, ${addDays(today(),1)}, SQS-SHL-01, 4</textarea></label>
  <div><button class="btn pri" data-act="importOrders">Create orders</button></div><div id="impMsg"></div></div>`));
V['orders.back']=()=>{ const rows=S.orders.filter(o=>sum(o.lines,l=>l.short)>0&&!['Cancelled'].includes(o.status));
  return page('Backorders','',card('Orders with lines that could not be fully allocated',table([{h:'Order',v:o=>`<span class="mono">${o.id}</span>`},{h:'Client',v:o=>clName(o.client)},{h:'Short lines',v:o=>o.lines.filter(l=>l.short).map(l=>`${esc(l.sku)}: ${l.short} short`).join('<br>')},{h:'Status',v:o=>pill(o.status)}],rows,{click:'order',empty:'No backorders. Every allocated order was filled in full.'}))); };

/* --- inbound --- */
V['inbound.asn']=()=>{ const rows=applyFilt('asn',S.asns.slice().reverse(),{});
  return page('Advance shipping notices',`<button class="btn pri" data-act="newASN">+ New ASN</button>`,filterBar('asn',[{id:'client',label:'Client',options:clientOpts()},{id:'status',label:'Status',options:[['Expected','Expected'],['Received','Received']]},{id:'wh',label:'Warehouse',options:whOpts()}])+card(`${rows.length} ASNs`,table([
  {h:'ASN',v:a=>`<span class="mono">${a.id}</span>`},{h:'Client',v:a=>clName(a.client)},{h:'Supplier ref',v:a=>esc(a.ref)},{h:'Warehouse',v:a=>esc(wh(a.wh).name)},{h:'ETA',v:a=>fmtDate(a.eta)},{h:'Lines',n:1,v:a=>a.lines.length},{h:'Units',n:1,v:a=>n0(sum(a.lines,l=>l.qty))},{h:'Status',v:a=>pill(a.status)},
  {h:'',v:a=>a.status==='Expected'?btn('Receive','receive',a.id,'pri'):''}],rows,{click:'asn'}))); };
V['inbound.dock']=()=>{ const rows=S.asns.filter(a=>a.status==='Expected').sort((a,b)=>(a.eta+a.slot).localeCompare(b.eta+b.slot));
  return page('Dock appointments','',card('Upcoming deliveries',table([{h:'Date',v:a=>fmtDate(a.eta)},{h:'Time',v:a=>a.slot||'<span class="note">Not booked</span>'},{h:'Dock',v:a=>esc(a.dock)||'—'},{h:'ASN',v:a=>`<span class="mono">${a.id}</span>`},{h:'Client',v:a=>clName(a.client)},{h:'Warehouse',v:a=>esc(wh(a.wh).name)},{h:'Pallets',n:1,v:a=>a.lines.length},{h:'',v:a=>btn('Book slot','slot',a.id)}],rows,{empty:'No deliveries expected.'}))); };
V['inbound.receive']=()=>{ const rows=S.asns.filter(a=>a.status==='Expected');
  return page('Receiving','',card('Expected receipts',table([{h:'ASN',v:a=>`<span class="mono">${a.id}</span>`},{h:'Client',v:a=>clName(a.client)},{h:'Warehouse',v:a=>esc(wh(a.wh).name)},{h:'ETA',v:a=>fmtDate(a.eta)+(a.slot?' · '+a.slot:'')},{h:'Lines',v:a=>a.lines.map(l=>`${esc(l.sku)} × ${l.qty}`).join('<br>')},{h:'',v:a=>btn('Receive & create GRN','receive',a.id,'pri')}],rows,{empty:'Nothing waiting to be received.'}))+`<p class="note">Receiving creates one pallet (LPN) per line, logs any over or short quantity on the GRN, opens a putaway task, and charges inbound handling.</p>`); };
V['inbound.grn']=()=>page('Goods receipt notes','',card(`${S.grns.length} GRNs`,table([{h:'GRN',v:g=>`<span class="mono">${g.id}</span>`},{h:'ASN',v:g=>`<span class="mono">${g.asn}</span>`},{h:'Client',v:g=>clName(g.client)},{h:'Date',v:g=>fmtDate(g.at)},{h:'Pallets',n:1,v:g=>g.lines.length},{h:'Units',n:1,v:g=>n0(sum(g.lines,l=>l.received))},{h:'Variance',v:g=>{const d=sum(g.lines,l=>l.diff);return d?`<span class="pill p-warn">${d>0?'+':''}${d}</span>`:'<span class="pill p-good">None</span>';}}],S.grns.slice().reverse(),{click:'grn'})));
V['inbound.putaway']=()=>{ const open=S.tasks.filter(t=>t.status==='Open');
  return page('Putaway tasks',open.length?`<button class="btn pri" data-act="putAll">Confirm all suggested bins</button>`:'',card(`${open.length} open`,table([{h:'Task',v:t=>`<span class="mono">${t.id}</span>`},{h:'LPN',v:t=>`<span class="mono">${t.lpn}</span>`},{h:'Item',v:t=>{const s=S.stock.find(x=>x.lpn===t.lpn);return s?itemCell(s.sku):'—';}},{h:'Qty',n:1,v:t=>{const s=S.stock.find(x=>x.lpn===t.lpn);return s?n0(s.qty):'—';}},{h:'Warehouse',v:t=>esc(wh(t.wh).name)},{h:'Suggested bin',v:t=>`<span class="mono">${esc(t.to)}</span>`},{h:'',v:t=>btn('Confirm','put',t.id,'pri')+' '+btn('Other bin','putOther',t.id)}],open,{empty:'All received pallets are put away.'}))+card('Recently completed',table([{h:'Task',v:t=>`<span class="mono">${t.id}</span>`},{h:'LPN',v:t=>`<span class="mono">${t.lpn}</span>`},{h:'Bin',v:t=>`<span class="mono">${esc(t.to)}</span>`},{h:'Done',v:t=>fmtDate(t.done)},{h:'By',v:t=>esc(t.by)}],S.tasks.filter(t=>t.status==='Done').slice(-8).reverse()))); };

/* --- inventory --- */
function stockTable(rows,withActs=true){
  return table([{h:'LPN',v:s=>`<span class="mono">${s.lpn}</span>`},{h:'Item',v:s=>itemCell(s.sku)},{h:'Client',v:s=>clName(s.client)},{h:'Warehouse · bin',v:s=>`${esc(wh(s.wh).name)}<br><span class="mono">${esc(s.bin)}</span>`},
    {h:'Batch',v:s=>esc(s.batch)||'—'},{h:'Expiry',v:s=>s.expiry?`${fmtDate(s.expiry)}${daysBetween(today(),s.expiry)<=30?` <span class="pill p-${s.expiry<today()?'bad':'warn'}">${daysBetween(today(),s.expiry)}d</span>`:''}`:'—'},
    {h:'Qty',n:1,v:s=>n0(s.qty)},{h:'Allocated',n:1,v:s=>s.alloc?n0(s.alloc):'—'},{h:'Status',v:s=>pill(s.status)},
    ...(withActs?[{h:'',v:s=>`<div class="row">${btn('Adjust','adjust',s.lpn)}${s.status==='Available'?btn('Hold','hold',s.lpn):s.status!=='Received'?btn('Release','release',s.lpn):''}${btn('Move','transfer',s.lpn)}</div>`}]:[])],rows,{empty:'No stock matches.'});
}
V['inventory.stock']=()=>{ const rows=applyFilt('stk',S.stock,{q:(s,v)=>(s.lpn+s.sku+s.batch+item(s.sku).name).toLowerCase().includes(v.toLowerCase())});
  return page('Stock',`<button class="btn" data-act="copyCSV" data-id="stock">Copy as CSV</button>`,filterBar('stk',[{id:'client',label:'Client',options:clientOpts()},{id:'wh',label:'Warehouse',options:whOpts()},{id:'status',label:'Status',options:['Received','Available','Hold','Damaged'].map(s=>[s,s])},{id:'q',type:'text',label:'Search LPN, SKU, batch'}])+
  `<div class="grid g-kpi">${[['Pallets',rows.length],['Units',n0(sum(rows,s=>s.qty))],['Allocated units',n0(sum(rows,s=>s.alloc))],['On hold or damaged',rows.filter(s=>['Hold','Damaged'].includes(s.status)).length]].map(k=>`<div class="card kpi"><span>${k[0]}</span><b>${k[1]}</b></div>`).join('')}</div>`+card(`${rows.length} pallets`,stockTable(rows))); };
V['inventory.transfer']=()=>{ const rows=S.moves.filter(m=>m.type==='Transfer').slice().reverse();
  return page('Transfers',`<button class="btn pri" data-act="transfer">+ Move a pallet</button>`,card('Bin-to-bin moves',table([{h:'Date',v:m=>fmtDate(m.at)},{h:'LPN',v:m=>`<span class="mono">${m.lpn}</span>`},{h:'Item',v:m=>itemCell(m.sku)},{h:'Move',v:m=>`<span class="mono">${esc(m.ref)}</span>`},{h:'Warehouse',v:m=>esc(wh(m.wh).name)}],rows,{empty:'No transfers yet. Use "Move a pallet" or the Move button on the Stock page.'}))); };
V['inventory.count']=()=>page('Cycle counts',`<button class="btn pri" data-act="newCount">+ New count</button>`,card('Counts',table([{h:'Count',v:c=>`<span class="mono">${c.id}</span>`},{h:'Warehouse',v:c=>esc(wh(c.wh).name)},{h:'Bin',v:c=>`<span class="mono">${esc(c.bin)}</span>`},{h:'Pallets',n:1,v:c=>c.lines.length},{h:'Created',v:c=>fmtDate(c.created)},{h:'Variance',n:1,v:c=>c.status==='Posted'?sum(c.lines,l=>l.counted-l.expected):'—'},{h:'Status',v:c=>pill(c.status)},{h:'',v:c=>c.status==='Open'?btn('Enter counts','doCount',c.id,'pri'):''}],S.counts.slice().reverse())));
V['inventory.ledger']=()=>{ const rows=applyFilt('led',S.moves.slice().reverse(),{q:(m,v)=>((m.lpn||'')+(m.sku||'')+(m.ref||'')).toLowerCase().includes(v.toLowerCase())}).slice(0,300);
  return page('Stock ledger','',filterBar('led',[{id:'client',label:'Client',options:clientOpts()},{id:'type',label:'Type',options:[...new Set(S.moves.map(m=>m.type))].map(t=>[t,t])},{id:'q',type:'text',label:'Search LPN, SKU, reference'}])+card('Every stock movement, newest first (300 max)',table([{h:'Date',v:m=>fmtDate(m.at)},{h:'Type',v:m=>esc(m.type)},{h:'Reference',v:m=>`<span class="mono">${esc(m.ref)}</span>`},{h:'LPN',v:m=>`<span class="mono">${m.lpn||''}</span>`},{h:'Item',v:m=>itemCell(m.sku)},{h:'Client',v:m=>clName(m.client)},{h:'Bin',v:m=>`<span class="mono">${esc(m.bin)}</span>`},{h:'Qty',n:1,v:m=>m.qty?`<b style="color:${m.qty>0?'var(--good)':'var(--bad)'}">${m.qty>0?'+':''}${n0(m.qty)}</b>`:'—'}],rows))); };
V['inventory.expiry']=()=>{ const rows=S.stock.filter(s=>s.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry));
  return page('Batch & expiry',`<button class="btn" data-act="copyCSV" data-id="expiry">Copy as CSV</button>`,card('Pallets by expiry date, soonest first',stockTable(rows,false))); };

/* --- outbound --- */
V['outbound.alloc']=()=>{ const rows=S.orders.filter(o=>o.status==='New');
  return page('Allocation',`<button class="btn pri" data-act="newOrder">+ Outbound order</button>${rows.length?`<button class="btn" data-act="allocAll">Allocate all</button>`:''}`,card(`${rows.length} orders waiting`,ordersTable(rows,o=>btn('Allocate','alloc',o.id,'pri')+' '+btn('Cancel','cancelOrder',o.id,'danger')))+`<p class="note">Allocation reserves pallets using each client's pick rule (FEFO: earliest expiry first; FIFO: earliest received first).</p>`); };
V['outbound.pick']=()=>{ const rows=S.orders.filter(o=>['Allocated','Picking'].includes(o.status));
  return page('Pick lists','',card(`${rows.length} orders`,table([{h:'Order',v:o=>`<span class="mono">${o.id}</span>`},{h:'Pick list',v:o=>o.pick?`<span class="mono">${o.pick}</span>`:'—'},{h:'Client',v:o=>clName(o.client)},{h:'Picks (bin → LPN × qty)',v:o=>o.lines.flatMap(l=>l.picks.map(p=>`<span class="mono">${esc(p.bin)}</span> → ${p.lpn} × ${p.qty} <span class="note">${esc(l.sku)}</span>`)).join('<br>')},{h:'Status',v:o=>pill(o.status)},{h:'',v:o=>o.status==='Allocated'?btn('Release pick list','release',o.id,'pri')+' '+btn('Cancel','cancelOrder',o.id,'danger'):btn('Confirm picked','confirmPick',o.id,'pri')}],rows,{click:'order',empty:'No orders to pick. Allocate new orders first.'}))); };
V['outbound.dispatch']=()=>{ const rows=S.orders.filter(o=>o.status==='Picked');
  return page('Packing & dispatch','',card(`${rows.length} orders packed and staged`,ordersTable(rows,o=>btn('Dispatch','dispatch',o.id,'pri')+' '+btn('Book courier','ship',o.id)))+`<p class="note">Dispatch creates the delivery note and charges the order fee and outbound handling.</p>`); };
V['outbound.pod']=()=>{ const rows=S.orders.filter(o=>['Dispatched','Delivered'].includes(o.status)).slice().reverse();
  return page('Delivery notes & POD','',card('Shipped orders',table([{h:'Delivery note',v:o=>`<span class="mono">${o.dn}</span>`},{h:'Order',v:o=>`<span class="mono">${o.id}</span>`},{h:'Client',v:o=>clName(o.client)},{h:'Customer',v:o=>esc(o.customer)},{h:'Dispatched',v:o=>fmtDate(o.dispatchedAt)},{h:'Trip / AWB',v:o=>esc(o.trip||o.awb||'—')},{h:'POD',v:o=>o.status==='Delivered'?`${fmtDate(o.deliveredAt)} · ${esc(o.pod)}`:btn('Record POD','pod',o.id,'pri')},{h:'Status',v:o=>pill(o.status)}],rows,{click:'order'}))); };

/* --- returns, vas, cold, labour, space --- */
V['returns.list']=()=>page('Returns',`<button class="btn pri" data-act="newReturn">+ New return</button>`,card('Return authorisations',table([{h:'RMA',v:r=>`<span class="mono">${r.id}</span>`},{h:'Order',v:r=>`<span class="mono">${r.order}</span>`},{h:'Client',v:r=>clName(r.client)},{h:'Items',v:r=>r.lines.map(l=>`${esc(l.sku)} × ${l.qty}${l.result?' → '+l.result:''}`).join('<br>')},{h:'Reason',v:r=>esc(r.reason)},{h:'Created',v:r=>fmtDate(r.created)},{h:'Status',v:r=>pill(r.status)},{h:'',v:r=>r.status==='Requested'?btn('Restock','inspect',r.id+'|Restock','pri')+' '+btn('Damaged','inspect',r.id+'|Damaged')+' '+btn('Dispose','inspect',r.id+'|Dispose','danger'):''}],S.returns.slice().reverse())));
V['vas.list']=()=>page('Value-added services',`<button class="btn pri" data-act="newVAS">+ Work order</button>`,card('Work orders',table([{h:'Work order',v:v=>`<span class="mono">${v.id}</span>`},{h:'Client',v:v=>clName(v.client)},{h:'Service',v:v=>esc(v.type)},{h:'Item',v:v=>itemCell(v.sku)},{h:'Units',n:1,v:v=>n0(v.qty)},{h:'Due',v:v=>fmtDate(v.due)},{h:'Charge, SAR',n:1,v:v=>sar(v.qty*client(v.client).rates.vas)},{h:'Status',v:v=>pill(v.status)},{h:'',v:v=>v.status==='Open'?btn('Complete','vasDone',v.id,'pri'):''}],S.vas.slice().reverse())));
V['cold.zones']=()=>page('Temperature zones',`<button class="btn pri" data-act="newZone">+ Zone</button>`,`${S.zones.length?'':'<div class="card empty">No temperature zones yet. Add one for each chilled, frozen or ambient room you monitor.</div>'}<div class="grid g-3">${S.zones.map(z=>{
  const r=z.readings, last=r[r.length-1], bad=last&&(last.v<z.min||last.v>z.max);
  const lo=Math.min(z.min-2,...r.map(x=>x.v)), hi=Math.max(z.max+2,...r.map(x=>x.v)), Y=v=>90-(v-lo)/(hi-lo)*80, X=i=>i/(Math.max(1,r.length-1))*300;
  return card(esc(z.name),`<div class="card-b" style="display:flex;flex-direction:column;gap:10px"><div class="row" style="justify-content:space-between"><b style="font-size:26px;color:${bad?'var(--bad)':'var(--fg)'}">${last?last.v:'—'}°C</b><span class="note">Allowed ${z.min} to ${z.max}°C<br>${esc(wh(z.wh).name)}</span></div>
  <svg class="chart" viewBox="0 0 300 100" role="img" aria-label="Last 24 readings" style="width:100%;height:auto"><rect x="0" y="${Y(z.max)}" width="300" height="${Y(z.min)-Y(z.max)}" fill="var(--good-soft)"/><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${r.map((x,i)=>X(i)+','+Y(x.v)).join(' ')}"/>${last?`<circle cx="${X(r.length-1)}" cy="${Y(last.v)}" r="4" fill="${bad?'var(--bad)':'var(--accent)'}"/>`:''}</svg>
  <span class="note">Green band = allowed range. ${r.length} readings, latest ${last?new Date(last.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'—'}.</span><div>${btn('Log reading','reading',z.id)}</div></div>`,bad?pill('High'):'<span class="pill p-good">In range</span>');}).join('')}</div><p class="note">Readings here are entered by hand. In production, sensors or data loggers would post them automatically.</p>`);
V['labour.tasks']=()=>{ const rows=[...S.tasks.filter(t=>t.status==='Open').map(t=>({id:t.id,type:'Putaway',wh:t.wh,detail:t.lpn+' → '+t.to,go:'inbound.putaway'})),
  ...S.orders.filter(o=>o.status==='Picking').map(o=>({id:o.pick,type:'Pick',wh:o.wh,detail:o.id+' · '+sum(o.lines,l=>l.picks.length)+' picks',go:'outbound.pick'})),
  ...S.orders.filter(o=>o.status==='Picked').map(o=>({id:o.id,type:'Pack & dispatch',wh:o.wh,detail:o.customer,go:'outbound.dispatch'})),
  ...S.counts.filter(c=>c.status==='Open').map(c=>({id:c.id,type:'Cycle count',wh:c.wh,detail:'Bin '+c.bin,go:'inventory.count'})),
  ...S.vas.filter(v=>v.status==='Open').map(v=>({id:v.id,type:'VAS',wh:'',detail:v.type+' × '+v.qty,go:'vas.list'}))];
  return page('Task board','',card(`${rows.length} open tasks across modules`,table([{h:'Task',v:r=>`<span class="mono">${esc(r.id)}</span>`},{h:'Type',v:r=>esc(r.type)},{h:'Warehouse',v:r=>esc(wh(r.wh).name||'—')},{h:'Detail',v:r=>esc(r.detail)},{h:'',v:r=>`<button class="btn sm" data-go="${r.go}">Open</button>`}],rows,{empty:'No open tasks.'}))); };
V['labour.prod']=()=>{ const by={}; S.tasks.filter(t=>t.by).forEach(t=>{(by[t.by]=by[t.by]||{put:0,pick:0}).put++;}); S.orders.filter(o=>o.pickedBy).forEach(o=>{(by[o.pickedBy]=by[o.pickedBy]||{put:0,pick:0}).pick+=sum(o.lines,l=>l.picks.length);});
  const rows=Object.entries(by).map(([n,v])=>({id:n,...v}));
  return page('Productivity','',card('Completed work by person (all time)',table([{h:'Person',v:r=>esc(r.id)},{h:'Putaways',n:1,v:r=>r.put},{h:'Pick lines',n:1,v:r=>r.pick},{h:'Total tasks',n:1,v:r=>r.put+r.pick}],rows))); };
V['space.avail']=()=>page('Space availability',`<button class="btn pri" data-act="newBooking">+ Space request</button>`,card('Free pallet positions by site',table([{h:'Site',v:s=>esc(wh(s.wh).name)},{h:'Type',v:s=>esc(s.type)},{h:'City',v:s=>esc(s.city)},{h:'Capacity',n:1,v:s=>wh(s.wh).capacity},{h:'In use',n:1,v:s=>palletsOf(s.wh)},{h:'Reserved',n:1,v:s=>sum(S.bookings.filter(b=>b.status==='Approved'&&b.type===s.type),b=>b.pallets)},{h:'Free',n:1,v:s=>`<b>${Math.max(0,wh(s.wh).capacity-palletsOf(s.wh))}</b>`},{h:'List rate / pallet / day',n:1,v:s=>sar(s.rate)}],S.spaces)));
V['space.book']=()=>page('Space bookings',`<button class="btn pri" data-act="newBooking">+ Space request</button>`,card('Requests from new or existing customers',table([{h:'Request',v:b=>`<span class="mono">${b.id}</span>`},{h:'Company',v:b=>esc(b.company)},{h:'Type',v:b=>esc(b.type)},{h:'Pallets',n:1,v:b=>b.pallets},{h:'From',v:b=>fmtDate(b.from)},{h:'Months',n:1,v:b=>b.months},{h:'Est. monthly, SAR',n:1,v:b=>sar(b.pallets*30*((S.spaces.find(s=>s.type===b.type)||{rate:0}).rate))},{h:'Status',v:b=>pill(b.status)},{h:'',v:b=>b.status==='Requested'?btn('Approve','bookOK',b.id,'pri')+' '+btn('Decline','bookNo',b.id):''}],S.bookings.slice().reverse())));

/* --- transport, shipping --- */
V['transport.trips']=()=>page('Trips',`<button class="btn pri" data-act="newTrip">+ Plan trip</button>`,card('Delivery trips',table([{h:'Trip',v:t=>`<span class="mono">${t.id}</span>`},{h:'Date',v:t=>fmtDate(t.date)},{h:'Vehicle',v:t=>esc((S.vehicles.find(v=>v.id===t.vehicle)||{}).type||t.vehicle)},{h:'Driver',v:t=>esc((S.drivers.find(d=>d.id===t.driver)||{}).name||t.driver)},{h:'Drops',v:t=>t.orders.map(id=>{const o=S.orders.find(x=>x.id===id);return `${id} · ${esc(o?o.customer:'')}`;}).join('<br>')},{h:'Status',v:t=>pill(t.status)},{h:'',v:t=>t.status==='Planned'?btn('Start','tripGo',t.id,'pri'):t.status==='Out for delivery'?btn('Complete & POD','tripDone',t.id,'pri'):''}],S.trips.slice().reverse()))+`<p class="note">Completing a trip records proof of delivery for each drop and charges transport per drop.</p>`);
V['shipping.ship']=()=>{ const rows=S.orders.filter(o=>o.awb||o.status==='Picked').slice().reverse();
  return page('Courier shipments','',card('Parcel shipments',table([{h:'Order',v:o=>`<span class="mono">${o.id}</span>`},{h:'Client',v:o=>clName(o.client)},{h:'Customer',v:o=>esc(o.customer)},{h:'Courier',v:o=>esc(o.courier||'—')},{h:'AWB',v:o=>o.awb?`<span class="mono">${o.awb}</span> <span class="sim">SIMULATED</span>`:'—'},{h:'Status',v:o=>pill(o.status)},{h:'',v:o=>!o.awb?btn('Book courier','ship',o.id,'pri'):''}],rows,{empty:'Picked orders appear here for courier booking.'}))+`<p class="note">Courier connections (SMSA, Aramex, SPL) are simulated in this prototype; AWB numbers are not real.</p>`); };

/* --- billing --- */
V['billing.charges']=()=>{ const rows=applyFilt('chg',S.charges.slice().reverse(),{billed:(c,v)=>v==='no'?!c.invoice:!!c.invoice}).slice(0,400);
  return page('Service charges',`<button class="btn" data-act="newCharge">+ Manual charge</button>`,filterBar('chg',[{id:'client',label:'Client',options:clientOpts()},{id:'type',label:'Type',options:[...new Set(S.charges.map(c=>c.type))].map(t=>[t,t])},{id:'billed',label:'Billed',options:[['no','Unbilled'],['yes','Billed']]}])+card(`${rows.length} charges · SAR ${sar(sum(rows,c=>c.amount))}`,table([{h:'Date',v:c=>fmtDate(c.at)},{h:'Client',v:c=>clName(c.client)},{h:'Type',v:c=>esc(c.type)},{h:'Source',v:c=>`<span class="mono">${esc(c.ref)}</span>`},{h:'Qty',n:1,v:c=>n0(c.qty)+' <span class="note">'+esc(c.note)+'</span>'},{h:'Rate',n:1,v:c=>sar(c.rate)},{h:'Amount',n:1,v:c=>sar(c.amount)},{h:'Invoice',v:c=>c.invoice?`<span class="mono">${c.invoice}</span>`:'<span class="pill p-warn">Unbilled</span>'}],rows))); };
V['billing.storage']=()=>{ const done=S.charges.some(c=>c.type==='Storage'&&c.at===today());
  const rows=S.clients.map(c=>({id:c.id,p:S.stock.filter(s=>s.client===c.id).length,r:c.rates.storage}));
  return page('Storage capture',`<button class="btn pri" data-act="captureStorage" ${done?'disabled':''}>${done?'Captured for today':"Capture today's storage"}</button>`,card("Today's pallet snapshot",table([{h:'Client',v:r=>clName(r.id)},{h:'Pallets now',n:1,v:r=>r.p},{h:'Rate / pallet / day',n:1,v:r=>sar(r.r)},{h:'Charge, SAR',n:1,v:r=>sar(r.p*r.r)}],rows))+`<p class="note">Run this once a day (in production it runs automatically at midnight). Each run charges every client for the pallets they hold that day.</p>`+card('Past snapshots',table([{h:'Date',v:r=>fmtDate(r.d)},{h:'Pallet-days',n:1,v:r=>n0(r.q)},{h:'Amount, SAR',n:1,v:r=>sar(r.a)}],Object.values(S.charges.filter(c=>c.type==='Storage').reduce((g,c)=>{(g[c.at]=g[c.at]||{d:c.at,q:0,a:0});g[c.at].q+=c.qty;g[c.at].a+=c.amount;return g;},{})).reverse().slice(0,14)))); };
V['billing.run']=()=>{ const rows=S.clients.map(c=>{const ch=S.charges.filter(x=>x.client===c.id&&!x.invoice);return {id:c.id,n:ch.length,a:sum(ch,x=>x.amount),from:ch.map(x=>x.at).sort()[0]};});
  return page('Billing run','',card('Unbilled charges by client',table([{h:'Client',v:r=>clName(r.id)},{h:'Charges',n:1,v:r=>r.n},{h:'Since',v:r=>fmtDate(r.from)},{h:'Subtotal, SAR',n:1,v:r=>sar(r.a)},{h:'VAT 15%',n:1,v:r=>sar(r.a*VAT)},{h:'Total, SAR',n:1,v:r=>`<b>${sar(r.a*(1+VAT))}</b>`},{h:'',v:r=>r.n?btn('Create draft invoice','bill',r.id,'pri'):''}],rows))+card('Draft invoices',invTable(S.invoices.filter(v=>v.status==='Draft')))); };

/* --- finance --- */
function invTable(rows){ return table([{h:'Invoice',v:v=>`<span class="mono">${v.id}</span>`},{h:'Client',v:v=>clName(v.client)},{h:'Period',v:v=>`${fmtDate(v.from)} – ${fmtDate(v.to)}`},{h:'Total, SAR',n:1,v:v=>sar(v.total)},{h:'Balance',n:1,v:v=>sar(v.total-v.paid)},{h:'Due',v:v=>fmtDate(v.due)},{h:'ZATCA',v:v=>v.zatca==='Not submitted'?'<span class="note">Not submitted</span>':`<span class="pill p-good">Cleared</span> <span class="sim">SIMULATED</span>`},{h:'Status',v:v=>pill(invState(v))}],rows,{click:'invoice',empty:'No invoices.'}); }
V['finance.inv']=()=>{ const rows=applyFilt('inv',S.invoices.slice().reverse(),{status:(v,s)=>invState(v)===s}); return page('Invoices','',filterBar('inv',[{id:'client',label:'Client',options:clientOpts()},{id:'status',label:'Status',options:['Draft','Issued','Overdue','Paid'].map(s=>[s,s])}])+card(`${rows.length} invoices`,invTable(rows))); };
V['finance.pay']=()=>page('Payments','',card('Receipts',table([{h:'Receipt',v:p=>`<span class="mono">${p.id}</span>`},{h:'Date',v:p=>fmtDate(p.at)},{h:'Client',v:p=>clName(p.client)},{h:'Invoice',v:p=>`<span class="mono">${p.invoice}</span>`},{h:'Method',v:p=>esc(p.method)},{h:'Amount, SAR',n:1,v:p=>sar(p.amount)}],S.payments.slice().reverse()))+card('Open invoices',invTable(S.invoices.filter(v=>['Issued'].includes(v.status)))));
V['finance.zatca']=()=>page('ZATCA log','',`<p class="note" style="margin:0"><span class="sim">SIMULATED</span> This prototype imitates Phase 2 clearance. Production needs onboarding with ZATCA (CSID), signed UBL XML and the Fatoora API.</p>`+card('E-invoice submissions',table([{h:'Invoice',v:v=>`<span class="mono">${v.id}</span>`},{h:'Issued',v:v=>fmtDate(v.date)},{h:'Client',v:v=>clName(v.client)},{h:'Type',v:()=>'Standard tax invoice (B2B)'},{h:'UUID',v:v=>`<span class="mono">${esc((v.uuid||'').slice(0,18))}…</span>`},{h:'Hash',v:v=>`<span class="mono">${esc(v.hash)}</span>`},{h:'Result',v:()=>'<span class="pill p-good">Cleared</span>'}],S.invoices.filter(v=>v.status!=='Draft').slice().reverse())));
V['finance.ageing']=()=>{ const T=today(); const b=v=>{const d=daysBetween(v.due,T);return d<=0?'Current':d<=30?'1–30':d<=60?'31–60':'60+';};
  const rows=S.clients.map(c=>{const o={id:c.id,Current:0,'1–30':0,'31–60':0,'60+':0};S.invoices.filter(v=>v.client===c.id&&v.status==='Issued').forEach(v=>o[b(v)]+=v.total-v.paid);return o;});
  return page('Receivables ageing','',card('Open balances by days overdue (SAR)',table([{h:'Client',v:r=>clName(r.id)},...['Current','1–30','31–60','60+'].map(k=>({h:k,n:1,v:r=>r[k]?`<span style="color:${k==='Current'?'inherit':'var(--bad)'}">${sar(r[k])}</span>`:'—'})),{h:'Total',n:1,v:r=>`<b>${sar(r.Current+r['1–30']+r['31–60']+r['60+'])}</b>`}],rows))); };
V['finance.vat']=()=>{ const by={}; S.invoices.filter(v=>v.status!=='Draft').forEach(v=>{const m=v.date.slice(0,7);(by[m]=by[m]||{id:m,net:0,vat:0,n:0});by[m].net+=v.subtotal;by[m].vat+=v.vat;by[m].n++;});
  return page('VAT summary','',card('Output VAT on issued invoices',table([{h:'Month',v:r=>r.id},{h:'Invoices',n:1,v:r=>r.n},{h:'Net sales, SAR',n:1,v:r=>sar(r.net)},{h:'VAT 15%, SAR',n:1,v:r=>`<b>${sar(r.vat)}</b>`}],Object.values(by).reverse()))+`<p class="note">Input VAT on purchases is not tracked in this prototype.</p>`); };

/* --- reports --- */
V['reports.bal']=()=>{ const g={}; S.stock.forEach(s=>{const k=s.client+'|'+s.sku+'|'+s.wh;(g[k]=g[k]||{client:s.client,sku:s.sku,wh:s.wh,qty:0,alloc:0,pal:0,hold:0});g[k].qty+=s.qty;g[k].alloc+=s.alloc;g[k].pal++;if(s.status!=='Available')g[k].hold+=s.qty;});
  const rows=applyFilt('bal',Object.values(g),{});
  return page('Stock balance',`<button class="btn" data-act="copyCSV" data-id="balance">Copy as CSV</button>`,filterBar('bal',[{id:'client',label:'Client',options:clientOpts()},{id:'wh',label:'Warehouse',options:whOpts()}])+card('On hand by client, item and warehouse',table([{h:'Client',v:r=>clName(r.client)},{h:'Item',v:r=>itemCell(r.sku)},{h:'Warehouse',v:r=>esc(wh(r.wh).name)},{h:'Pallets',n:1,v:r=>r.pal},{h:'On hand',n:1,v:r=>n0(r.qty)},{h:'Allocated',n:1,v:r=>n0(r.alloc)},{h:'Not available',n:1,v:r=>n0(r.hold)},{h:'Free to sell',n:1,v:r=>`<b>${n0(r.qty-r.alloc-r.hold)}</b>`}],rows))); };
V['reports.thru']=()=>{ const days=[...Array(14)].map((_,i)=>addDays(today(),i-13));
  const rows=days.map(d=>({id:d,asn:S.grns.filter(g=>g.at===d).length,pin:sum(S.grns.filter(g=>g.at===d),g=>g.lines.length),uin:sum(S.moves.filter(m=>m.type==='Receipt'&&m.at===d),m=>m.qty),ord:S.orders.filter(o=>o.dispatchedAt===d).length,uout:-sum(S.moves.filter(m=>m.type==='Pick'&&m.at===d),m=>m.qty)})).reverse();
  return page('Throughput','',card('Daily inbound and outbound, last 14 days',table([{h:'Date',v:r=>fmtDate(r.id)},{h:'GRNs',n:1,v:r=>r.asn},{h:'Pallets in',n:1,v:r=>r.pin},{h:'Units in',n:1,v:r=>n0(r.uin)},{h:'Orders shipped',n:1,v:r=>r.ord},{h:'Units out',n:1,v:r=>n0(r.uout)}],rows))); };
V['reports.client']=()=>{ const rows=S.clients.map(c=>{const ch=S.charges.filter(x=>x.client===c.id);const t=k=>sum(ch.filter(x=>k(x.type)),x=>x.amount);return {id:c.id,st:t(x=>x==='Storage'),h:t(x=>/Handling|Order fee|Returns/.test(x)),tr:t(x=>x==='Transport'),v:t(x=>x.startsWith('VAS')),tot:sum(ch,x=>x.amount),pal:S.stock.filter(s=>s.client===c.id).length};}).sort((a,b)=>b.tot-a.tot);
  return page('Client profitability','',card('Revenue by client and service, all charges (SAR)',table([{h:'Client',v:r=>clName(r.id)},{h:'Storage',n:1,v:r=>sar(r.st)},{h:'Handling',n:1,v:r=>sar(r.h)},{h:'Transport',n:1,v:r=>sar(r.tr)},{h:'VAS',n:1,v:r=>sar(r.v)},{h:'Total',n:1,v:r=>`<b>${sar(r.tot)}</b>`},{h:'Pallets held',n:1,v:r=>r.pal}],rows))+`<p class="note">Cost to serve (labour, space, fleet) is not captured yet, so this shows revenue only. Adding costs per warehouse turns it into margin.</p>`); };
V['reports.sla']=()=>{ const rows=S.clients.map(c=>{const os=S.orders.filter(o=>o.client===c.id&&o.dispatchedAt);const ok=os.filter(o=>o.dispatchedAt<=o.due).length;return {id:c.id,n:os.length,ok,late:S.orders.filter(o=>o.client===c.id&&isLate(o)).length};});
  return page('SLA','',card('On-time dispatch by client',table([{h:'Client',v:r=>clName(r.id)},{h:'Orders shipped',n:1,v:r=>r.n},{h:'On time',n:1,v:r=>r.ok},{h:'On-time %',n:1,v:r=>r.n?`<b>${Math.round(r.ok/r.n*100)}%</b>`:'—'},{h:'Open and late',n:1,v:r=>r.late?`<span class="pill p-bad">${r.late}</span>`:'0'}],rows))); };

/* --- settings --- */
V['settings.company']=()=>page('Company','',card('Company details',`<form class="card-b" id="coForm" style="display:flex;flex-direction:column;gap:12px"><div class="fgrid">${[['name','Company name'],['vat','VAT registration number'],['cr','Commercial registration'],['city','City']].map(([k,l])=>`<label class="field" for="co_${k}">${l}<input id="co_${k}" name="${k}" value="${esc(S.company[k])}"></label>`).join('')}</div><div><button class="btn pri" type="submit">Save</button></div></form>`));
const fmtDateTime=d=>d?new Date(d).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const allMods=()=>NAV.flatMap(g=>g.m);
const roleMods=role=>allMods().filter(m=>AUTH.can(role,m.id));
const roleSummary=role=>{ const r=AUTH.roles()[role]; if(!r) return '—'; if(r.modules==='*') return '<span class="pill p-info">Full access</span>';
  const ms=roleMods(role); return `<span title="${esc(ms.map(m=>m.t).join(', '))}">${ms.length} of ${allMods().length} modules</span>`; };
const roleSummaryLong=role=>{ const r=AUTH.roles()[role]; if(!r) return ''; return r.modules==='*'?'Full access to every module, including Settings (users, roles and company).':'Can open: '+roleMods(role).map(m=>esc(m.t)).join(', ')+'.'; };
V['settings.users']=()=>{ const us=AUTH.users(), roles=AUTH.roles();
  return page('Users & access',`<button class="btn pri" data-act="newUser">+ New user</button>`,
  `<p class="note" style="margin:0"><span class="sim">PROTOTYPE</span> Users and passwords are saved in this browser only. A shared team setup needs a sign-in server.</p>`+
  `<div class="grid g-kpi">${[['Users',us.length],['Active',us.filter(u=>u.active).length],['Administrators',us.filter(u=>u.active&&u.role===AUTH.ADMIN).length],['Roles',Object.keys(roles).length]].map(k=>`<div class="card kpi"><span>${k[0]}</span><b>${k[1]}</b></div>`).join('')}</div>`+
  card(`${us.length} users`,table([
    {h:'Name',v:u=>`<b>${esc(u.name)}</b>${u.id===ME.id?' <span class="pill p-info">You</span>':''}${u.title?`<br><span class="note">${esc(u.title)}</span>`:''}`},
    {h:'Email',v:u=>`<span class="mono">${esc(u.email)}</span>`},
    {h:'Role',v:u=>esc(u.role)},
    {h:'Can open',v:u=>roleSummary(u.role)},
    {h:'Last sign-in',v:u=>u.lastLogin?fmtDateTime(u.lastLogin):'<span class="note">Never</span>'},
    {h:'Status',v:u=>u.active?'<span class="pill p-good">Active</span>':'<span class="pill p-mute">Deactivated</span>'},
    {h:'',v:u=>`<div class="row">${btn('Edit','editUser',u.id)}${u.id===ME.id?'':btn(u.active?'Deactivate':'Activate','toggleUser',u.id)+btn('Delete','delUser',u.id,'danger')}</div>`}],us),
    `<button class="btn sm" data-go="settings.roles">Roles & permissions</button>`)); };
V['settings.roles']=()=>{ const roles=AUTH.roles(), names=Object.keys(roles), us=AUTH.users();
  const mods=allMods().filter(m=>!AUTH.ADMIN_ONLY.includes(m.id));
  const head=names.map(r=>`<th class="mx-c">${esc(r)}<br><span class="note">${us.filter(u=>u.role===r).length} users</span>${roles[r].builtin?'':`<br><button type="button" class="btn sm danger" data-act="delRole" data-id="${esc(r)}" style="margin-top:4px">Delete</button>`}</th>`).join('');
  const rows=mods.map(m=>`<tr><td><b>${esc(m.t)}</b><br><span class="note">${m.subs.map(x=>esc(x[1])).join(', ')}</span></td>${names.map(r=>{ const all=roles[r].modules==='*', on=all||roles[r].modules.includes(m.id), lock=all||m.id==='home';
    return `<td class="mx-c"><input type="checkbox" class="acc" data-role="${esc(r)}" value="${m.id}" ${on?'checked':''} ${lock?'disabled':''} aria-label="${esc(r)} can open ${esc(m.t)}"></td>`; }).join('')}</tr>`).join('');
  const setRow=`<tr><td><b>Settings</b><br><span class="note">Company, users, roles, data</span></td>${names.map(r=>`<td class="mx-c">${roles[r].modules==='*'?'<span class="pill p-good">Yes</span>':'<span class="note">Admin only</span>'}</td>`).join('')}</tr>`;
  return page('Roles & permissions',`<button class="btn" data-act="newRole">+ New role</button><button class="btn pri" type="submit" form="roleForm">Save permissions</button>`,
    `<p class="note" style="margin:0">Tick the modules each role can open, then save. Administrators always have full access, and only Administrators can open Settings. Changes apply to signed-in users straight away.</p>`+
    card('Module access by role',`<form id="roleForm"><div class="tbl-wrap"><table class="matrix"><thead><tr><th>Module</th>${head}</tr></thead><tbody>${rows}${setRow}</tbody></table></div></form>`)); };
function userForm(u){
  const ed=!!u, roles=Object.keys(AUTH.roles()), role=ed?u.role:(roles.includes('Operator')?'Operator':roles[0]);
  form(ed?'Edit user · '+u.name:'New user',[
    {id:'name',label:'Full name',value:ed?u.name:'',req:1},
    {id:'email',label:'Email (used to sign in)',type:'email',value:ed?u.email:'',req:1},
    {id:'title',label:'Job title',value:ed?u.title:''},
    {id:'role',label:'Role',type:'select',options:roles.map(r=>[r,r]),value:role},
    {type:'html',html:`<div id="rolePrev" class="note">${roleSummaryLong(role)}</div>`},
    {id:'password',label:ed?'New password (leave blank to keep)':'Password',type:'password',req:!ed},
    {id:'confirm',label:'Confirm password',type:'password',req:!ed},
    {type:'html',html:'<p class="note" style="margin:0">At least 8 characters, with at least one letter and one number.'+(ed?' Changing the email also needs a new password.':'')+'</p>'}],
    async v=>{ const saved=await AUTH.saveUser(v,ed?u.id:null);
      if(saved.id===ME.id&&saved.role!==ME.role){ location.reload(); return; }
      if(saved.id===ME.id) fillUser();
      done(ed?`${saved.name} updated.`:`${saved.name} can now sign in as ${saved.role}.`); }, ed?'Save changes':'Create user');
}
function clientForm(c){
  const ed=!!c;
  form(ed?'Edit client · '+c.name:'New client',[{id:'name',label:'Company name',value:ed?c.name:'',req:1},{id:'industry',label:'Industry',value:ed?c.industry:''},{id:'contact',label:'Contact person',value:ed?c.contact:''},{id:'phone',label:'Phone',value:ed?c.phone:''},{id:'vat',label:'VAT number',value:ed?c.vat:''},
    ...(ed?[]:[{id:'rule',label:'Pick rule',type:'select',options:[['FEFO','FEFO'],['FIFO','FIFO']]},{id:'terms',label:'Payment terms, days',type:'number',value:30,min:0},{id:'storage',label:'Storage / pallet / day, SAR',type:'number',value:4,step:'0.01'},{id:'inbound',label:'Inbound / pallet, SAR',type:'number',value:10,step:'0.01'},{id:'outbound',label:'Outbound / pick line, SAR',type:'number',value:3,step:'0.01'},{id:'order',label:'Order fee, SAR',type:'number',value:6,step:'0.01'},{id:'vas',label:'VAS / unit, SAR',type:'number',value:1,step:'0.01'},{id:'transport',label:'Transport / drop, SAR',type:'number',value:90,step:'0.01'}])],
    v=>{ adminOnly();
      if(S.clients.some(x=>x!==c&&!x.archived&&x.name.trim().toLowerCase()===v.name.toLowerCase())) throw new Error('A client called '+v.name+' already exists.');
      if(ed){ Object.assign(c,{name:v.name,industry:v.industry,contact:v.contact,phone:v.phone,vat:v.vat}); return done(v.name+' updated.'); }
      const id='CL-'+String(Math.max(0,...S.clients.map(x=>+x.id.slice(3)||0))+1).padStart(3,'0');
      S.clients.push({id,name:v.name,industry:v.industry,contact:v.contact,phone:v.phone,vat:v.vat,rule:v.rule,terms:+v.terms||30,sla:24,rates:{storage:+v.storage,inbound:+v.inbound,outbound:+v.outbound,order:+v.order,vas:+v.vas,transport:+v.transport}});
      done(v.name+' added as '+id+'.'); }, ed?'Save changes':'Add client');
}
function clientBlockers(id){
  const b=[], n=(k,t)=>{ if(k) b.push(k+' '+t); };
  n(S.stock.filter(s=>s.client===id).length,'pallet(s) in stock');
  n(S.orders.filter(o=>o.client===id&&!['Delivered','Cancelled'].includes(o.status)).length,'open order(s)');
  n(S.asns.filter(a=>a.client===id&&a.status==='Expected').length,'expected ASN(s)');
  n(S.charges.filter(c=>c.client===id&&!c.invoice).length,'unbilled charge(s)');
  n(S.invoices.filter(v=>v.client===id&&v.status!=='Paid').length,'draft or unpaid invoice(s)');
  n(S.returns.filter(r=>r.client===id&&r.status==='Requested').length,'open return(s)');
  n(S.vas.filter(v=>v.client===id&&v.status==='Open').length,'open VAS work order(s)');
  return b;
}
const clientHasHistory=id=>[S.orders,S.asns,S.charges,S.invoices,S.moves,S.returns,S.vas].some(a=>a.some(x=>x.client===id));
V['settings.data']=()=>page('Data','',card('Stored data',`<div class="card-b" style="display:flex;flex-direction:column;gap:12px"><p style="margin:0">All records are stored in this browser only. Other people opening this page see their own copy. Nothing is sent to a server.</p><div class="dl"><div><span>Clients</span><b>${S.clients.length}</b></div><div><span>Pallets</span><b>${S.stock.length}</b></div><div><span>Orders</span><b>${S.orders.length}</b></div><div><span>Ledger entries</span><b>${S.moves.length}</b></div><div><span>Charges</span><b>${S.charges.length}</b></div><div><span>Invoices</span><b>${S.invoices.length}</b></div></div><div class="row"><button class="btn danger" data-act="reset">Clear all data</button></div><div id="resetBox"></div></div>`));

/* ================= detail views ================= */
const DETAIL={
  order(id){ const o=S.orders.find(x=>x.id===id); return {title:'Order '+o.id,body:`<div class="dl"><div><span>Client</span><b>${clName(o.client)}</b></div><div><span>Customer</span><b>${esc(o.customer)}</b></div><div><span>Warehouse</span><b>${esc(wh(o.wh).name)}</b></div><div><span>Due</span><b>${fmtDate(o.due)}</b></div><div><span>Status</span>${pill(o.status)}</div><div><span>Pick list</span><b>${o.pick||'—'}</b></div><div><span>Delivery note</span><b>${o.dn||'—'}</b></div><div><span>Trip / AWB</span><b>${esc(o.trip||o.awb||'—')}</b></div></div>
    ${table([{h:'Item',v:l=>itemCell(l.sku)},{h:'Ordered',n:1,v:l=>l.qty},{h:'Allocated',n:1,v:l=>l.qty-l.short},{h:'Picks',v:l=>l.picks.map(p=>`${p.lpn} @ ${esc(p.bin)} × ${p.qty}${p.expiry?' <span class="note">exp '+fmtDate(p.expiry)+'</span>':''}`).join('<br>')||'—'}],o.lines)}`,
    acts:{New:[['Allocate','alloc'],['Cancel','cancelOrder']],Allocated:[['Release pick list','release'],['Cancel','cancelOrder']],Picking:[['Confirm picked','confirmPick']],Picked:[['Dispatch','dispatch'],['Book courier','ship']],Dispatched:[['Record POD','pod']],Delivered:[['Create return','newReturnFor']]}[o.status]||[]}; },
  asn(id){ const a=S.asns.find(x=>x.id===id); return {title:'ASN '+a.id,body:`<div class="dl"><div><span>Client</span><b>${clName(a.client)}</b></div><div><span>Warehouse</span><b>${esc(wh(a.wh).name)}</b></div><div><span>ETA</span><b>${fmtDate(a.eta)} ${esc(a.slot)}</b></div><div><span>Dock</span><b>${esc(a.dock)||'—'}</b></div><div><span>Supplier ref</span><b>${esc(a.ref)||'—'}</b></div><div><span>Status</span>${pill(a.status)}</div><div><span>GRN</span><b>${a.grn||'—'}</b></div></div>${table([{h:'Item',v:l=>itemCell(l.sku)},{h:'Qty',n:1,v:l=>l.qty},{h:'Batch',v:l=>esc(l.batch)||'—'},{h:'Expiry',v:l=>fmtDate(l.expiry)}],a.lines)}`,acts:a.status==='Expected'?[['Receive','receive'],['Book slot','slot']]:[]}; },
  grn(id){ const g=S.grns.find(x=>x.id===id); return {title:'GRN '+g.id,body:`<div class="dl"><div><span>ASN</span><b>${g.asn}</b></div><div><span>Client</span><b>${clName(g.client)}</b></div><div><span>Received</span><b>${fmtDate(g.at)}</b></div></div>${table([{h:'Item',v:l=>itemCell(l.sku)},{h:'Expected',n:1,v:l=>l.expected},{h:'Received',n:1,v:l=>l.received},{h:'Variance',n:1,v:l=>l.diff?`<span class="pill p-warn">${l.diff>0?'+':''}${l.diff}</span>`:'0'},{h:'LPN',v:l=>`<span class="mono">${l.lpn}</span>`},{h:'Batch',v:l=>esc(l.batch)||'—'}],g.lines)}`,acts:[]}; },
  invoice(id){ const v=S.invoices.find(x=>x.id===id); const c=client(v.client);
    return {title:'Tax invoice '+v.id,body:`<div class="row" style="justify-content:space-between;align-items:flex-start"><div><b>${esc(S.company.name)}</b><br><span class="note">VAT ${esc(S.company.vat)} · CR ${esc(S.company.cr)}</span></div><div style="text-align:right"><b>فاتورة ضريبية · Tax invoice</b><br><span class="note">${fmtDate(v.date)}</span></div></div>
    <div class="dl"><div><span>Bill to</span><b>${esc(c.name)}</b></div><div><span>Client VAT</span><b>${esc(c.vat)}</b></div><div><span>Service period</span><b>${fmtDate(v.from)} – ${fmtDate(v.to)}</b></div><div><span>Due</span><b>${fmtDate(v.due)}</b></div><div><span>Status</span>${pill(invState(v))}</div><div><span>ZATCA</span><b>${esc(v.zatca)}</b>${v.uuid?' <span class="sim">SIMULATED</span>':''}</div></div>
    ${table([{h:'Service',v:l=>esc(l.type)},{h:'Qty',n:1,v:l=>n0(l.qty)+' <span class="note">'+esc(l.note)+'</span>'},{h:'Rate',n:1,v:l=>sar(l.rate)},{h:'Amount, SAR',n:1,v:l=>sar(l.amount)}],v.lines)}
    <div style="display:grid;grid-template-columns:1fr auto;gap:4px 16px;justify-content:end;text-align:right;font-variant-numeric:tabular-nums"><span>Subtotal</span><b>${sar(v.subtotal)}</b><span>VAT 15%</span><b>${sar(v.vat)}</b><span>Total, SAR</span><b style="font-size:16px">${sar(v.total)}</b><span>Paid</span><b>${sar(v.paid)}</b><span>Balance</span><b>${sar(v.total-v.paid)}</b></div>`,
    acts:v.status==='Draft'?[['Issue & clear with ZATCA','issue'],['Delete draft','voidDraft']]:v.status==='Issued'?[['Record payment','payInv']]:[]}; },
  client(id){ const c=client(id); return {title:c.name,body:`<div class="dl"><div><span>Code</span><b>${c.id}</b></div><div><span>Industry</span><b>${esc(c.industry)}</b></div><div><span>Contact</span><b>${esc(c.contact)}</b></div><div><span>Phone</span><b>${esc(c.phone)}</b></div><div><span>Pick rule</span><b>${esc(c.rule)}</b></div><div><span>Payment terms</span><b>${c.terms} days</b></div></div>
    <div class="dl"><div><span>Pallets held</span><b>${S.stock.filter(s=>s.client===id).length}</b></div><div><span>Orders all time</span><b>${S.orders.filter(o=>o.client===id).length}</b></div><div><span>Billed, SAR</span><b>${sar(sum(S.invoices.filter(v=>v.client===id),v=>v.total))}</b></div><div><span>Outstanding, SAR</span><b>${sar(sum(S.invoices.filter(v=>v.client===id&&v.status==='Issued'),v=>v.total-v.paid))}</b></div></div>`,acts:[['Edit rates','editRates'],...(isAdminNow()&&!c.archived?[['Edit details','editClient'],['Remove client','removeClient']]:[])]}; },
  item(sku){ const i=item(sku); const vars=S.items.filter(x=>x.parent===sku);
    const st=i.variant==='template'?S.stock.filter(s=>vars.some(v=>v.sku===s.sku)):S.stock.filter(s=>s.sku===sku);
    const yn=b=>b?'Yes':'No', f=(l,v,full)=>`<div${full?' style="grid-column:1/-1"':''}><span>${l}</span><b>${v}</b></div>`;
    const vtype=i.variant==='template'?`Contains variants (${esc(i.attrName||'')})`:i.variant==='variant'?`Variant of <span class="mono">${esc(i.parent)}</span> · ${esc(i.attr.name)} ${esc(i.attr.value)}`:'Single item';
    const onh=sum(st,s=>s.qty), val=sum(st,s=>s.qty*(s.rate||i.valRate||0));
    return {title:i.name,body:`<div class="dl">${f('Item code',`<span class="mono">${esc(i.code)}</span>`)}${f('SKU',`<span class="mono">${esc(i.sku)}</span>`)}${f('Company (client)',clName(i.client))}${f('Type',esc(i.kind||'Goods'))}
      <div style="grid-column:1/-1"><span>Secondary name</span><b dir="rtl" lang="ar">${esc(i.name2)||'—'}</b></div>
      ${f('Category',esc(i.category)||'—')}${f('Manufacturer',esc(i.manufacturer)||'—')}${f('Item type',vtype)}${f('Item group',esc(i.group)||'—')}
      ${f('Unit of measure',esc(i.uom))}${f('Unit conversion',(i.conversions||[]).map(c=>`1 ${esc(c.uom)} = ${n0(c.factor)} ${esc(i.uom)}`).join('<br>')||'—')}${f('Temperature class',esc(i.temp))}${f('Packing',esc(i.packing)||'—')}${f('Barcode',`<span class="mono">${esc(i.barcode)||'—'}</span>`)}</div>
      <h3 style="margin:2px 0 0;font-size:13.5px">Inventory</h3>
      <div class="dl">${f('Track inventory',yn(i.track!==false))}${f('Valuation method',esc(i.valMethod||'FIFO'))}${f('Valuation date',fmtDate(i.valDate))}${f('Valuation rate, SAR',i.valRate?sar(i.valRate):'—')}
      ${f('Batch number',yn(i.batch))}${f('Serial number',yn(i.serial))}${f('Expiry date',i.expiry?'Yes · '+i.shelf+' days shelf life':'No')}${f('On hand',n0(onh)+' '+esc(i.uom))}${val?f('Stock value, SAR',sar(val)):''}</div>
      ${vars.length?table([{h:'Variant SKU',v:v=>`<span class="mono">${esc(v.sku)}</span>`},{h:esc(i.attrName||'Value'),v:v=>esc(v.attr.value)},{h:'Name',v:v=>esc(v.name)},{h:'On hand',n:1,v:v=>n0(itemOnHand(v))}],vars):(i.track===false?'':stockTable(st,false))}`,
    acts:[['Edit item','editItem']]}; }
};
function openDetail(kind,id){
  const d=DETAIL[kind](id);
  modal(d.title,d.body,d.acts.map(([l,a],i)=>`<button class="btn ${i===0?'pri':''} ${/Cancel|Delete|Remove/.test(l)?'danger':''}" data-act="${a}" data-id="${esc(id)}" data-close="1">${l}</button>`).join('')+'<button class="btn" data-close="1">Close</button>');
}

/* ================= modal + forms ================= */
let formSubmit=null, lastFocus=null;
function modal(title,body,foot){
  if(!$('#modalRoot').innerHTML) lastFocus=document.activeElement;
  document.body.classList.add('modal-open');
  $('#modalRoot').innerHTML=`<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle"><header><h2 id="mTitle">${esc(title)}</h2><button class="icon-btn" data-close="1" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header><div class="mb">${body}</div><footer>${foot||'<button class="btn" data-close="1">Close</button>'}</footer></div></div>`;
  const f=$('#modalRoot').querySelector('.mb input:not([type=hidden]),.mb select,.mb textarea')||$('#modalRoot').querySelector('footer .btn:last-child'); if(f) f.focus({preventScroll:true});
}
function closeModal(){
  if(!$('#modalRoot').innerHTML) return;
  $('#modalRoot').innerHTML=''; formSubmit=null; document.body.classList.remove('modal-open');
  if(lastFocus&&document.contains(lastFocus)) try{ lastFocus.focus({preventScroll:true}); }catch(_){}
  lastFocus=null;
}
function form(title,fields,onSubmit,submitLabel='Save'){
  const fh=fields.map(f=>{
    if(f.type==='lines') return `<div class="field" style="grid-column:1/-1"><span>${f.label}</span><div class="lines" id="lines_${f.id}"></div><div><button type="button" class="btn sm" data-addline="${f.id}">+ Add line</button></div></div>`;
    if(f.type==='html') return `<div style="grid-column:1/-1">${f.html}</div>`;
    const id='f_'+f.id, req=f.req?'required':'';
    if(f.type==='select') return `<label class="field" for="${id}">${f.label}<select id="${id}" name="${f.id}" ${req}>${f.blank?'<option value="">Choose…</option>':''}${f.options.map(([v,t])=>`<option value="${esc(v)}" ${String(f.value)===String(v)?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
    if(f.type==='checks') return `<fieldset class="field" style="grid-column:1/-1;border:0;padding:0;margin:0"><legend style="margin-bottom:4px">${f.label}</legend>${f.options.length?f.options.map(([v,t],i)=>`<label style="display:flex;gap:8px;align-items:center;padding:3px 0"><input type="checkbox" name="${f.id}" value="${esc(v)}" id="${id}_${i}" checked style="width:auto;height:auto"> ${esc(t)}</label>`).join(''):'<span class="note">None available.</span>'}</fieldset>`;
    return `<label class="field" for="${id}">${f.label}<input id="${id}" name="${f.id}" type="${f.type||'text'}" value="${esc(f.value??'')}" ${f.step?`step="${f.step}"`:''} ${f.min!=null?`min="${f.min}"`:''} ${req}></label>`;
  }).join('');
  modal(title,`<form id="mForm" novalidate><div class="fgrid">${fh}</div><div class="err" id="mErr" role="alert"></div></form>`,`<button class="btn" data-close="1" type="button">Cancel</button><button class="btn pri" type="submit" form="mForm">${submitLabel}</button>`);
  formSubmit={fields,onSubmit};
  fields.filter(f=>f.type==='lines').forEach(f=>{ (f.value&&f.value.length?f.value:[{}]).forEach(v=>addLine(f,v)); });
}
const stockable=i=>i.variant!=='template'&&i.kind!=='Service'&&i.track!==false;
function lineItemOpts(){ const cl=($('#f_client')||{}).value; return S.items.filter(i=>stockable(i)&&(!cl||i.client===cl)).map(i=>[i.sku,i.sku+' · '+i.name]); }
function addLine(f,v={}){
  const box=$('#lines_'+f.id); const d=document.createElement('div'); d.className='line'+(f.cols==='short'?' l3':'');
  const opts=lineItemOpts();
  d.innerHTML=`<select data-col="sku" aria-label="Item">${opts.map(([s,t])=>`<option value="${esc(s)}" ${v.sku===s?'selected':''}>${esc(t)}</option>`).join('')}</select><input data-col="qty" type="number" min="1" placeholder="Qty" aria-label="Quantity" value="${esc(v.qty||'')}">${f.cols==='short'?'':`<input data-col="batch" placeholder="Batch" aria-label="Batch" value="${esc(v.batch||'')}"><input data-col="expiry" type="date" aria-label="Expiry" value="${esc(v.expiry||'')}">`}<button type="button" class="icon-btn" data-delline="1" aria-label="Remove line">×</button>`;
  box.appendChild(d);
}
function readForm(){
  const out={}; const fm=$('#mForm');
  for(const f of formSubmit.fields){
    if(f.type==='lines'){ out[f.id]=[...fm.querySelectorAll('#lines_'+f.id+' .line')].map(r=>{const o={};r.querySelectorAll('[data-col]').forEach(i=>o[i.dataset.col]=i.value.trim());return o;}).filter(l=>l.sku&&+l.qty>0); continue; }
    if(f.type==='html') continue;
    if(f.type==='checks'){ out[f.id]=[...fm.querySelectorAll(`[name="${f.id}"]:checked`)].map(i=>i.value); continue; }
    const el=fm.querySelector(`[name="${f.id}"]`); out[f.id]=el?(f.type==='password'?el.value:el.value.trim()):'';
    if(f.req&&!out[f.id]) throw new Error(f.label+' is required.');
  }
  return out;
}

/* ================= actions ================= */
function done(msg){ save(); closeModal(); render(); toast(msg); }
function toast(msg){
  let box=$('#toasts'); if(!box){ box=document.createElement('div'); box.id='toasts'; box.setAttribute('role','status'); box.setAttribute('aria-live','polite'); document.body.appendChild(box); }
  const t=document.createElement('div'); t.className='toast'; t.textContent=msg; box.appendChild(t);
  while(box.children.length>3) box.firstElementChild.remove();
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(),250); },3200);
}
const binOpts=w=>S.bins.filter(b=>b.wh===w).map(b=>[b.code,b.code+' · '+b.zone]);
const ACT={
  newASN(){ form('New ASN',[{id:'client',label:'Client',type:'select',options:clientOpts(),req:1},{id:'wh',label:'Warehouse',type:'select',options:whOpts(),req:1},{id:'eta',label:'Expected date',type:'date',value:addDays(today(),1),req:1},{id:'ref',label:'Supplier / PO reference'},{id:'dock',label:'Dock',type:'select',options:[['D1','D1'],['D2','D2'],['D3','D3'],['D4','D4']]},{id:'lines',label:'Items (one pallet per line)',type:'lines'}],v=>{ const a=OPS.createASN(v); done(a.id+' created. Receive it when the truck arrives.'); },'Create ASN'); },
  newOrder(){ form('New outbound order',[{id:'client',label:'Client',type:'select',options:clientOpts(),req:1},{id:'wh',label:'Ship from',type:'select',options:whOpts(),req:1},{id:'customer',label:'Deliver to',req:1},{id:'due',label:'Dispatch by',type:'date',value:addDays(today(),1),req:1},{id:'ref',label:'Client order reference'},{id:'lines',label:'Items',type:'lines',cols:'short'}],v=>{ const o=OPS.createOrder(v); done(o.id+' created. Allocate it to reserve stock.'); },'Create order'); },
  receive(id){ const a=S.asns.find(x=>x.id===id); form('Receive '+a.id,[{type:'html',html:`<p class="note" style="margin:0">${clName(a.client)} · ${esc(wh(a.wh).name)}. Enter what actually arrived; differences are recorded on the GRN.</p>`},...a.lines.map((l,i)=>({id:'q'+i,label:`${l.sku} · ${item(l.sku).name} (expected ${l.qty}${l.batch?', batch '+l.batch:''})`,type:'number',value:l.qty,min:0}))],v=>{ const g=OPS.receiveASN(id,today(),a.lines.map((_,i)=>v['q'+i])); done(g.id+' posted. '+g.lines.length+' putaway task(s) opened.'); },'Post GRN'); },
  slot(id){ const a=S.asns.find(x=>x.id===id); form('Book dock slot · '+a.id,[{id:'eta',label:'Date',type:'date',value:a.eta,req:1},{id:'slot',label:'Time',type:'time',value:a.slot||'10:00',req:1},{id:'dock',label:'Dock',type:'select',options:[['D1','D1'],['D2','D2'],['D3','D3'],['D4','D4']],value:a.dock}],v=>{ Object.assign(a,v); done('Slot booked for '+fmtDate(v.eta)+' at '+v.slot+'.'); }); },
  put(id){ const t=S.tasks.find(x=>x.id===id); OPS.putaway(id,t.to); done(t.lpn+' put away to '+t.to+'.'); },
  putAll(){ const open=S.tasks.filter(t=>t.status==='Open'); open.forEach(t=>OPS.putaway(t.id,t.to)); done(open.length+' pallets put away.'); },
  putOther(id){ const t=S.tasks.find(x=>x.id===id); form('Put away '+t.lpn,[{id:'bin',label:'Bin',type:'select',options:binOpts(t.wh),value:t.to}],v=>{ OPS.putaway(id,v.bin); done(t.lpn+' put away to '+v.bin+'.'); },'Confirm'); },
  alloc(id){ const o=OPS.allocate(id); const sh=sum(o.lines,l=>l.short); done(sh?`${id} allocated with ${sh} units short (see Backorders).`:`${id} fully allocated.`); },
  allocAll(){ let ok=0,fail=0; S.orders.filter(o=>o.status==='New').forEach(o=>{ try{OPS.allocate(o.id);ok++;}catch(e){fail++;} }); done(`${ok} allocated${fail?`, ${fail} have no stock`:''}.`); },
  release(id){ if(S.stock.some(s=>s.lpn===id)){ OPS.setStatus(id,'Available'); return done(id+' released.'); } OPS.releasePick(id); done('Pick list released for '+id+'.'); },
  confirmPick(id){ OPS.confirmPick(id); done(id+' picked and staged.'); },
  dispatch(id){ OPS.dispatch(id); const o=S.orders.find(x=>x.id===id); done(`${id} dispatched. Delivery note ${o.dn}.`); },
  pod(id){ form('Proof of delivery · '+id,[{id:'by',label:'Received by',req:1},{id:'at',label:'Delivery date',type:'date',value:today(),req:1}],v=>{ OPS.deliver(id,v.by,v.at); done(id+' delivered.'); },'Save POD'); },
  cancelOrder(id){ modal('Cancel '+id+'?','<p style="margin:0">Reserved stock is released. This cannot be undone.</p>',`<button class="btn" data-close="1">Keep order</button><button class="btn danger" data-act="cancelYes" data-id="${id}">Cancel order</button>`); },
  cancelYes(id){ OPS.cancelOrder(id); done(id+' cancelled.'); },
  ship(id){ form('Book courier · '+id,[{id:'courier',label:'Courier',type:'select',options:[['SMSA Express','SMSA Express'],['Aramex','Aramex'],['SPL (Saudi Post)','SPL (Saudi Post)'],['J&T Express','J&T Express']]}],v=>{ OPS.ship(id,v.courier); done('Courier booked (simulated AWB).'); },'Book'); },
  hold(lpn){ OPS.setStatus(lpn,'Hold'); done(lpn+' on hold.'); },
  adjust(lpn){ const s=S.stock.find(x=>x.lpn===lpn); form('Adjust '+lpn,[{type:'html',html:`<p class="note" style="margin:0">${esc(item(s.sku).name)} · current ${s.qty}, allocated ${s.alloc}</p>`},{id:'qty',label:'New quantity',type:'number',value:s.qty,min:0,req:1},{id:'reason',label:'Reason',type:'select',options:S.reasons.map(r=>[r,r])}],v=>{ OPS.adjust(lpn,v.qty,v.reason); done('Stock adjusted.'); }); },
  transfer(lpn){ const opts=S.stock.filter(s=>!s.alloc).map(s=>[s.lpn,`${s.lpn} · ${s.sku} · ${s.bin}`]);
    if(lpn&&S.stock.some(s=>s.lpn===lpn)){ const s=S.stock.find(x=>x.lpn===lpn); return form('Move '+lpn,[{id:'bin',label:'To bin',type:'select',options:binOpts(s.wh),value:s.bin}],v=>{ OPS.transfer(lpn,v.bin); done(lpn+' moved to '+v.bin+'.'); },'Move'); }
    form('Move a pallet',[{id:'lpn',label:'Pallet',type:'select',options:opts,req:1},{id:'bin',label:'To bin code',req:1}],v=>{ OPS.transfer(v.lpn,v.bin.toUpperCase()); done(v.lpn+' moved.'); },'Move'); },
  newCount(){ form('New cycle count',[{id:'wh',label:'Warehouse',type:'select',options:whOpts()},{id:'bin',label:'Bin code',value:'A-02',req:1}],v=>{ const c=OPS.createCount(v.wh,v.bin.toUpperCase()); done(c.id+' created with '+c.lines.length+' pallets.'); },'Create'); },
  doCount(id){ const c=S.counts.find(x=>x.id===id); form('Count bin '+c.bin,[{type:'html',html:'<p class="note" style="margin:0">Count each pallet and enter what you find. Differences post as adjustments.</p>'},...c.lines.map((l,i)=>({id:'c'+i,label:`${l.lpn} · ${l.sku}`,type:'number',value:l.expected,min:0}))],v=>{ OPS.postCount(id,c.lines.map((_,i)=>v['c'+i])); done(id+' posted.'); },'Post count'); },
  newReturn(){ const os=S.orders.filter(o=>['Dispatched','Delivered'].includes(o.status)).slice(-25).reverse(); form('New return',[{id:'order',label:'Original order',type:'select',options:os.map(o=>[o.id,`${o.id} · ${client(o.client).name} · ${o.customer}`]),req:1},{id:'reason',label:'Reason',value:'Customer return'}],v=>{ closeModal(); ACT.newReturnFor(v.order,v.reason); },'Next'); },
  newReturnFor(oid,reason='Customer return'){ const o=S.orders.find(x=>x.id===oid); form('Return items · '+oid,[...o.lines.map((l,i)=>({id:'r'+i,label:`${l.sku} · shipped ${l.qty-l.short}`,type:'number',value:0,min:0})),{id:'reason',label:'Reason',value:reason}],v=>{ const r=OPS.createReturn(oid,o.lines.map((l,i)=>({sku:l.sku,qty:v['r'+i]})),v.reason); done(r.id+' created. Inspect it when goods arrive.'); },'Create return'); },
  inspect(key){ const [id,dec]=key.split('|'); OPS.inspectReturn(id,dec); done(id+' closed as '+dec.toLowerCase()+'.'); },
  newVAS(){ form('New VAS work order',[{id:'client',label:'Client',type:'select',options:clientOpts()},{id:'type',label:'Service',type:'select',options:['Kitting','Promo bundling','Arabic relabelling','Gift wrapping','Repacking','Shrink wrapping'].map(x=>[x,x])},{id:'sku',label:'Item',type:'select',options:S.items.filter(stockable).map(i=>[i.sku,i.sku+' · '+client(i.client).name])},{id:'qty',label:'Units',type:'number',value:50,min:1,req:1},{id:'due',label:'Due',type:'date',value:addDays(today(),2)}],v=>{ if(item(v.sku).client!==v.client) throw new Error('That item belongs to another client.'); const w=OPS.createVAS(v); done(w.id+' created.'); },'Create'); },
  vasDone(id){ OPS.completeVAS(id); done(id+' completed and charged.'); },
  newZone(){ if(!S.warehouses.length) throw new Error('Add a warehouse first.'); form('New temperature zone',[{id:'wh',label:'Warehouse',type:'select',options:whOpts()},{id:'name',label:'Zone name',value:'Chilled room 1',req:1},{id:'min',label:'Lowest allowed, °C',type:'number',step:'0.1',value:2,req:1},{id:'max',label:'Highest allowed, °C',type:'number',step:'0.1',value:8,req:1}],v=>{ if(!(+v.min<+v.max)) throw new Error('The lowest temperature must be below the highest.'); S.zones.push({id:nid('TZ',2),wh:v.wh,name:v.name,min:+v.min,max:+v.max,readings:[]}); done(v.name+' added. Log readings from its card.'); },'Add zone'); },
  reading(id){ const z=S.zones.find(x=>x.id===id); form('Log reading · '+z.name,[{id:'v',label:'Temperature, °C',type:'number',step:'0.1',value:'',req:1}],v=>{ OPS.reading(id,v.v); done('Reading saved.'); }); },
  newTrip(){ const os=S.orders.filter(o=>o.status==='Dispatched'&&!o.trip); form('Plan trip',[{id:'vehicle',label:'Vehicle',type:'select',options:S.vehicles.map(v=>[v.id,v.type+' · '+v.plate])},{id:'driver',label:'Driver',type:'select',options:S.drivers.map(d=>[d.id,d.name])},{id:'date',label:'Date',type:'date',value:today()},{id:'orders',label:'Dispatched orders without a trip',type:'checks',options:os.map(o=>[o.id,`${o.id} · ${o.customer}`])}],v=>{ const t=OPS.createTrip(v); done(t.id+' planned with '+t.orders.length+' drops.'); },'Plan trip'); },
  tripGo(id){ OPS.startTrip(id); done(id+' is out for delivery.'); },
  tripDone(id){ OPS.completeTrip(id); done(id+' completed. Drops marked delivered.'); },
  captureStorage(){ const n=OPS.captureStorage(); done('Storage captured for '+n+' clients.'); },
  bill(cl){ const v=OPS.billingRun(cl); save(); render(); openDetail('invoice',v.id); toast('Draft '+v.id+' created.'); },
  issue(id){ OPS.issueInvoice(id); done(id+' issued and cleared (simulated).'); },
  voidDraft(id){ OPS.voidDraft(id); done('Draft deleted. Charges are unbilled again.'); },
  payInv(id){ const v=S.invoices.find(x=>x.id===id); form('Record payment · '+id,[{id:'amount',label:'Amount, SAR',type:'number',step:'0.01',value:(v.total-v.paid).toFixed(2),req:1},{id:'at',label:'Date',type:'date',value:today()},{id:'method',label:'Method',type:'select',options:[['Bank transfer','Bank transfer'],['SADAD','SADAD'],['Cheque','Cheque']]}],x=>{ OPS.pay(id,x.amount,x.at,x.method); done('Payment recorded.'); }); },
  newCharge(){ form('Manual charge',[{id:'client',label:'Client',type:'select',options:clientOpts()},{id:'type',label:'Service',value:'Extra handling'},{id:'qty',label:'Quantity',type:'number',value:1,min:0.01,step:'0.01',req:1},{id:'rate',label:'Rate, SAR',type:'number',value:50,step:'0.01',req:1},{id:'note',label:'Note'}],v=>{ charge(today(),v.client,v.type||'Manual',`Manual by ${(AUTH.get()||ME).name}`,+v.qty,+v.rate,v.note); done('Charge added.'); },'Add charge'); },
  editRates(id){ const c=client(id); const r=c.rates; form('Rates · '+c.name,[['storage','Storage / pallet / day'],['inbound','Inbound / pallet'],['outbound','Outbound / pick line'],['order','Order fee'],['vas','VAS / unit'],['transport','Transport / drop']].map(([k,l])=>({id:k,label:l+', SAR',type:'number',step:'0.01',value:r[k],min:0})).concat([{id:'terms',label:'Payment terms, days',type:'number',value:c.terms},{id:'rule',label:'Pick rule',type:'select',options:[['FEFO','FEFO'],['FIFO','FIFO']],value:c.rule}]),v=>{ ['storage','inbound','outbound','order','vas','transport'].forEach(k=>r[k]=+v[k]); c.terms=+v.terms; c.rule=v.rule; done('Rates saved for '+c.name+'.'); }); },
  newClient(){ adminOnly(); clientForm(); },
  editClient(id){ adminOnly(); clientForm(client(id)); },
  removeClient(id){ adminOnly(); const c=client(id), b=clientBlockers(id);
    if(b.length) return modal('Cannot remove '+c.name,`<p style="margin:0">Close these first:</p><ul style="margin:0;padding-left:20px">${b.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p class="note" style="margin:0">Ship or adjust out the stock, finish or cancel orders, bill the charges and record payment for invoices.</p>`);
    const hist=clientHasHistory(id), items=S.items.filter(i=>i.client===id).length;
    modal('Remove '+c.name+'?',hist?`<p style="margin:0">${esc(c.name)} has past orders, charges or invoices, so it will be <b>archived</b>: hidden from lists and new records, with its history and reports kept. You can restore it later.</p>`
      :`<p style="margin:0">${esc(c.name)} has no records, so it will be <b>deleted</b>${items?` together with its ${items} item(s)`:''}. This cannot be undone.</p>`,
      `<button class="btn" data-close="1">Keep client</button><button class="btn danger" data-act="removeClientYes" data-id="${esc(id)}">${hist?'Archive client':'Delete client'}</button>`); },
  removeClientYes(id){ adminOnly(); const c=client(id); if(clientBlockers(id).length) throw new Error('This client has open work. Try again after closing it.');
    if(clientHasHistory(id)){ c.archived=true; c.archivedAt=today(); done(c.name+' archived.'); }
    else { S.clients=S.clients.filter(x=>x.id!==id); S.items=S.items.filter(i=>i.client!==id); done(c.name+' deleted.'); } },
  restoreClient(id){ adminOnly(); const c=client(id); c.archived=false; delete c.archivedAt; done(c.name+' restored.'); },
  newItem(){ itemEdit=null; go('master','itemform'); },
  editItem(sku){ itemEdit=sku; go('master','itemform'); },
  addConv(){ $('#convRows').insertAdjacentHTML('beforeend',convRow({},$('#it_uom').value)); $('#convRows').lastElementChild.querySelector('select').focus(); },
  newWH(){ form('New warehouse',[{id:'id',label:'Code',value:'WH-DMM-01',req:1},{id:'name',label:'Name',req:1},{id:'city',label:'City'},{id:'type',label:'Type',type:'select',options:['Ambient','Chilled','Frozen','Bonded'].map(x=>[x,x])},{id:'capacity',label:'Capacity, pallets',type:'number',value:100,req:1}],v=>{ v.id=v.id.toUpperCase(); if(S.warehouses.some(w=>w.id===v.id)) throw new Error('Code already used.'); if(!(+v.capacity>0)) throw new Error('Enter a capacity above 0 pallets.'); S.warehouses.push({...v,capacity:+v.capacity}); ['DOCK-IN','STAGE-OUT','RET-01','QA-HOLD'].forEach(c=>S.bins.push({code:c,wh:v.id,zone:c==='DOCK-IN'?'Receiving':c==='STAGE-OUT'?'Staging':c==='RET-01'?'Returns':'Quarantine',temp:'Any',cap:99})); S.spaces.push({id:'SP-'+v.id,wh:v.id,type:v.type,city:v.city,rate:4}); done(v.name+' added. Add storage bins next.'); },'Add'); },
  newBin(){ form('New bin',[{id:'wh',label:'Warehouse',type:'select',options:whOpts()},{id:'code',label:'Bin code',req:1},{id:'zone',label:'Zone',value:'Storage'},{id:'temp',label:'Temperature',type:'select',options:['Ambient','Chilled','Frozen','Any'].map(x=>[x,x])},{id:'cap',label:'Pallet capacity',type:'number',value:2}],v=>{ v.code=v.code.toUpperCase(); if(S.bins.some(b=>b.wh===v.wh&&b.code===v.code)) throw new Error('Bin already exists.'); S.bins.push({...v,cap:+v.cap}); done('Bin '+v.code+' added.'); },'Add'); },
  newVehicle(){ form('New vehicle',[{id:'plate',label:'Plate',req:1},{id:'type',label:'Type',value:'Van'},{id:'capacity',label:'Pallets',type:'number',value:4}],v=>{ S.vehicles.push({id:'VH-'+String(S.vehicles.length+1).padStart(2,'0'),...v,capacity:+v.capacity}); done('Vehicle added.'); }); },
  newDriver(){ form('New driver',[{id:'name',label:'Name',req:1},{id:'phone',label:'Phone'}],v=>{ S.drivers.push({id:'DR-'+String(S.drivers.length+1).padStart(2,'0'),...v}); done('Driver added.'); }); },
  newReason(){ form('New reason code',[{id:'r',label:'Reason',req:1}],v=>{ S.reasons.push(v.r); done('Reason added.'); }); },
  newUser(){ adminOnly(); userForm(); },
  editUser(id){ adminOnly(); userForm(AUTH.users().find(u=>u.id===id)); },
  toggleUser(id){ const u=AUTH.users().find(x=>x.id===id); AUTH.setActive(id,!u.active); done(u.active?`${u.name} deactivated. They can no longer sign in.`:`${u.name} can sign in again.`); },
  delUser(id){ adminOnly(); const u=AUTH.users().find(x=>x.id===id); modal('Delete '+u.name+'?',`<p style="margin:0">${esc(u.email)} will no longer be able to sign in. This cannot be undone. To block sign-in but keep the account, deactivate it instead.</p>`,`<button class="btn" data-close="1">Keep user</button><button class="btn danger" data-act="delUserYes" data-id="${esc(id)}">Delete user</button>`); },
  delUserYes(id){ const u=AUTH.deleteUser(id); done(u.name+' deleted.'); },
  newRole(){ adminOnly(); const roles=Object.keys(AUTH.roles()).filter(r=>r!==AUTH.ADMIN);
    form('New role',[{id:'name',label:'Role name',req:1},{id:'copy',label:'Start with the access of',type:'select',options:[['','Nothing (Home only)'],...roles.map(r=>[r,r])]}],v=>{ const n=AUTH.addRole(v.name,v.copy); done(n+' added. Tick the modules it can open, then save.'); },'Add role'); },
  delRole(name){ adminOnly(); modal('Delete role '+name+'?','<p style="margin:0">The role is removed. Users must have another role first.</p>',`<button class="btn" data-close="1">Keep role</button><button class="btn danger" data-act="delRoleYes" data-id="${esc(name)}">Delete role</button>`); },
  delRoleYes(name){ AUTH.deleteRole(name); done('Role '+name+' deleted.'); },
  newBooking(){ form('Space request',[{id:'company',label:'Company',req:1},{id:'contact',label:'Contact email'},{id:'type',label:'Storage type',type:'select',options:['Ambient','Chilled','Frozen'].map(x=>[x,x])},{id:'pallets',label:'Pallets',type:'number',value:20,req:1},{id:'from',label:'Start date',type:'date',value:addDays(today(),7)},{id:'months',label:'Months',type:'number',value:6}],v=>{ const b=OPS.book(v); done(b.id+' logged.'); },'Submit request'); },
  bookOK(id){ S.bookings.find(b=>b.id===id).status='Approved'; done(id+' approved.'); },
  bookNo(id){ S.bookings.find(b=>b.id===id).status='Declined'; done(id+' declined.'); },
  importOrders(){
    const txt=$('#imp').value.trim(); const msg=$('#impMsg'); const errs=[]; const groups={};
    txt.split('\n').forEach((ln,i)=>{ if(!ln.trim())return; const p=ln.split(',').map(x=>x.trim()); if(p.length<6){errs.push(`Line ${i+1}: needs 6 values.`);return;}
      const [cl,w,cust,due,sku,qty]=p; if(!S.clients.some(c=>c.id===cl))errs.push(`Line ${i+1}: unknown client ${cl}.`); else if(!S.warehouses.some(x=>x.id===w))errs.push(`Line ${i+1}: unknown warehouse ${w}.`); else if(item(sku).client!==cl)errs.push(`Line ${i+1}: ${sku} is not an item of ${cl}.`); else if(!(+qty>0))errs.push(`Line ${i+1}: quantity must be above 0.`); else { const k=[cl,w,cust,due].join('|'); (groups[k]=groups[k]||{client:cl,wh:w,customer:cust,due,lines:[]}).lines.push({sku,qty}); } });
    if(errs.length){ msg.innerHTML=`<div class="err">${errs.map(esc).join('<br>')}</div>`; return; }
    const ids=Object.values(groups).map(g=>OPS.createOrder(g).id); save(); toast(ids.length+' orders created: '+ids.join(', ')); go('orders.all'.split('.')[0],'all');
  },
  copyCSV(kind){
    let rows=[];
    if(kind==='stock'||kind==='expiry') rows=[['LPN','Client','SKU','Item','Warehouse','Bin','Batch','Expiry','Qty','Allocated','Status'],...S.stock.map(s=>[s.lpn,client(s.client).name,s.sku,item(s.sku).name,s.wh,s.bin,s.batch,s.expiry,s.qty,s.alloc,s.status])];
    if(kind==='balance'){ const g={}; S.stock.forEach(s=>{const k=s.client+'|'+s.sku+'|'+s.wh;(g[k]=g[k]||[client(s.client).name,s.sku,item(s.sku).name,s.wh,0]);g[k][4]+=s.qty;}); rows=[['Client','SKU','Item','Warehouse','On hand'],...Object.values(g)]; }
    const csv=rows.map(r=>r.map(v=>/[",\n]/.test(String(v))?'"'+String(v).replace(/"/g,'""')+'"':v).join(',')).join('\n');
    const fallback=()=>modal('CSV',`<p class="note" style="margin:0">Select all and copy.</p><textarea class="mono" rows="12" style="width:100%" readonly>${esc(csv)}</textarea>`);
    try{ navigator.clipboard.writeText(csv).then(()=>toast('Copied '+(rows.length-1)+' rows. Paste into Excel.'),fallback); }catch(e){ fallback(); }
  },
  reset(){ $('#resetBox').innerHTML=`<div class="row"><span>This deletes every client, warehouse, item, order and invoice in this browser. Users and roles are kept. It cannot be undone.</span><button class="btn danger" data-act="resetYes">Yes, clear all data</button></div>`; },
  resetYes(){ adminOnly(); fresh(); done('All data cleared.'); }
};

/* ================= rendering + events ================= */
function render(){
  renderSide();
  const fn=V[route.m+'.'+route.s]||V['home.dash'];
  $('#view').innerHTML=fn();
  if(route.s==='itemform') updateItemForm();
  document.title=(route.m==='home'?'':MOD[route.m].t+' · ')+'Gray Lane 3PL ERP';
}
function runAct(name,id){ try{ ACT[name](id); }catch(e){ toast(e.message); } }
document.addEventListener('click',e=>{
  if(document.body.classList.contains('menu-open')&&!e.target.closest('#side,#menuBtn')){ closeMenu(); e.preventDefault(); return; }
  const t=e.target.closest('[data-nav],[data-go],[data-act],[data-open],[data-close],[data-addline],[data-delline],[data-delrow],[data-scrim]');
  if(!t) return;
  if(t.dataset.delrow){ t.closest('.crow').remove(); return; }
  if(t.dataset.scrim&&e.target!==t) return;
  if(t.dataset.nav){ const m=t.dataset.nav;
    if(route.m===m&&openMods.has(m)) openMods.delete(m);
    else { const keep=document.body.classList.contains('menu-open')&&MOD[m].subs.length>1; go(m); if(keep){ $('#side').classList.add('show'); document.body.classList.add('menu-open'); } }
    renderSide(); return; }
  if(t.dataset.go){ const [m,s]=t.dataset.go.split('.'); closeModal(); go(m,s); return; }
  if(t.dataset.act){ e.stopPropagation(); const close=t.dataset.close; if(close) closeModal(); runAct(t.dataset.act,t.dataset.id); return; }
  if(t.dataset.open){ openDetail(t.dataset.open,t.dataset.id); return; }
  if(t.dataset.addline){ addLine(formSubmit.fields.find(f=>f.id===t.dataset.addline)); return; }
  if(t.dataset.delline){ t.closest('.line').remove(); return; }
  if(t.dataset.close||t.dataset.scrim) closeModal();
});
document.addEventListener('submit',e=>{
  e.preventDefault();
  if(e.target.id==='mForm'&&formSubmit){
    const fail=err=>{ const el=$('#mErr'); if(el) el.textContent=err.message; }, sb=e.submitter;
    try{ const r=formSubmit.onSubmit(readForm()); if(r&&r.then){ if(sb) sb.disabled=true; r.catch(fail).finally(()=>{ if(sb&&document.contains(sb)) sb.disabled=false; }); } }catch(err){ fail(err); } }
  if(e.target.id==='roleForm'){
    try{ adminOnly(); const by={};
      e.target.querySelectorAll('.acc:not(:disabled)').forEach(i=>{ (by[i.dataset.role]=by[i.dataset.role]||[]); if(i.checked) by[i.dataset.role].push(i.value); });
      Object.entries(by).forEach(([r,m])=>AUTH.setRoleAccess(r,m)); render(); toast('Permissions saved.');
    }catch(err){ toast(err.message); }
    return;
  }
  if(e.target.id==='itemForm'){
    try{
      const d=readItemForm(), r=OPS.saveItem(d,itemEdit); save();
      const andNew=e.submitter&&e.submitter.dataset.andNew, wasEdit=!!itemEdit;
      toast(wasEdit?`${r.item.sku} updated.`:`${r.item.code} · ${r.item.sku} created${r.variants?` with ${r.variants} variants`:''}${r.opening?`, ${n0(r.opening)} ${r.item.uom} opening stock`:''}.`);
      itemEdit=null;
      if(andNew){ render(); try{ window.scrollTo(0,0); }catch(_){} $('#it_name').focus(); }
      else { go('master','items'); openDetail('item',r.item.sku); }
    }catch(err){ const el=$('#itErr'); el.textContent=err.message; try{ el.scrollIntoView({block:'center'}); }catch(_){} }
    return;
  }
  if(e.target.id==='coForm'){ const fd=new FormData(e.target); ['name','vat','cr','city'].forEach(k=>S.company[k]=fd.get(k)); save(); render(); toast('Company details saved.'); }
});
document.addEventListener('change',e=>{
  if(e.target.closest&&e.target.closest('#itemForm')){ updateItemForm(e.target); return; }
  const f=e.target.dataset.filt; if(f){ const [k,id]=f.split('.'); (filt[k]=filt[k]||{})[id]=e.target.value; render(); return; }
  if(e.target.id==='f_role'&&$('#rolePrev')){ $('#rolePrev').innerHTML=roleSummaryLong(e.target.value); return; }
  if(e.target.id==='f_client'){ const opts=lineItemOpts(); document.querySelectorAll('.line select[data-col="sku"]').forEach(s=>{ s.innerHTML=opts.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join(''); }); }
});
let qT; document.addEventListener('input',e=>{
  if(e.target.closest&&e.target.closest('#itemForm')){ updateItemForm(e.target); return; }
  const f=e.target.dataset.filt; if(f){ clearTimeout(qT); qT=setTimeout(()=>{ const [k,id]=f.split('.'); (filt[k]=filt[k]||{})[id]=e.target.value; const pos=e.target.selectionStart; render(); const el=document.querySelector(`[data-filt="${f}"]`); if(el){ el.focus(); try{el.setSelectionRange(pos,pos);}catch(_){} } },220); }
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ if($('#modalRoot').innerHTML) closeModal(); else closeMenu(); return; }
  if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('tr.click')){ e.preventDefault(); openDetail(e.target.dataset.open,e.target.dataset.id); }
});
$('#menuBtn').addEventListener('click',()=>{ const on=$('#side').classList.toggle('show'); document.body.classList.toggle('menu-open',on); });
window.addEventListener('popstate',()=>{ closeModal(); parseHash(); render(); });
$('#q').addEventListener('keydown',e=>{
  if(e.key!=='Enter') return; const q=e.target.value.trim().toUpperCase(); if(!q) return;
  const hit=[['order',S.orders.find(o=>o.id===q)],['asn',S.asns.find(a=>a.id===q)],['grn',S.grns.find(g=>g.id===q)],['invoice',S.invoices.find(v=>v.id===q)],['item',S.items.find(i=>i.sku===q)]].find(x=>x[1]);
  if(hit) return openDetail(hit[0],hit[1].id||hit[1].sku);
  const lpn=S.stock.find(s=>s.lpn===q); if(lpn){ filt.stk={q}; return go('inventory','stock'); }
  const cl=S.clients.find(c=>c.name.toUpperCase().includes(q)); if(cl) return openDetail('client',cl.id);
  filt.stk={q:e.target.value.trim()}; go('inventory','stock'); toast('Showing stock matching "'+e.target.value.trim()+'".');
});

$('#signOut').addEventListener('click',()=>{ AUTH.signOut(); location.replace('login.html'); });
// Another tab signed out (or in as someone else): follow it.
// Session, user or role changes from another tab (or by an admin): follow them.
function checkSession(){ const s=AUTH.get(); if(!s||s.id!==ME.id){ location.replace('login.html'); return; } if(s.role!==ME.role){ location.reload(); return; } fillUser(); renderSide(); }
function fillUser(){ const s=AUTH.get()||ME; $('#userName').textContent=s.name; $('#userRole').textContent=s.role+(s.title&&s.title!==s.role?' · '+s.title:'');
  $('#userAvatar').textContent=s.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase(); }
window.addEventListener('storage',e=>{ if(e.key==='lanewms-session'||e.key==='lanewms-auth') checkSession(); });

/* boot (only when signed in; otherwise auth.js is already redirecting to login.html) */
if(ME){
  fillUser();
  S=load();
  if(!S||!Array.isArray(S.clients)) fresh(); else { normalizeItems(); save(); }
  parseHash();
  try{ history.replaceState(null,'','#'+route.m+'.'+route.s); }catch(e){}
  try{ render(); }
  catch(err){ console.error(err); fresh(); route={m:'home',s:'dash'}; render(); toast('Saved data could not be read, so the app was started empty.'); }
  setInterval(checkSession,60000); // session expiry and admin changes
}
