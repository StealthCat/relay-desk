const start=Date.now()
export function demo(path) {
  const ticks=Math.floor((Date.now()-start)/10000)
  const sensors={enclosure:{temperature_c:28.4,humidity_pct:46.2},power:{bus_voltage_v:13.18,current_ma:412}}
  const radio={frequency:910525000,bandwidth:62500,spreading_factor:7,tx_power:22}
  const gps={enabled:true,running:true,status:{state:'running',fix_valid:true,stale:false},fix:{valid:true,quality_label:'GPS fix'},position:{latitude:33.54,longitude:-82.13,altitude_m:124},satellites:{used_count:9,in_view_count:14}}
  const sample={
    stats:{site_name:'Piedmont Ridge',version:'sample',uptime_secs:186420+ticks*10,packets_received:12486+ticks*3,packets_sent:4261+ticks,radio_type:'sx1262',radio,sensors,gps},
    gps:{data:gps},hardware_stats:{data:{cpu_percent:12.8,memory_percent:34.1,cpu_temperature_c:46.7}},site_info:{hostname:'piedmont-ridge',interface:'eth0',address:'192.0.2.14'},
    hardware_processes:{processes:[{name:'openhop-repeater',cpu_percent:3.2}]},
    noise_floor_stats:{average_dbm:-111.4},lbt_diagnostics:{busy_count:4},crc_error_count:{count:12},airtime_data:{rx_seconds:248,tx_seconds:86},
    mqtt_status:{connected:true,broker:'mqtt.example.test'},neighbor_links:{links:[{name:'River Bend',last_rssi_dbm:-87,snr_db:9},{name:'North Bluff',last_rssi_dbm:-104,snr_db:3.5}]},
    sensors_config:{enabled:true,poll_interval_seconds:15},sensors_types:{types:['hardware_stats','ina219','bme280']},
    route_stats:{flood:112,direct:28},neighbor_scopes:{served:'Piedmont'},packet_type_stats:{advert:84,text:56},packet_stats:{total_packets:140},
    'plugins/':{success:true,plugins:[{id:'sample.status',enabled:true,state:'RUNNING'}]},room_stats:{rooms:1},'companion/stats':{enabled:false},web_frontends:{active:'default'},db_stats:{size_mb:18.7},advert_rate_limit_stats:{dropped:0},acl_stats:{clients:2},
    'config_export?include_secrets=false':{data:{meta:{includes_secrets:false},config:{radio,gps:{enabled:true},sensors:{enabled:true}}}}
  }
  return sample[path]
}
