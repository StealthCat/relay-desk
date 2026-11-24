import {openInventory, InventoryError} from './inventory.mjs'
import {fileURLToPath} from 'node:url'
import http from 'node:http'
import {readFile} from 'node:fs/promises'
import {pages, allowed, unwrap} from './catalog.mjs'

const root = new URL('./', import.meta.url)
const config = JSON.parse(await readFile(process.env.OPENHOP_CONFIG || new URL('config/repeaters.json',root),'utf8'))
if (!Array.isArray(config)) throw Error('repeaters.json must contain an array')
const inventory = await openInventory(config, process.env.OPENHOP_DATA || fileURLToPath(new URL('data/',root)))
function fleet() {
  return {nodes:inventory.nodes().map(({id,name})=>({id,name})),pages}
}
async function mutation(req,url) {
  const headers=req.headers || {}
  const origin=headers.origin
  if(headers['x-relay-desk']!=='fleet' || headers['sec-fetch-site']==='cross-site' ||
    (origin && !['https://'+headers.host,'http://'+headers.host].includes(origin)))
    throw new InventoryError(403,'Use the fleet controls on this dashboard.')
  if(req.method==='POST') {
    if(headers['content-type']?.split(';')[0]!=='application/json') throw new InventoryError(415,'JSON required.')
    const chunks=[]
    let size=0
    for await(const chunk of req) {
      size+=chunk.length
      if(size>16384) throw new InventoryError(413,'Request too large.')
      chunks.push(chunk)
    }
    let input
    try {input=JSON.parse(Buffer.concat(chunks).toString())} catch {throw new InventoryError(400,'Invalid JSON.')}
    const selected=await inventory.add(input)
    return {...fleet(),selected}
  }
  const id=url.pathname.split('/').pop()
  await inventory.remove(id)
  histories.delete(id)
  for(const key of cache.keys()) if(key.startsWith(id+'|')) cache.delete(key)
  return fleet()
}
const cache = new Map(), pending = new Map(), histories = new Map()
const limit = 2*1024*1024
function redact(key,value) {
  return /password|passphrase|secret|(?:private|identity|api|transport|channel)[_-]?keys?$|token$|^psk$|^authorization$/i.test(key) ? '[redacted]' : value
}
async function fetchReading(node,path) {
  const cancel = new AbortController()
  const timer = setTimeout(()=>cancel.abort(),5500)
  try {
    const response = await fetch(node.base+'/api/'+path,{headers:node.key ? {'X-API-Key':node.key} : {}, redirect:'manual',signal:cancel.signal})
    if (!response.ok) return {ok:false,error:'HTTP '+response.status}
    const chunks=[]
    let size=0
    for await (const chunk of response.body) {
      size+=chunk.length
      if(size>limit) return {ok:false,error:'Response exceeds 2 MiB'}
      chunks.push(chunk)
    }
    const value=JSON.parse(Buffer.concat(chunks).toString(),redact)
    if (value?.success===false || value?.error) return {ok:false,error:'Repeater reported an API error'}
    return {ok:true,value}
  } catch(e) {
    return {ok:false,error:cancel.signal.aborted?'Request timed out':e instanceof SyntaxError?'Invalid JSON response':'Connection failed'}
  } finally {clearTimeout(timer);cancel.abort()}
}
function reading(node,path) {
  const key=node.id+'|'+path, prior=cache.get(key)
  if(prior && Date.now()-prior.time<15000) return Promise.resolve(prior)
  if(pending.has(key)) return pending.get(key)
  const task=fetchReading(node,path).then(result=>{
    result.time=Date.now()
    if(!inventory.nodes().some(n=>n.id===node.id)) return result
    cache.set(key,result)
    if(path==='stats' && result.ok) {
      const s=unwrap(result.value), history=histories.get(node.id) || []
      history.push({time:result.time,rx:s?.packets_received,tx:s?.packets_sent})
      histories.set(node.id,history.slice(-120))
    }
    return result
  }).finally(()=>pending.delete(key))
  pending.set(key,task)
  return task
}
const staticFiles={'/':['index.html','text/html'],'/visuals.js':['visuals.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']}
export async function handleRequest(req,res){
  const send=(status,content,mime='application/json')=>{
    res.writeHead(status,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src https://www.openstreetmap.org"})
    res.end(mime==='application/json'?JSON.stringify(content):content)
  }
  try {
    const url=new URL(req.url,'http://localhost')
    if((req.method==='POST' && url.pathname==='/api/repeaters') ||
      (req.method==='DELETE' && /^\/api\/repeaters\/[a-zA-Z0-9-]+$/.test(url.pathname))) {
      return send(req.method==='POST'?201:200,await mutation(req,url))
    }
    if(req.method!=='GET') return send(405,{error:'Method unavailable'})
    if(Object.hasOwn(staticFiles,url.pathname)){
      const [file,type]=staticFiles[url.pathname]
      return send(200,await readFile(new URL('public/'+file,root)),type)
    }
    if(url.pathname==='/health') return send(200,{ok:true})
    if(url.pathname==='/api/fleet') return send(200,fleet())
    if(url.pathname==='/api/reading'){
      const node=inventory.nodes().find(n=>n.id===url.searchParams.get('node')),path=url.searchParams.get('path')
      if(!node || !allowed.has(path)) return send(404,{error:'Unknown node or resource'})
      const result=await reading(node,path)
      return send(200,{...result,history:path==='stats'?histories.get(node.id):undefined})
    }
    send(404,{error:'Not found'})
  } catch(err) {if(err instanceof InventoryError)return send(err.status,{error:err.message});send(500,{error:'Dashboard request failed'})}
}
if(import.meta.main){
  const server=http.createServer(handleRequest)
  server.listen(Number(process.env.PORT || 8080),process.env.HOST || '127.0.0.1',()=>console.log('Listening on port '+server.address().port))
}
