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

  constructor(port: number, options: AedesServiceOptions) {
    this.port = port;
    this.options = options;
    this.aedes = Aedes.createBroker();
  }

  private parseSwitchStatus(status: string): boolean[] {
    const statusInt = parseInt(status, 16);
    let statusBin = statusInt.toString(2).padStart(4, "0");
    statusBin = statusBin.slice(0, -1);
    return statusBin
      .split("")
      .reverse()
      .map((bit) => bit === "1");
  }

  handleSwitchPayload(macAddress: string, status: string) {
    const lightStates = this.parseSwitchStatus(status);
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

      this.aedes.publish(
        {
          topic,
          payload: JSON.stringify({
            name: device.id,
            service_name,
            characteristic: "On",
            value: isOn,
          }),
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

  private handleBleDeviceMessage(payloadString: string) {
    // Split payload: first 17 chars are MAC, rest is data
    const macAddress = payloadString.slice(0, 17);
    const data = payloadString.slice(17);

    // Extract device type (4th to last to last-1 char) and status (last char)
    const deviceType = data.slice(-4, -1);
    const status = data.slice(-1);

    logger.debug(
      `Received BLE device payload: MAC=${macAddress}, Data=${data}, DeviceType=${deviceType}, Status=${status}`
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
      this.handleBleDeviceMessage(payloadString);
    }
  }

  private getServiceTypeForDevice(deviceType: DeviceType): string | null {
    switch (deviceType) {
      case DeviceType.SWITCH:
        return "Lightbulb";
      default:
        return null;
    }
  }

  private publishDeviceAddition(device: Device, topic: string) {
    let service_name = device.name || "Unnamed Device";
    if (device.roomName) service_name = `${service_name} (${device.roomName})`;

    const serviceType = this.getServiceTypeForDevice(device.type);
    if (!serviceType) {
      logger.warn("Unknown device type for device", device);
      return;
    }

    const payload = {
      name: device.id,
      service_name,
      service: serviceType,
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
