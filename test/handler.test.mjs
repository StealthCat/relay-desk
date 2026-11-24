import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

test('dashboard routes against a simulated two-repeater API',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'relay-handler-'))
  t.after(()=>rm(folder,{recursive:true,force:true}))
  const file=join(folder,'config.json')
  await writeFile(file,JSON.stringify([{name:'A',url:'https://a.example/base',apiKeyEnv:'TEST_TOKEN'},{name:'B',url:'http://b.example'}]))
  process.env.OPENHOP_CONFIG=file;process.env.TEST_TOKEN='sample-token'
  const {handleRequest}=await import('../server.mjs')
  let calls=0
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++
    if(url.startsWith('http://b.example'))return new Response(null,{status:401})
    assert.equal(options.headers['X-API-Key'],'sample-token')
    assert.equal(options.redirect,'manual')
    if(url.endsWith('/airtime_data?limit=512'))return Response.json({data:[]})
    if(url.endsWith('plugins/'))return new Response(null,{status:503})
    if(url.endsWith('gps'))return new Response('<html>')
    if(url.endsWith('hardware_stats'))return Response.json({success:false})
    if(url.endsWith('config_export?include_secrets=false'))return Response.json({data:{config:{nested:{admin_password:'abc'}}}})
    assert.equal(url,'https://a.example/base/api/stats')
    return Response.json({rx_count:0,sent_flood_count:6,sent_direct_count:2,sensors:{voltage:0},identity_key:'sample-private'})
  })
  async function request(url,method='GET'){
    let status,body
    await handleRequest({method,url},{writeHead(code){status=code},end(data){body=data}})
    return {status,body}
  }
  const get=async(id,path)=>JSON.parse((await request('/api/reading?'+new URLSearchParams({node:id,path}))).body)
  const fleet=await request('/api/fleet')
  assert.equal(JSON.parse(fleet.body).nodes.length,2);assert.ok(!fleet.body.includes('sample-token'))
  for(const asset of ['/','/app.js','/clock.js','/visuals.js','/style.css','/health'])assert.equal((await request(asset)).status,200)
  const [stats]=await Promise.all([get('1','stats'),get('1','stats')])
  assert.equal(calls,1);assert.equal(stats.history[0].rx,0);assert.equal(stats.history[0].tx,8);assert.equal(stats.value.identity_key,'[redacted]')
  assert.equal(stats.value.sensors.voltage,0);assert.equal((await get('2','stats')).error,'HTTP 401')
  assert.equal((await get('1','airtime_data')).ok,true)
  assert.equal((await get('1','plugins/')).error,'HTTP 503')
  assert.equal((await get('1','gps')).error,'Invalid JSON response')
  assert.equal((await get('1','hardware_stats')).ok,false)
  assert.equal((await get('1','config_export?include_secrets=false')).value.data.config.nested.admin_password,'[redacted]')
  assert.equal((await request('/api/reading?node=1&path=config_export')).status,404)
  assert.equal((await request('/api/fleet','POST')).status,405)
})
