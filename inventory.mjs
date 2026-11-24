import {mkdir, readFile, rename, writeFile, rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'

export class InventoryError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

function address(value) {
  let url
  try { url = new URL(value) } catch {}
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password)
    throw new InventoryError(400, 'Enter an HTTP or HTTPS base URL without credentials, a query, or a fragment.')
  return url.href.replace(/\/+$/, '')
}

export async function openInventory(seeds, directory) {
  const file = join(directory, 'fleet.json')
  const configured = seeds.map((item, i) => {
    if (item.apiKeyEnv && !process.env[item.apiKeyEnv]) throw Error('Missing API key environment variable for repeater '+(i+1))
    return {id:String(i+1), name:item.name || new URL(item.url).hostname, base:address(item.url),
      key:item.apiKeyEnv ? process.env[item.apiKeyEnv] : item.apiKey}
  })
  let state = {added:[], hidden:[]}
  try { state = JSON.parse(await readFile(file, 'utf8')) }
  catch (err) { if (err.code !== 'ENOENT') throw err }
  function nodes() {
    return [...configured.filter(n => !state.hidden.includes(n.base)), ...state.added]
  }
  let tail = Promise.resolve()
  function update(change) {
    const task = tail.then(async () => {
      const next = structuredClone(state)
      const id = change(next)
      await mkdir(directory, {recursive:true, mode:0o700})
      const tmp = file+'.'+randomUUID()
      try {
        await writeFile(tmp, JSON.stringify(next), {mode:0o600, flag:'wx'})
        await rename(tmp, file)
      } finally { await rm(tmp, {force:true}) }
      state = next
      return id
    })
    tail = task.catch(() => {})
    return task
  }
  return {
    nodes,
    add(input) {
      return update(next => {
        const name = typeof input?.name==='string' ? input.name.trim() : ''
        if (!name || name.length>100) throw new InventoryError(400,'Enter a name of 1 to 100 characters.')
        const base = address(input.url)
        const key = input.apiKey ?? ''
        if (typeof key!=='string' || key.length>4096 || /[^\x20-\x7e]/.test(key)) throw new InventoryError(400,'Enter a valid API token.')
        if (nodes().some(n=>n.base===base)) throw new InventoryError(409,'This repeater address is already in the fleet.')
        const id = randomUUID()
        next.added.push({id,name,base,key})
        return id
      })
    },
    remove(id) {
      return update(next=>{
        const node = nodes().find(n=>n.id===id)
        if (!node) throw new InventoryError(404,'Repeater not found.')
        if (configured.some(n=>n.id===id)) next.hidden.push(node.base)
        else next.added = next.added.filter(n=>n.id!==id)
        return id
      })
    }
  }
}
