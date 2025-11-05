import { md5 } from "../utils.ts";
import service from "./service.ts";
import { Logger } from "../logger.ts";

const logger = Logger.create("DeviceService");

enum DeviceType {
  SWITCH,
  DIMMING,
}

interface Device {
  id: string; // => `{guid}-{index}`

  guid: string;
  name?: string;
  type: DeviceType;
  index: number;
  macAddress: string;
  roomName?: string;
  gatewayId: string;
}

class DeviceService {
  devices: Record<string, Device> = {};

  // deno-lint-ignore no-explicit-any
  static fromAfterLoginResp(data: any): DeviceService {
    const deviceInfo: Record<
      string,
      {
        gateway?: string;
        macAddress?: string;
      }
    > = {};

    // get gateway info from profile_device
    for (const profileDevice of data.profile.profile_device) {
      if (!profileDevice.device || !profileDevice.gateway) {
        logger.warn("Invalid profile device data:", profileDevice);
        continue;
      }

      deviceInfo[profileDevice.device] = {
        gateway: profileDevice.gateway,
      };
    }

    // get mac address from device
    // deno-lint-ignore no-explicit-any
    for (const deviceData of Object.values(data.device) as any[]) {
      if (!deviceData.name || !deviceData.mac_address) {
        logger.warn("Invalid device data:", deviceData);
        continue;
      }

      if (
        !deviceInfo[deviceData.name] ||
        !deviceInfo[deviceData.name]?.gateway
      ) {
        logger.warn(`No gateway info for device ${deviceData.name}`);
        continue;
      }

      deviceInfo[deviceData.name].macAddress =
        deviceData.mac_address.toLowerCase();
    }

    const devicesManager = new DeviceService();

    for (const profileSubdevice of data.profile.profile_subdevice) {
      try {
        if (!profileSubdevice.device_button_group) {
          logger.warn("Invalid profile subdevice data:", profileSubdevice);
          continue;
        }

        if (profileSubdevice.device_button_group.startsWith("ONOFF GANG")) {
          const name = profileSubdevice.title as string | undefined;
          // Skip devices with V1 or V2 because they are likely to be a internal on/off switch for the dimming device
          if (name && (name.includes("V1") || name.includes("V2"))) {
            logger.warn("Skipping internal switch device:", name);
            continue;
          }

          const index = Number(
            profileSubdevice.device_button_group.replace("ONOFF GANG", "")
          );
          const id = `${profileSubdevice.device}-${index}`;
          if (devicesManager.devices[id]) {
            logger.warn(`Duplicate device id: ${id}`);
            continue;
          }

          const guid = profileSubdevice.device;
          if (!guid) {
            logger.warn("Invalid profile subdevice data:", profileSubdevice);
            continue;
          }

          let roomName = profileSubdevice.room_name;
          if (roomName) roomName = roomName.replace(/\[\/?en\]/g, "").trim();

          if (
            !deviceInfo[profileSubdevice.device] ||
            !deviceInfo[profileSubdevice.device]?.macAddress ||
            !deviceInfo[profileSubdevice.device]?.gateway
          ) {
            logger.warn(
              `Missing device info for ${profileSubdevice.device}:`,
              deviceInfo[profileSubdevice.device]
            );
            continue;
          }

          devicesManager.devices[id] = {
            id,
            guid,
            name,
            type: DeviceType.SWITCH,
            index,
            macAddress: deviceInfo[profileSubdevice.device]!.macAddress!,
            roomName,
            gatewayId: deviceInfo[profileSubdevice.device]!.gateway!,
          };
        } else if (profileSubdevice.device_button_group.startsWith("DIMMING")) {
          // DIMMING devices are always single channel
          const index = 0;
          const id = `${profileSubdevice.device}-${index}`;
          if (devicesManager.devices[id]) {
            logger.warn(`Duplicate device id: ${id}`);
            continue;
          }

          const guid = profileSubdevice.device;
          if (!guid) {
            logger.warn("Invalid profile subdevice data:", profileSubdevice);
            continue;
          }

          let roomName = profileSubdevice.room_name;
          if (roomName) roomName = roomName.replace(/\[\/?en\]/g, "").trim();

          devicesManager.devices[id] = {
            id,
            guid,
            name: profileSubdevice.title,
            type: DeviceType.DIMMING,
            index,
            macAddress: deviceInfo[profileSubdevice.device]!.macAddress!,
            roomName,
            gatewayId: deviceInfo[profileSubdevice.device]!.gateway!,
          };
        } else {
          logger.warn(
            `Unsupported device button group: ${profileSubdevice.device_button_group}`
          );
        }
      } catch (_e) {
        logger.warn(
          `Invalid device button group format: ${profileSubdevice.device_button_group}`
        );
        continue;
      }
    }

    logger.info(`Loaded ${Object.keys(devicesManager.devices).length} devices`);
    return devicesManager;
  }

  getByMacAddress(macAddress: string): Device[] {
    return Object.values(this.devices).filter(
      (device) => device.macAddress === macAddress
    );
  }

  getByName(name: string): Device | undefined {
    return this.devices[name];
  }

  async switchDevice(id: string, on: boolean) {
    logger.debug(`Switching device ${id} to ${on ? "ON" : "OFF"}`);

    if (!this.devices[id]) throw new Error(`Device with id ${id} not found`);

    if (this.devices[id].type !== DeviceType.SWITCH)
      throw new Error(`Device with id ${id} is not a switch`);

    const device = this.devices[id];
    const gatewayId = device.gatewayId;
    const macAddress = device.macAddress;
    const guid = device.guid;
    const position = device.index;
    const isOn = on;

    const bits = Array(8).fill(0);
    bits[4 - position] = 1;
    if (isOn) bits[8 - position] = 1;
    const data = parseInt(bits.join(""), 2)
      .toString(16)
      .toUpperCase()
      .padStart(2, "0");

    const reversedMac = macAddress.split(":").reverse().join("");
    const value = `02${reversedMac}8000${data}00`;

    const topic = `cmd/${await md5(await md5(gatewayId))}`;
    logger.debug(`Publishing MQTT command to topic: ${topic}`);
    await service.mqttService?.publish(topic, {
      command: "Control",
      function: "bleHelper.perform",
      params: [
        {
          action: "write",
          guid: guid,
          mac_address: macAddress,
          service_id: "ff80",
          char_id: "ff81",
          value: value,
        },
      ],
      callback: "",
      raw: "",
    });
  }

  async dimmingDevice(id: string, brightness: number) {
    logger.debug(`Dimming device ${id} to brightness ${brightness}`);

    if (!this.devices[id]) throw new Error(`Device with id ${id} not found`);

    if (this.devices[id].type !== DeviceType.DIMMING)
      throw new Error(`Device with id ${id} is not a dimming device`);

    const device = this.devices[id];
    const gatewayId = device.gatewayId;
    const macAddress = device.macAddress;
    const guid = device.guid;

    const scaledBrightness = Math.round((brightness / 100) * 255);
    const data = scaledBrightness.toString(16).padStart(2, "0").toUpperCase();
    const reversedMac = macAddress.split(":").reverse().join("");
    const value = `02${reversedMac}8900${data}`;

    const topic = `cmd/${await md5(await md5(gatewayId))}`;
    logger.debug(`Publishing MQTT command to topic: ${topic}`);
    await service.mqttService?.publish(topic, {
      command: "Control",
      function: "bleHelper.perform",
      params: [
        {
          action: "write",
          guid: guid,
          mac_address: macAddress,
          service_id: "ff80",
          char_id: "ff81",
          value: value,
        },
      ],
      callback: "",
      raw: "",
    });
  }
}

export default DeviceService;
export { DeviceType };
export type { Device };
