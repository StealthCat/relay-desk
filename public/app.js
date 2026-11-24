'use strict'
const $=id=>document.getElementById(id)
const el=(tag,txt,cls)=>{const n=document.createElement(tag);if(txt!=null)n.textContent=String(txt);if(cls)n.className=cls;return n}
const human=k=>k.replaceAll('_',' ')
const format=v=>v==null?'—':typeof v==='number'?v.toLocaleString(undefined,{maximumFractionDigits:8}):String(v)
const unpack=v=>v?.data??v
const time=v=>new Date(v).toLocaleTimeString()
const uptime=s=>Number.isFinite(s)?Math.floor(s/86400)+'d '+Math.floor(s%86400/3600)+'h '+Math.floor(s%3600/60)+'m':'—'
let fleet,page='Overview',node,epoch=0,busy=false
function row(k,v){const r=el('div',null,'row');r.append(el('span',k),el('span',format(v)));return r}
function panel(title){const n=el('section',null,'panel');n.append(el('h2',title));return n}
function tree(value){
  const n=el('div')
  if(value===null || typeof value!=='object'){n.append(el('p',format(value)));return n}
  const entries=Object.entries(value)
  if(!entries.length)n.append(el('p',Array.isArray(value)?'No entries':'No fields','muted'))
  for(const [k,v] of entries){
    if(v!==null && typeof v==='object'){
      const d=el('details',null,'nested');d.append(el('summary',human(k)+' · '+Object.keys(v).length))
      d.addEventListener('toggle',()=>{if(d.open && d.children.length===1)d.append(tree(v))})
      n.append(d)
    }else n.append(row(human(k),v))
  }
  return n
}
function resource(title,r,open=false){
  const d=el('details',null,'resource'),s=el('summary',title)
  s.append(el('small',r.ok?'Available':r.error,r.ok?'':'error'));d.append(s)
  if(r.ok)d.append(tree(r.value));else d.append(el('p',r.error==='HTTP 404'?'This route is unavailable on this repeater.':r.error,'error'))
  d.open=open;return d
}
function activity(samples){
  const p=panel('Packet activity'),points=[]
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i],mins=(b.time-a.time)/60000
    if([a.rx,b.rx,a.tx,b.tx].every(Number.isFinite) && mins>0 && mins<2 && b.rx>=a.rx && b.tx>=a.tx)points.push({rx:(b.rx-a.rx)/mins,tx:(b.tx-a.tx)/mins,time:b.time})
  }
  if(!points.length){p.append(el('p','Waiting for two consecutive RX and TX counter readings.','muted'));return p}
  const latest=points.at(-1)
  p.append(row('Received / min',latest.rx.toFixed(1)),row('Sent / min',latest.tx.toFixed(1)))
  if(points.length>1){
    const canvas=el('canvas');canvas.width=900;canvas.height=210;canvas.setAttribute('aria-label','Received and sent packets per minute over recent samples')
    p.append(canvas);const c=canvas.getContext('2d'),max=Math.max(1,...points.flatMap(v=>[v.rx,v.tx]))
    for(const [key,color] of [['rx','#2d724d'],['tx','#97612d']]){
      c.beginPath();points.forEach((v,i)=>{const x=4+892*(v.time-points[0].time)/(latest.time-points[0].time),y=200-190*v[key]/max;i?c.lineTo(x,y):c.moveTo(x,y)});c.strokeStyle=color;c.lineWidth=3;c.stroke()
    }
    p.append(el('small','Green RX · Brown TX · '+time(points[0].time)+' – '+time(latest.time)))
  }
  return p
}
function overview(r){
  const s=unpack(r.value)||{}, m=el('div',null,'metrics')
  for(const [k,v] of [['Uptime',uptime(s.uptime_secs)],['Packets received',format(s.packets_received)],['Packets sent',format(s.packets_sent)],['Radio',s.radio_type??'—']]){
    const n=el('div',null,'metric');n.append(el('span',k.toUpperCase(),'eyebrow'),el('strong',v));m.append(n)
  }
  const grid=el('div',null,'two'),identity=panel('Repeater identity')
  identity.append(row('Site',s.site_name),row('Repeater version',s.version),row('Core version',s.core_version))
  grid.append(activity(r.history||[]),identity)
  return [m,grid,resource('All repeater statistics',r)]
}
function render(paths,results){
  const c=$('content'),opened=new Set([...c.querySelectorAll('details[open]')].map(d=>d.firstChild.textContent))
  c.replaceChildren()
  if(node.demo)c.append(el('p','Sample repeater · Add your API address to config/repeaters.json to monitor live hardware.','guide'))
  const stats=results[paths.indexOf('stats')],s=unpack(stats?.value)||{}
  if(page==='Overview' && stats?.ok)c.append(...overview(stats))
  else {
    const subsets={'Telemetry & sensors':['sensors'],'GPS & location':['gps'],'Radio & RF':['radio','radio_type','radios','radio_stack','fabric','sx1262','modem_tcp','modem_usb','ch341','kiss'],'Network & connectivity':['network','connectivity','fabric'],'System & hardware':['version','core_version','uptime_secs','radio_stack']}
    const keys=(subsets[page]||[]).filter(k=>Object.hasOwn(s,k))
    if(keys.length)c.append(resource('Reported '+page.toLowerCase(),{ok:true,value:Object.fromEntries(keys.map(k=>[k,s[k]]))},true))
    if(page==='GPS & location'){
      const gps=unpack(results[0].value)??s.gps,pos=gps?.position
      if(Number.isFinite(pos?.latitude)&&Number.isFinite(pos?.longitude)){
        const card=panel('Reported position');card.append(row('Latitude',pos.latitude),row('Longitude',pos.longitude),row('Fix valid',gps.status?.fix_valid),row('Stale',gps.status?.stale))
        const a=el('a','View coordinates on OpenStreetMap ↗');a.href='https://www.openstreetmap.org/?mlat='+pos.latitude+'&mlon='+pos.longitude;a.target='_blank';a.rel='noreferrer';card.append(a);c.append(card)
      }
    }
    paths.forEach((p,i)=>c.append(resource('/api/'+p,results[i],i===0 && !keys.length)))
  }
  c.querySelectorAll('details').forEach(d=>{if(opened.has(d.firstChild.textContent))d.open=true})
}
async function refresh(reset=false){
  if(!fleet)return
  if(busy&&!reset)return
  const id=++epoch;busy=true
  if(reset)$('content').replaceChildren()
  $('state').textContent='Reading '+node.name+'…';$('refresh').disabled=true
  const paths=fleet.pages[page]
  try{
    const results=await Promise.all(paths.map(async p=>{
      const r=await fetch('/api/reading?'+new URLSearchParams({node:node.id,path:p}));if(!r.ok)throw Error('Dashboard unavailable');return r.json()
    }))
    if(id!==epoch)return
    render(paths,results)
    const ok=results.filter(r=>r.ok).length
    $('state').textContent=ok+' of '+paths.length+' sources available · Checked '+time(Math.min(...results.map(r=>r.time)))+(results.some(r=>/HTTP 40[13]/.test(r.error))?' · Check this repeater’s API token and permissions.':'')
    if(page==='Overview' && fleet.nodes.length>1) await showFleet(id,results[0])
  }catch{if(id===epoch)$('state').textContent='Dashboard connection lost. Displayed readings may be stale.'}
  finally{if(id===epoch){busy=false;$('refresh').disabled=false}}
}
async function showFleet(id,selected){
  const card=panel('Fleet status')
  $('content').prepend(card)
  for(let i=0;i<fleet.nodes.length;i+=4){
    if(id!==epoch)return
    await Promise.all(fleet.nodes.slice(i,i+4).map(async n=>{
      const line=el('div',null,'row'),button=el('button',n.name),state=el('span','Checking…')
      button.onclick=()=>{$('node').value=n.id;select()}
      line.append(button,state);card.append(line)
      try{
        const r=n.id===node.id?selected:await (await fetch('/api/reading?'+new URLSearchParams({node:n.id,path:'stats'}))).json()
        state.textContent=(r.ok?'Reachable':r.error)+' · '+time(r.time)
      }catch{state.textContent='Dashboard unavailable'}
    }))
  }
}
function select(){
  node=fleet.nodes.find(n=>n.id===$('node').value);$('mode').textContent=node.demo?'● SAMPLE DATA':'● CONFIGURED FLEET'
  $('station').textContent=node.name.toUpperCase();$('title').textContent=page
  for(const b of $('nav').children)b.setAttribute('aria-current',b.textContent===page?'page':'false')
  refresh(true)
}
async function init(){
  try{
    fleet=await (await fetch('/api/fleet')).json()
    for(const n of fleet.nodes){const o=el('option',n.name);o.value=n.id;$('node').append(o)}
    for(const name of Object.keys(fleet.pages)){const b=el('button',name);b.onclick=()=>{page=name;select()};$('nav').append(b)}
    $('node').onchange=select;$('refresh').onclick=()=>refresh();select()
    setInterval(()=>{if(!document.hidden)refresh()},30000)
  }catch{$('state').textContent='Could not load repeater inventory. Reload to retry.'}
}
init()
