/* Render read-only API payloads without assuming every firmware has the same fields. */
const instrumentViews = (() => {
  const titles = {
    stats:'Repeater statistics', hardware_stats:'Hardware utilization', hardware_processes:'Processes',
    site_info:'Host information', gps:'GPS receiver', noise_floor_stats:'Noise floor',
    lbt_diagnostics:'Listen before talk', crc_error_count:'CRC errors', airtime_data:'Airtime records',
    mqtt_status:'MQTT connections', neighbor_links:'Neighbour links', sensors_config:'Sensor configuration',
    sensors_types:'Supported sensors', route_stats:'Routes', neighbor_scopes:'Neighbour scopes',
    packet_type_stats:'Packet types', packet_stats:'Packet statistics', 'plugins/':'Installed plugins',
    room_stats:'Room services', 'companion/stats':'Companion service', web_frontends:'Web frontends',
    db_stats:'Database', advert_rate_limit_stats:'Advert rate limits', acl_stats:'Access control',
    'config_export?include_secrets=false':'Repeater configuration'
  }
  const observations=new Map()
  const offsets=new Map()
  const isRecord=v=>v!==null && typeof v==='object' && !Array.isArray(v)
  const scalar=v=>v===null || typeof v!=='object'
  const label=k=>human(k)
    .replace(/\b(cpu|ram|gps|mqtt|rf|snr|rssi|crc|usb|tcp|udp)\b/gi,s=>s.toUpperCase())
    .replace(/\bdbm\b/gi,'dBm').replace(/\bdb\b/gi,'dB')
    .replace(/\btemp(?:erature)? c$/i,'temperature (°C)')
    .replace(/^./,c=>c.toUpperCase())
  const isPercent=k=>/(^|[ _])(?:percent(?:age)?|pct)(?:$|[ _])/i.test(k)
  const trackable=k=>isPercent(k)||/(temperature|temp_c|voltage|humidity|current_ma|power_mw|power_w|rssi|snr|noise_floor|speed_kmh|altitude_m|load_avg)/i.test(k)
  function showValue(key,value) {
    if(value===null)return el('span','—','reading-null')
    if(typeof value==='boolean')return el('span',value?'Yes':'No',value?'flag on':'flag off')
    if(typeof value==='string' && /^(status|state)$/i.test(key))return el('span',value,'flag')
    const text=el('span',format(value)+(isPercent(key)&&Number.isFinite(value)?'%':''))
    return text
  }
  function makeMeter(name,value,max) {
    const meter=el('meter')
    meter.min=0;meter.max=max;meter.value=value
    meter.setAttribute('aria-label',name)
    return meter
  }
  function recent(ctx,path,value) {
    if(!Number.isFinite(value) || !Number.isFinite(ctx.time))return []
    const id=JSON.stringify([ctx.node,ctx.source,...path])
    let samples=observations.get(id)
    if(!samples){
      if(observations.size>=1000)observations.delete(observations.keys().next().value)
      observations.set(id,samples=[])
    }
    if(samples.length && ctx.time-samples.at(-1).t>120000)samples.length=0
    if(!samples.length || ctx.time>samples.at(-1).t)samples.push({t:ctx.time,v:value})
    if(samples.length>40)samples.shift()
    return samples
  }
  function spark(samples,name) {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg')
    svg.setAttribute('viewBox','0 0 200 32');svg.setAttribute('preserveAspectRatio','none')
    svg.setAttribute('role','img')
    const values=samples.map(s=>s.v),lo=Math.min(...values),hi=Math.max(...values)
    const description=name+' from '+time(samples[0].t)+' to '+time(samples.at(-1).t)+', min '+format(lo)+', max '+format(hi)
    svg.setAttribute('aria-label',description)
    const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=description
    const line=document.createElementNS(svg.namespaceURI,'polyline')
    const span=samples.at(-1).t-samples[0].t
    line.setAttribute('points',samples.map(s=>{
      const x=2+196*(s.t-samples[0].t)/span
      const y=hi===lo?16:29-26*(s.v-lo)/(hi-lo)
      return x+','+y
    }).join(' '))
    svg.append(title,line);svg.classList.add('history-line')
    const figure=el('figure',null,'mini-history')
    figure.append(svg,el('figcaption',format(lo)+' – '+format(hi)+' · '+Math.round(span/1000)+' s'))
    return figure
  }
  function hardwareValue(k,v,path){
    if(!Number.isFinite(v))return null
    const group=path.at(-1)
    const capacity=['memory','disk'].includes(group) && ['total','available','used','free'].includes(k)
    if(capacity || (group==='network' && ['bytes_sent','bytes_recv'].includes(k))){
      if(v<0)return null
      const units=['B','KiB','MiB','GiB','TiB','PiB']
      const i=Math.min(units.length-1,Math.max(0,Math.floor(Math.log2(v||1)/10)))
      return (v/1024**i).toLocaleString(undefined,{maximumFractionDigits:2})+' '+units[i]
    }
    if(group==='system' && k==='uptime')return uptime(v)
    if(group==='system' && k==='boot_time')return new Date(v*1000).toLocaleString()
    if(group==='temperatures')return v.toLocaleString(undefined,{maximumFractionDigits:1})+' °C'
    if(group==='load_avg')return v.toFixed(2)
    return null
  }
  function tile(k,v,ctx,path) {
    const card=el('div',null,'reading'),heading=label(k)
    const display=ctx.source==='hardware_stats'?hardwareValue(k,v,path):null
    const reading=display===null?showValue(k,v):el('span',display)
    if(display!==null)reading.title=String(v)
    card.append(el('span',heading,'reading-label'),reading)
    if(ctx.source!=='hardware_stats' && isPercent(k)&&Number.isFinite(v)&&v>=0&&v<=100)card.append(makeMeter(heading,v,100))
    if(trackable(path.concat(k).join('_')) && !ctx.configuration){
      const samples=recent(ctx,[...path,k],v)
      if(samples.length>=2)card.append(spark(samples,heading))
    }
    return card
  }
  function paged(items,ctx,path,per,paint) {
    const id=JSON.stringify([ctx.node,ctx.source,...path]),box=el('div')
    let start=Math.min(offsets.get(id)||0,Math.max(0,Math.floor((items.length-1)/per)*per))
    function draw(){
      box.replaceChildren(paint(items.slice(start,start+per)))
      if(items.length<=per)return
      const bar=el('div',null,'viz-pager')
      const prev=el('button','Previous'),next=el('button','Next')
      prev.disabled=start===0;next.disabled=start+per>=items.length
      function move(delta){start+=delta;offsets.set(id,start);draw()}
      prev.onclick=()=>move(-per);next.onclick=()=>move(per)
      bar.append(prev,el('small',(start+1)+'–'+Math.min(start+per,items.length)+' of '+items.length),next)
      box.append(bar)
    }
    draw();return box
  }
  function table(rows,ctx,path){
    const columns=[...new Set(rows.flatMap(record=>Object.keys(record)))]
    const compare=columns.find(k=>/^(count|packet_count|total_packets|cpu_percent|memory_percent|packets)$/i.test(k))
    const max=compare?rows.reduce((n,r)=>Number.isFinite(r[compare])?Math.max(n,r[compare]):n,0):0
    return paged(rows,ctx,path,15,slice=>{
      const scroller=el('div',null,'viz-scroll'),t=el('table')
      const header=t.createTHead().insertRow()
      columns.forEach(k=>{const h=el('th',label(k));h.scope='col';header.append(h)})
      const body=t.createTBody()
      for(const record of slice){
        const tr=body.insertRow()
        columns.forEach(k=>{
          const td=tr.insertCell(),v=record[k]
          if(v===undefined){td.textContent='—';return}
          if(scalar(v)){
            td.append(showValue(k,v))
            if(k===compare && Number.isFinite(v) && v>=0 && max>0)td.append(makeMeter(label(k),v,isPercent(k)?Math.max(100,max):max))
          }else{
            const d=el('details');d.append(el('summary',Object.keys(v).length+' fields'))
            d.ontoggle=()=>{if(d.open && d.children.length===1)d.append(tree(v))}
            td.append(d)
          }
        })
      }
      scroller.append(t);return scroller
    })
  }
  function distribution(entries){
    const chart=el('div',null,'distribution')
    const max=entries.reduce((m,[,v])=>Math.max(m,v),0)
    for(const [key,value] of entries){
      const line=el('div',null,'bar-row')
      line.append(el('span',label(key)),makeMeter(label(key),value,max||1),el('strong',format(value)))
      chart.append(line)
    }
    return chart
  }
  function hardwareLoad(value){
    const loads=[]
    function find(obj,path){
      for(const [k,v] of Object.entries(obj)){
        if(isRecord(v))find(v,[...path,k])
        else if(isPercent(k) && Number.isFinite(v) && v>=0 && v<=100)loads.push([[...path,k].join(' / '),v])
      }
    }
    find(value,[])
    if(!loads.length)return null
    const graph=el('section',null,'viz-group')
    for(const [k,v] of loads){
      const name=label(k).replace(/(?:\s*\/\s*|[ _])(?:percent(?:age)?|pct)$/i,'') || label(k)
      const line=el('div',null,'bar-row')
      line.append(el('span',name),makeMeter(name,v,100),el('strong',format(v)+'%'))
      graph.append(line)
    }
    return graph
  }
  function noiseRange(data){
    const points=['min','avg','current','max'].filter(k=>Number.isFinite(data[k]))
    if(points.length<2)return null
    const lo=Math.min(...points.map(k=>data[k])),hi=Math.max(...points.map(k=>data[k]))
    if(lo===hi)return null
    const chart=el('section',null,'viz-group')
    chart.append(el('h3','Noise floor · '+format(lo)+' to '+format(hi)+' dBm'))
    for(const k of points){
      const line=el('div',null,'bar-row'),m=el('meter')
      m.min=lo;m.max=hi;m.value=data[k];m.setAttribute('aria-label',label(k)+' noise floor in dBm')
      line.append(el('span',label(k)),m,el('strong',format(data[k])+' dBm'))
      chart.append(line)
    }
    return chart
  }
  function traffic(rows){
    const bins=Array(16).fill(0)
    const times=[]
    for(const row of rows){
      const ts=row.timestamp
      if(typeof ts==='number' && Number.isFinite(ts))times.push(ts>1e12?ts:ts*1000)
      else if(typeof ts==='string' && /^\d{4}-\d\d-/.test(ts) && Number.isFinite(Date.parse(ts)))times.push(Date.parse(ts))
    }
    if(times.length<2)return null
    const lo=times.reduce((a,b)=>Math.min(a,b)),hi=times.reduce((a,b)=>Math.max(a,b))
    if(lo===hi || !Number.isFinite(new Date(hi).getTime()))return null
    for(const t of times)bins[Math.min(15,Math.floor(16*(t-lo)/(hi-lo)))]++
    const chart=el('figure',null,'traffic-plot'),bars=el('div',null,'traffic-bars')
    const max=Math.max(...bins)
    for(const [i,count] of bins.entries()){
      const start=lo+i*(hi-lo)/16,end=start+(hi-lo)/16
      const bar=el('progress');bar.max=max;bar.value=count
      bar.title=time(start)+' – '+time(end)+': '+count+' records';bar.setAttribute('aria-label',bar.title)
      bars.append(bar)
    }
    chart.append(el('figcaption','Packet records over time'),bars,el('small',new Date(lo).toLocaleString()+' – '+new Date(hi).toLocaleString()))
    return chart
  }
  function recordChart(rows,ctx){
    if(ctx.source==='airtime_data')return traffic(rows)
    if(ctx.source==='plugins/'){
      const states=new Map()
      for(const r of rows)if(typeof r.state==='string')states.set(r.state,(states.get(r.state)||0)+1)
      if(states.size){
        const panel=el('section',null,'viz-group')
        panel.append(el('h3','Plugins by state'),distribution([...states]))
        return panel
      }
    }
    if(ctx.source==='neighbor_links'){
      const links=rows.map(r=>({
        name:r.name??r.neighbor_name??r.peer_hash??r.neighbor_hash??r.upstream_hash,
        rssi:r.last_rssi_dbm??r.last_rssi??r.rssi_dbm??r.rssi
      })).filter(r=>r.name!=null && Number.isFinite(r.rssi))
      if(links.length){
        const ranked=links.sort((a,b)=>b.rssi-a.rssi).slice(0,8)
        const chart=el('section',null,'viz-group')
        const floor=links.reduce((n,r)=>Math.min(n,Math.floor(r.rssi/10)*10),-120)
        const ceiling=Math.max(0,ranked[0].rssi)
        chart.append(el('h3','Strongest links · '+floor+' to '+ceiling+' dBm'))
        for(const r of ranked){
          const line=el('div',null,'bar-row'),m=el('meter')
          m.min=floor;m.max=ceiling;m.value=r.rssi;m.setAttribute('aria-label',r.name+' signal strength')
          line.append(el('span',r.name),m,el('strong',format(r.rssi)+' dBm'));chart.append(line)
        }
        return chart
      }
    }
    return null
  }
  function contents(value,ctx,path=[]){
    if(scalar(value))return showValue(path.at(-1)||'value',value)
    if(!Object.keys(value).length)return el('p','No entries reported.','muted')
    if(Array.isArray(value)){
      if(value.every(isRecord)){
        const records=table(value,ctx,path)
        const graph=recordChart(value,ctx)
        if(!graph)return records
        const block=el('div')
        block.append(graph,records)
        return block
      }
      return paged(value,ctx,path,16,slice=>{
        const list=el('ul',null,'value-list')
        slice.forEach(v=>{const li=el('li');li.append(scalar(v)?showValue('',v):tree(v));list.append(li)})
        return list
      })
    }
    const entries=Object.entries(value)
    const countMap=/^(by_type|by_route|route_totals|packet_type_totals|route_stats|packet_type_stats|counts|by_class)$/.test(path.at(-1)||ctx.source)
    if(countMap && entries.every(([,v])=>Number.isSafeInteger(v)&&v>=0))return distribution(entries)
    const container=el('div')
    const fields=entries.filter(([,v])=>scalar(v))
    if(fields.length){
      container.append(paged(fields,ctx,[...path,'fields'],24,slice=>{
        const grid=el('div',null,'reading-grid')
        for(const [k,v] of slice)grid.append(tile(k,v,ctx,path))
        return grid
      }))
    }
    const groups=entries.filter(([,v])=>!scalar(v))
    if(groups.length)container.append(paged(groups,ctx,[...path,'groups'],8,slice=>{
      const wrap=el('div',null,'viz-groups')
      for(const [k,v] of slice){
        const group=el('section',null,'viz-group')
        group.append(el('h3',label(k)),contents(v,ctx,[...path,k]))
        wrap.append(group)
      }
      return wrap
    }))
    return container
  }
  function render(source,value,nodeId,sampledAt,title){
    const p=panel(title||titles[source]||label(source))
    p.classList.add('instrument-view')
    if(isRecord(value)){
      const graph=source==='hardware_stats'?hardwareLoad(value):source==='noise_floor_stats'?noiseRange(value):null
      if(graph)p.append(graph)
    }
    p.append(contents(value,{source,node:nodeId,time:sampledAt,configuration:source.startsWith('config_export')||source==='sensors_config'}))
    return p
  }
  return {render}
})()
