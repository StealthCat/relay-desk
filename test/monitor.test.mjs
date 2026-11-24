import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {pages} from '../catalog.mjs'
import {demo} from '../sample.mjs'

test('sample responses exist for every section',()=>{
  for(const name of Object.values(pages).flat())assert.notEqual(demo(name),undefined,name)
})
test('fleet proxy handles per-node authentication, partial failure, caching and redaction',{skip:process.env.SKIP_LOOPBACK==='1'},async t=>{
  let reads=0
  const upstream=http.createServer((req,res)=>{
    assert.equal(req.method,'GET')
    if(req.headers['x-api-key']!=='sample-only'){res.writeHead(401);res.end();return}
    if(req.url==='/west/api/stats'){reads++;res.end(JSON.stringify({packets_received:0,sensors:{temperature_c:0},private_key:'example'}));return}
    if(req.url==='/west/api/plugins/'){res.writeHead(503);res.end();return}
    if(req.url==='/west/api/config_export?include_secrets=false'){res.end('{"data":{"config":{"api_key":"example"}}}');return}
    res.writeHead(404);res.end()
  })
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening')
  t.after(()=>upstream.close())
  const dir=await mkdtemp(path.join(os.tmpdir(),'openhop-test-')),file=path.join(dir,'inventory.json')
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const url='http://127.0.0.1:'+upstream.address().port+'/west'
  await writeFile(file,JSON.stringify([{name:'West',url,apiKeyEnv:'TEST_NODE_KEY'},{name:'East',url}]))
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',OPENHOP_CONFIG:file,TEST_NODE_KEY:'sample-only'}})
  t.after(()=>child.kill())
  const [line]=await once(child.stdout,'data',{signal:AbortSignal.timeout(6000)})
  const base='http://127.0.0.1:'+line.toString().match(/port (\d+)/)[1]
  const get=async(id,p)=>{const res=await fetch(base+'/api/reading?'+new URLSearchParams({node:id,path:p}));return res.json()}
  const fleet=await (await fetch(base+'/api/fleet')).json()
  assert.equal(fleet.nodes.length,2);assert.equal(JSON.stringify(fleet).includes('sample-only'),false)
  for(const asset of ['/','/app.js','/style.css','/health'])assert.equal((await fetch(base+asset)).status,200)
  const [r]=await Promise.all([get('1','stats'),get('1','stats')])
  assert.equal(r.value.private_key,'[redacted]');assert.equal(r.value.sensors.temperature_c,0);assert.equal(reads,1)
  assert.equal((await get('2','stats')).error,'HTTP 401')
  assert.equal((await get('1','plugins/')).error,'HTTP 503')
  assert.equal((await get('1','config_export?include_secrets=false')).value.data.config.api_key,'[redacted]')
  assert.equal((await get('1','stats')).ok,true)
  assert.equal((await fetch(base+'/api/reading?node=1&path=restart_service')).status,404)
  assert.equal((await fetch(base+'/api/fleet',{method:'POST'})).status,405)
})
