# Yoswit Homebridge MQTT Bridge

> **⚠️ Unofficial Implementation**: This is an unofficial, community-developed bridge for Yoswit devices. It is not affiliated with, endorsed by, or officially supported by Yoswit.

A Deno-based MQTT bridge that connects Yoswit smart devices to Homebridge, enabling HomeKit integration.

## Features

- 🔌 Connects Yoswit devices to Homebridge via MQTT
- 🚀 Built with Deno for modern TypeScript runtime
- 🐳 Docker support for easy deployment
- 📡 Built-in MQTT broker (Aedes)

## Prerequisites

- Docker and Docker Compose
- Yoswit account credentials
- Homebridge instance with MQTT plugin

## Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/nohackjustnoobb/yoswit-homebridge-mqtt.git
   cd yoswit-homebridge-mqtt
   ```

2. **Configure environment variables**:

   Edit the `docker-compose.yml` file and update the Yoswit API configuration with your credentials:

   - `BASE_URL`: Your Yoswit API base URL (without protocol)
   - `USERNAME`: Your Yoswit account username
   - `PASSWORD`: Your Yoswit account password
   - `APP_ID`: Your Yoswit application ID

3. **Start the service**:

   ```bash
   docker-compose up -d
   ```

## Usage

### Connecting to Homebridge

1. Install the Homebridge MQTT plugin
2. Configure the plugin to connect to this MQTT broker:

   - Host: `localhost` (or your Docker host IP)
   - Port: `1883` (or your configured AEDES_PORT)
   - Topic prefix: `homebridge` (or your configured prefix)

3. The bridge will automatically:
   - Fetch your Yoswit devices
   - Connect to the Yoswit MQTT server
   - Expose devices to Homebridge via the local MQTT broker

## Development

### Available Tasks

```bash
# Run with auto-reload
deno task dev

# Run with debug logging
deno task dev:debug
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Optional ESP32 BLE Scanner Module

An optional module is available that uses an ESP32 to scan BLE advertisement data from Yoswit devices. This module helps keep device status in sync, especially when the physical button on the device is used.

**Note:** Without this module, device status will not update in Homebridge if you use the physical button on the device.

You can find the ESP32 BLE scanner module here: [yoswit-ble-scanner](https://github.com/nohackjustnoobb/yoswit-ble-scanner.git)
