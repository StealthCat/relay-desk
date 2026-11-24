# Relay Desk

A read-only, self-hosted dashboard for one or more openHop **Repeater** web APIs. It runs on Node.js 24 with no npm dependencies, external fonts, JavaScript CDNs or database.

## Start with Docker

From the extracted project directory, run:

```sh
docker compose up -d --build
```

Open **http://localhost:8080**. The shipped empty inventory displays a labeled sample station. Requires Docker with Compose 2.24 or newer for the optional environment file.

## Manage repeaters in the browser

Choose **Manage repeaters**, enter a display name, the repeater base URL reachable from the container, and an optional API token. Select **Add repeater** to switch to it immediately. **Remove** asks for confirmation and removes the station from this dashboard. Removing the last station brings back the labeled sample.

Compose stores these changes in the named `fleet-data` volume. UI-entered tokens are stored server-side in a restricted-permission JSON file in that volume. Protect volume backups. Anyone with access to the dashboard can manage its fleet. The default port binding is loopback. If using an authenticated reverse proxy, preserve the original Host header. Native installs can set `OPENHOP_DATA` to a writable directory (default `./data` beside the server).

## Configure repeaters with a file

Existing file-based configurations and environment-variable tokens continue to work. Removing a file-configured address from the UI hides it across restarts. The source configuration is preserved.

1. Create an API token in each repeater's authenticated dashboard. Use a token authorized to read the data you want.
2. Replace the empty array in `config/repeaters.json` with your own nodes. Use the base URL reachable **from the container**. The app adds `/api/`. A reverse proxy path prefix is supported. Inside Docker, localhost points to the dashboard container.
3. Put the matching tokens in a file named `.env` beside `compose.yaml`. Limit access to this file to the account running Docker.
4. Run `docker compose up -d --force-recreate` to reload the inventory and credentials.

Example inventory:

```json
[
  {"name":"Home base","url":"http://192.168.1.50:8000","apiKeyEnv":"HOME_REPEATER_KEY"},
  {"name":"Hilltop","url":"https://hilltop.example.org","apiKeyEnv":"HILLTOP_KEY"}
]
```

Example `.env`:

```dotenv
HOME_REPEATER_KEY=replace-with-first-token
HILLTOP_KEY=replace-with-second-token
```

Omit `apiKeyEnv` for endpoints that permit anonymous reads. For remote connections use HTTPS or a trusted VPN. For a private CA, mount its PEM certificate and set `NODE_EXTRA_CA_CERTS` to the container path. The dashboard sends API tokens server-side as `X-API-Key`.

Compose publishes to loopback and the viewer has no sign-in. To view a remote installation, forward the port with `ssh -L 8080:127.0.0.1:8080 user@docker-host`, then open the same local URL. Put authentication and TLS in front of the dashboard if sharing it.

## Using the dashboard

Select a repeater and a section. Overview checks every configured repeater's stats endpoint and shows reachability. Packet activity uses counter differences between successful samples. The chart begins after three samples. It needs both packet counters. Changing nodes, a counter reset, and gaps longer than two minutes do not create artificial packet spikes.

| Section | Available information |
| --- | --- |
| GPS & location | Receiver state, fix validity, stale flag, coordinates, altitude, satellites and detailed diagnostics. The GPS page embeds an interactive OpenStreetMap with a position marker and retains the numeric readings and external map link. Opening this page sends available coordinates to OpenStreetMap. Map tiles require internet access. |
| System & hardware | Host information, hardware utilization, process list, software versions |
| Radio & RF | Radio backend and fabric, radio configuration, noise floor, airtime, CRC and listen-before-talk diagnostics |
| Network & connectivity | Site information, MQTT status, observed links and network fields reported in stats |
| Telemetry & sensors | Full sensor readings from stats, configured sensors and supported sensor types |
| Network & routing | Neighbours, scopes, route types and packet breakdowns |
| Services & plugins | Plugin inventory and state, MQTT, rooms, companion service and web frontends |
| Combined diagnostics | Complete stats payload, hardware, storage, packets and policy counters |
| Configuration | Repeater configuration export with secret inclusion disabled |

Expand API responses to inspect nested fields, arrays, and firmware-specific values. An em dash denotes a missing value. The source count is the number of successful API reads, not a radio health score. A 401/403 indicates a credential or permission issue. A 404 means the route is unavailable at that address. A plugin manager can return 503 while the repeater is otherwise healthy.

The visible page refreshes every 30 seconds. Identical reads share a 15-second cache across clients. The server keeps up to 120 recent stats samples per repeater in memory. There is no background archive. Requests to the repeater use GET only and the upstream resource list is fixed in `catalog.mjs`. Each response has a 5.5-second deadline and 2 MiB maximum size. The dashboard also masks common credential fields. Treat telemetry, configuration and GPS coordinates as private.

## Local development

Run `node server.mjs` from this directory with Node 24.2 or newer. It listens on loopback port 8080. Override with `PORT`, `HOST` or `OPENHOP_CONFIG`. For native development with a token file, run `node --env-file=.env server.mjs`. Run the tests with `node --test`.

API references: [Repeater OpenAPI](https://github.com/openhop-dev/openhop_repeater/blob/main/repeater/web/openapi.yaml), [sensors](https://docs.openhop.dev/projects/openhop-repeater/sensors/), [plugin API authentication](https://docs.openhop.dev/projects/openhop-repeater/plugin-administration/).
