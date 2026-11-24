import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

test('only IP addresses, localhost and listed host names reach the dashboard',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'relay-host-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  process.env.OPENHOP_CONFIG=join(dir,'seed.json');process.env.OPENHOP_DATA=join(dir,'state')
  process.env.RELAY_DESK_HOSTNAMES=' Relay.Example , other.example'
  await writeFile(process.env.OPENHOP_CONFIG,'[]')
  const {handleRequest}=await import('../server.mjs?hosts')
  async function status(host,method='GET',url='/api/fleet'){
    let code
    await handleRequest({method,url,headers:{host}},{writeHead(c){code=c},end(){}})
    return code
  }
  for(const host of ['127.0.0.1:8080','192.168.1.50','[::1]:8080','localhost:8080','relay.example:8080','OTHER.example'])
    assert.equal(await status(host),200,host)
  for(const host of ['evil.example:8080','127.0.0.1.evil.example','relay.example.evil','bad host'])
    assert.equal(await status(host),403,host)
  assert.equal(await status('evil.example','DELETE','/api/repeaters/1'),403)
})
