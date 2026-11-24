import test from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

test('manage configured and browser-added repeaters across restarts',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'relay-fleet-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  process.env.OPENHOP_DATA=join(dir,'state')
  process.env.OPENHOP_CONFIG=join(dir,'seed.json')
  await writeFile(process.env.OPENHOP_CONFIG,JSON.stringify([{name:'Original',url:'https://seed.example'}]))
  let {handleRequest}=await import('../server.mjs?first')
  async function call(method,url,body,headers={}){
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))])
    Object.assign(req,{method,url,headers:{host:'localhost','x-relay-desk':'fleet','content-type':'application/json',...headers}})
    let status,data
    await handleRequest(req,{writeHead(s){status=s},end(raw){data=JSON.parse(raw)}})
    return {status,data}
  }
  const api='/api/repeaters',input={name:'New',url:'https://new.example/radio/',apiKey:'private-example'}
  assert.equal((await call('POST',api,input,{origin:'https://other.example'})).status,403)
  assert.equal((await call('POST',api,{...input,url:'file:///tmp/x'})).status,400)
  const responses=await Promise.all([call('POST',api,input),call('POST',api,input)])
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409])
  const created=responses.find(r=>r.status===201).data
  assert.ok(!JSON.stringify(created).includes(input.apiKey))
  assert.equal(created.nodes.length,2)
  assert.equal((await call('DELETE',api+'/1')).status,200)
  ;({handleRequest}=await import('../server.mjs?restart'))
  const restored=(await call('GET','/api/fleet')).data.nodes
  assert.deepEqual(restored.map(n=>n.id),[created.selected])
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'https://new.example/radio/api/stats')
    assert.equal(options.headers['X-API-Key'],input.apiKey)
    return Response.json({uptime_secs:1})
  })
  assert.equal((await call('GET','/api/reading?node='+created.selected+'&path=stats')).data.ok,true)
  assert.deepEqual((await call('DELETE',api+'/'+created.selected)).data.nodes,[])
  ;({handleRequest}=await import('../server.mjs?emptyRestart'))
  assert.deepEqual((await call('GET','/api/fleet')).data.nodes,[])
  assert.equal((await call('GET','/api/reading?node=demo&path=stats')).status,404)
  assert.equal((await call('GET','/api/reading?node='+created.selected+'&path=stats')).status,404)
  assert.equal((await call('DELETE',api+'/demo')).status,404)
})

test('a fresh installation has no stations',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'relay-empty-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const {openInventory}=await import('../inventory.mjs')
  assert.deepEqual((await openInventory([],dir)).nodes(),[])
})
