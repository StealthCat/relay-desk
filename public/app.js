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
  if(r.ok)d.addEventListener('toggle',()=>{if(d.open && d.children.length===1)d.append(tree(r.value))});else d.append(el('p',r.error==='HTTP 404'?'This route is unavailable on this repeater.':r.error,'error'))
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
    for(const [key,color] of [['rx','#83ebd2'],['tx','#ffb05c']]){
      c.beginPath();points.forEach((v,i)=>{const x=4+892*(v.time-points[0].time)/(latest.time-points[0].time),y=200-190*v[key]/max;i?c.lineTo(x,y):c.moveTo(x,y)});c.strokeStyle=color;c.lineWidth=3;c.stroke()
    }
    p.append(el('small','Mint RX · Amber TX · '+time(points[0].time)+' – '+time(latest.time)))
  }
  return p
}
// A seven-segment display for actual whole-number packet counters.
const segmentPaths = [
  'M3 1h10l-2 2H5z','M14 2v8l-2-1V4z','M14 12v8l-2-2v-5z',
  'M3 21l2-2h6l2 2z','M2 12l2 1v5l-2 2z','M2 2l2 2v5l-2 1z','M3 11l2-1h6l2 1-2 1H5z'
]
const digitSegments = ['abcdef','bc','abdeg','abcdg','bcfg','acdfg','acdefg','abc','abcdefg','abcdfg']
function counterDisplay(value){
  const readout=el('strong',format(value))
  if(!Number.isSafeInteger(value) || value<0 || value>99999999)return readout
  const digits=String(value)
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg')
  svg.setAttribute('viewBox','0 0 '+digits.length*17+' 23')
  svg.setAttribute('aria-hidden','true')
  svg.classList.add('counter-digits')
  Array.from(digits).forEach((digit,index)=>{
    segmentPaths.forEach((shape,segment)=>{
      const path=document.createElementNS(svg.namespaceURI,'path')
      path.setAttribute('d',shape)
      path.setAttribute('transform','translate('+index*17+' 0)')
      if(!digitSegments[Number(digit)].includes('abcdefg'[segment]))path.setAttribute('opacity','.09')
      svg.append(path)
    })
  })
  readout.replaceChildren(el('span',format(value),'visually-hidden'),svg)
  return readout
}
function overview(r){
  const s=unpack(r.value)||{}, m=el('div',null,'metrics')
  for(const [label,display] of [
    ['Uptime',el('strong',uptime(s.uptime_secs))],
    ['Packets received',counterDisplay(s.packets_received)],
    ['Packets sent',counterDisplay(s.packets_sent)],
    ['Radio',el('strong',s.radio_type??'—')]
  ]){
    const n=el('div',null,'metric')
    n.append(el('span',label.toUpperCase(),'eyebrow'),display)
    m.append(n)
  }
  const grid=el('div',null,'two'),identity=panel('Repeater identity')
  identity.append(row('Site',s.site_name),row('Repeater version',s.version),row('Core version',s.core_version))
  grid.append(activity(r.history||[]),identity)
  return [m,grid]
}
function render(paths,results){
  const c=$('content'),opened=new Set([...c.querySelectorAll('details[open]')].map(d=>d.firstChild.textContent))
  c.replaceChildren()
  const stats=results[paths.indexOf('stats')],s=unpack(stats?.value)||{}
  if(page==='Overview' && stats?.ok)c.append(...overview(stats))
  {
    const subsets={'Telemetry & sensors':['sensors'],'GPS & location':['gps'],'Radio & RF':['radio','radio_type','radios','radio_stack','fabric','sx1262','modem_tcp','modem_usb','ch341','kiss'],'Network & connectivity':['network','connectivity','fabric'],'System & hardware':['version','core_version','uptime_secs','radio_stack']}
    const keys=(subsets[page]||[]).filter(k=>Object.hasOwn(s,k))

    if(page==='GPS & location'){
      const gps=unpack(results[0].value)??s.gps,pos=gps?.position
      const usable=Number.isFinite(pos?.latitude) && Math.abs(pos.latitude)<=90 &&
        Number.isFinite(pos?.longitude) && Math.abs(pos.longitude)<=180
      showMap(usable ? pos : null,gps?.status)
      if(usable){
        const card=panel('Reported position');card.append(row('Latitude',pos.latitude),row('Longitude',pos.longitude),row('Fix valid',gps.status?.fix_valid),row('Stale',gps.status?.stale))
        const a=el('a','View coordinates on OpenStreetMap ↗');a.href='https://www.openstreetmap.org/?mlat='+pos.latitude+'&mlon='+pos.longitude;a.target='_blank';a.rel='noreferrer';card.append(a);c.append(card)
      }
    }
    paths.forEach((p,i)=>{
      const r=results[i]
      if(!r.ok)return
      if(p==='stats' && Object.hasOwn(subsets,page)){
        if(keys.length)c.append(instrumentViews.render(p,Object.fromEntries(keys.map(k=>[k,s[k]])),node.id,r.time,'Reported '+page.toLowerCase()))
        return
      }
      c.append(instrumentViews.render(p,unpack(r.value),node.id,r.time))
    })
    const raw=el('section',null,'raw-sources')
    raw.append(el('h2','API responses'))
    paths.forEach((p,i)=>raw.append(resource('/api/'+p,results[i])))
    c.append(raw)
  }
  c.querySelectorAll('details').forEach(d=>{if(opened.has(d.firstChild.textContent))d.open=true})
}
function showMap(pos,status){
  const screen=$('map-screen')
  $('map-panel').hidden=false
  const stale=status?.stale===true, invalid=status?.fix_valid===false
  $('map-status').textContent=!pos?'No coordinates reported.':stale?'Last reported position · stale GPS reading':invalid?'Reported position · no valid GPS fix':'Reported repeater position'
  if(!pos){screen.replaceChildren();return}
  const {latitude:lat,longitude:lon}=pos
  const span=.022/Math.max(.1,Math.cos(lat*Math.PI/180))
  const bbox=[Math.max(-180,lon-span),Math.max(-90,lat-.014),Math.min(180,lon+span),Math.min(90,lat+.014)]
  const src='https://www.openstreetmap.org/export/embed.html?'+new URLSearchParams({bbox:bbox.join(','),layer:'mapnik',marker:lat+','+lon})
  if(screen.firstChild?.src===src)return
  const frame=el('iframe')
  frame.title=node.name+' GPS location on OpenStreetMap'
  frame.referrerPolicy='no-referrer';frame.src=src
  screen.replaceChildren(frame)
}
async function refresh(reset=false){
  if(!node)return
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
  $('map-panel').hidden=true
  $('map-screen').replaceChildren()
  node=fleet.nodes.find(n=>n.id===$('node').value)
  const empty=!node
  $('node').disabled=empty
  $('refresh').hidden=empty
  $('empty-fleet').hidden=!empty
  $('station').textContent=node?.name || ''
  $('title').textContent=page
  $('mode').textContent=empty?'':fleet.nodes.length+(fleet.nodes.length===1?' repeater':' repeaters')
  for(const button of $('nav').children){
    button.disabled=empty
    button.setAttribute('aria-current',button.textContent===page?'page':'false')
  }
  if(empty){
    ++epoch
    busy=false
    $('state').textContent=''
    $('content').replaceChildren()
    return
  }
  refresh(true)
}
function setFleet(data,selected){
  fleet=data
  $('node').replaceChildren()
  for(const n of fleet.nodes){
    const o=el('option',n.name);o.value=n.id;$('node').append(o)
  }
  if(fleet.nodes.some(n=>n.id===selected))$('node').value=selected
  if(!fleet.nodes.length)page='Overview'
  select()
}
function renderManager(){
  const list=$('managed-list')
  list.replaceChildren()
  for(const n of fleet.nodes){
    const item=el('div',null,'row'),remove=el('button','Remove')
    remove.type='button';remove.setAttribute('aria-label','Remove '+n.name)
    remove.onclick=()=>{if(window.confirm('Remove '+n.name+' from Relay Desk?')) changeFleet('DELETE','/api/repeaters/'+n.id)}
    item.append(el('span',n.name),remove);list.append(item)
  }
  if(!list.children.length)list.append(el('p','No repeaters configured.','muted'))
}
let saving=false
async function changeFleet(method,url,body){
  if(saving)return
  saving=true
  const buttons=[...$('manager').querySelectorAll('button:not(#dismiss)')]
  buttons.forEach(b=>b.disabled=true)
  $('manager-status').textContent='Saving…'
  try{
    const response=await fetch(url,{method,headers:{'Content-Type':'application/json','X-Relay-Desk':'fleet'},body:JSON.stringify(body)})
    const data=await response.json()
    if(!response.ok)throw Error(data.error||'Could not update the fleet.')
    if(method==='POST')$('add-form').reset()
    setFleet(data,data.selected??node?.id);renderManager()
    $('manager-status').textContent=method==='POST'?'Repeater added.':'Repeater removed.'
  }catch(err){$('manager-status').textContent=err.message}
  finally{saving=false;buttons.forEach(b=>b.disabled=false)}
}
async function init(){
  try{
    fleet=await (await fetch('/api/fleet')).json()
    $('manage').onclick=()=>{renderManager();$('manager-status').textContent='';$('manager').showModal()}
    $('empty-manage').onclick=$('manage').onclick
    $('dismiss').onclick=()=>$('manager').close()
    $('manager').addEventListener('close',()=>$('repeater-token').value='')
    $('add-form').onsubmit=e=>{
      e.preventDefault()
      changeFleet('POST','/api/repeaters',{name:$('repeater-name').value,url:$('repeater-url').value,apiKey:$('repeater-token').value})
    }
    for(const name of Object.keys(fleet.pages)){const b=el('button',name);b.onclick=()=>{page=name;select()};$('nav').append(b)}
    $('node').onchange=select;$('refresh').onclick=()=>refresh();setFleet(fleet)
    setInterval(()=>{if(!document.hidden)refresh()},30000)
  }catch{$('state').textContent='Could not load repeater inventory. Reload to retry.'}
}
init()
