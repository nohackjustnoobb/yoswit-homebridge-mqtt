import Aedes from "aedes";
import { createServer } from "node:net";
import { Logger } from "../logger.ts";
import service from "./service.ts";
import { DeviceType, Device } from "./deviceService.ts";

const logger = Logger.create("AedesService");

interface AedesServiceOptions {
  homebridgeMqtt: {
    topicPrefix: string;
  };
}

interface HomebridgeSetPayload {
  name: string;
  value: boolean;
  characteristic: string;
}

class AedesService {
  port: number;
  options: AedesServiceOptions;
  aedes: Aedes.default;
  private bleDeviceCache: Map<string, string> = new Map();

  constructor(port: number, options: AedesServiceOptions) {
    this.port = port;
    this.options = options;
    this.aedes = Aedes.createBroker();
  }

  // -- Homebridge Event Handling --

  private async handleHomebridgeSetMessage(payload: HomebridgeSetPayload) {
    const device = service.deviceService?.getByName(payload.name);
    if (!device) {
      logger.error(`Device with name ${payload.name} not found`);
      return;
    }

    switch (payload.characteristic) {
      case "On":
        if (
          device.type !== DeviceType.SWITCH &&
          device.type !== DeviceType.DIMMING
        ) {
          logger.error(
            `Device ${payload.name} is not a switch or dimming device`
          );
          return;
        }

        try {
          if (device.type === DeviceType.SWITCH) {
            logger.info(
              `Setting device ${payload.name} to value: ${payload.value}`
            );

            await service.deviceService?.switchDevice(
              payload.name,
              payload.value
            );
          } else {
            const brightness = payload.value ? 100 : 0;
            logger.info(
              `Setting device ${payload.name} to brightness: ${brightness}`
            );

            await service.deviceService?.dimmingDevice(
              payload.name,
              brightness
            );
          }
        } catch (error) {
          logger.error(`Failed to switch device ${payload.name}:`, error);
        }
        break;
      case "Brightness":
        if (device.type !== DeviceType.DIMMING) {
          logger.error(`Device ${payload.name} is not a dimming device`);
          return;
        }

        logger.info(
          `Setting dimming device ${payload.name} to brightness: ${payload.value}`
        );

        try {
          await service.deviceService?.dimmingDevice(
            payload.name,
            Number(payload.value)
          );
        } catch (error) {
          logger.error(`Failed to dim device ${payload.name}:`, error);
        }

        break;
      default:
        logger.warn("Unknown characteristic:", payload.characteristic);
        break;
    }
  }

  private addDevice(
    device: Device,
    service: string,
    additionalProperties?: Record<string, string>
  ) {
    let service_name = device.name || "Unnamed Device";
    if (device.roomName) service_name = `${service_name} (${device.roomName})`;

    const payload = {
      name: device.id,
      service_name,
      service,
      ...additionalProperties,
    };

    const topic = `${this.options.homebridgeMqtt.topicPrefix}/to/add`;

    this.aedes.publish(
      {
        topic,
        payload: JSON.stringify(payload),
        qos: 1,
        retain: false,
        dup: false,
        cmd: "publish",
      },
      (err) => {
        if (err) {
          logger.error(
            `Failed to publish add device message for device ${device.id}:`,
            err
          );
        } else {
          logger.info(
            `Published add device message for device ${device.id} to topic ${topic}`
          );
        }
      }
    );
  }

  private publishDeviceAddition(device: Device) {
    switch (device.type) {
      case DeviceType.SWITCH:
        this.addDevice(device, "Lightbulb");
        break;
      case DeviceType.DIMMING:
        this.addDevice(device, "Lightbulb", { Brightness: "default" });
        break;
      default:
        logger.warn("Unknown device type for device", device);
        break;
    }
  }

  // -- BLE Event Handling --

  private setCharacteristic(
    device: Device,
    characteristic: string,
    value: boolean | number
  ) {
    const topic = `${this.options.homebridgeMqtt.topicPrefix}/to/set`;
    let service_name = device.name || "Unnamed Device";
    if (device.roomName) service_name = `${service_name} (${device.roomName})`;

    const payload = JSON.stringify({
      name: device.id,
      service_name,
      characteristic,
      value,
    });

    this.aedes.publish(
      {
        topic,
        payload,
        qos: 1,
        retain: false,
        dup: false,
        cmd: "publish",
      },
      (err) => {
        if (err) {
          logger.error(
            `Failed to publish ${characteristic} update for device ${device.id}:`,
            err
          );
        } else {
          logger.info(
            `Published ${characteristic} update for device ${device.id} to topic ${topic}`
          );
          logger.debug(`Payload: ${payload}`);
        }
      }
    );
  }

  private handleSwitchBLEData(device: Device, data: string) {
    logger.debug(`Handling Switch BLE data for device ${device.id}: ${data}`);

    const status = data.slice(-1);
    const statusInt = parseInt(status, 16);
    const lightStates = statusInt
      .toString(2)
      .padStart(4, "0")
      .slice(0, -1)
      .split("")
      .reverse();

    if (device.type !== DeviceType.SWITCH) {
      logger.error(`Device ${device.id} is not a switch device`);
      return;
    }

    const isOn = lightStates[device.index - 1];
    if (isOn === undefined) {
      logger.warn(
        `No status found for device index ${device.index} (MAC: ${device.macAddress})`
      );
      return;
    }

    this.setCharacteristic(device, "On", isOn === "1");
  }

  private handleDimmingBLEData(device: Device, data: string) {
    logger.debug(`Handling Dimming BLE data for device ${device.id}: ${data}`);

    // BLE brightness is in 5th-6th hex chars (index 4 and 5)
    if (data.length < 6) {
      logger.warn(`BLE data too short for dimming: ${data}`);
      return;
    }
    const brightnessHex = data.substring(4, 6);
    let brightness = parseInt(brightnessHex, 16);
    if (isNaN(brightness)) {
      logger.warn(`Invalid brightness hex in BLE data: ${brightnessHex}`);
      return;
    }
    // Scale to 0-100
    brightness = Math.round((brightness / 255) * 100);

    this.setCharacteristic(device, "Brightness", brightness);
    this.setCharacteristic(device, "On", brightness > 0);
  }

  private handleBleDeviceData(macAddress: string, data: string) {
    if (!service.deviceService) {
      logger.error("Device service not available");
      return;
    }

    const devices = service.deviceService.getByMacAddress(macAddress);
    if (devices.length === 0) {
      logger.debug(`No devices found for MAC address: ${macAddress}`);
      return;
    }

    for (const device of devices) {
      switch (device.type) {
        case DeviceType.SWITCH:
          this.handleSwitchBLEData(device, data);
          break;
        case DeviceType.DIMMING:
          this.handleDimmingBLEData(device, data);
          break;
        default:
          logger.warn("Unknown device type for device", device);
          break;
      }
    }
  }

  private extractAndCacheBleDeviceMessage(payloadString: string) {
    // Split payload: first 17 chars are MAC, rest is data
    const macAddress = payloadString.slice(0, 17);
    const data = payloadString.slice(17);

    // Cache the data for this MAC address
    this.bleDeviceCache.set(macAddress, data);

    logger.debug(`Cached BLE device data: MAC=${macAddress}, Data=${data}`);

    // Handle the data
    this.handleBleDeviceData(macAddress, data);
  }

  // -- Aedes Event Handlers --

  private handleClientConnection(client: Aedes.Client) {
    logger.info(`Client Connected: ${client.id}`);
  }

  private async handlePublish(
    packet: Aedes.PublishPacket,
    client: Aedes.Client
  ) {
    logger.debug(
      `Message from client ${client.id}: Topic=${
        packet.topic
      } Payload=${packet.payload.toString()}`
    );

    if (
      packet.topic === `${this.options.homebridgeMqtt.topicPrefix}/from/set`
    ) {
      const payload = JSON.parse(packet.payload.toString());
      await this.handleHomebridgeSetMessage(payload);
    }

    if (packet.topic === "yoswit/ble/devices") {
      const payloadString = packet.payload.toString();
      this.extractAndCacheBleDeviceMessage(payloadString);
    }
  }

  private handleSubscription(
    subscription: Aedes.Subscription,
    client: Aedes.Client
  ) {
    logger.info(
      `Client ${client.id} subscribed to topic: ${subscription.topic}`
    );

    if (
      subscription.topic !== `${this.options.homebridgeMqtt.topicPrefix}/to/#`
    )
      return;

    const devices = Object.values(service.deviceService?.devices || {});

    for (const device of devices) this.publishDeviceAddition(device);

    // Replay cached BLE device data for this new subscription
    logger.info(`Replaying cached BLE device data for client ${client.id}`);
    for (const [macAddress, data] of this.bleDeviceCache.entries())
      this.handleBleDeviceData(macAddress, data);
  }

  private setupEventHandlers() {
    this.aedes.on("client", (client) => this.handleClientConnection(client));

    this.aedes.on("publish", async (packet, client) => {
      if (client) await this.handlePublish(packet, client);
    });

    this.aedes.on("subscribe", (subscriptions, client) => {
      if (client)
        subscriptions.forEach((sub) => {
          this.handleSubscription(sub, client);
        });
    });
  }

  start() {
    const server = createServer(this.aedes.handle);
    server.listen(this.port, () =>
      logger.info("Server started and listening on port", this.port)
    );

    this.setupEventHandlers();
  }
}

export default AedesService;
