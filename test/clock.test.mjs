import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {runInNewContext} from 'node:vm'

const source=await readFile(new URL('../public/clock.js',import.meta.url),'utf8')
const el=(tag,text)=>({tag,text,append(...parts){this.parts=parts}})
const clock=runInNewContext(source+'\nstationClock',{el})
const iso='2023-11-14T22:13:20.123Z'
const ms=Date.parse(iso)

test('the same instant survives firmware units, string types, offsets and DST',()=>{
  for(const [key,value] of [
    ['timestamp',1700000000.123],['timestamp_ms',ms],['last_seen','1700000000.123'],
    ['boot_time',String(ms)],['firstSeen','1700000000123999'],
    ['created_at_ns','1700000000123999999'],['oldest_timestamp',iso],
    ['timestamp','2023-11-14T17:13:20.123456-05:00'],['datetime_utc','2023-11-14 22:13:20.123']
  ]) {
    const stamp=clock.readout(key,value)
    assert.equal(stamp.tag,'time',key)
    assert.equal(stamp.dateTime,iso,key)
    assert.ok(stamp.title.includes(String(value)),key)
  }
  assert.equal(clock.milliseconds('2026-11-01T01:30:00-05:00')-clock.milliseconds('2026-11-01T01:30:00-04:00'),3600000)
})

test('counters, configuration intervals and incomplete GPS readings remain literal',()=>{
  for(const key of ['frequency_hz','age_seconds','airtime_ms','uptime_seconds','on_time','off_time','time_sync_interval_seconds','has_timestamp','response_time_ms'])
    assert.equal(clock.readout(key,ms),null,key)
  for(const value of [null,false,'','unknown','2026-02-30T00:00:00Z','2026-06-01 08:30:00','12:03:05',NaN,Infinity])
    assert.equal(clock.milliseconds(value),null)
  assert.equal(clock.readout('timestamp',0).text,'—')
  assert.equal(clock.readout('last_heard',-1).text,'—')
  assert.equal(clock.readout('has_timestamp',true),null)
  assert.equal(clock.readout('date','2026-11-01').dateTime,'2026-11-01')
  const wall=clock.readout('timestamp','2026-11-01 01:30:00')
  assert.equal(wall.dateTime,'2026-11-01T01:30:00')
  assert.equal(wall.parts[1].text,'01:30:00 (zone unspecified)')
})
