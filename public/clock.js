/* Normalize wall-clock readings at the display boundary. The API value stays intact. */
const stationClock = (() => {
  const date = new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'numeric'})
  const clock = new Intl.DateTimeFormat(undefined, {hour:'numeric', minute:'2-digit', second:'2-digit', timeZoneName:'short'})
  const calendar = new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'numeric', timeZone:'UTC'})
  const unitSuffix = /_(seconds?|secs?|s|milliseconds?|ms|microseconds?|us|nanoseconds?|ns)$/
  function field(key) {
    return key.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase()
  }
  function isTimestamp(key) {
    const name=field(key).replace(unitSuffix,'').replace(/_utc$/,'')
    if (/^has_|^(on|off)_time$|(?:^|_)(duration|elapsed|idle|cpu|wall|run|wait|response|execution|processing)_time$/.test(name)) return false
    return /(?:^|_)(?:timestamps?|time|date|datetime|ts|epoch|at|since)$/.test(name) ||
      /(?:^|_)(?:first|last)_(?:seen|heard|updated?|received|sent|read|sync|connected|disconnected|advert|activity)$/.test(name)
  }
  function milliseconds(value,key='timestamp') {
    const unit=field(key).match(unitSuffix)?.[1]
    if (typeof value==='string') {
      value=value.trim()
      if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(value)) {
        let iso=value.replace(' ','T')
        if (!/(?:Z|[+-]\d\d:?\d\d)$/i.test(iso)) {
          if (!/(?:^|_)utc(?:_|$)/.test(field(key))) return null
          iso+='Z'
        }
        const day=iso.slice(0,10)
        const midnight=new Date(day+'T00:00:00Z')
        if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0,10)!==day) return null
        const ms=Date.parse(iso)
        return Number.isFinite(ms)?ms:null
      }
      if (!/^\d+(?:\.\d+)?$/.test(value)) return null
      // Truncate fine-grained integer strings before conversion to a JS number.
      if (/^\d+$/.test(value)) {
        value=value.replace(/^0+(?=\d)/,'')
        if (unit?.startsWith('n') || (!unit && value.length>=18)) return milliseconds(value.slice(0,-6)||'0','timestamp_ms')
        if (/^(us|micro)/.test(unit) || (!unit && value.length>=15)) return milliseconds(value.slice(0,-3)||'0','timestamp_ms')
      }
      value=Number(value)
    }
    if (!Number.isFinite(value) || value<=0) return null
    // Avoid turning a short device-relative clock into a date in 1970.
    if (!unit && value<315532800) return null
    let ms
    if (unit?.startsWith('n') || (!unit && value>=1e17)) ms=value/1e6
    else if (/^(us|micro)/.test(unit) || (!unit && value>=1e14)) ms=value/1000
    else if (/^(ms|milli)/.test(unit) || (!unit && value>=1e11)) ms=value
    else ms=value*1000
    return Number.isFinite(new Date(ms).getTime())?Math.trunc(ms):null
  }
  function readout(key,value) {
    if (!isTimestamp(key) || value==null || typeof value==='boolean') return null
    const ms=milliseconds(value,key)
    if (ms===null) {
      // A date or naive wall time has no instant to convert to the viewer's zone.
      const civil=typeof value==='string' && /^(\d{4}-\d\d-\d\d)(?:[T ](\d\d:\d\d(?::\d\d(?:\.\d+)?)?))?$/.exec(value)
      if (civil) {
        const iso=value.replace(' ','T')
        const check=new Date(civil[2]?iso+'Z':iso+'T00:00:00Z')
        if (Number.isFinite(check.getTime()) && check.toISOString().startsWith(civil[1])) {
          const stamp=el('time',calendar.format(check),'station-time')
          stamp.dateTime=iso
          stamp.title='API value: '+value
          if (civil[2]) stamp.append(' ',el('span',civil[2].split('.')[0]+' (zone unspecified)','clock-face'))
          return stamp
        }
      }
      if (![0,-1,'0','-1'].includes(value)) return null
      const empty=el('span','—','reading-null')
      empty.title='No timestamp reported ('+value+')'
      return empty
    }
    const stamp=el('time',null,'station-time')
    stamp.dateTime=new Date(ms).toISOString()
    stamp.title=stamp.dateTime+' · API value: '+value
    stamp.append(el('span',date.format(ms),'clock-day'),' ',el('span',clock.format(ms),'clock-face'))
    return stamp
  }
  return {milliseconds, readout, time:ms=>clock.format(ms), full:ms=>date.format(ms)+' '+clock.format(ms)}
})()
