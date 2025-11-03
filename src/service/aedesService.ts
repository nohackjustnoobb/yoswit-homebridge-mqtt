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

  handleSwitchPayload(macAddress: string, status: string) {
    const statusInt = parseInt(status, 16);
    const lightStates = statusInt
      .toString(2)
      .padStart(4, "0")
      .slice(0, -1)
      .split("")
      .reverse();
    const devices = service.deviceService?.getByMacAddress(macAddress);

    for (const device of devices || []) {
      if (device.type !== DeviceType.SWITCH) continue;

      const isOn = lightStates[device.index - 1];
      if (isOn === undefined) {
        logger.warn(
          `No status found for device index ${device.index} (MAC: ${macAddress})`
        );
        continue;
      }

      const topic = `${this.options.homebridgeMqtt.topicPrefix}/to/set`;
      let service_name = device.name || "Unnamed Device";
      if (device.roomName)
        service_name = `${service_name} (${device.roomName})`;

      const payload = JSON.stringify({
        name: device.id,
        service_name,
        characteristic: "On",
        value: isOn === "1",
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
              `Failed to publish status update for device ${device.id}:`,
              err
            );
          } else {
            logger.info(
              `Published status update for device ${device.id} to topic ${topic}`
            );
            logger.debug(`Payload: ${payload}`);
          }
        }
      );
    }
  }

  private handleClientConnection(client: Aedes.Client) {
    logger.info(`Client Connected: ${client.id}`);
  }

  private async handleHomebridgeSetMessage(payload: HomebridgeSetPayload) {
    switch (payload.characteristic) {
      case "On":
        logger.info(
          `Setting device ${payload.name} to value: ${payload.value}`
        );

        try {
          await service.deviceService?.switchDevice(
            payload.name,
            payload.value
          );
        } catch (error) {
          logger.error(`Failed to switch device ${payload.name}:`, error);
        }
        break;

      default:
        logger.warn("Unknown characteristic:", payload.characteristic);
        break;
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

  private handleBleDeviceData(macAddress: string, data: string) {
    // Extract device type (4th to last to last-1 char) and status (last char)
    const deviceType = data.slice(-4, -1);
    const status = data.slice(-1);

    logger.debug(
      `Handling BLE device data: MAC=${macAddress}, Data=${data}, DeviceType=${deviceType}, Status=${status}`
    );

    switch (deviceType) {
      case "400":
        this.handleSwitchPayload(macAddress, status);
        break;
      default:
        logger.debug("Unsupported device type, ignoring");
        break;
    }
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

  private addSwitch(device: Device, topic: string) {
    let service_name = device.name || "Unnamed Device";
    if (device.roomName) service_name = `${service_name} (${device.roomName})`;

    const payload = {
      name: device.id,
      service_name,
      service: "Lightbulb",
    };

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

  private publishDeviceAddition(device: Device, topic: string) {
    switch (device.type) {
      case DeviceType.SWITCH:
        this.addSwitch(device, topic);
        break;
      default:
        logger.warn("Unknown device type for device", device);
        break;
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

    const topic = `${this.options.homebridgeMqtt.topicPrefix}/to/add`;
    const devices = Object.values(service.deviceService?.devices || {});

    for (const device of devices) this.publishDeviceAddition(device, topic);

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
