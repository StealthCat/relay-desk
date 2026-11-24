// Each page requests only the API resources it displays.
export const pages = {
  Overview: ['stats'],
  'GPS & location': ['gps','stats'],
  'System & hardware': ['hardware_stats','site_info','hardware_processes','stats'],
  'Radio & RF': ['stats','noise_floor_stats','lbt_diagnostics','crc_error_count','airtime_data'],
  'Network & connectivity': ['site_info','mqtt_status','neighbor_links','stats'],
  'Telemetry & sensors': ['stats','sensors_config','sensors_types'],
  'Network & routing': ['route_stats','neighbor_links','neighbor_scopes','packet_type_stats','packet_stats'],
  'Services & plugins': ['plugins/','mqtt_status','room_stats','companion/stats','web_frontends'],
  'Combined diagnostics': ['stats','hardware_stats','db_stats','packet_stats','lbt_diagnostics','advert_rate_limit_stats','acl_stats'],
  Configuration: ['config_export?include_secrets=false']
}
export const allowed = new Set(Object.values(pages).flat())
export const unwrap = value => value?.data ?? value
