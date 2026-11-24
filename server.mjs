import http from 'node:http'
import {readFile} from 'node:fs/promises'
import {pages, allowed, unwrap} from './catalog.mjs'
import {demo} from './sample.mjs'

const root = new URL('./', import.meta.url)
const config = JSON.parse(await readFile(process.env.OPENHOP_CONFIG || new URL('config/repeaters.json',root),'utf8'))
if (!Array.isArray(config)) throw Error('repeaters.json must contain an array')
const nodes = config.map((item,i) => {
  const url = new URL(item.url)
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw Error('Invalid base URL for repeater '+(i+1))
  if (item.apiKeyEnv && !process.env[item.apiKeyEnv]) throw Error('Missing API key environment variable for repeater '+(i+1))
  return {id:String(i+1),name:item.name || url.hostname,base:url.href.replace(/\/+$/,''),key:item.apiKeyEnv ? process.env[item.apiKeyEnv] : item.apiKey}
})
if (!nodes.length) nodes.push({id:'demo', name:'Piedmont Ridge',demo:true})
const cache = new Map(), pending = new Map(), histories = new Map()
const limit = 2*1024*1024
function redact(key,value) {
  return /password|passphrase|secret|(?:private|identity|api|transport|channel)[_-]?keys?$|token$|^psk$|^authorization$/i.test(key) ? '[redacted]' : value
}
async function fetchReading(node,path) {
  if (node.demo) return {ok:true,value:demo(path)}
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
const staticFiles={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']}
export async function handleRequest(req,res){
  const send=(status,content,mime='application/json')=>{
    res.writeHead(status,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"})
    res.end(mime==='application/json'?JSON.stringify(content):content)
  }
  try {
    if(req.method!=='GET') return send(405,{error:'GET required'})
    const url=new URL(req.url,'http://localhost')
    if(Object.hasOwn(staticFiles,url.pathname)){
      const [file,type]=staticFiles[url.pathname]
      return send(200,await readFile(new URL('public/'+file,root)),type)
    }
    if(url.pathname==='/health') return send(200,{ok:true})
    if(url.pathname==='/api/fleet') return send(200,{nodes:nodes.map(({id,name,demo})=>({id,name,demo:!!demo})),pages})
    if(url.pathname==='/api/reading'){
      const node=nodes.find(n=>n.id===url.searchParams.get('node')),path=url.searchParams.get('path')
      if(!node || !allowed.has(path)) return send(404,{error:'Unknown node or resource'})
      const result=await reading(node,path)
      return send(200,{...result,history:path==='stats'?histories.get(node.id):undefined})
    }
    send(404,{error:'Not found'})
  } catch {send(500,{error:'Dashboard request failed'})}
}
if(import.meta.main){
  const server=http.createServer(handleRequest)
  server.listen(Number(process.env.PORT || 8080),process.env.HOST || '127.0.0.1',()=>console.log('Listening on port '+server.address().port))
}
